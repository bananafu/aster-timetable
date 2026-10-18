// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addSchool } from '../data/academicSettingsV4'
import { createBlankProject } from '../data/projectRuntime'
import { installSafeSubjectCatalog, previewSubjectCatalogInstall } from '../data/subjectCatalogInstall'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { createInitialAppDataV6, useAppDataV4 } from '../hooks/useAppDataV4'
import type { AppDataV4, SchoolLevel } from '../types'
import { AcademicSettingsV4 } from './AcademicSettingsV4'
import { LessonEditor } from './LessonEditor'

function setup(): AppDataV4 {
  let index = 0
  return createBlankProject(createInitialAppDataV6(), {
    name: '教師專案', teacherName: '林老師', academicYear: 115, semester: 'first',
    startDate: '2026-08-31', endDate: '2027-01-20',
  }, () => `setup-${++index}`, '2026-08-01T00:00:00.000Z')
}

function withSecondSchool(data: AppDataV4) {
  return addSchool(data, data.activeProjectId!, { name: '第二學校', color: '#718B6C' }, 'second-school')
}

function Harness({ initial, readOnly = false, showLesson = false }: { initial: AppDataV4; readOnly?: boolean; showLesson?: boolean }) {
  const [data, setData] = useState(initial)
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState<'schools' | 'subjects'>('schools')
  const updateData: typeof setData = (next) => { setData(next); setRevision((current) => current + 1) }
  return <>
    <button onClick={() => setPage(page === 'schools' ? 'subjects' : 'schools')}>切換設定頁</button>
    <output data-testid="unit-count">{data.teachingUnits.length}</output>
    <output data-testid="subject-count">{data.subjects.length}</output>
    <AcademicSettingsV4 data={data} setData={updateData} page={page} readOnly={readOnly} storagePersistence={{ pending: false, revision }} />
    {showLesson && <LessonEditor data={data} setData={setData} onClose={vi.fn()} onSaved={vi.fn()} />}
  </>
}

function StoredHarness() {
  const [data, setData, status, , persistence] = useAppDataV4()
  return <>
    <output data-testid="storage-status">{status}</output>
    <AcademicSettingsV4 data={data} setData={setData} page="schools" storageStatus={status} storagePersistence={persistence} />
    <LessonEditor data={data} setData={setData} onClose={vi.fn()} onSaved={vi.fn()} />
  </>
}

function createUnit(level: SchoolLevel, schoolId?: string) {
  if (schoolId) fireEvent.change(screen.getByLabelText('所屬學校'), { target: { value: schoolId } })
  fireEvent.change(screen.getByLabelText('新增學制'), { target: { value: level } })
  if (level === 'other') fireEvent.change(screen.getByLabelText('自訂學制名稱'), { target: { value: '實驗課程' } })
  fireEvent.change(screen.getByLabelText('新學制起始日'), { target: { value: '2027-02-01' } })
  fireEvent.change(screen.getByLabelText('新學制結束日'), { target: { value: '2027-06-30' } })
  fireEvent.click(screen.getByRole('button', { name: '新增學制設定' }))
}

describe('new TeachingUnit subject onboarding', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })

  it('shows a junior-high prompt only after a new unit, and skipping does not block later work', () => {
    render(<Harness initial={setup()} />)
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
    createUnit('junior-high')
    expect(screen.getByLabelText('預設科目引導').textContent).toContain('國中部')
    expect(screen.getByTestId('unit-count').textContent).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: '稍後再說' }))
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '切換設定頁' }))
    fireEvent.click(screen.getByRole('button', { name: '切換設定頁' }))
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
    expect(screen.getByRole('button', { name: '新增學制' })).toBeTruthy()
  })

  it('preselects senior-high in the existing installer and leaves optional subjects unchecked', () => {
    render(<Harness initial={withSecondSchool(setup())} />)
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
    createUnit('senior-high', 'second-school')
    expect(screen.getByLabelText('預設科目引導').textContent).toContain('高中部')
    fireEvent.click(screen.getByRole('button', { name: '檢視並補齊' }))
    expect(screen.getByLabelText('科目補齊預覽')).toBeTruthy()
    expect((screen.getByLabelText('國中部') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('普通高中部') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('班會') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByLabelText('科目補齊預覽').textContent).toContain('物理')
    expect(screen.getByLabelText('科目補齊預覽').textContent).not.toContain('理化')
  })

  it('does not recommend a core catalog for other or a fully covered level', () => {
    const initial = setup()
    render(<Harness initial={initial} />)
    createUnit('other')
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
    cleanup()
    const preview = previewSubjectCatalogInstall(initial, ['junior-high'])
    const covered = installSafeSubjectCatalog(initial, preview, (() => { let index = 0; return () => `subject-${++index}` })()).data
    render(<Harness initial={covered} />)
    createUnit('junior-high')
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
  })

  it('keeps a review-only prompt without mutating existing Subject fields', () => {
    const initial = setup()
    const core = installSafeSubjectCatalog(initial, previewSubjectCatalogInstall(initial, ['junior-high']), (() => { let index = 0; return () => `subject-${++index}` })()).data
    const chinese = core.subjects.find((subject) => subject.name === '國語文')!
    const existing = { ...chinese, name: '國文', color: '#123456' }
    const data = { ...core, subjects: core.subjects.map((subject) => subject.id === chinese.id ? existing : subject) }
    render(<Harness initial={data} />)
    createUnit('junior-high')
    expect(screen.getByLabelText('預設科目引導')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '檢視並補齊' }))
    expect(screen.getByLabelText('科目補齊預覽').textContent).toContain('需人工確認 1 筆')
    expect((screen.getByRole('button', { name: /確認安裝安全項目/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(data.subjects.find((subject) => subject.id === chinese.id)).toEqual(existing)
  })

  it('does not offer a writable prompt for archived projects', () => {
    const initial = setup()
    initial.projects[0].archivedAt = '2026-10-01T00:00:00.000Z'
    render(<Harness initial={initial} readOnly />)
    expect((screen.getByRole('button', { name: '新增學制設定' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
    expect(screen.getByTestId('unit-count').textContent).toBe('1')
  })

  it('does not prompt or change data when a duplicate level is rejected', () => {
    render(<Harness initial={setup()} />)
    createUnit('senior-high')
    expect(screen.getByRole('alert').textContent).toContain('同一學校不可重複建立相同學制')
    expect(screen.getByTestId('unit-count').textContent).toBe('1')
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
  })

  it('uses the persisted installer transaction and exposes the new Subject ID to LessonEditor', () => {
    vi.useFakeTimers()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(migrateV6ToV7(setup())))
    render(<StoredHarness />)
    createUnit('junior-high')
    act(() => vi.advanceTimersByTime(200))
    fireEvent.click(screen.getByRole('button', { name: '檢視並補齊' }))
    expect((screen.getByRole('button', { name: /確認安裝安全項目/ }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /確認安裝安全項目/ }))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('storage-status').textContent).toBe('saved')
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV4
    const physicalScience = stored.subjects.find((subject) => subject.name === '理化')!
    expect(physicalScience.id).toBeTruthy()
    expect(stored.subjects.some((subject) => subject.name === '班會')).toBe(false)
    const input = screen.getByRole('combobox', { name: '課程科目' })
    fireEvent.change(screen.getByLabelText('課程學制'), { target: { value: stored.teachingUnits.at(-1)!.id } })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'ㄌㄧˇ' } })
    expect(screen.getByRole('option', { name: /理化/ })).toBeTruthy()
    expect(stored.subjects.find((subject) => subject.id === physicalScience.id)).toMatchObject({ name: '理化', color: physicalScience.color })
    cleanup()
    render(<StoredHarness />)
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
  })
})

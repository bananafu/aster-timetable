// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { initialData } from '../data/seed'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { isCompatibleAppDataV7 } from '../data/validators/v7'
import { useAppDataV4 } from '../hooks/useAppDataV4'
import { useResourceManagementSession } from '../hooks/useResourceManagementSession'
import type { AppDataV7 } from '../types'
import { CourseResourceManagerDialog } from './CourseResourceManager'
import { LessonEditor } from './LessonEditor'
import { OneOffLessonEditor } from './OneOffLessonEditor'

type Mode = 'fixed' | 'one-off'
type ResourceMode = 'classes' | 'subjects'

const base = (): AppDataV7 => {
  const data = migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
  data.recurringLessons = []
  data.overrides = []
  data.oneOffLessons = []
  return data
}

function Harness({ mode }: { mode: Mode }) {
  const [data, setData, status, controls, persistence] = useAppDataV4()
  const session = useResourceManagementSession(data, setData, status, persistence)
  const [manager, setManager] = useState<ResourceMode | null>(null)
  const created = useRef<((id: string) => void) | null>(null)
  const editorClose = useRef(vi.fn())
  const openManager = (resourceMode: ResourceMode, context: { projectId: string; teachingUnitId: string }, onCreated: (id: string) => void) => {
    const unit = data.teachingUnits.find((item) => item.id === context.teachingUnitId && item.projectId === context.projectId)
    if (!unit) return
    session.requestTransition(() => {
      session.setView({ projectId: context.projectId, schoolId: unit.schoolId, unitId: unit.id, showClassCreate: false })
      created.current = onCreated
      setManager(resourceMode)
    })
  }
  const closeManager = () => { created.current = null; setManager(null) }
  const closeEditor = () => { if (!manager) editorClose.current() }
  return <>
    <output data-testid="storage-state">{status}</output>
    <output data-testid="editor-close-count">{editorClose.current.mock.calls.length}</output>
    {mode === 'fixed'
      ? <LessonEditor data={data} setData={setData} storageStatus={status} storagePersistence={persistence} timetableId={data.timetables?.[0]?.id} onManageResource={openManager} onClose={closeEditor} onSaved={vi.fn()} />
      : isCompatibleAppDataV7(data) && <OneOffLessonEditor data={data} projectId={data.projects[0].id} timetableId={data.timetables[0].id} initialDate="2026-09-08" onManageResource={openManager} onSave={vi.fn()} onClose={closeEditor} />}
    {manager && <CourseResourceManagerDialog data={data} setData={setData} mode={manager} storageStatus={status} storagePersistence={persistence} storageControls={controls} session={session}
      onCreated={(resourceMode, id) => { if (resourceMode === manager) created.current?.(id) }} onClose={closeManager} />}
  </>
}

function start(data: AppDataV7, mode: Mode) {
  expect(isCompatibleAppDataV7(data)).toBe(true)
  localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
  render(<Harness mode={mode} />)
  if (mode === 'one-off') {
    fireEvent.change(screen.getByLabelText('學校'), { target: { value: data.schools[0].id } })
    fireEvent.change(screen.getByLabelText('學制'), { target: { value: data.teachingUnits[0].id } })
  }
}

function openManager(mode: ResourceMode) {
  if (mode === 'subjects' && screen.queryAllByRole('button', { name: '管理科目' }).length === 0) {
    fireEvent.click(screen.getByLabelText('課程科目'))
  }
  fireEvent.click(screen.getAllByRole('button', { name: mode === 'classes' ? '管理班級' : '管理科目' })[0])
  return screen.getByRole('dialog', { name: mode === 'classes' ? '管理班級' : '管理科目' })
}

function createClass() {
  const dialog = openManager('classes')
  fireEvent.click(within(dialog).getByRole('button', { name: '＋ 新增班級' }))
  const form = within(dialog).getByRole('form', { name: '新增班級表單' })
  const number = within(form).queryByLabelText('新班級班號')
  if (number) fireEvent.change(number, { target: { value: '9' } })
  else fireEvent.change(within(form).getByLabelText('新班級名稱'), { target: { value: '新班級' } })
  fireEvent.click(within(form).getByRole('button', { name: '新增班級' }))
}

function createSubject(name = '閱讀策略') {
  const dialog = openManager('subjects')
  fireEvent.click(within(dialog).getByRole('button', { name: '＋ 新增科目' }))
  const form = within(dialog).getByRole('form', { name: '新增科目表單' })
  fireEvent.change(within(form).getByLabelText('新科目名稱'), { target: { value: name } })
  fireEvent.change(within(form).getByLabelText('新科目簡稱'), { target: { value: '閱讀' } })
  fireEvent.click(within(form).getByRole('button', { name: '新增科目' }))
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

describe('lesson editor resource manager flow', () => {
  it.each<Mode>(['fixed', 'one-off'])('%s creates and selects a missing class while preserving the lesson draft', async (mode) => {
    const data = base()
    data.classes = []
    start(data, mode)
    if (mode === 'fixed') {
      fireEvent.change(screen.getByLabelText('課程星期'), { target: { value: '3' } })
      fireEvent.change(screen.getByLabelText('課程輪週'), { target: { value: 'B' } })
      fireEvent.change(screen.getByPlaceholderText('依班級預設'), { target: { value: '自訂教室' } })
    } else {
      fireEvent.change(screen.getByLabelText('教室（選填）'), { target: { value: '自訂教室' } })
      fireEvent.change(screen.getByLabelText('時間模式'), { target: { value: 'custom' } })
    }
    createClass()
    await waitFor(() => expect((screen.getByLabelText('新班級名稱') as HTMLInputElement).value).toBe(''))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV7
    await waitFor(() => expect((screen.getByLabelText(mode === 'fixed' ? '課程班級' : '班級') as HTMLSelectElement).value).toBe(stored.classes[0].id))
    expect(screen.getByRole('dialog', { name: '管理班級' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    expect(screen.queryByRole('dialog', { name: '管理班級' })).toBeNull()
    expect(stored.classes).toHaveLength(1)
    expect(stored.recurringLessons).toEqual([])
    expect(stored.oneOffLessons).toEqual([])
    expect((screen.getByLabelText(mode === 'fixed' ? '課程班級' : '班級') as HTMLSelectElement).value).toBe(stored.classes[0].id)
    if (mode === 'fixed') {
      expect((screen.getByLabelText('課程星期') as HTMLSelectElement).value).toBe('3')
      expect((screen.getByLabelText('課程輪週') as HTMLSelectElement).value).toBe('B')
      expect((screen.getByPlaceholderText('依班級預設') as HTMLInputElement).value).toBe('自訂教室')
    } else {
      expect((screen.getByLabelText('指定日期') as HTMLInputElement).value).toBe('2026-09-08')
      expect((screen.getByLabelText('時間模式') as HTMLSelectElement).value).toBe('custom')
      expect((screen.getByLabelText('教室（選填）') as HTMLInputElement).value).toBe('自訂教室')
    }
  })

  it.each<Mode>(['fixed', 'one-off'])('%s creates and selects a missing subject only after persistence succeeds', async (mode) => {
    const data = base()
    data.subjects = []
    start(data, mode)
    createSubject()
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    await waitFor(() => expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe(''))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV7
    if (mode === 'fixed') await waitFor(() => expect((screen.getByLabelText('課程科目') as HTMLInputElement).value).toBe('閱讀策略'))
    else await waitFor(() => expect((screen.getByLabelText('科目') as HTMLSelectElement).value).toBe(stored.subjects[0].id))
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    expect(screen.queryByRole('dialog', { name: '管理科目' })).toBeNull()
    expect(stored.subjects).toHaveLength(1)
    expect(stored.subjects[0]).toMatchObject({ name: '閱讀策略', applicableSchoolLevels: [data.teachingUnits[0].schoolLevel] })
    expect(stored.recurringLessons).toEqual([])
    expect(stored.oneOffLessons).toEqual([])
    if (mode === 'fixed') expect((screen.getByLabelText('課程科目') as HTMLInputElement).value).toBe('閱讀策略')
    else expect((screen.getByLabelText('科目') as HTMLSelectElement).value).toBe(stored.subjects[0].id)
  })

  it.each<Mode>(['fixed', 'one-off'])('%s can open both managers from populated selectors', (mode) => {
    const data = base()
    start(data, mode)
    const subjectManager = openManager('subjects')
    fireEvent.click(within(subjectManager).getByRole('button', { name: '關閉對話框' }))
    expect(openManager('classes')).toBeTruthy()
  })

  it('Escape closes only the manager and preserves the fixed lesson editor draft', () => {
    const data = base()
    start(data, 'fixed')
    fireEvent.change(screen.getByLabelText('課程星期'), { target: { value: '4' } })
    openManager('classes')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '管理班級' })).toBeNull()
    expect(screen.getByRole('dialog', { name: '新增固定課程' })).toBeTruthy()
    expect((screen.getByLabelText('課程星期') as HTMLSelectElement).value).toBe('4')
    expect(screen.getByTestId('editor-close-count').textContent).toBe('0')
  })

  it('keeps the manager, creation draft, and one-off lesson draft when storage writes fail', async () => {
    const data = base()
    data.subjects = []
    start(data, 'one-off')
    fireEvent.change(screen.getByLabelText('教室（選填）'), { target: { value: '保留教室' } })
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V7_KEY) throw new Error('quota')
      return original.call(this, key, value)
    })
    createSubject()
    await waitFor(() => expect(screen.getByTestId('storage-state').textContent).toBe('write-error'))
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('閱讀策略')
    expect((screen.getByLabelText('教室（選填）') as HTMLInputElement).value).toBe('保留教室')
    expect(screen.queryByText('已儲存：已新增科目。')).toBeNull()
  })

  it('does not auto-select a creation replaced by a cross-tab document', async () => {
    const data = base()
    data.classes = []
    start(data, 'fixed')
    createClass()
    const external = { ...data, migrationWarnings: [...data.migrationWarnings, { id: 'external', entityType: 'lesson' as const, entityId: 'external', message: 'external' }] }
    const oldValue = localStorage.getItem(APP_DATA_V7_KEY)
    const newValue = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V7_KEY, newValue)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue, newValue, storageArea: localStorage })))
    await waitFor(() => expect(screen.getByTestId('storage-state').textContent).toBe('conflict'))
    expect(screen.getByRole('dialog', { name: '管理班級' })).toBeTruthy()
    expect((screen.getByLabelText('課程班級') as HTMLSelectElement).value).toBe('')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(newValue)
  })
})

// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDataV4, AppDataV7, SchoolLevel } from '../types'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { isCompatibleAppDataV7 } from '../data/validators/v7'
import { useAppDataV4 } from '../hooks/useAppDataV4'
import { CourseResourceManager } from './CourseResourceManager'
import { LessonEditor } from './LessonEditor'
import { OneOffLessonEditor } from './OneOffLessonEditor'

function fixture() {
  const data = migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
  data.recurringLessons = []
  data.teachingUnits[0].schoolLevel = 'junior-high'
  data.teachingUnits.push({ ...data.teachingUnits[0], id: 'senior-unit', name: '高中部', schoolLevel: 'senior-high' })
  data.classes.push({ ...data.classes[0], id: 'senior-class', teachingUnitId: 'senior-unit' })
  data.subjects[0].applicableSchoolLevels = ['junior-high', 'senior-high']
  return data
}

function Harness() {
  const [data, setData, status, controls, persistence] = useAppDataV4()
  const [view, setView] = useState<'manager' | 'fixed' | 'one-off'>('manager')
  return <>
    <output data-testid="data">{JSON.stringify(data)}</output>
    <output data-testid="storage">{status}</output>
    <output data-testid="revision">{persistence.revision}</output>
    <button onClick={controls.acceptExternal}>accept external</button>
    <button onClick={() => setView('fixed')}>open fixed</button>
    <button onClick={() => setView('one-off')}>open one-off</button>
    {view === 'manager' && <CourseResourceManager data={data} setData={setData} mode="subjects" storageStatus={status} storagePersistence={persistence} />}
    {view === 'fixed' && <LessonEditor data={data} setData={setData} timetableId={data.timetables?.[0].id}
      storageStatus={status} storagePersistence={persistence} onClose={() => {}} onSaved={() => {}} />}
    {view === 'one-off' && isCompatibleAppDataV7(data) && <OneOffLessonEditor data={data} setData={setData}
      projectId={data.projects[0].id} timetableId={data.timetables[0].id} initialTeachingUnitId={data.teachingUnits[0].id}
      initialDate="2026-09-07" storageStatus={status} storagePersistence={persistence} onClose={() => {}} onSave={() => {}} />}
  </>
}

function start(data = fixture()) {
  expect(isCompatibleAppDataV7(data)).toBe(true)
  const raw = JSON.stringify(data)
  localStorage.setItem(APP_DATA_V7_KEY, raw)
  render(<Harness />)
  return { data, raw }
}
const row = () => screen.getByRole('form', { name: '管理科目 國文' })
const remove = (label = '國中部') => fireEvent.click(within(row()).getByRole('button', { name: `解除${label}適用` }))
const flush = () => act(() => vi.advanceTimersByTime(200))
const success = () => screen.queryByText(/^已儲存：已解除/)
function receive(external: AppDataV7, oldValue: string) {
  const raw = JSON.stringify(external)
  localStorage.setItem(APP_DATA_V7_KEY, raw)
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue, newValue: raw, storageArea: localStorage })))
  return raw
}

describe('subject school-level removal UI', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); vi.spyOn(window, 'confirm').mockReturnValue(true) })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })

  it.each([
    ['junior-high', '國中部'], ['senior-high', '高中部'], ['other', '其他'],
  ] as const)('confirms the global %s scope and reports success only after persistence', (level, label) => {
    const data = fixture()
    data.teachingUnits = [{ ...data.teachingUnits[0], schoolLevel: level }]
    data.classes = data.classes.filter((item) => item.teachingUnitId === data.teachingUnits[0].id)
    data.subjects[0].applicableSchoolLevels = ['junior-high', 'senior-high', 'other']
    const { raw } = start(data)
    remove(label)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(`此操作將從所有${label}的可用科目中移除此科目，不會刪除科目本身，也不會影響其他學制。`))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('所有專案、學校與課表'))
    expect(success()).toBeNull()
    expect(screen.getByText('正在儲存解除適用關係…')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    flush()
    expect(success()).toBeTruthy()
    expect(screen.getByTestId('revision').textContent).toBe('1')
    const saved = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV7
    expect(saved.subjects[0]).toEqual({ ...data.subjects[0], applicableSchoolLevels: data.subjects[0].applicableSchoolLevels.filter((item) => item !== level) })
    expect(saved.recurringLessons).toEqual(data.recurringLessons)
  })

  it('cancels without changing data or saving', () => {
    const { raw } = start()
    vi.mocked(window.confirm).mockReturnValue(false)
    remove()
    flush()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(screen.getByTestId('data').textContent).toBe(raw)
    expect(screen.getByTestId('revision').textContent).toBe('0')
    expect(success()).toBeNull()
  })

  it('loads legacy colors and duplicate short names without cleanup, preserving them when detaching', () => {
    const data = fixture()
    data.subjects[0].color = 'rgb(12, 34, 56)'
    data.subjects[1].shortName = data.subjects[0].shortName
    const { raw } = start(data)
    flush()
    expect(screen.getByTestId('storage').textContent).toBe('saved')
    expect(screen.getByTestId('revision').textContent).toBe('0')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    remove()
    flush()
    expect(success()).toBeTruthy()
    const saved = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV7
    expect(saved.subjects[0]).toEqual({ ...data.subjects[0], applicableSchoolLevels: ['senior-high'] })
    expect(saved.subjects.slice(1)).toEqual(data.subjects.slice(1))
  })

  it.each(['last-level', 'referenced', 'unknown'] as const)('explains why %s prevents removal without asking to proceed', (reason) => {
    const data = fixture()
    if (reason === 'last-level') data.subjects[0].applicableSchoolLevels = ['junior-high']
    else data.overrides.push({ id: 'replacement', projectId: reason === 'unknown' ? null : data.projects[0].id,
      timetableId: reason === 'unknown' ? null : data.timetables[0].id,
      teachingUnitId: reason === 'unknown' ? null : data.teachingUnits[0].id, action: 'replace',
      date: '2026-09-07', periodId: 1, replacement: { subjectId: data.subjects[0].id, classId: data.classes[0].id } })
    const { raw } = start(data)
    remove()
    expect(screen.getByRole('alert').textContent).toContain(reason === 'last-level' ? '最後一個' : reason === 'unknown' ? '無法判斷學制' : '引用')
    expect(window.confirm).not.toHaveBeenCalled()
    flush()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(success()).toBeNull()
  })

  it('does not report success when persistence fails', () => {
    const { raw } = start()
    remove()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    flush()
    expect(screen.getByRole('alert').textContent).toContain('尚未成功寫入')
    expect(screen.getByTestId('storage').textContent).toBe('write-error')
    expect(screen.getByTestId('revision').textContent).toBe('0')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(success()).toBeNull()
  })

  it('does not report success during conflict or after accepting an external document', () => {
    const { data, raw } = start()
    remove()
    const external = { ...data, projects: data.projects.map((project) => ({ ...project, name: 'External' })) }
    const externalRaw = receive(external, raw)
    flush()
    expect(screen.getByRole('alert').textContent).toContain('跨分頁資料衝突')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(externalRaw)
    expect(success()).toBeNull()
    fireEvent.click(screen.getByText('accept external'))
    expect(screen.getByTestId('storage').textContent).toBe('saved')
    expect(success()).toBeNull()
    expect(row()).toBeTruthy()
  })

  it('detects another tab writing during confirmation even without a storage event', () => {
    const { data } = start()
    const external = JSON.stringify({ ...data, projects: data.projects.map((project) => ({ ...project, name: 'Other tab' })) })
    vi.mocked(window.confirm).mockImplementation(() => { localStorage.setItem(APP_DATA_V7_KEY, external); return true })
    remove()
    flush()
    expect(screen.getByTestId('storage').textContent).toBe('conflict')
    expect(success()).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(external)
  })

  it('clears a prior success message when an external document is applied', () => {
    start()
    remove()
    flush()
    expect(success()).toBeTruthy()
    const raw = localStorage.getItem(APP_DATA_V7_KEY)!
    const external = JSON.parse(raw) as AppDataV7
    external.projects[0].name = 'External change'
    receive(external, raw)
    expect(screen.getByTestId('storage').textContent).toBe('saved')
    expect(success()).toBeNull()
  })

  it('does not offer removal for a level the globally listed subject does not apply to', () => {
    const data = fixture()
    data.subjects[0].applicableSchoolLevels = ['senior-high']
    start(data)
    fireEvent.click(screen.getByLabelText('顯示全域所有科目'))
    expect(within(row()).queryByRole('button', { name: '解除國中部適用' })).toBeNull()
    fireEvent.change(screen.getByLabelText('目前學制'), { target: { value: 'senior-unit' } })
    expect(within(row()).getByRole('button', { name: '解除高中部適用' })).toBeTruthy()
  })

  it('revalidates new references against the latest data instead of trusting the preview', () => {
    const data = fixture()
    const current = structuredClone(data)
    current.overrides.push({ id: 'new-reference', projectId: null, timetableId: null, teachingUnitId: null,
      action: 'replace', date: '2026-09-07', periodId: 1, replacement: { subjectId: data.subjects[0].id, classId: 'unknown' } })
    const setData = vi.fn((update) => update(current))
    render(<CourseResourceManager data={data} setData={setData} mode="subjects" storagePersistence={{ pending: false, revision: 0 }} />)
    remove()
    expect(setData).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert').textContent).toContain('無法判斷學制')
    expect(success()).toBeNull()
  })

  it.each(['fixed', 'one-off'] as const)('updates the %s editor options after persisted removal while retaining senior-high availability', (mode) => {
    const { data } = start()
    remove()
    flush()
    fireEvent.click(screen.getByText(`open ${mode}`))
    if (mode === 'fixed') {
      fireEvent.focus(screen.getByRole('combobox', { name: '課程科目' }))
      expect(within(screen.getByRole('listbox', { name: '可選科目' })).queryByText('國文')).toBeNull()
      fireEvent.change(screen.getByLabelText('學制'), { target: { value: 'senior-unit' } })
      fireEvent.focus(screen.getByRole('combobox', { name: '課程科目' }))
      expect(within(screen.getByRole('listbox', { name: '可選科目' })).getByText('國文')).toBeTruthy()
    } else {
      expect(within(screen.getByLabelText('科目')).queryByRole('option', { name: '國文' })).toBeNull()
      fireEvent.change(screen.getByLabelText('學制'), { target: { value: 'senior-unit' } })
      expect(within(screen.getByLabelText('科目')).getByRole('option', { name: '國文' })).toBeTruthy()
    }
    const saved = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV7
    expect(saved.recurringLessons).toEqual(data.recurringLessons)
    expect(saved.oneOffLessons).toEqual(data.oneOffLessons)
  })

  it('never reports success without persistence evidence or when the persisted subject differs', () => {
    const data = fixture()
    const setData = vi.fn()
    const view = render(<CourseResourceManager data={data} setData={setData} mode="subjects" />)
    expect((within(row()).getByRole('button', { name: '解除國中部適用' }) as HTMLButtonElement).disabled).toBe(true)
    view.rerender(<CourseResourceManager data={data} setData={setData} mode="subjects" storagePersistence={{ pending: false, revision: 0 }} />)
    remove()
    const next = setData.mock.calls[0][0](data) as AppDataV4
    view.rerender(<CourseResourceManager data={next} setData={setData} mode="subjects" storagePersistence={{ pending: false, revision: 0 }} />)
    expect(success()).toBeNull()
    const different = { ...next, subjects: next.subjects.map((subject, index) => index === 0
      ? { ...subject, applicableSchoolLevels: ['other'] as SchoolLevel[] } : subject) }
    view.rerender(<CourseResourceManager data={different} setData={setData} mode="subjects" storagePersistence={{ pending: false, revision: 1 }} />)
    expect(screen.getByRole('alert').textContent).toContain('無法確認解除結果')
    expect(success()).toBeNull()
  })
})

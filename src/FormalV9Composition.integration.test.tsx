// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormalV9Composition } from './FormalV9Composition'
import { FormalAppEntry } from './DevAppEntry'
import { bootstrapEmptyV8 } from './data/bootstrapV8'
import { fingerprintV7Raw } from './data/activationV8'
import { activateTimetableSubjectsV9 } from './data/activateSubjectV9'
import { APP_DATA_V8_KEY, createEmptyAppDataV8 } from './data/storageV8'
import { APP_DATA_V7_KEY } from './data/storageV7'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_AUTO_BACKUP_PREFIX,
  loadAppDataV9, persistAppDataV9 } from './data/storageV9'
import { createBlankProjectV9, createTeacherTimetableV9, createTeacherSubjectV9,
  configureTeacherSubjectV9, createTeachingUnitV9, switchActiveProjectV9 } from './data/teacherSubjectsV9'
import { createDefaultPeriods } from './data/academicSettingsV4'
import { createClassV9, createEmptyProjectV9, createSchoolV9 } from './data/managementV9'
import { inspectFormalRuntime } from './formalRuntime'
import { useAppDataV4 } from './hooks/useAppDataV4'
import { startOfWeek, toDateKey } from './lib/date'
import type { AppDataV9 } from './types/v9'

vi.mock('./hooks/useAppDataV4', async (original) => ({
  ...await original<typeof import('./hooks/useAppDataV4')>(),
  useAppDataV4: vi.fn(() => { throw new Error('V7 Host must never mount in V9 composition') }),
}))

const empty = (): AppDataV9 => ({ ...createEmptyAppDataV8(), schemaVersion: 9, subjects: [] })
const stored = (): AppDataV9 => JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!)
const revision = () => JSON.parse(localStorage.getItem(V9_ACTIVATION_KEY)!).documentRevision as number
const locks = { request: async (_name: string, _options: unknown, operation: (lock: unknown) => Promise<unknown>) => operation({}) }

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

async function activate(document = empty()) {
  const bootstrap = await bootstrapEmptyV8(localStorage, { attemptId: 'composition-source' })
  if (!bootstrap.ok) throw new Error(bootstrap.code)
  const rawV8 = localStorage.getItem(APP_DATA_V8_KEY)!
  const activation = await activateTimetableSubjectsV9(localStorage, { attemptId: 'composition-v9',
    createdAt: new Date().toISOString(), expectedV8Raw: rawV8, candidate: empty(), decisions: [],
    confirmedExternalV8Digest: await fingerprintV7Raw(rawV8), userConfirmedExternalBackup: true })
  if (!activation.ok) throw new Error(activation.code)
  if (document.projects.length) await persistAppDataV9(localStorage, empty(), document,
    { raw: activation.rawDocument, metadataRaw: localStorage.getItem(V9_ACTIVATION_KEY)!, revision: 0 })
  return rawV8
}

function fixture() {
  let serial = 0
  const id = () => `fixture-${++serial}`
  const input = (name: string) => ({ name, academicYear: 115, semester: 'first' as const,
    startDate: '2026-08-01', endDate: '2027-01-31' })
  let data = createBlankProjectV9(empty(), input('甲專案'), id)
  const projectA = data.activeProjectId!
  const seniorA = data.teachingUnits[0]
  data = createTeachingUnitV9(data, projectA, { schoolId: seniorA.schoolId, name: '國中部', schoolLevel: 'junior-high',
    startDate: seniorA.startDate, endDate: seniorA.endDate, periods: seniorA.periods, weekCycle: seniorA.weekCycle }, 'junior-a')
  data = createTeacherTimetableV9(data, projectA, { name: '甲課表', teacherName: '甲老師' }, 'teacher-a')
  data = createTeacherTimetableV9(data, projectA, { name: '乙課表', teacherName: '乙老師' }, 'teacher-b')
  data = createBlankProjectV9(data, input('乙專案'), id)
  const projectB = data.activeProjectId!
  const seniorB = data.teachingUnits.find((item) => item.projectId === projectB)!
  data = createTeacherTimetableV9(data, projectB, { name: '丙課表', teacherName: '丙老師' }, 'teacher-c')
  for (const [projectId, timetableId, name, unit] of [
    [projectA, 'teacher-a', '甲專用', seniorA.id], [projectA, 'teacher-b', '乙專用', seniorA.id],
    [projectB, 'teacher-c', '丙專用', seniorB.id],
  ]) {
    const subjectId = id()
    data = createTeacherSubjectV9(data, projectId, timetableId, { name, shortName: name.slice(0, 1),
      color: '#647C88', applicableSchoolLevels: ['senior-high', 'junior-high'] }, subjectId)
    data = configureTeacherSubjectV9(data, projectId, timetableId, unit, subjectId, id())
  }
  data = createClassV9(data, projectA, { teachingUnitId: seniorA.id, name: '甲班' }, id())
  data = createClassV9(data, projectA, { teachingUnitId: 'junior-a', grade: 7, classNumber: 1 }, id())
  data = createClassV9(data, projectB, { teachingUnitId: seniorB.id, name: '丙班' }, id())
  return { data: switchActiveProjectV9(data, projectA), projectA, projectB, seniorA, seniorB }
}

function readableFixture() {
  const result = fixture()
  let data = structuredClone(result.data)
  const monday = startOfWeek(new Date())
  const mondayKey = toDateKey(monday)
  data.teachingUnits = data.teachingUnits.map((unit) => ({ ...unit, startDate: '2020-01-01', endDate: '2035-12-31',
    weekCycle: { enabled: true, anchorDate: mondayKey,
      anchorPattern: unit.id === 'junior-a' ? 'B' as const : 'A' as const } }))
  const subjectA = data.subjects.find((item) => item.projectId === result.projectA && item.timetableId === 'teacher-a')!
  data = configureTeacherSubjectV9(data, result.projectA, 'teacher-a', 'junior-a', subjectA.id, 'read-junior-link')
  const classA = data.classes.find((item) => item.projectId === result.projectA
    && item.teachingUnitId === result.seniorA.id)!
  const classJunior = data.classes.find((item) => item.projectId === result.projectA
    && item.teachingUnitId === 'junior-a')!
  const subjectB = data.subjects.find((item) => item.projectId === result.projectA && item.timetableId === 'teacher-b')!
  const classB = data.classes.find((item) => item.projectId === result.projectB)!
  const subjectC = data.subjects.find((item) => item.projectId === result.projectB && item.timetableId === 'teacher-c')!
  data.recurringLessons.push(
    { id: 'read-a-senior', seriesId: 'read-a-senior', projectId: result.projectA, timetableId: 'teacher-a',
      teachingUnitId: result.seniorA.id, subjectId: subjectA.id, classId: classA.id, day: 1,
      periodId: result.seniorA.periods[0].id, weekPattern: 'every', effectiveStart: '2020-01-01' },
    { id: 'read-a-junior', seriesId: 'read-a-junior', projectId: result.projectA, timetableId: 'teacher-a',
      teachingUnitId: 'junior-a', subjectId: subjectA.id, classId: classJunior.id, day: 1,
      periodId: data.teachingUnits.find((item) => item.id === 'junior-a')!.periods[0].id,
      weekPattern: 'every', effectiveStart: '2020-01-01' },
    { id: 'read-b', seriesId: 'read-b', projectId: result.projectA, timetableId: 'teacher-b',
      teachingUnitId: result.seniorA.id, subjectId: subjectB.id, classId: classA.id, day: 1,
      periodId: result.seniorA.periods[0].id, weekPattern: 'every', effectiveStart: '2020-01-01' },
    { id: 'read-c', seriesId: 'read-c', projectId: result.projectB, timetableId: 'teacher-c',
      teachingUnitId: result.seniorB.id, subjectId: subjectC.id, classId: classB.id, day: 1,
      periodId: result.seniorB.periods[0].id, weekPattern: 'every', effectiveStart: '2020-01-01' },
  )
  data.events.push(
    { id: 'visible-meeting', projectId: result.projectA, timetableId: 'teacher-a', teachingUnitId: result.seniorA.id, ownershipStatus: 'resolved',
      title: '目前教師會議', type: 'meeting', date: mondayKey, startTime: '12:00', endTime: '13:00', color: '#A66D52' },
    { id: 'visible-activity', projectId: result.projectA, timetableId: 'teacher-a', teachingUnitId: 'junior-a', ownershipStatus: 'resolved',
      title: '目前教師活動', type: 'activity', date: mondayKey, startTime: '13:00', endTime: '14:00', color: '#A66D52' },
    { id: 'other-teacher', projectId: result.projectA, timetableId: 'teacher-b', teachingUnitId: result.seniorA.id, ownershipStatus: 'resolved',
      title: '其他教師會議', type: 'meeting', date: mondayKey, startTime: '14:00', endTime: '15:00', color: '#A66D52' },
    { id: 'other-project', projectId: result.projectB, timetableId: 'teacher-c', teachingUnitId: result.seniorB.id, ownershipStatus: 'resolved',
      title: '其他專案會議', type: 'meeting', date: mondayKey, startTime: '15:00', endTime: '16:00', color: '#A66D52' },
    { id: 'task', projectId: result.projectA, timetableId: 'teacher-a', teachingUnitId: result.seniorA.id, ownershipStatus: 'resolved',
      title: '不顯示待辦', type: 'task', date: mondayKey, startTime: '16:00', endTime: '17:00', color: '#A66D52' },
    { id: 'unresolved', projectId: null, ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'unassigned-project', candidateTimetableIds: [] }, title: '未解析事件',
      type: 'meeting', date: mondayKey, startTime: '17:00', endTime: '18:00', color: '#A66D52' },
  )
  return { ...result, data }
}

async function mount() {
  const view = render(<FormalV9Composition />)
  await waitFor(() => expect(screen.getByText('已儲存至此裝置')).toBeTruthy())
  return view
}
function add(label: string) {
  fireEvent.click(screen.getByRole('button', { name: '新增' }))
  fireEvent.click(screen.getByRole('menuitem', { name: label }))
}
function openResource(mode: 'subjects' | 'classes') {
  const trigger = screen.getByRole('button', { name: mode === 'subjects' ? /管理科目，/ : /管理班級，/ })
  trigger.focus()
  fireEvent.click(trigger)
  return trigger
}
function closeDialog() { fireEvent.click(screen.getByRole('button', { name: '關閉對話框' })) }
function chooseTeacher(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name: '切換課表' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name }))
}
function autoBackupKeys() {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!)
    .filter((key) => key.startsWith(V9_AUTO_BACKUP_PREFIX))
}
function chooseLessonSubject(name: RegExp) {
  fireEvent.focus(screen.getByRole('combobox', { name: '課程科目' }))
  fireEvent.click(screen.getByRole('option', { name }))
}
function openAcademicSettings() {
  fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
  fireEvent.click(screen.getByRole('button', { name: /學校與學制管理/ }))
  fireEvent.click(screen.getByRole('button', { name: /學校與學制建立或修改/ }))
}
function unsetAcademicFixture(withTimetable = false) {
  let data = createEmptyProjectV9(empty(), { name: '空白專案' }, 'blank')
  data = createSchoolV9(data, 'blank', { name: '正式高中', color: '#718B6C' }, 'formal-school')
  data = createTeachingUnitV9(data, 'blank', { schoolId: 'formal-school', name: '高中部',
    schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31',
    periods: createDefaultPeriods('senior-high'),
    weekCycle: { enabled: true, anchorDate: '2027-08-01', anchorPattern: 'A' } }, 'formal-unit')
  return withTimetable ? createTeacherTimetableV9(data, 'blank',
    { name: '正式課表', teacherName: '正式老師' }, 'formal-timetable') : data
}

describe('formal V9 management composition', () => {
  it('mounts the real V9 tree from the formal entry and creates only a named Project', async () => {
    const rawV8 = await activate()
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const entry = render(<FormalAppEntry />)
    await waitFor(() => expect(screen.getByText('已儲存至此裝置')).toBeTruthy())
    expect(screen.getByRole('heading', { name: '建立你的第一份課表' })).toBeTruthy()
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-is-collapsed')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '展開側邊欄' }))
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-is-collapsed')).toBe(false)
    expect((screen.getByRole('button', { name: '總覽' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '我的課表' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '會議與活動' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '手機導覽：總覽' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '手機導覽：我的課表' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '手機導覽：會議與活動' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '查看範例' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '建立第一個課表專案' }))
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.queryByLabelText('學年度')).toBeNull()
    expect(screen.queryByLabelText('起始日')).toBeNull()
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '名稱專案' } })
    fireEvent.click(screen.getByRole('button', { name: '建立並開始' }))
    await waitFor(() => expect(stored().projects).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '建立你的第一份課表' })).toBeNull())
    await waitFor(() => expect(screen.getByRole('dialog', { name: '專案設定' })).toBeTruthy())
    expect(revision()).toBe(1)
    expect(screen.getByLabelText('學年度')).toBeTruthy()
    expect(screen.queryByLabelText('專案名稱')).toBeNull()
    expect(screen.queryByLabelText('起始日')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { name: '本週行事曆' })).toBeTruthy()
    expect(screen.getByText('尚未設定學期')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    expect(screen.getByRole('heading', { name: '跨校週課表' })).toBeTruthy()
    expect(screen.getByText('尚未設定學期')).toBeTruthy()
    expect((screen.getByRole('button', { name: '會議與活動' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '總覽' }))
    expect(screen.getByRole('heading', { name: '本週行事曆' })).toBeTruthy()
    expect(stored().projects[0]).toMatchObject({ name: '名稱專案', term: null })
    for (const key of ['schools', 'teachingUnits', 'timetables', 'subjects', 'classes',
      'recurringLessons', 'oneOffLessons', 'overrides', 'events', 'teachingProgress'] as const) expect(stored()[key]).toEqual([])
    expect(new Set(writes.mock.calls.map(([key]) => key))).toEqual(new Set([APP_DATA_V9_KEY, V9_ACTIVATION_KEY]))
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBeNull()
    expect(useAppDataV4).not.toHaveBeenCalled()
    expect(await inspectFormalRuntime(localStorage)).toEqual({ runtime: 'v9', v9Status: 'active' })
    entry.unmount()
  })

  it('keeps the name draft and does not open term settings when the Host rejects creation', async () => {
    await activate()
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '建立第一個課表專案' }))
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '未儲存專案' } })
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V9_KEY) throw new Error('Host rejected write')
      return originalSetItem.call(this, key, value)
    })
    fireEvent.click(screen.getByRole('button', { name: '建立並開始' }))
    await waitFor(() => expect(screen.getByText(/專案尚未確認儲存/)).toBeTruthy())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getByLabelText('專案名稱') as HTMLInputElement).value).toBe('未儲存專案')
    expect(stored().projects).toEqual([])
  })

  it('reuses the name-only Project modal with draft protection, focus return and receipt-based selection', async () => {
    await activate(fixture().data)
    await mount()
    add('新增專案')
    const dialog = screen.getByRole('dialog', { name: '專案設定' })
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '新空白' } })
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    closeDialog()
    expect((screen.getByLabelText('專案名稱') as HTMLInputElement).value).toBe('新空白')
    fireEvent.click(screen.getByRole('button', { name: '建立並切換' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '儲存學期' })).toBeTruthy())
    expect(stored().projects.at(-1)).toMatchObject({ name: '新空白', term: null })
    expect((screen.getByRole('button', { name: '切換專案' }) as HTMLButtonElement).disabled).toBe(true)
    closeDialog()
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '新增' })))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '切換專案' }))
    expect(screen.getByRole('menuitemradio', { name: /新空白/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '切換專案' }))
    fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
    fireEvent.click(screen.getByRole('button', { name: /學期設定/ }))
    expect(screen.getByLabelText('學年度')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('configures a standard term through the V9 receipt without changing other resources', async () => {
    const initial = unsetAcademicFixture(true)
    await activate(initial)
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
    fireEvent.click(screen.getByRole('button', { name: /學期設定/ }))
    expect(screen.queryByLabelText('專案名稱')).toBeNull()
    expect(screen.queryByLabelText('起始日')).toBeNull()
    const before = stored()
    const startRevision = revision()
    fireEvent.change(screen.getByLabelText('學年度'), { target: { value: '116' } })
    fireEvent.change(screen.getByLabelText('學期'), { target: { value: 'second' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存學期' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().projects.find((item) => item.id === 'blank')?.term).toEqual({ academicYear: 116, semester: 'second' })
    expect(revision()).toBe(startRevision + 1)
    for (const key of ['schools', 'teachingUnits', 'timetables', 'subjects', 'teachingUnitSubjects',
      'classes', 'recurringLessons', 'oneOffLessons', 'overrides', 'events', 'teachingProgress'] as const) {
      expect(stored()[key], key).toEqual(before[key])
    }
    fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
    expect(screen.queryByRole('button', { name: /學期設定/ })).toBeNull()
  })

  it('stores a custom term name through the existing settings modal', async () => {
    await activate(createEmptyProjectV9(empty(), { name: '空白專案' }, 'blank'))
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
    fireEvent.click(screen.getByRole('button', { name: /學期設定/ }))
    fireEvent.change(screen.getByLabelText('學期'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('自訂學期名稱'), { target: { value: '特別學期' } })
    fireEvent.change(screen.getByLabelText('學年度'), { target: { value: '117' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存學期' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().projects[0].term).toEqual({ academicYear: 117, semester: 'custom', customLabel: '特別學期' })
  })

  it('keeps the term draft open when the Host rejects the term write', async () => {
    await activate(createEmptyProjectV9(empty(), { name: '空白專案' }, 'blank'))
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
    fireEvent.click(screen.getByRole('button', { name: /學期設定/ }))
    fireEvent.change(screen.getByLabelText('學年度'), { target: { value: '118' } })
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V9_KEY) throw new Error('Host rejected write')
      return originalSetItem.call(this, key, value)
    })
    fireEvent.click(screen.getByRole('button', { name: '儲存學期' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('學期尚未確認儲存'))
    expect((screen.getByLabelText('學年度') as HTMLInputElement).value).toBe('118')
    expect(stored().projects[0].term).toBeNull()
    expect(screen.getByRole('dialog', { name: '專案設定' })).toBeTruthy()
  })

  it('reuses the formal school/level forms to create null-term V9 settings', async () => {
    await activate(createEmptyProjectV9(empty(), { name: '空白專案' }, 'blank'))
    await mount()
    openAcademicSettings()

    expect((screen.getByLabelText('新學校學制起始日') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('新學校學制結束日') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('新學校名稱'), { target: { value: '正式高中' } })
    fireEvent.change(screen.getByLabelText('新學校學制起始日'), { target: { value: '2027-08-01' } })
    fireEvent.change(screen.getByLabelText('新學校學制結束日'), { target: { value: '2028-01-31' } })
    fireEvent.click(screen.getByRole('button', { name: '建立學校與學制' }))
    await waitFor(() => expect(stored().teachingUnits).toHaveLength(1))
    const unit = stored().teachingUnits[0]
    expect(stored().projects[0].term).toBeNull()
    expect(stored().schools[0]).toMatchObject({ projectId: 'blank', name: '正式高中' })
    expect(unit).toMatchObject({ projectId: 'blank', schoolId: stored().schools[0].id,
      name: '高中部', startDate: '2027-08-01', endDate: '2028-01-31' })
    expect((screen.getByRole('button', { name: '刪除' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '刪除學制' }) as HTMLButtonElement).disabled).toBe(true)
    expect(useAppDataV4).not.toHaveBeenCalled()
  })

  it('edits School and TeachingUnit through receipt-confirmed formal callbacks', async () => {
    await activate(unsetAcademicFixture())
    await mount()
    openAcademicSettings()
    await waitFor(() => expect(screen.getByLabelText('正式高中學校名稱').matches(':disabled')).toBe(false))
    const schoolName = screen.getByLabelText('正式高中學校名稱')
    fireEvent.change(schoolName, { target: { value: '正式高中更新' } })
    expect((schoolName as HTMLInputElement).value).toBe('正式高中更新')
    const editRevision = revision()
    fireEvent.click(screen.getByRole('button', { name: '儲存學校' }))
    await waitFor(() => expect(stored().schools[0].name).toBe('正式高中更新'))
    expect(revision()).toBe(editRevision + 1)
    fireEvent.change(screen.getByLabelText('formal-unit結束日'), { target: { value: '2028-02-15' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存學制設定' }))
    await waitFor(() => expect(stored().teachingUnits[0].endDate).toBe('2028-02-15'))
  })

  it('feeds the new Project TeachingUnit to both Subject and Class adapters', async () => {
    await activate(unsetAcademicFixture(true))
    await mount()
    openResource('subjects')
    expect([...screen.getByLabelText<HTMLSelectElement>('目前學制').options].map((item) => item.value))
      .toEqual(['formal-unit'])
    closeDialog()
    openResource('classes')
    expect([...screen.getByLabelText<HTMLSelectElement>('目前學制').options].map((item) => item.value))
      .toEqual(['formal-unit'])
    expect(useAppDataV4).not.toHaveBeenCalled()
  })

  it('isolates teacher Subjects and Project/unit Classes while keeping all selection local', async () => {
    const f = fixture()
    await activate(f.data)
    await mount()
    const raw = localStorage.getItem(APP_DATA_V9_KEY)
    fireEvent.click(screen.getByRole('button', { name: '展開側邊欄' }))
    expect(document.querySelector('.sidebar')?.classList.contains('sidebar-collapsed')).toBe(false)
    const subjectTrigger = openResource('subjects')
    expect(screen.getByRole('button', { name: '編輯科目 甲專用' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '編輯科目 乙專用' })).toBeNull()
    expect((screen.getByRole('button', { name: '切換專案' }) as HTMLButtonElement).disabled).toBe(true)
    closeDialog()
    expect(document.activeElement).toBe(subjectTrigger)
    openResource('classes')
    expect(screen.getByRole('button', { name: '編輯班級 甲班' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '編輯班級 丙班' })).toBeNull()
    fireEvent.change(screen.getByLabelText('目前學制'), { target: { value: 'junior-a' } })
    expect(screen.getByRole('button', { name: '編輯班級 701' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '編輯班級 甲班' })).toBeNull()
    closeDialog()
    chooseTeacher(/乙課表/)
    openResource('subjects')
    fireEvent.change(screen.getByLabelText('目前學制'), { target: { value: f.seniorA.id } })
    expect(screen.getByRole('button', { name: '編輯科目 乙專用' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '編輯科目 甲專用' })).toBeNull()
    fireEvent.change(screen.getByLabelText('目前學制'), { target: { value: 'junior-a' } })
    closeDialog()
    openResource('classes')
    expect(screen.getByRole('button', { name: '編輯班級 701' })).toBeTruthy()
    closeDialog()
    fireEvent.click(screen.getByRole('button', { name: '切換專案' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /乙專案/ }))
    fireEvent.click(screen.getByRole('button', { name: '切換課表' }))
    expect(screen.queryByRole('menuitemradio', { name: /甲課表|乙課表/ })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: /丙課表/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(document, { key: 'Escape' })
    openResource('subjects')
    expect(screen.getByRole('button', { name: '編輯科目 丙專用' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '編輯科目 甲專用' })).toBeNull()
    expect([...screen.getByLabelText<HTMLSelectElement>('目前學制').options].map((item) => item.value)).toEqual([f.seniorB.id])
    closeDialog()
    openResource('classes')
    expect(screen.getByRole('button', { name: '編輯班級 丙班' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '編輯班級 甲班' })).toBeNull()
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(raw)
  })

  it('wires resolved Calendar and Schedule reads without leaking another teacher, Project, or unresolved event', async () => {
    const f = readableFixture()
    await activate(f.data)
    await mount()
    const raw = localStorage.getItem(APP_DATA_V9_KEY)

    expect(screen.getAllByText('甲專用').length).toBeGreaterThan(0)
    expect(screen.getByText('目前教師會議')).toBeTruthy()
    expect(screen.getByText('目前教師活動')).toBeTruthy()
    expect(screen.queryByText('其他教師會議')).toBeNull()
    expect(screen.queryByText('其他專案會議')).toBeNull()
    expect(screen.queryByText('未解析事件')).toBeNull()
    expect(screen.queryByText('不顯示待辦')).toBeNull()
    expect(screen.getAllByRole('button', { name: /編輯.*甲專用/ })).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    expect(screen.getAllByText('甲專用')).toHaveLength(2)
    expect(screen.queryByText('A 週')).toBeNull()
    expect(screen.queryByText('B 週')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: '各校課表' }))
    expect(screen.queryByText('A 週')).toBeNull()
    fireEvent.change(screen.getByLabelText('篩選學制'), { target: { value: f.seniorA.id } })
    expect(screen.getByText('A 週')).toBeTruthy()
    expect(screen.getAllByText('甲專用')).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: '總課表' }))
    expect(screen.queryByText('A 週')).toBeNull()
    expect(screen.getAllByText('甲專用')).toHaveLength(2)

    chooseTeacher(/乙課表/)
    expect(screen.getByText('乙專用')).toBeTruthy()
    expect(screen.queryByText('甲專用')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '切換專案' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /乙專案/ }))
    expect(screen.getByText('丙專用')).toBeTruthy()
    expect(screen.queryByText('乙專用')).toBeNull()
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(raw)
    expect(useAppDataV4).not.toHaveBeenCalled()
  })

  it('creates, edits, and high-risk deletes a fixed lesson only after V9 Host receipts', async () => {
    const f = fixture()
    await activate(f.data)
    await mount()
    const originalV7 = localStorage.getItem(APP_DATA_V7_KEY)
    const otherTeacherSubjects = stored().subjects.filter((item) => item.timetableId === 'teacher-b')

    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    expect((screen.getByRole('button', { name: /新增單日課程/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /新增固定課程/ }))
    expect(screen.queryByRole('navigation', { name: '課程編輯範圍' })).toBeNull()
    chooseLessonSubject(/甲專用/)
    fireEvent.change(screen.getByPlaceholderText('依班級預設'), { target: { value: 'V9-101' } })
    const createRevision = revision()
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新增固定課程' })).toBeNull())
    expect(stored().recurringLessons).toHaveLength(1)
    expect(stored().recurringLessons[0]).toMatchObject({ projectId: f.projectA, timetableId: 'teacher-a',
      teachingUnitId: f.seniorA.id, room: 'V9-101' })
    expect(revision()).toBe(createRevision + 1)

    fireEvent.click(screen.getByRole('button', { name: /編輯 甲專用・甲班/ }))
    expect(screen.queryByRole('navigation', { name: '課程編輯範圍' })).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('依班級預設'), { target: { value: 'V9-202' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '編輯課程' })).toBeNull())
    expect(stored().recurringLessons[0].room).toBe('V9-202')
    expect(autoBackupKeys()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: /編輯 甲專用・甲班/ }))
    const beforeDeleteRaw = localStorage.getItem(APP_DATA_V9_KEY)
    fireEvent.click(screen.getByRole('button', { name: '刪除固定課程' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '編輯課程' })).toBeNull())
    expect(stored().recurringLessons).toEqual([])
    const backups = autoBackupKeys()
    expect(backups).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(backups[0])!)).toMatchObject({ operation: 'delete-recurring-lesson',
      rawDocument: beforeDeleteRaw })
    expect(stored().subjects.filter((item) => item.timetableId === 'teacher-b')).toEqual(otherTeacherSubjects)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(originalV7)
    expect(useAppDataV4).not.toHaveBeenCalled()
  })

  it('keeps a fixed-lesson draft open when an external V9 revision makes the editor stale', async () => {
    const f = readableFixture()
    await activate(f.data)
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '編輯 甲專用・甲班' }))
    fireEvent.change(screen.getByPlaceholderText('依班級預設'), { target: { value: '保留的舊草稿' } })
    const loaded = loadAppDataV9(localStorage)
    const external = { ...loaded.document!, projects: loaded.document!.projects.map((item) =>
      item.id === f.projectA ? { ...item, name: '外部更新專案' } : item) }
    const confirmed = await persistAppDataV9(localStorage, loaded.document!, external,
      { raw: loaded.rawDocument!, metadataRaw: loaded.rawMetadata!, revision: loaded.metadata!.documentRevision })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('草稿已保留'))
    expect(screen.getByRole('dialog', { name: '編輯課程' })).toBeTruthy()
    expect((screen.getByPlaceholderText('依班級預設') as HTMLInputElement).value).toBe('保留的舊草稿')
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(confirmed.raw)
    expect(autoBackupKeys()).toEqual([])
  })

  it('does not create a backup when references block deletion and fails closed when backup persistence fails', async () => {
    const referenced = readableFixture()
    referenced.data.teachingProgress.push({ id: '00000000-0000-4000-8000-000000000001', projectId: referenced.projectA,
      timetableId: 'teacher-a', teachingUnitId: referenced.seniorA.id,
      classId: referenced.data.recurringLessons[0].classId, subjectId: referenced.data.recurringLessons[0].subjectId,
      content: { chapter: '', unit: '', note: '引用固定課程' }, previousProgress: null,
      createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' })
    await activate(referenced.data)
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '編輯 甲專用・甲班' }))
    fireEvent.click(screen.getByRole('button', { name: '刪除固定課程' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(autoBackupKeys()).toEqual([])
    expect(stored().recurringLessons.some((item) => item.id === 'read-a-senior')).toBe(true)

    cleanup()
    localStorage.clear()
    const unreferenced = readableFixture()
    await activate(unreferenced.data)
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '編輯 甲專用・甲班' }))
    fireEvent.change(screen.getByPlaceholderText('依班級預設'), { target: { value: '備份失敗時保留' } })
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith(V9_AUTO_BACKUP_PREFIX)) throw new Error('backup quota')
      return originalSetItem.call(this, key, value)
    })
    fireEvent.click(screen.getByRole('button', { name: '刪除固定課程' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.getByRole('dialog', { name: '編輯課程' })).toBeTruthy()
    expect((screen.getByPlaceholderText('依班級預設') as HTMLInputElement).value).toBe('備份失敗時保留')
    expect(stored().recurringLessons.some((item) => item.id === 'read-a-senior')).toBe(true)
    expect(autoBackupKeys()).toEqual([])
  })

  it('persists custom Subjects without configuration through the single V9 Host', async () => {
    const f = fixture()
    const rawV8 = await activate(f.data)
    await mount()
    const start = revision()
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    openResource('subjects')
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增科目' }))
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '專題研究' } })
    fireEvent.change(screen.getByLabelText('新科目簡稱'), { target: { value: '專題' } })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))
    await waitFor(() => expect(screen.getByText('已儲存：已新增科目。')).toBeTruthy())
    const custom = stored().subjects.find((item) => item.name === '專題研究')!
    expect(custom).toMatchObject({ projectId: f.projectA, timetableId: 'teacher-a' })
    expect(stored().teachingUnitSubjects.some((item) => item.subjectId === custom.id)).toBe(false)
    expect(revision()).toBe(start + 1)
    expect(writes.mock.calls).toHaveLength(2)
    expect(new Set(writes.mock.calls.map(([key]) => key))).toEqual(new Set([APP_DATA_V9_KEY, V9_ACTIVATION_KEY]))
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBeNull()
    expect(useAppDataV4).not.toHaveBeenCalled()
  })

  it('configures catalog Subjects and lets chip removal unlink only the current unit', async () => {
    const f = fixture()
    await activate(f.data)
    await mount()
    const start = revision()
    openResource('subjects')
    fireEvent.click(screen.getByRole('button', { name: '加入預設科目 數學' }))
    await waitFor(() => expect(screen.getByText('已儲存：已加入預設科目。')).toBeTruthy())
    const math = stored().subjects.find((item) => item.name === '數學')!
    expect(stored().teachingUnitSubjects).toContainEqual(expect.objectContaining({ subjectId: math.id, teachingUnitId: f.seniorA.id }))
    fireEvent.click(screen.getByRole('button', { name: '解除科目「數學」的目前任教單位配置' }))
    await waitFor(() => expect(stored().teachingUnitSubjects.some((item) => item.subjectId === math.id)).toBe(false))
    expect(stored().subjects.some((item) => item.id === math.id)).toBe(true)
    expect(screen.getByRole('button', { name: '加入預設科目 數學' }).textContent).toBe('＋')
    expect(revision()).toBe(start + 2)
  })

  it('persists Classes via V9 while retaining the consecutive-create form', async () => {
    const f = fixture()
    const rawV8 = await activate(f.data)
    await mount()
    const start = revision()
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    openResource('classes')
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級班號'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '新增班級' }))
    await waitFor(() => expect(screen.getByText('已儲存：已新增班級。')).toBeTruthy())
    expect(stored().classes).toContainEqual(expect.objectContaining({ name: '103', projectId: f.projectA, teachingUnitId: f.seniorA.id }))
    expect(screen.getByRole('form', { name: '新增班級表單' })).toBeTruthy()
    expect(revision()).toBe(start + 1)
    expect(writes.mock.calls).toHaveLength(2)
    expect(new Set(writes.mock.calls.map(([key]) => key))).toEqual(new Set([APP_DATA_V9_KEY, V9_ACTIVATION_KEY]))
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBeNull()
    expect(useAppDataV4).not.toHaveBeenCalled()
  })

  it('waits for the real Host receipt, blocks duplicate submissions and preserves a pending modal', async () => {
    await activate(fixture().data)
    await mount()
    openResource('subjects')
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增科目' }))
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '等待科目' } })
    fireEvent.change(screen.getByLabelText('新科目簡稱'), { target: { value: '等' } })
    const raw = localStorage.getItem(APP_DATA_V9_KEY)
    let release: (() => Promise<unknown>) | undefined
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (_name: string, _options: unknown, operation: (lock: unknown) => Promise<unknown>) =>
        new Promise((resolve, reject) => { release = async () => { try { resolve(await operation({})) } catch (error) { reject(error) } } }),
    } })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))
    expect(screen.getByText('正在儲存科目變更，尚未確認 Host receipt…')).toBeTruthy()
    expect(screen.queryByText('已儲存：已新增科目。')).toBeNull()
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(raw)
    fireEvent.submit(screen.getByRole('form', { name: '新增科目表單' }))
    closeDialog()
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    await act(async () => { await release!() })
    await waitFor(() => expect(screen.getByText('已儲存：已新增科目。')).toBeTruthy())
    expect(stored().subjects.filter((item) => item.name === '等待科目')).toHaveLength(1)
  })

  it('keeps drafts on conflict and prevents Subject/Class writes after eligibility is revoked', async () => {
    await activate(fixture().data)
    await mount()
    openResource('subjects')
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增科目' }))
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '保留草稿' } })
    const raw = localStorage.getItem(APP_DATA_V9_KEY)
    fireEvent(window, new StorageEvent('storage', { key: V9_ACTIVATION_KEY }))
    expect((screen.getByRole('button', { name: '新增科目' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('保留草稿')
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(raw)
    expect(screen.queryByText('已儲存：已新增科目。')).toBeNull()
  })

  it('preserves Timetable drafts and external data when the open form has a stale Host snapshot', async () => {
    await activate(fixture().data)
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '舊表單草稿' } })
    const loaded = loadAppDataV9(localStorage)
    const external = { ...loaded.document!, projects: loaded.document!.projects.map((item) => ({ ...item, name: `${item.name}外部更新` })) }
    const confirmed = await persistAppDataV9(localStorage, loaded.document!, external,
      { raw: loaded.rawDocument!, metadataRaw: loaded.rawMetadata!, revision: loaded.metadata!.documentRevision })
    fireEvent.click(screen.getByRole('button', { name: '儲存課表資訊' }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect((screen.getByLabelText('課表名稱') as HTMLInputElement).value).toBe('舊表單草稿')
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(confirmed.raw)
    expect(screen.queryByText('已儲存課表資訊。')).toBeNull()
  })

  it('mounts safely read-only when Web Locks are unavailable', async () => {
    await activate(fixture().data)
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    const raw = localStorage.getItem(APP_DATA_V9_KEY)
    render(<FormalV9Composition />)
    await waitFor(() => expect(screen.getByText('資料目前為唯讀，已暫停寫入')).toBeTruthy())
    expect(screen.queryByRole('button', { name: '新增' })).toBeNull()
    expect((screen.getByRole('button', { name: /管理科目，/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /管理班級，/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(raw)
    expect(useAppDataV4).not.toHaveBeenCalled()
  })

  it('creates and edits an independent teacher Timetable using the existing forms on an unset Project', async () => {
    await activate(createEmptyProjectV9(empty(), { name: '空白專案' }, 'blank'))
    await mount()
    add('新增空白課表')
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '新教師課表' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '新老師' } })
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    closeDialog()
    expect((screen.getByLabelText('課表名稱') as HTMLInputElement).value).toBe('新教師課表')
    fireEvent.click(screen.getByRole('button', { name: '建立並切換' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().timetables).toMatchObject([{ projectId: 'blank', name: '新教師課表', teacherName: '新老師' }])
    expect(stored().teachingUnits).toEqual([])
    expect(stored().subjects).toEqual([])
    expect(stored().projects[0].term).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '已修改課表' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存課表資訊' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().timetables[0].name).toBe('已修改課表')
    expect(screen.getByText('已儲存課表資訊。')).toBeTruthy()
  })

  it('copies only teacher settings and safely deletes the independent copy after its receipt', async () => {
    const f = fixture()
    await activate(f.data)
    await mount()
    const subjects = stored().subjects
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    fireEvent.click(screen.getByRole('button', { name: '只複製課表設定' }))
    fireEvent.click(screen.getByRole('button', { name: '複製設定並切換' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const copy = stored().timetables.find((item) => item.name === '甲課表（副本）')!
    expect(copy.projectId).toBe(f.projectA)
    expect(stored().subjects).toEqual(subjects)
    expect(stored().recurringLessons).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    fireEvent.click(screen.getByRole('button', { name: '刪除課表' }))
    fireEvent.click(screen.getByRole('button', { name: '確認刪除「甲課表（副本）」' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().timetables.some((item) => item.id === copy.id)).toBe(false)
    expect(stored().timetables.some((item) => item.id === 'teacher-a')).toBe(true)
    expect(stored().subjects).toEqual(subjects)
    expect(screen.getByText('已刪除並儲存課表。')).toBeTruthy()
  })

  it('reuses the separate new-term copy form with explicit dates and independent resources', async () => {
    const f = fixture()
    await activate(f.data)
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
    fireEvent.click(screen.getByRole('button', { name: /複製為新學期/ }))
    expect(screen.getByLabelText('來源專案')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '明確新學期' } })
    fireEvent.change(screen.getByLabelText('學年度'), { target: { value: '116' } })
    fireEvent.change(screen.getByLabelText('學期', { exact: true }), { target: { value: 'second' } })
    for (const field of screen.getAllByLabelText('來源有效日期')) fireEvent.change(field, { target: { value: '2026-09-01' } })
    for (const field of screen.getAllByLabelText('新起始日')) fireEvent.change(field, { target: { value: '2027-02-01' } })
    for (const field of screen.getAllByLabelText('新結束日')) fireEvent.change(field, { target: { value: '2027-07-31' } })
    for (const field of screen.getAllByLabelText('A/B anchor')) fireEvent.change(field, { target: { value: '2027-02-01' } })
    fireEvent.click(screen.getByRole('button', { name: /複製並切換/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const copy = stored().projects.find((item) => item.name === '明確新學期')!
    expect(copy.term).toMatchObject({ academicYear: 116, semester: 'second' })
    expect(stored().timetables.filter((item) => item.projectId === copy.id)).toHaveLength(2)
    expect(stored().subjects.filter((item) => item.projectId === f.projectA)).toEqual(f.data.subjects.filter((item) => item.projectId === f.projectA))
    expect(stored().subjects.filter((item) => item.projectId === copy.id).every((item) =>
      !f.data.subjects.some((old) => old.id === item.id))).toBe(true)
    expect(stored().oneOffLessons).toEqual([])
  })

  it('archives and reactivates Projects through the existing settings modal without exposing unsupported history writes', async () => {
    const f = fixture()
    await activate(f.data)
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
    fireEvent.click(screen.getByRole('button', { name: /目前專案名稱/ }))
    expect(screen.queryByRole('button', { name: '重新命名' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '封存' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().projects.find((item) => item.id === f.projectA)?.archivedAt).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
    fireEvent.click(screen.getByRole('button', { name: /歷史與專案管理/ }))
    expect((screen.getByRole('button', { name: '查看' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重新啟用' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().projects.find((item) => item.id === f.projectA)?.archivedAt).toBeUndefined()
    expect(stored().subjects).toEqual(f.data.subjects)
  })

  it('deletes only the selected empty Project after confirmation and receipt', async () => {
    const f = fixture()
    await activate(createEmptyProjectV9(f.data, { name: '可刪空白' }, 'empty-delete'))
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
    fireEvent.click(screen.getByRole('button', { name: /歷史與專案管理/ }))
    const row = screen.getByText('可刪空白', { selector: '.project-history-row strong' }).closest('.project-history-row')!
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: '刪除' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(stored().projects).toEqual(f.data.projects)
    expect(stored().subjects).toEqual(f.data.subjects)
    expect(stored().classes).toEqual(f.data.classes)
  })
})

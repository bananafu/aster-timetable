// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { V8PreviewApp } from '../V8PreviewApp'
import { bootstrapEmptyV8 } from '../data/bootstrapV8'
import { fingerprintV7Raw, V8_BOOTSTRAP_KEY } from '../data/activationV8'
import { activateTimetableSubjectsV9 } from '../data/activateSubjectV9'
import { createBlankProject } from '../data/projectRuntimeV8'
import { APP_DATA_V8_KEY, createEmptyAppDataV8, persistAppDataV8 } from '../data/storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, persistAppDataV9 } from '../data/storageV9'
import { createClassV9 } from '../data/managementV9'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9,
  createTeacherTimetableV9 } from '../data/teacherSubjectsV9'
import { createRecurringLessonV8 } from '../data/recurringLessonsV8'
import { asV8ValidationProjection } from '../data/validators/v9'
import { createTeacherTimetableV8 } from '../data/timetablesV8'
import { createSubject } from '../data/subjectsV8'
import type { AppDataV9 } from '../types/v9'

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(navigator, 'locks', { configurable: true,
    value: { request: (_name: string, _options: unknown, operation: (lock: unknown) => Promise<unknown>) => operation({}) } })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

async function activated() {
  const bootstrap = await bootstrapEmptyV8(localStorage, { attemptId: 'source', createdAt: '2026-10-23T01:00:00.000Z' })
  if (!bootstrap.ok) throw new Error(bootstrap.code)
  const initial = createEmptyAppDataV8()
  let serial = 0
  let source = createBlankProject(initial, { name: 'Project A', academicYear: 115, semester: 'first',
    startDate: '2026-08-01', endDate: '2027-01-31' }, () => `base-${++serial}`)
  source = createTeacherTimetableV8(source, source.activeProjectId!,
    { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  const saved = persistAppDataV8(localStorage, initial, source,
    { raw: bootstrap.receipt.raw, legacyGuardRaw: null, revision: 0 }, 0)
  const metadata = JSON.parse(localStorage.getItem(V8_BOOTSTRAP_KEY)!)
  localStorage.setItem(V8_BOOTSTRAP_KEY, JSON.stringify({ ...metadata,
    currentDigest: await fingerprintV7Raw(saved.raw), documentRevision: saved.revision }))
  const result = await activateTimetableSubjectsV9(localStorage, {
    attemptId: 'upgrade', createdAt: '2026-10-23T02:00:00.000Z', expectedV8Raw: saved.raw,
    candidate: { ...source, schemaVersion: 9 } as AppDataV9, decisions: [],
    confirmedExternalV8Digest: await fingerprintV7Raw(saved.raw),
    userConfirmedExternalBackup: true,
  })
  if (!result.ok) throw new Error(result.code)
  return { sourceRaw: saved.raw, projectId: source.activeProjectId! }
}

function switchPreviewTimetable(id: string) {
  fireEvent.click(screen.getByRole('button', { name: '切換目前教師課表' }))
  const option = screen.getByRole('menu', { name: '教師課表' })
    .querySelector<HTMLButtonElement>(`[data-timetable-id="${id}"]`)
  if (!option) throw new Error(`Missing timetable option: ${id}`)
  fireEvent.click(option)
}

function selectedPreviewTimetableId() {
  fireEvent.click(screen.getByRole('button', { name: '切換目前教師課表' }))
  const id = screen.getByRole('menu', { name: '教師課表' })
    .querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.dataset.timetableId ?? null
  fireEvent.keyDown(document, { key: 'Escape' })
  return id
}

describe('V8 Preview teacher-owned Subject library', () => {
  it('Preview Logo 調整桌面內容欄寬，手機導覽切換頁面不觸發資料寫入', async () => {
    await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    const raw = localStorage.getItem(APP_DATA_V9_KEY)
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-is-collapsed')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '展開側邊欄' }))
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-is-collapsed')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '手機導覽：會議與活動' }))
    expect(screen.getByRole('heading', { level: 1, name: '會議與活動' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '手機導覽：更多' }))
    expect(document.querySelector('.sidebar')?.classList.contains('sidebar-open')).toBe(true)
    expect(screen.getByRole('navigation', { name: '手機底部導覽' }).querySelectorAll('button')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    expect(screen.getByRole('heading', { level: 1, name: '科目與班級' })).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(raw)
  })

  it('keeps date navigation and unavailable add actions local to the shell', async () => {
    await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole('button', { name: '切換專案' }) as HTMLButtonElement).disabled).toBe(false))
    const raw = localStorage.getItem(APP_DATA_V9_KEY)
    const activation = localStorage.getItem(V9_ACTIVATION_KEY)
    const range = document.querySelector('.week-controls strong')?.textContent
    fireEvent.click(screen.getByRole('button', { name: '下一週' }))
    expect(document.querySelector('.week-controls strong')?.textContent).not.toBe(range)
    fireEvent.click(screen.getByRole('button', { name: '上一週' }))
    expect(document.querySelector('.week-controls strong')?.textContent).toBe(range)
    fireEvent.click(screen.getByRole('button', { name: '今天' }))
    fireEvent.click(screen.getByRole('button', { name: '新增' }))
    for (const label of ['新增課程', '新增會議', '新增活動']) {
      expect((screen.getByRole('menuitem', { name: label }) as HTMLButtonElement).disabled).toBe(true)
    }
    expect((screen.getByRole('menuitem', { name: '新增專案' }) as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '新增專案' }))
    expect(screen.queryByRole('button', { name: '搜尋' })).toBeNull()
    expect(screen.queryByRole('button', { name: '通知' })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '新增' }))
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(raw)
    expect(localStorage.getItem(V9_ACTIVATION_KEY)).toBe(activation)
  })

  it('uses the Project popover and separates copy, archive and guarded deletion', async () => {
    await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole('button', { name: '切換專案' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '切換專案' }))
    expect(screen.getByRole('menu', { name: '選擇課表專案' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /Project A/ }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '專案管理' }))
    expect(screen.getByText('複製為新學期')).toBeTruthy()
    expect(screen.getByRole('button', { name: '確認複製新學期' })).toBeTruthy()
    expect(screen.getByText('封存與重新啟用')).toBeTruthy()
    expect(screen.getByRole('button', { name: '永久刪除空白專案' })).toBeTruthy()
  })

  it('requires explicit owner, external export preparation, and source-bound confirmation before migrating a V8 Subject', async () => {
    const bootstrap = await bootstrapEmptyV8(localStorage, { attemptId: 'source', createdAt: '2026-10-23T01:00:00.000Z' })
    if (!bootstrap.ok) throw new Error(bootstrap.code)
    const initial = createEmptyAppDataV8()
    let serial = 0
    let source = createBlankProject(initial, { name: 'A', academicYear: 115, semester: 'first',
      startDate: '2026-08-01', endDate: '2027-01-31' }, () => `base-${++serial}`)
    source = createTeacherTimetableV8(source, source.activeProjectId!,
      { name: '甲課表', teacherName: '甲' }, 'teacher-a')
    source = createSubject(source, source.activeProjectId!, { name: '數學', shortName: '數',
      color: '#123456', applicableSchoolLevels: ['senior-high'] }, 'subject-old')
    const saved = persistAppDataV8(localStorage, initial, source,
      { raw: bootstrap.receipt.raw, legacyGuardRaw: null, revision: 0 }, 0)
    const metadata = JSON.parse(localStorage.getItem(V8_BOOTSTRAP_KEY)!)
    localStorage.setItem(V8_BOOTSTRAP_KEY, JSON.stringify({ ...metadata,
      currentDigest: await fingerprintV7Raw(saved.raw), documentRevision: saved.revision }))
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByText('進階資料管理：原始匯出與教師科目庫轉換'))
    const wizard = screen.getByLabelText('教師獨立科目庫轉換')
    const activateButton = wizard.querySelector('button.primary-button') as HTMLButtonElement
    expect(activateButton.disabled).toBe(true)
    await waitFor(() => expect((screen.getByLabelText('數學 歸屬教師') as HTMLSelectElement).options.length).toBe(2))
    fireEvent.change(screen.getByLabelText('數學 歸屬教師'), { target: { value: 'teacher-a' } })
    expect(activateButton.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '準備並下載原始 V8 JSON' }))
    await waitFor(() => expect(screen.getByText(/已準備外部匯出：sha256:/)).toBeTruthy())
    fireEvent.click(screen.getByRole('checkbox', { name: /我已自行確認此快照/ }))
    await waitFor(() => expect(activateButton.disabled).toBe(false))
    fireEvent.click(activateButton)
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects)
      .toMatchObject([{ id: 'subject-old', timetableId: 'teacher-a' }]))
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(saved.raw)
    vi.unstubAllGlobals()
  })

  it('lets teacher A configure one Subject in both school levels while B starts empty and owns same name independently', async () => {
    const { sourceRaw } = await activated()
    const view = render(<V8PreviewApp onReturn={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '科目與班級' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存科目' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('科目名稱'), { target: { value: '數學' } })
    fireEvent.change(screen.getByLabelText('科目簡稱'), { target: { value: '數' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存科目' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(1))
    const subjectA = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects[0]
    expect(subjectA.timetableId).toBe('teacher-a')
    fireEvent.click(screen.getByRole('button', { name: '關閉對話框' }))
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    fireEvent.click(screen.getByRole('button', { name: '管理教學設定' }))
    fireEvent.click(screen.getByRole('button', { name: '新增任教單位' }))
    fireEvent.change(screen.getByLabelText('任教單位名稱'), { target: { value: '國中部' } })
    fireEvent.change(screen.getByLabelText('學制'), { target: { value: 'junior-high' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存任教單位' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).teachingUnits).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: '關閉對話框' }))
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    const configure = screen.getAllByRole('button', { name: /：配置$/ })
    expect(configure).toHaveLength(2)
    fireEvent.click(configure[0])
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).teachingUnitSubjects).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '國中部：配置' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).teachingUnitSubjects).toHaveLength(2))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects[0].applicableSchoolLevels)
      .toContain('junior-high')
    fireEvent.click(screen.getByRole('button', { name: '關閉對話框' }))
    fireEvent.click(screen.getByRole('button', { name: '教師課表' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '乙課表' } })
    fireEvent.change(screen.getByLabelText('教師名稱'), { target: { value: '乙' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存教師課表' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).timetables).toHaveLength(2))
    const subjectCount = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects.length
    expect(subjectCount).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    const teacherB = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).timetables[1].id
    switchPreviewTimetable(teacherB)
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    expect(screen.getByText('此教師尚無科目；不繼承其他教師的科目。')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('科目名稱'), { target: { value: '數學' } })
    fireEvent.change(screen.getByLabelText('科目簡稱'), { target: { value: '數' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存科目' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(2))
    const now = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!)
    expect(now.subjects[1].timetableId).toBe(teacherB)
    expect(now.subjects[1].id).not.toBe(subjectA.id)
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(sourceRaw)
    view.unmount()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(2)
  })

  it('revokes write eligibility on activation and old-V8 storage events without overwriting either source', async () => {
    const { sourceRaw } = await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存科目' }) as HTMLButtonElement).disabled).toBe(false))
    const originalV9 = localStorage.getItem(APP_DATA_V9_KEY)
    const activation = localStorage.getItem(V9_ACTIVATION_KEY)!
    fireEvent(window, new StorageEvent('storage', { key: V9_ACTIVATION_KEY, oldValue: activation,
      newValue: '{corrupt' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存科目' }) as HTMLButtonElement).disabled).toBe(true))
    expect((screen.getByRole('button', { name: '加入預設科目 數學' }) as HTMLButtonElement).disabled).toBe(true)
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(originalV9)
    fireEvent.click(screen.getByRole('button', { name: '檢查並採用外部版本' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存科目' }) as HTMLButtonElement).disabled).toBe(false))
    localStorage.setItem(APP_DATA_V8_KEY, '{old-tab-write}')
    fireEvent(window, new StorageEvent('storage', { key: APP_DATA_V8_KEY, oldValue: sourceRaw,
      newValue: '{old-tab-write}' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存科目' }) as HTMLButtonElement).disabled).toBe(true))
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe('{old-tab-write}')
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(originalV9)
  })

  it('keeps recovery exports available under advanced controls and supports consecutive Subject creation', async () => {
    await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    expect(screen.getByText('進階資料管理與救援匯出')).toBeTruthy()
    fireEvent.click(screen.getByText('進階資料管理與救援匯出'))
    expect(screen.getByRole('button', { name: '匯出 V8 原始備份' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存科目' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('科目名稱'), { target: { value: '數學' } })
    fireEvent.change(screen.getByLabelText('科目簡稱'), { target: { value: '數' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存科目' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(1))
    expect(screen.getByText('已新增科目，資料已保存。')).toBeTruthy()
    expect((screen.getByLabelText('科目名稱') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('科目名稱'), { target: { value: '英語' } })
    fireEvent.change(screen.getByLabelText('科目簡稱'), { target: { value: '英' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存科目' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(2))
  })

  it('keeps a blank Project empty while filtering and consecutively adding senior-high catalog Subjects', async () => {
    const { projectId } = await activated()
    const originalRaw = localStorage.getItem(APP_DATA_V9_KEY)
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存科目' }) as HTMLButtonElement).disabled).toBe(false))
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(originalRaw)
    expect(JSON.parse(originalRaw!).subjects).toHaveLength(0)
    expect(screen.getByRole('button', { name: '加入預設科目 物理' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加入預設科目 理化' })).toBeNull()
    expect(screen.getByRole('button', { name: '加入預設科目 數學' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '加入預設科目 班會' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '數學科' } })
    const addMath = screen.getByRole('button', { name: '加入預設科目 數學' })
    fireEvent.click(addMath)
    fireEvent.click(addMath)
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(1))
    expect(screen.getByRole('dialog', { name: '教師科目管理' })).toBeTruthy()
    expect(screen.getByText('已加入預設科目「數學」，資料已保存。')).toBeTruthy()
    const first = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!)
    expect(first.subjects[0]).toMatchObject({ projectId, timetableId: 'teacher-a', name: '數學' })
    expect(first.subjects[0].id).not.toBe('core.mathematics')
    expect(first.teachingUnitSubjects).toHaveLength(1)
    expect(first.teachingUnitSubjects[0].subjectId).toBe(first.subjects[0].id)
    expect(screen.queryByRole('button', { name: '加入預設科目 數學' })).toBeNull()
    expect(screen.getByLabelText('目錄科目 數學 狀態').textContent).toBe('已加入')

    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '班級活動' } })
    fireEvent.click(screen.getByRole('button', { name: '加入預設科目 班會' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(2))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).teachingUnitSubjects).toHaveLength(2)
    expect(screen.getByRole('dialog', { name: '教師科目管理' })).toBeTruthy()
  })

  it('filters the same catalog by an explicitly selected junior-high TeachingUnit', async () => {
    await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '管理教學設定' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '管理教學設定' }))
    fireEvent.click(screen.getByRole('button', { name: '新增任教單位' }))
    fireEvent.change(screen.getByLabelText('任教單位名稱'), { target: { value: '國中部' } })
    fireEvent.change(screen.getByLabelText('學制'), { target: { value: 'junior-high' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存任教單位' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).teachingUnits).toHaveLength(2))
    const units = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).teachingUnits
    const juniorUnit = units
      .find((item: { schoolLevel: string }) => item.schoolLevel === 'junior-high')
    const seniorUnit = units.find((item: { schoolLevel: string }) => item.schoolLevel === 'senior-high')
    fireEvent.click(screen.getByRole('button', { name: '關閉對話框' }))
    const beforeBrowse = localStorage.getItem(APP_DATA_V9_KEY)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    expect(screen.getByText('高中部：顯示 28 個目錄科目')).toBeTruthy()
    expect(screen.getByRole('button', { name: '加入預設科目 物理' })).toBeTruthy()
    expect(JSON.parse(beforeBrowse!).subjects).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('目錄任教單位'), { target: { value: juniorUnit.id } })
    expect(screen.getByText('國中部：顯示 25 個目錄科目')).toBeTruthy()
    expect(screen.getByRole('button', { name: '加入預設科目 理化' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加入預設科目 物理' })).toBeNull()
    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '不存在的科目' } })
    expect(screen.getByText('國中部：顯示 0 個目錄科目')).toBeTruthy()
    expect(screen.getByText('此學制沒有符合搜尋條件的目錄科目。')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '' } })
    expect(screen.getByText('國中部：顯示 25 個目錄科目')).toBeTruthy()
    expect(screen.getByRole('button', { name: '加入預設科目 數學' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '社團活動' } })
    expect(screen.getByRole('button', { name: '加入預設科目 社團' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('目錄任教單位'), { target: { value: seniorUnit.id } })
    expect(screen.getByText('高中部：顯示 28 個目錄科目')).toBeTruthy()
    expect(screen.getByRole('button', { name: '加入預設科目 物理' })).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(beforeBrowse)
  })

  it('keeps identical catalog selections isolated between Projects and teacher Timetables', async () => {
    const { projectId } = await activated()
    const originalRaw = localStorage.getItem(APP_DATA_V9_KEY)!
    const current = JSON.parse(originalRaw) as AppDataV9
    let sequence = 0
    let fixture = createBlankProjectV9(current, { name: 'Project B', academicYear: 116,
      semester: 'first', startDate: '2027-08-01', endDate: '2028-01-31' }, () => `scope-${++sequence}`)
    const projectB = fixture.activeProjectId!
    fixture = createTeacherTimetableV9(fixture, projectB, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
    await persistAppDataV9(localStorage, current, fixture,
      { raw: originalRaw, metadataRaw: localStorage.getItem(V9_ACTIVATION_KEY)!, revision: 0 })
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '加入預設科目 數學' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '加入預設科目 數學' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    fireEvent.click(screen.getByRole('button', { name: '切換專案' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Project A/ }))
    await waitFor(() => expect(screen.getByText('Project A・甲／甲課表')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    const mathButton = screen.getByRole('button', { name: '加入預設科目 數學' }) as HTMLButtonElement
    expect(mathButton.disabled).toBe(false)
    fireEvent.click(mathButton)
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(2))
    const subjects = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects
    expect(subjects.map((item: { projectId: string }) => item.projectId).sort()).toEqual([projectId, projectB].sort())
    expect(subjects.map((item: { timetableId: string }) => item.timetableId).sort()).toEqual(['teacher-a', 'teacher-b'])
    expect(new Set(subjects.map((item: { id: string }) => item.id)).size).toBe(2)
  })

  it('does not report catalog success when Host rejects the write', async () => {
    await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    const add = screen.getByRole('button', { name: '加入預設科目 數學' }) as HTMLButtonElement
    await waitFor(() => expect(add.disabled).toBe(false))
    const before = localStorage.getItem(APP_DATA_V9_KEY)
    const metadata = JSON.parse(localStorage.getItem(V9_ACTIVATION_KEY)!)
    localStorage.setItem(V9_ACTIVATION_KEY, JSON.stringify({ ...metadata,
      documentRevision: metadata.documentRevision + 1 }))
    fireEvent.click(add)
    await waitFor(() => expect(screen.getByText(/未確認儲存/)).toBeTruthy())
    expect(screen.queryByText(/已加入預設科目「數學」，資料已保存/)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(before)
    expect(JSON.parse(before!).subjects).toHaveLength(0)
  })

  it('keeps subject edit in a dialog and asks before discarding its draft', async () => {
    await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存科目' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('科目名稱'), { target: { value: '數學' } })
    fireEvent.change(screen.getByLabelText('科目簡稱'), { target: { value: '數' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存科目' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '編輯' }))
    expect(screen.getByRole('dialog', { name: '編輯科目' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('科目名稱'), { target: { value: '數學進階' } })
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '編輯科目' })).toBeTruthy()
    expect((screen.getByLabelText('科目名稱') as HTMLInputElement).value).toBe('數學進階')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '編輯科目' })).toBeNull()
    expect(screen.getByRole('dialog', { name: '教師科目管理' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '編輯' }))
  })

  it('keeps the class creation form below the list for consecutive writes and edits in a dialog', async () => {
    await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理班級' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '新增班級' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '新增班級' }))
    fireEvent.change(screen.getByLabelText('年級'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('班號'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存班級' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).classes).toHaveLength(1))
    expect(screen.getByRole('form', { name: '新版管理表單' })).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存班級' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('年級'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('班號'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存班級' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).classes).toHaveLength(2))
    fireEvent.click(screen.getAllByRole('button', { name: '編輯' })[0])
    expect(screen.getByRole('dialog', { name: '編輯班級' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '編輯班級' })).toBeNull()
  })

  it('shows only the active Project classes in the workspace and manager', async () => {
    const { projectId } = await activated()
    const originalRaw = localStorage.getItem(APP_DATA_V9_KEY)!
    const current = JSON.parse(originalRaw) as AppDataV9
    const withClass = createClassV9(current, projectId,
      { teachingUnitId: current.teachingUnits[0].id, grade: 1, classNumber: 2 }, 'class-a')
    let sequence = 0
    const withB = createBlankProjectV9(withClass, { name: 'Project B', academicYear: 116,
      semester: 'first', startDate: '2027-08-01', endDate: '2028-01-31' }, () => `new-${++sequence}`)
    await persistAppDataV9(localStorage, current, withB,
      { raw: originalRaw, metadataRaw: localStorage.getItem(V9_ACTIVATION_KEY)!, revision: 0 })
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    expect(screen.getByText('Project B・尚未選取教師課表')).toBeTruthy()
    expect(screen.getByText('尚無班級')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '管理班級' }))
    expect(screen.queryByText('102')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).classes).toMatchObject([{ id: 'class-a', projectId }])
  })

  it('keeps a dirty Subject draft when teacher switching is declined and resets it only after confirmation', async () => {
    await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '教師課表' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存教師課表' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '乙課表' } })
    fireEvent.change(screen.getByLabelText('教師名稱'), { target: { value: '乙' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存教師課表' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).timetables).toHaveLength(2))
    const teacherB = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).timetables[1].id
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    fireEvent.change(screen.getByLabelText('科目名稱'), { target: { value: '未儲存科目' } })
    vi.mocked(window.confirm).mockReturnValueOnce(false)
    switchPreviewTimetable(teacherB)
    expect((screen.getByLabelText('科目名稱') as HTMLInputElement).value).toBe('未儲存科目')
    expect(selectedPreviewTimetableId()).toBe('teacher-a')
    switchPreviewTimetable(teacherB)
    expect(screen.queryByRole('dialog', { name: '教師科目管理' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    expect((screen.getByLabelText('科目名稱') as HTMLInputElement).value).toBe('')
    expect(selectedPreviewTimetableId()).toBe(teacherB)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(0)
  })

  it('edits and deletes only the selected teacher Subject through the preview workspace', async () => {
    await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '儲存科目' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('科目名稱'), { target: { value: '數學' } })
    fireEvent.change(screen.getByLabelText('科目簡稱'), { target: { value: '數' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存科目' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(1))
    const subjectId = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects[0].id
    fireEvent.click(screen.getByRole('button', { name: '編輯' }))
    fireEvent.change(screen.getByLabelText('科目名稱'), { target: { value: '數學進階' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存科目' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects[0].name).toBe('數學進階'))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects[0].id).toBe(subjectId)
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).subjects).toHaveLength(0))
    expect(screen.getByText('此教師尚無科目；不繼承其他教師的科目。')).toBeTruthy()
  })

  it('saves School, TeachingUnit time settings and Class through management dialogs', async () => {
    const { sourceRaw } = await activated()
    const view = render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '管理教學設定' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '管理教學設定' }))
    fireEvent.click(screen.getByRole('button', { name: '編輯學校' }))
    fireEvent.change(screen.getByLabelText('學校名稱'), { target: { value: '新學校' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存學校' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).schools[0].name).toBe('新學校'))
    fireEvent.click(screen.getByRole('button', { name: '編輯任教單位' }))
    fireEvent.change(screen.getAllByLabelText('開始時間')[0], { target: { value: '08:15' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存任教單位' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).teachingUnits[0].periods[0].startTime).toBe('08:15'))
    fireEvent.click(screen.getByRole('button', { name: '關閉對話框' }))
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理班級' }))
    fireEvent.click(screen.getByRole('button', { name: '新增班級' }))
    fireEvent.change(screen.getByLabelText('年級'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('班號'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存班級' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).classes[0].name).toBe('102'))
    fireEvent.click(screen.getByRole('button', { name: '編輯' }))
    fireEvent.change(screen.getByLabelText('班號'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存班級' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).classes[0].name).toBe('103'))
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).classes).toHaveLength(0))
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(sourceRaw)
    view.unmount()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '設定' }))
    expect(screen.getByText('新學校')).toBeTruthy()
  })

  it('keeps raw data and revision unchanged when a referenced Class is deleted from the manager', async () => {
    const { projectId } = await activated()
    const currentRaw = localStorage.getItem(APP_DATA_V9_KEY)!
    const current = JSON.parse(currentRaw) as AppDataV9
    const unit = current.teachingUnits[0]
    let fixture = createTeacherSubjectV9(current, projectId, 'teacher-a', {
      name: '數學', shortName: '數', color: '#123456', applicableSchoolLevels: ['senior-high'],
    }, 'subject-fixture')
    fixture = configureTeacherSubjectV9(fixture, projectId, 'teacher-a', unit.id,
      'subject-fixture', 'relation-fixture')
    fixture = createClassV9(fixture, projectId, { teachingUnitId: unit.id, grade: 1, classNumber: 1 }, 'used-class')
    fixture = createClassV9(fixture, projectId, { teachingUnitId: unit.id, grade: 1, classNumber: 2 }, 'free-class')
    fixture = { ...fixture, recurringLessons: createRecurringLessonV8(asV8ValidationProjection(fixture), {
      projectId, timetableId: 'teacher-a', teachingUnitId: unit.id, classId: 'used-class',
      subjectId: 'subject-fixture', day: 1, periodId: unit.periods[0].id, weekPattern: 'every',
    }, 'lesson-fixture').recurringLessons }
    const metadataRaw = localStorage.getItem(V9_ACTIVATION_KEY)!
    const seeded = await persistAppDataV9(localStorage, current, fixture,
      { raw: currentRaw, metadataRaw, revision: 0 })
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    fireEvent.click(screen.getByRole('button', { name: '管理班級' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: '刪除' })).toHaveLength(2))
    await waitFor(() => expect((screen.getAllByRole('button', { name: '刪除' })[0] as HTMLButtonElement).disabled).toBe(false))
    const beforeRaw = localStorage.getItem(APP_DATA_V9_KEY)
    const beforeMetadata = localStorage.getItem(V9_ACTIVATION_KEY)
    fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[0])
    expect(screen.getByText('班級仍有課程、異動或進度引用，不可刪除。')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(beforeRaw)
    expect(localStorage.getItem(V9_ACTIVATION_KEY)).toBe(beforeMetadata)
    expect(JSON.parse(beforeMetadata!).documentRevision).toBe(seeded.revision)
    fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[1])
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).classes)
      .toMatchObject([{ id: 'used-class' }]))
    expect(JSON.parse(localStorage.getItem(V9_ACTIVATION_KEY)!).documentRevision).toBe(seeded.revision + 1)
  })

  it('copies a new term only after explicit dates and protects populated Project deletion', async () => {
    const { sourceRaw, projectId } = await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole('button', { name: '切換專案' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '專案管理' }))
    expect(screen.getByRole('dialog', { name: '課表專案管理' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '總覽' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('複製來源專案'), { target: { value: projectId } })
    fireEvent.change(screen.getByLabelText('複製後專案名稱'), { target: { value: '下學期' } })
    const unit = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).teachingUnits[0]
    expect((screen.getByRole('button', { name: '確認複製新學期' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(`${unit.name} 來源有效日期`), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText(`${unit.name} 新學期開始日`), { target: { value: '2027-02-01' } })
    fireEvent.change(screen.getByLabelText(`${unit.name} 新學期結束日`), { target: { value: '2027-07-31' } })
    fireEvent.change(screen.getByLabelText(`${unit.name} 新錨點日期`), { target: { value: '2027-02-01' } })
    fireEvent.click(screen.getByRole('button', { name: '確認複製新學期' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).projects).toHaveLength(2))
    const copied = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!)
    expect(copied.activeProjectId).not.toBe(projectId)
    expect(copied.timetables.filter((item: { projectId: string }) => item.projectId === copied.activeProjectId)).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('選擇刪除專案'), { target: { value: projectId } })
    expect((screen.getByRole('button', { name: '永久刪除空白專案' }) as HTMLButtonElement).disabled).toBe(true)
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(sourceRaw)
  })

  it('archives and reactivates a Project but refuses deletion while structural resources remain', async () => {
    const { sourceRaw, projectId } = await activated()
    render(<V8PreviewApp onReturn={vi.fn()} />)
    await waitFor(() => expect((screen.getByRole('button', { name: '切換專案' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: '專案管理' }))
    fireEvent.change(document.querySelector('input[aria-label="新專案名稱"]')!, { target: { value: '空白 B' } })
    fireEvent.change(screen.getByLabelText('學期開始日'), { target: { value: '2027-02-01' } })
    fireEvent.change(screen.getByLabelText('學期結束日'), { target: { value: '2027-07-31' } })
    fireEvent.click(screen.getByRole('button', { name: '新增空白專案' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).projects).toHaveLength(2))
    const blankId = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).activeProjectId
    expect(blankId).not.toBe(projectId)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).timetables).toHaveLength(1)
    const archiveButtons = screen.getAllByRole('button', { name: '封存' })
    fireEvent.click(archiveButtons[0])
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).projects[0].archivedAt).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '重新啟用' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!).projects[0].archivedAt).toBeUndefined())
    fireEvent.change(screen.getByLabelText('選擇刪除專案'), { target: { value: blankId } })
    expect((screen.getByRole('button', { name: '永久刪除空白專案' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '永久刪除空白專案' }))
    await screen.findByText(/不能級聯刪除/)
    const after = JSON.parse(localStorage.getItem(APP_DATA_V9_KEY)!)
    expect(after.projects).toHaveLength(2)
    expect(after.projects[0].id).toBe(projectId)
    expect(after.timetables[0].id).toBe('teacher-a')
    expect(after.schools.some((item: { projectId: string }) => item.projectId === blankId)).toBe(true)
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(sourceRaw)
  })
})

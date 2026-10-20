// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createProject } from './data/projectRuntime'
import { createBlankProject } from './data/projectRuntime'
import { createTimetable, updateTimetable } from './data/timetablesV6'
import { createOneOffLesson } from './data/oneOffLessonsV7'
import { deleteTimetable } from './data/deleteTimetableV7'
import { createInitialAppDataV7 } from './hooks/useAppDataV4'
import { initialData } from './data/seed'
import { migrateV3ToV4 } from './data/migrationsV4'
import { migrateV4ToV5 } from './data/migrationsV5'
import { migrateV5ToV6 } from './data/migrationsV6'
import { migrateV6ToV7 } from './data/migrationsV7'
import { APP_DATA_V1_KEY, APP_DATA_V3_KEY, APP_DATA_V4_KEY } from './data/storageV4'
import { APP_DATA_V6_KEY } from './data/storageV6'
import { APP_DATA_V7_KEY } from './data/storageV7'
import { APP_DATA_V5_KEY } from './data/storageV5'

const oneOffUuid = '00000000-0000-4000-8000-000000000001'

function removeAppKeys() {
  localStorage.removeItem(APP_DATA_V7_KEY)
  localStorage.removeItem(APP_DATA_V6_KEY)
  localStorage.removeItem(APP_DATA_V5_KEY)
  localStorage.removeItem(APP_DATA_V4_KEY)
  localStorage.removeItem(APP_DATA_V3_KEY)
  localStorage.removeItem(APP_DATA_V1_KEY)
}

const migrateV5ToV7 = (source: Parameters<typeof migrateV5ToV6>[0]) => migrateV6ToV7(migrateV5ToV6(source))

function chooseLessonSubject(name = '國文') {
  fireEvent.focus(screen.getByLabelText('課程科目'))
  const option = [...screen.getByRole('listbox', { name: '可選科目' }).querySelectorAll<HTMLElement>('[role=option]')]
    .find((item) => item.textContent?.includes(name))
  if (!option) throw new Error(`Missing subject option: ${name}`)
  fireEvent.click(option)
}

function copyReadyData() {
  const data = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))
  return updateTimetable(data, data.timetables[0].id, { name: '原課表', teacherName: '林老師' })
}

function openTopbarChoice(name: '新增專案' | '新增空白課表') {
  fireEvent.click(screen.getByRole('button', { name: '新增' }))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

function openCopyDialog() {
  fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
  fireEvent.click(screen.getByRole('button', { name: '複製課表' }))
}

function confirmTimetableDelete(name: string) {
  fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
  fireEvent.click(screen.getByRole('button', { name: '刪除課表' }))
  fireEvent.click(screen.getByRole('button', { name: `確認刪除「${name}」` }))
}

function openTimetableSwitcher() {
  const trigger = screen.getByRole('button', { name: '切換課表' })
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
  return screen.getByRole('menu', { name: '教師課表' })
}

function switchTimetable(id: string) {
  const option = openTimetableSwitcher().querySelector<HTMLButtonElement>(`[data-timetable-id="${id}"]`)
  if (!option) throw new Error(`Missing timetable option: ${id}`)
  fireEvent.click(option)
}

function selectedTimetableId() {
  const option = openTimetableSwitcher().querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
  const id = option?.dataset.timetableId ?? null
  fireEvent.keyDown(document, { key: 'Escape' })
  return id
}

const copyField = (label: string) => within(screen.getByRole('form', { name: '複製課表設定' })).getByLabelText(label)

describe('App v4 runtime', () => {
  beforeEach(() => { vi.useFakeTimers(); removeAppKeys() })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); removeAppKeys() })

  it('沒有 Project 時右上角仍可新增專案，但不能建立孤立課表', () => {
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(createInitialAppDataV7()))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '新增' }))
    expect((screen.getByRole('menuitem', { name: '新增空白課表' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('請先建立課表專案。')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '新增專案' }))
    expect(screen.getByRole('dialog', { name: '專案設定' })).toBeTruthy()
  })

  it('窄螢幕仍可操作右上角選單與課表資訊視窗，Esc 返回入口焦點', () => {
    vi.stubGlobal('innerWidth', 390)
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '新增' }))
    expect(screen.getByRole('menuitem', { name: '新增專案' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    const trigger = screen.getByRole('button', { name: '編輯課表資訊' })
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByLabelText('課表名稱'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '編輯課表資訊' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('課表切換 Popover 顯示名稱與教師，支援選取、Escape、外部關閉及焦點恢復', () => {
    const source = copyReadyData()
    const data = createTimetable(source, source.projects[0].id, { name: '第二課表', teacherName: '王老師' }, 'teacher-b')
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    const trigger = screen.getByRole('button', { name: '切換課表' })
    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: '教師課表' })
    expect(within(menu).getByRole('menuitemradio', { name: /原課表.*林老師.*目前課表/ }).getAttribute('aria-checked')).toBe('true')
    expect(within(menu).getByRole('menuitemradio', { name: /第二課表.*王老師/ })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: '教師課表' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu', { name: '教師課表' })).toBeNull()
    const write = vi.spyOn(Storage.prototype, 'setItem')
    switchTimetable('teacher-b')
    expect(screen.getByText('王老師')).toBeTruthy()
    expect(document.activeElement).toBe(trigger)
    act(() => vi.advanceTimersByTime(200))
    expect(write).not.toHaveBeenCalled()
  })

  it('主要頁面只保留主標題，不再於上方顯示專案、學校或學制副標籤', () => {
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: '總覽' })).toBeTruthy()
    expect(document.querySelector('.page-heading .eyebrow')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    expect(screen.getByRole('heading', { level: 1, name: '課表' })).toBeTruthy()
    expect(document.querySelector('.page-heading .eyebrow')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '會議與活動' }))
    expect(screen.getByRole('heading', { level: 1, name: '會議與活動' })).toBeTruthy()
    expect(document.querySelector('.page-heading .eyebrow')).toBeNull()
  })

  it('Topbar 選單區分專案與課表，課表面板只提供課程，X 與 Escape 不寫入資料', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)

    openTopbarChoice('新增專案')
    expect(screen.getByRole('dialog', { name: '專案設定' })).toBeTruthy()
    expect(screen.getByText('建立新專案')).toBeTruthy()
    expect(screen.getByLabelText('專案名稱')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '專案設定' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    expect(screen.getByRole('dialog', { name: '新增課程' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /新增空白課表/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /新增固定課程/ }))
    expect(screen.getByRole('dialog', { name: '新增固定課程' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('dialog', { name: '新增課程' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /新增固定課程/ }))
    fireEvent.click(screen.getByRole('button', { name: /新增單日課程/ }))
    const oneOffDialog = screen.getByRole('dialog', { name: '新增單日課程' })
    expect(oneOffDialog).toBeTruthy()
    fireEvent.click(within(oneOffDialog).getAllByRole('button', { name: '關閉' })[0])
    expect(screen.getByRole('dialog', { name: '新增課程' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /新增單日課程/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '新增課程' })).getByRole('button', { name: '關閉對話框' }))
    act(() => vi.advanceTimersByTime(200))
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })

  it('新增課程選單只提供固定課與單日課，並只保留 X 關閉入口', () => {
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    const dialog = screen.getByRole('dialog', { name: '新增課程' })
    expect(within(dialog).getByText('課程')).toBeTruthy()
    expect(within(dialog).queryByText('基礎資料')).toBeNull()
    expect(dialog.querySelectorAll('.add-choice-group')).toHaveLength(1)
    expect(dialog.querySelectorAll('.add-choice-divider')).toHaveLength(0)
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent?.trim().split('。')[0]).filter(Boolean)).toEqual([
      expect.stringContaining('新增固定課程'), expect.stringContaining('新增單日課程'),
    ])
    expect(within(dialog).queryByRole('button', { name: /管理科目|管理班級|取消/ })).toBeNull()
    expect(within(dialog).getByRole('button', { name: '關閉對話框' })).toBeTruthy()
  })

  it('專案沒有教師課表時顯示兩種課程停用提示，Sidebar 仍可管理資源', () => {
    const source = copyReadyData()
    const data = deleteTimetable(source, source.projects[0].id, source.timetables[0].id)
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    expect((screen.getByRole('button', { name: /新增固定課程/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /新增單日課程/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText('請先建立教師課表。')).toHaveLength(2)
    expect(within(screen.getByRole('dialog', { name: '新增課程' })).queryByRole('button', { name: /管理科目|管理班級/ })).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /管理科目/ }))
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: /管理班級/ }))
    expect(screen.getByRole('dialog', { name: '管理班級' })).toBeTruthy()
  })

  it('專案設定移除重複資源與建立專案入口', () => {
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '專案設定' }))
    const dialog = screen.getByRole('dialog', { name: '專案設定' })
    expect(within(dialog).queryByRole('button', { name: /管理科目|管理班級|建立新專案/ })).toBeNull()
    expect(within(dialog).getByRole('button', { name: /目前專案名稱/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /學校與學制管理/ })).toBeTruthy()
  })

  it('缺少學校或學制時只提供既有設定引導，關閉設定後返回原管理器', () => {
    const source = copyReadyData()
    const data = { ...source, schools: [], teachingUnits: [], timetables: [], classes: [], courses: [], recurringLessons: [], overrides: [], oneOffLessons: [], events: [] }
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /管理班級/ }))
    expect(screen.getByText(/目前專案尚無學校或學制/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /新增班級/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '前往專案設定' }))
    expect(screen.getByRole('dialog', { name: '專案設定' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '管理班級' })).toBeTruthy()
    expect(screen.getByText(/目前專案尚無學校或學制/)).toBeTruthy()
  })

  it('拒絕捨棄資源草稿時不關閉管理器、不切頁也不清空輸入', () => {
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /管理科目/ }))
    fireEvent.click(screen.getByRole('button', { name: '編輯科目 國文' }))
    const name = screen.getByLabelText('國文名稱') as HTMLInputElement
    fireEvent.change(name, { target: { value: '保留的科目草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '關閉對話框' }))
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    expect(name.value).toBe('保留的科目草稿')
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('資源提交 pending 或 blocked 時阻止 Sidebar 導航', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    fireEvent.click(screen.getByRole('button', { name: /管理科目/ }))
    fireEvent.click(screen.getByRole('button', { name: '編輯科目 國文' }))
    const form = screen.getByRole('form', { name: '管理科目 國文' })
    fireEvent.change(within(form).getByLabelText('國文名稱'), { target: { value: '尚待儲存' } })
    fireEvent.click(within(form).getByRole('button', { name: '儲存科目' }))
    fireEvent.click(screen.getByRole('button', { name: '會議與活動' }))
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()

    const external = JSON.stringify({ ...data, projects: data.projects.map((project) => ({ ...project, name: '其他分頁版本' })) })
    localStorage.setItem(APP_DATA_V7_KEY, external)
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: APP_DATA_V7_KEY, oldValue: raw, newValue: external, storageArea: localStorage,
    })))
    expect(screen.getByLabelText('資源儲存復原')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '會議與活動' }))
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: '會議與活動' })).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(external)
  })

  it('專案切換同樣受 dirty 草稿保護', () => {
    const first = copyReadyData()
    let index = 0
    const next = createBlankProject(first, { name: '第二專案', teacherName: '王老師', academicYear: 116,
      semester: 'first', startDate: '2027-08-30', endDate: '2028-01-20' }, () => `batch3-${++index}`)
    const data = { ...next, activeProjectId: first.projects[0].id }
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /管理科目/ }))
    fireEvent.click(screen.getByRole('button', { name: '編輯科目 國文' }))
    fireEvent.change(screen.getByLabelText('國文名稱'), { target: { value: '跨專案保留草稿' } })
    fireEvent.change(screen.getByLabelText('課表專案'), { target: { value: next.projects.at(-1)!.id } })

    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    expect((screen.getByLabelText('國文名稱') as HTMLInputElement).value).toBe('跨專案保留草稿')
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('Topbar 新專案表單沿用既有 Project 建立流程並建立必要關聯', () => {
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    openTopbarChoice('新增專案')
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '下一學期' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '王老師' } })
    fireEvent.click(screen.getByRole('button', { name: '建立並切換' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(stored.projects).toHaveLength(data.projects.length + 1)
    expect(stored.schools).toHaveLength(data.schools.length + 1)
    expect(stored.teachingUnits).toHaveLength(data.teachingUnits.length + 1)
    expect(stored.timetables).toHaveLength(data.timetables.length + 1)
    expect(stored.projects.at(-1)).toMatchObject({ name: '下一學期' })
    expect(stored.timetables.at(-1)).toMatchObject({ teacherName: '王老師' })
  })

  it('待補教師不可由統一入口新增固定課程，但仍可建立新的空白課表', () => {
    const data = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    expect((screen.getByRole('button', { name: /新增固定課程/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('目前課表的授課教師姓名尚待補齊。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新增' }))
    expect((screen.getByRole('menuitem', { name: '新增空白課表' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('同校同學制的既有設定保留個別 ID 與識別名稱，不會被合併或重新指派', () => {
    const data = copyReadyData()
    const sourceUnit = data.teachingUnits[0]
    data.teachingUnits.push({ ...structuredClone(sourceUnit), id: 'same-level-unit', name: '高中第二組' })
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    fireEvent.click(screen.getByRole('button', { name: /新增固定課程/ }))
    const level = screen.getByLabelText('課程學制') as HTMLSelectElement
    expect(level.value).toBe('')
    expect([...level.options].filter((option) => option.value).map((option) => [option.value, option.text, option.disabled])).toEqual([
      [sourceUnit.id, `${sourceUnit.name}（重複設定，請先處理）`, true],
      ['same-level-unit', '高中第二組（重複設定，請先處理）', true],
    ])
    expect(screen.getByRole('alert').textContent).toContain('不會自動選取或重新指派')
    act(() => vi.advanceTimersByTime(200))
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })

  it('多課表載入時自動選取本專案課表，共用事件仍可安全新增', () => {
    const data = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    data.timetables.push({ id: 'teacher-b', projectId: data.projects[0].id, name: 'B 課表', teacherName: '林老師' })
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    const menu = openTimetableSwitcher()
    expect(within(menu).getByRole('menuitemradio', { name: /B 課表.*林老師/ })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByText('待補授課教師')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '會議與活動' }))
    fireEvent.click(screen.getByRole('button', { name: '新增活動' }))
    fireEvent.change(screen.getByLabelText('名稱'), { target: { value: '共同會議' } })
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-09-07' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(stored.timetables).toEqual(data.timetables)
    expect(stored.recurringLessons).toEqual(data.recurringLessons)
    expect(stored.events.at(-1)).toMatchObject({ title: '共同會議', projectId: data.projects[0].id })
  })

  it('同專案可建立兩份空白教師課表並立即切換，切換本身不寫入資料', () => {
    vi.setSystemTime(new Date(2026, 8, 7, 7, 0))
    const data = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    data.events.push({ id: 'shared-meeting', projectId: data.projects[0].id, teachingUnitId: null, title: '共同會議', type: 'meeting',
      date: '2026-09-07', startTime: '12:00', endTime: '13:00', color: '#A66D52', origin: 'user' })
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    expect(selectedTimetableId()).toBe(data.timetables[0].id)
    expect(screen.getByRole('heading', { level: 1, name: '課表' })).toBeTruthy()
    const addTeacher = (name: string, teacherName: string) => {
      openTopbarChoice('新增空白課表')
      fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: name } })
      fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: teacherName } })
      fireEvent.click(screen.getByRole('button', { name: '建立並切換' }))
      expect(screen.queryByRole('dialog', { name: '建立空白課表' })).toBeNull()
      expect(screen.getByRole('heading', { level: 1, name: '課表' })).toBeTruthy()
      const option = [...openTimetableSwitcher().querySelectorAll<HTMLElement>('[data-timetable-id]')].find((item) => item.textContent?.includes(name) && item.textContent?.includes(teacherName))
      const id = option?.dataset.timetableId
      fireEvent.keyDown(document, { key: 'Escape' })
      if (!id) throw new Error(`Missing created timetable: ${name}`)
      return id
    }
    const secondId = addTeacher('數學課表', '林老師')
    expect(screen.getByText('林老師')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /編輯 國文/ })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '總覽' }))
    expect(screen.getAllByText('共同會議').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    const thirdId = addTeacher('英文課表', '陳老師')
    expect(secondId).not.toBe(thirdId)
    expect(openTimetableSwitcher().querySelectorAll('[data-timetable-id]')).toHaveLength(3)
    fireEvent.keyDown(document, { key: 'Escape' })
    act(() => vi.advanceTimersByTime(200))
    const saved = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(saved.projects).toEqual(data.projects)
    expect(saved.schools).toEqual(data.schools)
    expect(saved.teachingUnits).toEqual(data.teachingUnits)
    expect(saved.recurringLessons).toEqual(data.recurringLessons)
    expect(saved.overrides).toEqual(data.overrides)
    const write = vi.spyOn(Storage.prototype, 'setItem')
    switchTimetable(data.timetables[0].id)
    expect(screen.getAllByRole('button', { name: /編輯 國文/ }).length).toBeGreaterThan(0)
    switchTimetable(secondId)
    expect(screen.queryAllByRole('button', { name: /編輯 國文/ })).toHaveLength(0)
    act(() => vi.advanceTimersByTime(200))
    expect(write).not.toHaveBeenCalled()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(JSON.stringify(saved))
  })

  it('舊課表姓名可補登且保留課程與課表 ID，切換專案會選本專案課表', () => {
    let id = 0
    const source = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    const firstProjectId = source.projects[0].id
    const firstTimetableId = source.timetables[0].id
    const withTeacher = createTimetable(source, firstProjectId, { name: '第二課表', teacherName: '林老師' }, 'teacher-b')
    const withProject = createBlankProject(withTeacher, { name: '下一學期', teacherName: '王老師', academicYear: 116,
      semester: 'first', startDate: '2027-08-30', endDate: '2028-01-20' }, () => `new-${++id}`)
    withProject.activeProjectId = firstProjectId
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(withProject))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    expect(screen.getByText('待補授課教師')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '我的課表' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '張老師' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存課表資訊' }))
    expect(screen.getByText('張老師')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '編輯課表資訊' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByRole('dialog', { name: '編輯課表資訊' })).toBeNull()
    const projectSelector = screen.getByLabelText('課表專案') as HTMLSelectElement
    fireEvent.change(projectSelector, { target: { value: 'new-1' } })
    expect(selectedTimetableId()).toBe(withProject.timetables?.find((item) => item.projectId === 'new-1')?.id)
    expect(screen.getByText('王老師')).toBeTruthy()
    fireEvent.change(projectSelector, { target: { value: firstProjectId } })
    expect(selectedTimetableId()).toBe(firstTimetableId)
    expect(screen.getByRole('heading', { level: 1, name: '課表' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    const saved = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(saved.timetables.find((item: { id: string }) => item.id === firstTimetableId)).toMatchObject({ id: firstTimetableId, name: '我的課表', teacherName: '張老師' })
    expect(saved.recurringLessons).toEqual(source.recurringLessons)
  })

  it('封存專案可切換教師唯讀查看，但不提供新增或編輯課表', () => {
    const source = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    const multi = createTimetable(source, source.projects[0].id, { name: '第二課表', teacherName: '林老師' }, 'teacher-b')
    const archived = { ...multi, activeProjectId: null, projects: multi.projects.map((item) => ({ ...item, archivedAt: '2027-02-01T00:00:00.000Z' })) }
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(archived))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '查看' }))
    expect(screen.getByText('歷史專案・唯讀')).toBeTruthy()
    expect(selectedTimetableId()).toBe(source.timetables[0].id)
    switchTimetable('teacher-b')
    expect(screen.getByText('林老師')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '編輯課表資訊' })).toBeNull()
    expect(screen.queryByRole('button', { name: '新增' })).toBeNull()
    expect(screen.queryByRole('button', { name: '新增課程或課表' })).toBeNull()
  })

  it('切到新教師後 Topbar 新增與拖曳異動仍寫入該課表', () => {
    vi.setSystemTime(new Date(2026, 8, 7, 7, 0))
    const source = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    const multi = createTimetable(source, source.projects[0].id, { name: '第二課表', teacherName: '林老師' }, 'teacher-b')
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(multi))
    render(<App />)
    switchTimetable('teacher-b')
    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    fireEvent.click(screen.getByRole('button', { name: /新增固定課程/ }))
    chooseLessonSubject()
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    act(() => vi.advanceTimersByTime(200))
    const afterLesson = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    const newLesson = afterLesson.recurringLessons.at(-1)
    expect(newLesson.timetableId).toBe('teacher-b')
    expect(afterLesson.recurringLessons.slice(0, -1)).toEqual(source.recurringLessons)
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    const card = screen.getAllByRole('button', { name: /編輯 國文/ })[0]
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn() }
    fireEvent.dragStart(card, { dataTransfer })
    const targets = screen.getByLabelText('2026-09-08 可放置節次').querySelectorAll('.lesson-drop-target')
    const target = [...targets].find((item) => item.textContent?.includes('第 8 節'))!
    fireEvent.drop(target, { dataTransfer })
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    act(() => vi.advanceTimersByTime(200))
    const afterDrag = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(afterDrag.overrides.at(-1)).toMatchObject({ timetableId: 'teacher-b', originalLessonId: newLesson.id, action: 'move' })
    expect(afterDrag.recurringLessons.slice(0, -1)).toEqual(source.recurringLessons)
    switchTimetable(source.timetables[0].id)
    expect(screen.getAllByRole('button', { name: /編輯 國文/ }).length).toBeGreaterThan(0)
    expect(screen.queryByText('單日移動')).toBeNull()
  })

  it('新增課表寫入失敗時 v7 原文不被部分覆寫', () => {
    const data = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V7_KEY) throw new Error('quota')
      return original.call(this, key, value)
    })
    openTopbarChoice('新增空白課表')
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '未儲存課表' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '林老師' } })
    fireEvent.click(screen.getByRole('button', { name: '建立並切換' }))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('資料儲存需要處理')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })

  it('新增課表遇到其他分頁寫入時停止覆寫', () => {
    const data = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    openTopbarChoice('新增空白課表')
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '本分頁課表' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '林老師' } })
    fireEvent.click(screen.getByRole('button', { name: '建立並切換' }))
    const external = createTimetable(data, data.projects[0].id, { name: '其他分頁課表', teacherName: '陳老師' }, 'external')
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V7_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: raw, newValue: externalRaw })))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('偵測到多分頁資料衝突')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(externalRaw)
  })

  it('外部分頁移除目前選取時顯示待選提示，不改顯其他教師課程', () => {
    const source = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    const multi = createTimetable(source, source.projects[0].id, { name: '空白課表', teacherName: '林老師' }, 'teacher-b')
    const originalRaw = JSON.stringify(multi)
    localStorage.setItem(APP_DATA_V7_KEY, originalRaw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    switchTimetable('teacher-b')
    const externalRaw = JSON.stringify(source)
    localStorage.setItem(APP_DATA_V7_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: originalRaw, newValue: externalRaw })))
    expect(openTimetableSwitcher().querySelector('[aria-checked="true"]')).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('heading', { level: 1, name: '課表' })).toBeTruthy()
    expect(screen.getByText('請先選擇教師課表。')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /編輯 國文/ })).toHaveLength(0)
  })

  it('編輯視窗開啟後若其他分頁更新同份課表，拒絕舊表單覆寫', () => {
    const source = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    const originalRaw = JSON.stringify(source)
    localStorage.setItem(APP_DATA_V7_KEY, originalRaw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    const external = updateTimetable(source, source.timetables[0].id, { name: '其他分頁名稱', teacherName: '王老師' })
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V7_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: originalRaw, newValue: externalRaw })))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '本分頁名稱' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存課表資訊' }))
    expect(screen.getByRole('alert').textContent).toContain('請關閉後重新開啟編輯')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(externalRaw)
  })

  it('編輯只變更目前教師課表，且未儲存內容須確認才能關閉', () => {
    const first = copyReadyData()
    const data = createTimetable(first, first.projects[0].id, { name: '另一份課表', teacherName: '王老師' }, 'teacher-b')
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    switchTimetable('teacher-b')
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    expect((screen.getByLabelText('課表名稱') as HTMLInputElement).value).toBe('另一份課表')
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '改名中的課表' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '編輯課表資訊' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '儲存課表資訊' }))
    expect(screen.getByRole('dialog', { name: '編輯課表資訊' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByRole('dialog', { name: '編輯課表資訊' })).toBeNull()
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(stored.timetables.find((item: { id: string }) => item.id === 'teacher-b').name).toBe('改名中的課表')
    expect(stored.timetables.find((item: { id: string }) => item.id === first.timetables[0].id)).toEqual(first.timetables[0])
  })

  it('以本地今天預填可編輯欄位，實際寫入後才切換並可重新載入', () => {
    vi.setSystemTime(new Date(2026, 8, 7, 0, 30))
    const data = copyReadyData()
    data.overrides.push({ id: 'source-cancel', projectId: data.projects[0].id, timetableId: data.timetables[0].id,
      teachingUnitId: data.teachingUnits[0].id, date: '2026-09-07', periodId: data.recurringLessons[0].periodId,
      action: 'cancel', originalLessonId: data.recurringLessons[0].id })
    const withOneOff = createOneOffLesson(data, { projectId: data.projects[0].id, timetableId: data.timetables[0].id,
      teachingUnitId: data.teachingUnits[0].id, classId: data.classes[0].id, subjectId: data.subjects[0].id,
      date: '2026-09-08', purpose: 'extra', time: { mode: 'custom', startTime: '18:00', endTime: '18:45' } }, () => oneOffUuid)
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(withOneOff))
    const first = render(<App />)
    const sourceId = data.timetables[0].id
    openCopyDialog()
    expect((copyField('副本名稱') as HTMLInputElement).value).toBe('原課表（副本）')
    expect((copyField('副本授課教師姓名') as HTMLInputElement).value).toBe('林老師')
    expect((copyField('基準日期') as HTMLInputElement).value).toBe('2026-09-07')
    expect(screen.getByText(/A／B 週配置/)).toBeTruthy()
    fireEvent.change(copyField('副本名稱'), { target: { value: '自訂副本' } })
    fireEvent.change(copyField('副本授課教師姓名'), { target: { value: '王老師' } })
    fireEvent.change(copyField('基準日期'), { target: { value: '2026-09-09' } })
    fireEvent.click(screen.getByRole('button', { name: '複製並切換' }))
    expect(screen.getByRole('dialog', { name: '編輯課表資訊' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '正在儲存…' }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.getByRole('button', { name: '切換課表' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByRole('dialog', { name: '編輯課表資訊' })).toBeNull()
    expect(screen.getByText('已複製並儲存「自訂副本」。')).toBeTruthy()
    const selectedId = (JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).timetables as Array<{ id: string; name: string }>).find((item) => item.name === '自訂副本')!.id
    expect(selectedId).not.toBe(sourceId)
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    const copiedLessons = stored.recurringLessons.filter((item: { timetableId: string }) => item.timetableId === selectedId)
    expect(stored.timetables.find((item: { id: string }) => item.id === selectedId)).toMatchObject({ name: '自訂副本', teacherName: '王老師' })
    expect(copiedLessons).toHaveLength(data.recurringLessons.length)
    expect(new Set(copiedLessons.map((item: { day: number }) => item.day))).toEqual(new Set([1, 2, 3, 4, 5]))
    expect(new Set(copiedLessons.map((item: { weekPattern: string }) => item.weekPattern))).toEqual(new Set(['every', 'A', 'B']))
    expect(copiedLessons.every((item: { effectiveStart: string; effectiveEnd: string; origin: string }) => item.effectiveStart === '2026-09-09' && item.effectiveEnd === data.teachingUnits[0].endDate && item.origin === 'demo')).toBe(true)
    expect(stored.overrides).toEqual(data.overrides)
    expect(stored.oneOffLessons).toEqual(withOneOff.oneOffLessons)
    expect(stored.oneOffLessons.every((item: { timetableId: string }) => item.timetableId !== selectedId)).toBe(true)
    expect(copiedLessons.every((item: { id: string; seriesId: string }) => !data.recurringLessons.some((source) => source.id === item.id || source.seriesId === item.seriesId))).toBe(true)
    first.unmount()
    render(<App />)
    expect(within(openTimetableSwitcher()).getByRole('menuitemradio', { name: /自訂副本.*王老師/ })).toBeTruthy()
  })

  it('待補教師不可複製，封存專案也不提供複製入口', () => {
    const pending = migrateV5ToV7(migrateV4ToV5(migrateV3ToV4(initialData)))
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(pending))
    const current = render(<App />)
    expect(screen.queryByRole('button', { name: '複製課表' })).toBeNull()
    current.unmount()
    const archived = copyReadyData()
    archived.activeProjectId = null
    archived.projects[0] = { ...archived.projects[0], archivedAt: '2027-02-01T00:00:00.000Z' }
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(archived))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '查看' }))
    expect(screen.queryByRole('button', { name: '複製課表' })).toBeNull()
  })

  it('空白欄位與不存在的日期都不會建立副本', () => {
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    openCopyDialog()
    const form = screen.getByRole('form', { name: '複製課表設定' })
    fireEvent.change(copyField('副本名稱'), { target: { value: '   ' } })
    fireEvent.submit(form)
    expect(screen.getByRole('alert').textContent).toContain('不可空白')
    fireEvent.change(copyField('副本名稱'), { target: { value: '副本' } })
    fireEvent.change(copyField('副本授課教師姓名'), { target: { value: '   ' } })
    fireEvent.submit(form)
    expect(screen.getByRole('alert').textContent).toContain('不可空白')
    fireEvent.change(copyField('副本授課教師姓名'), { target: { value: '林老師' } })
    fireEvent.change(copyField('基準日期'), { target: { value: '2026-02-30' } })
    fireEvent.submit(form)
    expect(screen.getByRole('alert').textContent).toContain('真實有效')
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).timetables).toHaveLength(1)
  })

  it('開啟表單後來源固定課程變動會拒絕 stale copy 並保留輸入', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    openCopyDialog()
    fireEvent.change(copyField('副本名稱'), { target: { value: '保留的名稱' } })
    const external = structuredClone(data)
    external.recurringLessons[0].room = '其他分頁教室'
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V7_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: raw, newValue: externalRaw })))
    fireEvent.click(screen.getByRole('button', { name: '複製並切換' }))
    expect(screen.getByRole('alert').textContent).toContain('已變更')
    expect((copyField('副本名稱') as HTMLInputElement).value).toBe('保留的名稱')
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).timetables).toHaveLength(1)
  })

  it('複製中的多分頁衝突不覆寫外部資料，採用外部版本後保留表單', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    openCopyDialog()
    fireEvent.change(copyField('副本名稱'), { target: { value: '本分頁副本' } })
    fireEvent.click(screen.getByRole('button', { name: '複製並切換' }))
    const external = updateTimetable(data, data.timetables[0].id, { name: '外部分頁課表', teacherName: '林老師' })
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V7_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: raw, newValue: externalRaw })))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('偵測到多分頁資料衝突')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(externalRaw)
    fireEvent.click(screen.getByRole('button', { name: '採用其他分頁版本' }))
    expect(screen.getByRole('dialog', { name: '編輯課表資訊' })).toBeTruthy()
    expect((copyField('副本名稱') as HTMLInputElement).value).toBe('本分頁副本')
    expect(screen.getByRole('alert').textContent).toContain('未完成')
  })

  it('複製寫入失敗不誤報成功，且重複點擊只建立一份副本', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    const first = render(<App />)
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V7_KEY) throw new Error('quota')
      return original.call(this, key, value)
    })
    openCopyDialog()
    fireEvent.change(copyField('副本名稱'), { target: { value: '未寫入副本' } })
    const submit = screen.getByRole('button', { name: '複製並切換' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByText(/已複製並儲存/)).toBeNull()
    expect(screen.getByRole('dialog', { name: '編輯課表資訊' })).toBeTruthy()
    expect((copyField('副本名稱') as HTMLInputElement).value).toBe('未寫入副本')
    expect(screen.getByText(/資料尚未成功寫入此裝置/)).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    first.unmount()
    vi.restoreAllMocks()
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    openCopyDialog()
    const successfulSubmit = screen.getByRole('button', { name: '複製並切換' })
    fireEvent.click(successfulSubmit)
    fireEvent.click(successfulSubmit)
    act(() => vi.advanceTimersByTime(200))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).timetables).toHaveLength(2)
  })

  it('Sidebar 科目與班級入口開啟對應安全管理器並還原焦點', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    expect(screen.queryByRole('button', { name: '科目與班級' })).toBeNull()
    const subjectTrigger = screen.getByRole('button', { name: /管理科目/ })
    fireEvent.click(subjectTrigger)
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(document.activeElement).toBe(subjectTrigger)
    const trigger = screen.getByRole('button', { name: /管理班級/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '管理班級' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '管理班級' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })

  it('Sidebar 統計沿用目前學制科目與專案有效班級，收合時維持主內容與 accessible name', () => {
    const data = copyReadyData()
    const projectId = data.activeProjectId!
    const unit = data.teachingUnits.find((item) => item.projectId === projectId)!
    const selectedSubjectCount = data.subjects.filter((subject) =>
      (subject.applicableSchoolLevels ?? ['junior-high', 'senior-high', 'other']).includes(unit.schoolLevel)).length
    const validUnitIds = new Set(data.teachingUnits.filter((item) => item.projectId === projectId).map((item) => item.id))
    const validClassCount = data.classes.filter((item) => item.projectId === projectId && validUnitIds.has(item.teachingUnitId)).length
    const excludedLevel = unit.schoolLevel === 'other' ? 'senior-high' : 'other'
    data.subjects.push({ id: 'catalog-not-selected', name: '未選預設科目', shortName: '未選', color: '#123456', applicableSchoolLevels: [excludedLevel] })
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)

    expect(screen.getByRole('button', { name: `管理科目，已選 ${selectedSubjectCount} 科` })).toBeTruthy()
    expect(screen.getByRole('button', { name: `管理班級，${validClassCount} 個有效班級` })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Toki 品牌標誌' })).toBeTruthy()
    expect(screen.getByText('Toki')).toBeTruthy()
    expect(screen.getByText('とき・時間')).toBeTruthy()
    expect(document.querySelector('.sidebar')?.classList.contains('sidebar-collapsed')).toBe(true)
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-is-collapsed')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '展開側邊欄' }))
    expect(document.querySelector('.sidebar')?.classList.contains('sidebar-collapsed')).toBe(false)
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-is-collapsed')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    expect(screen.getByRole('button', { name: '收合側邊欄' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '收合側邊欄' }))
    expect(document.querySelector('.sidebar')?.classList.contains('sidebar-collapsed')).toBe(true)
    expect(document.querySelector('.main-area')?.classList.contains('sidebar-is-collapsed')).toBe(true)
    expect(screen.getByRole('button', { name: `管理科目，已選 ${selectedSubjectCount} 科` }).title).toContain('管理科目')
    expect(screen.getByRole('button', { name: '展開側邊欄' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('桌面 Sidebar 使用佔欄寬度而非 overlay，手機選單仍可開關且收合不清空課程草稿', () => {
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    const layoutCss = readFileSync('src/styles.css', 'utf8')
    expect(layoutCss).toContain('grid-template-columns: var(--sidebar-width) minmax(0, 1fr)')
    expect(layoutCss).toContain('grid-template-columns: var(--sidebar-collapsed-width) minmax(0, 1fr)')
    expect(layoutCss).toContain('.app-shell, .app-shell.sidebar-is-collapsed { display: block; }')
    expect(layoutCss).toContain('.sidebar { position: fixed; inset: 0 auto 0 0;')
    expect(document.querySelector('.app-shell')?.classList.contains('sidebar-is-collapsed')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '開啟選單' }))
    expect(document.querySelector('.sidebar')?.classList.contains('sidebar-open')).toBe(true)
    fireEvent.click(document.querySelector('.sidebar-backdrop')!)
    expect(document.querySelector('.sidebar')?.classList.contains('sidebar-open')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    fireEvent.click(screen.getByRole('button', { name: /新增固定課程/ }))
    chooseLessonSubject()
    const subject = screen.getByLabelText('課程科目') as HTMLInputElement
    const selected = subject.value
    fireEvent.click(screen.getByRole('button', { name: '展開側邊欄' }))
    expect(screen.getByRole('dialog', { name: '新增固定課程' })).toBeTruthy()
    expect(subject.value).toBe(selected)
    fireEvent.click(screen.getByRole('button', { name: '收合側邊欄' }))
    expect(subject.value).toBe(selected)
  })

  it('從預設目錄加入後 Sidebar 科目數與我的科目同步', () => {
    const data = copyReadyData()
    data.teachingUnits[0].schoolLevel = 'senior-high'
    data.subjects = []
    data.recurringLessons = []
    data.overrides = []
    data.oneOffLessons = []
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '管理科目，已選 0 科' }))
    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '化學' } })
    fireEvent.click(screen.getByRole('button', { name: '加入預設科目 化學' }))
    expect(screen.getByRole('button', { name: '編輯科目 化學' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '管理科目，已選 1 科' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).subjects.filter((item: { name: string }) => item.name === '化學')).toHaveLength(1)
  })

  it('首次使用不自動建立範例，預覽範例也不污染正式資料', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '建立第一個課表專案' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看範例' }))
    expect(screen.getByText('唯讀範例')).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(stored.projects).toEqual([])
    expect(stored.recurringLessons).toEqual([])
  })

  it('首次使用建立空白專案後只寫入 v4 且不改動舊 key', () => {
    localStorage.setItem(APP_DATA_V3_KEY, JSON.stringify(initialData))
    const migrated = migrateV3ToV4(initialData)
    migrated.projects = []; migrated.schools = []; migrated.teachingUnits = []; migrated.classes = []; migrated.recurringLessons = []; migrated.events = []; migrated.overrides = []; migrated.activeProjectId = null
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(migrated))
    const oldV3 = localStorage.getItem(APP_DATA_V3_KEY)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '建立第一個課表專案' }))
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '我的新課表' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '陳老師' } })
    fireEvent.click(screen.getByRole('button', { name: '建立並開始' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(stored.projects).toHaveLength(1)
    expect(stored.projects[0].name).toBe('我的新課表')
    expect(stored.classes).toEqual([])
    expect(stored.recurringLessons).toEqual([])
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe(oldV3)
  })

  it('切換專案後更新唯一 v4 state，並顯示隔離後的空課表資料', () => {
    const first = migrateV3ToV4(initialData)
    const ids = ['project-2', 'school-2', 'unit-2']
    const data = createProject(first, { name: '第二份課表', academicYear: 116, semester: 'first', startDate: '2027-08-30', endDate: '2028-01-20' }, () => ids.shift()!, '2027-07-01T00:00:00.000Z')
    data.activeProjectId = first.activeProjectId
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(data))
    render(<App />)
    const selector = screen.getByLabelText('課表專案') as HTMLSelectElement
    expect(selector.value).toBe(first.activeProjectId)
    fireEvent.change(selector, { target: { value: 'project-2' } })
    act(() => vi.advanceTimersByTime(200))
    expect(selector.value).toBe('project-2')
    expect(screen.getAllByText('第二份課表').length).toBeGreaterThan(0)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).activeProjectId).toBe('project-2')
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBeNull()
  })

  it('v3 migration 失敗時鎖定課表編輯且不建立 v4', () => {
    localStorage.setItem(APP_DATA_V3_KEY, '{broken-v3')
    render(<App />)
    expect(screen.getByText('資料尚未載入')).toBeTruthy()
    expect(screen.queryByText('本週課表')).toBeNull()
    act(() => vi.advanceTimersByTime(500))
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe('{broken-v3')
  })

  it('LessonEditor 直接寫入 v4 並在重新載入後保留固定課程', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const data = migrateV3ToV4(initialData)
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(data))
    const first = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '林老師' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存課表資訊' }))
    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    fireEvent.click(screen.getByRole('button', { name: /新增固定課程/ }))
    chooseLessonSubject()
    fireEvent.change(screen.getByLabelText('課程星期'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('課程節次'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('課程輪週'), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(stored.recurringLessons).toHaveLength(data.recurringLessons.length + 1)
    expect(stored.recurringLessons.at(-1)).toMatchObject({ projectId: data.activeProjectId, day: 5, periodId: 8, weekPattern: 'B' })
    expect(stored.timetables.map((item: { id: string }) => item.id)).toEqual([migrateV5ToV7(migrateV4ToV5(data)).timetables[0].id])
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key')
    first.unmount()
    render(<App />)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).recurringLessons).toHaveLength(data.recurringLessons.length + 1)
  })

  it('桌面拖曳經預覽確認後寫入 v4，重新載入仍保留單日移動', () => {
    vi.setSystemTime(new Date(2026, 8, 7, 7, 0))
    const data = migrateV3ToV4(initialData)
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(data))
    const first = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    const card = screen.getAllByLabelText('編輯 國文・二年 1 班')[0]
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn() }
    fireEvent.dragStart(card, { dataTransfer })
    const targets = screen.getByLabelText('2026-09-08 可放置節次').querySelectorAll('.lesson-drop-target')
    const target = [...targets].find((item) => item.textContent?.includes('第 8 節'))!
    fireEvent.drop(target, { dataTransfer })
    expect(screen.getByText(/拖曳只建立操作意圖/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    act(() => vi.advanceTimersByTime(200))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).overrides.at(-1)).toMatchObject({ action: 'move', originalLessonId: 'c1', target: { date: '2026-09-08', periodId: 8 } })
    first.unmount()
    render(<App />)
    expect(screen.getByText('已移動')).toBeTruthy()
  })
})

describe('App one-off schedule and confirmed persistence', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 7, 7, 0)); removeAppKeys(); vi.stubGlobal('crypto', { randomUUID: () => oneOffUuid }) })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); removeAppKeys() })

  const fillOneOff = (data: ReturnType<typeof copyReadyData>) => {
    fireEvent.change(screen.getByLabelText('學校'), { target: { value: data.schools[0].id } })
    fireEvent.change(screen.getByLabelText('學制'), { target: { value: data.teachingUnits[0].id } })
    fireEvent.change(screen.getByLabelText('班級'), { target: { value: data.classes[0].id } })
    fireEvent.change(screen.getByLabelText('科目'), { target: { value: data.subjects[0].id } })
    fireEvent.change(screen.getByLabelText('節次'), { target: { value: '3' } })
  }

  const openOneOffFromCourseMenu = (date = '2026-09-07') => {
    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    fireEvent.click(screen.getByRole('button', { name: /新增單日課程/ }))
    if (date !== '2026-09-07') fireEvent.change(screen.getByLabelText('指定日期'), { target: { value: date } })
  }

  it('adds, edits and deletes a dated lesson only after the matching v7 write completes', async () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    openOneOffFromCourseMenu('2026-09-08')
    expect((screen.getByLabelText('指定日期') as HTMLInputElement).value).toBe('2026-09-08')
    fillOneOff(data)
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(screen.queryByText('單日課程已新增並儲存。')).toBeNull()
    expect(screen.getByRole('dialog', { name: '新增單日課程' })).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).oneOffLessons[0]).toMatchObject({ id: oneOffUuid, date: '2026-09-08', timetableId: data.timetables[0].id, time: { mode: 'period', periodId: 3 } })
    expect(screen.getByText('單日課程已新增並儲存。')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '新增單日課程' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '編輯單日課程 國文・二年 1 班' }))
    expect(screen.getByRole('dialog', { name: '編輯單日課程' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('教室（選填）'), { target: { value: '圖書館' } })
    fireEvent.click(screen.getByRole('button', { name: '送出修改' }))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).oneOffLessons[0].room).toBeUndefined()
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).oneOffLessons[0]).toMatchObject({ id: oneOffUuid, room: '圖書館' })
    fireEvent.click(screen.getByRole('button', { name: '編輯單日課程 國文・二年 1 班' }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '刪除單日課程' }))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).oneOffLessons).toHaveLength(1)
    await act(async () => { vi.advanceTimersByTime(200) })
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(stored.oneOffLessons).toEqual([])
    expect(stored.recurringLessons).toEqual(data.recurringLessons)
    expect(screen.getByText('單日課程已刪除並儲存。')).toBeTruthy()
  })

  it('keeps the editor open and never claims success when storage write fails', async () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    openOneOffFromCourseMenu('2026-09-08')
    fillOneOff(data)
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(screen.getByRole('dialog', { name: '新增單日課程' })).toBeTruthy()
    expect(screen.getByText(/單日課程尚未成功儲存至此裝置/)).toBeTruthy()
    expect(screen.queryByText('單日課程已新增並儲存。')).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })

  it('requires explicit overlap consent and persists both conflict-marked cards only in the current timetable', async () => {
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    openOneOffFromCourseMenu()
    fillOneOff(data)
    fireEvent.change(screen.getByLabelText('節次'), { target: { value: '1' } })
    expect(screen.getByText(/此時段已有 1 堂課/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '送出新增' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('明確允許衝堂，保留兩堂課'))
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    expect(screen.queryByText('單日課程已新增並儲存。')).toBeNull()
    await act(async () => { vi.advanceTimersByTime(200) })
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(stored.oneOffLessons[0]).toMatchObject({ timetableId: data.timetables[0].id, date: '2026-09-07' })
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    expect(screen.getByLabelText('2026-09-07 課表').querySelectorAll('.multi-lesson-card.conflict').length).toBeGreaterThanOrEqual(2)
  })

  it('does not overwrite an external tab or report a false success on conflict', async () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    openOneOffFromCourseMenu('2026-09-08')
    fillOneOff(data)
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    const external = JSON.stringify({ ...data, projects: data.projects.map((item) => ({ ...item, name: '外部分頁變更' })) })
    localStorage.setItem(APP_DATA_V7_KEY, external)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: raw, newValue: external, storageArea: localStorage })))
    await act(async () => { vi.advanceTimersByTime(200) })
    expect(screen.getByRole('dialog', { name: '新增單日課程' })).toBeTruthy()
    expect(screen.getByText(/本次單日課程變更尚未儲存/)).toBeTruthy()
    expect(screen.queryByText('單日課程已新增並儲存。')).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(external)
  })

  it('does not offer one-off writes from an archived project', () => {
    const data = copyReadyData()
    data.projects[0].archivedAt = '2026-09-01T00:00:00.000Z'
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    expect(screen.queryByRole('button', { name: '新增課程' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: '新增單日課程' })).toBeNull()
  })

  it('二次確認後才刪除指定教師課表；待持久化成功才關閉並切換另一份', () => {
    const first = copyReadyData()
    const data = createTimetable(first, first.projects[0].id, { name: '另一份課表', teacherName: '王老師' }, 'teacher-b')
    data.overrides.push({ id: 'delete-cancel', projectId: data.projects[0].id, timetableId: data.timetables[0].id,
      teachingUnitId: data.teachingUnits[0].id, date: '2026-09-07', periodId: data.recurringLessons[0].periodId,
      action: 'cancel', originalLessonId: data.recurringLessons[0].id })
    const withOneOff = createOneOffLesson(data, { projectId: data.projects[0].id, timetableId: data.timetables[0].id,
      teachingUnitId: data.teachingUnits[0].id, classId: data.classes[0].id, subjectId: data.subjects[0].id,
      date: '2026-09-08', purpose: 'extra', time: { mode: 'custom', startTime: '18:00', endTime: '18:45' } }, () => oneOffUuid)
    const raw = JSON.stringify(withOneOff)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    expect(screen.getByText(/筆固定課程版本、1 筆單日異動與 1 筆單日課程/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刪除課表' }))
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '確認刪除「原課表」' }))
    fireEvent.click(screen.getByRole('button', { name: '保留課表' }))
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    fireEvent.click(screen.getByRole('button', { name: '刪除課表' }))
    const confirm = screen.getByRole('button', { name: '確認刪除「原課表」' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(screen.getByRole('dialog', { name: '編輯課表資訊' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: '課表' })).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByRole('dialog', { name: '編輯課表資訊' })).toBeNull()
    expect(screen.getByText('已刪除並儲存「原課表」。')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: '課表' })).toBeTruthy()
    const saved = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(saved.timetables.map((item: { id: string }) => item.id)).toEqual(['teacher-b'])
    expect(saved.recurringLessons).toEqual([])
    expect(saved.overrides).toEqual([])
    expect(saved.oneOffLessons).toEqual([])
    expect(saved.projects).toEqual(withOneOff.projects)
    expect(saved.schools).toEqual(withOneOff.schools)
  })

  it('刪除最後一份課表後專案保留；重新整理仍可進設定並建立空白課表', () => {
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    const first = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    confirmTimetableDelete('原課表')
    expect(screen.getByRole('dialog', { name: '編輯課表資訊' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('這個專案尚無教師課表')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: '課表' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新增課程' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '編輯課表資訊' })).toBeNull()
    expect(screen.queryByRole('button', { name: '複製課表' })).toBeNull()
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(stored.projects).toEqual(data.projects)
    expect(stored.timetables).toEqual([])
    first.unmount()
    render(<App />)
    expect(screen.getByText('這個專案尚無教師課表')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '專案設定' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: '專案設定' })[1])
    expect(screen.getByRole('dialog', { name: '專案設定' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '新增空白課表' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '重建的課表' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '林老師' } })
    fireEvent.click(screen.getByRole('button', { name: '建立並切換' }))
    act(() => vi.advanceTimersByTime(200))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).timetables).toHaveLength(1)
  })

  it('確認前切換課表或其他分頁更新內容時，拒絕刪除原目標', () => {
    const first = copyReadyData()
    const data = createTimetable(first, first.projects[0].id, { name: '另一份課表', teacherName: '王老師' }, 'teacher-b')
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    fireEvent.click(screen.getByRole('button', { name: '刪除課表' }))
    const switched = updateTimetable(data, data.timetables[0].id, { name: '外部更新', teacherName: '林老師' })
    const switchedRaw = JSON.stringify(switched)
    localStorage.setItem(APP_DATA_V7_KEY, switchedRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: raw, newValue: switchedRaw, storageArea: localStorage })))
    fireEvent.click(screen.getByRole('button', { name: '確認刪除「原課表」' }))
    expect(screen.getByRole('alert').textContent).toContain('內容已變更')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(switchedRaw)
  })

  it('空專案切換至其他專案再返回，不自動補建課表', () => {
    const first = copyReadyData()
    let index = 0
    const second = createBlankProject(first, { name: '另一專案', teacherName: '王老師', academicYear: 116,
      semester: 'first', startDate: '2027-08-30', endDate: '2028-01-20' }, () => `other-${++index}`)
    const data = { ...second, activeProjectId: first.projects[0].id }
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    render(<App />)
    confirmTimetableDelete('原課表')
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('這個專案尚無教師課表')).toBeTruthy()
    const projects = screen.getByLabelText('課表專案') as HTMLSelectElement
    fireEvent.change(projects, { target: { value: second.projects.at(-1)!.id } })
    expect(screen.getByRole('button', { name: '切換課表' })).toBeTruthy()
    fireEvent.change(projects, { target: { value: first.projects[0].id } })
    expect(screen.getByText('課表變更尚未確認儲存')).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('這個專案尚無教師課表')).toBeTruthy()
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)
    expect(stored.timetables.filter((item: { projectId: string }) => item.projectId === first.projects[0].id)).toEqual([])
    expect(stored.timetables.filter((item: { projectId: string }) => item.projectId === second.projects.at(-1)!.id)).toHaveLength(1)
  })

  it('確認畫面開啟期間外部分頁變更課表，必須重新檢視刪除範圍', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    fireEvent.click(screen.getByRole('button', { name: '刪除課表' }))
    const external = updateTimetable(data, data.timetables[0].id, { name: '外部改名', teacherName: '林老師' })
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V7_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: raw, newValue: externalRaw, storageArea: localStorage })))
    fireEvent.click(screen.getByRole('button', { name: '確認刪除「原課表」' }))
    expect(screen.getByRole('alert').textContent).toContain('內容已變更')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(externalRaw)
  })

  it('配額錯誤及跨分頁衝突不宣告刪除成功，且保留確認視窗', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    const view = render(<App />)
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V7_KEY) throw new Error('quota')
      return original.call(this, key, value)
    })
    confirmTimetableDelete('原課表')
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByRole('dialog', { name: '編輯課表資訊' })).toBeTruthy()
    expect(screen.getByText(/尚未成功寫入此裝置/)).toBeTruthy()
    expect(screen.getByText('課表變更尚未確認儲存')).toBeTruthy()
    expect(screen.queryByText(/已刪除並儲存/)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    view.unmount()
    vi.restoreAllMocks()
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<App />)
    confirmTimetableDelete('原課表')
    const external = updateTimetable(data, data.timetables[0].id, { name: '外部分頁課表', teacherName: '林老師' })
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V7_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: raw, newValue: externalRaw, storageArea: localStorage })))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByRole('dialog', { name: '編輯課表資訊' })).toBeTruthy()
    expect(screen.getByText(/其他分頁已更新資料，刪除尚未確認儲存/)).toBeTruthy()
    expect(screen.queryByText(/已刪除並儲存/)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(externalRaw)
  })
})

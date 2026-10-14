// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createProject } from './data/projectRuntime'
import { createBlankProject } from './data/projectRuntime'
import { createTimetable, updateTimetable } from './data/timetablesV6'
import { initialData } from './data/seed'
import { migrateV3ToV4 } from './data/migrationsV4'
import { migrateV4ToV5 } from './data/migrationsV5'
import { migrateV5ToV6 } from './data/migrationsV6'
import { APP_DATA_V1_KEY, APP_DATA_V3_KEY, APP_DATA_V4_KEY } from './data/storageV4'
import { APP_DATA_V6_KEY } from './data/storageV6'
import { APP_DATA_V5_KEY } from './data/storageV5'

function removeAppKeys() {
  localStorage.removeItem(APP_DATA_V6_KEY)
  localStorage.removeItem(APP_DATA_V5_KEY)
  localStorage.removeItem(APP_DATA_V4_KEY)
  localStorage.removeItem(APP_DATA_V3_KEY)
  localStorage.removeItem(APP_DATA_V1_KEY)
}

function copyReadyData() {
  const data = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))
  return updateTimetable(data, data.timetables[0].id, { name: '原課表', teacherName: '林老師' })
}

describe('App v4 runtime', () => {
  beforeEach(() => { vi.useFakeTimers(); removeAppKeys() })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); removeAppKeys() })

  it('多課表載入時自動選取本專案課表，共用事件仍可安全新增', () => {
    const data = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    data.timetables.push({ id: 'teacher-b', projectId: data.projects[0].id, name: 'B 課表', teacherName: '林老師' })
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(data))
    render(<App />)
    expect((screen.getByLabelText('教師課表') as HTMLSelectElement).value).toBe(data.timetables[0].id)
    expect(screen.getByText('待補授課教師')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '會議與活動' }))
    fireEvent.click(screen.getByRole('button', { name: '新增活動' }))
    fireEvent.change(screen.getByLabelText('名稱'), { target: { value: '共同會議' } })
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-09-07' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    expect(stored.timetables).toEqual(data.timetables)
    expect(stored.recurringLessons).toEqual(data.recurringLessons)
    expect(stored.events.at(-1)).toMatchObject({ title: '共同會議', projectId: data.projects[0].id })
  })

  it('同專案可建立兩份空白教師課表並立即切換，切換本身不寫入資料', () => {
    vi.setSystemTime(new Date(2026, 8, 7, 7, 0))
    const data = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    data.events.push({ id: 'shared-meeting', projectId: data.projects[0].id, teachingUnitId: null, title: '共同會議', type: 'meeting',
      date: '2026-09-07', startTime: '12:00', endTime: '13:00', color: '#A66D52', origin: 'user' })
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(data))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    const selector = screen.getByLabelText('教師課表') as HTMLSelectElement
    expect(selector.value).toBe(data.timetables[0].id)
    const addTeacher = (name: string, teacherName: string) => {
      fireEvent.click(screen.getByRole('button', { name: '新增空白課表' }))
      fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: name } })
      fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: teacherName } })
      fireEvent.click(screen.getByRole('button', { name: '建立並切換' }))
      expect(screen.queryByRole('dialog', { name: '新增空白課表' })).toBeNull()
      return selector.value
    }
    const secondId = addTeacher('數學課表', '林老師')
    expect(screen.getByText('林老師')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /編輯 國文/ })).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '總覽' }))
    expect(screen.getByText('共同會議')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    const thirdId = addTeacher('英文課表', '陳老師')
    expect(secondId).not.toBe(thirdId)
    expect((selector.options.length)).toBe(3)
    act(() => vi.advanceTimersByTime(200))
    const saved = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    expect(saved.projects).toEqual(data.projects)
    expect(saved.teachingUnits).toEqual(data.teachingUnits)
    expect(saved.recurringLessons).toEqual(data.recurringLessons)
    expect(saved.overrides).toEqual(data.overrides)
    const write = vi.spyOn(Storage.prototype, 'setItem')
    fireEvent.change(selector, { target: { value: data.timetables[0].id } })
    expect(screen.getAllByRole('button', { name: /編輯 國文/ }).length).toBeGreaterThan(0)
    fireEvent.change(selector, { target: { value: secondId } })
    expect(screen.queryAllByRole('button', { name: /編輯 國文/ })).toHaveLength(0)
    act(() => vi.advanceTimersByTime(200))
    expect(write).not.toHaveBeenCalled()
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(JSON.stringify(saved))
  })

  it('舊課表姓名可補登且保留課程與課表 ID，切換專案會選本專案課表', () => {
    let id = 0
    const source = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    const firstProjectId = source.projects[0].id
    const firstTimetableId = source.timetables[0].id
    const withTeacher = createTimetable(source, firstProjectId, { name: '第二課表', teacherName: '林老師' }, 'teacher-b')
    const withProject = createBlankProject(withTeacher, { name: '下一學期', teacherName: '王老師', academicYear: 116,
      semester: 'first', startDate: '2027-08-30', endDate: '2028-01-20' }, () => `new-${++id}`)
    withProject.activeProjectId = firstProjectId
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(withProject))
    render(<App />)
    expect(screen.getByText('待補授課教師')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '我的課表' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '張老師' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存課表資訊' }))
    expect(screen.getByText('張老師')).toBeTruthy()
    const projectSelector = screen.getByLabelText('課表專案') as HTMLSelectElement
    fireEvent.change(projectSelector, { target: { value: 'new-1' } })
    expect((screen.getByLabelText('教師課表') as HTMLSelectElement).value).toBe(withProject.timetables?.at(-1)?.id)
    expect(screen.getByText('王老師')).toBeTruthy()
    fireEvent.change(projectSelector, { target: { value: firstProjectId } })
    expect((screen.getByLabelText('教師課表') as HTMLSelectElement).value).toBe(firstTimetableId)
    act(() => vi.advanceTimersByTime(200))
    const saved = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    expect(saved.timetables.find((item: { id: string }) => item.id === firstTimetableId)).toMatchObject({ id: firstTimetableId, name: '我的課表', teacherName: '張老師' })
    expect(saved.recurringLessons).toEqual(source.recurringLessons)
  })

  it('封存專案可切換教師唯讀查看，但不提供新增或編輯課表', () => {
    const source = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    const multi = createTimetable(source, source.projects[0].id, { name: '第二課表', teacherName: '林老師' }, 'teacher-b')
    const archived = { ...multi, activeProjectId: null, projects: multi.projects.map((item) => ({ ...item, archivedAt: '2027-02-01T00:00:00.000Z' })) }
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(archived))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '查看' }))
    expect(screen.getByText('歷史專案・唯讀')).toBeTruthy()
    expect((screen.getByLabelText('教師課表') as HTMLSelectElement).value).toBe(source.timetables[0].id)
    fireEvent.change(screen.getByLabelText('教師課表'), { target: { value: 'teacher-b' } })
    expect(screen.getByText('林老師')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '新增空白課表' })).toBeNull()
    expect(screen.queryByRole('button', { name: '編輯課表資訊' })).toBeNull()
    expect(screen.queryByRole('button', { name: '新增固定課程' })).toBeNull()
  })

  it('切到新教師後 Topbar 新增與拖曳異動仍寫入該課表', () => {
    vi.setSystemTime(new Date(2026, 8, 7, 7, 0))
    const source = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    const multi = createTimetable(source, source.projects[0].id, { name: '第二課表', teacherName: '林老師' }, 'teacher-b')
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(multi))
    render(<App />)
    fireEvent.change(screen.getByLabelText('教師課表'), { target: { value: 'teacher-b' } })
    fireEvent.click(screen.getByRole('button', { name: '新增' }))
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    act(() => vi.advanceTimersByTime(200))
    const afterLesson = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    const newLesson = afterLesson.recurringLessons.at(-1)
    expect(newLesson.timetableId).toBe('teacher-b')
    expect(afterLesson.recurringLessons.slice(0, -1)).toEqual(source.recurringLessons)
    const card = screen.getAllByRole('button', { name: /編輯 國文/ })[0]
    const dataTransfer = { effectAllowed: '', setData: vi.fn(), getData: vi.fn() }
    fireEvent.dragStart(card, { dataTransfer })
    const targets = screen.getByLabelText('2026-09-08 可放置節次').querySelectorAll('.lesson-drop-target')
    const target = [...targets].find((item) => item.textContent?.includes('第 8 節'))!
    fireEvent.drop(target, { dataTransfer })
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    act(() => vi.advanceTimersByTime(200))
    const afterDrag = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    expect(afterDrag.overrides.at(-1)).toMatchObject({ timetableId: 'teacher-b', originalLessonId: newLesson.id, action: 'move' })
    expect(afterDrag.recurringLessons.slice(0, -1)).toEqual(source.recurringLessons)
    fireEvent.change(screen.getByLabelText('教師課表'), { target: { value: source.timetables[0].id } })
    expect(screen.getAllByRole('button', { name: /編輯 國文/ }).length).toBeGreaterThan(0)
    expect(screen.queryByText('單日移動')).toBeNull()
  })

  it('新增課表寫入失敗時舊 v6 原文不被部分覆寫', () => {
    const data = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V6_KEY, raw)
    render(<App />)
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V6_KEY) throw new Error('quota')
      return original.call(this, key, value)
    })
    fireEvent.click(screen.getByRole('button', { name: '新增空白課表' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '未儲存課表' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '林老師' } })
    fireEvent.click(screen.getByRole('button', { name: '建立並切換' }))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('資料儲存需要處理')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(raw)
  })

  it('新增課表遇到其他分頁寫入時停止覆寫', () => {
    const data = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V6_KEY, raw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '新增空白課表' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '本分頁課表' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '林老師' } })
    fireEvent.click(screen.getByRole('button', { name: '建立並切換' }))
    const external = createTimetable(data, data.projects[0].id, { name: '其他分頁課表', teacherName: '陳老師' }, 'external')
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: raw, newValue: externalRaw })))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('偵測到多分頁資料衝突')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(externalRaw)
  })

  it('外部分頁移除目前選取時顯示待選提示，不改顯其他教師課程', () => {
    const source = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    const multi = createTimetable(source, source.projects[0].id, { name: '空白課表', teacherName: '林老師' }, 'teacher-b')
    const originalRaw = JSON.stringify(multi)
    localStorage.setItem(APP_DATA_V6_KEY, originalRaw)
    render(<App />)
    fireEvent.change(screen.getByLabelText('教師課表'), { target: { value: 'teacher-b' } })
    const externalRaw = JSON.stringify(source)
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: originalRaw, newValue: externalRaw })))
    expect((screen.getByLabelText('教師課表') as HTMLSelectElement).value).toBe('')
    expect(screen.getByText('請先選擇教師課表。')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /編輯 國文/ })).toHaveLength(0)
  })

  it('編輯視窗開啟後若其他分頁更新同份課表，拒絕舊表單覆寫', () => {
    const source = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    const originalRaw = JSON.stringify(source)
    localStorage.setItem(APP_DATA_V6_KEY, originalRaw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '編輯課表資訊' }))
    const external = updateTimetable(source, source.timetables[0].id, { name: '其他分頁名稱', teacherName: '王老師' })
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: originalRaw, newValue: externalRaw })))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '本分頁名稱' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存課表資訊' }))
    expect(screen.getByRole('alert').textContent).toContain('請關閉後重新開啟編輯')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(externalRaw)
  })

  it('以本地今天預填可編輯欄位，實際寫入後才切換並可重新載入', () => {
    vi.setSystemTime(new Date(2026, 8, 7, 0, 30))
    const data = copyReadyData()
    data.overrides.push({ id: 'source-cancel', projectId: data.projects[0].id, timetableId: data.timetables[0].id,
      teachingUnitId: data.teachingUnits[0].id, date: '2026-09-07', periodId: data.recurringLessons[0].periodId,
      action: 'cancel', originalLessonId: data.recurringLessons[0].id })
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(data))
    const first = render(<App />)
    const sourceId = data.timetables[0].id
    fireEvent.click(screen.getByRole('button', { name: '複製課表' }))
    expect((screen.getByLabelText('課表名稱') as HTMLInputElement).value).toBe('原課表（副本）')
    expect((screen.getByLabelText('授課教師姓名') as HTMLInputElement).value).toBe('林老師')
    expect((screen.getByLabelText('基準日期') as HTMLInputElement).value).toBe('2026-09-07')
    expect(screen.getByText(/包含 A／B 輪週/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '自訂副本' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '王老師' } })
    fireEvent.change(screen.getByLabelText('基準日期'), { target: { value: '2026-09-09' } })
    fireEvent.click(screen.getByRole('button', { name: '複製並切換' }))
    expect(screen.getByRole('dialog', { name: '複製課表' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '正在儲存…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('教師課表') as HTMLSelectElement).value).toBe(sourceId)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByRole('dialog', { name: '複製課表' })).toBeNull()
    expect(screen.getByText('已複製並儲存「自訂副本」。')).toBeTruthy()
    const selectedId = (screen.getByLabelText('教師課表') as HTMLSelectElement).value
    expect(selectedId).not.toBe(sourceId)
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    const copiedLessons = stored.recurringLessons.filter((item: { timetableId: string }) => item.timetableId === selectedId)
    expect(stored.timetables.find((item: { id: string }) => item.id === selectedId)).toMatchObject({ name: '自訂副本', teacherName: '王老師' })
    expect(copiedLessons).toHaveLength(data.recurringLessons.length)
    expect(new Set(copiedLessons.map((item: { day: number }) => item.day))).toEqual(new Set([1, 2, 3, 4, 5]))
    expect(new Set(copiedLessons.map((item: { weekPattern: string }) => item.weekPattern))).toEqual(new Set(['every', 'A', 'B']))
    expect(copiedLessons.every((item: { effectiveStart: string; effectiveEnd: string; origin: string }) => item.effectiveStart === '2026-09-09' && item.effectiveEnd === data.teachingUnits[0].endDate && item.origin === 'demo')).toBe(true)
    expect(stored.overrides).toEqual(data.overrides)
    expect(copiedLessons.every((item: { id: string; seriesId: string }) => !data.recurringLessons.some((source) => source.id === item.id || source.seriesId === item.seriesId))).toBe(true)
    first.unmount()
    render(<App />)
    expect(screen.getByRole('option', { name: '自訂副本・王老師' })).toBeTruthy()
  })

  it('待補教師不可複製，封存專案也不提供複製入口', () => {
    const pending = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(pending))
    const current = render(<App />)
    expect(screen.queryByRole('button', { name: '複製課表' })).toBeNull()
    current.unmount()
    const archived = copyReadyData()
    archived.activeProjectId = null
    archived.projects[0] = { ...archived.projects[0], archivedAt: '2027-02-01T00:00:00.000Z' }
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(archived))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '查看' }))
    expect(screen.queryByRole('button', { name: '複製課表' })).toBeNull()
  })

  it('空白欄位與不存在的日期都不會建立副本', () => {
    const data = copyReadyData()
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(data))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '複製課表' }))
    const form = screen.getByRole('dialog', { name: '複製課表' }).querySelector('form')!
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '   ' } })
    fireEvent.submit(form)
    expect(screen.getByRole('alert').textContent).toContain('不可空白')
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '副本' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '   ' } })
    fireEvent.submit(form)
    expect(screen.getByRole('alert').textContent).toContain('不可空白')
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '林老師' } })
    fireEvent.change(screen.getByLabelText('基準日期'), { target: { value: '2026-02-30' } })
    fireEvent.submit(form)
    expect(screen.getByRole('alert').textContent).toContain('真實有效')
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).timetables).toHaveLength(1)
  })

  it('開啟表單後來源固定課程變動會拒絕 stale copy 並保留輸入', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V6_KEY, raw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '複製課表' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '保留的名稱' } })
    const external = structuredClone(data)
    external.recurringLessons[0].room = '其他分頁教室'
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: raw, newValue: externalRaw })))
    fireEvent.click(screen.getByRole('button', { name: '複製並切換' }))
    expect(screen.getByRole('alert').textContent).toContain('已變更')
    expect((screen.getByLabelText('課表名稱') as HTMLInputElement).value).toBe('保留的名稱')
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).timetables).toHaveLength(1)
  })

  it('複製中的多分頁衝突不覆寫外部資料，採用外部版本後保留表單', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V6_KEY, raw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '複製課表' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '本分頁副本' } })
    fireEvent.click(screen.getByRole('button', { name: '複製並切換' }))
    const external = updateTimetable(data, data.timetables[0].id, { name: '外部分頁課表', teacherName: '林老師' })
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: raw, newValue: externalRaw })))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByText('偵測到多分頁資料衝突')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(externalRaw)
    fireEvent.click(screen.getByRole('button', { name: '採用其他分頁版本' }))
    expect(screen.getByRole('dialog', { name: '複製課表' })).toBeTruthy()
    expect((screen.getByLabelText('課表名稱') as HTMLInputElement).value).toBe('本分頁副本')
    expect(screen.getByRole('alert').textContent).toContain('未完成')
  })

  it('複製寫入失敗不誤報成功，且重複點擊只建立一份副本', () => {
    const data = copyReadyData()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V6_KEY, raw)
    const first = render(<App />)
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V6_KEY) throw new Error('quota')
      return original.call(this, key, value)
    })
    fireEvent.click(screen.getByRole('button', { name: '複製課表' }))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '未寫入副本' } })
    const submit = screen.getByRole('button', { name: '複製並切換' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.queryByText(/已複製並儲存/)).toBeNull()
    expect(screen.getByRole('dialog', { name: '複製課表' })).toBeTruthy()
    expect((screen.getByLabelText('課表名稱') as HTMLInputElement).value).toBe('未寫入副本')
    expect(screen.getByText(/資料尚未成功寫入此裝置/)).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(raw)
    first.unmount()
    vi.restoreAllMocks()
    localStorage.setItem(APP_DATA_V6_KEY, raw)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '複製課表' }))
    const successfulSubmit = screen.getByRole('button', { name: '複製並切換' })
    fireEvent.click(successfulSubmit)
    fireEvent.click(successfulSubmit)
    act(() => vi.advanceTimersByTime(200))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).timetables).toHaveLength(2)
  })

  it('舊 SubjectPanel 變更顏色須確認，且不經 legacy merge 改寫科目適用學制', () => {
    const data = migrateV4ToV5(migrateV3ToV4(initialData))
    data.subjects[0].applicableSchoolLevels = ['other']
    localStorage.setItem(APP_DATA_V5_KEY, JSON.stringify(data))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '科目與班級' }))
    const input = screen.getByLabelText('國文 顏色')
    fireEvent.change(input, { target: { value: '#123456' } })
    expect(confirm).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(200))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V5_KEY)!).subjects[0].color).toBe(data.subjects[0].color)
    confirm.mockReturnValue(true)
    fireEvent.change(input, { target: { value: '#654321' } })
    act(() => vi.advanceTimersByTime(200))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).subjects[0]).toMatchObject({
      id: data.subjects[0].id, color: '#654321', applicableSchoolLevels: ['other'],
    })
  })

  it('首次使用不自動建立範例，預覽範例也不污染正式資料', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '建立空白課表' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看範例' }))
    expect(screen.getByText('唯讀範例')).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
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
    fireEvent.click(screen.getByRole('button', { name: '建立空白課表' }))
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '我的新課表' } })
    fireEvent.change(screen.getByLabelText('授課教師姓名'), { target: { value: '陳老師' } })
    fireEvent.click(screen.getByRole('button', { name: '建立並開始' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
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
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).activeProjectId).toBe('project-2')
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBeNull()
  })

  it('v3 migration 失敗時鎖定課表編輯且不建立 v4', () => {
    localStorage.setItem(APP_DATA_V3_KEY, '{broken-v3')
    render(<App />)
    expect(screen.getByText('資料尚未載入')).toBeTruthy()
    expect(screen.queryByText('本週課表')).toBeNull()
    act(() => vi.advanceTimersByTime(500))
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe('{broken-v3')
  })

  it('LessonEditor 直接寫入 v4 並在重新載入後保留固定課程', () => {
    const data = migrateV3ToV4(initialData)
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(data))
    const first = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '新增' }))
    fireEvent.change(screen.getByLabelText('課程星期'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('課程節次'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('課程輪週'), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    expect(stored.recurringLessons).toHaveLength(data.recurringLessons.length + 1)
    expect(stored.recurringLessons.at(-1)).toMatchObject({ projectId: data.activeProjectId, day: 5, periodId: 8, weekPattern: 'B' })
    first.unmount()
    render(<App />)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).recurringLessons).toHaveLength(data.recurringLessons.length + 1)
  })

  it('桌面拖曳經預覽確認後寫入 v4，重新載入仍保留單日移動', () => {
    vi.setSystemTime(new Date(2026, 8, 7, 7, 0))
    const data = migrateV3ToV4(initialData)
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(data))
    const first = render(<App />)
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
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).overrides.at(-1)).toMatchObject({ action: 'move', originalLessonId: 'c1', target: { date: '2026-09-08', periodId: 8 } })
    first.unmount()
    render(<App />)
    expect(screen.getByText('單日移動')).toBeTruthy()
  })
})

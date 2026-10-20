// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { useAppDataV4 } from '../hooks/useAppDataV4'
import { useResourceManagementSession } from '../hooks/useResourceManagementSession'
import type { AppDataV7 } from '../types'
import App from '../App'
import { CourseResourceManager, CourseResourceManagerDialog } from './CourseResourceManager'

const fixture = () => migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))
function storageFixture() {
  const data = migrateV6ToV7(migrateV5ToV6(fixture()))
  data.recurringLessons = []
  data.overrides = []
  return data
}
function StorageHarness({ mode }: { mode: 'subjects' | 'classes' }) {
  const [data, setData, status, controls, persistence] = useAppDataV4()
  const session = useResourceManagementSession(data, setData, status, persistence)
  const [mounted, setMounted] = useState(true)
  const [open, setOpen] = useState(true)
  return <>
    <output data-testid="session">{JSON.stringify({ state: session.status, keys: session.dirtyKeys, operation: session.operation?.type, operationStatus: session.operation?.status, targetId: session.operation?.targetId, revision: persistence.revision, pending: persistence.pending, storageStatus: status })}</output>
    <output data-testid="memory">{JSON.stringify(data)}</output>
    <button onClick={() => setMounted(!mounted)}>切換掛載</button>
    <button onClick={() => setOpen(true)}>重開管理</button>
    {mounted && open && <CourseResourceManagerDialog data={data} setData={setData} mode={mode} storageStatus={status}
      storagePersistence={persistence} storageControls={controls} session={session} onClose={() => setOpen(false)} onOpenSettings={() => setOpen(false)} />}
  </>
}
function startStorage(mode: 'subjects' | 'classes' = 'subjects', data = storageFixture()) {
  vi.useFakeTimers()
  localStorage.clear()
  const raw = JSON.stringify(data)
  localStorage.setItem(APP_DATA_V7_KEY, raw)
  const view = render(<StorageHarness mode={mode} />)
  return { ...view, data, raw }
}
const flush = () => act(() => vi.advanceTimersByTime(200))
const stored = () => JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV7
const memory = () => JSON.parse(screen.getByTestId('memory').textContent!) as AppDataV7
const sessionState = () => JSON.parse(screen.getByTestId('session').textContent!) as { state: string; operationStatus: string; keys: string[]; targetId: string; revision: number; pending: boolean; storageStatus: string }
const subjectRow = (name = '國文') => screen.getByRole('form', { name: `管理科目 ${name}` })
function receive(data: AppDataV7) {
  const oldValue = localStorage.getItem(APP_DATA_V7_KEY)
  const newValue = JSON.stringify(data)
  localStorage.setItem(APP_DATA_V7_KEY, newValue)
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue, newValue, storageArea: localStorage })))
  return newValue
}
function addSubject(name = '閱讀策略') {
  fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: '新增科目' }))
}
beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('CourseResourceManager', () => {
  it('班級明確依學校與學制選取，不受課表篩選影響，並沿用單次更新', () => {
    const data = fixture()
    const source = data.teachingUnits[0]
    data.schools.push({ id: 'second-school', projectId: data.activeProjectId!, name: '第二學校', color: '#345678' })
    data.teachingUnits.push({ ...structuredClone(source), id: 'second-unit', schoolId: 'second-school', name: '高中部', schoolLevel: 'senior-high' })
    const setData = vi.fn()
    render(<CourseResourceManager data={data} setData={setData} mode="classes" />)
    expect(screen.getByLabelText('學校')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('學校'), { target: { value: 'second-school' } })
    expect((screen.getByLabelText('目前學制') as HTMLSelectElement).value).toBe('second-unit')
    expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull()
    expect(screen.queryByLabelText(/所屬學制/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級班號'), { target: { value: '3' } })
    fireEvent.click(within(screen.getByRole('form', { name: '新增班級表單' })).getByRole('button', { name: '新增班級' }))
    expect(setData).toHaveBeenCalledTimes(1)
    expect(setData.mock.calls[0][0](data).classes.at(-1)).toMatchObject({ teachingUnitId: 'second-unit', classNumber: 3 })
    expect(data.classes.every((item) => item.teachingUnitId !== 'second-unit')).toBe(true)
    // A mocked setter without storage evidence cannot complete the creation.
    expect(screen.getByRole('form', { name: '新增班級表單' })).toBeTruthy()
    expect(screen.queryByText(/^已儲存：/)).toBeNull()
  })

  it('每列不重複顯示學制，國中與高中使用各自年級選項', () => {
    const data = fixture()
    const senior = data.teachingUnits[0]
    senior.schoolLevel = 'senior-high'
    data.classes[0] = { ...data.classes[0], grade: 1, classNumber: 8, name: '108' }
    const junior = { ...structuredClone(senior), id: 'junior-unit', name: '國中部', schoolLevel: 'junior-high' as const }
    data.teachingUnits.push(junior)
    data.classes.push({ ...structuredClone(data.classes[0]), id: 'junior-class', teachingUnitId: junior.id, grade: 7, classNumber: 8, name: '708' })
    render(<CourseResourceManager data={data} setData={vi.fn()} mode="classes" />)

    expect(screen.queryByLabelText(/所屬學制/)).toBeNull()
    expect(screen.getAllByRole('option', { name: '高中一年級' }).length).toBeGreaterThan(0)
    expect(screen.getByText('顯示：108')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('目前學制'), { target: { value: junior.id } })
    expect(screen.getAllByRole('option', { name: '七年級' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('option', { name: '高中一年級' })).toBeNull()
    expect(screen.getByText('顯示：708')).toBeTruthy()
  })

  it('新增表單按需開啟，取消不寫入且不留下空白表單', () => {
    const data = fixture()
    const setData = vi.fn()
    render(<CourseResourceManager data={data} setData={setData} mode="classes" />)
    expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    expect(screen.getByRole('form', { name: '新增班級表單' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '不儲存的班級' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(setData).not.toHaveBeenCalled()
    expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull()
  })

  it('新增驗證失敗時保留表單與超長教室內容', () => {
    const data = fixture()
    const setData = vi.fn()
    render(<CourseResourceManager data={data} setData={setData} mode="classes" />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '保留草稿' } })
    const room = screen.getByLabelText('新班級教室') as HTMLInputElement
    fireEvent.change(room, { target: { value: '1234567890123456' } })
    fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    expect(setData).not.toHaveBeenCalled()
    expect(screen.getByRole('form', { name: '新增班級表單' })).toBeTruthy()
    expect(room.value).toBe('1234567890123456')
    expect(room.maxLength).toBe(15)
    expect(screen.getAllByRole('alert').some((item) => item.textContent?.includes('最多 15 個字元'))).toBe(true)
  })

  it('載入時保留既有超過 15 字的教室並要求修正後才能儲存', () => {
    const data = fixture()
    data.classes[0].room = '既有超過十五個字元的教室名稱需要保留'
    const setData = vi.fn()
    render(<CourseResourceManager data={data} setData={setData} mode="classes" />)
    const room = screen.getAllByLabelText('班級教室')[0] as HTMLInputElement
    expect(room.value).toBe('既有超過十五個字元的教室名稱需要保留')
    expect(room.getAttribute('aria-invalid')).toBe('true')
    fireEvent.click(screen.getAllByRole('button', { name: '儲存' })[0])
    expect(setData).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((item) => item.textContent?.includes('既有內容已保留'))).toBe(true)
  })

  it('切換學校會收起舊草稿，新班級只寫入新學制', () => {
    const data = fixture()
    const source = data.teachingUnits[0]
    data.schools.push({ id: 'second-school', projectId: data.activeProjectId!, name: '第二學校', color: '#345678' })
    data.teachingUnits.push({ ...structuredClone(source), id: 'second-unit', schoolId: 'second-school', name: '高中部', schoolLevel: 'senior-high' })
    const setData = vi.fn()
    render(<CourseResourceManager data={data} setData={setData} mode="classes" />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '舊草稿' } })
    fireEvent.change(screen.getByLabelText('學校'), { target: { value: 'second-school' } })
    expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級班號'), { target: { value: '9' } })
    fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    expect(setData.mock.calls[0][0](data).classes.at(-1)).toMatchObject({ teachingUnitId: 'second-unit', grade: 1, classNumber: 9 })
  })

  it('確認持久化成功後才收起表單，且不自動開下一筆空白表單', () => {
    startStorage('classes')
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '新建立班級' } })
    fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    expect(screen.getByRole('form', { name: '新增班級表單' })).toBeTruthy()
    flush()
    expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull()
    expect(screen.getByRole('button', { name: '＋ 新增班級' })).toBeTruthy()
    expect(stored().classes.at(-1)?.name).toBe('新建立班級')
  })

  it('持久化失敗時保留新增表單與輸入內容', () => {
    const data = fixture()
    const setData = vi.fn()
    const view = render(<CourseResourceManager data={data} setData={setData} mode="classes" storagePersistence={{ pending: false, revision: 3 }} />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '等待重試' } })
    fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    view.rerender(<CourseResourceManager data={data} setData={setData} mode="classes" storageStatus="write-error" storagePersistence={{ pending: false, revision: 3 }} />)
    expect(screen.getByRole('alert').textContent).toContain('尚未成功寫入')
    expect(screen.getByRole('form', { name: '新增班級表單' })).toBeTruthy()
    expect((screen.getByLabelText('新班級名稱') as HTMLInputElement).value).toBe('等待重試')
  })

  it('舊資料若有重複學制，不會任選第一筆', () => {
    const data = fixture()
    data.teachingUnits.push({ ...structuredClone(data.teachingUnits[0]), id: 'duplicate-unit', name: '舊設定' })
    render(<CourseResourceManager data={data} setData={vi.fn()} mode="classes" />)
    expect((screen.getByLabelText('目前學制') as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('option', { name: /重複設定 2：舊設定/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '＋ 新增班級' })).toBeNull()
  })

  it('班級編輯保留 ID，刪除受既有課程引用保護', () => {
    const data = fixture()
    const used = data.classes.find((item) => data.recurringLessons.some((lesson) => lesson.classId === item.id))!
    const setData = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CourseResourceManager data={data} setData={setData} mode="classes" />)
    const rows = screen.getAllByRole('button', { name: '刪除' })
    const index = data.classes.filter((item) => item.teachingUnitId === data.teachingUnits[0].id).findIndex((item) => item.id === used.id)
    fireEvent.click(rows[index])
    expect(setData).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('引用')
    fireEvent.change(screen.getAllByLabelText('班級教室')[index], { target: { value: '新教室' } })
    fireEvent.click(screen.getAllByRole('button', { name: '儲存' })[index])
    const next = setData.mock.calls[0][0](data)
    expect(next.classes.find((item: typeof used) => item.id === used.id)).toMatchObject({ id: used.id, room: '新教室' })
  })

  it('科目仍為全域資料，新增按所選學制適用且既有 ID 與顏色不變', () => {
    const data = fixture()
    const before = structuredClone(data.subjects)
    const setData = vi.fn()
    render(<CourseResourceManager data={data} setData={setData} mode="subjects" />)
    expect(screen.getAllByText(/科目庫由所有課表專案共用/).length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '新科目' } })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))
    const next = setData.mock.calls[0][0](data)
    expect(next.subjects.at(-1)).toMatchObject({ name: '新科目', applicableSchoolLevels: [data.teachingUnits[0].schoolLevel] })
    expect(next.subjects.slice(0, -1)).toEqual(before)
  })

  it('科目變更與刪除使用既有確認及引用保護，失敗時保留資料', () => {
    const data = fixture()
    const subject = data.subjects.find((item) => data.recurringLessons.some((lesson) => lesson.subjectId === item.id))!
    const setData = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CourseResourceManager data={data} setData={setData} mode="subjects" />)
    fireEvent.click(within(screen.getByRole('form', { name: `管理科目 ${subject.name}` })).getByRole('button', { name: '刪除科目' }))
    expect(setData).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('引用')
    expect(data.subjects.find((item) => item.id === subject.id)).toEqual(subject)
  })

  it('科目編輯需確認全域影響，並可查看其他學制的科目', () => {
    const data = fixture()
    const subject = data.subjects[0]
    const setData = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    data.subjects.push({ id: 'senior-only', name: '高中限定', shortName: '高限', color: '#123456', applicableSchoolLevels: ['senior-high'] })
    render(<CourseResourceManager data={data} setData={setData} mode="subjects" />)
    expect(screen.queryByLabelText('高中限定名稱')).toBeNull()
    fireEvent.click(screen.getByLabelText('顯示全域所有科目'))
    expect(screen.getByLabelText('高中限定名稱')).toBeTruthy()
    const form = screen.getByRole('form', { name: `管理科目 ${subject.name}` })
    fireEvent.change(within(form).getByLabelText(`${subject.name}顏色`), { target: { value: '#123456' } })
    fireEvent.click(within(form).getByRole('button', { name: '儲存科目' }))
    expect(setData).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.click(within(form).getByRole('button', { name: '儲存科目' }))
    const next = setData.mock.calls[0][0](data)
    expect(next.subjects.find((item: typeof subject) => item.id === subject.id)).toMatchObject({ id: subject.id, color: '#123456' })
  })

  it('沒有學制時顯示設定引導；封存專案無法修改', () => {
    const data = fixture()
    data.teachingUnits = []
    const open = vi.fn()
    const { rerender } = render(<CourseResourceManager data={data} setData={vi.fn()} mode="classes" onOpenSettings={open} />)
    fireEvent.click(screen.getByRole('button', { name: '前往專案設定' }))
    expect(open).toHaveBeenCalledTimes(1)
    const archived = fixture()
    archived.projects.find((item) => item.id === archived.activeProjectId)!.archivedAt = '2026-10-18T00:00:00.000Z'
    rerender(<CourseResourceManager data={archived} setData={vi.fn()} mode="classes" />)
    expect((screen.getByRole('button', { name: '＋ 新增班級' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull()
  })

  it('視窗開啟會移入焦點並可關閉，適合窄螢幕操作', () => {
    vi.stubGlobal('innerWidth', 390)
    const close = vi.fn()
    render(<CourseResourceManagerDialog data={fixture()} setData={vi.fn()} mode="classes" onClose={close} />)
    expect(screen.getByRole('dialog', { name: '管理班級' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('學校'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})

describe('resource session with real v7 storage', () => {
  it.each(['subjects', 'classes'] as const)('%s returns to clean after restoring the original editable values', (mode) => {
    startStorage(mode)
    const field = mode === 'subjects' ? screen.getByLabelText('國文名稱') : screen.getAllByLabelText('班級教室')[0]
    const original = (field as HTMLInputElement).value
    fireEvent.change(field, { target: { value: '未提交草稿' } })
    expect(sessionState().state).toBe('dirty')
    fireEvent.change(field, { target: { value: original } })
    expect(sessionState().state).toBe('clean')
    fireEvent.click(screen.getByRole('button', { name: '關閉對話框' }))
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('restores clean when school-level checkboxes return to the original set in a different order', () => {
    startStorage()
    const field = within(subjectRow()).getByRole('checkbox', { name: '國中部' })
    fireEvent.click(field)
    expect(sessionState().state).toBe('dirty')
    fireEvent.click(field)
    expect(sessionState().state).toBe('clean')
  })

  it('restores clean when structured class grade/number are changed back, without rewriting the derived name', () => {
    const data = storageFixture()
    data.teachingUnits[0].schoolLevel = 'senior-high'
    data.classes[0] = { ...data.classes[0], grade: 1, classNumber: 8, name: '108' }
    const { raw } = startStorage('classes', data)
    const row = screen.getByRole('form', { name: '管理班級 108' })
    fireEvent.change(within(row).getByLabelText('班級年級'), { target: { value: '2' } })
    expect(sessionState().state).toBe('dirty')
    fireEvent.change(within(row).getByLabelText('班級年級'), { target: { value: '1' } })
    expect(sessionState().state).toBe('clean')
    fireEvent.change(within(row).getByLabelText('班級班號'), { target: { value: '9' } })
    expect(sessionState().state).toBe('dirty')
    fireEvent.change(within(row).getByLabelText('班級班號'), { target: { value: '8' } })
    expect(sessionState().state).toBe('clean')
    fireEvent.click(within(row).getByRole('button', { name: '儲存' }))
    flush()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })

  it.each(['x', 'escape', 'backdrop'] as const)('refusing %s preserves all row and creation drafts without writing', (close) => {
    const { raw } = startStorage()
    fireEvent.change(screen.getByLabelText('國文名稱'), { target: { value: '國文草稿' } })
    fireEvent.change(screen.getByLabelText('歷史簡稱'), { target: { value: '英草' } })
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '新增草稿' } })
    vi.mocked(window.confirm).mockReturnValue(false)
    if (close === 'x') fireEvent.click(screen.getByRole('button', { name: '關閉對話框' }))
    else if (close === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
    else fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByLabelText('國文名稱') as HTMLInputElement).value).toBe('國文草稿')
    expect((screen.getByLabelText('歷史簡稱') as HTMLInputElement).value).toBe('英草')
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('新增草稿')
    flush()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })

  it('retains drafts and selectors across manager unmounts and unrelated external updates', () => {
    const { data } = startStorage()
    fireEvent.change(screen.getByLabelText('國文名稱'), { target: { value: '保留國文' } })
    fireEvent.change(screen.getByLabelText('歷史簡稱'), { target: { value: '保留英' } })
    fireEvent.click(screen.getByRole('button', { name: '切換掛載' }))
    receive({ ...data, projects: data.projects.map((item) => ({ ...item, name: '外部分頁專案名稱' })) })
    fireEvent.click(screen.getByRole('button', { name: '切換掛載' }))
    expect((screen.getByLabelText('國文名稱') as HTMLInputElement).value).toBe('保留國文')
    expect((screen.getByLabelText('歷史簡稱') as HTMLInputElement).value).toBe('保留英')
    expect(sessionState().keys).toHaveLength(2)
  })

  it.each(['changed', 'deleted'] as const)('keeps a subject draft when its source is %s and forbids stale writes', (kind) => {
    const { data } = startStorage()
    fireEvent.change(screen.getByLabelText('國文名稱'), { target: { value: '我的科目草稿' } })
    const id = data.subjects.find((item) => item.name === '國文')!.id
    const external = { ...data, subjects: kind === 'deleted' ? data.subjects.filter((item) => item.id !== id)
      : data.subjects.map((item) => item.id === id ? { ...item, color: '#112233' } : item) }
    const raw = receive(external)
    expect((screen.getByLabelText('國文名稱') as HTMLInputElement).value).toBe('我的科目草稿')
    const save = within(subjectRow()).getByRole('button', { name: '儲存科目' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(save)
    flush()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(sessionState().keys).toContain(`subject:${id}`)
  })

  it('refuses unit switches without changing drafts, and accepts by discarding only hidden drafts', () => {
    const data = storageFixture()
    data.teachingUnits.push({ ...data.teachingUnits[0], id: 'junior-extra', schoolLevel: 'junior-high', name: '國中部' })
    const { raw } = startStorage('classes', data)
    const originalUnit = (screen.getByLabelText('目前學制') as HTMLSelectElement).value
    fireEvent.change(screen.getAllByLabelText('班級教室')[0], { target: { value: '班級草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '新增班級草稿' } })
    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.change(screen.getByLabelText('目前學制'), { target: { value: 'junior-extra' } })
    expect((screen.getByLabelText('目前學制') as HTMLSelectElement).value).toBe(originalUnit)
    expect((screen.getAllByLabelText('班級教室')[0] as HTMLInputElement).value).toBe('班級草稿')
    expect((screen.getByLabelText('新班級名稱') as HTMLInputElement).value).toBe('新增班級草稿')
    vi.mocked(window.confirm).mockReturnValue(true)
    fireEvent.change(screen.getByLabelText('目前學制'), { target: { value: 'junior-extra' } })
    expect((screen.getByLabelText('目前學制') as HTMLSelectElement).value).toBe('junior-extra')
    expect(sessionState().keys).toHaveLength(0)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })

  it('filter refusal preserves scope, acceptance discards hidden rows but keeps still-visible drafts', () => {
    const data = storageFixture()
    data.subjects.push({ id: 'senior-only', name: '高中專用', shortName: '高專', color: '#123456', applicableSchoolLevels: ['senior-high'] })
    startStorage('subjects', data)
    fireEvent.click(screen.getByLabelText('顯示全域所有科目'))
    fireEvent.change(screen.getByLabelText('高中專用名稱'), { target: { value: '高中草稿' } })
    fireEvent.change(screen.getByLabelText('國文名稱'), { target: { value: '仍可見草稿' } })
    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.click(screen.getByLabelText('顯示全域所有科目'))
    expect((screen.getByLabelText('顯示全域所有科目') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('高中專用名稱') as HTMLInputElement).value).toBe('高中草稿')
    vi.mocked(window.confirm).mockReturnValue(true)
    fireEvent.click(screen.getByLabelText('顯示全域所有科目'))
    expect(screen.queryByLabelText('高中專用名稱')).toBeNull()
    expect((screen.getByLabelText('國文名稱') as HTMLInputElement).value).toBe('仍可見草稿')
    expect(sessionState().keys).toHaveLength(1)
  })

  it('subject creation waits for storage, blocks close/scope changes/duplicate submits, then clears only its draft', () => {
    const { raw } = startStorage()
    fireEvent.change(screen.getByLabelText('國文名稱'), { target: { value: '另一筆草稿' } })
    addSubject()
    const id = sessionState().targetId
    fireEvent.submit(screen.getByLabelText('新科目名稱').closest('form')!)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByLabelText('顯示全域所有科目'))
    expect((screen.getByLabelText('顯示全域所有科目') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('閱讀策略')
    expect(screen.queryByText(/^已儲存：/)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(memory().subjects.filter((item) => item.id === id)).toHaveLength(1)
    flush()
    expect(stored().subjects.filter((item) => item.id === id)).toHaveLength(1)
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('國文名稱') as HTMLInputElement).value).toBe('另一筆草稿')
    expect(screen.getByText('已儲存：已新增科目。')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('subject edit, level removal and deletion complete only after matching writes and survive reload', () => {
    const view = startStorage()
    fireEvent.change(screen.getByLabelText('國文簡稱'), { target: { value: '國語文' } })
    fireEvent.click(within(subjectRow()).getByRole('button', { name: '儲存科目' }))
    expect(stored().subjects.find((item) => item.name === '國文')!.shortName).not.toBe('國語文')
    expect(screen.queryByText('已儲存：已更新科目。')).toBeNull()
    flush()
    expect(stored().subjects.find((item) => item.name === '國文')!.shortName).toBe('國語文')
    expect(sessionState().state).toBe('persisted')
    fireEvent.click(within(subjectRow()).getByRole('button', { name: '刪除科目' }))
    expect(stored().subjects.some((item) => item.name === '國文')).toBe(true)
    expect(screen.queryByText('已儲存：已刪除科目。')).toBeNull()
    flush()
    expect(stored().subjects.some((item) => item.name === '國文')).toBe(false)
    view.unmount()
    render(<StorageHarness mode="subjects" />)
    expect(screen.queryByRole('form', { name: '管理科目 國文' })).toBeNull()
  })

  it('class edit and deletion confirm identity, content and unit only after persistence', () => {
    const { data } = startStorage('classes')
    const source = data.classes[0]
    const row = () => screen.getByRole('form', { name: `管理班級 ${source.name}` })
    fireEvent.change(within(row()).getByLabelText('班級教室'), { target: { value: '新教室' } })
    fireEvent.click(within(row()).getByRole('button', { name: '儲存' }))
    expect(stored().classes.find((item) => item.id === source.id)!.room).not.toBe('新教室')
    flush()
    expect(stored().classes.find((item) => item.id === source.id)).toMatchObject({ id: source.id, projectId: source.projectId, teachingUnitId: source.teachingUnitId, room: '新教室' })
    fireEvent.click(within(row()).getByRole('button', { name: '刪除' }))
    expect(stored().classes.some((item) => item.id === source.id)).toBe(true)
    flush()
    expect(stored().classes.some((item) => item.id === source.id)).toBe(false)
    expect(screen.getByText('已儲存：已刪除班級。')).toBeTruthy()
  })

  it.each(['subjects', 'classes'] as const)('%s write failure retains input/operation and retries the same document without another ID', (mode) => {
    const { raw } = startStorage(mode)
    const setItem = Storage.prototype.setItem
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V7_KEY) throw new DOMException('full', 'QuotaExceededError')
      return setItem.call(this, key, value)
    })
    if (mode === 'subjects') addSubject()
    else {
      fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
      fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '寫入失敗班級' } })
      fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    }
    const id = sessionState().targetId
    flush()
    expect(sessionState().state).toBe('blocked')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(screen.queryByText(/^已儲存：/)).toBeNull()
    expect((screen.getByLabelText(mode === 'subjects' ? '新科目名稱' : '新班級名稱') as HTMLInputElement).value).not.toBe('')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    write.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: '保留本頁完整資料並重試儲存' }))
    expect(stored()[mode].filter((item) => item.id === id)).toHaveLength(1)
    expect(sessionState().targetId).toBe(id)
    expect(sessionState().state).toBe('persisted')
  })

  it('external adoption preserves input and invalidates an old submission even if a later write succeeds', () => {
    const { data } = startStorage()
    addSubject()
    const oldId = sessionState().targetId
    const raw = receive({ ...data, projects: data.projects.map((item) => ({ ...item, name: '外部專案' })) })
    flush()
    expect(sessionState().state).toBe('blocked')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    fireEvent.click(screen.getByRole('button', { name: '採用其他分頁版本' }))
    expect(sessionState().state).toBe('unconfirmed')
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('閱讀策略')
    expect(screen.queryByText(/^已儲存：/)).toBeNull()
    expect(stored().subjects.some((item) => item.id === oldId)).toBe(false)
    fireEvent.change(screen.getByLabelText('歷史簡稱'), { target: { value: '英語文' } })
    fireEvent.click(within(subjectRow('歷史')).getByRole('button', { name: '儲存科目' }))
    flush()
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('閱讀策略')
    expect(stored().subjects.some((item) => item.id === oldId)).toBe(false)
  })

  it('refusing a school switch preserves both class edits and the creation context', () => {
    const data = storageFixture()
    data.schools.push({ id: 'second-school', projectId: data.activeProjectId!, name: '第二學校', color: '#123456' })
    data.teachingUnits.push({ ...data.teachingUnits[0], id: 'second-unit', schoolId: 'second-school' })
    startStorage('classes', data)
    fireEvent.change(screen.getAllByLabelText('班級教室')[0], { target: { value: '不能遺失' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '原校草稿' } })
    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.change(screen.getByLabelText('學校'), { target: { value: 'second-school' } })
    expect((screen.getByLabelText('學校') as HTMLSelectElement).value).toBe(data.schools[0].id)
    expect((screen.getByLabelText('目前學制') as HTMLSelectElement).value).toBe(data.teachingUnits[0].id)
    expect((screen.getByLabelText('新班級名稱') as HTMLInputElement).value).toBe('原校草稿')
    expect((screen.getAllByLabelText('班級教室')[0] as HTMLInputElement).value).toBe('不能遺失')
  })

  it.each(['changed', 'deleted'] as const)('retains class row drafts when the source is %s without recreating it', (kind) => {
    const { data } = startStorage('classes')
    const source = data.classes[0]
    const row = () => screen.getByRole('form', { name: `管理班級 ${source.name}` })
    fireEvent.change(within(row()).getByLabelText('班級教室'), { target: { value: '自己的班級草稿' } })
    const external = { ...data, classes: kind === 'deleted' ? data.classes.filter((item) => item.id !== source.id)
      : data.classes.map((item) => item.id === source.id ? { ...item, room: '外部教室' } : item) }
    const raw = receive(external)
    expect((within(row()).getByLabelText('班級教室') as HTMLInputElement).value).toBe('自己的班級草稿')
    expect((within(row()).getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(row())
    flush()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(sessionState().keys).toContain(`class:${source.id}`)
  })

  it('does not silently reassign a creation draft after its TeachingUnit changes externally', () => {
    const { data } = startStorage()
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '原學制科目' } })
    const raw = receive({ ...data, teachingUnits: data.teachingUnits.map((item) => ({ ...item, schoolLevel: 'junior-high' })) })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))
    expect(screen.getByRole('alert').textContent).toContain('草稿所屬學制已變更或刪除')
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('原學制科目')
    flush()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })

  it('preserves orphaned creation input and guards a settings jump before clearing any state', () => {
    const { data } = startStorage()
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '原學制新增草稿' } })
    receive({ ...data, teachingUnits: [], schools: [], classes: [], events: [], migrationWarnings: [] })
    expect(screen.getByLabelText('保留的新增草稿').textContent).toContain('原學制新增草稿')
    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '前往專案設定' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('保留的新增草稿').textContent).toContain('原學制新增草稿')
    vi.mocked(window.confirm).mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '前往專案設定' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(sessionState().keys).toHaveLength(0)
  })

  it('retains a deletion operation through conflict and confirms only a deliberate keep-local write', () => {
    const { data } = startStorage()
    fireEvent.click(within(subjectRow()).getByRole('button', { name: '刪除科目' }))
    const id = sessionState().targetId
    const raw = receive({ ...data, projects: data.projects.map((item) => ({ ...item, name: '另一分頁' })) })
    flush()
    expect(sessionState().state).toBe('blocked')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByText('已儲存：已刪除科目。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保留本頁完整資料並重試儲存' }))
    expect(stored().subjects.some((item) => item.id === id)).toBe(false)
    expect(sessionState().state).toBe('persisted')
    expect(screen.getByText('已儲存：已刪除科目。')).toBeTruthy()
  })

  it('accepting an external copy of the expected document is not a successful local submission', () => {
    startStorage()
    addSubject()
    receive(memory())
    fireEvent.click(screen.getByRole('button', { name: '採用其他分頁版本' }))
    flush()
    expect(sessionState().state).toBe('unconfirmed')
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('閱讀策略')
    expect(screen.queryByText('已儲存：已新增科目。')).toBeNull()
  })

  it('does not create a second name-only class after adopting an external document containing the original ID', () => {
    startStorage('classes')
    const generateId = vi.spyOn(crypto, 'randomUUID')
    fireEvent.change(screen.getAllByLabelText('班級教室')[0], { target: { value: '其他列草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '未確認班級' } })
    fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    const id = sessionState().targetId
    expect(memory().classes.find((item) => item.id === id)).toMatchObject({ name: '未確認班級' })
    expect(memory().classes.find((item) => item.id === id)!.grade).toBeUndefined()
    const raw = receive(memory())
    fireEvent.click(screen.getByRole('button', { name: '採用其他分頁版本' }))
    expect(sessionState().state).toBe('unconfirmed')
    expect((within(screen.getByRole('form', { name: '新增班級表單' })).getByRole('button', { name: '新增班級' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    flush()
    expect(generateId).toHaveBeenCalledTimes(1)
    expect(memory().classes.filter((item) => item.name === '未確認班級').map((item) => item.id)).toEqual([id])
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(sessionState()).toMatchObject({ state: 'unconfirmed', targetId: id, revision: 0, pending: false })
    expect((screen.getByLabelText('新班級名稱') as HTMLInputElement).value).toBe('未確認班級')
    expect(screen.queryByText('已儲存：已新增班級。')).toBeNull()

    const recovery = screen.getByRole('region', { name: '未確認的新增操作' })
    expect(recovery.textContent).toContain(id)
    expect(recovery.textContent).toContain('目前文件包含原 ID')
    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.click(within(recovery).getByRole('button', { name: '結束這次未確認新增並清除輸入' }))
    expect((screen.getByLabelText('新班級名稱') as HTMLInputElement).value).toBe('未確認班級')
    expect(sessionState().keys).toHaveLength(2)
    vi.mocked(window.confirm).mockReturnValue(true)
    fireEvent.click(within(recovery).getByRole('button', { name: '結束這次未確認新增並清除輸入' }))
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining(id))
    expect(sessionState().keys).toHaveLength(1)
    expect((screen.getAllByLabelText('班級教室')[0] as HTMLInputElement).value).toBe('其他列草稿')
    expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(screen.queryByText('已儲存：已新增班級。')).toBeNull()
  })

  it.each(['subjects', 'classes'] as const)('%s keeps an unresolved creation ID across another operation and dialog unmounting', (mode) => {
    const { data } = startStorage(mode)
    const generateId = vi.spyOn(crypto, 'randomUUID')
    const name = '保留原新增關聯'
    if (mode === 'subjects') addSubject(name)
    else {
      fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
      fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: name } })
      fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    }
    const id = sessionState().targetId
    receive({ ...data, projects: data.projects.map((item) => ({ ...item, name: '外部版本不含原新增 ID' })) })
    fireEvent.click(screen.getByRole('button', { name: '採用其他分頁版本' }))
    expect(sessionState().state).toBe('unconfirmed')
    if (mode === 'subjects') {
      fireEvent.change(screen.getByLabelText('歷史簡稱'), { target: { value: '修' } })
      fireEvent.click(within(subjectRow('歷史')).getByRole('button', { name: '儲存科目' }))
    } else {
      fireEvent.change(screen.getAllByLabelText('班級教室')[0], { target: { value: '另一筆寫入' } })
      fireEvent.click(screen.getAllByRole('button', { name: '儲存' })[0])
    }
    flush()
    expect(sessionState()).toMatchObject({ state: 'dirty', operationStatus: 'persisted', revision: 1, pending: false })
    expect(sessionState().targetId).not.toBe(id)
    fireEvent.click(screen.getByRole('button', { name: '切換掛載' }))
    fireEvent.click(screen.getByRole('button', { name: '切換掛載' }))
    const field = screen.getByLabelText(mode === 'subjects' ? '新科目名稱' : '新班級名稱') as HTMLInputElement
    expect(field.disabled).toBe(true)
    expect(field.value).toBe(name)
    // Even a programmatic edit/submit must not detach the original receipt or allocate another ID.
    fireEvent.change(field, { target: { value: '' } })
    expect(field.value).toBe(name)
    const raw = localStorage.getItem(APP_DATA_V7_KEY)
    fireEvent.submit(field.closest('form')!)
    flush()
    expect(generateId).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(memory()[mode].some((item) => item.id === id || item.name === name)).toBe(false)
    const recovery = screen.getByRole('region', { name: '未確認的新增操作' })
    expect(recovery.textContent).toContain(id)
    expect(recovery.textContent).toContain('目前文件未包含原 ID')
    fireEvent.click(within(recovery).getByRole('button', { name: '結束這次未確認新增並清除輸入' }))
    expect(window.confirm).toHaveBeenLastCalledWith(expect.stringContaining(id))
    expect(sessionState().keys).toHaveLength(0)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(screen.queryByRole('region', { name: '未確認的新增操作' })).toBeNull()
    if (mode === 'subjects') {
      expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('')
      expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).disabled).toBe(false)
    } else {
      expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull()
      expect((screen.getByRole('button', { name: '＋ 新增班級' }) as HTMLButtonElement).disabled).toBe(false)
    }
  })

  it('can finish the original creation after a rejected external adoption and a keep-local retry', () => {
    const { data } = startStorage('classes')
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '待復原班級' } })
    fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    const id = sessionState().targetId
    const expected = memory()
    expect(sessionState()).toMatchObject({ state: 'pending', pending: true, revision: 0 })
    // Compatible legacy reads allow this shape, but the v7 safe-update validator rejects a new collision.
    receive({ ...data, subjects: [...data.subjects, { ...data.subjects[0], id: 'unsafe-new-duplicate' }] })
    expect(sessionState().state).toBe('blocked')
    fireEvent.click(screen.getByRole('button', { name: '採用其他分頁版本' }))
    expect(memory()).toEqual(expected)
    expect(sessionState()).toMatchObject({ state: 'blocked', targetId: id, storageStatus: 'read-error', pending: true, revision: 0 })
    expect((screen.getByLabelText('新班級名稱') as HTMLInputElement).value).toBe('待復原班級')
    expect(screen.queryByText('已儲存：已新增班級。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保留本頁完整資料並重試儲存' }))
    expect(sessionState()).toMatchObject({ state: 'persisted', targetId: id, storageStatus: 'saved', pending: false, revision: 1, keys: [] })
    expect(stored()).toEqual(expected)
    expect(stored().classes.filter((item) => item.name === '待復原班級').map((item) => item.id)).toEqual([id])
    expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull()
    expect(screen.getByText('已儲存：已新增班級。')).toBeTruthy()
  })

  it('preserves 4D-1 reference rejection and legacy display values on unrelated resource writes', () => {
    const data = storageFixture()
    data.subjects[0].color = 'rgb(12, 34, 56)'
    data.subjects[1].shortName = data.subjects[0].shortName
    startStorage('classes', data)
    fireEvent.change(screen.getAllByLabelText('班級教室')[0], { target: { value: '安全更新' } })
    fireEvent.click(screen.getAllByRole('button', { name: '儲存' })[0])
    flush()
    expect(stored().subjects).toEqual(data.subjects)
    cleanup()
    const referenced = migrateV6ToV7(migrateV5ToV6(fixture()))
    const { raw } = startStorage('subjects', referenced)
    fireEvent.click(within(subjectRow()).getByRole('button', { name: '刪除科目' }))
    expect(screen.getByRole('alert').textContent).toContain('引用')
    flush()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })

  it('App keeps the original page and close destination while wiring draft protection and recovery', () => {
    vi.useFakeTimers()
    localStorage.clear()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(storageFixture()))
    render(<App />)
    expect(screen.getByRole('button', { name: '科目與班級' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新增課程' }))
    fireEvent.click(screen.getByRole('button', { name: /管理科目/ }))
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: 'App 草稿' } })
    vi.mocked(window.confirm).mockReturnValue(false)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    vi.mocked(window.confirm).mockReturnValue(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('dialog', { name: '新增課程' })).toBeNull()
  })
})

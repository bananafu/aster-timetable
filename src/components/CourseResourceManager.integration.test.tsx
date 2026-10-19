// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { CourseResourceManager, CourseResourceManagerDialog } from './CourseResourceManager'

const fixture = () => migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

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
    expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull()
    expect(screen.getByRole('button', { name: '＋ 新增班級' })).toBeTruthy()
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

  it('確認持久化成功後才收起表單，且不自動開下一筆空白表單', async () => {
    const data = fixture()
    const setData = vi.fn()
    const view = render(<CourseResourceManager data={data} setData={setData} mode="classes" storagePersistence={{ pending: false, revision: 3 }} />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '新建立班級' } })
    fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    expect(screen.getByRole('form', { name: '新增班級表單' })).toBeTruthy()
    const next = setData.mock.calls[0][0](data)
    view.rerender(<CourseResourceManager data={next} setData={setData} mode="classes" storagePersistence={{ pending: false, revision: 4 }} />)
    await waitFor(() => expect(screen.queryByRole('form', { name: '新增班級表單' })).toBeNull())
    expect(screen.getByRole('button', { name: '＋ 新增班級' })).toBeTruthy()
  })

  it('持久化失敗時保留新增表單與輸入內容', async () => {
    const data = fixture()
    const setData = vi.fn()
    const view = render(<CourseResourceManager data={data} setData={setData} mode="classes" storagePersistence={{ pending: false, revision: 3 }} />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.change(screen.getByLabelText('新班級名稱'), { target: { value: '等待重試' } })
    fireEvent.submit(screen.getByRole('form', { name: '新增班級表單' }))
    view.rerender(<CourseResourceManager data={data} setData={setData} mode="classes" storageStatus="write-error" storagePersistence={{ pending: false, revision: 3 }} />)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('尚未成功寫入'))
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

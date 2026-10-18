// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
    fireEvent.change(screen.getByLabelText('新班級班號'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '新增班級' }))
    expect(setData).toHaveBeenCalledTimes(1)
    expect(setData.mock.calls[0][0](data).classes.at(-1)).toMatchObject({ teachingUnitId: 'second-unit', classNumber: 3 })
    expect(data.classes.every((item) => item.teachingUnitId !== 'second-unit')).toBe(true)
  })

  it('舊資料若有重複學制，不會任選第一筆', () => {
    const data = fixture()
    data.teachingUnits.push({ ...structuredClone(data.teachingUnits[0]), id: 'duplicate-unit', name: '舊設定' })
    render(<CourseResourceManager data={data} setData={vi.fn()} mode="classes" />)
    expect((screen.getByLabelText('目前學制') as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('option', { name: /重複設定 2：舊設定/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '新增班級' })).toBeNull()
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
    expect((screen.getByRole('button', { name: '新增班級' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('新班級名稱') as HTMLInputElement).disabled).toBe(true)
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

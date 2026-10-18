// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { initialData } from '../data/seed'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { AcademicSettingsV4 } from './AcademicSettingsV4'

afterEach(cleanup)

describe('AcademicSettingsV4 class roster', () => {
  it('以 School.color 顯示所有學校卡片與各自學制日期，且管理頁不再顯示頂部選擇器', () => {
    const data = migrateV3ToV4(structuredClone(initialData))
    const setData = vi.fn()
    const originalSchool = data.schools[0]
    const originalUnit = data.teachingUnits[0]
    data.schools.push({ ...originalSchool, id: 'second-school', name: '第二學校', color: '#345678' })
    data.teachingUnits.push({ ...originalUnit, id: 'second-unit', schoolId: 'second-school', name: '國中部', schoolLevel: 'junior-high', startDate: '2027-02-01', endDate: '2027-06-30' })

    render(<AcademicSettingsV4 data={data} setData={setData} page="schools" />)

    expect(screen.queryByLabelText('學校')).toBeNull()
    expect(screen.queryByLabelText('目前學制')).toBeNull()
    expect((screen.getByLabelText(`${originalSchool.name}學校識別色`) as HTMLInputElement).value).toBe(originalSchool.color.toLowerCase())
    expect((screen.getByTestId('school-card-second-school') as HTMLElement).style.borderLeftColor).toBe('rgb(52, 86, 120)')
    expect((screen.getByLabelText('second-unit起始日') as HTMLInputElement).value).toBe('2027-02-01')
    expect((screen.getByLabelText('second-unit結束日') as HTMLInputElement).value).toBe('2027-06-30')
    fireEvent.change(screen.getByLabelText('第二學校學校名稱'), { target: { value: '第二學校（更新）' } })
    fireEvent.change(screen.getByLabelText('第二學校學校識別色'), { target: { value: '#456789' } })
    fireEvent.click(screen.getAllByRole('button', { name: '儲存學校' })[1])
    expect(setData.mock.calls[0][0].schools.find((school: typeof originalSchool) => school.id === 'second-school')).toMatchObject({ name: '第二學校（更新）', color: '#456789' })
  })

  it('從學校卡片更新指定學制日期與 A/B 設定，並原樣保留節次與 ID', () => {
    const data = migrateV3ToV4(structuredClone(initialData)); const setData = vi.fn()
    const unit = data.teachingUnits[0]
    const originalPeriods = structuredClone(unit.periods)
    render(<AcademicSettingsV4 data={data} setData={setData} page="schools" />)

    fireEvent.change(screen.getByLabelText(`${unit.id}起始日`), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText(`${unit.id}結束日`), { target: { value: '2027-12-31' } })
    fireEvent.change(screen.getByLabelText(`${unit.id}基準日期`), { target: { value: '2026-01-05' } })
    fireEvent.change(screen.getByLabelText(`${unit.id}基準週`), { target: { value: 'B' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存學制設定' }))

    const updated = setData.mock.calls[0][0].teachingUnits.find((item: typeof unit) => item.id === unit.id)
    expect(updated).toMatchObject({ id: unit.id, startDate: '2026-01-01', endDate: '2027-12-31', weekCycle: { anchorDate: '2026-01-05', anchorPattern: 'B' } })
    expect(updated.periods).toEqual(originalPeriods)
  })

  it('逐筆顯示舊資料中的重複學制與 ID，不自動選取或寫入', () => {
    const data = migrateV3ToV4(structuredClone(initialData)); const setData = vi.fn()
    const unit = data.teachingUnits[0]
    data.teachingUnits.push({ ...unit, id: 'duplicate-unit', name: `${unit.name}舊設定` })

    render(<AcademicSettingsV4 data={data} setData={setData} page="schools" />)

    expect(screen.getByTestId(`teaching-unit-${unit.id}`)).toBeTruthy()
    expect(screen.getByTestId('teaching-unit-duplicate-unit')).toBeTruthy()
    expect(screen.getByText('TeachingUnit ID duplicate-unit')).toBeTruthy()
    expect(screen.getAllByText('重複學制資料')).toHaveLength(2)
    expect((screen.getAllByRole('button', { name: '儲存學制設定' })[0] as HTMLButtonElement).disabled).toBe(true)
    expect(setData).not.toHaveBeenCalled()
  })

  it('新增國中高中學制不要求識別名稱，並使用一致的預設名稱', () => {
    const data = migrateV3ToV4(structuredClone(initialData)); const setData = vi.fn()
    data.teachingUnits[0].schoolLevel = 'senior-high'
    render(<AcademicSettingsV4 data={data} setData={setData} page="schools" />)
    expect(screen.queryByLabelText('學制識別名稱')).toBeNull()
    expect(screen.queryByLabelText('自訂學制名稱')).toBeNull()
    fireEvent.change(screen.getByLabelText('新增學制'), { target: { value: 'junior-high' } })
    fireEvent.change(screen.getByLabelText('新學制起始日'), { target: { value: '2027-02-01' } })
    fireEvent.change(screen.getByLabelText('新學制結束日'), { target: { value: '2027-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: '新增學制設定' }))
    expect(setData.mock.calls[0][0].teachingUnits.at(-1)).toMatchObject({ schoolLevel: 'junior-high', name: '國中部' })
  })

  it('other 要求自訂名稱，同校重複學制則安全拒絕', () => {
    const data = migrateV3ToV4(structuredClone(initialData)); const setData = vi.fn()
    data.teachingUnits[0].schoolLevel = 'senior-high'
    render(<AcademicSettingsV4 data={data} setData={setData} page="schools" />)
    fireEvent.change(screen.getByLabelText('新增學制'), { target: { value: 'other' } })
    expect(screen.getByLabelText('自訂學制名稱')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('自訂學制名稱'), { target: { value: '雙語實驗課程' } })
    fireEvent.change(screen.getByLabelText('新學制起始日'), { target: { value: '2027-02-01' } })
    fireEvent.change(screen.getByLabelText('新學制結束日'), { target: { value: '2027-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: '新增學制設定' }))
    expect(setData.mock.calls[0][0].teachingUnits.at(-1)).toMatchObject({ schoolLevel: 'other', name: '雙語實驗課程' })

    cleanup(); setData.mockClear()
    render(<AcademicSettingsV4 data={data} setData={setData} page="schools" />)
    fireEvent.change(screen.getByLabelText('新增學制'), { target: { value: 'senior-high' } })
    fireEvent.change(screen.getByLabelText('新學制起始日'), { target: { value: '2027-02-01' } })
    fireEvent.change(screen.getByLabelText('新學制結束日'), { target: { value: '2027-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: '新增學制設定' }))
    expect(setData).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('未新增重複資料')
  })

  it('依所選學校與學制顯示科目，新增科目預設目前學制', () => {
    const data = migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))
    data.teachingUnits[0].schoolLevel = 'senior-high'
    data.schools.push({ id: 'school-j', projectId: data.activeProjectId!, name: '國中校', color: '#718B6C' })
    data.teachingUnits.push({ ...data.teachingUnits[0], id: 'unit-j', schoolId: 'school-j', schoolLevel: 'junior-high' })
    data.subjects = data.subjects.map((subject, index) => index === 0
      ? { ...subject, name: '高中科目', applicableSchoolLevels: ['senior-high'] }
      : index === 1 ? { ...subject, name: '國中科目', applicableSchoolLevels: ['junior-high'] }
        : index === 2 ? { ...subject, name: '共用科目', applicableSchoolLevels: ['senior-high', 'junior-high'] }
          : { ...subject, applicableSchoolLevels: ['senior-high'] })
    const setData = vi.fn()
    render(<AcademicSettingsV4 data={data} setData={setData} page="subjects" />)
    expect(screen.getByText('高中科目')).toBeTruthy()
    expect(screen.getByText('共用科目')).toBeTruthy()
    expect(screen.queryByText('國中科目')).toBeNull()
    fireEvent.change(screen.getByLabelText('學校'), { target: { value: 'school-j' } })
    expect(screen.getByText('國中科目')).toBeTruthy()
    expect(screen.queryByText('高中科目')).toBeNull()
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '新科目' } })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))
    expect(setData.mock.calls[0][0].subjects.at(-1)).toMatchObject({ name: '新科目', applicableSchoolLevels: ['junior-high'] })
  })

  it('沒有學制時不顯示全域科目庫或新增入口', () => {
    const data = migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))
    data.teachingUnits = []
    render(<AcademicSettingsV4 data={data} setData={vi.fn()} page="subjects" />)
    expect(screen.getByText('請先選擇學校與學制，才能查看或新增科目。')).toBeTruthy()
    expect(screen.queryByText('國文')).toBeNull()
    expect(screen.queryByRole('button', { name: '新增科目' })).toBeNull()
  })
  it('以年級與正整數班號建立結構化班級並產生顯示代碼', () => {
    const data = migrateV3ToV4(structuredClone(initialData)); const setData = vi.fn()
    data.teachingUnits[0].schoolLevel = 'senior-high'
    render(<AcademicSettingsV4 data={data} setData={setData} page="classes" />)
    fireEvent.change(screen.getByLabelText('新班級年級'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('新班級班號'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '新增班級' }))
    const result = setData.mock.calls[0][0]
    expect(result.classes.at(-1)).toMatchObject({ name: '103', grade: 1, classNumber: 3, teachingUnitId: data.teachingUnits[0].id })
  })

  it('舊 name-only 班級維持原名稱編輯，不強制解析年級班號', () => {
    const data = migrateV3ToV4(structuredClone(initialData))
    render(<AcademicSettingsV4 data={data} setData={vi.fn()} page="classes" />)
    const legacy = data.classes[0]
    expect((screen.getAllByLabelText('班級名稱')[0] as HTMLInputElement).value).toBe(legacy.name)
    expect(legacy.grade).toBeUndefined()
    expect(legacy.classNumber).toBeUndefined()
  })

  it('新增節次套用預設時長，手動調整結束時間後修改開始時間會保留自訂值', () => {
    const data = migrateV3ToV4(structuredClone(initialData)); const setData = vi.fn()
    data.teachingUnits[0].schoolLevel = 'senior-high'
    render(<AcademicSettingsV4 data={data} setData={setData} page="periods" />)
    fireEvent.click(screen.getByRole('button', { name: '新增節次' }))
    const start = screen.getAllByLabelText(`${data.teachingUnits[0].name}開始時間`).at(-1) as HTMLSelectElement
    const end = screen.getAllByLabelText(`${data.teachingUnits[0].name}結束時間`).at(-1) as HTMLSelectElement
    fireEvent.change(start, { target: { value: '09:05' } })
    expect(end.value).toBe('09:55')
    fireEvent.change(end, { target: { value: '10:00' } })
    expect(end.value).toBe('10:00')
    fireEvent.change(start, { target: { value: '09:15' } })
    expect(end.value).toBe('10:00')
  })

  it('課堂時間表只有頂部一組選擇器，切換後依正確 TeachingUnit ID 儲存節次', () => {
    const data = migrateV3ToV4(structuredClone(initialData)); const setData = vi.fn()
    const firstUnit = data.teachingUnits[0]
    const secondUnit = { ...firstUnit, id: 'second-unit', name: '國中部', schoolLevel: 'junior-high' as const, periods: firstUnit.periods.map((period) => ({ ...period })) }
    data.teachingUnits.push(secondUnit)
    render(<AcademicSettingsV4 data={data} setData={setData} page="periods" />)

    expect(screen.getAllByLabelText('目前學制')).toHaveLength(1)
    expect(screen.queryByText('起始日')).toBeNull()
    expect(screen.queryByText('啟用 A/B 週')).toBeNull()
    fireEvent.change(screen.getByLabelText('目前學制'), { target: { value: secondUnit.id } })
    fireEvent.change(screen.getAllByLabelText(`${secondUnit.name}開始時間`)[0], { target: { value: '08:15' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存課堂時間' }))

    const result = setData.mock.calls[0][0]
    expect(result.teachingUnits.find((item: typeof firstUnit) => item.id === firstUnit.id).periods).toEqual(firstUnit.periods)
    expect(result.teachingUnits.find((item: typeof firstUnit) => item.id === secondUnit.id).periods[0].startTime).toBe('08:15')
  })

  it('既有節次不假定為預設時長，開始時間造成無效範圍時保留結束時間並阻止儲存', () => {
    const data = migrateV3ToV4(structuredClone(initialData)); const setData = vi.fn()
    const originalEnd = data.teachingUnits[0].periods[0].endTime
    render(<AcademicSettingsV4 data={data} setData={setData} page="periods" />)
    fireEvent.change(screen.getAllByLabelText(`${data.teachingUnits[0].name}開始時間`)[0], { target: { value: '10:00' } })
    expect((screen.getAllByLabelText(`${data.teachingUnits[0].name}結束時間`)[0] as HTMLSelectElement).value).toBe(originalEnd)
    expect(screen.getByText('結束時間必須晚於開始時間，請修正後再儲存。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '儲存課堂時間' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('保留既有非 5 分鐘時間並顯示修正警告，不會在載入時寫入', () => {
    const data = migrateV3ToV4(structuredClone(initialData)); const setData = vi.fn()
    data.teachingUnits[0].periods[0].startTime = '08:03'
    render(<AcademicSettingsV4 data={data} setData={setData} page="periods" />)
    expect(screen.getByRole('alert').textContent).toContain('資料尚未變更')
    expect((screen.getAllByLabelText(`${data.teachingUnits[0].name}開始時間`)[0] as HTMLSelectElement).value).toBe('08:03')
    expect(setData).not.toHaveBeenCalled()
    fireEvent.change(screen.getAllByLabelText(`${data.teachingUnits[0].name}開始時間`)[0], { target: { value: '08:10' } })
    fireEvent.change(screen.getAllByLabelText(`${data.teachingUnits[0].name}結束時間`)[0], { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存課堂時間' }))
    expect(setData).toHaveBeenCalledOnce()
    expect(setData.mock.calls[0][0].teachingUnits[0].periods[0]).toMatchObject({ id: data.teachingUnits[0].periods[0].id, startTime: '08:10', endTime: '09:00' })
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { initialData } from '../data/seed'
import { AcademicSettingsV4 } from './AcademicSettingsV4'

afterEach(cleanup)

describe('AcademicSettingsV4 class roster', () => {
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

  it('既有節次不假定為預設時長，開始時間造成無效範圍時保留結束時間並阻止儲存', () => {
    const data = migrateV3ToV4(structuredClone(initialData)); const setData = vi.fn()
    const originalEnd = data.teachingUnits[0].periods[0].endTime
    render(<AcademicSettingsV4 data={data} setData={setData} page="periods" />)
    fireEvent.change(screen.getAllByLabelText(`${data.teachingUnits[0].name}開始時間`)[0], { target: { value: '10:00' } })
    expect((screen.getAllByLabelText(`${data.teachingUnits[0].name}結束時間`)[0] as HTMLSelectElement).value).toBe(originalEnd)
    expect(screen.getByText('結束時間必須晚於開始時間，請修正後再儲存。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '儲存任教單位' }) as HTMLButtonElement).disabled).toBe(true)
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
    fireEvent.click(screen.getByRole('button', { name: '儲存任教單位' }))
    expect(setData).toHaveBeenCalledOnce()
    expect(setData.mock.calls[0][0].teachingUnits[0].periods[0]).toMatchObject({ id: data.teachingUnits[0].periods[0].id, startTime: '08:10', endTime: '09:00' })
  })
})

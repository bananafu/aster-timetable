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
    render(<AcademicSettingsV4 data={data} setData={setData} />)
    fireEvent.change(screen.getByLabelText('新班級年級'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('新班級班號'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: '新增班級' }))
    const result = setData.mock.calls[0][0]
    expect(result.classes.at(-1)).toMatchObject({ name: '103', grade: 1, classNumber: 3, teachingUnitId: data.teachingUnits[0].id })
  })

  it('舊 name-only 班級維持原名稱編輯，不強制解析年級班號', () => {
    const data = migrateV3ToV4(structuredClone(initialData))
    render(<AcademicSettingsV4 data={data} setData={vi.fn()} />)
    const legacy = data.classes[0]
    expect((screen.getAllByLabelText('班級名稱')[0] as HTMLInputElement).value).toBe(legacy.name)
    expect(legacy.grade).toBeUndefined()
    expect(legacy.classNumber).toBeUndefined()
  })
})

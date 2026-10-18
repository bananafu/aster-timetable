// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankProject } from '../data/projectRuntime'
import { addTeachingUnitToSchool } from '../data/schoolUnitCreation'
import { APP_DATA_V6_KEY } from '../data/storageV6'
import { createInitialAppDataV6, useAppDataV4 } from '../hooks/useAppDataV4'
import type { AppDataV4, SchoolLevel } from '../types'
import { AcademicSettingsV4 } from './AcademicSettingsV4'

function setup() {
  let index = 0
  return createBlankProject(createInitialAppDataV6(), {
    name: '教師專案', teacherName: '林老師', academicYear: 115, semester: 'first',
    startDate: '2026-08-31', endDate: '2027-01-20',
  }, () => `setup-${++index}`, '2026-08-01T00:00:00.000Z')
}

function Harness({ readOnly = false }: { readOnly?: boolean }) {
  const [data, setData, status, , persistence] = useAppDataV4()
  return <>
    <output data-testid="storage-status">{status}</output>
    <output data-testid="school-count">{data.schools.length}</output>
    <output data-testid="unit-count">{data.teachingUnits.length}</output>
    <AcademicSettingsV4 data={data} setData={setData} page="schools" storageStatus={status} storagePersistence={persistence} readOnly={readOnly} />
  </>
}

function fillNewSchool(level: SchoolLevel, name = '第二學校') {
  fireEvent.change(screen.getByLabelText('新學校名稱'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('新學校識別色'), { target: { value: '#345678' } })
  fireEvent.change(screen.getByLabelText('新學校第一個學制'), { target: { value: level } })
  if (level === 'other') fireEvent.change(screen.getByLabelText('新學校自訂學制名稱'), { target: { value: '實驗課程' } })
  fireEvent.change(screen.getByLabelText('新學校學制起始日'), { target: { value: '2027-02-01' } })
  fireEvent.change(screen.getByLabelText('新學校學制結束日'), { target: { value: '2027-06-30' } })
}

function fillExistingUnit(level: SchoolLevel) {
  fireEvent.change(screen.getByLabelText('新增學制'), { target: { value: level } })
  fireEvent.change(screen.getByLabelText('新學制起始日'), { target: { value: '2027-02-01' } })
  fireEvent.change(screen.getByLabelText('新學制結束日'), { target: { value: '2027-06-30' } })
}

describe('integrated school and teaching-unit creation UI', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(setup())) })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.removeItem(APP_DATA_V6_KEY) })

  it.each([['junior-high', 45], ['senior-high', 50]] as const)('creates a new school and %s in one save with %i-minute periods', (level, duration) => {
    const original = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!) as AppDataV4
    const write = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)
    fillNewSchool(level)
    expect(screen.getByText(`第二學校・${level === 'junior-high' ? '國中部' : '高中部'}。`, { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '建立學校與學制' }))
    expect(screen.getByTestId('school-count').textContent).toBe('2')
    expect(screen.getByTestId('unit-count').textContent).toBe('2')
    expect(screen.queryByText(/已建立「第二學校/)).toBeNull()
    expect((screen.getByRole('button', { name: '儲存中…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(write).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(200))
    expect(write).toHaveBeenCalledTimes(1)
    expect(screen.getByText(`已建立「第二學校・${level === 'junior-high' ? '國中部' : '高中部'}」，可在上方卡片查看並編輯。`)).toBeTruthy()
    expect(screen.queryByLabelText('新學校名稱')).toBeNull()
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!) as AppDataV4
    const school = stored.schools.find((item) => item.name === '第二學校')!
    const unit = stored.teachingUnits.find((item) => item.schoolId === school.id)!
    expect(school.color).toBe('#345678')
    expect(unit.schoolLevel).toBe(level)
    expect(unit.weekCycle).toEqual({ enabled: true, anchorDate: '2027-02-01', anchorPattern: 'A' })
    const first = unit.periods[0]
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    expect(minutes(first.endTime) - minutes(first.startTime)).toBe(duration)
    expect(unit.periods.every((period) => minutes(period.startTime) % 5 === 0 && minutes(period.endTime) % 5 === 0)).toBe(true)
    expect(stored.projects).toEqual(original.projects)
    expect(stored.timetables).toEqual(original.timetables)
    expect(stored.subjects).toEqual(original.subjects)
    expect(screen.getByLabelText('預設科目引導')).toBeTruthy()
  })

  it('creates an other unit without claiming junior/high defaults or showing catalog onboarding', () => {
    render(<Harness />)
    fillNewSchool('other')
    expect(screen.getByText(/沿用既有其他學制設定/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '建立學校與學制' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!) as AppDataV4
    expect(stored.teachingUnits.at(-1)).toMatchObject({ schoolLevel: 'other', name: '實驗課程' })
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
  })

  it('adds another level to an existing school without changing its identity or other data', () => {
    const original = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!) as AppDataV4
    render(<Harness />)
    fillExistingUnit('junior-high')
    fireEvent.click(screen.getByRole('button', { name: '新增學制設定' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!) as AppDataV4
    expect(stored.schools).toEqual(original.schools)
    expect(stored.teachingUnits[0]).toEqual(original.teachingUnits[0])
    expect(stored.teachingUnits.at(-1)).toMatchObject({ schoolId: original.schools[0].id, schoolLevel: 'junior-high' })
    expect(screen.getByLabelText('預設科目引導')).toBeTruthy()
    expect(screen.queryByLabelText('新學制起始日')).toBeNull()
    expect(screen.getByTestId(`teaching-unit-${stored.teachingUnits.at(-1)!.id}`)).toBeTruthy()
  })

  it('keeps the form and data unchanged for a duplicate school level', () => {
    const originalRaw = localStorage.getItem(APP_DATA_V6_KEY)!
    const write = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)
    fillExistingUnit('senior-high')
    fireEvent.click(screen.getByRole('button', { name: '新增學制設定' }))
    expect(screen.getByRole('alert').textContent).toContain('同一學校不可重複建立相同學制')
    expect((screen.getByLabelText('新學制起始日') as HTMLInputElement).value).toBe('2027-02-01')
    act(() => vi.advanceTimersByTime(200))
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(originalRaw)
    expect(write).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
  })

  it('revalidates a school-level choice after another tab updates the school', () => {
    const originalRaw = localStorage.getItem(APP_DATA_V6_KEY)!
    const current = JSON.parse(originalRaw) as AppDataV4
    const external = addTeachingUnitToSchool(current, { projectId: current.activeProjectId!, readOnly: false }, current.schools[0].id, {
      schoolLevel: 'junior-high', startDate: '2027-02-01', endDate: '2027-06-30',
    }, 'external-junior')
    const externalRaw = JSON.stringify(external)
    render(<Harness />)
    fillExistingUnit('junior-high')
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: originalRaw, newValue: externalRaw, storageArea: localStorage })))
    fireEvent.click(screen.getByRole('button', { name: '新增學制設定' }))
    expect(screen.getByRole('alert').textContent).toContain('同一學校不可重複建立相同學制')
    expect(screen.getByTestId('unit-count').textContent).toBe('2')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(externalRaw)
    expect((screen.getByLabelText('新學制起始日') as HTMLInputElement).value).toBe('2027-02-01')
  })

  it('blocks duplicate submission while pending and retains input after a storage write failure', () => {
    const originalRaw = localStorage.getItem(APP_DATA_V6_KEY)!
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    render(<Harness />)
    fillNewSchool('junior-high')
    fireEvent.click(screen.getByRole('button', { name: '建立學校與學制' }))
    const pending = screen.getByRole('button', { name: '儲存中…' }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
    fireEvent.click(pending)
    act(() => vi.advanceTimersByTime(200))
    expect(write).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('storage-status').textContent).toBe('write-error')
    expect(screen.getByRole('alert').textContent).toContain('寫入失敗')
    expect((screen.getByLabelText('新學校名稱') as HTMLInputElement).value).toBe('第二學校')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(originalRaw)
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
  })

  it('does not overwrite an external tab or claim success on conflict', () => {
    const originalRaw = localStorage.getItem(APP_DATA_V6_KEY)!
    const external = JSON.parse(originalRaw) as AppDataV4
    external.projects[0].name = '外部分頁版本'
    const externalRaw = JSON.stringify(external)
    render(<Harness />)
    fillNewSchool('junior-high')
    fireEvent.click(screen.getByRole('button', { name: '建立學校與學制' }))
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: originalRaw, newValue: externalRaw, storageArea: localStorage })))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('storage-status').textContent).toBe('conflict')
    expect(screen.getByRole('alert').textContent).toContain('未確認儲存')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(externalRaw)
    expect((screen.getByLabelText('新學校名稱') as HTMLInputElement).value).toBe('第二學校')
    expect(screen.queryByLabelText('預設科目引導')).toBeNull()
  })

  it('disables school and unit creation and editing in a read-only view', () => {
    render(<Harness readOnly />)
    expect((screen.getByRole('button', { name: '建立學校與學制' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '新增學制設定' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '儲存學校' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '儲存學制設定' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('school-count').textContent).toBe('1')
  })
})

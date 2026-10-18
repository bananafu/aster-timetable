// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankProject } from './projectRuntime'
import { createSchoolWithTeachingUnit } from './schoolUnitCreation'
import { APP_DATA_V6_KEY } from './storageV6'
import { createInitialAppDataV6, useAppDataV4 } from '../hooks/useAppDataV4'
import type { AppDataV4 } from '../types'

function setup() {
  let index = 0
  return createBlankProject(createInitialAppDataV6(), {
    name: '教師專案', teacherName: '林老師', academicYear: 115, semester: 'first',
    startDate: '2026-08-31', endDate: '2027-01-20',
  }, () => `setup-${++index}`, '2026-08-01T00:00:00.000Z')
}

function Harness() {
  const [data, setData, status, controls] = useAppDataV4()
  return <>
    <output data-testid="status">{status}</output>
    <output data-testid="school-count">{data.schools.length}</output>
    <output data-testid="unit-count">{data.teachingUnits.length}</output>
    <output data-testid="project-name">{data.projects.find((item) => item.id === data.activeProjectId)?.name}</output>
    <button onClick={() => setData((current) => createSchoolWithTeachingUnit(current, {
      projectId: current.activeProjectId!, readOnly: false,
    }, { name: '第二學校', color: '#345678' }, {
      schoolLevel: 'junior-high', startDate: '2027-02-01', endDate: '2027-06-30',
    }, { schoolId: 'new-school', teachingUnitId: 'new-unit' }))}>一次新增學校與學制</button>
    <button onClick={controls.acceptExternal}>採用外部分頁</button>
  </>
}

describe('school/unit creation through v6 safe-update storage', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(setup())) })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.removeItem(APP_DATA_V6_KEY) })

  it('persists both entities in one storage transaction and preserves the timetable', () => {
    const original = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!) as AppDataV4
    const write = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '一次新增學校與學制' }))
    expect(screen.getByTestId('school-count').textContent).toBe('2')
    expect(screen.getByTestId('unit-count').textContent).toBe('2')
    expect(write).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(write).toHaveBeenCalledTimes(1)
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!) as AppDataV4
    expect(stored.schools.find((item) => item.id === 'new-school')?.color).toBe('#345678')
    expect(stored.teachingUnits.find((item) => item.id === 'new-unit')?.schoolId).toBe('new-school')
    expect(stored.timetables).toEqual(original.timetables)
    expect(stored.subjects).toEqual(original.subjects)
  })

  it('never overwrites an external tab during a pending combined write, then uses latest accepted data', () => {
    const originalRaw = localStorage.getItem(APP_DATA_V6_KEY)!
    const external = JSON.parse(originalRaw) as AppDataV4
    external.projects[0].name = '外部分頁版本'
    const externalRaw = JSON.stringify(external)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '一次新增學校與學制' }))
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: originalRaw, newValue: externalRaw, storageArea: localStorage })))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(externalRaw)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).schools).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '採用外部分頁' }))
    expect(screen.getByTestId('project-name').textContent).toBe('外部分頁版本')
    expect(screen.getByTestId('school-count').textContent).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: '一次新增學校與學制' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!) as AppDataV4
    expect(stored.projects[0].name).toBe('外部分頁版本')
    expect(stored.schools.some((item) => item.id === 'new-school')).toBe(true)
    expect(stored.teachingUnits.some((item) => item.id === 'new-unit' && item.schoolId === 'new-school')).toBe(true)
    expect(screen.getByTestId('status').textContent).toBe('saved')
  })

  it('does not leave an orphan school or unit in storage when the write fails', () => {
    const originalRaw = localStorage.getItem(APP_DATA_V6_KEY)!
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '一次新增學校與學制' }))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('write-error')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(originalRaw)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).schools).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).teachingUnits).toHaveLength(1)
  })
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { APP_DATA_V6_KEY } from '../data/storageV6'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { createOneOffLesson } from '../data/oneOffLessonsV7'
import { isCompatibleAppDataV7 } from '../data/validators/v7'
import { useAppDataV4 } from './useAppDataV4'

const source = () => migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))

function Harness() {
  const [data, setData, status, controls, persistence] = useAppDataV4()
  return <>
    <output data-testid="status">{status}</output>
    <output data-testid="source">{controls.conflictSource ?? ''}</output>
    <output data-testid="name">{data.projects[0]?.name}</output>
    <output data-testid="one-off-count">{data.oneOffLessons?.length ?? 0}</output>
    <output data-testid="pending">{String(persistence.pending)}</output>
    <output data-testid="revision">{persistence.revision}</output>
    <button onClick={() => setData((current) => ({ ...current, projects: current.projects.map((project) => ({ ...project, name: '本頁變更' })) }))}>rename</button>
    <button onClick={() => setData((current) => {
      if (!isCompatibleAppDataV7(current)) return current
      return createOneOffLesson(current, {
        projectId: current.projects[0].id, timetableId: current.timetables[0].id,
        teachingUnitId: current.teachingUnits[0].id, classId: current.classes[0].id,
        subjectId: current.subjects[0].id, date: '2026-09-06', purpose: 'extra',
        time: { mode: 'custom', startTime: '09:30', endTime: '11:00' },
      }, () => '00000000-0000-4000-8000-000000000001')
    })}>add one-off</button>
    <button onClick={() => setData((current) => ({ ...current, oneOffLessons: [{ id: 'broken' } as never] }))}>invalid one-off</button>
    <button onClick={controls.acceptExternal}>accept</button>
    <button onClick={controls.keepLocal}>keep</button>
  </>
}

describe('v7 runtime and older-tab protection', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear() })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })

  it('migrates v6 once without overwriting its key', () => {
    const rawV6 = JSON.stringify(source())
    localStorage.setItem(APP_DATA_V6_KEY, rawV6)
    render(<Harness />)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(rawV6)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).oneOffLessons).toEqual([])
  })

  it('blocks a pending v7 write when an older tab changes v6, without treating v6 as a v7 external version', () => {
    const v6 = source()
    const v7 = migrateV6ToV7(v6)
    const rawV7 = JSON.stringify(v7)
    const rawV6 = JSON.stringify(v6)
    localStorage.setItem(APP_DATA_V6_KEY, rawV6)
    localStorage.setItem(APP_DATA_V7_KEY, rawV7)
    render(<Harness />)
    fireEvent.click(screen.getByText('rename'))
    const updatedV6 = JSON.stringify({ ...v6, projects: v6.projects.map((project) => ({ ...project, name: '舊版分頁' })) })
    localStorage.setItem(APP_DATA_V6_KEY, updatedV6)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: rawV6, newValue: updatedV6, storageArea: localStorage })))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(screen.getByTestId('source').textContent).toBe('legacy')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(rawV7)
    fireEvent.click(screen.getByText('accept'))
    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(screen.getByTestId('name').textContent).toBe('本頁變更')
    fireEvent.click(screen.getByText('keep'))
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).projects[0].name).toBe('本頁變更')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(updatedV6)
  })

  it('detects a v6 change before first migration write even without a storage event', () => {
    const v6 = source()
    const rawV6 = JSON.stringify(v6)
    localStorage.setItem(APP_DATA_V6_KEY, rawV6)
    render(<Harness />)
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify({ ...v6, projects: v6.projects.map((project) => ({ ...project, name: 'later' })) }))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(screen.getByTestId('source').textContent).toBe('legacy')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBeNull()
  })

  it('rejects an invalid one-off before any persisted write', () => {
    const rawV7 = JSON.stringify(migrateV6ToV7(source()))
    localStorage.setItem(APP_DATA_V7_KEY, rawV7)
    render(<Harness />)
    fireEvent.click(screen.getByText('invalid one-off'))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('write-error')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(rawV7)
  })

  it('uses one functional update and reports completion only after persistence', () => {
    const rawV7 = JSON.stringify(migrateV6ToV7(source()))
    localStorage.setItem(APP_DATA_V7_KEY, rawV7)
    render(<Harness />)
    fireEvent.click(screen.getByText('add one-off'))
    expect(screen.getByTestId('one-off-count').textContent).toBe('1')
    expect(screen.getByTestId('pending').textContent).toBe('true')
    expect(screen.getByTestId('revision').textContent).toBe('0')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(rawV7)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(screen.getByTestId('pending').textContent).toBe('false')
    expect(screen.getByTestId('revision').textContent).toBe('1')
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).oneOffLessons).toHaveLength(1)
  })

  it('does not persist a pending one-off over an external tab update or a failed storage write', () => {
    const rawV7 = JSON.stringify(migrateV6ToV7(source()))
    localStorage.setItem(APP_DATA_V7_KEY, rawV7)
    render(<Harness />)
    fireEvent.click(screen.getByText('add one-off'))
    const external = JSON.stringify({ ...JSON.parse(rawV7), projects: [{ ...JSON.parse(rawV7).projects[0], name: '外部分頁' }] })
    localStorage.setItem(APP_DATA_V7_KEY, external)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: rawV7, newValue: external, storageArea: localStorage })))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(external)
    expect(screen.getByTestId('revision').textContent).toBe('0')
  })

  it('retains the old stored document when a one-off write fails', () => {
    const rawV7 = JSON.stringify(migrateV6ToV7(source()))
    localStorage.setItem(APP_DATA_V7_KEY, rawV7)
    render(<Harness />)
    fireEvent.click(screen.getByText('add one-off'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('write-error')
    expect(screen.getByTestId('revision').textContent).toBe('0')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(rawV7)
  })
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapEmptyV8 } from '../data/bootstrapV8'
import { createBlankProject } from '../data/projectRuntimeV8'
import { APP_DATA_V8_KEY } from '../data/storageV8'
import { isCompatibleAppDataV8 } from '../data/validators/v8'
import { useAppDataV8 } from '../hooks/useAppDataV8'
import type { AppDataV8 } from '../types'
import { ClassManagerV8 } from './ClassManagerV8'
import { TimetableManagerV8 } from './TimetableManagerV8'

function Harness() {
  const [data, setData, status, controls, persistence, info] = useAppDataV8({ loadMode: 'v8-only' })
  return <>
    <output data-testid="revision">{persistence.revision}</output>
    <output data-testid="receipt">{persistence.receipt?.raw ?? ''}</output>
    <output data-testid="writable">{String(info.writable)}</output>
    <button onClick={() => { let id = 0; setData((current) => createBlankProject(current,
      { name: '整合專案', academicYear: 115, semester: 'first',
        startDate: '2026-08-01', endDate: '2027-01-31' }, () => `project-resource-${++id}`)) }}>建立專案</button>
    {data.activeProjectId && <>
      <ClassManagerV8 data={data} setData={setData} status={status} persistence={persistence}
        writable={info.writable} exportLocalJson={controls.exportLocalJson} />
      <TimetableManagerV8 data={data} setData={setData} status={status} persistence={persistence}
        writable={info.writable} exportLocalJson={controls.exportLocalJson} onClose={() => {}} />
    </>}
  </>
}

describe('shared V8 Host resource managers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    Object.defineProperty(navigator, 'locks', { configurable: true,
      value: { request: (_name: string, _options: unknown, operation: (lock: unknown) => Promise<unknown>) => operation({}) } })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.clear()
    Reflect.deleteProperty(navigator, 'locks')
  })

  it('persists Project, Class and Timetable through one Host with successive receipts', async () => {
    expect((await bootstrapEmptyV8(localStorage, { attemptId: 'resources' })).ok).toBe(true)
    render(<Harness />)
    await vi.waitFor(() => expect(screen.getByTestId('writable').textContent).toBe('true'), { interval: 10, timeout: 1000 })
    fireEvent.click(screen.getByText('建立專案'))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await vi.waitFor(() => expect(screen.getByTestId('revision').textContent).toBe('1'), { interval: 10, timeout: 1000 })
    fireEvent.change(screen.getByLabelText('班級名稱'), { target: { value: '一甲' } })
    fireEvent.submit(screen.getByLabelText('班級表單'))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await vi.waitFor(() => expect(screen.getByTestId('revision').textContent).toBe('2'), { interval: 10, timeout: 1000 })
    fireEvent.click(screen.getByText('新增教師課表'))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '甲課表' } })
    fireEvent.change(screen.getByLabelText('教師名稱'), { target: { value: '甲教師' } })
    fireEvent.submit(screen.getByLabelText('教師課表表單'))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    await vi.waitFor(() => expect(screen.getByTestId('revision').textContent).toBe('3'), { interval: 10, timeout: 1000 })
    const raw = localStorage.getItem(APP_DATA_V8_KEY)!
    const saved = JSON.parse(raw) as AppDataV8
    expect(isCompatibleAppDataV8(saved)).toBe(true)
    expect(saved.projects).toHaveLength(1)
    expect(saved.classes).toHaveLength(1)
    expect(saved.timetables).toHaveLength(1)
    expect(saved.recurringLessons).toEqual([])
    expect(saved.events).toEqual([])
    expect(saved.teachingProgress).toEqual([])
    expect(screen.getByTestId('receipt').textContent).toBe(raw)
  })
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { initialData } from '../data/seed'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import type { AppDataV4 } from '../types'
import { useAppDataV4 } from './useAppDataV4'
import { useOneOffPersistence } from './useOneOffPersistence'

const v6 = () => migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))
const v7 = () => migrateV6ToV7(v6())
const draft = (data: ReturnType<typeof v7>) => ({
  projectId: data.projects[0].id, timetableId: data.timetables[0].id,
  teachingUnitId: data.teachingUnits[0].id, classId: data.classes[0].id, subjectId: data.subjects[0].id,
  date: '2026-09-06', purpose: 'extra' as const, time: { mode: 'custom' as const, startTime: '09:30', endTime: '10:30' },
})

function Harness() {
  const [data, setData, status, , persistence] = useAppDataV4()
  const writes = useOneOffPersistence(data, setData, status, persistence)
  const context = { projectId: data.projects[0].id, timetableId: data.timetables![0].id }
  const request = { draft: draft(data as ReturnType<typeof v7>), allowConflict: false }
  return <>
    <output data-testid="one-off-count">{data.oneOffLessons?.length ?? 0}</output>
    <output data-testid="revision">{persistence.revision}</output>
    <button onClick={() => { void writes.save(context, request) }}>submit</button>
    <button onClick={() => { void writes.save(context, request).catch((error: Error) => { document.body.dataset.lastError = error.message }) }}>submit-again</button>
    <button onClick={() => { void writes.save(context, { ...request, draft: { ...request.draft, subjectId: 'missing' } }).catch((error: Error) => { document.body.dataset.lastError = error.message }) }}>submit-invalid-subject</button>
  </>
}

describe('one-off persistence contract', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); document.body.dataset.lastError = '' })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

  it('uses the latest synchronous functional update and refuses a second operation before revision confirmation', async () => {
    const data = v7()
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' })
    render(<Harness />)
    fireEvent.click(screen.getByText('submit'))
    expect(screen.getByTestId('one-off-count').textContent).toBe('1')
    expect(screen.getByTestId('revision').textContent).toBe('0')
    fireEvent.click(screen.getByText('submit-again'))
    await act(async () => { await Promise.resolve() })
    expect(document.body.dataset.lastError).toContain('仍在儲存中')
    act(() => vi.advanceTimersByTime(200))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).oneOffLessons).toHaveLength(1)
  })

  it('rejects non-v7 latest data without invoking CRUD or replacing the input', async () => {
    let current = v6() as AppDataV4
    const original = structuredClone(current)
    let invoked = 0
    const setData = (update: AppDataV4 | ((value: AppDataV4) => AppDataV4)) => {
      invoked += 1
      if (typeof update === 'function') current = update(current)
      else current = update
    }
    function InvalidHarness() {
      const writes = useOneOffPersistence(current, setData, 'saved', { pending: false, revision: 0 })
      return <button onClick={() => { void writes.save({ projectId: original.projects[0].id, timetableId: 'legacy-timetable' }, {
        draft: { ...draft(v7()), timetableId: 'legacy-timetable' }, allowConflict: false,
      }).catch((error: Error) => { document.body.dataset.lastError = error.message }) }}>submit-invalid</button>
    }
    render(<InvalidHarness />)
    fireEvent.click(screen.getByText('submit-invalid'))
    await act(async () => { await Promise.resolve() })
    expect(invoked).toBe(1)
    expect(document.body.dataset.lastError).toContain('AppDataV7')
    expect(current).toEqual(original)
  })

  it('rejects a failed latest-data validation without any in-memory or persisted partial write', async () => {
    const data = v7()
    const raw = JSON.stringify(data)
    localStorage.setItem(APP_DATA_V7_KEY, raw)
    render(<Harness />)
    fireEvent.click(screen.getByText('submit-invalid-subject'))
    await act(async () => { await Promise.resolve() })
    expect(document.body.dataset.lastError).toContain('科目不適用')
    expect(screen.getByTestId('one-off-count').textContent).toBe('0')
    act(() => vi.advanceTimersByTime(200))
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
  })
})

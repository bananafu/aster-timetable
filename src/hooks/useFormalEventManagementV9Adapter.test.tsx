// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { createBlankProjectV9, createTeacherTimetableV9 } from '../data/teacherSubjectsV9'
import type { EventV9Scope } from '../data/eventMutationsV9'
import type { FormalV9HostPort } from '../formalRuntime'
import type { AppDataV9 } from '../types/v9'
import { useFormalEventManagementV9Adapter } from './useFormalEventManagementV9Adapter'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function fixture() {
  let serial = 0
  let data: AppDataV9 = { ...createEmptyAppDataV8(), schemaVersion: 9, subjects: [] }
  data = createBlankProjectV9(data, { name: 'Event Project', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `adapter-${++serial}`)
  const projectId = data.activeProjectId!
  const unitId = data.teachingUnits[0].id
  data = createTeacherTimetableV9(data, projectId,
    { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV9(data, projectId,
    { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  const selection: EventV9Scope = { projectId, timetableId: 'teacher-a' }
  const draft = { teachingUnitId: unitId, title: '會議', date: '2026-09-07',
    startTime: '09:00', endTime: '10:00', color: '#647C88' }
  return { data, selection, draft }
}
function hostFixture(initial: AppDataV9) {
  let document = initial
  let revision = 0
  let reject = false
  let hold: Promise<void> | null = null
  const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
    const next = produce(document)
    if (hold) await hold
    if (reject) throw new Error('persist-failed')
    document = next; revision += 1
    return { raw: JSON.stringify(next), revision, attemptId: `event-${revision}` }
  })
  const host = { get document() { return document }, status: 'active' as const,
    writable: true, pending: false, receipt: null, get revision() { return revision },
    errorCode: null, update } satisfies FormalV9HostPort
  return { host, update, document: () => document, reject() { reject = true },
    hold(promise: Promise<void>) { hold = promise } }
}

describe('Formal V9 Event adapter', () => {
  it('uses the existing Host for Meeting/Activity create and edit', async () => {
    const f = fixture()
    const state = hostFixture(f.data)
    const hook = renderHook(() => useFormalEventManagementV9Adapter(state.host, f.selection,
      () => `event-${state.document().events.length + 1}`))
    expect(hook.result.current.writable).toBe(true)
    await act(async () => { await hook.result.current.createMeeting(f.draft) })
    await act(async () => { await hook.result.current.createActivity({ ...f.draft, title: '活動' }) })
    await act(async () => { await hook.result.current.updateMeeting('event-1',
      { ...f.draft, title: '會議更新' }) })
    await act(async () => { await hook.result.current.updateActivity('event-2',
      { ...f.draft, title: '活動更新' }) })
    expect(state.document().events.map((event) => [event.id, event.type, event.title]))
      .toEqual([['event-1', 'meeting', '會議更新'], ['event-2', 'activity', '活動更新']])
    expect(state.update).toHaveBeenCalledTimes(4)
    expect(hook.result.current.pending).toBe(false)
  })

  it('invalidates a captured callback after Timetable selection changes', async () => {
    const f = fixture()
    const state = hostFixture(f.data)
    const hook = renderHook(({ selection }) => useFormalEventManagementV9Adapter(state.host,
      selection, () => 'new-event'), { initialProps: { selection: f.selection } })
    const staleCreate = hook.result.current.createMeeting
    hook.rerender({ selection: { ...f.selection, timetableId: 'teacher-b' } })
    await expect(staleCreate(f.draft)).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(state.update).not.toHaveBeenCalled()
    expect(state.document()).toBe(f.data)
  })

  it('rejects concurrent requests and keeps original data after persistence rejection', async () => {
    const f = fixture()
    const state = hostFixture(f.data)
    const hook = renderHook(() => useFormalEventManagementV9Adapter(state.host,
      f.selection, () => 'new-event'))
    let release!: () => void
    state.hold(new Promise<void>((resolve) => { release = resolve }))
    let first!: Promise<unknown>
    act(() => { first = hook.result.current.createMeeting(f.draft) })
    expect(hook.result.current.pending).toBe(true)
    await expect(hook.result.current.createMeeting(f.draft))
      .rejects.toMatchObject({ code: 'duplicate-submit' })
    release()
    await act(async () => { await first })
    expect(state.update).toHaveBeenCalledTimes(1)
    state.reject()
    await act(async () => {
      await expect(hook.result.current.updateMeeting('new-event',
        { ...f.draft, title: '不得儲存' })).rejects.toThrow('persist-failed')
    })
    expect(state.document().events[0].title).toBe('會議')
    expect(hook.result.current.pending).toBe(false)
  })
})

// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeFreshV9 } from '../data/initializeFreshV9'
import { createBlankProjectV9, createTeacherTimetableV9 } from '../data/teacherSubjectsV9'
import { createEventV9 } from '../data/eventMutationsV9'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_AUTO_BACKUP_PREFIX,
  checkV9WriteEvidence, loadAppDataV9, persistAppDataV9 } from '../data/storageV9'
import { createFormalEventManagementV9Controller } from '../formalEventManagementV9'
import { toFormalV9HostPort } from '../formalRuntime'
import { selectV9ResolvedEvents } from '../lib/scheduleV9'
import { useAppDataV9 } from './useAppDataV9'

const locks = { request: vi.fn(async (_name: string, _options: unknown,
  operation: (lock: unknown) => Promise<unknown>) => operation({})) }
beforeEach(() => {
  localStorage.clear()
  locks.request.mockClear()
  vi.stubGlobal('navigator', { locks })
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function ready() {
  const fresh = await initializeFreshV9(localStorage, {
    attemptId: 'event-fresh', createdAt: '2026-11-01T00:00:00.000Z',
  })
  if (!fresh.ok) throw new Error(fresh.code)
  const loaded = loadAppDataV9(localStorage)
  if (loaded.status !== 'active' || !loaded.document || !loaded.rawDocument
    || !loaded.rawMetadata || !loaded.metadata) throw new Error('fresh-data-unavailable')
  let serial = 0
  let data = createBlankProjectV9(loaded.document, { name: 'Event Project', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `host-event-${++serial}`)
  const projectId = data.activeProjectId!
  const unitId = data.teachingUnits[0].id
  data = createTeacherTimetableV9(data, projectId,
    { name: 'Event 課表', teacherName: '教師' }, 'event-timetable')
  await persistAppDataV9(localStorage, loaded.document, data, {
    raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata,
    revision: loaded.metadata.documentRevision,
  })
  return { projectId, unitId, data }
}
const draft = (unitId: string) => ({ teachingUnitId: unitId, title: '教學會議',
  date: '2026-09-07', startTime: '09:00', endTime: '10:00', color: '#647C88' })

describe('Formal V9 Event Host persistence', () => {
  it('commits Meeting and Activity through the existing Web Lock and survives Host remount', async () => {
    const f = await ready()
    const host = renderHook(() => useAppDataV9())
    await waitFor(() => expect(host.result.current.writable).toBe(true))
    const scope = { projectId: f.projectId, timetableId: 'event-timetable' }
    const beforeLocks = locks.request.mock.calls.length
    let meeting!: Awaited<ReturnType<ReturnType<typeof createFormalEventManagementV9Controller>['createMeeting']>>
    await act(async () => {
      meeting = await createFormalEventManagementV9Controller(
        toFormalV9HostPort(host.result.current), () => 'host-meeting', scope)
        .createMeeting(draft(f.unitId))
    })
    expect(meeting.receipt).toMatchObject({ revision: 2, attemptId: 'event-fresh' })
    expect(meeting.receipt.raw).toBe(JSON.stringify(meeting.document))
    expect(locks.request.mock.calls.length).toBeGreaterThan(beforeLocks)
    let activity!: typeof meeting
    await act(async () => {
      activity = await createFormalEventManagementV9Controller(
        toFormalV9HostPort(host.result.current), () => 'host-activity', scope)
        .createActivity({ ...draft(f.unitId), title: '校內活動' })
    })
    expect(activity.receipt.revision).toBe(3)
    await act(async () => {
      await createFormalEventManagementV9Controller(
        toFormalV9HostPort(host.result.current), () => 'unused', scope)
        .updateMeeting('host-meeting', { ...draft(f.unitId), title: '更新會議' })
    })
    await act(async () => {
      await createFormalEventManagementV9Controller(
        toFormalV9HostPort(host.result.current), () => 'unused', scope)
        .updateActivity('host-activity', { ...draft(f.unitId), title: '更新活動' })
    })
    const raw = localStorage.getItem(APP_DATA_V9_KEY)!
    const meta = localStorage.getItem(V9_ACTIVATION_KEY)!
    expect(await checkV9WriteEvidence(localStorage, raw, meta)).toBe(true)
    expect(selectV9ResolvedEvents(host.result.current.data!, { ...scope, teachingUnitId: null },
      '2026-09-07').map((event) => [event.id, event.title]))
      .toEqual([['host-meeting', '更新會議'], ['host-activity', '更新活動']])
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key) => key?.startsWith(V9_AUTO_BACKUP_PREFIX))).toEqual([])
    host.unmount()
    const reloaded = renderHook(() => useAppDataV9())
    await waitFor(() => expect(reloaded.result.current.writable).toBe(true))
    expect(reloaded.result.current.revision).toBe(5)
    expect(selectV9ResolvedEvents(reloaded.result.current.data!, { ...scope, teachingUnitId: null })
      .map((event) => event.id)).toEqual(['host-meeting', 'host-activity'])
  })

  it('does not report success or change stored Event data when persistence rejects', async () => {
    const f = await ready()
    const host = renderHook(() => useAppDataV9())
    await waitFor(() => expect(host.result.current.writable).toBe(true))
    const before = localStorage.getItem(APP_DATA_V9_KEY)
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V9_KEY) throw new Error('event-write-rejected')
      return originalSetItem.call(this, key, value)
    })
    await act(async () => {
      await expect(createFormalEventManagementV9Controller(
        toFormalV9HostPort(host.result.current), () => 'rejected-event',
        { projectId: f.projectId, timetableId: 'event-timetable' })
        .createMeeting(draft(f.unitId))).rejects.toThrow()
    })
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(before)
    expect(host.result.current.data?.events).toEqual([])
    expect(host.result.current.revision).toBe(1)
    expect(host.result.current.writable).toBe(false)
  })

  it('refuses a stale Host write after another confirmed V9 revision', async () => {
    const f = await ready()
    const host = renderHook(() => useAppDataV9())
    await waitFor(() => expect(host.result.current.writable).toBe(true))
    const scope = { projectId: f.projectId, timetableId: 'event-timetable' }
    const old = createFormalEventManagementV9Controller(toFormalV9HostPort(host.result.current),
      () => 'stale-event', scope)
    const loaded = loadAppDataV9(localStorage)
    if (!loaded.document || !loaded.rawDocument || !loaded.rawMetadata || !loaded.metadata) {
      throw new Error('expected-active-document')
    }
    const external = createEventV9(loaded.document, scope,
      { ...draft(f.unitId), type: 'activity', title: '外部版本' }, 'external-event')
    const externalReceipt = await persistAppDataV9(localStorage, loaded.document, external, {
      raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata,
      revision: loaded.metadata.documentRevision,
    })
    await act(async () => {
      await expect(old.createMeeting(draft(f.unitId))).rejects.toThrow()
    })
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBe(externalReceipt.raw)
    expect(loadAppDataV9(localStorage).document?.events.map((event) => event.id))
      .toEqual(['external-event'])
    expect(host.result.current.data?.events).toEqual([])
  })
})

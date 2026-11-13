import { describe, expect, it, vi } from 'vitest'
import { createEmptyAppDataV8 } from './storageV8'
import { createBlankProjectV9, createTeacherTimetableV9 } from './teacherSubjectsV9'
import { createEventV9, updateEventV9, type EventV9Draft,
  type EventV9Scope } from './eventMutationsV9'
import { isCompatibleAppDataV9 } from './validators/v9'
import { selectV9ResolvedEvents } from '../lib/scheduleV9'
import { createFormalEventManagementV9Controller } from '../formalEventManagementV9'
import type { FormalV9HostPort } from '../formalRuntime'
import type { AppDataV9 } from '../types/v9'

const empty = (): AppDataV9 => ({ ...createEmptyAppDataV8(), schemaVersion: 9, subjects: [] })
const draft = (teachingUnitId: string, change: Partial<EventV9Draft> = {}): EventV9Draft => ({
  teachingUnitId, title: '教學會議', type: 'meeting', date: '2026-09-07',
  startTime: '09:00', endTime: '10:00', color: '#647C88', ...change,
})
function fixture() {
  let serial = 0
  const id = () => `event-fixture-${++serial}`
  const project = (name: string) => ({ name, academicYear: 115, semester: 'first' as const,
    startDate: '2026-08-01', endDate: '2027-01-31' })
  let data = createBlankProjectV9(empty(), project('甲專案'), id)
  const projectA = data.activeProjectId!
  const unitA = data.teachingUnits.find((unit) => unit.projectId === projectA)!
  data = createTeacherTimetableV9(data, projectA, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV9(data, projectA, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  data = createBlankProjectV9(data, project('乙專案'), id)
  const projectB = data.activeProjectId!
  const unitB = data.teachingUnits.find((unit) => unit.projectId === projectB)!
  data = createTeacherTimetableV9(data, projectB, { name: '丙課表', teacherName: '丙' }, 'teacher-c')
  const scope: EventV9Scope = { projectId: projectA, timetableId: 'teacher-a' }
  return { data, scope, projectA, projectB, unitA, unitB }
}
const code = (operation: () => unknown) => {
  try { operation() } catch (cause) { return (cause as { code?: string }).code }
  return 'no-error'
}

describe('Formal V9 one-day Event domain', () => {
  it('creates resolved Meeting and Activity without changing other owners or the schema', () => {
    const f = fixture()
    const meeting = createEventV9(f.data, f.scope, draft(f.unitA.id), 'meeting-a')
    const activity = createEventV9(meeting, f.scope,
      draft(f.unitA.id, { type: 'activity', title: '校慶' }), 'activity-a')
    expect(isCompatibleAppDataV9(activity)).toBe(true)
    expect(activity.schemaVersion).toBe(9)
    expect(activity.events).toMatchObject([
      { id: 'meeting-a', projectId: f.projectA, timetableId: 'teacher-a',
        teachingUnitId: f.unitA.id, ownershipStatus: 'resolved', type: 'meeting', origin: 'user' },
      { id: 'activity-a', projectId: f.projectA, timetableId: 'teacher-a',
        teachingUnitId: f.unitA.id, ownershipStatus: 'resolved', type: 'activity', origin: 'user' },
    ])
    expect(selectV9ResolvedEvents(activity, { ...f.scope, teachingUnitId: null },
      '2026-09-07').map((item) => item.id)).toEqual(['meeting-a', 'activity-a'])
    expect(selectV9ResolvedEvents(activity, { projectId: f.projectA, timetableId: 'teacher-b',
      teachingUnitId: null })).toEqual([])
    expect(selectV9ResolvedEvents(activity, { projectId: f.projectB, timetableId: 'teacher-c',
      teachingUnitId: null })).toEqual([])
    expect(selectV9ResolvedEvents(activity, { ...f.scope, teachingUnitId: null },
      '2026-09-08')).toEqual([])
    expect(f.data.events).toEqual([])
  })

  it.each(['meeting', 'activity'] as const)('edits %s by ID while preserving identity and other Events', (type) => {
    const f = fixture()
    const first = createEventV9(f.data, f.scope, draft(f.unitA.id, { type }), 'target')
    const withOther = createEventV9(first, { projectId: f.projectB, timetableId: 'teacher-c' },
      draft(f.unitB.id, { title: '其他專案' }), 'other')
    const changed = updateEventV9(withOther, f.scope, 'target', draft(f.unitA.id, {
      type, title: '更新名稱', date: '2026-09-08', startTime: '13:15', endTime: '14:45',
      location: '會議室', notes: '備註', color: '#A66D52',
    }))
    expect(changed.events[0]).toMatchObject({ id: 'target', type, title: '更新名稱',
      date: '2026-09-08', startTime: '13:15', endTime: '14:45',
      projectId: f.projectA, timetableId: 'teacher-a', teachingUnitId: f.unitA.id })
    expect(changed.events[1]).toEqual(withOther.events[1])
    expect(selectV9ResolvedEvents(changed, { ...f.scope, teachingUnitId: null },
      '2026-09-08').map((item) => item.id)).toEqual(['target'])
    expect(selectV9ResolvedEvents(changed, { ...f.scope, teachingUnitId: null },
      '2026-09-07')).toEqual([])
    expect(isCompatibleAppDataV9(changed)).toBe(true)
  })

  it('rejects absent scope, unset term, invalid date/time, unsupported recurrence and duplicate IDs', () => {
    const f = fixture()
    const original = JSON.stringify(f.data)
    expect(code(() => createEventV9(f.data, { projectId: null, timetableId: 'teacher-a' },
      draft(f.unitA.id), 'new'))).toBe('invalid-scope')
    expect(code(() => createEventV9(f.data, { projectId: f.projectA, timetableId: null },
      draft(f.unitA.id), 'new'))).toBe('invalid-scope')
    expect(code(() => createEventV9(f.data, f.scope, draft(f.unitB.id), 'new'))).toBe('invalid-scope')
    expect(code(() => createEventV9(f.data, f.scope,
      draft(f.unitA.id, { date: '2026-02-30' }), 'new'))).toBe('invalid-date')
    expect(code(() => createEventV9(f.data, f.scope,
      draft(f.unitA.id, { date: '2027-02-01' }), 'new'))).toBe('invalid-date')
    expect(code(() => createEventV9(f.data, f.scope,
      draft(f.unitA.id, { startTime: '10:00', endTime: '09:00' }), 'new'))).toBe('invalid-draft')
    expect(code(() => createEventV9(f.data, f.scope,
      draft(f.unitA.id, { startTime: '25:00' }), 'new'))).toBe('invalid-draft')
    expect(code(() => createEventV9(f.data, f.scope,
      { ...draft(f.unitA.id), recurrence: 'weekly' } as EventV9Draft, 'new'))).toBe('invalid-draft')
    expect(code(() => createEventV9(f.data, f.scope, draft(f.unitA.id, { type: 'task' }), 'new')))
      .toBe('invalid-draft')
    expect(code(() => createEventV9(f.data, f.scope, draft(f.unitA.id), f.unitA.id)))
      .toBe('id-collision')
    const unset = { ...f.data, projects: f.data.projects.map((item) => item.id === f.projectA
      ? { ...item, term: null } : item) }
    expect(code(() => createEventV9(unset, f.scope, draft(f.unitA.id), 'new'))).toBe('invalid-scope')
    expect(JSON.stringify(f.data)).toBe(original)
  })

  it('blocks missing, unresolved, cross-owner and ownership-changing edits', () => {
    const f = fixture()
    const owned = createEventV9(f.data, f.scope, draft(f.unitA.id), 'owned')
    const unresolved = { ...owned, events: [...owned.events, {
      id: 'unresolved', projectId: f.projectA, teachingUnitId: null, title: '待確認',
      type: 'meeting' as const, date: '2026-09-07', startTime: '09:00', endTime: '10:00',
      color: '#647C88', ownershipStatus: 'unresolved' as const,
      ownershipIssue: { reason: 'missing-teaching-unit' as const,
        candidateTimetableIds: ['teacher-a', 'teacher-b'] },
    }] }
    expect(isCompatibleAppDataV9(unresolved)).toBe(true)
    const unchanged = JSON.stringify(unresolved.events)
    expect(code(() => updateEventV9(unresolved, f.scope, 'absent', draft(f.unitA.id)))).toBe('not-found')
    expect(code(() => updateEventV9(unresolved, f.scope, 'unresolved', draft(f.unitA.id))))
      .toBe('invalid-scope')
    expect(code(() => updateEventV9(unresolved,
      { projectId: f.projectA, timetableId: 'teacher-b' }, 'owned', draft(f.unitA.id))))
      .toBe('invalid-scope')
    expect(code(() => updateEventV9(unresolved,
      { projectId: f.projectB, timetableId: 'teacher-c' }, 'owned', draft(f.unitA.id))))
      .toBe('invalid-scope')
    expect(code(() => updateEventV9(unresolved, f.scope, 'owned', draft(f.unitB.id))))
      .toBe('invalid-scope')
    expect(code(() => updateEventV9(unresolved, f.scope, 'owned',
      draft(f.unitA.id, { type: 'activity' })))).toBe('invalid-scope')
    expect(JSON.stringify(unresolved.events)).toBe(unchanged)
  })
})

function hostFixture(initial: AppDataV9) {
  let document = initial
  let revision = 0
  let writable = true
  let pending = false
  let reject = false
  let wrongReceipt = false
  let hold: Promise<void> | null = null
  const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
    const next = produce(document)
    if (hold) await hold
    if (reject) throw new Error('persistence-rejected')
    if (wrongReceipt) return { raw: JSON.stringify(next), revision: revision + 2, attemptId: 'bad' }
    document = next; revision += 1
    return { raw: JSON.stringify(next), revision, attemptId: `event-${revision}` }
  })
  const host = { get document() { return document }, status: 'active' as const,
    get writable() { return writable }, get pending() { return pending },
    receipt: null, get revision() { return revision }, errorCode: null, update,
  } satisfies FormalV9HostPort
  return { host, update, document: () => document, revision: () => revision,
    replace(next: AppDataV9) { document = next; revision += 1 },
    revoke() { writable = false }, busy() { pending = true },
    reject() { reject = true }, mismatch() { wrongReceipt = true },
    hold(promise: Promise<void>) { hold = promise },
  }
}

describe('Formal V9 Event controller', () => {
  it('creates and edits through ordinary Host receipts', async () => {
    const f = fixture()
    const state = hostFixture(f.data)
    const actions = createFormalEventManagementV9Controller(state.host, () => 'new-event', f.scope)
    const created = await actions.createMeeting(draft(f.unitA.id))
    expect(created).toMatchObject({ affectedId: 'new-event', selection: f.scope,
      receipt: { revision: 1, attemptId: 'event-1' } })
    expect(state.update).toHaveBeenCalledTimes(1)
    const next = createFormalEventManagementV9Controller(state.host, () => 'unused', f.scope)
    const edited = await next.updateMeeting('new-event', draft(f.unitA.id, { title: '改名' }))
    expect(edited.document.events[0].title).toBe('改名')
    expect(state.revision()).toBe(2)
    const activity = await createFormalEventManagementV9Controller(state.host,
      () => 'activity', f.scope).createActivity(draft(f.unitA.id))
    expect(activity.document.events[1].type).toBe('activity')
    const updated = await createFormalEventManagementV9Controller(state.host,
      () => 'unused', f.scope).updateActivity('activity', draft(f.unitA.id, { title: '活動改名' }))
    expect(updated.document.events[1].title).toBe('活動改名')
  })

  it('fails closed for stale selection/revision, readonly, pending and persistence rejection', async () => {
    const f = fixture()
    let selected: EventV9Scope = f.scope
    const selection = hostFixture(f.data)
    const held = createFormalEventManagementV9Controller(selection.host, () => 'new', f.scope,
      () => selected)
    selected = { projectId: f.projectB, timetableId: 'teacher-c' }
    await expect(held.createMeeting(draft(f.unitA.id))).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(selection.update).not.toHaveBeenCalled()
    const stale = hostFixture(f.data)
    const old = createFormalEventManagementV9Controller(stale.host, () => 'new', f.scope)
    stale.replace({ ...f.data, events: [] })
    await expect(old.createMeeting(draft(f.unitA.id))).rejects.toMatchObject({ code: 'stale-document' })
    const readonly = hostFixture(f.data)
    readonly.revoke()
    await expect(createFormalEventManagementV9Controller(readonly.host, () => 'new', f.scope)
      .createMeeting(draft(f.unitA.id))).rejects.toMatchObject({ code: 'not-writable' })
    const pending = hostFixture(f.data)
    pending.busy()
    await expect(createFormalEventManagementV9Controller(pending.host, () => 'new', f.scope)
      .createMeeting(draft(f.unitA.id))).rejects.toMatchObject({ code: 'duplicate-submit' })
    const rejected = hostFixture(f.data)
    rejected.reject()
    await expect(createFormalEventManagementV9Controller(rejected.host, () => 'new', f.scope)
      .createMeeting(draft(f.unitA.id))).rejects.toThrow('persistence-rejected')
    expect(rejected.document()).toBe(f.data)
    expect(rejected.revision()).toBe(0)
    const mismatch = hostFixture(f.data)
    mismatch.mismatch()
    await expect(createFormalEventManagementV9Controller(mismatch.host, () => 'new', f.scope)
      .createMeeting(draft(f.unitA.id))).rejects.toMatchObject({ code: 'receipt-mismatch' })
    expect(mismatch.document()).toBe(f.data)
  })

  it('rejects a second submit while the first Host write is pending', async () => {
    const f = fixture()
    const state = hostFixture(f.data)
    let release!: () => void
    state.hold(new Promise<void>((resolve) => { release = resolve }))
    const actions = createFormalEventManagementV9Controller(state.host,
      () => 'first', f.scope)
    const first = actions.createMeeting(draft(f.unitA.id))
    await expect(actions.createMeeting(draft(f.unitA.id))).rejects.toMatchObject({ code: 'duplicate-submit' })
    release()
    await expect(first).resolves.toMatchObject({ affectedId: 'first' })
    expect(state.update).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid domain candidates before persistence', async () => {
    const f = fixture()
    const state = hostFixture(f.data)
    await expect(createFormalEventManagementV9Controller(state.host, () => 'new', f.scope)
      .createActivity(draft(f.unitA.id, { date: '2027-02-01' })))
      .rejects.toMatchObject({ code: 'invalid-date' })
    expect(state.document()).toBe(f.data)
    expect(state.revision()).toBe(0)
  })
})

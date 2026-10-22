import { describe, expect, it } from 'vitest'
import type { AppDataV7, AppDataV8, CalendarEventV4 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import { createBlankProject } from './projectRuntime'
import {
  getEventRepairCase,
  listEventRepairCases,
  resolveEventOwnershipV8,
} from './eventRepairV8'
import { createTimetableV8, deleteTimetableV8 } from './eventTopologyV8'
import { selectResolvedEventsForTimetable } from './eventSelectorsV8'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

const legacy = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))

function errorCode(action: () => unknown): unknown {
  try {
    action()
    return null
  } catch (cause) {
    return cause && typeof cause === 'object' && 'code' in cause ? cause.code : null
  }
}

function eventFor(data: AppDataV7): CalendarEventV4 {
  const project = data.projects[0]
  const unit = data.teachingUnits.find((item) => item.projectId === project.id)!
  return {
    id: 'repair-event', projectId: project.id, teachingUnitId: unit.id,
    title: '教學研究會', type: 'meeting', date: unit.startDate,
    startTime: '09:00', endTime: '10:00', location: '會議室',
    notes: '保留完整內容', color: '#123456', origin: 'user',
  }
}

function ambiguous(): AppDataV8 {
  const data = legacy()
  const first = data.timetables[0]
  data.timetables.push({
    ...first, id: 'teacher-b', name: '教師 B 課表', teacherName: '王老師', teacherNamePending: undefined,
  })
  data.events = [eventFor(data)]
  return migrateV7ToV8(data)
}

function withoutTimetable(): AppDataV8 {
  const data = legacy()
  data.events = [eventFor(data)]
  data.timetables = []
  data.recurringLessons = []
  data.overrides = []
  data.oneOffLessons = []
  return migrateV7ToV8(data)
}

describe('V8 Event ownership repair', () => {
  it('lists only unresolved Events with safe Project, TeachingUnit, and Timetable candidates', () => {
    const data = ambiguous()
    const resolved = resolveEventOwnershipV8(data, {
      eventId: 'repair-event', projectId: data.projects[0].id,
      teachingUnitId: data.teachingUnits[0].id, timetableId: data.timetables[0].id,
    })
    const mixed: AppDataV8 = { ...data, events: [...data.events, resolved.events[0]]
      .map((event, index) => index === 1 ? { ...event, id: 'resolved-event' } : event) }

    const cases = listEventRepairCases(mixed)
    expect(cases).toHaveLength(1)
    expect(cases[0].event.id).toBe('repair-event')
    expect(cases[0].projects[0].teachingUnits.map((item) => item.id)).toContain(data.teachingUnits[0].id)
    expect(cases[0].projects[0].timetables.map((item) => item.id)).toEqual(data.timetables.map((item) => item.id))
  })

  it('resolves the explicitly selected Timetable, preserves content, and isolates normal projections', () => {
    const data = ambiguous()
    const before = structuredClone(data.events[0])
    const timetable = data.timetables[1]
    const next = resolveEventOwnershipV8(data, {
      eventId: before.id,
      projectId: data.projects[0].id,
      teachingUnitId: data.teachingUnits[0].id,
      timetableId: timetable.id,
    })
    const event = next.events[0]

    expect(event).toMatchObject({
      id: before.id, title: before.title, date: before.date, startTime: before.startTime,
      endTime: before.endTime, location: before.location, notes: before.notes,
      color: before.color, origin: before.origin, ownershipStatus: 'resolved', timetableId: timetable.id,
    })
    expect('ownershipIssue' in event).toBe(false)
    expect(next.events).toHaveLength(data.events.length)
    expect(selectResolvedEventsForTimetable(next, data.projects[0].id, timetable.id).map((item) => item.id)).toEqual([before.id])
    expect(selectResolvedEventsForTimetable(next, data.projects[0].id, data.timetables[0].id)).toEqual([])
    expect(isCompatibleAppDataV8(next)).toBe(true)
  })

  it('rejects cross-Project assignment and does not mutate the source', () => {
    const data = ambiguous()
    const ids = ['project-2', 'school-2', 'unit-2', 'timetable-2']
    const withSecond = createBlankProject(data, {
      name: '其他專案', teacherName: '其他老師', academicYear: 116, semester: 'first',
      startDate: '2027-08-30', endDate: '2028-01-19',
    }, () => ids.shift()!, '2027-08-01T00:00:00.000Z') as AppDataV8
    const snapshot = structuredClone(withSecond)

    expect(errorCode(() => resolveEventOwnershipV8(withSecond, {
      eventId: 'repair-event', projectId: 'project-2', teachingUnitId: 'unit-2', timetableId: 'timetable-2',
    }))).toBe('cross-project')
    expect(withSecond).toEqual(snapshot)
  })

  it('does not select a Timetable and blocks repair when no legal Timetable exists', () => {
    const data = withoutTimetable()
    const repairCase = getEventRepairCase(data, 'repair-event')

    expect(repairCase.projects[0].timetables).toEqual([])
    expect(errorCode(() => resolveEventOwnershipV8(data, {
      eventId: 'repair-event', projectId: data.projects[0].id,
      teachingUnitId: data.teachingUnits[0].id, timetableId: 'missing',
    }))).toBe('timetable-not-found')
  })

  it('requires an explicit valid TeachingUnit when the original reference is missing', () => {
    const source = legacy()
    const event = { ...eventFor(source), teachingUnitId: null }
    source.events = [event]
    const data = migrateV7ToV8(source)
    const repairCase = getEventRepairCase(data, event.id)

    expect(repairCase.event.ownershipIssue.reason).toBe('missing-teaching-unit')
    expect(repairCase.projects[0].teachingUnits.map((item) => item.id)).toContain(data.teachingUnits[0].id)
    const next = resolveEventOwnershipV8(data, {
      eventId: event.id, projectId: data.projects[0].id,
      teachingUnitId: data.teachingUnits[0].id, timetableId: data.timetables[0].id,
    })
    expect(next.events[0]).toMatchObject({
      id: event.id, teachingUnitId: data.teachingUnits[0].id,
      ownershipStatus: 'resolved', timetableId: data.timetables[0].id,
    })
  })
})

describe('V8 Event ownership topology safety', () => {
  it('keeps a missing-Timetable Event unresolved when the first Timetable is added', () => {
    const data = withoutTimetable()
    const next = createTimetableV8(data, {
      id: 'new-timetable', projectId: data.projects[0].id, name: '新課表', teacherName: '林老師',
    })

    expect(next.events[0]).toMatchObject({
      id: 'repair-event', ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'requires-confirmation', candidateTimetableIds: ['new-timetable'] },
    })
    expect(isCompatibleAppDataV8(next)).toBe(true)
  })

  it('refreshes candidates as Timetables are added and removed without dropping the Event', () => {
    const first = createTimetableV8(withoutTimetable(), {
      id: 'teacher-a', projectId: legacy().projects[0].id, name: 'A 課表', teacherName: '陳老師',
    })
    const second = createTimetableV8(first, {
      id: 'teacher-b', projectId: first.projects[0].id, name: 'B 課表', teacherName: '王老師',
    })
    expect(second.events[0]).toMatchObject({
      ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'ambiguous-timetable', candidateTimetableIds: ['teacher-a', 'teacher-b'] },
    })

    const removed = deleteTimetableV8(second, second.projects[0].id, 'teacher-b')
    expect(removed.events).toHaveLength(1)
    expect(removed.events[0]).toMatchObject({
      id: 'repair-event', ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'requires-confirmation', candidateTimetableIds: ['teacher-a'] },
    })
  })

  it('blocks deletion of a Timetable that owns a resolved Event', () => {
    const data = ambiguous()
    const resolved = resolveEventOwnershipV8(data, {
      eventId: 'repair-event', projectId: data.projects[0].id,
      teachingUnitId: data.teachingUnits[0].id, timetableId: 'teacher-b',
    })

    expect(errorCode(() => deleteTimetableV8(resolved, resolved.projects[0].id, 'teacher-b')))
      .toBe('event-owned')
    expect(resolved.events[0].id).toBe('repair-event')
  })

  it('blocks Timetable deletion while schedule records still reference it', () => {
    const data = ambiguous()
    const referenced = data.timetables[0]

    expect(errorCode(() => deleteTimetableV8(data, referenced.projectId, referenced.id)))
      .toBe('timetable-referenced')
    expect(data.timetables.some((item) => item.id === referenced.id)).toBe(true)
  })

  it('rejects a batch that hides Timetable deletion by deleting its Event too', () => {
    const data = ambiguous()
    const resolved = resolveEventOwnershipV8(data, {
      eventId: 'repair-event', projectId: data.projects[0].id,
      teachingUnitId: data.teachingUnits[0].id, timetableId: 'teacher-b',
    })
    const candidate: AppDataV8 = {
      ...resolved,
      timetables: resolved.timetables.filter((item) => item.id !== 'teacher-b'),
      events: [],
    }

    expect(isCompatibleAppDataV8(candidate)).toBe(true)
    expect(isSafeAppDataV8Update(resolved, candidate)).toBe(false)
  })
})

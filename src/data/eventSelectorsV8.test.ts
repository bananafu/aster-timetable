import { describe, expect, it } from 'vitest'
import type { AppDataV7, AppDataV8, CalendarEventV4, ResolvedCalendarEventV8, UnresolvedCalendarEventV8 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import { projectToLegacyView } from './projectRuntime'
import { selectResolvedEventsForTimetable, selectUnresolvedEvents } from './eventSelectorsV8'
import { isCompatibleAppDataV8 } from './validators/v8'

const v7 = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))

function baseEvent(data: AppDataV7): CalendarEventV4 {
  const projectId = data.projects[0].id
  const unit = data.teachingUnits.find((item) => item.projectId === projectId)!
  return {
    id: 'event-a', projectId, teachingUnitId: unit.id, title: '教師 A 事件', type: 'activity',
    date: unit.startDate, startTime: '10:00', endTime: '11:00', color: '#123456',
  }
}

describe('V8 Event selectors', () => {
  it('isolates resolved Events by Project and Timetable and excludes unresolved Events', () => {
    const legacy = v7()
    const migrated = migrateV7ToV8(legacy)
    const projectId = migrated.projects[0].id
    const timetableA = migrated.timetables[0]
    const timetableB = {
      ...timetableA, id: 'teacher-b', name: '教師 B',
      teacherName: '教師 B', teacherNamePending: undefined,
    }
    const event = baseEvent(legacy)
    const resolved: ResolvedCalendarEventV8 = {
      ...event, projectId, ownershipStatus: 'resolved', timetableId: timetableA.id,
    }
    const unresolved: UnresolvedCalendarEventV8 = {
      ...event, id: 'event-unresolved', ownershipStatus: 'unresolved',
      ownershipIssue: {
        reason: 'ambiguous-timetable', candidateTimetableIds: [timetableA.id, timetableB.id],
      },
    }
    const unassigned: UnresolvedCalendarEventV8 = {
      ...event, id: 'event-unassigned', projectId: null, teachingUnitId: null,
      ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'unassigned-project', candidateTimetableIds: [] },
    }
    const data: AppDataV8 = {
      ...migrated, timetables: [...migrated.timetables, timetableB], events: [resolved, unresolved, unassigned],
    }

    expect(isCompatibleAppDataV8(data)).toBe(true)
    expect(selectResolvedEventsForTimetable(data, projectId, timetableA.id)).toEqual([resolved])
    expect(selectResolvedEventsForTimetable(data, projectId, timetableB.id)).toEqual([])
    expect(selectResolvedEventsForTimetable(data, 'missing-project', timetableA.id)).toEqual([])
    expect(selectUnresolvedEvents(data, projectId)).toEqual([unresolved])
    expect(selectUnresolvedEvents(data, null)).toEqual([unassigned])
    expect(selectUnresolvedEvents(data)).toEqual([unresolved, unassigned])
  })

  it('leaves the V7 shared Event projection unchanged', () => {
    const data = v7()
    const projectId = data.projects[0].id
    const timetableA = data.timetables[0]
    const timetableB = {
      ...timetableA, id: 'teacher-b', name: '教師 B',
      teacherName: '教師 B', teacherNamePending: undefined,
    }
    const event = baseEvent(data)
    const withSharedEvent = { ...data, timetables: [...data.timetables, timetableB], events: [event] }

    expect(projectToLegacyView(withSharedEvent, projectId, timetableA.id).events.map((item) => item.id)).toEqual([event.id])
    expect(projectToLegacyView(withSharedEvent, projectId, timetableB.id).events.map((item) => item.id)).toEqual([event.id])
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { AppDataV7, CalendarEventV4 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import { isCompatibleAppDataV8 } from './validators/v8'

const base = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))

function legacyEvent(data: AppDataV7, change: Partial<CalendarEventV4> = {}): CalendarEventV4 {
  const projectId = data.projects[0].id
  const unit = data.teachingUnits.find((item) => item.projectId === projectId)!
  return {
    id: 'legacy-event', projectId, teachingUnitId: unit.id,
    title: '教學研究會', type: 'meeting', date: unit.startDate,
    startTime: '09:00', endTime: '10:00', location: '會議室', notes: '保留原始內容',
    color: '#123456', origin: 'user', ...change,
  }
}

describe('V8 Event ownership migration', () => {
  it('resolves an Event only when its valid TeachingUnit Project has exactly one Timetable', () => {
    const source = base()
    const event = legacyEvent(source)
    const input = { ...source, events: [event] }
    const snapshot = structuredClone(input)

    const migrated = migrateV7ToV8(input)
    const result = migrated.events[0]

    expect(result).toEqual({ ...event, ownershipStatus: 'resolved', timetableId: source.timetables[0].id })
    expect(result.id).toBe(event.id)
    expect(input).toEqual(snapshot)
    expect(migrateV7ToV8(input)).toEqual(migrated)
    expect(isCompatibleAppDataV8(migrated)).toBe(true)
  })

  it('preserves Events without a TeachingUnit as unresolved repair records', () => {
    const source = base()
    const event = legacyEvent(source, { teachingUnitId: null })
    const migrated = migrateV7ToV8({ ...source, events: [event] })

    expect(migrated.events).toEqual([{
      ...event,
      ownershipStatus: 'unresolved',
      ownershipIssue: {
        reason: 'missing-teaching-unit',
        candidateTimetableIds: source.timetables.map((item) => item.id),
      },
    }])
    expect(isCompatibleAppDataV8(migrated)).toBe(true)
  })

  it('distinguishes an unassigned Project from a Project that has no Timetable', () => {
    const source = base()
    const unassigned = legacyEvent(source, { id: 'unassigned-event', projectId: null, teachingUnitId: null })
    const withoutTimetable = legacyEvent(source, { id: 'no-timetable-event' })
    const migratedUnassigned = migrateV7ToV8({ ...source, events: [unassigned] })
    const migratedWithoutTimetable = migrateV7ToV8({
      ...source,
      timetables: [], recurringLessons: [], overrides: [], oneOffLessons: [],
      events: [withoutTimetable],
    })

    expect(migratedUnassigned.events[0]).toMatchObject({
      id: unassigned.id,
      ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'unassigned-project', candidateTimetableIds: [] },
    })
    expect(migratedWithoutTimetable.events[0]).toMatchObject({
      id: withoutTimetable.id,
      ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'missing-timetable', candidateTimetableIds: [] },
    })
    expect(isCompatibleAppDataV8(migratedUnassigned)).toBe(true)
    expect(isCompatibleAppDataV8(migratedWithoutTimetable)).toBe(true)
  })

  it('keeps an ambiguous Event once and never selects the first Timetable', () => {
    const source = base()
    const projectId = source.projects[0].id
    const second = {
      ...source.timetables[0], id: 'teacher-b', name: '教師 B',
      teacherName: '教師 B', teacherNamePending: undefined,
    }
    const event = legacyEvent(source)
    const input = { ...source, timetables: [...source.timetables, second], events: [event] }

    const migrated = migrateV7ToV8(input)

    expect(migrated.events).toHaveLength(1)
    expect(migrated.events[0]).toEqual({
      ...event,
      ownershipStatus: 'unresolved',
      ownershipIssue: {
        reason: 'ambiguous-timetable',
        candidateTimetableIds: input.timetables.filter((item) => item.projectId === projectId).map((item) => item.id),
      },
    })
    expect(isCompatibleAppDataV8(migrated)).toBe(true)
  })

  it('does not write storage or partially mutate input when migration is rejected', () => {
    const source = base()
    const invalid = { ...source, events: [legacyEvent(source, { projectId: 'missing-project' })] } as AppDataV7
    const snapshot = structuredClone(invalid)
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })

    expect(() => migrateV7ToV8(invalid)).toThrow('Invalid AppData v7')
    expect(invalid).toEqual(snapshot)
    expect(setItem).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('V8 Event ownership validation', () => {
  it('accepts resolved and unresolved Events but rejects missing or cross-Project Timetables', () => {
    const source = base()
    const resolved = migrateV7ToV8({ ...source, events: [legacyEvent(source)] })
    const unresolved = migrateV7ToV8({
      ...source, events: [legacyEvent(source, { teachingUnitId: null })],
    })
    expect(isCompatibleAppDataV8(resolved)).toBe(true)
    expect(isCompatibleAppDataV8(unresolved)).toBe(true)

    expect(isCompatibleAppDataV8({
      ...resolved,
      events: [{ ...resolved.events[0], timetableId: 'missing-timetable' }],
    })).toBe(false)

    const secondProject = { ...resolved.projects[0], id: 'project-b', name: 'Project B' }
    const secondTimetable = { ...resolved.timetables[0], id: 'timetable-b', projectId: secondProject.id }
    expect(isCompatibleAppDataV8({
      ...resolved,
      projects: [...resolved.projects, secondProject],
      timetables: [...resolved.timetables, secondTimetable],
      events: [{ ...resolved.events[0], timetableId: secondTimetable.id }],
    })).toBe(false)
  })

  it('rejects contradictory states and incomplete unresolved repair metadata', () => {
    const source = base()
    const resolved = migrateV7ToV8({ ...source, events: [legacyEvent(source)] })
    const unresolved = migrateV7ToV8({
      ...source, events: [legacyEvent(source, { teachingUnitId: null })],
    })
    expect(isCompatibleAppDataV8({
      ...resolved,
      events: [{
        ...resolved.events[0],
        ownershipIssue: { reason: 'ambiguous-timetable', candidateTimetableIds: [] },
      }],
    })).toBe(false)
    expect(isCompatibleAppDataV8({
      ...unresolved,
      events: [{ ...unresolved.events[0], timetableId: source.timetables[0].id }],
    })).toBe(false)
    expect(isCompatibleAppDataV8({
      ...unresolved,
      events: [{
        ...unresolved.events[0],
        ownershipIssue: { reason: 'missing-teaching-unit', candidateTimetableIds: [] },
      }],
    })).toBe(false)
  })
})

import type {
  AppDataV7,
  CalendarEventV4,
  CalendarEventV8,
  EventOwnershipIssueV8,
  Timetable,
  TimetableProject,
  TeachingUnit,
} from '../types'

type EventOwnershipContext = Pick<AppDataV7, 'projects' | 'timetables' | 'teachingUnits'>
export type DerivedEventOwnershipV8 =
  | { ownershipStatus: 'resolved'; timetableId: string }
  | { ownershipStatus: 'unresolved'; ownershipIssue: EventOwnershipIssueV8 }

type UnknownRecord = Record<string, unknown>

const record = (value: unknown): value is UnknownRecord => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasOwn = (value: UnknownRecord, key: string) => Object.prototype.hasOwnProperty.call(value, key)

export function deriveLegacyEventOwnershipV8(
  data: EventOwnershipContext,
  event: CalendarEventV4,
): DerivedEventOwnershipV8 {
  if (event.projectId === null || !data.projects.some((project) => project.id === event.projectId)) {
    return {
      ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'unassigned-project', candidateTimetableIds: [] },
    }
  }

  const candidateTimetableIds = data.timetables
    .filter((timetable) => timetable.projectId === event.projectId)
    .map((timetable) => timetable.id)
  const unit = event.teachingUnitId
    ? data.teachingUnits.find((candidate) => candidate.id === event.teachingUnitId)
    : undefined

  if (!unit || unit.projectId !== event.projectId) {
    return {
      ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'missing-teaching-unit', candidateTimetableIds },
    }
  }
  if (candidateTimetableIds.length === 0) {
    return {
      ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'missing-timetable', candidateTimetableIds: [] },
    }
  }
  if (candidateTimetableIds.length > 1) {
    return {
      ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'ambiguous-timetable', candidateTimetableIds },
    }
  }
  return { ownershipStatus: 'resolved', timetableId: candidateTimetableIds[0] }
}

export function migrateEventOwnershipV8(data: EventOwnershipContext, event: CalendarEventV4): CalendarEventV8 {
  const ownership = deriveLegacyEventOwnershipV8(data, event)
  return ownership.ownershipStatus === 'resolved'
    ? { ...event, projectId: event.projectId!, ownershipStatus: 'resolved', timetableId: ownership.timetableId }
    : { ...event, ownershipStatus: 'unresolved', ownershipIssue: ownership.ownershipIssue }
}

function legacyV8Context(value: UnknownRecord): EventOwnershipContext | null {
  if (!Array.isArray(value.projects) || !Array.isArray(value.timetables) || !Array.isArray(value.teachingUnits)) return null
  return {
    projects: value.projects as TimetableProject[],
    timetables: value.timetables as Timetable[],
    teachingUnits: value.teachingUnits as TeachingUnit[],
  }
}

/**
 * Adds ownership only to the exact legacy V8 Event shape. Partial or conflicting
 * ownership fields are left unchanged so the V8 validator can reject them.
 */
export function upgradeLegacyV8EventOwnership(value: unknown): unknown {
  if (!record(value) || value.schemaVersion !== 8 || !Array.isArray(value.events)) return value
  const context = legacyV8Context(value)
  if (!context) return value
  let changed = false
  const events = value.events.map((event) => {
    if (!record(event) || hasOwn(event, 'ownershipStatus') || hasOwn(event, 'timetableId') || hasOwn(event, 'ownershipIssue')) {
      return event
    }
    changed = true
    return migrateEventOwnershipV8(context, event as unknown as CalendarEventV4)
  })
  return changed ? { ...value, events } : value
}

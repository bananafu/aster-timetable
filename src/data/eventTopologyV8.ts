import type { AppDataV8, Timetable, UnresolvedCalendarEventV8 } from '../types'
import { deriveLegacyEventOwnershipV8 } from './eventOwnershipV8'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

export type EventTopologyV8ErrorCode =
  | 'invalid-data'
  | 'project-not-found'
  | 'archived-project'
  | 'invalid-timetable'
  | 'id-collision'
  | 'timetable-not-found'
  | 'timetable-referenced'
  | 'event-owned'
  | 'invalid-result'

export class EventTopologyV8Error extends Error {
  constructor(public readonly code: EventTopologyV8ErrorCode, message: string) {
    super(message)
    this.name = 'EventTopologyV8Error'
  }
}

export interface CreateTimetableV8Input {
  id: string
  projectId: string
  name: string
  teacherName: string
}

function fail(code: EventTopologyV8ErrorCode, message: string): never {
  throw new EventTopologyV8Error(code, message)
}

function assertData(data: AppDataV8): void {
  if (!isCompatibleAppDataV8(data)) fail('invalid-data', 'A valid AppDataV8 document is required.')
}

function allEntityIds(data: AppDataV8): Set<string> {
  return new Set([
    ...data.projects.map((item) => item.id), ...data.timetables.map((item) => item.id),
    ...data.schools.map((item) => item.id), ...data.teachingUnits.map((item) => item.id),
    ...data.subjects.map((item) => item.id), ...data.teachingUnitSubjects.map((item) => item.id),
    ...data.classes.map((item) => item.id),
    ...data.recurringLessons.flatMap((item) => [item.id, item.seriesId]),
    ...data.events.map((item) => item.id), ...data.overrides.map((item) => item.id),
    ...data.oneOffLessons.map((item) => item.id), ...data.teachingProgress.map((item) => item.id),
    ...data.migrationWarnings.map((item) => item.id),
  ])
}

function refreshedUnresolvedEvent(
  data: AppDataV8,
  event: UnresolvedCalendarEventV8,
): UnresolvedCalendarEventV8 {
  const derived = deriveLegacyEventOwnershipV8(data, event)
  return {
    ...event,
    ownershipIssue: derived.ownershipStatus === 'resolved'
      ? { reason: 'requires-confirmation', candidateTimetableIds: [derived.timetableId] }
      : derived.ownershipIssue,
  }
}

function refreshUnresolvedEventCandidatesV8(data: AppDataV8): AppDataV8 {
  return {
    ...data,
    events: data.events.map((event) => event.ownershipStatus === 'unresolved'
      ? refreshedUnresolvedEvent(data, event)
      : event),
  }
}

function validatedTopologyResult(current: AppDataV8, candidate: AppDataV8): AppDataV8 {
  const next = refreshUnresolvedEventCandidatesV8(candidate)
  if (!isCompatibleAppDataV8(next) || !isSafeAppDataV8Update(current, next)) {
    fail('invalid-result', 'Timetable topology update did not pass AppDataV8 validation.')
  }
  return next
}

export function createTimetableV8(data: AppDataV8, input: CreateTimetableV8Input): AppDataV8 {
  assertData(data)
  const project = data.projects.find((item) => item.id === input.projectId)
  if (!project) fail('project-not-found', 'Project does not exist.')
  if (project.archivedAt) fail('archived-project', 'Archived Projects are read-only.')
  const id = input.id.trim()
  const name = input.name.trim()
  const teacherName = input.teacherName.trim()
  if (!id || !name || !teacherName) fail('invalid-timetable', 'Timetable ID, name, and teacher name are required.')
  if (allEntityIds(data).has(id)) fail('id-collision', 'Timetable ID collides with existing data.')
  const timetable: Timetable = { id, projectId: project.id, name, teacherName }
  return validatedTopologyResult(data, { ...data, timetables: [...data.timetables, timetable] })
}

export function deleteTimetableV8(data: AppDataV8, projectId: string, timetableId: string): AppDataV8 {
  assertData(data)
  const project = data.projects.find((item) => item.id === projectId)
  if (!project) fail('project-not-found', 'Project does not exist.')
  if (project.archivedAt) fail('archived-project', 'Archived Projects are read-only.')
  const timetable = data.timetables.find((item) => item.id === timetableId && item.projectId === project.id)
  if (!timetable) fail('timetable-not-found', 'Timetable does not belong to the specified Project.')
  if (data.events.some((event) => event.ownershipStatus === 'resolved' && event.timetableId === timetable.id)) {
    fail('event-owned', 'Timetable still owns Events and cannot be deleted.')
  }
  if (data.recurringLessons.some((item) => item.timetableId === timetable.id)
    || data.overrides.some((item) => item.timetableId === timetable.id)
    || data.oneOffLessons.some((item) => item.timetableId === timetable.id)
    || data.teachingProgress.some((item) => item.timetableId === timetable.id)) {
    fail('timetable-referenced', 'Timetable still has schedule or progress records and cannot be deleted.')
  }
  return validatedTopologyResult(data, {
    ...data,
    timetables: data.timetables.filter((item) => item.id !== timetable.id),
  })
}

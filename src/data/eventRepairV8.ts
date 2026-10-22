import type {
  AppDataV8,
  ResolvedCalendarEventV8,
  Timetable,
  TimetableProject,
  TeachingUnit,
  UnresolvedCalendarEventV8,
} from '../types'
import { selectUnresolvedEvents } from './eventSelectorsV8'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

export type EventRepairV8ErrorCode =
  | 'invalid-data'
  | 'event-not-found'
  | 'already-resolved'
  | 'project-not-found'
  | 'archived-project'
  | 'cross-project'
  | 'teaching-unit-not-found'
  | 'teaching-unit-changed'
  | 'timetable-not-found'
  | 'invalid-result'

export class EventRepairV8Error extends Error {
  constructor(public readonly code: EventRepairV8ErrorCode, message: string) {
    super(message)
    this.name = 'EventRepairV8Error'
  }
}

export interface EventRepairProjectCandidateV8 {
  project: TimetableProject
  teachingUnits: TeachingUnit[]
  timetables: Timetable[]
}

export interface EventRepairCaseV8 {
  event: UnresolvedCalendarEventV8
  projects: EventRepairProjectCandidateV8[]
}

export interface ResolveEventOwnershipV8Input {
  eventId: string
  projectId: string
  teachingUnitId: string
  timetableId: string
}

function fail(code: EventRepairV8ErrorCode, message: string): never {
  throw new EventRepairV8Error(code, message)
}

function assertData(data: AppDataV8): void {
  if (!isCompatibleAppDataV8(data)) fail('invalid-data', 'A valid AppDataV8 document is required.')
}

const cloneProject = (project: TimetableProject): TimetableProject => ({
  ...project,
  term: { ...project.term },
})
const cloneUnit = (unit: TeachingUnit): TeachingUnit => ({
  ...unit,
  periods: unit.periods.map((period) => ({ ...period })),
  weekCycle: { ...unit.weekCycle },
})
const cloneTimetable = (timetable: Timetable): Timetable => ({ ...timetable })
const cloneEvent = (event: UnresolvedCalendarEventV8): UnresolvedCalendarEventV8 => ({
  ...event,
  ownershipIssue: {
    ...event.ownershipIssue,
    candidateTimetableIds: [...event.ownershipIssue.candidateTimetableIds],
  },
})

export function getEventRepairCase(data: AppDataV8, eventId: string): EventRepairCaseV8 {
  assertData(data)
  const event = data.events.find((item) => item.id === eventId)
  if (!event) fail('event-not-found', 'Event does not exist.')
  if (event.ownershipStatus !== 'unresolved') fail('already-resolved', 'Event ownership is already resolved.')

  const existingProject = event.projectId
    ? data.projects.find((project) => project.id === event.projectId)
    : undefined
  const projectCandidates = existingProject ? [existingProject] : data.projects
  return {
    event: cloneEvent(event),
    projects: projectCandidates.filter((project) => !project.archivedAt).map((project) => {
      const existingUnit = event.teachingUnitId
        ? data.teachingUnits.find((unit) => unit.id === event.teachingUnitId && unit.projectId === project.id)
        : undefined
      const units = existingUnit
        ? [existingUnit]
        : data.teachingUnits.filter((unit) => unit.projectId === project.id)
      return {
        project: cloneProject(project),
        teachingUnits: units.map(cloneUnit),
        timetables: data.timetables.filter((timetable) => timetable.projectId === project.id).map(cloneTimetable),
      }
    }),
  }
}

export function listEventRepairCases(data: AppDataV8): EventRepairCaseV8[] {
  assertData(data)
  return selectUnresolvedEvents(data).map((event) => getEventRepairCase(data, event.id))
}

export function resolveEventOwnershipV8(data: AppDataV8, input: ResolveEventOwnershipV8Input): AppDataV8 {
  assertData(data)
  const event = data.events.find((item) => item.id === input.eventId)
  if (!event) fail('event-not-found', 'Event does not exist.')
  if (event.ownershipStatus !== 'unresolved') fail('already-resolved', 'Event ownership is already resolved.')

  const project = data.projects.find((item) => item.id === input.projectId)
  if (!project) fail('project-not-found', 'Selected Project does not exist.')
  if (project.archivedAt) fail('archived-project', 'Archived Projects are read-only.')
  const originalProject = event.projectId
    ? data.projects.find((item) => item.id === event.projectId)
    : undefined
  if (originalProject && originalProject.id !== project.id) {
    fail('cross-project', 'Event cannot be assigned to a different existing Project.')
  }

  const unit = data.teachingUnits.find((item) => item.id === input.teachingUnitId)
  if (!unit || unit.projectId !== project.id) {
    fail('teaching-unit-not-found', 'Selected TeachingUnit does not belong to the Event Project.')
  }
  const originalUnit = event.teachingUnitId
    ? data.teachingUnits.find((item) => item.id === event.teachingUnitId && item.projectId === project.id)
    : undefined
  if (originalUnit && originalUnit.id !== unit.id) {
    fail('teaching-unit-changed', 'A valid existing TeachingUnit cannot be replaced during Event ownership repair.')
  }

  const timetable = data.timetables.find((item) => item.id === input.timetableId)
  if (!timetable || timetable.projectId !== project.id) {
    fail('timetable-not-found', 'Selected Timetable does not belong to the Event Project.')
  }

  const { ownershipIssue: _ownershipIssue, timetableId: _timetableId, ...original } = event
  void _ownershipIssue
  void _timetableId
  const resolved: ResolvedCalendarEventV8 = {
    ...original,
    projectId: project.id,
    teachingUnitId: unit.id,
    ownershipStatus: 'resolved',
    timetableId: timetable.id,
  }
  const next: AppDataV8 = {
    ...data,
    events: data.events.map((item) => item.id === event.id ? resolved : item),
  }
  if (!isCompatibleAppDataV8(next) || !isSafeAppDataV8Update(data, next)) {
    fail('invalid-result', 'Event repair did not pass AppDataV8 validation.')
  }
  return next
}

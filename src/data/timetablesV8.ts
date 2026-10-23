import type { AppDataV8, Timetable } from '../types'
import { createTimetableV8, deleteTimetableV8 } from './eventTopologyV8'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

export interface TimetableV8Details { name: string; teacherName: string }
export class TimetableV8Error extends Error {
  constructor(public readonly code: 'invalid-data' | 'project-unavailable' | 'not-found' | 'invalid-details'
    | 'unsafe-update', message: string) { super(message); this.name = 'TimetableV8Error' }
}
const fail = (code: TimetableV8Error['code'], message: string): never => { throw new TimetableV8Error(code, message) }
const valid = (data: AppDataV8) => { if (!isCompatibleAppDataV8(data)) fail('invalid-data', 'V8 document is invalid.') }
const project = (data: AppDataV8, projectId: string) => {
  const value = data.projects.find((item) => item.id === projectId)
  if (!value || value.archivedAt) fail('project-unavailable', 'Project is unavailable.')
}
const details = (input: TimetableV8Details): TimetableV8Details => {
  const name = input.name?.trim()
  const teacherName = input.teacherName?.trim()
  if (!name || !teacherName) fail('invalid-details', 'Timetable and teacher names are required.')
  return { name, teacherName }
}
const safe = (current: AppDataV8, next: AppDataV8) => {
  if (!isSafeAppDataV8Update(current, next)) fail('unsafe-update', 'Timetable update is unsafe.')
  return next
}

export function listTimetablesV8(data: AppDataV8, projectId: string): Timetable[] {
  valid(data)
  if (!data.projects.some((item) => item.id === projectId)) fail('project-unavailable', 'Project does not exist.')
  return data.timetables.filter((item) => item.projectId === projectId).map((item) => ({ ...item }))
}
export function createTeacherTimetableV8(data: AppDataV8, projectId: string, input: TimetableV8Details, id: string): AppDataV8 {
  valid(data)
  project(data, projectId)
  return createTimetableV8(data, { id, projectId, ...details(input) })
}
export function updateTeacherTimetableV8(data: AppDataV8, projectId: string, timetableId: string,
  input: TimetableV8Details): AppDataV8 {
  valid(data)
  project(data, projectId)
  if (!data.timetables.some((item) => item.id === timetableId && item.projectId === projectId)) {
    fail('not-found', 'Timetable does not belong to Project.')
  }
  const changed = details(input)
  return safe(data, { ...data, timetables: data.timetables.map((item) => item.id === timetableId
    ? { ...item, ...changed, teacherNamePending: undefined } : item) })
}
/** Configuration-only copy: lessons, events, changes and progress remain untouched. */
export function duplicateTeacherTimetableV8(data: AppDataV8, sourceProjectId: string, sourceTimetableId: string,
  destinationProjectId: string, id: string, override?: TimetableV8Details): AppDataV8 {
  valid(data)
  project(data, sourceProjectId)
  project(data, destinationProjectId)
  const source = data.timetables.find((item) => item.id === sourceTimetableId && item.projectId === sourceProjectId)
  if (!source) fail('not-found', 'Source Timetable does not belong to Project.')
  if (!source!.teacherName) fail('invalid-details', 'Source teacher name is unresolved.')
  return createTimetableV8(data, { id, projectId: destinationProjectId,
    ...details(override ?? { name: `${source!.name}（副本）`, teacherName: source!.teacherName! }) })
}
export function getTimetableV8Impact(data: AppDataV8, projectId: string, timetableId: string) {
  valid(data)
  const timetable = data.timetables.find((item) => item.id === timetableId && item.projectId === projectId)
  if (!timetable) fail('not-found', 'Timetable does not belong to Project.')
  return { timetable: timetable!, recurringLessons: data.recurringLessons.filter((item) => item.timetableId === timetableId).length,
    oneOffLessons: data.oneOffLessons.filter((item) => item.timetableId === timetableId).length,
    changes: data.overrides.filter((item) => item.timetableId === timetableId).length,
    events: data.events.filter((item) => item.ownershipStatus === 'resolved' && item.timetableId === timetableId).length,
    progress: data.teachingProgress.filter((item) => item.timetableId === timetableId).length }
}
export function deleteTeacherTimetableV8(data: AppDataV8, projectId: string, timetableId: string,
  confirmed = false): AppDataV8 {
  const impact = getTimetableV8Impact(data, projectId, timetableId)
  project(data, projectId)
  if (!confirmed) fail('invalid-details', 'Deletion requires explicit confirmation.')
  if (impact.recurringLessons || impact.oneOffLessons || impact.changes || impact.events || impact.progress) {
    fail('unsafe-update', 'Timetable still has referenced content.')
  }
  return deleteTimetableV8(data, projectId, timetableId)
}

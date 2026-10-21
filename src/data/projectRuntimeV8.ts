import type { AppDataV8 } from '../types'
import {
  createBlankProject as createLegacyBlankProject,
  type NewProjectInput,
} from './projectRuntime'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

export class ProjectLifecycleV8Error extends Error {
  constructor(
    public readonly code:
      | 'invalid-data'
      | 'not-found'
      | 'invalid-id'
      | 'id-collision'
      | 'confirmation-required'
      | 'unsafe-update',
    message: string,
  ) {
    super(message)
    this.name = 'ProjectLifecycleV8Error'
  }
}

export interface ProjectDeletionImpactV8 {
  projectId: string
  timetables: number
  schools: number
  teachingUnits: number
  subjects: number
  classes: number
  recurringLessons: number
  events: number
  overrides: number
  oneOffLessons: number
  teachingProgress: number
}

function fail(code: ProjectLifecycleV8Error['code'], message: string): never {
  throw new ProjectLifecycleV8Error(code, message)
}

function assertData(data: AppDataV8): void {
  if (!isCompatibleAppDataV8(data)) fail('invalid-data', 'A valid AppDataV8 document is required.')
}

function allEntityIds(data: AppDataV8): Set<string> {
  return new Set([
    ...data.projects.map((item) => item.id), ...data.timetables.map((item) => item.id),
    ...data.schools.map((item) => item.id), ...data.teachingUnits.map((item) => item.id),
    ...data.subjects.map((item) => item.id), ...data.classes.map((item) => item.id),
    ...data.recurringLessons.flatMap((item) => [item.id, item.seriesId]),
    ...data.events.map((item) => item.id), ...data.overrides.map((item) => item.id),
    ...data.oneOffLessons.map((item) => item.id), ...data.teachingProgress.map((item) => item.id),
    ...data.migrationWarnings.map((item) => item.id),
  ])
}

function assertResult(current: AppDataV8, next: AppDataV8): AppDataV8 {
  if (!isSafeAppDataV8Update(current, next)) fail('unsafe-update', 'Project update did not pass AppDataV8 safety validation.')
  return next
}

export function createBlankProject(
  data: AppDataV8,
  input: NewProjectInput,
  createId: () => string,
  now = new Date().toISOString(),
): AppDataV8 {
  assertData(data)
  const usedIds = allEntityIds(data)
  const checkedCreateId = () => {
    const id = createId()
    if (typeof id !== 'string' || !id.trim() || id !== id.trim()) fail('invalid-id', 'Generated Project entity ID is invalid.')
    if (usedIds.has(id)) fail('id-collision', 'Generated Project entity ID collides with existing data.')
    usedIds.add(id)
    return id
  }
  const next = createLegacyBlankProject(data, input, checkedCreateId, now) as AppDataV8
  return assertResult(data, next)
}

export function getProjectDeletionImpact(data: AppDataV8, projectId: string): ProjectDeletionImpactV8 {
  assertData(data)
  if (!data.projects.some((project) => project.id === projectId)) fail('not-found', 'Project does not exist.')
  return {
    projectId,
    timetables: data.timetables.filter((item) => item.projectId === projectId).length,
    schools: data.schools.filter((item) => item.projectId === projectId).length,
    teachingUnits: data.teachingUnits.filter((item) => item.projectId === projectId).length,
    subjects: data.subjects.filter((item) => item.projectId === projectId).length,
    classes: data.classes.filter((item) => item.projectId === projectId).length,
    recurringLessons: data.recurringLessons.filter((item) => item.projectId === projectId).length,
    events: data.events.filter((item) => item.projectId === projectId).length,
    overrides: data.overrides.filter((item) => item.projectId === projectId).length,
    oneOffLessons: data.oneOffLessons.filter((item) => item.projectId === projectId).length,
    teachingProgress: data.teachingProgress.filter((item) => item.projectId === projectId).length,
  }
}

export function deleteProject(data: AppDataV8, projectId: string, confirmed = false): AppDataV8 {
  assertData(data)
  if (!data.projects.some((project) => project.id === projectId)) fail('not-found', 'Project does not exist.')
  if (!confirmed) fail('confirmation-required', 'Permanent Project deletion requires explicit confirmation.')

  const entityIds = new Set([
    projectId,
    ...data.timetables.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.schools.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.teachingUnits.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.subjects.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.classes.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.recurringLessons.filter((item) => item.projectId === projectId).flatMap((item) => [item.id, item.seriesId]),
    ...data.events.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.overrides.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.oneOffLessons.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.teachingProgress.filter((item) => item.projectId === projectId).map((item) => item.id),
  ])
  const projects = data.projects.filter((project) => project.id !== projectId)
  const next: AppDataV8 = {
    ...data,
    activeProjectId: data.activeProjectId === projectId
      ? projects.find((project) => !project.archivedAt)?.id ?? null
      : data.activeProjectId,
    projects,
    timetables: data.timetables.filter((item) => item.projectId !== projectId),
    schools: data.schools.filter((item) => item.projectId !== projectId),
    teachingUnits: data.teachingUnits.filter((item) => item.projectId !== projectId),
    subjects: data.subjects.filter((item) => item.projectId !== projectId),
    classes: data.classes.filter((item) => item.projectId !== projectId),
    recurringLessons: data.recurringLessons.filter((item) => item.projectId !== projectId),
    events: data.events.filter((item) => item.projectId !== projectId),
    overrides: data.overrides.filter((item) => item.projectId !== projectId),
    oneOffLessons: data.oneOffLessons.filter((item) => item.projectId !== projectId),
    teachingProgress: data.teachingProgress.filter((item) => item.projectId !== projectId),
    migrationWarnings: data.migrationWarnings.filter((item) => !entityIds.has(item.entityId)),
  }
  return assertResult(data, next)
}

import type { AppDataV8 } from '../types'
import {
  createBlankProject as createLegacyBlankProject,
  type CopyProjectInput,
  type NewProjectInput,
} from './projectRuntime'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

export class ProjectLifecycleV8Error extends Error {
  constructor(
    public readonly code:
      | 'invalid-data'
      | 'not-found'
      | 'invalid-input'
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

export interface CopyProjectUnitV8Input {
  sourceUnitId: string
  /** Selects the single source lesson version that is effective on this date. */
  sourceEffectiveDate: string
  startDate: string
  endDate: string
  anchorDate: string
  anchorPattern: 'A' | 'B'
}

export interface CopyProjectV8Input extends Omit<CopyProjectInput, 'units'> {
  units: CopyProjectUnitV8Input[]
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

function checkedIdFactory(data: AppDataV8, createId: () => string): () => string {
  const usedIds = allEntityIds(data)
  return () => {
    const id = createId()
    if (typeof id !== 'string' || !id.trim() || id !== id.trim()) fail('invalid-id', 'Generated Project entity ID is invalid.')
    if (usedIds.has(id)) fail('id-collision', 'Generated Project entity ID collides with existing data.')
    usedIds.add(id)
    return id
  }
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function createBlankProject(
  data: AppDataV8,
  input: NewProjectInput,
  createId: () => string,
  now = new Date().toISOString(),
): AppDataV8 {
  assertData(data)
  const checkedCreateId = checkedIdFactory(data, createId)
  const next = createLegacyBlankProject(data, input, checkedCreateId, now) as AppDataV8
  return assertResult(data, next)
}

/**
 * Copies the effective recurring schedule into an independent V8 Project.
 * Storage persistence and user confirmation remain the caller's responsibility.
 */
export function copyProject(
  data: AppDataV8,
  input: CopyProjectV8Input,
  createId: () => string,
  now = new Date().toISOString(),
): AppDataV8 {
  assertData(data)
  const source = data.projects.find((project) => project.id === input.sourceProjectId)
  if (!source) fail('not-found', 'Source Project does not exist.')

  const sourceSchools = data.schools.filter((school) => school.projectId === source.id)
  const sourceUnits = data.teachingUnits.filter((unit) => unit.projectId === source.id)
  const sourceTimetables = data.timetables.filter((timetable) => timetable.projectId === source.id)
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || !Number.isInteger(input.academicYear) || input.academicYear <= 0
    || !['first', 'second', 'summer', 'custom'].includes(input.semester)
    || (input.semester === 'custom' && !input.customLabel?.trim())
    || sourceSchools.length === 0 || sourceUnits.length === 0 || sourceTimetables.length === 0
    || !Array.isArray(input.units) || input.units.length !== sourceUnits.length) {
    fail('invalid-input', 'Project copy input is invalid.')
  }

  const configs = new Map(input.units.map((config) => [config.sourceUnitId, config]))
  if (configs.size !== sourceUnits.length || sourceUnits.some((unit) => {
    const config = configs.get(unit.id)
    return !config || !isDateKey(config.sourceEffectiveDate)
      || config.sourceEffectiveDate < unit.startDate || config.sourceEffectiveDate > unit.endDate
      || !isDateKey(config.startDate) || !isDateKey(config.endDate) || config.startDate > config.endDate
      || !isDateKey(config.anchorDate) || config.anchorDate < config.startDate || config.anchorDate > config.endDate
      || !['A', 'B'].includes(config.anchorPattern)
  })) fail('invalid-input', 'Every TeachingUnit requires a valid source effective date, new date range, and A/B anchor.')

  const selectedLessons = data.recurringLessons.filter((lesson) => {
    if (lesson.projectId !== source.id) return false
    const config = configs.get(lesson.teachingUnitId)!
    return lesson.effectiveStart <= config.sourceEffectiveDate
      && (!lesson.effectiveEnd || config.sourceEffectiveDate <= lesson.effectiveEnd)
  })

  const nextId = checkedIdFactory(data, createId)
  const projectId = nextId()
  const subjectIds = new Map(data.subjects.filter((subject) => subject.projectId === source.id)
    .map((subject) => [subject.id, nextId()]))
  const schoolIds = new Map(sourceSchools.map((school) => [school.id, nextId()]))
  const unitIds = new Map(sourceUnits.map((unit) => [unit.id, nextId()]))
  const sourceClasses = data.classes.filter((schoolClass) => schoolClass.projectId === source.id)
  const classIds = new Map(sourceClasses.map((schoolClass) => [schoolClass.id, nextId()]))
  const timetableIds = new Map(sourceTimetables.map((timetable) => [timetable.id, nextId()]))
  const seriesIds = new Map<string, string>()
  for (const lesson of selectedLessons) {
    if (!seriesIds.has(lesson.seriesId)) seriesIds.set(lesson.seriesId, nextId())
  }
  const lessonIds = new Map(selectedLessons.map((lesson) => [lesson.id, nextId()]))

  const next: AppDataV8 = {
    ...data,
    activeProjectId: projectId,
    projects: [...data.projects, {
      id: projectId,
      name,
      term: {
        academicYear: input.academicYear,
        semester: input.semester,
        customLabel: input.semester === 'custom' ? input.customLabel?.trim() : undefined,
      },
      createdAt: now,
      updatedAt: now,
    }],
    timetables: [...data.timetables, ...sourceTimetables.map((timetable) => ({
      ...timetable,
      id: timetableIds.get(timetable.id)!,
      projectId,
    }))],
    schools: [...data.schools, ...sourceSchools.map((school) => ({
      ...school,
      id: schoolIds.get(school.id)!,
      projectId,
    }))],
    teachingUnits: [...data.teachingUnits, ...sourceUnits.map((unit) => {
      const config = configs.get(unit.id)!
      return {
        ...unit,
        id: unitIds.get(unit.id)!,
        projectId,
        schoolId: schoolIds.get(unit.schoolId)!,
        startDate: config.startDate,
        endDate: config.endDate,
        periods: unit.periods.map((period) => ({ ...period })),
        weekCycle: { ...unit.weekCycle, anchorDate: config.anchorDate, anchorPattern: config.anchorPattern },
      }
    })],
    subjects: [...data.subjects, ...data.subjects.filter((subject) => subject.projectId === source.id).map((subject) => ({
      ...subject,
      id: subjectIds.get(subject.id)!,
      projectId,
      applicableSchoolLevels: [...subject.applicableSchoolLevels],
    }))],
    classes: [...data.classes, ...sourceClasses.map((schoolClass) => ({
      ...schoolClass,
      id: classIds.get(schoolClass.id)!,
      projectId,
      teachingUnitId: unitIds.get(schoolClass.teachingUnitId)!,
    }))],
    recurringLessons: [...data.recurringLessons, ...selectedLessons.map((lesson) => {
      const config = configs.get(lesson.teachingUnitId)!
      return {
        ...lesson,
        id: lessonIds.get(lesson.id)!,
        seriesId: seriesIds.get(lesson.seriesId)!,
        projectId,
        timetableId: timetableIds.get(lesson.timetableId)!,
        teachingUnitId: unitIds.get(lesson.teachingUnitId)!,
        subjectId: subjectIds.get(lesson.subjectId)!,
        classId: classIds.get(lesson.classId)!,
        effectiveStart: config.startDate,
        effectiveEnd: config.endDate,
      }
    })],
  }
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

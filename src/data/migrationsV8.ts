import type { AppDataV7, AppDataV8, SubjectV8, TeachingUnitSubject } from '../types'
import { migrateEventOwnershipV8 } from './eventOwnershipV8'
import {
  preflightV7ToV8,
  reconcileV7ToV8,
  type V8MigrationPreflightReport,
  type V8MigrationReconciliationReport,
} from './migrationPreflightV8'
import { isCompatibleAppDataV8 } from './validators/v8'

export type V8MigrationErrorCode =
  | 'unassigned-subject-reference'
  | 'unassigned-teaching-unit-subject-reference'
  | 'subject-name-conflict'
  | 'subject-id-allocation-failed'
  | 'zero-project-subjects'
  | 'invalid-v7'
  | 'unexpected-v7-progress'
  | 'reconciliation-failed'

export class V8MigrationError extends Error {
  constructor(
    public readonly code: V8MigrationErrorCode,
    message: string,
    public readonly entityId?: string,
    public readonly subjectId?: string,
    public readonly preflight?: V8MigrationPreflightReport,
    public readonly reconciliation?: V8MigrationReconciliationReport,
  ) {
    super(message)
    this.name = 'V8MigrationError'
  }
}

const subjectMapKey = (projectId: string, subjectId: string) => JSON.stringify([projectId, subjectId])
const relationIdBase = (projectId: string, teachingUnitId: string, subjectId: string) =>
  `v8-teaching-unit-subject:${encodeURIComponent(projectId)}:${encodeURIComponent(teachingUnitId)}:${encodeURIComponent(subjectId)}`

type UnknownRecord = Record<string, unknown>
const record = (value: unknown): value is UnknownRecord => value !== null && typeof value === 'object' && !Array.isArray(value)

function allocateRelationId(projectId: string, teachingUnitId: string, subjectId: string, usedIds: Set<string>): string {
  const base = relationIdBase(projectId, teachingUnitId, subjectId)
  for (let suffix = 0; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}:${suffix}`
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate)
      return candidate
    }
  }
  throw new V8MigrationError(
    'subject-id-allocation-failed',
    `Unable to allocate a unique TeachingUnitSubject ID for TeachingUnit ${teachingUnitId} and Subject ${subjectId}.`,
    teachingUnitId,
    subjectId,
  )
}

function inferTeachingUnitSubjects(
  subjects: readonly SubjectV8[],
  teachingUnits: AppDataV8['teachingUnits'],
  usedIds: Set<string>,
): TeachingUnitSubject[] {
  return teachingUnits.flatMap((unit) => subjects
    .filter((subject) => subject.projectId === unit.projectId && subject.applicableSchoolLevels.includes(unit.schoolLevel))
    .map((subject) => ({
      id: allocateRelationId(unit.projectId, unit.id, subject.id, usedIds),
      projectId: unit.projectId,
      teachingUnitId: unit.id,
      subjectId: subject.id,
    })))
}

function documentEntityIds(value: UnknownRecord): Set<string> {
  const ids = new Set<string>()
  for (const key of [
    'projects', 'timetables', 'schools', 'teachingUnits', 'subjects', 'classes', 'recurringLessons',
    'events', 'overrides', 'oneOffLessons', 'teachingProgress', 'migrationWarnings',
  ]) {
    const collection = value[key]
    if (!Array.isArray(collection)) continue
    for (const item of collection) {
      if (!record(item)) continue
      if (typeof item.id === 'string') ids.add(item.id)
      if (key === 'recurringLessons' && typeof item.seriesId === 'string') ids.add(item.seriesId)
    }
  }
  return ids
}

/**
 * Upgrades only the recognized legacy V8 shape that predates TeachingUnitSubject.
 * A present collection is never repaired or replaced; validation owns that path.
 */
export function upgradeLegacyV8TeachingUnitSubjects(value: unknown): unknown {
  if (!record(value) || value.schemaVersion !== 8
    || Object.prototype.hasOwnProperty.call(value, 'teachingUnitSubjects')) return value
  if (!Array.isArray(value.subjects) || !Array.isArray(value.teachingUnits)) return value
  const subjects = value.subjects as SubjectV8[]
  const teachingUnits = value.teachingUnits as AppDataV8['teachingUnits']
  return {
    ...value,
    teachingUnitSubjects: inferTeachingUnitSubjects(subjects, teachingUnits, documentEntityIds(value)),
  }
}

function reservedEntityIds(source: AppDataV7): Set<string> {
  return new Set([
    ...source.projects.map((item) => item.id), ...source.timetables.map((item) => item.id),
    ...source.schools.map((item) => item.id), ...source.teachingUnits.map((item) => item.id),
    ...source.classes.map((item) => item.id),
    ...source.recurringLessons.flatMap((item) => [item.id, item.seriesId]),
    ...source.events.map((item) => item.id), ...source.overrides.map((item) => item.id),
    ...source.oneOffLessons.map((item) => item.id), ...source.migrationWarnings.map((item) => item.id),
  ])
}

function allocateSubjectId(projectId: string, subjectId: string, usedIds: Set<string>): string {
  const base = `v8-subject:${encodeURIComponent(projectId)}:${encodeURIComponent(subjectId)}`
  for (let suffix = 0; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}:${suffix}`
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate)
      return candidate
    }
  }
  throw new V8MigrationError(
    'subject-id-allocation-failed',
    `Unable to allocate a unique V8 Subject ID for project ${projectId} and Subject ${subjectId}.`,
    undefined,
    subjectId,
  )
}

function mappedSubjectId(mapping: Map<string, string>, projectId: string, subjectId: string): string {
  const mapped = mapping.get(subjectMapKey(projectId, subjectId))
  if (!mapped) throw new Error(`Missing V8 Subject mapping for project ${projectId} and Subject ${subjectId}.`)
  return mapped
}

export interface V8MigrationResult {
  data: AppDataV8
  preflight: V8MigrationPreflightReport
  reconciliation: V8MigrationReconciliationReport
}

function throwPreflightFailure(preflight: V8MigrationPreflightReport): never {
  const priority = [
    'unassigned-subject-reference',
    'unassigned-teaching-unit-subject-reference',
    'unexpected-v7-progress',
    'zero-project-subjects',
    'subject-name-conflict',
    'invalid-v7',
  ] as const
  const blocking = priority
    .map((code) => preflight.issues.find((item) => item.severity === 'blocking' && item.code === code))
    .find((item) => item !== undefined) ?? preflight.issues.find((item) => item.severity === 'blocking')!
  if (blocking.code === 'invalid-v7') throw new V8MigrationError('invalid-v7', 'Invalid AppData v7', undefined, undefined, preflight)
  if (blocking.code === 'unexpected-v7-progress') {
    throw new V8MigrationError('unexpected-v7-progress', 'Unexpected teaching progress data in AppData v7', undefined, undefined, preflight)
  }
  if (blocking.code === 'subject-name-conflict') {
    throw new V8MigrationError('subject-name-conflict', blocking.message, blocking.entityIds.at(-1), blocking.entityIds[0], preflight)
  }
  if (blocking.code === 'unassigned-subject-reference' || blocking.code === 'unassigned-teaching-unit-subject-reference') {
    throw new V8MigrationError(blocking.code, blocking.message, blocking.entityIds[0], blocking.entityIds[1], preflight)
  }
  if (blocking.code === 'zero-project-subjects') {
    throw new V8MigrationError('zero-project-subjects', blocking.message, blocking.entityIds[0], undefined, preflight)
  }
  throw new V8MigrationError('invalid-v7', blocking.message, blocking.entityIds[0], undefined, preflight)
}

export function migrateV7ToV8WithReport(source: AppDataV7): V8MigrationResult {
  const sourceSnapshot = JSON.stringify(source)
  const preflight = preflightV7ToV8(source)
  if (!preflight.canMigrate) throwPreflightFailure(preflight)

  const usedIds = reservedEntityIds(source)
  const subjectIds = new Map<string, string>()
  const subjects: SubjectV8[] = source.projects.flatMap((project) => source.subjects.map((subject) => {
    const id = allocateSubjectId(project.id, subject.id, usedIds)
    subjectIds.set(subjectMapKey(project.id, subject.id), id)
    return { ...subject, id, projectId: project.id }
  }))
  const teachingUnitSubjects = inferTeachingUnitSubjects(subjects, source.teachingUnits, usedIds)

  const migrated: AppDataV8 = {
    ...source,
    schemaVersion: 8,
    subjects,
    teachingUnitSubjects,
    events: source.events.map((event) => migrateEventOwnershipV8(source, event)),
    recurringLessons: source.recurringLessons.map((lesson) => ({
      ...lesson,
      subjectId: mappedSubjectId(subjectIds, lesson.projectId, lesson.subjectId),
    })),
    overrides: source.overrides.map((override) => override.replacement && override.projectId !== null
      ? { ...override, replacement: {
        ...override.replacement,
        subjectId: mappedSubjectId(subjectIds, override.projectId, override.replacement.subjectId),
      } }
      : { ...override }),
    oneOffLessons: source.oneOffLessons.map((lesson) => ({
      ...lesson,
      subjectId: mappedSubjectId(subjectIds, lesson.projectId, lesson.subjectId),
    })),
    teachingProgress: [],
  }
  if (!isCompatibleAppDataV8(migrated)) throw new V8MigrationError('reconciliation-failed', 'Invalid AppData v8 migration', undefined, undefined, preflight)
  const reconciliation = reconcileV7ToV8(source, migrated)
  if (!reconciliation.isReconciled) {
    throw new V8MigrationError(
      'reconciliation-failed',
      'V7 to V8 migration reconciliation failed.',
      reconciliation.issues[0]?.entityIds[0],
      undefined,
      preflight,
      reconciliation,
    )
  }
  if (JSON.stringify(source) !== sourceSnapshot) {
    const sourceMutation: V8MigrationReconciliationReport = {
      isReconciled: false,
      issues: [{
        severity: 'blocking', code: 'reconciliation-reference-mismatch',
        message: 'The source V7 document changed during migration.', entityIds: [],
      }],
    }
    throw new V8MigrationError('reconciliation-failed', sourceMutation.issues[0].message, undefined, undefined, preflight, sourceMutation)
  }
  return { data: migrated, preflight, reconciliation }
}

export function migrateV7ToV8(source: AppDataV7): AppDataV8 {
  return migrateV7ToV8WithReport(source).data
}

import type { AppDataV7, AppDataV8, SubjectV8, TeachingUnitSubject } from '../types'
import { normalizeSubjectText } from '../lib/subjectSearch'
import { migrateEventOwnershipV8 } from './eventOwnershipV8'
import { isCompatibleAppDataV7 } from './validators/v7'
import { isCompatibleAppDataV8 } from './validators/v8'

export type V8MigrationErrorCode =
  | 'unassigned-subject-reference'
  | 'unassigned-teaching-unit-subject-reference'
  | 'subject-name-conflict'
  | 'subject-id-allocation-failed'

export class V8MigrationError extends Error {
  constructor(
    public readonly code: V8MigrationErrorCode,
    message: string,
    public readonly entityId?: string,
    public readonly subjectId?: string,
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

function assertMigratableSubjectNames(source: AppDataV7): void {
  for (const field of ['name', 'shortName'] as const) {
    const seen = new Map<string, string>()
    for (const subject of source.subjects) {
      const key = normalizeSubjectText(subject[field])
      const priorId = seen.get(key)
      if (priorId) {
        throw new V8MigrationError(
          'subject-name-conflict',
          `Cannot migrate Subjects ${priorId} and ${subject.id}: normalized ${field} values conflict in every Project. Resolve the V7 collision before retrying.`,
          subject.id,
          priorId,
        )
      }
      seen.set(key, subject.id)
    }
  }
}

function findUnassignedReplacement(
  source: AppDataV7,
  field: 'projectId' | 'teachingUnitId',
): { entityId: string; subjectId: string } | undefined {
  if (!record(source) || !Array.isArray(source.overrides)) return undefined
  for (const override of source.overrides) {
    if (!record(override) || override[field] !== null || !record(override.replacement)
      || typeof override.id !== 'string' || typeof override.replacement.subjectId !== 'string') continue
    return { entityId: override.id, subjectId: override.replacement.subjectId }
  }
  return undefined
}

export function migrateV7ToV8(source: AppDataV7): AppDataV8 {
  const unassignedReference = findUnassignedReplacement(source, 'projectId')
  if (unassignedReference) {
    throw new V8MigrationError(
      'unassigned-subject-reference',
      `Cannot migrate legacy Override ${unassignedReference.entityId}: Subject ${unassignedReference.subjectId} has no Project ownership. Restore or assign the Override to a Project in V7 before retrying.`,
      unassignedReference.entityId,
      unassignedReference.subjectId,
    )
  }
  const unassignedUnitReference = findUnassignedReplacement(source, 'teachingUnitId')
  if (unassignedUnitReference) {
    throw new V8MigrationError(
      'unassigned-teaching-unit-subject-reference',
      `Cannot migrate legacy Override ${unassignedUnitReference.entityId}: Subject ${unassignedUnitReference.subjectId} has no TeachingUnit ownership. Restore or assign the Override to a TeachingUnit in V7 before retrying.`,
      unassignedUnitReference.entityId,
      unassignedUnitReference.subjectId,
    )
  }
  if (!isCompatibleAppDataV7(source)) throw new Error('Invalid AppData v7')
  if (Object.prototype.hasOwnProperty.call(source, 'teachingProgress')) {
    throw new Error('Unexpected teaching progress data in AppData v7')
  }
  assertMigratableSubjectNames(source)

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
  if (!isCompatibleAppDataV8(migrated)) throw new Error('Invalid AppData v8 migration')
  return migrated
}

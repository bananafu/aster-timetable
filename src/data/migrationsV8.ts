import type { AppDataV7, AppDataV8, SubjectV8 } from '../types'
import { normalizeSubjectText } from '../lib/subjectSearch'
import { isCompatibleAppDataV7 } from './validators/v7'
import { isCompatibleAppDataV8 } from './validators/v8'

export type V8MigrationErrorCode = 'unassigned-subject-reference' | 'subject-name-conflict' | 'subject-id-allocation-failed'

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

export function migrateV7ToV8(source: AppDataV7): AppDataV8 {
  if (!isCompatibleAppDataV7(source)) throw new Error('Invalid AppData v7')
  if (Object.prototype.hasOwnProperty.call(source, 'teachingProgress')) {
    throw new Error('Unexpected teaching progress data in AppData v7')
  }
  assertMigratableSubjectNames(source)

  const unassignedReference = source.overrides.find((override) => override.projectId === null && override.replacement)
  if (unassignedReference?.replacement) {
    throw new V8MigrationError(
      'unassigned-subject-reference',
      `Cannot migrate legacy Override ${unassignedReference.id}: Subject ${unassignedReference.replacement.subjectId} has no Project ownership. Restore or assign the Override to a Project in V7 before retrying.`,
      unassignedReference.id,
      unassignedReference.replacement.subjectId,
    )
  }

  const usedIds = reservedEntityIds(source)
  const subjectIds = new Map<string, string>()
  const subjects: SubjectV8[] = source.projects.flatMap((project) => source.subjects.map((subject) => {
    const id = allocateSubjectId(project.id, subject.id, usedIds)
    subjectIds.set(subjectMapKey(project.id, subject.id), id)
    return { ...subject, id, projectId: project.id }
  }))

  const migrated: AppDataV8 = {
    ...source,
    schemaVersion: 8,
    subjects,
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

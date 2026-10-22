import type { AppDataV7, AppDataV8, CalendarEventV4, SubjectV5 } from '../types'
import { normalizeSubjectText } from '../lib/subjectSearch'
import { deriveLegacyEventOwnershipV8 } from './eventOwnershipV8'
import { isCompatibleAppDataV7 } from './validators/v7'

export type V8MigrationIssueSeverity = 'blocking' | 'review' | 'informational'

export type V8MigrationIssueCode =
  | 'invalid-v7'
  | 'unexpected-v7-progress'
  | 'zero-project-subjects'
  | 'subject-name-conflict'
  | 'unassigned-subject-reference'
  | 'unassigned-teaching-unit-subject-reference'
  | 'unresolved-events'
  | 'migration-summary'
  | 'reconciliation-count-mismatch'
  | 'reconciliation-id-mismatch'
  | 'reconciliation-subject-mapping'
  | 'reconciliation-reference-mismatch'
  | 'reconciliation-event-mismatch'
  | 'reconciliation-relation-mismatch'

export interface V8MigrationIssue {
  severity: V8MigrationIssueSeverity
  code: V8MigrationIssueCode
  message: string
  entityIds: string[]
  details?: Record<string, string | number | string[] | Record<string, number>>
}

export interface V8MigrationPreflightCounts {
  projects: number
  projectIds: string[]
  teachingUnits: number
  teachingUnitsByProject: Record<string, number>
  teachingUnitIdsByProject: Record<string, string[]>
  subjects: number
  expectedV8Subjects: number
  expectedV8SubjectsByProject: Record<string, number>
  recurringLessons: number
  oneOffLessons: number
  overrides: number
  events: number
  unresolvedEvents: number
  unresolvedEventsByReason: Record<string, number>
}

export interface V8MigrationPreflightReport {
  canMigrate: boolean
  counts: V8MigrationPreflightCounts
  issues: V8MigrationIssue[]
}

export interface V8MigrationReconciliationReport {
  isReconciled: boolean
  issues: V8MigrationIssue[]
}

const issue = (
  severity: V8MigrationIssueSeverity,
  code: V8MigrationIssueCode,
  message: string,
  entityIds: string[] = [],
  details?: V8MigrationIssue['details'],
): V8MigrationIssue => ({ severity, code, message, entityIds, ...(details ? { details } : {}) })

const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)

function conflictingSubjects(subjects: readonly SubjectV5[]): V8MigrationIssue[] {
  const issues: V8MigrationIssue[] = []
  for (const field of ['name', 'shortName'] as const) {
    const idsByValue = new Map<string, string[]>()
    for (const subject of subjects) {
      const key = normalizeSubjectText(subject[field])
      idsByValue.set(key, [...(idsByValue.get(key) ?? []), subject.id])
    }
    for (const [value, ids] of idsByValue) {
      const uniqueIds = [...new Set(ids)]
      if (uniqueIds.length < 2) continue
      issues.push(issue(
        'blocking',
        'subject-name-conflict',
        `Subjects ${uniqueIds.join(', ')} have the same normalized ${field}; migration cannot choose a catalog identity safely.`,
        uniqueIds,
        { field, normalizedValue: value },
      ))
    }
  }
  return issues
}

export function preflightV7ToV8(source: AppDataV7): V8MigrationPreflightReport {
  const projects = Array.isArray(source?.projects) ? source.projects : []
  const teachingUnits = Array.isArray(source?.teachingUnits) ? source.teachingUnits : []
  const subjects = Array.isArray(source?.subjects) ? source.subjects : []
  const events = Array.isArray(source?.events) ? source.events : []
  const overrides = Array.isArray(source?.overrides) ? source.overrides : []
  const issues: V8MigrationIssue[] = []

  if (!isCompatibleAppDataV7(source)) {
    issues.push(issue('blocking', 'invalid-v7', 'The source document is not compatible AppData v7.'))
  }
  if (own(source, 'teachingProgress')) {
    issues.push(issue('blocking', 'unexpected-v7-progress', 'AppData v7 unexpectedly contains teachingProgress.'))
  }
  if (projects.length === 0 && subjects.length > 0) {
    issues.push(issue(
      'blocking',
      'zero-project-subjects',
      'Legacy Subjects exist without a Project, so migration cannot assign ownership safely.',
      subjects.map((subject) => subject.id),
      { subjectCount: subjects.length },
    ))
  }
  issues.push(...conflictingSubjects(subjects))

  for (const override of overrides) {
    if (!override.replacement) continue
    if (override.projectId === null) {
      issues.push(issue(
        'blocking', 'unassigned-subject-reference',
        `Replacement Override ${override.id} has no Project ownership.`,
        [override.id, override.replacement.subjectId],
      ))
    } else if (override.teachingUnitId === null) {
      issues.push(issue(
        'blocking', 'unassigned-teaching-unit-subject-reference',
        `Replacement Override ${override.id} has no TeachingUnit ownership.`,
        [override.id, override.replacement.subjectId],
      ))
    }
  }

  const unresolvedEventsByReason: Record<string, number> = {}
  const unresolvedEventIds: string[] = []
  for (const event of events) {
    const ownership = deriveLegacyEventOwnershipV8(source, event)
    if (ownership.ownershipStatus === 'resolved') continue
    unresolvedEventIds.push(event.id)
    unresolvedEventsByReason[ownership.ownershipIssue.reason] =
      (unresolvedEventsByReason[ownership.ownershipIssue.reason] ?? 0) + 1
  }
  if (unresolvedEventIds.length > 0) {
    issues.push(issue(
      'review', 'unresolved-events',
      `${unresolvedEventIds.length} Event(s) will be preserved for ownership repair.`,
      unresolvedEventIds,
      { reasons: unresolvedEventsByReason },
    ))
  }

  const teachingUnitsByProject: Record<string, number> = {}
  const teachingUnitIdsByProject: Record<string, string[]> = {}
  for (const unit of teachingUnits) {
    teachingUnitsByProject[unit.projectId] = (teachingUnitsByProject[unit.projectId] ?? 0) + 1
    teachingUnitIdsByProject[unit.projectId] = [...(teachingUnitIdsByProject[unit.projectId] ?? []), unit.id]
  }
  const expectedV8SubjectsByProject = Object.fromEntries(projects.map((project) => [project.id, subjects.length]))
  const counts: V8MigrationPreflightCounts = {
    projects: projects.length,
    projectIds: projects.map((project) => project.id),
    teachingUnits: teachingUnits.length,
    teachingUnitsByProject,
    teachingUnitIdsByProject,
    subjects: subjects.length,
    expectedV8Subjects: projects.length * subjects.length,
    expectedV8SubjectsByProject,
    recurringLessons: Array.isArray(source?.recurringLessons) ? source.recurringLessons.length : 0,
    oneOffLessons: Array.isArray(source?.oneOffLessons) ? source.oneOffLessons.length : 0,
    overrides: overrides.length,
    events: events.length,
    unresolvedEvents: unresolvedEventIds.length,
    unresolvedEventsByReason,
  }
  issues.push(issue('informational', 'migration-summary', 'V7 migration inventory completed.', [], {
    projects: counts.projects,
    teachingUnits: counts.teachingUnits,
    subjects: counts.subjects,
    expectedV8Subjects: counts.expectedV8Subjects,
    recurringLessons: counts.recurringLessons,
    oneOffLessons: counts.oneOffLessons,
    overrides: counts.overrides,
    events: counts.events,
  }))
  return { canMigrate: !issues.some((item) => item.severity === 'blocking'), counts, issues }
}

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id)
const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

function sourceEvent(event: AppDataV8['events'][number]): CalendarEventV4 {
  const copy = { ...event } as Record<string, unknown>
  delete copy.ownershipStatus
  delete copy.timetableId
  delete copy.ownershipIssue
  return copy as unknown as CalendarEventV4
}

export function reconcileV7ToV8(source: AppDataV7, result: AppDataV8): V8MigrationReconciliationReport {
  const issues: V8MigrationIssue[] = []
  const addMismatch = (code: V8MigrationIssueCode, message: string, entityIds: string[] = []) => {
    issues.push(issue('blocking', code, message, entityIds))
  }

  if (source.activeProjectId !== result.activeProjectId) {
    addMismatch('reconciliation-reference-mismatch', 'activeProjectId changed during migration.')
  }

  for (const key of ['projects', 'timetables', 'schools', 'teachingUnits', 'classes', 'migrationWarnings'] as const) {
    if (!sameJson(source[key], result[key])) addMismatch('reconciliation-id-mismatch', `${key} changed during migration.`)
  }
  for (const key of ['recurringLessons', 'events', 'overrides', 'oneOffLessons'] as const) {
    if (source[key].length !== result[key].length) {
      addMismatch('reconciliation-count-mismatch', `${key} count changed during migration.`)
    }
    if (!sameJson(ids(source[key]), ids(result[key]))) {
      addMismatch('reconciliation-id-mismatch', `${key} IDs or ordering changed during migration.`, ids(source[key]))
    }
  }

  const expectedSubjectCount = source.projects.length * source.subjects.length
  if (result.subjects.length !== expectedSubjectCount) {
    addMismatch('reconciliation-count-mismatch', `Expected ${expectedSubjectCount} V8 Subjects but found ${result.subjects.length}.`)
  }
  const subjectMap = new Map<string, string>()
  for (const project of source.projects) {
    for (const legacySubject of source.subjects) {
      const matches = result.subjects.filter((candidate) => candidate.projectId === project.id
        && candidate.name === legacySubject.name && candidate.shortName === legacySubject.shortName
        && candidate.color === legacySubject.color
        && sameJson(candidate.applicableSchoolLevels, legacySubject.applicableSchoolLevels)
        && candidate.origin === legacySubject.origin)
      if (matches.length !== 1) {
        addMismatch(
          'reconciliation-subject-mapping',
          `Subject ${legacySubject.id} does not map exactly once in Project ${project.id}.`,
          [legacySubject.id, project.id],
        )
      } else {
        subjectMap.set(JSON.stringify([project.id, legacySubject.id]), matches[0].id)
      }
    }
  }

  const mapped = (projectId: string | null, subjectId: string) => projectId === null
    ? undefined
    : subjectMap.get(JSON.stringify([projectId, subjectId]))
  for (const [index, lesson] of source.recurringLessons.entries()) {
    const migrated = result.recurringLessons[index]
    if (!migrated || migrated.subjectId !== mapped(lesson.projectId, lesson.subjectId)
      || !sameJson({ ...lesson, subjectId: migrated.subjectId }, migrated)) {
      addMismatch('reconciliation-reference-mismatch', `Recurring Lesson ${lesson.id} was not remapped safely.`, [lesson.id])
    }
  }
  for (const [index, lesson] of source.oneOffLessons.entries()) {
    const migrated = result.oneOffLessons[index]
    if (!migrated || migrated.subjectId !== mapped(lesson.projectId, lesson.subjectId)
      || !sameJson({ ...lesson, subjectId: migrated.subjectId }, migrated)) {
      addMismatch('reconciliation-reference-mismatch', `OneOffLesson ${lesson.id} was not remapped safely.`, [lesson.id])
    }
  }
  for (const [index, override] of source.overrides.entries()) {
    const migrated = result.overrides[index]
    const expected = override.replacement && override.projectId !== null
      ? { ...override, replacement: { ...override.replacement, subjectId: mapped(override.projectId, override.replacement.subjectId) } }
      : override
    if (!migrated || !sameJson(expected, migrated)) {
      addMismatch('reconciliation-reference-mismatch', `Override ${override.id} was not preserved safely.`, [override.id])
    }
  }
  for (const [index, event] of source.events.entries()) {
    const migrated = result.events[index]
    if (!migrated || !sameJson(event, sourceEvent(migrated))) {
      addMismatch('reconciliation-event-mismatch', `Event ${event.id} content changed during ownership migration.`, [event.id])
    }
  }

  const expectedRelations = result.teachingUnits.flatMap((unit) => result.subjects
    .filter((subject) => subject.projectId === unit.projectId && subject.applicableSchoolLevels.includes(unit.schoolLevel))
    .map((subject) => JSON.stringify([unit.projectId, unit.id, subject.id])))
  const actualRelations = result.teachingUnitSubjects
    .map((relation) => JSON.stringify([relation.projectId, relation.teachingUnitId, relation.subjectId]))
  if (!sameJson([...actualRelations].sort(), [...expectedRelations].sort())) {
    addMismatch('reconciliation-relation-mismatch', 'TeachingUnitSubject relations do not match the inferred V7 visibility rules.')
  }
  if (result.teachingProgress.length !== 0) {
    addMismatch('reconciliation-count-mismatch', 'V7 migration unexpectedly produced TeachingProgress records.')
  }
  return { isReconciled: issues.length === 0, issues }
}

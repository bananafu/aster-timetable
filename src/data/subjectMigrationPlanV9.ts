import type { AppDataV8 } from '../types'
import { isCompatibleAppDataV8 } from './validators/v8'

export type SubjectMigrationReferenceKindV9 = 'lesson' | 'one-off' | 'change-replacement'
  | 'progress' | 'teaching-unit-subject'
export type SubjectMigrationClassV9 = 'unreferenced' | 'single-timetable'
  | 'multiple-timetables' | 'configuration-only' | 'cross-teaching-units' | 'invalid-or-ambiguous'
export type SubjectMigrationIssueCodeV9 = 'invalid-v8-source' | 'missing-subject'
  | 'reference-project-mismatch' | 'reference-timetable-missing'
  | 'reference-timetable-project-mismatch' | 'reference-teaching-unit-missing'
  | 'reference-teaching-unit-project-mismatch' | 'unassigned-owner'
  | 'configuration-only' | 'multiple-owners'

export interface SubjectMigrationIssueV9 {
  code: SubjectMigrationIssueCodeV9
  subjectId: string | null
  referenceKind?: SubjectMigrationReferenceKindV9
  referenceId?: string
}

export interface SubjectMigrationReferenceV9 {
  kind: SubjectMigrationReferenceKindV9
  id: string
  projectId: string | null
  timetableId: string | null
  teachingUnitId: string | null
}

export interface SubjectMigrationEntryV9 {
  subjectId: string
  projectId: string
  classification: SubjectMigrationClassV9
  possibleTargetTimetableIds: string[]
  references: SubjectMigrationReferenceV9[]
  referenceCounts: Record<SubjectMigrationReferenceKindV9, number>
  autoAssignable: boolean
  requiresSubjectCopy: boolean
  requiresUserDecision: boolean
  issues: SubjectMigrationIssueV9[]
}

export interface SubjectMigrationPlanV9 {
  sourceCompatibleV8: boolean
  entries: SubjectMigrationEntryV9[]
  issues: SubjectMigrationIssueV9[]
  canAutoAssignAll: boolean
}

const emptyCounts = (): Record<SubjectMigrationReferenceKindV9, number> => ({
  lesson: 0, 'one-off': 0, 'change-replacement': 0, progress: 0, 'teaching-unit-subject': 0,
})

/** Pure inspection only. In particular, this function never allocates IDs or rewrites a reference. */
export function inspectSubjectMigrationV9(data: AppDataV8): SubjectMigrationPlanV9 {
  const sourceCompatibleV8 = isCompatibleAppDataV8(data)
  const allIssues: SubjectMigrationIssueV9[] = sourceCompatibleV8 ? []
    : [{ code: 'invalid-v8-source', subjectId: null }]
  const timetables = new Map(data.timetables.map((item) => [item.id, item]))
  const units = new Map(data.teachingUnits.map((item) => [item.id, item]))
  const entries = data.subjects.map((subject): SubjectMigrationEntryV9 => ({
    subjectId: subject.id,
    projectId: subject.projectId,
    classification: 'unreferenced',
    possibleTargetTimetableIds: [],
    references: [],
    referenceCounts: emptyCounts(),
    autoAssignable: false,
    requiresSubjectCopy: false,
    requiresUserDecision: true,
    issues: [],
  }))
  const bySubject = new Map(entries.map((entry) => [entry.subjectId, entry]))
  const issue = (entry: SubjectMigrationEntryV9 | undefined, code: SubjectMigrationIssueCodeV9,
    reference?: SubjectMigrationReferenceV9, subjectId: string | null = entry?.subjectId ?? null) => {
    const item: SubjectMigrationIssueV9 = { code, subjectId,
      ...(reference && { referenceKind: reference.kind, referenceId: reference.id }) }
    if (entry) entry.issues.push(item)
    allIssues.push(item)
  }
  const add = (subjectId: string, reference: SubjectMigrationReferenceV9) => {
    const entry = bySubject.get(subjectId)
    if (!entry) { issue(undefined, 'missing-subject', reference, subjectId); return }
    entry.references.push(reference)
    entry.referenceCounts[reference.kind] += 1
    if (reference.projectId !== entry.projectId) issue(entry, 'reference-project-mismatch', reference)
    const unit = reference.teachingUnitId ? units.get(reference.teachingUnitId) : undefined
    if (!unit) issue(entry, 'reference-teaching-unit-missing', reference)
    else if (unit.projectId !== entry.projectId) issue(entry, 'reference-teaching-unit-project-mismatch', reference)
    if (reference.kind !== 'teaching-unit-subject') {
      const timetable = reference.timetableId ? timetables.get(reference.timetableId) : undefined
      if (!timetable) issue(entry, 'reference-timetable-missing', reference)
      else if (timetable.projectId !== entry.projectId) {
        issue(entry, 'reference-timetable-project-mismatch', reference)
      }
    }
  }
  for (const lesson of data.recurringLessons) add(lesson.subjectId, {
    kind: 'lesson', id: lesson.id, projectId: lesson.projectId,
    timetableId: lesson.timetableId ?? null, teachingUnitId: lesson.teachingUnitId,
  })
  for (const lesson of data.oneOffLessons) add(lesson.subjectId, {
    kind: 'one-off', id: lesson.id, projectId: lesson.projectId,
    timetableId: lesson.timetableId, teachingUnitId: lesson.teachingUnitId,
  })
  for (const change of data.overrides) if (change.replacement) add(change.replacement.subjectId, {
    kind: 'change-replacement', id: change.id, projectId: change.projectId,
    timetableId: change.timetableId ?? null, teachingUnitId: change.teachingUnitId,
  })
  for (const progress of data.teachingProgress) add(progress.subjectId, {
    kind: 'progress', id: progress.id, projectId: progress.projectId,
    timetableId: progress.timetableId, teachingUnitId: progress.teachingUnitId,
  })
  for (const relation of data.teachingUnitSubjects) add(relation.subjectId, {
    kind: 'teaching-unit-subject', id: relation.id, projectId: relation.projectId,
    timetableId: null, teachingUnitId: relation.teachingUnitId,
  })

  for (const entry of entries) {
    const direct = entry.references.filter((item) => item.kind !== 'teaching-unit-subject')
    const owners = [...new Set(direct.filter((item) => item.timetableId
      && timetables.get(item.timetableId)?.projectId === entry.projectId)
      .map((item) => item.timetableId!))].sort()
    entry.possibleTargetTimetableIds = owners.length ? owners : data.timetables
      .filter((item) => item.projectId === entry.projectId).map((item) => item.id).sort()
    const unitCount = new Set(entry.references.map((item) => item.teachingUnitId).filter(Boolean)).size
    entry.requiresSubjectCopy = owners.length > 1
    if (entry.issues.length) entry.classification = 'invalid-or-ambiguous'
    else if (owners.length > 1) {
      entry.classification = 'multiple-timetables'
      issue(entry, 'multiple-owners')
    } else if (direct.length === 0) {
      entry.classification = entry.references.length ? 'configuration-only' : 'unreferenced'
      issue(entry, entry.references.length ? 'configuration-only' : 'unassigned-owner')
    } else if (unitCount > 1) entry.classification = 'cross-teaching-units'
    else entry.classification = 'single-timetable'
    entry.autoAssignable = sourceCompatibleV8 && owners.length === 1 && entry.issues.length === 0
    entry.requiresUserDecision = !entry.autoAssignable
  }
  return { sourceCompatibleV8, entries, issues: allIssues,
    canAutoAssignAll: sourceCompatibleV8 && allIssues.length === 0
      && entries.every((entry) => entry.autoAssignable) }
}

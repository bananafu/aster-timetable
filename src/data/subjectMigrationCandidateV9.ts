import type { AppDataV8 } from '../types'
import type { AppDataV9, SubjectV9 } from '../types/v9'
import { isCompatibleAppDataV8 } from './validators/v8'
import { isCompatibleAppDataV9 } from './validators/v9'

export interface SubjectOwnerDecisionV9 {
  timetableId: string
  subjectId: string
}

export interface RelationOwnerDecisionV9 {
  sourceRelationId: string
  timetableId: string
  relationId: string
}

/** Every source Subject and configuration must receive an explicit disposition. */
export interface SubjectMigrationDecisionV9 {
  sourceSubjectId: string
  owners: SubjectOwnerDecisionV9[]
  relations: RelationOwnerDecisionV9[]
}

export type CandidateIssueCodeV9 = 'invalid-source' | 'missing-decision' | 'duplicate-decision'
  | 'invalid-owner' | 'missing-original-id' | 'duplicate-owner' | 'missing-reference-owner'
  | 'missing-relation-assignment' | 'invalid-relation-assignment' | 'duplicate-relation-assignment'
  | 'invalid-candidate'
export interface CandidateIssueV9 {
  code: CandidateIssueCodeV9
  sourceSubjectId: string | null
  referenceId?: string
}
export type SubjectMigrationCandidateResultV9 =
  | { ok: true; candidate: AppDataV9; issues: [] }
  | { ok: false; candidate: null; issues: CandidateIssueV9[] }

/**
 * Pure conversion of explicitly reviewed ownership decisions. No storage, ID
 * allocation, backup, activation, or automatic migration is performed here.
 */
export function buildSubjectMigrationCandidateV9(
  source: AppDataV8,
  decisions: readonly SubjectMigrationDecisionV9[],
): SubjectMigrationCandidateResultV9 {
  const issues: CandidateIssueV9[] = []
  const add = (code: CandidateIssueCodeV9, sourceSubjectId: string | null, referenceId?: string) => {
    issues.push({ code, sourceSubjectId, ...(referenceId && { referenceId }) })
  }
  if (!isCompatibleAppDataV8(source)) {
    add('invalid-source', null)
    return { ok: false, candidate: null, issues }
  }
  const timetableById = new Map(source.timetables.map((item) => [item.id, item]))
  const subjectById = new Map(source.subjects.map((item) => [item.id, item]))
  const decisionById = new Map<string, SubjectMigrationDecisionV9>()
  for (const decision of decisions) {
    if (!subjectById.has(decision.sourceSubjectId)) {
      add('invalid-owner', decision.sourceSubjectId)
    } else if (decisionById.has(decision.sourceSubjectId)) {
      add('duplicate-decision', decision.sourceSubjectId)
    } else decisionById.set(decision.sourceSubjectId, decision)
  }
  const migratedSubjects: SubjectV9[] = []
  const migratedRelations: AppDataV9['teachingUnitSubjects'] = []
  const mappedSubjects = new Map<string, Map<string, string>>()
  for (const subject of source.subjects) {
    const decision = decisionById.get(subject.id)
    if (!decision || decision.owners.length === 0) { add('missing-decision', subject.id); continue }
    const owners = new Map<string, string>()
    let originalIdCount = 0
    for (const owner of decision.owners) {
      if (timetableById.get(owner.timetableId)?.projectId !== subject.projectId
        || !owner.subjectId.trim()) { add('invalid-owner', subject.id); continue }
      if (owners.has(owner.timetableId)) { add('duplicate-owner', subject.id); continue }
      owners.set(owner.timetableId, owner.subjectId)
      if (owner.subjectId === subject.id) originalIdCount += 1
      migratedSubjects.push({ ...subject, id: owner.subjectId, timetableId: owner.timetableId })
    }
    if (originalIdCount !== 1) add('missing-original-id', subject.id)
    mappedSubjects.set(subject.id, owners)
    const originalRelations = source.teachingUnitSubjects.filter((item) => item.subjectId === subject.id)
    for (const relation of originalRelations) {
      const assignments = decision.relations.filter((item) => item.sourceRelationId === relation.id)
      if (assignments.length === 0) { add('missing-relation-assignment', subject.id, relation.id); continue }
      const assigned = new Set<string>()
      for (const assignment of assignments) {
        if (!owners.has(assignment.timetableId) || !assignment.relationId.trim()) {
          add('invalid-relation-assignment', subject.id, relation.id)
        } else if (assigned.has(assignment.timetableId)) {
          add('duplicate-relation-assignment', subject.id, relation.id)
        } else {
          assigned.add(assignment.timetableId)
          migratedRelations.push({ ...relation, id: assignment.relationId,
            subjectId: owners.get(assignment.timetableId)! })
        }
      }
    }
    for (const assignment of decision.relations) {
      if (!originalRelations.some((item) => item.id === assignment.sourceRelationId)) {
        add('invalid-relation-assignment', subject.id, assignment.sourceRelationId)
      }
    }
  }
  const subjectFor = (subjectId: string, timetableId: string | null | undefined, referenceId: string) => {
    const mapped = timetableId ? mappedSubjects.get(subjectId)?.get(timetableId) : undefined
    if (!mapped) add('missing-reference-owner', subjectId, referenceId)
    return mapped ?? subjectId
  }
  const candidate: AppDataV9 = {
    ...source,
    schemaVersion: 9,
    subjects: migratedSubjects,
    teachingUnitSubjects: migratedRelations,
    recurringLessons: source.recurringLessons.map((item) => ({ ...item,
      subjectId: subjectFor(item.subjectId, item.timetableId, item.id) })),
    oneOffLessons: source.oneOffLessons.map((item) => ({ ...item,
      subjectId: subjectFor(item.subjectId, item.timetableId, item.id) })),
    overrides: source.overrides.map((item) => item.replacement ? { ...item, replacement: {
      ...item.replacement,
      subjectId: subjectFor(item.replacement.subjectId, item.timetableId, item.id),
    } } : { ...item }),
    teachingProgress: source.teachingProgress.map((item) => ({ ...item,
      subjectId: subjectFor(item.subjectId, item.timetableId, item.id) })),
  }
  if (issues.length) return { ok: false, candidate: null, issues }
  if (!isCompatibleAppDataV9(candidate)) {
    add('invalid-candidate', null)
    return { ok: false, candidate: null, issues }
  }
  return { ok: true, candidate, issues: [] }
}

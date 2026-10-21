import { SCHOOL_LEVELS, type AppDataV4, type AppDataV8, type SchoolLevel } from '../types'
import {
  createSubject as createSubjectV5,
  deleteSubject as deleteSubjectV5,
  getSubjectImpact as getSubjectImpactV5,
  removeSubjectSchoolLevel as removeSubjectSchoolLevelV5,
  updateSubject as updateSubjectV5,
  type SubjectDraft,
  type SubjectImpact,
} from './subjectsV5'
import {
  createSubject as createSubjectV8,
  deleteSubject as deleteSubjectV8,
  getSubjectImpact as getSubjectImpactV8,
  updateSubject as updateSubjectV8,
  type SubjectV8Impact,
} from './subjectsV8'

export type ProjectSubjectImpact = SubjectImpact | SubjectV8Impact

function asV8(data: AppDataV4): AppDataV8 {
  return data as AppDataV8
}

/**
 * Compatibility boundary for Subject mutations. V7 keeps its global contract;
 * V8 requires the owning Project for every read and write.
 */
export function createProjectSubject(
  data: AppDataV4,
  projectId: string,
  draft: SubjectDraft,
  id: string,
): AppDataV4 {
  return data.schemaVersion === 8
    ? createSubjectV8(asV8(data), projectId, draft, id)
    : createSubjectV5(data, draft, id)
}

export function updateProjectSubject(
  data: AppDataV4,
  projectId: string,
  subjectId: string,
  draft: SubjectDraft,
  confirmed = false,
): AppDataV4 {
  return data.schemaVersion === 8
    ? updateSubjectV8(asV8(data), projectId, subjectId, draft)
    : updateSubjectV5(data, subjectId, draft, confirmed)
}

export function deleteProjectSubject(
  data: AppDataV4,
  projectId: string,
  subjectId: string,
  confirmed = false,
): AppDataV4 {
  return data.schemaVersion === 8
    ? deleteSubjectV8(asV8(data), projectId, subjectId, confirmed)
    : deleteSubjectV5(data, subjectId, confirmed)
}

export function getProjectSubjectImpact(
  data: AppDataV4,
  projectId: string,
  subjectId: string,
): ProjectSubjectImpact {
  return data.schemaVersion === 8
    ? getSubjectImpactV8(asV8(data), projectId, subjectId)
    : getSubjectImpactV5(data, subjectId)
}

export function removeProjectSubjectSchoolLevel(
  data: AppDataV4,
  projectId: string,
  subjectId: string,
  schoolLevel: SchoolLevel,
  confirmed = false,
): AppDataV4 {
  if (data.schemaVersion !== 8) return removeSubjectSchoolLevelV5(data, subjectId, schoolLevel, confirmed)
  const impact = getSubjectImpactV8(asV8(data), projectId, subjectId)
  const levels = impact.subject.applicableSchoolLevels ?? [...SCHOOL_LEVELS]
  if (!levels.includes(schoolLevel)) throw new Error('此科目未適用指定學制，請重新確認。')
  if (levels.length === 1) throw new Error('這是科目最後一個適用學制，無法解除；科目至少須保留一個適用學制。')
  if (!confirmed) throw new Error('解除適用關係前請先確認。')
  return updateSubjectV8(asV8(data), projectId, subjectId, {
    name: impact.subject.name,
    shortName: impact.subject.shortName,
    color: impact.subject.color,
    applicableSchoolLevels: levels.filter((level) => level !== schoolLevel),
  })
}

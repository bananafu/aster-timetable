import type { AppDataV4, AppDataV8, SchoolLevel, Subject, SubjectV8, TimetableProject } from '../types'
import type { SubjectCatalogEntry } from './defaultSubjects'
import { searchExistingSubjects } from '../lib/subjectSearch'
import { subjectsForLevel } from '../lib/subjects'

function projectExists(data: AppDataV4, projectId: string | null | undefined): projectId is string {
  return Boolean(projectId && data.projects.some((project) => project.id === projectId))
}

/**
 * V7 Subjects are intentionally global. V8 Subjects are always isolated by the
 * explicitly requested Project; callers must not substitute activeProjectId.
 */
export function selectProjectSubjects(data: AppDataV8, projectId: string | null | undefined): SubjectV8[]
export function selectProjectSubjects(data: AppDataV4, projectId: string | null | undefined): Subject[]
export function selectProjectSubjects(data: AppDataV4, projectId: string | null | undefined): Subject[] {
  if (!projectExists(data, projectId)) return []
  if (data.schemaVersion !== 8) return data.subjects
  return (data as AppDataV8).subjects.filter((subject) => subject.projectId === projectId)
}

export function selectProjectSubjectsForLevel(
  data: AppDataV4,
  projectId: string | null | undefined,
  schoolLevel?: SchoolLevel,
): Subject[] {
  return subjectsForLevel(selectProjectSubjects(data, projectId), schoolLevel)
}

export function findProjectSubject(
  data: AppDataV4,
  projectId: string | null | undefined,
  subjectId: string | null | undefined,
): Subject | undefined {
  if (!subjectId) return undefined
  return selectProjectSubjects(data, projectId).find((subject) => subject.id === subjectId)
}

/** Preserves the existing stable ranking and catalog-alias search behavior. */
export function searchProjectSubjects(
  data: AppDataV4,
  projectId: string | null | undefined,
  schoolLevel: SchoolLevel,
  query: string,
  catalog: readonly SubjectCatalogEntry[] = [],
): Subject[] {
  return searchExistingSubjects(selectProjectSubjects(data, projectId), schoolLevel, query, catalog)
}

/** Archived history wins only when it is an actual archived Project. */
export function selectDisplayProject(
  data: AppDataV4,
  historicalProjectId: string | null | undefined,
): TimetableProject | undefined {
  return data.projects.find((project) => project.id === historicalProjectId && project.archivedAt)
    ?? data.projects.find((project) => project.id === data.activeProjectId)
}

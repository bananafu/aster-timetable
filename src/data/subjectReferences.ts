import type { AppDataV4, SchoolLevel } from '../types'

export interface SubjectReference {
  kind: 'lesson' | 'override' | 'one-off'
  id: string
  projectId: string | null
  teachingUnitId: string | null
  schoolLevel: SchoolLevel | null
  archived: boolean
  historical: boolean
}

/** Shared by subject operations and write validation; does not depend on either. */
export function analyzeSubjectReferences(data: AppDataV4, subjectId: string): SubjectReference[] {
  const projects = new Map(data.projects.map((item) => [item.id, item]))
  const units = new Map(data.teachingUnits.map((item) => [item.id, item]))
  const latestVersion = new Map<string, string>()
  data.recurringLessons.forEach((item) => {
    if (item.effectiveStart > (latestVersion.get(item.seriesId) ?? '')) latestVersion.set(item.seriesId, item.effectiveStart)
  })
  const references: SubjectReference[] = []
  for (const lesson of data.recurringLessons) {
    if (lesson.subjectId !== subjectId) continue
    const unit = units.get(lesson.teachingUnitId)
    references.push({
      kind: 'lesson', id: lesson.id, projectId: lesson.projectId, teachingUnitId: lesson.teachingUnitId,
      schoolLevel: unit?.projectId === lesson.projectId ? unit.schoolLevel : null,
      archived: Boolean(projects.get(lesson.projectId)?.archivedAt), historical: lesson.effectiveStart < (latestVersion.get(lesson.seriesId) ?? lesson.effectiveStart),
    })
  }
  for (const override of data.overrides) {
    if (override.replacement?.subjectId !== subjectId) continue
    const unit = override.teachingUnitId ? units.get(override.teachingUnitId) : undefined
    references.push({
      kind: 'override', id: override.id, projectId: override.projectId, teachingUnitId: override.teachingUnitId,
      schoolLevel: override.projectId && unit?.projectId === override.projectId ? unit.schoolLevel : null,
      archived: Boolean(override.projectId && projects.get(override.projectId)?.archivedAt), historical: false,
    })
  }
  for (const lesson of data.oneOffLessons ?? []) {
    if (lesson.subjectId !== subjectId) continue
    const unit = units.get(lesson.teachingUnitId)
    references.push({
      kind: 'one-off', id: lesson.id, projectId: lesson.projectId, teachingUnitId: lesson.teachingUnitId,
      schoolLevel: unit?.projectId === lesson.projectId ? unit.schoolLevel : null,
      archived: Boolean(projects.get(lesson.projectId)?.archivedAt), historical: false,
    })
  }
  return references
}

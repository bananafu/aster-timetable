import type { AppDataV8 } from '../types'
import type { AppDataV9 } from '../types/v9'

/** V8 operations only see configured Projects. Restore excluded metadata without reordering it. */
export function retainUnsetProjectResourcesV9(data: AppDataV9, result: AppDataV8) {
  const unset = new Set(data.projects.filter((item) => item.term === null).map((item) => item.id))
  const merge = <T extends { id: string }>(original: T[], changed: T[], excluded: (item: T) => boolean): T[] => {
    const remaining = new Map(changed.map((item) => [item.id, item]))
    const rows = original.flatMap((item) => {
      if (excluded(item)) return [item]
      const next = remaining.get(item.id)
      remaining.delete(item.id)
      return next ? [next] : []
    })
    return [...rows, ...remaining.values()]
  }
  return {
    projects: merge(data.projects, result.projects, (item) => unset.has(item.id)),
    schools: merge(data.schools, result.schools, (item) => unset.has(item.projectId)),
    teachingUnits: merge(data.teachingUnits, result.teachingUnits, (item) => unset.has(item.projectId)),
    timetables: merge(data.timetables, result.timetables, (item) => unset.has(item.projectId)),
    subjects: data.subjects,
    classes: merge(data.classes, result.classes, (item) => unset.has(item.projectId)),
    teachingUnitSubjects: merge(data.teachingUnitSubjects, result.teachingUnitSubjects,
      (item) => unset.has(item.projectId)),
  }
}

export function requireProjectTermV9(data: AppDataV9, projectId: string): void {
  const project = data.projects.find((item) => item.id === projectId)
  if (!project || project.term === null) throw new Error('Project term is not configured; dated operations are unavailable.')
}

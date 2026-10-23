import type { AppDataV8 } from '../types'

/** UI-only selection; never modifies the document or infers ownership from names. */
export function reconcileTimetableSelectionV8(data: AppDataV8, projectId: string | null,
  requestedId: string | null): string | null {
  if (!projectId || !data.projects.some((item) => item.id === projectId)) return null
  const available = data.timetables.filter((item) => item.projectId === projectId)
  return available.some((item) => item.id === requestedId) ? requestedId : available[0]?.id ?? null
}

export function visibleTimetableContentV8(data: AppDataV8, projectId: string, timetableId: string) {
  if (!data.timetables.some((item) => item.id === timetableId && item.projectId === projectId)) {
    throw new Error('Timetable does not belong to Project.')
  }
  const belongs = (item: { projectId: string; timetableId: string }) => item.projectId === projectId
    && item.timetableId === timetableId
  return {
    recurringLessons: data.recurringLessons.filter(belongs),
    oneOffLessons: data.oneOffLessons.filter(belongs),
    changes: data.overrides.filter((item) => item.projectId === projectId && item.timetableId === timetableId),
    events: data.events.filter((item) => item.ownershipStatus === 'resolved' && belongs(item)),
    progress: data.teachingProgress.filter(belongs),
  }
}

import type { AppDataV8, ResolvedCalendarEventV8, UnresolvedCalendarEventV8 } from '../types'

export function isResolvedEventV8(event: AppDataV8['events'][number]): event is ResolvedCalendarEventV8 {
  return event.ownershipStatus === 'resolved'
}

export function isUnresolvedEventV8(event: AppDataV8['events'][number]): event is UnresolvedCalendarEventV8 {
  return event.ownershipStatus === 'unresolved'
}

export function selectResolvedEventsForTimetable(
  data: AppDataV8,
  projectId: string,
  timetableId: string,
): ResolvedCalendarEventV8[] {
  if (!data.timetables.some((timetable) => timetable.id === timetableId && timetable.projectId === projectId)) return []
  return data.events.filter((event): event is ResolvedCalendarEventV8 => isResolvedEventV8(event)
    && event.projectId === projectId && event.timetableId === timetableId)
}

/** Undefined returns every unresolved Event; null selects legacy Events without a Project. */
export function selectUnresolvedEvents(
  data: AppDataV8,
  projectId?: string | null,
): UnresolvedCalendarEventV8[] {
  return data.events.filter((event): event is UnresolvedCalendarEventV8 => isUnresolvedEventV8(event)
    && (projectId === undefined || event.projectId === projectId))
}

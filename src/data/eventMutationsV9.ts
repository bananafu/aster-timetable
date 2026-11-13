import type { ResolvedCalendarEventV8 } from '../types'
import type { AppDataV9 } from '../types/v9'
import { isCompatibleAppDataV9, isSafeAppDataV9Update } from './validators/v9'

export type EventV9Scope = { projectId: string | null; timetableId: string | null }
export type EventV9Draft = Pick<ResolvedCalendarEventV8,
  'teachingUnitId' | 'title' | 'type' | 'date' | 'startTime' | 'endTime' | 'color'>
  & Pick<ResolvedCalendarEventV8, 'location' | 'notes'>

export type EventV9ErrorCode = 'invalid-document' | 'invalid-scope' | 'not-found'
  | 'invalid-date' | 'invalid-draft' | 'id-collision' | 'already-changed' | 'unsafe-update'
export class EventV9Error extends Error {
  constructor(readonly code: EventV9ErrorCode, message: string) {
    super(message); this.name = 'EventV9Error'
  }
}
const fail = (code: EventV9ErrorCode, message: string): never => { throw new EventV9Error(code, message) }
const dateValid = (value: string) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
const timeValid = (value: string) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const draftKeys = new Set(['teachingUnitId', 'title', 'type', 'date', 'startTime', 'endTime',
  'location', 'notes', 'color'])

function scope(data: AppDataV9, selected: EventV9Scope) {
  if (!isCompatibleAppDataV9(data)) fail('invalid-document', 'Invalid V9 document.')
  const project = data.projects.find((item) => item.id === selected.projectId)
  const timetable = data.timetables.find((item) => item.id === selected.timetableId
    && item.projectId === selected.projectId)
  if (!project || project.archivedAt || project.term === null || !timetable) {
    fail('invalid-scope', 'Configured editable Project and Timetable are required.')
  }
  return project
}

function content(data: AppDataV9, selected: EventV9Scope, draft: EventV9Draft) {
  scope(data, selected)
  if (!draft || typeof draft !== 'object' || Object.keys(draft).some((key) => !draftKeys.has(key))) {
    fail('invalid-draft', 'Event draft contains unsupported fields.')
  }
  const unit = data.teachingUnits.find((item) => item.id === draft.teachingUnitId
    && item.projectId === selected.projectId
    && data.schools.some((school) => school.id === item.schoolId && school.projectId === selected.projectId))
  if (!unit) return fail('invalid-scope', 'Event TeachingUnit does not belong to the selected Project.')
  if (!dateValid(draft.date) || draft.date < unit.startDate || draft.date > unit.endDate) {
    fail('invalid-date', 'Event date is outside the selected TeachingUnit term.')
  }
  if (!['meeting', 'activity'].includes(draft.type) || !timeValid(draft.startTime)
    || !timeValid(draft.endTime) || draft.startTime >= draft.endTime
    || typeof draft.title !== 'string' || !draft.title.trim()
    || typeof draft.color !== 'string' || !draft.color.trim()
    || (draft.location !== undefined && typeof draft.location !== 'string')
    || (draft.notes !== undefined && typeof draft.notes !== 'string')) {
    fail('invalid-draft', 'Event content or time is invalid.')
  }
}

function safe(current: AppDataV9, next: AppDataV9): AppDataV9 {
  if (!isSafeAppDataV9Update(current, next)) fail('unsafe-update', 'Event mutation failed V9 safety validation.')
  return next
}

function idAvailable(data: AppDataV9, id: string) {
  if (typeof id !== 'string' || !id.trim() || id !== id.trim()) return false
  const entities = [...data.projects, ...data.timetables, ...data.schools, ...data.teachingUnits,
    ...data.subjects, ...data.teachingUnitSubjects, ...data.classes, ...data.recurringLessons,
    ...data.oneOffLessons, ...data.overrides, ...data.events, ...data.teachingProgress,
    ...data.migrationWarnings]
  return !entities.some((item) => item.id === id)
    && !data.recurringLessons.some((item) => item.seriesId === id)
}

export function createEventV9(data: AppDataV9, selected: EventV9Scope,
  draft: EventV9Draft, id: string): AppDataV9 {
  content(data, selected, draft)
  if (!idAvailable(data, id)) fail('id-collision', 'Event ID is unavailable.')
  const event: ResolvedCalendarEventV8 = { id, projectId: selected.projectId!,
    timetableId: selected.timetableId!, teachingUnitId: draft.teachingUnitId,
    ownershipStatus: 'resolved', title: draft.title, type: draft.type, date: draft.date,
    startTime: draft.startTime, endTime: draft.endTime, color: draft.color,
    ...(draft.location !== undefined && { location: draft.location }),
    ...(draft.notes !== undefined && { notes: draft.notes }), origin: 'user' }
  return safe(data, { ...data, events: [...data.events, event] })
}

export function updateEventV9(data: AppDataV9, selected: EventV9Scope,
  eventId: string, draft: EventV9Draft): AppDataV9 {
  scope(data, selected)
  const original = data.events.find((item) => item.id === eventId)
  if (!original) return fail('not-found', 'Event does not exist.')
  if (original.ownershipStatus !== 'resolved' || original.projectId !== selected.projectId
    || original.timetableId !== selected.timetableId) {
    return fail('invalid-scope', 'Event is not resolved in the selected Project and Timetable.')
  }
  if (original.type !== draft.type) fail('invalid-scope', 'Event type cannot change during editing.')
  if (original.teachingUnitId !== draft.teachingUnitId) {
    fail('invalid-scope', 'Event TeachingUnit ownership cannot change during editing.')
  }
  content(data, selected, draft)
  const updated: ResolvedCalendarEventV8 = { ...original, title: draft.title, type: draft.type,
    date: draft.date, startTime: draft.startTime, endTime: draft.endTime, color: draft.color,
    location: draft.location, notes: draft.notes }
  if (JSON.stringify(updated) === JSON.stringify(original)) fail('already-changed', 'Event has no changes.')
  return safe(data, { ...data, events: data.events.map((item) => item.id === eventId ? updated : item) })
}

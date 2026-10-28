import type { ResolvedCalendarEventV8 } from '../types'
import type { V9ReadDay, V9ReadOccurrence, V9ReadStatus } from './scheduleV9'

export type ScheduleDisplayOccurrence = Readonly<{
  key: string
  id: string
  kind: 'recurring' | 'one-off'
  date: string
  startTime: string
  endTime: string
  teachingUnitId: string
  schoolId: string
  schoolName: string
  schoolColor: string
  teachingUnitName: string
  subjectName: string
  subjectColor: string
  className: string
  room?: string
  hasConflict: boolean
  status?: 'regular' | 'cancelled' | 'replaced' | 'moved'
  movementRole?: 'source' | 'target'
  overrideId?: string
  periodLabel?: string
  purpose?: 'extra' | 'make-up' | 'substitute'
  timeMode?: 'period' | 'custom'
}>

export type ScheduleDisplayDay = Readonly<{
  date: Date
  lessons: readonly ScheduleDisplayOccurrence[]
}>

export type ScheduleDisplayEvent = Readonly<{
  id: string
  type: 'meeting' | 'activity' | 'task'
  date: string
  startTime: string
  endTime: string
  title: string
}>

export type ScheduleDisplaySchool = Readonly<{ id: string; name: string }>
export type ScheduleDisplayTeachingUnit = Readonly<{
  id: string
  schoolId: string
  name: string
  schoolLevel: 'junior-high' | 'senior-high' | 'other'
}>

function occurrence(lesson: V9ReadOccurrence): ScheduleDisplayOccurrence {
  return {
    key: lesson.occurrenceId,
    id: lesson.id,
    kind: lesson.kind,
    date: lesson.date,
    startTime: lesson.startTime,
    endTime: lesson.endTime,
    teachingUnitId: lesson.teachingUnitId,
    schoolId: lesson.schoolId,
    schoolName: lesson.schoolName,
    schoolColor: lesson.schoolColor,
    teachingUnitName: lesson.teachingUnitName,
    subjectName: lesson.subjectName,
    subjectColor: lesson.subjectColor,
    className: lesson.className,
    room: lesson.room,
    hasConflict: lesson.hasConflict,
    status: lesson.kind === 'recurring' ? lesson.status : undefined,
    movementRole: lesson.kind === 'recurring' ? lesson.movementRole : undefined,
    overrideId: lesson.kind === 'recurring' ? lesson.overrideId : undefined,
    periodLabel: 'periodLabel' in lesson ? lesson.periodLabel : undefined,
    purpose: lesson.kind === 'one-off' ? lesson.purpose : undefined,
    timeMode: lesson.kind === 'one-off' ? lesson.timeMode : undefined,
  }
}

export function toScheduleDisplayDays(days: readonly V9ReadDay[]): readonly ScheduleDisplayDay[] {
  return days.map((day) => ({ date: new Date(day.date), lessons: day.lessons.map(occurrence) }))
}

export function toScheduleDisplayEvents(
  events: readonly Readonly<ResolvedCalendarEventV8>[],
): readonly ScheduleDisplayEvent[] {
  return events.filter((event) => event.type === 'meeting' || event.type === 'activity')
    .map((event) => ({ id: event.id, type: event.type as 'meeting' | 'activity', date: event.date,
      startTime: event.startTime, endTime: event.endTime, title: event.title }))
}

export function isActualTeachingOccurrence(lesson: ScheduleDisplayOccurrence): boolean {
  return lesson.kind === 'one-off' || (lesson.status !== 'cancelled' && lesson.movementRole !== 'source')
}

export function scheduleReadStatusMessage(status: V9ReadStatus): string | null {
  if (status === 'unset-term') return '尚未設定學期'
  if (status === 'invalid-scope') return '目前選取的課表或授課單位無法使用'
  if (status === 'invalid-document') return '課表資料無法通過驗證'
  return null
}

import type { AppData, CalendarEvent, Course, DayOfWeek, Period, ScheduleOverride, WeekPattern } from '../types'
import { fromDateKey, getWeekInfo, toDateKey } from './date'

export interface ResolvedSlot {
  course?: Course
  override?: ScheduleOverride
  status: 'regular' | 'replaced' | 'cancelled' | 'empty'
  subjectId?: string
  classId?: string
  room?: string
}

export interface TeachingSlot extends ResolvedSlot {
  period: Period
  subjectName: string
  className: string
  displayRoom: string
}

export interface TodayTeachingSummary {
  count: number
  state: 'current' | 'next' | 'finished' | 'empty' | 'outside-semester'
  slot?: TeachingSlot
}

export function isCourseActive(course: Course, pattern: WeekPattern): boolean {
  return course.weekPattern === 'every' || course.weekPattern === pattern
}

export function weekPatternsOverlap(first: WeekPattern, second: WeekPattern): boolean {
  return first === 'every' || second === 'every' || first === second
}

export function findCourseConflict(courses: Course[], candidate: Pick<Course, 'day' | 'periodId' | 'weekPattern'>, excludeId?: string): Course | undefined {
  return courses.find((course) => course.id !== excludeId
    && course.day === candidate.day
    && course.periodId === candidate.periodId
    && weekPatternsOverlap(course.weekPattern, candidate.weekPattern))
}

export function resolveSlot(data: AppData, date: Date, periodId: number): ResolvedSlot {
  if (!isDateInSemester(date, data)) return { status: 'empty' }
  const day = date.getDay() as DayOfWeek
  const pattern = getWeekInfo(date, data.semester).pattern
  const course = data.courses.find((item) => item.day === day && item.periodId === periodId && isCourseActive(item, pattern))
  const override = data.overrides.find((item) => item.date === toDateKey(date) && item.periodId === periodId)

  if (override?.action === 'cancel') return { course, override, status: 'cancelled' }
  if (override?.action === 'replace' && override.replacement) {
    return { course, override, status: 'replaced', ...override.replacement }
  }
  if (course) return { course, status: 'regular', subjectId: course.subjectId, classId: course.classId, room: course.room }
  return { status: 'empty' }
}

export function isDateInSemester(date: Date, data: AppData): boolean {
  const key = toDateKey(date)
  return key >= data.semester.startDate && key <= data.semester.endDate
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export function getTodayTeachingSummary(data: AppData, now: Date): TodayTeachingSummary {
  if (!isDateInSemester(now, data)) return { count: 0, state: 'outside-semester' }
  const weekday = now.getDay()
  if (weekday < 1 || weekday > 5) return { count: 0, state: 'empty' }

  const slots = data.periods.flatMap((period): TeachingSlot[] => {
    const resolved = resolveSlot(data, now, period.id)
    if (!resolved.subjectId || !resolved.classId || resolved.status === 'cancelled') return []
    const subject = data.subjects.find((item) => item.id === resolved.subjectId)
    const schoolClass = data.classes.find((item) => item.id === resolved.classId)
    if (!subject || !schoolClass) return []
    return [{ ...resolved, period, subjectName: subject.name, className: schoolClass.name, displayRoom: resolved.room || schoolClass.room || '未設定教室' }]
  })

  if (slots.length === 0) return { count: 0, state: 'empty' }
  const minutes = now.getHours() * 60 + now.getMinutes()
  const current = slots.find((slot) => minutes >= timeToMinutes(slot.period.startTime) && minutes < timeToMinutes(slot.period.endTime))
  if (current) return { count: slots.length, state: 'current', slot: current }
  const next = slots.find((slot) => timeToMinutes(slot.period.startTime) > minutes)
  if (next) return { count: slots.length, state: 'next', slot: next }
  return { count: slots.length, state: 'finished' }
}

function eventDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const result = fromDateKey(date)
  const [hours, minutes] = time.split(':').map(Number)
  result.setHours(hours, minutes, 0, 0)
  return Number.isNaN(result.getTime()) ? null : result
}

export function getNextUpcomingEvent(events: CalendarEvent[], now: Date): CalendarEvent | undefined {
  return events
    .filter((event) => event.type === 'meeting' || event.type === 'activity')
    .map((event) => ({ event, start: eventDateTime(event.date, event.startTime), end: eventDateTime(event.date, event.endTime) }))
    .filter((item): item is { event: CalendarEvent; start: Date; end: Date } => Boolean(item.start && item.end && item.end > now))
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0]?.event
}

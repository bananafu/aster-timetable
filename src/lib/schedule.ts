import type { AppData, CalendarEvent, Course, DayOfWeek, SchoolPeriod, ScheduleOverride, WeekPattern } from '../types'
import { getTermForDate } from './academic'
import { fromDateKey, getWeekInfo, toDateKey } from './date'

export interface ResolvedSlot { course?: Course; override?: ScheduleOverride; status: 'regular'|'replaced'|'cancelled'|'empty'; subjectId?: string; classId?: string; room?: string }
export interface TeachingSlot extends ResolvedSlot { period: SchoolPeriod; subjectName: string; className: string; displayRoom: string }
export interface TodayTeachingSummary { count: number; state: 'current'|'next'|'finished'|'empty'|'outside-semester'; slot?: TeachingSlot }

export function isCourseActive(course: Course, pattern: 'A'|'B'|null): boolean { return course.weekPattern === 'every' || course.weekPattern === pattern }
export function weekPatternsOverlap(first: WeekPattern, second: WeekPattern): boolean { return first === 'every' || second === 'every' || first === second }
export function findCourseConflict(courses: Course[], candidate: Pick<Course,'termId'|'day'|'periodId'|'weekPattern'>, excludeId?: string): Course|undefined {
  return courses.find((course) => course.id !== excludeId && course.termId === candidate.termId && course.day === candidate.day && course.periodId === candidate.periodId && weekPatternsOverlap(course.weekPattern, candidate.weekPattern))
}

export function resolveSlot(data: AppData, date: Date, periodId: number): ResolvedSlot {
  const term = getTermForDate(data, date)
  if (!term || !term.periods.some((period) => period.id === periodId)) return { status: 'empty' }
  const day = date.getDay() as DayOfWeek
  const pattern = getWeekInfo(date, term).pattern
  const course = data.courses.find((item) => item.termId === term.id && item.day === day && item.periodId === periodId && isCourseActive(item, pattern))
  const override = data.overrides.find((item) => item.termId === term.id && item.date === toDateKey(date) && item.periodId === periodId && (!item.originalCourseId || item.originalCourseId === course?.id))
  if (override?.action === 'cancel') return { course, override, status: 'cancelled' }
  if (override?.action === 'replace' && override.replacement) return { course, override, status: 'replaced', ...override.replacement }
  if (course) return { course, status: 'regular', subjectId: course.subjectId, classId: course.classId, room: course.room }
  return { status: 'empty' }
}

export function isDateInSemester(date: Date, data: AppData): boolean { return Boolean(getTermForDate(data, date)) }
const minutes = (value: string) => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute }
export function getTodayTeachingSummary(data: AppData, now: Date): TodayTeachingSummary {
  const term = getTermForDate(data, now)
  if (!term) return { count: 0, state: 'outside-semester' }
  if (now.getDay() < 1 || now.getDay() > 5) return { count: 0, state: 'empty' }
  const slots = [...term.periods].sort((a,b) => a.order-b.order).flatMap((period): TeachingSlot[] => {
    const resolved = resolveSlot(data, now, period.id)
    if (!resolved.subjectId || !resolved.classId || resolved.status === 'cancelled') return []
    const subject = data.subjects.find((item) => item.id === resolved.subjectId); const schoolClass = data.classes.find((item) => item.id === resolved.classId)
    return subject && schoolClass ? [{ ...resolved, period, subjectName: subject.name, className: schoolClass.name, displayRoom: resolved.room || schoolClass.room || '未設定教室' }] : []
  })
  if (!slots.length) return { count: 0, state: 'empty' }
  const currentMinute = now.getHours()*60+now.getMinutes()
  const current = slots.find((slot) => currentMinute >= minutes(slot.period.startTime) && currentMinute < minutes(slot.period.endTime))
  if (current) return { count: slots.length, state: 'current', slot: current }
  const next = slots.find((slot) => minutes(slot.period.startTime) > currentMinute)
  return next ? { count: slots.length, state: 'next', slot: next } : { count: slots.length, state: 'finished' }
}

function eventDateTime(date: string, time: string): Date|null { if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null; const result=fromDateKey(date); const [h,m]=time.split(':').map(Number); result.setHours(h,m,0,0); return Number.isNaN(result.getTime())?null:result }
export function getNextUpcomingEvent(events: CalendarEvent[], now: Date): CalendarEvent|undefined {
  return events.filter((event) => event.type === 'meeting' || event.type === 'activity').map((event) => ({ event, start:eventDateTime(event.date,event.startTime), end:eventDateTime(event.date,event.endTime) })).filter((item): item is {event:CalendarEvent;start:Date;end:Date} => Boolean(item.start && item.end && item.end>now)).sort((a,b)=>a.start.getTime()-b.start.getTime())[0]?.event
}

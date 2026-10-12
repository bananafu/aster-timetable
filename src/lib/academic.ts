import type { AcademicTerm, AppData, CalendarEvent, Course, ScheduleOverride, SchoolPeriod } from '../types'
import { toDateKey } from './date'

export function getActiveTerm(data: AppData): AcademicTerm | undefined {
  return data.academicTerms.find((term) => term.id === data.activeTermId)
}

export function getTermForDate(data: Pick<AppData, 'academicTerms'>, date: Date | string): AcademicTerm | undefined {
  const key = typeof date === 'string' ? date : toDateKey(date)
  return data.academicTerms.find((term) => key >= term.startDate && key <= term.endDate)
}

export function getPeriodsForDate(data: AppData, date: Date): SchoolPeriod[] {
  return [...(getTermForDate(data, date)?.periods ?? [])].sort((a, b) => a.order - b.order)
}

export function termsOverlap(first: Pick<AcademicTerm, 'startDate' | 'endDate'>, second: Pick<AcademicTerm, 'startDate' | 'endDate'>): boolean {
  return first.startDate <= second.endDate && second.startDate <= first.endDate
}

export function validateTermDates(terms: AcademicTerm[], candidate: Pick<AcademicTerm, 'id' | 'startDate' | 'endDate'>): string | null {
  if (candidate.startDate > candidate.endDate) return '學期起始日不得晚於結束日。'
  if (terms.some((term) => term.id !== candidate.id && termsOverlap(term, candidate))) return '學期日期範圍不得與其他學期重疊。'
  return null
}

export function validatePeriods(periods: SchoolPeriod[], referencedIds: Set<number> = new Set()): string | null {
  if (new Set(periods.map((period) => period.id)).size !== periods.length) return '同一學期內的節次 ID 必須唯一。'
  if (new Set(periods.map((period) => period.order)).size !== periods.length) return '節次排序不得重複。'
  const sorted = [...periods].sort((a, b) => a.order - b.order)
  for (const period of sorted) {
    if (!period.label.trim() || period.startTime >= period.endTime) return `${period.label || `節次 ${period.id}`} 的時間設定不正確。`
  }
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startTime < sorted[index - 1].endTime) return `${sorted[index].label} 與前一節時間重疊。`
  }
  for (const id of referencedIds) {
    if (!periods.some((period) => period.id === id)) return `節次 ID ${id} 仍被課程引用，不能移除。`
  }
  return null
}

export function canDisableWeekCycle(termId: string, courses: Course[]): boolean {
  return !courses.some((course) => course.termId === termId && course.weekPattern !== 'every')
}

export function classifyEventTerm(event: Pick<CalendarEvent, 'date'>, terms: AcademicTerm[]): string | null {
  return getTermForDate({ academicTerms: terms }, event.date)?.id ?? null
}

export function reclassifyEvents(events: CalendarEvent[], terms: AcademicTerm[]): CalendarEvent[] {
  return events.map((event) => ({ ...event, termId: classifyEventTerm(event, terms) }))
}

export function isTermEditable(term: AcademicTerm | undefined): boolean {
  return Boolean(term && !term.archivedAt)
}

export function getSafeOverrideTerm(data: AppData, override: ScheduleOverride): AcademicTerm | undefined {
  if (!override.originalCourseId) return undefined
  const term = getTermForDate(data, override.date)
  const course = data.courses.find((item) => item.id === override.originalCourseId)
  if (!term || !course || course.termId !== term.id || !term.periods.some((period) => period.id === override.periodId)) return undefined
  return term
}

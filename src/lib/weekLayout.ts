import type { AppData, SchoolPeriod } from '../types'
import { getTermForDate } from './academic'

export function getDayPeriods(data: AppData, date: Date): SchoolPeriod[] {
  return [...(getTermForDate(data, date)?.periods ?? [])].sort((a, b) => a.order - b.order)
}

export function hasUniformWeekStructure(data: AppData, weekDays: Date[]): boolean {
  const terms = weekDays.map((date) => getTermForDate(data, date))
  if (terms.some((term) => !term) || new Set(terms.map((term) => term?.id)).size !== 1) return false
  const first = JSON.stringify(getDayPeriods(data, weekDays[0]))
  return weekDays.every((date) => JSON.stringify(getDayPeriods(data, date)) === first)
}

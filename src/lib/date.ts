import type { AcademicTerm, AlternatingWeekPattern } from '../types'

export const dayNames = ['週一', '週二', '週三', '週四', '週五']

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function fromDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date)
  const day = result.getDay()
  result.setHours(0, 0, 0, 0)
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1))
  return result
}

export function addDays(date: Date, count: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + count)
  return result
}

export function getWeekInfo(date: Date, term: AcademicTerm): { number: number; pattern: AlternatingWeekPattern | null } {
  const semesterStart = startOfWeek(fromDateKey(term.startDate))
  const target = startOfWeek(date)
  const number = Math.floor((target.getTime() - semesterStart.getTime()) / 604_800_000) + 1
  if (!term.weekCycle.enabled) return { number, pattern: null }
  const anchor = startOfWeek(fromDateKey(term.weekCycle.anchorDate))
  const offset = Math.round((target.getTime() - anchor.getTime()) / 604_800_000)
  const sameAsAnchor = Math.abs(offset) % 2 === 0
  const pattern = sameAsAnchor ? term.weekCycle.anchorPattern : term.weekCycle.anchorPattern === 'A' ? 'B' : 'A'
  return { number, pattern }
}

export function formatWeekRange(start: Date): string {
  const end = addDays(start, 4)
  const fmt = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`
  return `${start.getFullYear()}年 ${fmt(start)}－${fmt(end)}`
}

export function formatShortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

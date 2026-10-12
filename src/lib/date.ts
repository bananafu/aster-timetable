import type { SemesterSettings, WeekPattern } from '../types'

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

export function getWeekInfo(date: Date, semester: SemesterSettings): { number: number; pattern: WeekPattern } {
  const semesterStart = startOfWeek(fromDateKey(semester.startDate))
  const target = startOfWeek(date)
  const number = Math.floor((target.getTime() - semesterStart.getTime()) / 604_800_000) + 1
  const oddMatchesA = semester.firstWeekPattern === 'A'
  const isA = number % 2 === 1 ? oddMatchesA : !oddMatchesA
  return { number, pattern: isA ? 'A' : 'B' }
}

export function formatWeekRange(start: Date): string {
  const end = addDays(start, 4)
  const fmt = (date: Date) => `${date.getMonth() + 1}月${date.getDate()}日`
  return `${start.getFullYear()}年 ${fmt(start)}－${fmt(end)}`
}

export function formatShortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

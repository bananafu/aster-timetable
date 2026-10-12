import { initialData } from './seed'
import type { AppData, CalendarEvent, Course, SchoolClass, Subject } from '../types'

type DemoRecord = Subject | SchoolClass | Course | CalendarEvent

export function isAppData(value: unknown): value is AppData {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<AppData>
  const isString = (item: unknown): item is string => typeof item === 'string'
  const isRecord = (item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object')
  const validOrigin = (item: Record<string, unknown>) => item.origin === undefined || item.origin === 'demo' || item.origin === 'user'
  return Array.isArray(data.subjects)
    && data.subjects.every((item) => isRecord(item) && isString(item.id) && isString(item.name) && isString(item.shortName) && isString(item.color) && validOrigin(item))
    && Array.isArray(data.classes)
    && data.classes.every((item) => isRecord(item) && isString(item.id) && isString(item.name) && (item.room === undefined || isString(item.room)) && validOrigin(item))
    && Array.isArray(data.periods)
    && data.periods.every((item) => isRecord(item) && typeof item.id === 'number' && isString(item.label) && isString(item.startTime) && isString(item.endTime))
    && Array.isArray(data.courses)
    && data.courses.every((item) => isRecord(item) && isString(item.id) && isString(item.subjectId) && isString(item.classId) && [1, 2, 3, 4, 5].includes(item.day as number) && typeof item.periodId === 'number' && ['every', 'A', 'B'].includes(item.weekPattern as string) && validOrigin(item))
    && Array.isArray(data.events)
    && data.events.every((item) => isRecord(item) && isString(item.id) && isString(item.title) && ['meeting', 'activity', 'task'].includes(item.type as string) && isString(item.date) && isString(item.startTime) && isString(item.endTime) && isString(item.color) && validOrigin(item))
    && Array.isArray(data.overrides)
    && data.overrides.every((item) => isRecord(item) && isString(item.id) && isString(item.date) && typeof item.periodId === 'number' && ['cancel', 'replace'].includes(item.action as string) && validOrigin(item))
    && Boolean(data.semester
      && isString(data.semester.name)
      && isString(data.semester.startDate)
      && isString(data.semester.endDate)
      && ['A', 'B'].includes(data.semester.firstWeekPattern))
}

function withoutOrigin<T extends DemoRecord>(record: T): Partial<T> {
  const copy: Partial<T> = { ...record }
  delete copy.origin
  return copy
}

function matchesSeed<T extends DemoRecord>(record: T, seeds: T[]): boolean {
  const seed = seeds.find((item) => item.id === record.id)
  return Boolean(seed && JSON.stringify(withoutOrigin(record)) === JSON.stringify(withoutOrigin(seed)))
}

function tagExactMatches<T extends DemoRecord>(records: T[], seeds: T[]): T[] {
  return records.map((record) => record.origin || !matchesSeed(record, seeds) ? record : { ...record, origin: 'demo' })
}

export function migrateAppData(value: AppData): AppData {
  return {
    ...value,
    subjects: tagExactMatches(value.subjects ?? [], initialData.subjects),
    classes: tagExactMatches(value.classes ?? [], initialData.classes),
    courses: tagExactMatches(value.courses ?? [], initialData.courses),
    events: tagExactMatches(value.events ?? [], initialData.events),
    overrides: value.overrides ?? [],
    periods: value.periods ?? initialData.periods,
    semester: value.semester ?? initialData.semester,
  }
}

export function countDemoRecords(data: AppData): number {
  return [...data.subjects, ...data.classes, ...data.courses, ...data.events, ...data.overrides]
    .filter((record) => record.origin === 'demo').length
}

export function clearDemoRecords(data: AppData): AppData {
  const courses = data.courses.filter((course) => course.origin !== 'demo')
  const events = data.events.filter((event) => event.origin !== 'demo')
  const overrides = data.overrides.filter((override) => override.origin !== 'demo')
  const usedSubjectIds = new Set([
    ...courses.map((course) => course.subjectId),
    ...overrides.flatMap((override) => override.replacement ? [override.replacement.subjectId] : []),
  ])
  const usedClassIds = new Set([
    ...courses.map((course) => course.classId),
    ...overrides.flatMap((override) => override.replacement ? [override.replacement.classId] : []),
  ])

  return {
    ...data,
    courses,
    events,
    overrides,
    subjects: data.subjects.filter((subject) => subject.origin !== 'demo' || usedSubjectIds.has(subject.id)),
    classes: data.classes.filter((schoolClass) => schoolClass.origin !== 'demo' || usedClassIds.has(schoolClass.id)),
  }
}

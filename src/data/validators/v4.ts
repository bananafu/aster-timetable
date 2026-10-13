import type { AppDataV4, DataOrigin, RecurringLesson, SchoolPeriod } from '../../types'

type UnknownRecord = Record<string, unknown>
const record = (value: unknown): value is UnknownRecord => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const optionalText = (value: unknown) => value === undefined || typeof value === 'string'
const date = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
const timestamp = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const time = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const fiveMinuteStep = (value: string) => Number(value.slice(3)) % 5 === 0
const origin = (value: unknown): value is DataOrigin | undefined => value === undefined || value === 'demo' || value === 'user'
const unique = <T>(items: T[], key: (item: T) => string | number) => new Set(items.map(key)).size === items.length

function isPeriod(value: unknown): value is SchoolPeriod {
  return record(value) && Number.isInteger(value.id) && Number.isInteger(value.order) && text(value.label)
    && time(value.startTime) && time(value.endTime) && fiveMinuteStep(value.startTime) && fiveMinuteStep(value.endTime) && value.startTime < value.endTime
}

function validPeriods(periods: SchoolPeriod[]) {
  if (!unique(periods, (item) => item.id) || !unique(periods, (item) => item.order)) return false
  const chronological = [...periods].sort((a, b) => a.startTime.localeCompare(b.startTime))
  return chronological.every((item, index) => index === 0 || chronological[index - 1].endTime <= item.startTime)
}

function hasUniqueIds(value: unknown): value is UnknownRecord[] {
  return Array.isArray(value) && value.every((item) => record(item) && text(item.id)) && unique(value, (item) => item.id as string)
}

function nextDate(value: string) {
  const result = new Date(`${value}T00:00:00Z`)
  result.setUTCDate(result.getUTCDate() + 1)
  return result.toISOString().slice(0, 10)
}

function versionsDoNotOverlap(lessons: RecurringLesson[]) {
  const series = new Map<string, RecurringLesson[]>()
  lessons.forEach((lesson) => series.set(lesson.seriesId, [...(series.get(lesson.seriesId) ?? []), lesson]))
  for (const versions of series.values()) {
    const sorted = [...versions].sort((a, b) => a.effectiveStart.localeCompare(b.effectiveStart))
    if (sorted.some((item, index) => {
      const previous = sorted[index - 1]
      return previous !== undefined && (previous.projectId !== item.projectId
        || previous.teachingUnitId !== item.teachingUnitId
        || previous.effectiveEnd === undefined
        || nextDate(previous.effectiveEnd) !== item.effectiveStart)
    })) return false
  }
  return true
}

function validateAppDataV4(value: unknown): value is AppDataV4 {
  if (!record(value) || value.schemaVersion !== 4) return false
  if (!hasUniqueIds(value.projects) || !hasUniqueIds(value.schools) || !hasUniqueIds(value.teachingUnits)
    || !hasUniqueIds(value.subjects) || !hasUniqueIds(value.classes) || !hasUniqueIds(value.recurringLessons)
    || !hasUniqueIds(value.events) || !hasUniqueIds(value.overrides) || !hasUniqueIds(value.migrationWarnings)) return false

  const data = value as unknown as AppDataV4
  const projects = new Map(data.projects.map((item) => [item.id, item]))
  const schools = new Map(data.schools.map((item) => [item.id, item]))
  const units = new Map(data.teachingUnits.map((item) => [item.id, item]))
  const subjects = new Set(data.subjects.map((item) => item.id))
  const classes = new Map(data.classes.map((item) => [item.id, item]))
  const lessons = new Map(data.recurringLessons.map((item) => [item.id, item]))

  if (data.activeProjectId !== null && (!projects.has(data.activeProjectId) || projects.get(data.activeProjectId)?.archivedAt)) return false
  if (data.projects.length > 0 && data.activeProjectId === null && data.projects.some((item) => !item.archivedAt)) return false
  if (!data.projects.every((item) => text(item.name) && Number.isInteger(item.term.academicYear) && item.term.academicYear > 0
    && ['first', 'second', 'summer', 'custom'].includes(item.term.semester)
    && (item.term.semester !== 'custom' || text(item.term.customLabel))
    && (item.archivedAt === undefined || timestamp(item.archivedAt)) && timestamp(item.createdAt) && timestamp(item.updatedAt))) return false

  if (!data.subjects.every((item) => text(item.name) && text(item.shortName) && text(item.color) && origin(item.origin))) return false
  if (!data.schools.every((item) => projects.has(item.projectId) && text(item.name) && text(item.color))) return false
  if (!data.teachingUnits.every((item) => {
    const school = schools.get(item.schoolId)
    return projects.has(item.projectId) && school?.projectId === item.projectId && text(item.name)
      && ['junior-high', 'senior-high', 'other'].includes(item.schoolLevel) && item.timezone === 'Asia/Taipei'
      && date(item.startDate) && date(item.endDate) && item.startDate <= item.endDate
      && date(item.weekCycle.anchorDate) && ['A', 'B'].includes(item.weekCycle.anchorPattern)
      && typeof item.weekCycle.enabled === 'boolean' && Array.isArray(item.periods)
      && item.periods.every(isPeriod) && validPeriods(item.periods)
  })) return false

  if (!data.classes.every((item) => {
    const unit = units.get(item.teachingUnitId)
    return projects.has(item.projectId) && unit?.projectId === item.projectId && text(item.name)
      && optionalText(item.room) && origin(item.origin)
  })) return false

  if (!data.recurringLessons.every((item) => {
    const unit = units.get(item.teachingUnitId)
    const schoolClass = classes.get(item.classId)
    return text(item.seriesId) && unit?.projectId === item.projectId && schoolClass?.projectId === item.projectId
      && schoolClass.teachingUnitId === item.teachingUnitId && subjects.has(item.subjectId)
      && [1, 2, 3, 4, 5].includes(item.day) && unit.periods.some((period) => period.id === item.periodId)
      && ['every', 'A', 'B'].includes(item.weekPattern) && (unit.weekCycle.enabled || item.weekPattern === 'every')
      && date(item.effectiveStart) && item.effectiveStart >= unit.startDate && item.effectiveStart <= unit.endDate
      && (item.effectiveEnd === undefined || (date(item.effectiveEnd) && item.effectiveEnd >= item.effectiveStart && item.effectiveEnd <= unit.endDate))
      && optionalText(item.room) && origin(item.origin)
  }) || !versionsDoNotOverlap(data.recurringLessons)) return false

  if (!data.events.every((item) => {
    const unit = item.teachingUnitId ? units.get(item.teachingUnitId) : undefined
    return (item.projectId === null || projects.has(item.projectId))
      && (item.teachingUnitId === undefined || item.teachingUnitId === null || (item.projectId !== null && unit?.projectId === item.projectId))
      && text(item.title) && ['meeting', 'activity', 'task'].includes(item.type) && date(item.date)
      && time(item.startTime) && time(item.endTime) && item.startTime < item.endTime
      && optionalText(item.location) && optionalText(item.notes) && text(item.color) && origin(item.origin)
  })) return false

  if (!data.overrides.every((item) => {
    const baseValid = date(item.date) && Number.isInteger(item.periodId) && ['cancel', 'replace', 'move'].includes(item.action)
      && optionalText(item.note) && optionalText(item.groupId) && origin(item.origin)
    if (!baseValid) return false
    if (item.projectId === null || item.teachingUnitId === null) return item.projectId === null && item.teachingUnitId === null
    const unit = units.get(item.teachingUnitId)
    const original = item.originalLessonId ? lessons.get(item.originalLessonId) : undefined
    const replacementClass = item.replacement ? classes.get(item.replacement.classId) : undefined
    return unit?.projectId === item.projectId && date(item.date) && item.date >= unit.startDate && item.date <= unit.endDate
      && unit.periods.some((period) => period.id === item.periodId) && ['cancel', 'replace', 'move'].includes(item.action)
      && (!item.originalLessonId || (original?.projectId === item.projectId && original.teachingUnitId === item.teachingUnitId))
      && (item.action !== 'replace' || (item.replacement !== undefined && subjects.has(item.replacement.subjectId)
        && replacementClass?.projectId === item.projectId && replacementClass.teachingUnitId === item.teachingUnitId))
      && (item.action !== 'move' || (item.originalLessonId !== undefined && item.replacement === undefined
        && item.target !== undefined && date(item.target.date) && item.target.date >= unit.startDate && item.target.date <= unit.endDate
        && unit.periods.some((period) => period.id === item.target?.periodId)))
  })) return false

  return data.migrationWarnings.every((item) => ['class', 'event', 'override', 'lesson'].includes(item.entityType)
    && text(item.entityId) && text(item.message))
}

export function isAppDataV4(value: unknown): value is AppDataV4 {
  try {
    return validateAppDataV4(value)
  } catch {
    return false
  }
}

import type { AppDataV4, AppDataV7, OneOffLesson } from '../../types'
import { hasCompatibleV7TimetableData, hasSafeV7TimetableUpdate } from './v6'

type UnknownRecord = Record<string, unknown>
const record = (value: unknown): value is UnknownRecord => value !== null && typeof value === 'object' && !Array.isArray(value)
const named = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const date = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
const fiveMinuteTime = (value: unknown): value is string => typeof value === 'string'
  && /^([01]\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$/.test(value)
const onlyKeys = (value: UnknownRecord, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key))

function validOneOffShape(value: unknown): value is OneOffLesson {
  if (!record(value) || !onlyKeys(value, [
    'id', 'projectId', 'timetableId', 'teachingUnitId', 'classId', 'subjectId',
    'date', 'purpose', 'relatedRecurringLessonId', 'room', 'time',
  ])) return false
  if (!named(value.id) || !named(value.projectId) || !named(value.timetableId) || !named(value.teachingUnitId)
    || !named(value.classId) || !named(value.subjectId) || !date(value.date)
    || !['extra', 'make-up', 'substitute'].includes(value.purpose as string)
    || (value.room !== undefined && typeof value.room !== 'string')
    || (value.relatedRecurringLessonId !== undefined
      && (value.purpose !== 'make-up' || !named(value.relatedRecurringLessonId)))) return false
  const time = value.time
  if (!record(time)) return false
  if (time.mode === 'period') return onlyKeys(time, ['mode', 'periodId']) && Number.isInteger(time.periodId)
  return time.mode === 'custom' && onlyKeys(time, ['mode', 'startTime', 'endTime'])
    && fiveMinuteTime(time.startTime) && fiveMinuteTime(time.endTime) && time.startTime < time.endTime
}

export function isCompatibleAppDataV7(value: unknown): value is AppDataV7 {
  try {
    if (!record(value) || value.schemaVersion !== 7 || !Array.isArray(value.oneOffLessons)
      || !hasCompatibleV7TimetableData(value)) return false
    const data = value as unknown as AppDataV7
    const projects = new Set(data.projects.map((item) => item.id))
    const timetables = new Map(data.timetables.map((item) => [item.id, item]))
    const units = new Map(data.teachingUnits.map((item) => [item.id, item]))
    const classes = new Map(data.classes.map((item) => [item.id, item]))
    const subjects = new Map(data.subjects.map((item) => [item.id, item]))
    const lessons = new Map(data.recurringLessons.map((item) => [item.id, item]))
    const usedIds = new Set([
      ...data.projects.map((item) => item.id), ...data.timetables.map((item) => item.id),
      ...data.schools.map((item) => item.id), ...data.teachingUnits.map((item) => item.id),
      ...data.subjects.map((item) => item.id), ...data.classes.map((item) => item.id),
      ...data.recurringLessons.flatMap((item) => [item.id, item.seriesId]),
      ...data.events.map((item) => item.id), ...data.overrides.map((item) => item.id),
      ...data.migrationWarnings.map((item) => item.id),
    ])
    for (const candidate of data.oneOffLessons) {
      if (!validOneOffShape(candidate) || usedIds.has(candidate.id)) return false
      usedIds.add(candidate.id)
      const unit = units.get(candidate.teachingUnitId)
      const schoolClass = classes.get(candidate.classId)
      const subject = subjects.get(candidate.subjectId)
      if (!projects.has(candidate.projectId) || timetables.get(candidate.timetableId)?.projectId !== candidate.projectId
        || unit?.projectId !== candidate.projectId || schoolClass?.projectId !== candidate.projectId
        || schoolClass.teachingUnitId !== candidate.teachingUnitId || !subject
        || (subject.applicableSchoolLevels && !subject.applicableSchoolLevels.includes(unit.schoolLevel))
        || candidate.date < unit.startDate || candidate.date > unit.endDate) return false
      if (candidate.time.mode === 'period' && !unit.periods.some((period) => period.id === candidate.time.periodId)) return false
      const source = candidate.relatedRecurringLessonId && lessons.get(candidate.relatedRecurringLessonId)
      if (source && (source.projectId !== candidate.projectId || source.timetableId !== candidate.timetableId)) return false
    }
    return true
  } catch {
    return false
  }
}

export function isSafeAppDataV7Update(current: AppDataV4, next: AppDataV4): boolean {
  if (!isCompatibleAppDataV7(next) || !hasSafeV7TimetableUpdate(current, next)) return false
  if ((current.oneOffLessons ?? []).some((lesson) => {
    if (lesson.time.mode !== 'period') return false
    const retained = next.oneOffLessons.find((item) => item.id === lesson.id)
    if (!retained || retained.teachingUnitId !== lesson.teachingUnitId || retained.time.mode !== 'period'
      || retained.time.periodId !== lesson.time.periodId) return false
    const before = current.teachingUnits.find((unit) => unit.id === lesson.teachingUnitId)
      ?.periods.find((period) => period.id === lesson.time.periodId)
    const after = next.teachingUnits.find((unit) => unit.id === lesson.teachingUnitId)
      ?.periods.find((period) => period.id === lesson.time.periodId)
    return before && after && (before.startTime !== after.startTime || before.endTime !== after.endTime)
  })) return false
  const archivedIds = new Set([
    ...current.projects.filter((project) => project.archivedAt).map((project) => project.id),
    ...next.projects.filter((project) => project.archivedAt).map((project) => project.id),
  ])
  return [...archivedIds].every((projectId) => !next.projects.some((project) => project.id === projectId)
    || JSON.stringify(current.oneOffLessons?.filter((item) => item.projectId === projectId) ?? [])
      === JSON.stringify(next.oneOffLessons.filter((item) => item.projectId === projectId)))
}

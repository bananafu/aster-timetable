import { fromDateKey, startOfWeek, toDateKey } from './date'
import type { AlternatingWeekPattern, AppDataV4, DayOfWeek, TeachingUnit } from '../types'
import { classDisplayName } from './classes'
import { selectedTimetableId } from '../data/timetableCompatibility'

export type ResolvedLessonStatus = 'regular' | 'replaced' | 'cancelled' | 'moved'

export interface ResolvedLessonV4 {
  id: string
  seriesId: string
  date: string
  projectId: string
  timetableId?: string
  schoolId: string
  schoolName: string
  schoolColor: string
  teachingUnitId: string
  teachingUnitName: string
  subjectId: string
  subjectName: string
  subjectColor: string
  classId: string
  className: string
  periodId: number
  periodLabel: string
  startTime: string
  endTime: string
  room?: string
  status: ResolvedLessonStatus
  overrideId?: string
  note?: string
  hasConflict: boolean
}

export interface ScheduleFiltersV4 {
  timetableId?: string
  schoolId?: string
  teachingUnitId?: string
}

/** A recurring lesson ID identifies a version, while a date and override identify one occurrence. */
export type LessonOccurrenceIdentity = Pick<ResolvedLessonV4, 'projectId' | 'timetableId' | 'id' | 'seriesId' | 'date' | 'overrideId'>

export interface TodayTeachingSummaryV4 {
  count: number
  state: 'current' | 'next' | 'finished' | 'idle' | 'outside-semester'
  lesson?: ResolvedLessonV4
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function getTeachingUnitWeekPattern(date: Date, unit: TeachingUnit): AlternatingWeekPattern | null {
  if (!unit.weekCycle.enabled) return null
  const targetMonday = startOfWeek(date)
  const anchorMonday = startOfWeek(fromDateKey(unit.weekCycle.anchorDate))
  const weekOffset = Math.round((targetMonday.getTime() - anchorMonday.getTime()) / WEEK_MS)
  const samePattern = Math.abs(weekOffset) % 2 === 0
  return samePattern
    ? unit.weekCycle.anchorPattern
    : unit.weekCycle.anchorPattern === 'A' ? 'B' : 'A'
}

export function timeIntervalsOverlap(
  left: Pick<ResolvedLessonV4, 'startTime' | 'endTime'>,
  right: Pick<ResolvedLessonV4, 'startTime' | 'endTime'>,
): boolean {
  return left.startTime < right.endTime && right.startTime < left.endTime
}

function lessonAppliesOnDate(dateKey: string, day: DayOfWeek, weekPattern: string, unit: TeachingUnit, date: Date) {
  if (dateKey < unit.startDate || dateKey > unit.endDate || date.getDay() !== day) return false
  if (weekPattern === 'every') return true
  return getTeachingUnitWeekPattern(date, unit) === weekPattern
}

export function resolveProjectDay(
  data: AppDataV4,
  projectId: string,
  date: Date,
  filters: ScheduleFiltersV4 = {},
): ResolvedLessonV4[] {
  const timetableId = selectedTimetableId(data, projectId, filters.timetableId)
  const dateKey = toDateKey(date)
  const units = data.teachingUnits.filter((unit) => unit.projectId === projectId
    && (!filters.schoolId || unit.schoolId === filters.schoolId)
    && (!filters.teachingUnitId || unit.id === filters.teachingUnitId))
  const unitIds = new Set(units.map((unit) => unit.id))
  const schools = new Map(data.schools.filter((school) => school.projectId === projectId).map((school) => [school.id, school]))
  const subjects = new Map(data.subjects.map((subject) => [subject.id, subject]))
  const classes = new Map(data.classes.filter((item) => item.projectId === projectId).map((item) => [item.id, item]))
  const assignedOverrides = data.overrides.filter((item) => item.projectId === projectId
    && (data.schemaVersion < 6 || item.timetableId === timetableId)
    && item.teachingUnitId !== null && unitIds.has(item.teachingUnitId))
  const overrides = assignedOverrides.filter((item) => item.date === dateKey)

  const resolved = data.recurringLessons.flatMap<ResolvedLessonV4>((lesson) => {
    if (lesson.projectId !== projectId || (data.schemaVersion >= 6 && lesson.timetableId !== timetableId) || !unitIds.has(lesson.teachingUnitId)
      || dateKey < lesson.effectiveStart || (lesson.effectiveEnd && dateKey > lesson.effectiveEnd)) return []
    const unit = units.find((item) => item.id === lesson.teachingUnitId)
    if (!unit || !lessonAppliesOnDate(dateKey, lesson.day, lesson.weekPattern, unit, date)) return []
    const school = schools.get(unit.schoolId)
    const period = unit.periods.find((item) => item.id === lesson.periodId)
    const originalSubject = subjects.get(lesson.subjectId)
    const originalClass = classes.get(lesson.classId)
    if (!school || !period || !originalSubject || !originalClass) return []

    const activeSlotLessonCount = data.recurringLessons.filter((candidate) => candidate.projectId === projectId
      && (data.schemaVersion < 6 || candidate.timetableId === timetableId)
      && candidate.teachingUnitId === unit.id && candidate.periodId === lesson.periodId
      && dateKey >= candidate.effectiveStart && (!candidate.effectiveEnd || dateKey <= candidate.effectiveEnd)
      && lessonAppliesOnDate(dateKey, candidate.day, candidate.weekPattern, unit, date)).length
    const override = overrides.find((item) => item.teachingUnitId === unit.id && item.periodId === lesson.periodId
      && (item.originalLessonId === lesson.id || (!item.originalLessonId && activeSlotLessonCount === 1)))
    if (override?.action === 'move') return []
    const replacementSubject = override?.action === 'replace' ? subjects.get(override.replacement?.subjectId ?? '') : undefined
    const replacementClass = override?.action === 'replace' ? classes.get(override.replacement?.classId ?? '') : undefined
    const status: ResolvedLessonStatus = override?.action === 'cancel' ? 'cancelled' : override?.action === 'replace' ? 'replaced' : 'regular'
    const subject = replacementSubject ?? originalSubject
    const schoolClass = replacementClass ?? originalClass

    return [{
      id: lesson.id,
      seriesId: lesson.seriesId,
      date: dateKey,
      projectId,
      ...(timetableId && { timetableId }),
      schoolId: school.id,
      schoolName: school.name,
      schoolColor: school.color,
      teachingUnitId: unit.id,
      teachingUnitName: unit.name,
      subjectId: subject.id,
      subjectName: subject.name,
      subjectColor: subject.color,
      classId: schoolClass.id,
      className: classDisplayName(schoolClass),
      periodId: period.id,
      periodLabel: period.label,
      startTime: period.startTime,
      endTime: period.endTime,
      room: override?.action === 'replace' ? override.replacement?.room : lesson.room ?? schoolClass.room,
      status,
      overrideId: override?.id,
      note: override?.note,
      hasConflict: false,
    }]
  })

  const moved = assignedOverrides.flatMap<ResolvedLessonV4>((override) => {
    if (override.action !== 'move' || override.target?.date !== dateKey || !override.originalLessonId || !override.teachingUnitId) return []
    const lesson = data.recurringLessons.find((item) => item.id === override.originalLessonId)
    const unit = units.find((item) => item.id === override.teachingUnitId)
    const school = unit ? schools.get(unit.schoolId) : undefined
    const period = unit?.periods.find((item) => item.id === override.target?.periodId)
    const subject = lesson ? subjects.get(lesson.subjectId) : undefined
    const schoolClass = lesson ? classes.get(lesson.classId) : undefined
    const sourceDate = fromDateKey(override.date)
    if (!lesson || (data.schemaVersion >= 6 && lesson.timetableId !== timetableId) || !unit || !school || !period || !subject || !schoolClass
      || override.date < lesson.effectiveStart || (lesson.effectiveEnd && override.date > lesson.effectiveEnd)
      || !lessonAppliesOnDate(override.date, lesson.day, lesson.weekPattern, unit, sourceDate)) return []
    return [{
      id: lesson.id, seriesId: lesson.seriesId, date: dateKey, projectId, ...(timetableId && { timetableId }), schoolId: school.id,
      schoolName: school.name, schoolColor: school.color, teachingUnitId: unit.id, teachingUnitName: unit.name,
      subjectId: subject.id, subjectName: subject.name, subjectColor: subject.color,
      classId: schoolClass.id, className: classDisplayName(schoolClass), periodId: period.id, periodLabel: period.label,
      startTime: period.startTime, endTime: period.endTime, room: lesson.room ?? schoolClass.room,
      status: 'moved', overrideId: override.id, note: override.note, hasConflict: false,
    }]
  })

  const sorted = [...resolved, ...moved].sort((left, right) => left.startTime.localeCompare(right.startTime)
    || left.endTime.localeCompare(right.endTime)
    || left.schoolName.localeCompare(right.schoolName)
    || left.teachingUnitName.localeCompare(right.teachingUnitName))

  const conflicts = new Set<string>()
  const activeLessons = sorted.filter((item) => item.status !== 'cancelled')
  activeLessons.forEach((lesson, index) => {
    activeLessons.slice(index + 1).forEach((candidate) => {
      if (timeIntervalsOverlap(lesson, candidate)) {
        conflicts.add(lesson.id)
        conflicts.add(candidate.id)
      }
    })
  })
  return sorted.map((item) => ({ ...item, hasConflict: conflicts.has(item.id) }))
}

export function getMoveTargetConflicts(
  data: AppDataV4,
  source: LessonOccurrenceIdentity,
  target: Pick<ResolvedLessonV4, 'date' | 'startTime' | 'endTime'>,
): ResolvedLessonV4[] {
  return resolveProjectDay(data, source.projectId, fromDateKey(target.date), { timetableId: source.timetableId })
    .filter((item) => item.status !== 'cancelled'
      && !(item.projectId === source.projectId && item.timetableId === source.timetableId
        && item.id === source.id && item.seriesId === source.seriesId
        && item.date === source.date && item.overrideId === source.overrideId)
      && timeIntervalsOverlap(item, target))
}

export function resolveProjectWeek(
  data: AppDataV4,
  projectId: string,
  dates: Date[],
  filters: ScheduleFiltersV4 = {},
) {
  return dates.map((date) => ({ date, lessons: resolveProjectDay(data, projectId, date, filters) }))
}

export function getTodayTeachingSummaryV4(data: AppDataV4, projectId: string, now: Date, timetableId?: string): TodayTeachingSummaryV4 {
  selectedTimetableId(data, projectId, timetableId)
  const dateKey = toDateKey(now)
  const hasActiveUnit = data.teachingUnits.some((unit) => unit.projectId === projectId && dateKey >= unit.startDate && dateKey <= unit.endDate)
  if (!hasActiveUnit) return { count: 0, state: 'outside-semester' }
  const lessons = resolveProjectDay(data, projectId, now, { timetableId }).filter((lesson) => lesson.status !== 'cancelled')
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const current = lessons.find((lesson) => lesson.startTime <= currentTime && currentTime < lesson.endTime)
  if (current) return { count: lessons.length, state: 'current', lesson: current }
  const next = lessons.find((lesson) => lesson.startTime > currentTime)
  if (next) return { count: lessons.length, state: 'next', lesson: next }
  return { count: lessons.length, state: lessons.length > 0 ? 'finished' : 'idle' }
}

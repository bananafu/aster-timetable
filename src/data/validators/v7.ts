import { SCHOOL_LEVELS, type AppDataV4, type AppDataV7, type OneOffLesson, type ScheduleOverrideV4 } from '../../types'
import { normalizeSubjectText } from '../../lib/subjectSearch'
import { analyzeSubjectReferences } from '../subjectReferences'
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

function hasSafeSubjectUpdate(current: AppDataV4, next: AppDataV7): boolean {
  const currentSubjects = new Map(current.subjects.map((subject) => [subject.id, subject]))
  const nextSubjects = new Map(next.subjects.map((subject) => [subject.id, subject]))
  for (const field of ['name', 'shortName'] as const) {
    const counts = new Map<string, number>()
    for (const subject of next.subjects) {
      const key = normalizeSubjectText(subject[field])
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const subject of next.subjects) {
      const before = currentSubjects.get(subject.id)
      const key = normalizeSubjectText(subject[field])
      // Grandfather unchanged legacy collisions, never newly introduced ones.
      if ((!before || normalizeSubjectText(before[field]) !== key) && counts.get(key)! > 1) return false
    }
  }
  for (const subject of current.subjects) {
    const after = nextSubjects.get(subject.id)
    const removedLevels = (subject.applicableSchoolLevels ?? SCHOOL_LEVELS)
      .filter((level) => !after?.applicableSchoolLevels.includes(level))
    if (after && !removedLevels.length) continue
    // Check both snapshots: a batch must not hide old references or add new ones
    // while removing a subject or one of its applicable levels.
    for (const data of [current, next]) {
      if (analyzeSubjectReferences(data, subject.id).some((reference) => !after
        || reference.schoolLevel === null || removedLevels.includes(reference.schoolLevel))) return false
    }
  }
  return true
}

type SubjectApplicabilityReference = Pick<ScheduleOverrideV4, 'projectId' | 'timetableId' | 'teachingUnitId'> & { subjectId: string }

function hasSafeSubjectReferences(current: AppDataV4, next: AppDataV7): boolean {
  const currentUnits = new Map(current.teachingUnits.map((unit) => [unit.id, unit]))
  const nextUnits = new Map(next.teachingUnits.map((unit) => [unit.id, unit]))
  const currentSubjects = new Map(current.subjects.map((subject) => [subject.id, subject]))
  const nextSubjects = new Map(next.subjects.map((subject) => [subject.id, subject]))
  const allowed = (reference: SubjectApplicabilityReference, previous?: SubjectApplicabilityReference): boolean => {
    const unit = reference.teachingUnitId === null ? undefined : nextUnits.get(reference.teachingUnitId)
    const level = unit?.projectId === reference.projectId ? unit?.schoolLevel : undefined
    // Evaluate the complete final snapshot first, including same-batch subject repairs.
    if (level && nextSubjects.get(reference.subjectId)?.applicableSchoolLevels.includes(level)) return true
    if (!previous || previous.subjectId !== reference.subjectId || previous.projectId !== reference.projectId
      || previous.timetableId !== reference.timetableId || previous.teachingUnitId !== reference.teachingUnitId) return false
    const oldUnit = previous.teachingUnitId === null ? undefined : currentUnits.get(previous.teachingUnitId)
    const oldLevel = oldUnit?.projectId === previous.projectId ? oldUnit?.schoolLevel : undefined
    // Only the same pre-existing anomaly may survive; changing the unit's level
    // cannot turn a valid reference (or a different anomaly) into a grandfathered one.
    return oldLevel === level && !(oldLevel
      && (currentSubjects.get(previous.subjectId)?.applicableSchoolLevels ?? SCHOOL_LEVELS).includes(oldLevel))
  }

  // Separate maps prevent an ID in another entity kind from authorizing a new reference.
  const currentLessons = new Map(current.recurringLessons.map((lesson) => [lesson.id, lesson]))
  for (const lesson of next.recurringLessons) {
    const previous = currentLessons.get(lesson.id)
    if (!allowed(lesson, previous?.seriesId === lesson.seriesId ? previous : undefined)) return false
  }
  const currentOverrides = new Map(current.overrides.map((override) => [override.id, override]))
  for (const override of next.overrides) {
    if (!override.replacement) continue
    const previous = currentOverrides.get(override.id)
    // Unassigned legacy overrides stay unresolved: never infer ownership from
    // originalLessonId or classId. Preserve their reference fields, but allow notes/room edits.
    const retained = previous?.replacement && previous.action === override.action
      && previous.originalLessonId === override.originalLessonId
      && (override.teachingUnitId !== null || previous.replacement.classId === override.replacement.classId)
    if (!allowed({ ...override, subjectId: override.replacement.subjectId }, retained
      ? { ...previous, subjectId: previous.replacement!.subjectId } : undefined)) return false
  }
  return true
}

/**
 * V7 safety rules that do not depend on the global Subject ownership model.
 * V8 reuses these guards and supplies its own project-scoped Subject rules.
 */
export function isSafeAppDataV7UpdateExceptSubjects(current: AppDataV4, next: AppDataV4): boolean {
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

export function isSafeAppDataV7Update(current: AppDataV4, next: AppDataV4): boolean {
  return isSafeAppDataV7UpdateExceptSubjects(current, next)
    && hasSafeSubjectUpdate(current, next as AppDataV7)
    && hasSafeSubjectReferences(current, next as AppDataV7)
}

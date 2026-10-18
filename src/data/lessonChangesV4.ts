import { fromDateKey, toDateKey } from '../lib/date'
import { getMoveTargetConflicts, resolveProjectDay } from '../lib/scheduleV4'
import type { AppDataV4, RecurringLesson, ScheduleOverrideV4 } from '../types'
import type { LessonDraftV4 } from './lessonsV4'
import { isCurrentAppData } from './validators/current'
import { subjectChoiceAllowed } from '../lib/subjects'
import { assertLessonTimetable, selectedTimetableId } from './timetableCompatibility'

const previousDate = (date: string) => {
  const value = fromDateKey(date)
  value.setDate(value.getDate() - 1)
  return toDateKey(value)
}

function assertWritableLesson(data: AppDataV4, lessonId: string, date: string, timetableId?: string) {
  const lesson = data.recurringLessons.find((item) => item.id === lessonId)
  const selectedId = assertLessonTimetable(data, lessonId, timetableId)
  const project = lesson ? data.projects.find((item) => item.id === lesson.projectId) : undefined
  const unit = lesson ? data.teachingUnits.find((item) => item.id === lesson.teachingUnitId) : undefined
  if (!lesson || !project || !unit) throw new Error('Lesson does not exist')
  if (project.archivedAt) throw new Error('Archived projects are read-only')
  if (date < lesson.effectiveStart || (lesson.effectiveEnd && date > lesson.effectiveEnd)) throw new Error('Date is outside the lesson version')
  const occurrence = resolveProjectDay(data, lesson.projectId, fromDateKey(date), { timetableId: selectedId }).find((item) => item.id === lesson.id && item.status !== 'cancelled')
  if (!occurrence) throw new Error('Lesson does not occur on the selected date')
  if (occurrence.status === 'moved') throw new Error('The lesson already has an override on this date')
  return { lesson, unit, occurrence }
}

function assertNoExistingOverride(data: AppDataV4, lessonId: string, date: string) {
  if (data.overrides.some((item) => item.originalLessonId === lessonId && item.date === date)) throw new Error('The lesson already has an override on this date')
}

function validResult(value: AppDataV4) {
  if (!isCurrentAppData(value)) throw new Error('Change produced invalid AppData')
  return value
}

export function revokeLessonOverride(data: AppDataV4, overrideId: string, selectedId?: string): AppDataV4 {
  const override = data.overrides.find((item) => item.id === overrideId)
  if (!override || override.projectId === null) throw new Error('Assigned override does not exist')
  const timetableId = selectedTimetableId(data, override.projectId, selectedId)
  if (timetableId && override.timetableId !== timetableId) throw new Error('Override timetable does not match the project timetable')
  const project = data.projects.find((item) => item.id === override.projectId)
  if (!project || project.archivedAt) throw new Error('Archived projects are read-only')
  const related = override.groupId ? data.overrides.filter((item) => item.groupId === override.groupId) : [override]
  if (override.groupId && related.length < 2) throw new Error('Grouped override is incomplete and cannot be revoked safely')
  if (related.some((item) => item.projectId !== override.projectId || (data.schemaVersion === 6 && item.timetableId !== timetableId))) throw new Error('Grouped override crosses timetable boundaries')
  const removedIds = new Set(related.map((item) => item.id))
  return validResult({ ...data, overrides: data.overrides.filter((item) => !removedIds.has(item.id)) })
}

export function cancelLessonOnDate(data: AppDataV4, lessonId: string, date: string, createId: () => string, timetableId?: string): AppDataV4 {
  const { lesson } = assertWritableLesson(data, lessonId, date, timetableId)
  assertNoExistingOverride(data, lessonId, date)
  const override: ScheduleOverrideV4 = { id: createId(), projectId: lesson.projectId, ...(lesson.timetableId && { timetableId: lesson.timetableId }), teachingUnitId: lesson.teachingUnitId, date, periodId: lesson.periodId, action: 'cancel', originalLessonId: lesson.id, origin: 'user' }
  return validResult({ ...data, overrides: [...data.overrides, override] })
}

export function replaceLessonOnDate(data: AppDataV4, lessonId: string, date: string, replacement: { subjectId: string; classId: string; room?: string }, createId: () => string, existingOverrideId?: string, timetableId?: string): AppDataV4 {
  const previous = existingOverrideId ? data.overrides.find((item) => item.id === existingOverrideId) : undefined
  if (existingOverrideId && (!previous || previous.action !== 'replace' || previous.groupId || previous.originalLessonId !== lessonId || previous.date !== date)) throw new Error('Existing replacement override is invalid')
  const base = existingOverrideId ? revokeLessonOverride(data, existingOverrideId, timetableId) : data
  const { lesson, unit } = assertWritableLesson(base, lessonId, date, timetableId)
  assertNoExistingOverride(base, lessonId, date)
  const schoolClass = data.classes.find((item) => item.id === replacement.classId)
  if (!subjectChoiceAllowed(data.subjects.find((item) => item.id === replacement.subjectId), unit.schoolLevel, unit.id,
    previous?.replacement ? { subjectId: previous.replacement.subjectId, teachingUnitId: previous.teachingUnitId ?? '' } : undefined)
    || schoolClass?.projectId !== lesson.projectId || schoolClass.teachingUnitId !== unit.id) throw new Error('Replacement content does not belong to the lesson unit')
  const override: ScheduleOverrideV4 = { id: createId(), projectId: lesson.projectId, ...(lesson.timetableId && { timetableId: lesson.timetableId }), teachingUnitId: lesson.teachingUnitId, date, periodId: lesson.periodId, action: 'replace', originalLessonId: lesson.id, replacement: { ...replacement, room: replacement.room?.trim() || undefined }, origin: 'user' }
  return validResult({ ...base, overrides: [...base.overrides, override] })
}

export function moveLessonOnDate(data: AppDataV4, lessonId: string, date: string, target: { date: string; periodId: number }, allowConflict: boolean, createId: () => string, timetableId?: string): AppDataV4 {
  const { lesson, unit, occurrence } = assertWritableLesson(data, lessonId, date, timetableId)
  assertNoExistingOverride(data, lessonId, date)
  const targetPeriod = unit.periods.find((item) => item.id === target.periodId)
  if (!targetPeriod || target.date < unit.startDate || target.date > unit.endDate) throw new Error('Move target must use a valid period from the original teaching unit')
  const collisions = getMoveTargetConflicts(data, occurrence, { date: target.date, startTime: targetPeriod.startTime, endTime: targetPeriod.endTime })
  if (collisions.length > 0 && !allowConflict) throw new Error('Move target is occupied')
  const override: ScheduleOverrideV4 = { id: createId(), projectId: lesson.projectId, ...(lesson.timetableId && { timetableId: lesson.timetableId }), teachingUnitId: lesson.teachingUnitId, date, periodId: lesson.periodId, action: 'move', originalLessonId: lesson.id, target, origin: 'user' }
  return validResult({ ...data, overrides: [...data.overrides, override] })
}

function periodMatchingTime(data: AppDataV4, lesson: RecurringLesson, startTime: string, endTime: string) {
  return data.teachingUnits.find((item) => item.id === lesson.teachingUnitId)?.periods.find((item) => item.startTime === startTime && item.endTime === endTime)
}

export function swapLessonsOnDate(data: AppDataV4, firstId: string, secondId: string, date: string, createId: () => string, timetableId?: string): AppDataV4 {
  return swapLessonOccurrences(data, firstId, date, secondId, date, createId, timetableId)
}

export function swapLessonOccurrences(data: AppDataV4, firstId: string, firstDate: string, secondId: string, secondDate: string, createId: () => string, timetableId?: string): AppDataV4 {
  if (firstId === secondId) throw new Error('Two different lessons are required')
  const first = assertWritableLesson(data, firstId, firstDate, timetableId).lesson
  const second = assertWritableLesson(data, secondId, secondDate, timetableId).lesson
  if (first.projectId !== second.projectId || (data.schemaVersion === 6 && first.timetableId !== second.timetableId)) throw new Error('Lessons must belong to the same timetable')
  assertNoExistingOverride(data, firstId, firstDate); assertNoExistingOverride(data, secondId, secondDate)
  const firstSlot = resolveProjectDay(data, first.projectId, fromDateKey(firstDate), { timetableId: first.timetableId }).find((item) => item.id === firstId)!
  const secondSlot = resolveProjectDay(data, first.projectId, fromDateKey(secondDate), { timetableId: first.timetableId }).find((item) => item.id === secondId)!
  const firstTarget = periodMatchingTime(data, first, secondSlot.startTime, secondSlot.endTime)
  const secondTarget = periodMatchingTime(data, second, firstSlot.startTime, firstSlot.endTime)
  if (!firstTarget || !secondTarget) throw new Error('Cross-school swap has no matching real-time period in each original unit')
  const groupId = createId()
  const overrides: ScheduleOverrideV4[] = [
    { id: createId(), groupId, projectId: first.projectId, ...(first.timetableId && { timetableId: first.timetableId }), teachingUnitId: first.teachingUnitId, date: firstDate, periodId: first.periodId, action: 'move', originalLessonId: first.id, target: { date: secondDate, periodId: firstTarget.id }, origin: 'user' },
    { id: createId(), groupId, projectId: second.projectId, ...(second.timetableId && { timetableId: second.timetableId }), teachingUnitId: second.teachingUnitId, date: secondDate, periodId: second.periodId, action: 'move', originalLessonId: second.id, target: { date: firstDate, periodId: secondTarget.id }, origin: 'user' },
  ]
  return validResult({ ...data, overrides: [...data.overrides, ...overrides] })
}

function weekOverlap(left: RecurringLesson['weekPattern'], right: RecurringLesson['weekPattern']) {
  return left === 'every' || right === 'every' || left === right
}

function prepareSplit(data: AppDataV4, lesson: RecurringLesson, date: string, draft: LessonDraftV4, newId: string, excludedIds: Set<string>) {
  const project = data.projects.find((item) => item.id === lesson.projectId)
  const unit = data.teachingUnits.find((item) => item.id === draft.teachingUnitId)
  const school = data.schools.find((item) => item.id === draft.schoolId)
  const schoolClass = data.classes.find((item) => item.id === draft.classId)
  if (!project || project.archivedAt || draft.projectId !== lesson.projectId || (data.schemaVersion === 6 && draft.timetableId !== lesson.timetableId)) throw new Error('Project or timetable is read-only or cannot be changed')
  if (draft.teachingUnitId !== lesson.teachingUnitId) throw new Error('Permanent changes cannot move a lesson across teaching units')
  if (!unit || unit.projectId !== project.id || school?.id !== unit.schoolId || schoolClass?.teachingUnitId !== unit.id || schoolClass.projectId !== project.id) throw new Error('Permanent change has invalid project references')
  if (!unit.periods.some((item) => item.id === draft.periodId) || !subjectChoiceAllowed(data.subjects.find((item) => item.id === draft.subjectId), unit.schoolLevel, unit.id, lesson)) throw new Error('Permanent change has invalid period or subject')
  if ((!unit.weekCycle.enabled && draft.weekPattern !== 'every') || date < unit.startDate || date > unit.endDate || date < lesson.effectiveStart || (lesson.effectiveEnd && date > lesson.effectiveEnd)) throw new Error('Permanent effective date is invalid')
  const next: RecurringLesson = { ...lesson, id: newId, projectId: draft.projectId, teachingUnitId: draft.teachingUnitId, subjectId: draft.subjectId, classId: draft.classId, day: draft.day, periodId: draft.periodId, weekPattern: draft.weekPattern, effectiveStart: date, effectiveEnd: lesson.effectiveEnd, room: draft.room?.trim() || undefined, origin: 'user' }
  const conflict = data.recurringLessons.some((item) => !excludedIds.has(item.id) && item.projectId === next.projectId && item.teachingUnitId === next.teachingUnitId
    && (data.schemaVersion !== 6 || item.timetableId === next.timetableId)
    && item.day === next.day && item.periodId === next.periodId && weekOverlap(item.weekPattern, next.weekPattern)
    && item.effectiveStart <= (next.effectiveEnd ?? '9999-12-31') && next.effectiveStart <= (item.effectiveEnd ?? '9999-12-31'))
  if (conflict) throw new Error('Permanent change conflicts with another lesson version')
  return next
}

function applySplits(data: AppDataV4, splits: Array<{ current: RecurringLesson; next: RecurringLesson; date: string }>) {
  const nextIds = new Map(splits.map((item) => [item.current.id, item.next.id]))
  const lessons = data.recurringLessons.flatMap((lesson) => {
    const split = splits.find((item) => item.current.id === lesson.id)
    if (!split) return [lesson]
    if (split.date === lesson.effectiveStart) return [split.next]
    return [{ ...lesson, effectiveEnd: previousDate(split.date) }, split.next]
  })
  const overrides = data.overrides.map((item) => {
    const split = splits.find((candidate) => candidate.current.id === item.originalLessonId && item.date >= candidate.date
      && (data.schemaVersion !== 6 || item.timetableId === candidate.current.timetableId))
    return split ? { ...item, originalLessonId: nextIds.get(split.current.id) } : item
  })
  return validResult({ ...data, recurringLessons: lessons, overrides })
}

export function permanentlyUpdateLesson(data: AppDataV4, lessonId: string, date: string, draft: LessonDraftV4, createId: () => string): AppDataV4 {
  const { lesson } = assertWritableLesson(data, lessonId, date, draft.timetableId)
  const next = prepareSplit(data, lesson, date, { ...draft, timetableId: lesson.timetableId }, createId(), new Set([lesson.id]))
  return applySplits(data, [{ current: lesson, next, date }])
}

export function permanentlySwapLessons(data: AppDataV4, firstId: string, secondId: string, date: string, createId: () => string, timetableId?: string): AppDataV4 {
  if (firstId === secondId) throw new Error('Two different lessons are required')
  const first = assertWritableLesson(data, firstId, date, timetableId).lesson
  const second = assertWritableLesson(data, secondId, date, timetableId).lesson
  if (first.projectId !== second.projectId || (data.schemaVersion === 6 && first.timetableId !== second.timetableId)) throw new Error('Lessons must belong to the same timetable')
  const firstUnit = data.teachingUnits.find((item) => item.id === first.teachingUnitId)!
  const secondUnit = data.teachingUnits.find((item) => item.id === second.teachingUnitId)!
  const firstPeriod = firstUnit.periods.find((item) => item.id === first.periodId)!
  const secondPeriod = secondUnit.periods.find((item) => item.id === second.periodId)!
  const firstTarget = periodMatchingTime(data, first, secondPeriod.startTime, secondPeriod.endTime)
  const secondTarget = periodMatchingTime(data, second, firstPeriod.startTime, firstPeriod.endTime)
  if (!firstTarget || !secondTarget) throw new Error('Cross-school swap has no matching real-time period in each original unit')
  const excluded = new Set([first.id, second.id])
  const firstSchool = data.schools.find((item) => item.id === firstUnit.schoolId)!
  const secondSchool = data.schools.find((item) => item.id === secondUnit.schoolId)!
  const firstNext = prepareSplit(data, first, date, { projectId: first.projectId, timetableId: first.timetableId, schoolId: firstSchool.id, teachingUnitId: first.teachingUnitId, subjectId: first.subjectId, classId: first.classId, day: second.day, periodId: firstTarget.id, weekPattern: first.weekPattern, room: first.room }, createId(), excluded)
  const secondNext = prepareSplit(data, second, date, { projectId: second.projectId, timetableId: second.timetableId, schoolId: secondSchool.id, teachingUnitId: second.teachingUnitId, subjectId: second.subjectId, classId: second.classId, day: first.day, periodId: secondTarget.id, weekPattern: second.weekPattern, room: second.room }, createId(), excluded)
  if (firstNext.teachingUnitId === secondNext.teachingUnitId && firstNext.day === secondNext.day && firstNext.periodId === secondNext.periodId && weekOverlap(firstNext.weekPattern, secondNext.weekPattern)) throw new Error('Permanent swap would create a conflict')
  return applySplits(data, [{ current: first, next: firstNext, date }, { current: second, next: secondNext, date }])
}

export function endLessonFromDate(data: AppDataV4, lessonId: string, date: string, timetableId?: string): AppDataV4 {
  const { lesson } = assertWritableLesson(data, lessonId, date, timetableId)
  if (data.overrides.some((item) => item.originalLessonId === lessonId && item.date >= date)) throw new Error('Future overrides must be resolved before ending this lesson')
  const lessons = date === lesson.effectiveStart
    ? data.recurringLessons.filter((item) => item.id !== lesson.id)
    : data.recurringLessons.map((item) => item.id === lesson.id ? { ...item, effectiveEnd: previousDate(date) } : item)
  return validResult({ ...data, recurringLessons: lessons })
}

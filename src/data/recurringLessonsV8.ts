import type { AppDataV8, TeachingUnit } from '../types'
import { addDays, fromDateKey, toDateKey } from '../lib/date'
import { getTeachingUnitWeekPattern, timeIntervalsOverlap } from '../lib/scheduleV4'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

type LessonV8 = AppDataV8['recurringLessons'][number]
export type RecurringLessonV8Draft = Pick<LessonV8,
  'projectId' | 'timetableId' | 'teachingUnitId' | 'classId' | 'subjectId' | 'day' | 'periodId' | 'weekPattern'>
  & { room?: string }
export class RecurringLessonV8Error extends Error {
  constructor(public readonly code: 'invalid-data' | 'invalid-reference' | 'invalid-draft' | 'id-collision'
    | 'conflict' | 'referenced' | 'not-found' | 'unsafe-update', message: string) {
    super(message); this.name = 'RecurringLessonV8Error'
  }
}
const fail = (code: RecurringLessonV8Error['code'], message: string): never => { throw new RecurringLessonV8Error(code, message) }
const valid = (data: AppDataV8) => { if (!isCompatibleAppDataV8(data)) fail('invalid-data', 'V8 document is invalid.') }
const safe = (current: AppDataV8, next: AppDataV8) => {
  if (!isSafeAppDataV8Update(current, next)) fail('unsafe-update', 'Lesson update is unsafe.')
  return next
}
const periodsOverlap = (left: { startTime: string; endTime: string }, right: { startTime: string; endTime: string }) =>
  timeIntervalsOverlap(left, right)

/** Examine at most two occurrences: each unit's week pattern repeats every two weeks. */
export function recurringLessonsConflictV8(data: AppDataV8, left: LessonV8, right: LessonV8): boolean {
  if (left.projectId !== right.projectId || left.timetableId !== right.timetableId || left.day !== right.day) return false
  const leftUnit = data.teachingUnits.find((item) => item.id === left.teachingUnitId)
  const rightUnit = data.teachingUnits.find((item) => item.id === right.teachingUnitId)
  const leftPeriod = leftUnit?.periods.find((item) => item.id === left.periodId)
  const rightPeriod = rightUnit?.periods.find((item) => item.id === right.periodId)
  if (!leftUnit || !rightUnit || !leftPeriod || !rightPeriod || !periodsOverlap(leftPeriod, rightPeriod)) return false
  const start = [left.effectiveStart, right.effectiveStart, leftUnit.startDate, rightUnit.startDate].sort().at(-1)!
  const end = [left.effectiveEnd ?? leftUnit.endDate, right.effectiveEnd ?? rightUnit.endDate,
    leftUnit.endDate, rightUnit.endDate].sort()[0]
  if (start > end) return false
  let date = fromDateKey(start)
  while (date.getDay() !== left.day) date = addDays(date, 1)
  for (let attempt = 0; attempt < 2 && toDateKey(date) <= end; attempt++, date = addDays(date, 7)) {
    if ((left.weekPattern === 'every' || getTeachingUnitWeekPattern(date, leftUnit) === left.weekPattern)
      && (right.weekPattern === 'every' || getTeachingUnitWeekPattern(date, rightUnit) === right.weekPattern)) return true
  }
  return false
}

export function recurringLessonAppliesV8(data: AppDataV8, lesson: LessonV8, date: Date): boolean {
  const unit = data.teachingUnits.find((item) => item.id === lesson.teachingUnitId)
  const key = toDateKey(date)
  return !!unit && key >= unit.startDate && key <= unit.endDate && key >= lesson.effectiveStart
    && key <= (lesson.effectiveEnd ?? unit.endDate) && date.getDay() === lesson.day
    && (lesson.weekPattern === 'every' || getTeachingUnitWeekPattern(date, unit) === lesson.weekPattern)
}

export function listRecurringLessonsV8(data: AppDataV8, projectId: string, timetableId: string): LessonV8[] {
  valid(data)
  if (!data.timetables.some((item) => item.id === timetableId && item.projectId === projectId)) {
    fail('invalid-reference', 'Timetable does not belong to Project.')
  }
  return data.recurringLessons.filter((item) => item.projectId === projectId && item.timetableId === timetableId)
    .map((item) => ({ ...item }))
}
function checkedDraft(data: AppDataV8, draft: RecurringLessonV8Draft): { unit: TeachingUnit; room?: string } {
  const project = data.projects.find((item) => item.id === draft.projectId)
  const timetable = data.timetables.find((item) => item.id === draft.timetableId && item.projectId === draft.projectId)
  const unit = data.teachingUnits.find((item) => item.id === draft.teachingUnitId && item.projectId === draft.projectId)
  const schoolClass = data.classes.find((item) => item.id === draft.classId && item.projectId === draft.projectId)
  const subject = data.subjects.find((item) => item.id === draft.subjectId && item.projectId === draft.projectId)
  if (!project || project.archivedAt || !timetable || !unit || schoolClass?.teachingUnitId !== unit.id
    || !subject?.applicableSchoolLevels.includes(unit.schoolLevel)
    || !data.teachingUnitSubjects.some((item) => item.projectId === draft.projectId
      && item.teachingUnitId === unit.id && item.subjectId === draft.subjectId)) {
    fail('invalid-reference', 'Lesson scope or teaching configuration is invalid.')
  }
  if (![1, 2, 3, 4, 5].includes(draft.day) || !unit!.periods.some((item) => item.id === draft.periodId)
    || !['every', 'A', 'B'].includes(draft.weekPattern) || (!unit!.weekCycle.enabled && draft.weekPattern !== 'every')
    || (draft.room !== undefined && draft.room.trim().length > 15)) fail('invalid-draft', 'Lesson slot or week pattern is invalid.')
  return { unit: unit!, room: draft.room?.trim() || undefined }
}
function noConflict(data: AppDataV8, candidate: LessonV8, exceptId?: string) {
  if (data.recurringLessons.some((item) => item.id !== exceptId && recurringLessonsConflictV8(data, item, candidate))) {
    fail('conflict', 'Teacher Timetable already has a lesson in this time interval.')
  }
}
export function createRecurringLessonV8(data: AppDataV8, draft: RecurringLessonV8Draft, id: string): AppDataV8 {
  valid(data)
  const { unit, room } = checkedDraft(data, draft)
  if (!id?.trim() || id !== id.trim() || [
    ...data.projects, ...data.schools, ...data.teachingUnits, ...data.timetables, ...data.subjects,
    ...data.teachingUnitSubjects, ...data.classes, ...data.recurringLessons, ...data.events,
    ...data.overrides, ...data.oneOffLessons, ...data.teachingProgress, ...data.migrationWarnings,
  ].some((item) => item.id === id) || data.recurringLessons.some((item) => item.seriesId === id)) {
    fail('id-collision', 'Lesson ID is invalid or already in use.')
  }
  const lesson: LessonV8 = { ...draft, timetableId: draft.timetableId, id, seriesId: id,
    effectiveStart: unit.startDate, effectiveEnd: unit.endDate, room, origin: 'user' }
  noConflict(data, lesson)
  return safe(data, { ...data, recurringLessons: [...data.recurringLessons, lesson] })
}
export function updateRecurringLessonV8(data: AppDataV8, projectId: string, timetableId: string,
  lessonId: string, draft: RecurringLessonV8Draft): AppDataV8 {
  valid(data)
  const current = data.recurringLessons.find((item) => item.id === lessonId && item.projectId === projectId
    && item.timetableId === timetableId)
  if (!current) fail('not-found', 'Lesson does not belong to this Timetable.')
  if (draft.projectId !== projectId || draft.timetableId !== timetableId) fail('invalid-reference', 'Cannot move Lesson across Timetables or Projects.')
  if (data.recurringLessons.some((item) => item.seriesId === current!.seriesId && item.effectiveStart > current!.effectiveStart)) {
    fail('referenced', 'Historical Lesson versions are read-only.')
  }
  const { unit, room } = checkedDraft(data, draft)
  const structuralChange = current!.teachingUnitId !== draft.teachingUnitId || current!.day !== draft.day
    || current!.periodId !== draft.periodId || current!.weekPattern !== draft.weekPattern
  if (structuralChange && data.overrides.some((item) => item.originalLessonId === lessonId)) {
    fail('referenced', 'Lesson has date-specific changes and cannot be moved.')
  }
  const next: LessonV8 = { ...current!, ...draft, effectiveStart: current!.teachingUnitId === unit.id
    ? current!.effectiveStart : unit.startDate, effectiveEnd: current!.teachingUnitId === unit.id
      ? current!.effectiveEnd : unit.endDate, room, origin: 'user' }
  noConflict(data, next, lessonId)
  return safe(data, { ...data, recurringLessons: data.recurringLessons.map((item) => item.id === lessonId ? next : item) })
}
export function getRecurringLessonV8Impact(data: AppDataV8, projectId: string, timetableId: string, lessonId: string) {
  valid(data)
  const lesson = data.recurringLessons.find((item) => item.id === lessonId && item.projectId === projectId
    && item.timetableId === timetableId)
  if (!lesson) fail('not-found', 'Lesson does not belong to this Timetable.')
  return { lesson: lesson!, changes: data.overrides.filter((item) => item.originalLessonId === lessonId).length,
    oneOff: data.oneOffLessons.filter((item) => item.relatedRecurringLessonId === lessonId).length,
    progress: data.teachingProgress.filter((item) => item.projectId === projectId && item.timetableId === timetableId
      && item.teachingUnitId === lesson!.teachingUnitId && item.classId === lesson!.classId
      && item.subjectId === lesson!.subjectId).length,
    versions: data.recurringLessons.filter((item) => item.seriesId === lesson!.seriesId).length }
}
export function deleteRecurringLessonV8(data: AppDataV8, projectId: string, timetableId: string,
  lessonId: string, confirmed = false): AppDataV8 {
  const impact = getRecurringLessonV8Impact(data, projectId, timetableId, lessonId)
  if (!confirmed) fail('invalid-draft', 'Deletion requires confirmation.')
  if (impact.changes || impact.oneOff || impact.progress || impact.versions > 1) {
    fail('referenced', 'Lesson has changes, one-off links, progress or historical versions.')
  }
  return safe(data, { ...data, recurringLessons: data.recurringLessons.filter((item) => item.id !== lessonId) })
}

import type { AppDataV8, OneOffLesson } from '../types'
import { fromDateKey, toDateKey } from '../lib/date'
import { getMoveTargetConflicts, resolveProjectDay, timeIntervalsOverlap,
  type ResolvedScheduleOccurrence } from '../lib/scheduleV4'
import { recurringLessonAppliesV8 } from './recurringLessonsV8'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

type Lesson = AppDataV8['recurringLessons'][number]
export type ExtraLessonV8Draft = Pick<OneOffLesson, 'projectId' | 'timetableId' | 'teachingUnitId'
  | 'classId' | 'subjectId' | 'date' | 'time'> & { room?: string }

export class OneTimeLessonV8Error extends Error {
  constructor(public readonly code: 'invalid-data' | 'invalid-reference' | 'invalid-date' | 'invalid-draft'
    | 'not-found' | 'duplicate' | 'conflict' | 'unsafe-update', message: string) {
    super(message)
    this.name = 'OneTimeLessonV8Error'
  }
}
const fail = (code: OneTimeLessonV8Error['code'], message: string): never => {
  throw new OneTimeLessonV8Error(code, message)
}
const valid = (data: AppDataV8) => {
  if (!isCompatibleAppDataV8(data)) fail('invalid-data', 'V8 document is invalid.')
}
const safe = (current: AppDataV8, next: AppDataV8): AppDataV8 => {
  if (!isSafeAppDataV8Update(current, next)) fail('unsafe-update', 'One-time lesson update is unsafe.')
  return next
}
const dateValid = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key) && toDateKey(fromDateKey(key)) === key
const idUsed = (data: AppDataV8, id: string) => [
  ...data.projects, ...data.schools, ...data.teachingUnits, ...data.timetables, ...data.subjects,
  ...data.teachingUnitSubjects, ...data.classes, ...data.recurringLessons, ...data.events,
  ...data.overrides, ...data.oneOffLessons, ...data.teachingProgress, ...data.migrationWarnings,
].some((item) => item.id === id) || data.recurringLessons.some((item) => item.seriesId === id)
const checkId = (data: AppDataV8, id: string, uuid = false) => {
  if (!id || id !== id.trim() || idUsed(data, id) || (uuid
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
    fail('invalid-draft', 'ID is invalid or already in use.')
  }
}
const scope = (data: AppDataV8, projectId: string, timetableId: string, writable = false) => {
  valid(data)
  const project = data.projects.find((item) => item.id === projectId)
  if (!project || !data.timetables.some((item) => item.id === timetableId && item.projectId === projectId)) {
    fail('invalid-reference', 'Project or Timetable is invalid.')
  }
  if (writable && project!.archivedAt) fail('invalid-reference', 'Archived Project is read-only.')
  return project
}
const inUnitTerm = (date: string, unit: AppDataV8['teachingUnits'][number]) =>
  dateValid(date) && date >= unit.startDate && date <= unit.endDate

/** V4's established resolver applies cancel, move-out, move-in, then dated OneOff lessons. */
export function resolveEffectiveLessonsV8(data: AppDataV8, projectId: string, timetableId: string,
  date: string): ResolvedScheduleOccurrence[] {
  scope(data, projectId, timetableId)
  if (!dateValid(date)) fail('invalid-date', 'Date is invalid.')
  return resolveProjectDay(data, projectId, fromDateKey(date), { timetableId })
    .filter((item) => item.kind === 'one-off' || item.status !== 'cancelled')
}

export function listOneTimeLessonsV8(data: AppDataV8, projectId: string, timetableId: string) {
  scope(data, projectId, timetableId)
  return {
    changes: data.overrides.filter((item) => item.projectId === projectId && item.timetableId === timetableId)
      .map((item) => ({ ...item, target: item.target && { ...item.target } })),
    extras: data.oneOffLessons.filter((item) => item.projectId === projectId && item.timetableId === timetableId)
      .map((item) => ({ ...item, time: { ...item.time } })),
  }
}

function sourceLesson(data: AppDataV8, projectId: string, timetableId: string, lessonId: string,
  sourceDate: string): { lesson: Lesson; occurrence: ResolvedScheduleOccurrence } {
  scope(data, projectId, timetableId, true)
  const lesson = data.recurringLessons.find((item) => item.id === lessonId && item.projectId === projectId
    && item.timetableId === timetableId)
  if (!lesson) fail('not-found', 'Recurring Lesson does not belong to this Timetable.')
  if (!dateValid(sourceDate) || !recurringLessonAppliesV8(data, lesson!, fromDateKey(sourceDate))) {
    fail('invalid-date', 'Recurring Lesson does not occur on the source date.')
  }
  if (data.overrides.some((item) => item.originalLessonId === lessonId && item.date === sourceDate)) {
    fail('duplicate', 'This Lesson occurrence already has a change.')
  }
  const occurrence = resolveProjectDay(data, projectId, fromDateKey(sourceDate), { timetableId })
    .find((item) => item.kind === 'recurring' && item.id === lessonId && item.sourceDate === sourceDate
      && item.status === 'regular')
  if (!occurrence) fail('invalid-date', 'Source Lesson occurrence is not currently available.')
  return { lesson: lesson!, occurrence: occurrence! }
}

export function cancelLessonOnceV8(data: AppDataV8, projectId: string, timetableId: string,
  lessonId: string, sourceDate: string, id: string): AppDataV8 {
  const { lesson } = sourceLesson(data, projectId, timetableId, lessonId, sourceDate)
  checkId(data, id)
  const change: AppDataV8['overrides'][number] = { id, projectId, timetableId, teachingUnitId: lesson.teachingUnitId,
    date: sourceDate, periodId: lesson.periodId, action: 'cancel', originalLessonId: lessonId, origin: 'user' }
  return safe(data, { ...data, overrides: [...data.overrides, change] })
}

export function moveLessonOnceV8(data: AppDataV8, projectId: string, timetableId: string,
  lessonId: string, sourceDate: string, target: { date: string; periodId: number }, id: string): AppDataV8 {
  const { lesson, occurrence } = sourceLesson(data, projectId, timetableId, lessonId, sourceDate)
  checkId(data, id)
  const unit = data.teachingUnits.find((item) => item.id === lesson.teachingUnitId)!
  const period = unit.periods.find((item) => item.id === target.periodId)
  if (!inUnitTerm(target.date, unit) || !period) fail('invalid-date', 'Move target must use this Unit term and period.')
  if (target.date === sourceDate && target.periodId === lesson.periodId) {
    fail('invalid-draft', 'Move target must differ from the original occurrence.')
  }
  if (getMoveTargetConflicts(data, occurrence, { date: target.date, startTime: period!.startTime,
    endTime: period!.endTime }).length) fail('conflict', 'Move target overlaps an effective Lesson.')
  const change: AppDataV8['overrides'][number] = { id, projectId, timetableId, teachingUnitId: lesson.teachingUnitId,
    date: sourceDate, periodId: lesson.periodId, action: 'move', originalLessonId: lessonId,
    target: { ...target }, origin: 'user' }
  return safe(data, { ...data, overrides: [...data.overrides, change] })
}

function checkedExtra(data: AppDataV8, draft: ExtraLessonV8Draft) {
  scope(data, draft.projectId, draft.timetableId, true)
  const unit = data.teachingUnits.find((item) => item.id === draft.teachingUnitId && item.projectId === draft.projectId)
  const schoolClass = data.classes.find((item) => item.id === draft.classId && item.projectId === draft.projectId)
  const subject = data.subjects.find((item) => item.id === draft.subjectId && item.projectId === draft.projectId)
  if (!unit || schoolClass?.teachingUnitId !== unit.id || !subject?.applicableSchoolLevels.includes(unit.schoolLevel)
    || !data.teachingUnitSubjects.some((item) => item.projectId === draft.projectId
      && item.teachingUnitId === unit.id && item.subjectId === draft.subjectId)) {
    fail('invalid-reference', 'Extra Lesson TeachingUnit, Class or Subject is invalid.')
  }
  if (!inUnitTerm(draft.date, unit!)) fail('invalid-date', 'Extra Lesson date is outside the Unit term.')
  if (draft.room !== undefined && draft.room.trim().length > 15) fail('invalid-draft', 'Room is too long.')
  if (draft.time.mode === 'period') {
    const period = unit!.periods.find((item) => item.id === draft.time.periodId)
    if (!period) fail('invalid-draft', 'Period is invalid.')
    return { startTime: period!.startTime, endTime: period!.endTime }
  }
  const fiveMinutes = /^([01]\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$/
  if (draft.time.mode !== 'custom' || !fiveMinutes.test(draft.time.startTime)
    || !fiveMinutes.test(draft.time.endTime) || draft.time.endTime <= draft.time.startTime) {
    fail('invalid-draft', 'Custom time must be a valid five-minute interval.')
  }
  return { startTime: draft.time.startTime, endTime: draft.time.endTime }
}

export function createExtraLessonV8(data: AppDataV8, draft: ExtraLessonV8Draft, id: string): AppDataV8 {
  const time = checkedExtra(data, draft)
  checkId(data, id, true)
  if (resolveEffectiveLessonsV8(data, draft.projectId, draft.timetableId, draft.date)
    .some((item) => timeIntervalsOverlap(item, time))) fail('conflict', 'Extra Lesson overlaps an effective Lesson.')
  const extra: OneOffLesson = { ...draft, id, purpose: 'extra', room: draft.room?.trim() || undefined,
    time: { ...draft.time } }
  return safe(data, { ...data, oneOffLessons: [...data.oneOffLessons, extra] })
}

/** Existing V4 contract revokes an entire group, never a single member. */
export function revokeOneTimeChangeV8(data: AppDataV8, projectId: string, timetableId: string,
  changeId: string): AppDataV8 {
  scope(data, projectId, timetableId, true)
  const change = data.overrides.find((item) => item.id === changeId && item.projectId === projectId
    && item.timetableId === timetableId)
  if (!change) fail('not-found', 'Change does not belong to this Timetable.')
  const related = change!.groupId ? data.overrides.filter((item) => item.groupId === change!.groupId) : [change!]
  if (change!.groupId && related.length < 2) fail('invalid-reference', 'Change group is incomplete.')
  if (related.some((item) => item.projectId !== projectId || item.timetableId !== timetableId)) {
    fail('invalid-reference', 'Change group crosses scope.')
  }
  const ids = new Set(related.map((item) => item.id))
  const next = safe(data, { ...data, overrides: data.overrides.filter((item) => !ids.has(item.id)) })
  for (const date of new Set(related.flatMap((item) => [item.date, item.target?.date].filter((value): value is string => !!value)))) {
    if (resolveEffectiveLessonsV8(next, projectId, timetableId, date).some((item) => item.hasConflict)) {
      fail('conflict', 'Revoking this Change would create a Lesson conflict.')
    }
  }
  return next
}

export function deleteExtraLessonV8(data: AppDataV8, projectId: string, timetableId: string,
  extraId: string): AppDataV8 {
  scope(data, projectId, timetableId, true)
  const extra = data.oneOffLessons.find((item) => item.id === extraId && item.projectId === projectId
    && item.timetableId === timetableId && item.purpose === 'extra')
  if (!extra) fail('not-found', 'Extra Lesson does not belong to this Timetable.')
  return safe(data, { ...data, oneOffLessons: data.oneOffLessons.filter((item) => item.id !== extraId) })
}

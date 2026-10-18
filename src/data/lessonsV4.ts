import { isCurrentAppData } from './validators/current'
import { subjectChoiceAllowed } from '../lib/subjects'
import { assertLessonTimetable, selectedTimetableId } from './timetableCompatibility'
import type { AppDataV4, DayOfWeek, RecurringLesson, WeekPattern } from '../types'

export interface LessonDraftV4 {
  projectId: string
  timetableId?: string
  schoolId: string
  teachingUnitId: string
  subjectId: string
  classId: string
  day: DayOfWeek
  periodId: number
  weekPattern: WeekPattern
  room?: string
}

function rangesOverlap(left: RecurringLesson, right: RecurringLesson) {
  const leftEnd = left.effectiveEnd ?? '9999-12-31'
  const rightEnd = right.effectiveEnd ?? '9999-12-31'
  return left.effectiveStart <= rightEnd && right.effectiveStart <= leftEnd
}

function weekPatternsOverlap(left: WeekPattern, right: WeekPattern) {
  return left === 'every' || right === 'every' || left === right
}

function validateDraft(data: AppDataV4, draft: LessonDraftV4, previous?: RecurringLesson) {
  const project = data.projects.find((item) => item.id === draft.projectId)
  const school = data.schools.find((item) => item.id === draft.schoolId)
  const unit = data.teachingUnits.find((item) => item.id === draft.teachingUnitId)
  const schoolClass = data.classes.find((item) => item.id === draft.classId)
  if (!project || project.archivedAt) throw new Error('Archived or missing projects are read-only')
  if (!school || school.projectId !== project.id || !unit || unit.projectId !== project.id || unit.schoolId !== school.id) throw new Error('School and teaching unit do not belong to the project')
  if (!subjectChoiceAllowed(data.subjects.find((item) => item.id === draft.subjectId), unit.schoolLevel, unit.id, previous)) throw new Error('Subject does not apply to this school level')
  if (!schoolClass || schoolClass.projectId !== project.id || schoolClass.teachingUnitId !== unit.id) throw new Error('Class does not belong to the teaching unit')
  if (!unit.periods.some((item) => item.id === draft.periodId)) throw new Error('Period does not belong to the teaching unit')
  if (![1, 2, 3, 4, 5].includes(draft.day)) throw new Error('Weekday is invalid')
  if (!['every', 'A', 'B'].includes(draft.weekPattern) || (!unit.weekCycle.enabled && draft.weekPattern !== 'every')) throw new Error('Week pattern is invalid for the teaching unit')
  return { project, unit }
}

function assertNoConflict(data: AppDataV4, candidate: RecurringLesson, excludedId?: string) {
  const conflict = data.recurringLessons.find((item) => item.id !== excludedId
    && item.projectId === candidate.projectId && item.teachingUnitId === candidate.teachingUnitId
    && (data.schemaVersion !== 6 || item.timetableId === candidate.timetableId)
    && item.day === candidate.day && item.periodId === candidate.periodId
    && weekPatternsOverlap(item.weekPattern, candidate.weekPattern) && rangesOverlap(item, candidate))
  if (conflict) throw new Error('A conflicting recurring lesson already exists')
}

function assertValidResult(value: AppDataV4) {
  if (!isCurrentAppData(value)) throw new Error('Lesson operation produced invalid AppData')
  return value
}

export function addLessonV4(data: AppDataV4, draft: LessonDraftV4, createId: () => string): AppDataV4 {
  const { unit } = validateDraft(data, draft)
  const timetableId = selectedTimetableId(data, draft.projectId, draft.timetableId)
  const id = createId()
  const lesson: RecurringLesson = {
    id,
    seriesId: id,
    projectId: draft.projectId,
    ...(timetableId && { timetableId }),
    teachingUnitId: draft.teachingUnitId,
    subjectId: draft.subjectId,
    classId: draft.classId,
    day: draft.day,
    periodId: draft.periodId,
    weekPattern: draft.weekPattern,
    effectiveStart: unit.startDate,
    effectiveEnd: unit.endDate,
    room: draft.room?.trim() || undefined,
    origin: 'user',
  }
  assertNoConflict(data, lesson)
  return assertValidResult({ ...data, activeProjectId: draft.projectId, recurringLessons: [...data.recurringLessons, lesson] })
}

export function updateLessonV4(data: AppDataV4, lessonId: string, draft: LessonDraftV4): AppDataV4 {
  const existing = data.recurringLessons.find((item) => item.id === lessonId)
  if (!existing) throw new Error('Lesson does not exist')
  const timetableId = assertLessonTimetable(data, lessonId, draft.timetableId)
  if (existing.projectId !== draft.projectId) throw new Error('Lesson cannot change project')
  if (selectedTimetableId(data, draft.projectId, draft.timetableId) !== timetableId) throw new Error('Lesson cannot change timetable')
  if (data.recurringLessons.some((item) => item.seriesId === existing.seriesId && item.effectiveStart > existing.effectiveStart)) throw new Error('Historical lesson versions are read-only')
  const { unit } = validateDraft(data, draft, existing)
  const hasOverrides = data.overrides.some((item) => item.originalLessonId === lessonId)
  const structuralChange = existing.projectId !== draft.projectId || existing.teachingUnitId !== draft.teachingUnitId
    || existing.day !== draft.day || existing.periodId !== draft.periodId || existing.weekPattern !== draft.weekPattern
  if (hasOverrides && structuralChange) throw new Error('Lesson has date-specific overrides and cannot be moved safely')
  const lesson: RecurringLesson = {
    ...existing,
    projectId: draft.projectId,
    teachingUnitId: draft.teachingUnitId,
    subjectId: draft.subjectId,
    classId: draft.classId,
    day: draft.day,
    periodId: draft.periodId,
    weekPattern: draft.weekPattern,
    effectiveStart: existing.teachingUnitId === unit.id ? existing.effectiveStart : unit.startDate,
    effectiveEnd: existing.teachingUnitId === unit.id ? existing.effectiveEnd : unit.endDate,
    room: draft.room?.trim() || undefined,
    origin: 'user',
  }
  assertNoConflict(data, lesson, lessonId)
  return assertValidResult({
    ...data,
    activeProjectId: draft.projectId,
    recurringLessons: data.recurringLessons.map((item) => item.id === lessonId ? lesson : item),
  })
}

export function deleteLessonV4(data: AppDataV4, lessonId: string, timetableId?: string): AppDataV4 {
  const lesson = data.recurringLessons.find((item) => item.id === lessonId)
  if (!lesson) throw new Error('Lesson does not exist')
  assertLessonTimetable(data, lessonId, timetableId)
  const project = data.projects.find((item) => item.id === lesson.projectId)
  if (!project || project.archivedAt) throw new Error('Archived or missing projects are read-only')
  if (data.overrides.some((item) => item.originalLessonId === lessonId)) throw new Error('Lesson has date-specific overrides')
  if (data.recurringLessons.filter((item) => item.seriesId === lesson.seriesId).length > 1) throw new Error('Versioned lessons cannot be deleted directly; end the current version from a date')
  return assertValidResult({ ...data, recurringLessons: data.recurringLessons.filter((item) => item.id !== lessonId) })
}

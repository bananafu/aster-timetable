import type { AppDataV9 } from '../types/v9'
import { addDays, fromDateKey, toDateKey } from '../lib/date'
import { resolveV9Day } from '../lib/scheduleV9'
import { timeIntervalsOverlap } from '../lib/scheduleV4'
import { asV8ValidationProjection, isCompatibleAppDataV9, isSafeAppDataV9Update } from './validators/v9'
import { createRecurringLessonV8, deleteRecurringLessonV8, getRecurringLessonV8Impact,
  recurringLessonAppliesV8, recurringLessonsConflictV8, updateRecurringLessonV8,
  type RecurringLessonV8Draft } from './recurringLessonsV8'

type Lesson = AppDataV9['recurringLessons'][number]
type Override = AppDataV9['overrides'][number]
export type RecurringLessonV9Draft = RecurringLessonV8Draft
export type LessonV9Scope = { projectId: string; timetableId: string; teachingUnitId: string }
export type LessonV9ErrorCode = 'invalid-document' | 'invalid-scope' | 'invalid-reference' | 'invalid-date'
  | 'invalid-draft' | 'id-collision' | 'not-found' | 'already-changed' | 'conflict' | 'referenced' | 'unsafe-update'
export class LessonV9Error extends Error {
  constructor(readonly code: LessonV9ErrorCode, message: string) { super(message); this.name = 'LessonV9Error' }
}
const fail = (code: LessonV9ErrorCode, message: string): never => { throw new LessonV9Error(code, message) }
const valid = (data: AppDataV9) => { if (!isCompatibleAppDataV9(data)) fail('invalid-document', 'Invalid V9 document.') }
const safe = (current: AppDataV9, next: AppDataV9) => {
  if (!isSafeAppDataV9Update(current, next)) fail('unsafe-update', 'Lesson mutation failed V9 safety validation.')
  return next
}
const dateValid = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key) && toDateKey(fromDateKey(key)) === key
const idAvailable = (data: AppDataV9, id: string) => !!id && id === id.trim() && ![
  ...data.projects, ...data.timetables, ...data.schools, ...data.teachingUnits, ...data.subjects,
  ...data.teachingUnitSubjects, ...data.classes, ...data.recurringLessons, ...data.events,
  ...data.overrides, ...data.oneOffLessons, ...data.teachingProgress, ...data.migrationWarnings,
].some((item) => item.id === id) && !data.recurringLessons.some((item) => item.seriesId === id)

function scope(data: AppDataV9, selected: LessonV9Scope) {
  valid(data)
  const project = data.projects.find((item) => item.id === selected.projectId)
  const timetable = data.timetables.find((item) => item.id === selected.timetableId && item.projectId === selected.projectId)
  const unit = data.teachingUnits.find((item) => item.id === selected.teachingUnitId && item.projectId === selected.projectId)
  if (!project || project.archivedAt || !timetable || !unit || project.term === null
    || !data.schools.some((item) => item.id === unit.schoolId && item.projectId === project.id)) {
    fail('invalid-scope', 'Configured editable Project, Timetable and TeachingUnit are required.')
  }
  return unit!
}
function lesson(data: AppDataV9, selected: LessonV9Scope, id: string): Lesson {
  scope(data, selected)
  const found = data.recurringLessons.find((item) => item.id === id && item.projectId === selected.projectId
    && item.timetableId === selected.timetableId && item.teachingUnitId === selected.teachingUnitId)
  if (!found) fail('not-found', 'Lesson is outside the selected scope or no longer exists.')
  return found!
}
function content(data: AppDataV9, selected: LessonV9Scope, draft: RecurringLessonV9Draft) {
  const unit = scope(data, selected)
  if (draft.projectId !== selected.projectId || draft.timetableId !== selected.timetableId
    || draft.teachingUnitId !== selected.teachingUnitId) fail('invalid-scope', 'Lesson draft changed scope.')
  const subject = data.subjects.find((item) => item.id === draft.subjectId && item.projectId === selected.projectId
    && item.timetableId === selected.timetableId)
  const schoolClass = data.classes.find((item) => item.id === draft.classId && item.projectId === selected.projectId
    && item.teachingUnitId === unit.id)
  if (!subject || !schoolClass || !subject.applicableSchoolLevels.includes(unit.schoolLevel)
    || !data.teachingUnitSubjects.some((item) => item.projectId === selected.projectId
      && item.teachingUnitId === unit.id && item.subjectId === subject.id)) {
    fail('invalid-reference', 'Subject or Class does not belong to the selected teacher and TeachingUnit.')
  }
  if (![1, 2, 3, 4, 5].includes(draft.day) || !unit.periods.some((item) => item.id === draft.periodId)
    || !['every', 'A', 'B'].includes(draft.weekPattern)
    || (!unit.weekCycle.enabled && draft.weekPattern !== 'every')
    || (draft.room !== undefined && draft.room.trim().length > 15)) fail('invalid-draft', 'Invalid slot or week pattern.')
  return unit
}
export function createRecurringLessonV9(data: AppDataV9, selected: LessonV9Scope,
  draft: RecurringLessonV9Draft, id: string): AppDataV9 {
  content(data, selected, draft)
  if (!idAvailable(data, id)) fail('id-collision', 'Lesson ID is unavailable.')
  const result = createRecurringLessonV8(asV8ValidationProjection(data), draft, id)
  return safe(data, { ...data, recurringLessons: result.recurringLessons })
}
export function updateRecurringLessonV9(data: AppDataV9, selected: LessonV9Scope,
  lessonId: string, draft: RecurringLessonV9Draft): AppDataV9 {
  const current = lesson(data, selected, lessonId)
  content(data, selected, draft)
  const changed = current.subjectId !== draft.subjectId || current.classId !== draft.classId
    || current.day !== draft.day || current.periodId !== draft.periodId
    || current.weekPattern !== draft.weekPattern || (current.room ?? '') !== (draft.room?.trim() ?? '')
  if (!changed) fail('already-changed', 'Lesson update has no changes.')
  const impact = getRecurringLessonV9Impact(data, selected, lessonId)
  if (impact.changes || impact.oneOff || impact.progress || impact.versions > 1) {
    fail('referenced', 'Lesson has occurrence changes, one-off links, progress or historical versions.')
  }
  const result = updateRecurringLessonV8(asV8ValidationProjection(data), selected.projectId,
    selected.timetableId, lessonId, draft)
  return safe(data, { ...data, recurringLessons: result.recurringLessons })
}
export function getRecurringLessonV9Impact(data: AppDataV9, selected: LessonV9Scope, lessonId: string) {
  lesson(data, selected, lessonId)
  return getRecurringLessonV8Impact(asV8ValidationProjection(data), selected.projectId,
    selected.timetableId, lessonId)
}
/** Isolated domain operation; the formal controller requires backup evidence before exposing deletion. */
export function deleteRecurringLessonV9(data: AppDataV9, selected: LessonV9Scope,
  lessonId: string, confirmed: true): AppDataV9 {
  lesson(data, selected, lessonId)
  const result = deleteRecurringLessonV8(asV8ValidationProjection(data), selected.projectId,
    selected.timetableId, lessonId, confirmed)
  return safe(data, { ...data, recurringLessons: result.recurringLessons })
}

function occurrence(data: AppDataV9, selected: LessonV9Scope, lessonId: string, date: string) {
  const current = lesson(data, selected, lessonId)
  const unit = scope(data, selected)
  if (!dateValid(date) || date < unit.startDate || date > unit.endDate
    || date < current.effectiveStart || date > (current.effectiveEnd ?? unit.endDate)) {
    fail('invalid-date', 'Occurrence is outside the Lesson version or TeachingUnit term.')
  }
  const found = resolveV9Day(data, selected, fromDateKey(date)).find((item) => item.kind === 'recurring'
    && item.id === current.id && item.sourceDate === date)
  if (!found) fail('invalid-date', 'Lesson does not occur on the selected date or week pattern.')
  if (data.overrides.some((item) => item.originalLessonId === lessonId && item.date === date)) {
    fail('already-changed', 'Occurrence already has an override.')
  }
  return current
}
function addOverride(data: AppDataV9, selected: LessonV9Scope, lessonId: string,
  date: string, id: string, change: Pick<Override, 'action' | 'target' | 'replacement'>): AppDataV9 {
  const current = occurrence(data, selected, lessonId, date)
  if (!idAvailable(data, id)) fail('id-collision', 'Override ID is unavailable.')
  const override: Override = { id, projectId: selected.projectId, timetableId: selected.timetableId,
    teachingUnitId: selected.teachingUnitId, date, periodId: current.periodId,
    originalLessonId: current.id, action: change.action, ...(change.target && { target: change.target }),
    ...(change.replacement && { replacement: change.replacement }), origin: 'user' }
  return safe(data, { ...data, overrides: [...data.overrides, override] })
}
export function cancelOccurrenceV9(data: AppDataV9, selected: LessonV9Scope,
  lessonId: string, date: string, id: string): AppDataV9 {
  return addOverride(data, selected, lessonId, date, id, { action: 'cancel' })
}
export function replaceOccurrenceV9(data: AppDataV9, selected: LessonV9Scope,
  lessonId: string, date: string, replacement: NonNullable<Override['replacement']>, id: string): AppDataV9 {
  const unit = scope(data, selected)
  const subject = data.subjects.find((item) => item.id === replacement.subjectId
    && item.projectId === selected.projectId && item.timetableId === selected.timetableId)
  const schoolClass = data.classes.find((item) => item.id === replacement.classId
    && item.projectId === selected.projectId && item.teachingUnitId === selected.teachingUnitId)
  if (!subject || !schoolClass || !subject.applicableSchoolLevels.includes(unit.schoolLevel)
    || !data.teachingUnitSubjects.some((item) => item.projectId === selected.projectId
      && item.teachingUnitId === unit.id && item.subjectId === subject.id)
    || (replacement.room !== undefined && replacement.room.trim().length > 15)) {
    fail('invalid-reference', 'Replacement content is outside the selected scope.')
  }
  return addOverride(data, selected, lessonId, date, id, { action: 'replace',
    replacement: { ...replacement, room: replacement.room?.trim() || undefined } })
}
export function moveOccurrenceV9(data: AppDataV9, selected: LessonV9Scope,
  lessonId: string, date: string, target: { date: string; periodId: number }, id: string): AppDataV9 {
  occurrence(data, selected, lessonId, date)
  const unit = scope(data, selected)
  const period = unit.periods.find((item) => item.id === target.periodId)
  if (!dateValid(target.date) || target.date < unit.startDate || target.date > unit.endDate || !period) {
    fail('invalid-date', 'Move target must be inside the original TeachingUnit term and use its period.')
  }
  const occupied = resolveV9Day(data, selected, fromDateKey(target.date)).some((item) =>
    (item.kind === 'one-off' || (item.status !== 'cancelled' && item.movementRole !== 'source'))
    && timeIntervalsOverlap(item, period!))
  if (occupied) fail('conflict', 'Move target overlaps another active lesson.')
  return addOverride(data, selected, lessonId, date, id, { action: 'move', target })
}
export function revokeOccurrenceOverrideV9(data: AppDataV9, selected: LessonV9Scope,
  overrideId: string): AppDataV9 {
  scope(data, selected)
  const found = data.overrides.find((item) => item.id === overrideId && item.projectId === selected.projectId
    && item.timetableId === selected.timetableId && item.teachingUnitId === selected.teachingUnitId)
  if (!found) fail('not-found', 'Override is outside the selected scope or no longer exists.')
  if (!found!.originalLessonId || !data.recurringLessons.some((item) => item.id === found!.originalLessonId
    && item.projectId === selected.projectId && item.timetableId === selected.timetableId
    && item.teachingUnitId === selected.teachingUnitId)) fail('referenced', 'Override ownership is unresolved.')
  if (found!.groupId) fail('referenced', 'Grouped override requires a separate atomic group operation.')
  return safe(data, { ...data, overrides: data.overrides.filter((item) => item.id !== overrideId) })
}

/** Isolated split; formal activation is blocked until operation-level backup evidence exists. */
export function permanentlyUpdateLessonV9(data: AppDataV9, selected: LessonV9Scope,
  lessonId: string, date: string, draft: RecurringLessonV9Draft, newId: string): AppDataV9 {
  const current = lesson(data, selected, lessonId)
  const unit = content(data, selected, draft)
  if (!dateValid(date) || date <= current.effectiveStart || date > (current.effectiveEnd ?? unit.endDate)
    || date < unit.startDate || date > unit.endDate) fail('invalid-date', 'Effective date must split the current version within its term.')
  const projected = asV8ValidationProjection(data)
  if (!recurringLessonAppliesV8(projected, current, fromDateKey(date))
    || data.overrides.some((item) => item.originalLessonId === lessonId && item.date === date)) {
    fail('invalid-date', 'Effective date must be an unchanged occurrence of the current Lesson.')
  }
  if (data.recurringLessons.some((item) => item.seriesId === current.seriesId && item.effectiveStart > current.effectiveStart)) {
    fail('referenced', 'Historical Lesson version cannot be split again.')
  }
  if (!idAvailable(data, newId)) fail('id-collision', 'New Lesson version ID is unavailable.')
  const next: Lesson = { ...current, ...draft, id: newId, seriesId: current.seriesId,
    effectiveStart: date, effectiveEnd: current.effectiveEnd, room: draft.room?.trim() || undefined, origin: 'user' }
  if (data.overrides.some((item) => item.originalLessonId === lessonId && item.date >= date
    && (item.periodId !== next.periodId || !recurringLessonAppliesV8(projected, next, fromDateKey(item.date))))) {
    fail('referenced', 'Future override would not belong to the new Lesson occurrence.')
  }
  if (data.recurringLessons.some((item) => item.id !== current.id
    && recurringLessonsConflictV8(projected, item, next))) fail('conflict', 'New Lesson version conflicts with another lesson.')
  const previousEnd = toDateKey(addDays(fromDateKey(date), -1))
  const recurringLessons = data.recurringLessons.flatMap((item) => item.id === lessonId
    ? [{ ...item, effectiveEnd: previousEnd }, next] : [item])
  const overrides = data.overrides.map((item) => item.originalLessonId === lessonId && item.date >= date
    ? { ...item, originalLessonId: newId } : item)
  return safe(data, { ...data, recurringLessons, overrides })
}

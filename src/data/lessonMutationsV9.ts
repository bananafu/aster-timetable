import type { AppDataV9 } from '../types/v9'
import { addDays, fromDateKey, toDateKey } from '../lib/date'
import { resolveV9Day, type V9ReadOccurrence } from '../lib/scheduleV9'
import { timeIntervalsOverlap } from '../lib/scheduleV4'
import { asV8ValidationProjection, isCompatibleAppDataV9, isSafeAppDataV9Update } from './validators/v9'
import { createRecurringLessonV8, deleteRecurringLessonV8, getRecurringLessonV8Impact,
  recurringLessonAppliesV8, recurringLessonsConflictV8, updateRecurringLessonV8,
  type RecurringLessonV8Draft } from './recurringLessonsV8'

type Lesson = AppDataV9['recurringLessons'][number]
type Override = AppDataV9['overrides'][number]
export type RecurringLessonV9Draft = RecurringLessonV8Draft
export type LessonV9Scope = { projectId: string; timetableId: string; teachingUnitId: string }
type OneOffLesson = AppDataV9['oneOffLessons'][number]
type RecurringOccurrence = Extract<V9ReadOccurrence, { kind: 'recurring' }>
export type OneOffLessonV9Draft = Omit<OneOffLesson, 'id'>
export type OccurrenceChangeV9Draft =
  | { action: 'cancel' }
  | { action: 'move'; target: { date: string; periodId: number }; allowConflict?: boolean }
  | { action: 'replace'; replacement: { subjectId: string; classId: string; room?: string } }
export type SwapOccurrencesV9Draft = {
  firstLessonId: string
  firstDate: string
  secondLessonId: string
  secondDate: string
}
export type SwapGroupV9Ids = {
  groupId: string
  firstOverrideId: string
  secondOverrideId: string
}
export type LessonV9ErrorCode = 'invalid-document' | 'invalid-scope' | 'invalid-reference' | 'invalid-date'
  | 'invalid-draft' | 'id-collision' | 'not-found' | 'already-changed' | 'conflict' | 'referenced' | 'unsafe-update'
export class LessonV9Error extends Error {
  constructor(readonly code: LessonV9ErrorCode, message: string) { super(message); this.name = 'LessonV9Error' }
}
export class OneOffLessonConflictV9Error extends LessonV9Error {
  constructor(readonly conflicts: readonly V9ReadOccurrence[]) {
    super('conflict', `One-off Lesson overlaps ${conflicts.length} active lesson(s).`)
    this.name = 'OneOffLessonConflictV9Error'
  }
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

const fiveMinuteTime = (value: string) => /^([01]\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$/.test(value)
const uuidV4 = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

function oneOffContent(data: AppDataV9, selected: LessonV9Scope, draft: OneOffLessonV9Draft,
  editingId?: string) {
  valid(data)
  const project = data.projects.find((item) => item.id === selected.projectId)
  const timetable = data.timetables.find((item) => item.id === selected.timetableId
    && item.projectId === selected.projectId)
  const unit = data.teachingUnits.find((item) => item.id === draft.teachingUnitId
    && item.projectId === selected.projectId)
  const original = editingId ? data.oneOffLessons.find((item) => item.id === editingId) : undefined
  if (!project || project.archivedAt || project.term === null || !timetable || !unit
    || !data.schools.some((item) => item.id === unit.schoolId && item.projectId === project.id)) {
    fail('invalid-scope', 'Configured editable Project, Timetable and TeachingUnit are required.')
  }
  if (draft.projectId !== selected.projectId || draft.timetableId !== selected.timetableId
    || draft.teachingUnitId !== selected.teachingUnitId) fail('invalid-scope', 'One-off Lesson draft changed scope.')
  if (editingId && !original) fail('not-found', 'One-off Lesson no longer exists.')
  if (original && (original.projectId !== selected.projectId || original.timetableId !== selected.timetableId)) {
    fail('invalid-scope', 'One-off Lesson cannot move across Projects or Timetables.')
  }
  const subject = data.subjects.find((item) => item.id === draft.subjectId
    && item.projectId === selected.projectId && item.timetableId === selected.timetableId)
  const schoolClass = data.classes.find((item) => item.id === draft.classId
    && item.projectId === selected.projectId && item.teachingUnitId === unit!.id)
  if (!subject || !schoolClass || !subject.applicableSchoolLevels.includes(unit!.schoolLevel)
    || !data.teachingUnitSubjects.some((item) => item.projectId === selected.projectId
      && item.teachingUnitId === unit!.id && item.subjectId === subject.id)) {
    fail('invalid-reference', 'Subject or Class does not belong to the selected teacher and TeachingUnit.')
  }
  if (!dateValid(draft.date) || draft.date < unit!.startDate || draft.date > unit!.endDate) {
    fail('invalid-date', 'One-off Lesson date is outside the selected TeachingUnit term.')
  }
  if (!['extra', 'make-up', 'substitute'].includes(draft.purpose)) fail('invalid-draft', 'Invalid one-off Lesson purpose.')
  if (draft.relatedRecurringLessonId !== undefined) {
    if (draft.purpose !== 'make-up' || !draft.relatedRecurringLessonId.trim()) {
      fail('invalid-reference', 'Only a make-up Lesson may reference a recurring Lesson.')
    }
    const source = data.recurringLessons.find((item) => item.id === draft.relatedRecurringLessonId)
    if (source && (source.projectId !== selected.projectId || source.timetableId !== selected.timetableId)) {
      fail('invalid-reference', 'Make-up source belongs to another Project or Timetable.')
    }
  }
  if (draft.room !== undefined && typeof draft.room !== 'string') fail('invalid-draft', 'Invalid room.')
  if (draft.time.mode === 'period') {
    const period = unit!.periods.find((item) => item.id === draft.time.periodId)
    if (!period) fail('invalid-draft', 'Period does not belong to the selected TeachingUnit.')
    return { startTime: period!.startTime, endTime: period!.endTime }
  }
  if (draft.time.mode !== 'custom' || !fiveMinuteTime(draft.time.startTime)
    || !fiveMinuteTime(draft.time.endTime) || draft.time.endTime <= draft.time.startTime) {
    fail('invalid-draft', 'Custom time must use five-minute intervals and cannot cross midnight.')
  }
  return { startTime: draft.time.startTime, endTime: draft.time.endTime }
}

export function getOneOffLessonConflictsV9(data: AppDataV9, selected: LessonV9Scope,
  draft: OneOffLessonV9Draft, editingId?: string): readonly V9ReadOccurrence[] {
  const time = oneOffContent(data, selected, draft, editingId)
  return resolveV9Day(data, selected, fromDateKey(draft.date))
    .filter((item) => (item.kind === 'one-off' || (item.status !== 'cancelled' && item.movementRole !== 'source'))
      && !(editingId && item.kind === 'one-off' && item.id === editingId)
      && timeIntervalsOverlap(item, time))
}

export function createOneOffLessonV9(data: AppDataV9, selected: LessonV9Scope,
  draft: OneOffLessonV9Draft, id: string, allowConflict = false): AppDataV9 {
  const conflicts = getOneOffLessonConflictsV9(data, selected, draft)
  if (conflicts.length && allowConflict !== true) throw new OneOffLessonConflictV9Error(conflicts)
  if (!uuidV4(id) || !idAvailable(data, id)) fail('id-collision', 'One-off Lesson ID must be an unused UUID.')
  const next: OneOffLesson = { ...draft, id, room: draft.room?.trim() || undefined, time: { ...draft.time } }
  return safe(data, { ...data, oneOffLessons: [...data.oneOffLessons, next] })
}

export function updateOneOffLessonV9(data: AppDataV9, selected: LessonV9Scope,
  oneOffId: string, draft: OneOffLessonV9Draft, allowConflict = false): AppDataV9 {
  const conflicts = getOneOffLessonConflictsV9(data, selected, draft, oneOffId)
  if (conflicts.length && allowConflict !== true) throw new OneOffLessonConflictV9Error(conflicts)
  return safe(data, { ...data, oneOffLessons: data.oneOffLessons.map((item) => item.id === oneOffId
    ? { ...draft, id: item.id, room: draft.room?.trim() || undefined, time: { ...draft.time } } : item) })
}

export function deleteOneOffLessonV9(data: AppDataV9, selected: LessonV9Scope,
  oneOffId: string, confirmed: true): AppDataV9 {
  valid(data)
  const project = data.projects.find((item) => item.id === selected.projectId)
  const found = data.oneOffLessons.find((item) => item.id === oneOffId
    && item.projectId === selected.projectId && item.timetableId === selected.timetableId)
  if (!project || project.archivedAt || project.term === null) fail('invalid-scope', 'Project is unavailable or read-only.')
  if (!found) fail('not-found', 'One-off Lesson is outside the selected scope or no longer exists.')
  if (confirmed !== true) fail('invalid-draft', 'One-off Lesson deletion requires confirmation.')
  return safe(data, { ...data, oneOffLessons: data.oneOffLessons.filter((item) => item.id !== oneOffId) })
}

function occurrenceDetails(data: AppDataV9, selected: LessonV9Scope, lessonId: string, date: string) {
  const current = lesson(data, selected, lessonId)
  const unit = scope(data, selected)
  if (!dateValid(date) || date < unit.startDate || date > unit.endDate
    || date < current.effectiveStart || date > (current.effectiveEnd ?? unit.endDate)) {
    fail('invalid-date', 'Occurrence is outside the Lesson version or TeachingUnit term.')
  }
  const found = resolveV9Day(data, selected, fromDateKey(date)).find((item): item is RecurringOccurrence =>
    item.kind === 'recurring' && item.id === current.id && item.sourceDate === date)
  if (!found) return fail('invalid-date', 'Lesson does not occur on the selected date or week pattern.')
  if (data.overrides.some((item) => item.originalLessonId === lessonId && item.date === date)) {
    fail('already-changed', 'Occurrence already has an override.')
  }
  if (found.kind !== 'recurring' || found.status !== 'regular' || found.overrideId || found.movementRole) {
    fail('already-changed', 'Occurrence already has an override.')
  }
  return { lesson: current, occurrence: found }
}
function occurrence(data: AppDataV9, selected: LessonV9Scope, lessonId: string, date: string) {
  return occurrenceDetails(data, selected, lessonId, date).lesson
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
  lessonId: string, date: string, target: { date: string; periodId: number }, id: string,
  allowConflict = false): AppDataV9 {
  const current = occurrence(data, selected, lessonId, date)
  const unit = scope(data, selected)
  const period = unit.periods.find((item) => item.id === target.periodId)
  if (!dateValid(target.date) || target.date < unit.startDate || target.date > unit.endDate || !period) {
    fail('invalid-date', 'Move target must be inside the original TeachingUnit term and use its period.')
  }
  const occupied = resolveV9Day(data, selected, fromDateKey(target.date)).some((item) =>
    (item.kind === 'one-off' || (item.status !== 'cancelled' && item.movementRole !== 'source'))
    && !(target.date === date && item.kind === 'recurring' && item.id === current.id
      && item.sourceDate === date && item.movementRole !== 'target')
    && timeIntervalsOverlap(item, period!))
  if (occupied && allowConflict !== true) fail('conflict', 'Move target overlaps another active lesson.')
  return addOverride(data, selected, lessonId, date, id, { action: 'move', target })
}

function assertFreshSwapIds(data: AppDataV9, ids: SwapGroupV9Ids) {
  const values = [ids.groupId, ids.firstOverrideId, ids.secondOverrideId]
  if (values.some((id) => !id || id !== id.trim()) || new Set(values).size !== values.length
    || values.some((id) => !idAvailable(data, id))
    || data.overrides.some((item) => item.groupId === ids.groupId)) {
    fail('id-collision', 'Swap group and Override IDs must be distinct and unused.')
  }
}

function resolvedSwapTarget(data: AppDataV9, selected: LessonV9Scope, override: Override) {
  return override.target && resolveV9Day(data, selected, fromDateKey(override.target.date))
    .find((item): item is RecurringOccurrence => item.kind === 'recurring' && item.overrideId === override.id
      && item.movementRole === 'target' && item.id === override.originalLessonId)
}

/** Builds both reciprocal move overrides in one validated V9 candidate document. */
export function swapOccurrencesV9(data: AppDataV9, selected: LessonV9Scope,
  draft: SwapOccurrencesV9Draft, ids: SwapGroupV9Ids): AppDataV9 {
  if (draft.firstLessonId === draft.secondLessonId) fail('invalid-draft', 'Two different Lessons are required.')
  assertFreshSwapIds(data, ids)
  const first = occurrenceDetails(data, selected, draft.firstLessonId, draft.firstDate)
  const second = occurrenceDetails(data, selected, draft.secondLessonId, draft.secondDate)
  if (first.lesson.projectId !== second.lesson.projectId
    || first.lesson.timetableId !== second.lesson.timetableId
    || first.lesson.teachingUnitId !== second.lesson.teachingUnitId) {
    fail('invalid-scope', 'Swap Lessons must belong to the same Project, Timetable and TeachingUnit.')
  }
  const overrides: [Override, Override] = [
    { id: ids.firstOverrideId, groupId: ids.groupId, projectId: selected.projectId,
      timetableId: selected.timetableId, teachingUnitId: selected.teachingUnitId,
      date: draft.firstDate, periodId: first.occurrence.periodId, action: 'move',
      originalLessonId: first.lesson.id,
      target: { date: draft.secondDate, periodId: second.occurrence.periodId }, origin: 'user' },
    { id: ids.secondOverrideId, groupId: ids.groupId, projectId: selected.projectId,
      timetableId: selected.timetableId, teachingUnitId: selected.teachingUnitId,
      date: draft.secondDate, periodId: second.occurrence.periodId, action: 'move',
      originalLessonId: second.lesson.id,
      target: { date: draft.firstDate, periodId: first.occurrence.periodId }, origin: 'user' },
  ]
  const next = safe(data, { ...data, overrides: [...data.overrides, ...overrides] })
  for (const override of overrides) {
    const target = resolvedSwapTarget(next, selected, override)
    if (!target) return fail('unsafe-update', 'Swap target could not be resolved from the complete group.')
    if (target.hasConflict) fail('conflict', 'Swap target overlaps another active Lesson or OneOff Lesson.')
  }
  return next
}

/** Accepts only an exact, reciprocal two-member swap group in the selected scope. */
export function validateSwapGroupV9(data: AppDataV9, selected: LessonV9Scope,
  overrideId: string): readonly [Override, Override] {
  scope(data, selected)
  const anchor = data.overrides.find((item) => item.id === overrideId
    && item.projectId === selected.projectId && item.timetableId === selected.timetableId
    && item.teachingUnitId === selected.teachingUnitId)
  if (!anchor?.groupId) return fail('not-found', 'Swap group is outside the selected scope or no longer exists.')
  const groupId = anchor.groupId
  const members = data.overrides.filter((item) => item.groupId === groupId)
  if (members.length !== 2) fail('referenced', 'Swap group must contain exactly two Overrides.')
  const [first, second] = members
  if (first.action !== 'move' || second.action !== 'move' || !first.target || !second.target
    || !first.originalLessonId || !second.originalLessonId
    || first.id === second.id || first.originalLessonId === second.originalLessonId
    || members.some((item) => item.projectId !== selected.projectId
      || item.timetableId !== selected.timetableId || item.teachingUnitId !== selected.teachingUnitId)
    || first.target.date !== second.date || first.target.periodId !== second.periodId
    || second.target.date !== first.date || second.target.periodId !== first.periodId) {
    fail('referenced', 'Swap group is incomplete or not reciprocal.')
  }
  for (const member of members) {
    const source = resolveV9Day(data, selected, fromDateKey(member.date)).find((item) =>
      item.kind === 'recurring' && item.overrideId === member.id && item.movementRole === 'source'
      && item.id === member.originalLessonId && item.periodId === member.periodId)
    const target = resolvedSwapTarget(data, selected, member)
    if (!source || !target) fail('referenced', 'Swap group cannot resolve both source and target occurrences.')
  }
  return [first, second]
}

export function revokeSwapGroupV9(data: AppDataV9, selected: LessonV9Scope,
  overrideId: string): AppDataV9 {
  const group = validateSwapGroupV9(data, selected, overrideId)
  const removed = new Set(group.map((item) => item.id))
  const next = safe(data, { ...data, overrides: data.overrides.filter((item) => !removed.has(item.id)) })
  for (const item of group) assertOccurrenceHasNoConflict(next, selected, item.originalLessonId!, item.date)
  return next
}

export function replaceSwapGroupV9(data: AppDataV9, selected: LessonV9Scope,
  overrideId: string, draft: SwapOccurrencesV9Draft, ids: SwapGroupV9Ids): AppDataV9 {
  const group = validateSwapGroupV9(data, selected, overrideId)
  const removed = new Set(group.map((item) => item.id))
  const base = { ...data, overrides: data.overrides.filter((item) => !removed.has(item.id)) }
  return safe(data, swapOccurrencesV9(base, selected, draft, ids))
}

function selectedOverride(data: AppDataV9, selected: LessonV9Scope, overrideId: string): Override {
  scope(data, selected)
  const found = data.overrides.find((item) => item.id === overrideId && item.projectId === selected.projectId
    && item.timetableId === selected.timetableId && item.teachingUnitId === selected.teachingUnitId)
  if (!found) fail('not-found', 'Override is outside the selected scope or no longer exists.')
  if (!found!.originalLessonId || !data.recurringLessons.some((item) => item.id === found!.originalLessonId
    && item.projectId === selected.projectId && item.timetableId === selected.timetableId
    && item.teachingUnitId === selected.teachingUnitId)) fail('referenced', 'Override ownership is unresolved.')
  if (found!.groupId) fail('referenced', 'Grouped override requires a separate atomic group operation.')
  return found!
}

function assertOccurrenceHasNoConflict(data: AppDataV9, selected: LessonV9Scope,
  lessonId: string, date: string) {
  const restored = resolveV9Day(data, selected, fromDateKey(date)).find((item) => item.kind === 'recurring'
    && item.id === lessonId && item.sourceDate === date && item.movementRole !== 'target')
  if (!restored) return fail('referenced', 'The original Lesson occurrence cannot be resolved after the change.')
  if (restored.hasConflict) fail('conflict', 'The restored Lesson occurrence overlaps another active lesson.')
}

export function revokeOccurrenceOverrideV9(data: AppDataV9, selected: LessonV9Scope,
  overrideId: string): AppDataV9 {
  const found = selectedOverride(data, selected, overrideId)
  const next = safe(data, { ...data, overrides: data.overrides.filter((item) => item.id !== overrideId) })
  assertOccurrenceHasNoConflict(next, selected, found.originalLessonId!, found.date)
  return next
}

function sameOccurrenceChange(found: Override, change: OccurrenceChangeV9Draft) {
  if (found.action !== change.action) return false
  if (change.action === 'cancel') return true
  if (change.action === 'move') return found.target?.date === change.target.date
    && found.target?.periodId === change.target.periodId
  return found.replacement?.subjectId === change.replacement.subjectId
    && found.replacement.classId === change.replacement.classId
    && (found.replacement.room?.trim() ?? '') === (change.replacement.room?.trim() ?? '')
}

/** Replaces one non-grouped occurrence override atomically while keeping its Lesson and source date fixed. */
export function replaceOccurrenceChangeV9(data: AppDataV9, selected: LessonV9Scope,
  overrideId: string, change: OccurrenceChangeV9Draft, newId: string): AppDataV9 {
  const found = selectedOverride(data, selected, overrideId)
  if (newId === overrideId) fail('id-collision', 'Replacement override requires a new ID.')
  if (sameOccurrenceChange(found, change)) fail('already-changed', 'Occurrence change has no semantic changes.')
  const base = { ...data, overrides: data.overrides.filter((item) => item.id !== overrideId) }
  const lessonId = found.originalLessonId!
  let next: AppDataV9
  if (change.action === 'cancel') {
    next = cancelOccurrenceV9(base, selected, lessonId, found.date, newId)
  } else if (change.action === 'replace') {
    next = replaceOccurrenceV9(base, selected, lessonId, found.date, change.replacement, newId)
    assertOccurrenceHasNoConflict(next, selected, lessonId, found.date)
  } else {
    next = moveOccurrenceV9(base, selected, lessonId, found.date, change.target, newId,
      change.allowConflict === true)
  }
  return safe(data, next)
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

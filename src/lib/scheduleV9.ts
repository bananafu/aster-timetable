import { classDisplayName } from './classes'
import { fromDateKey, toDateKey } from './date'
import { getTeachingUnitWeekPattern, timeIntervalsOverlap } from './scheduleV4'
import { isCompatibleAppDataV9 } from '../data/validators/v9'
import type { ResolvedCalendarEventV8, TeachingUnit } from '../types'
import type { AppDataV9, ProjectV9, SubjectV9 } from '../types/v9'

export type V9ReadScope = Readonly<{
  projectId: string | null
  timetableId: string | null
  /** Header context only; it never narrows the total timetable. */
  teachingUnitId: string | null
}>

export type V9ReadFilters = Readonly<{ schoolId?: string; teachingUnitId?: string }>
export type V9ReadStatus = 'ready' | 'invalid-document' | 'invalid-scope' | 'unset-term'
export type V9ReadResult<T> = Readonly<{ status: V9ReadStatus; value: T }>

type OccurrenceBase = {
  occurrenceId: string
  id: string
  projectId: string
  timetableId: string
  teachingUnitId: string
  schoolId: string
  schoolName: string
  schoolColor: string
  teachingUnitName: string
  subjectId: string
  subjectName: string
  subjectColor: string
  classId: string
  className: string
  date: string
  startTime: string
  endTime: string
  room?: string
  hasConflict: boolean
}

export type V9ReadOccurrence = Readonly<OccurrenceBase & (
  | { kind: 'recurring'; seriesId: string; sourceDate: string; periodId: number; periodLabel: string;
    status: 'regular' | 'cancelled' | 'replaced' | 'moved'; movementRole?: 'source' | 'target';
    overrideId?: string; groupId?: string; note?: string }
  | { kind: 'one-off'; purpose: 'extra' | 'make-up' | 'substitute'; relatedRecurringLessonId?: string;
    timeMode: 'period'; periodId: number; periodLabel: string }
  | { kind: 'one-off'; purpose: 'extra' | 'make-up' | 'substitute'; relatedRecurringLessonId?: string;
    timeMode: 'custom' }
)>

export type V9ReadDay = Readonly<{ date: Date; lessons: readonly V9ReadOccurrence[] }>
type ReadContext = { project: ProjectV9; projectId: string; timetableId: string; unit?: TeachingUnit }
type Lesson = AppDataV9['recurringLessons'][number]
type ContextResult = Readonly<
  | { status: 'ready'; context: ReadContext }
  | { status: Exclude<V9ReadStatus, 'ready'>; context: null }
>

function context(data: AppDataV9, scope: V9ReadScope): ContextResult {
  if (!isCompatibleAppDataV9(data)) return { status: 'invalid-document', context: null }
  if (!scope.projectId) return { status: 'invalid-scope', context: null }
  const project = data.projects.find((item) => item.id === scope.projectId)
  if (!project) return { status: 'invalid-scope', context: null }
  const unit = scope.teachingUnitId === null ? undefined
    : data.teachingUnits.find((item) => item.id === scope.teachingUnitId && item.projectId === project.id)
  if (scope.teachingUnitId !== null && !unit) return { status: 'invalid-scope', context: null }
  const timetable = scope.timetableId === null ? undefined
    : data.timetables.find((item) => item.id === scope.timetableId && item.projectId === project.id)
  if (scope.timetableId !== null && !timetable) return { status: 'invalid-scope', context: null }
  if (project.term === null) return { status: 'unset-term', context: null }
  if (!timetable) return { status: 'invalid-scope', context: null }
  return { status: 'ready', context: { project, projectId: project.id, timetableId: timetable.id, unit } }
}

function eligibleUnit(data: AppDataV9, ctx: ReadContext, filters: V9ReadFilters): TeachingUnit[] {
  if (filters.schoolId && !data.schools.some((item) => item.id === filters.schoolId && item.projectId === ctx.projectId)) return []
  if (filters.teachingUnitId && !data.teachingUnits.some((item) => item.id === filters.teachingUnitId
    && item.projectId === ctx.projectId && (!filters.schoolId || item.schoolId === filters.schoolId))) return []
  return data.teachingUnits.filter((item) => item.projectId === ctx.projectId
    && (!filters.schoolId || item.schoolId === filters.schoolId)
    && (!filters.teachingUnitId || item.id === filters.teachingUnitId))
}

function applies(lesson: Lesson, unit: TeachingUnit, date: Date, key: string): boolean {
  return key >= unit.startDate && key <= unit.endDate && key >= lesson.effectiveStart
    && key <= (lesson.effectiveEnd ?? unit.endDate) && date.getDay() === lesson.day
    && (lesson.weekPattern === 'every' || getTeachingUnitWeekPattern(date, unit) === lesson.weekPattern)
}

function resolvedFields(data: AppDataV9, ctx: ReadContext, unit: TeachingUnit, subjectId: string, classId: string) {
  const school = data.schools.find((item) => item.id === unit.schoolId && item.projectId === ctx.projectId)
  const subject: SubjectV9 | undefined = data.subjects.find((item) => item.id === subjectId
    && item.projectId === ctx.projectId && item.timetableId === ctx.timetableId)
  const schoolClass = data.classes.find((item) => item.id === classId && item.projectId === ctx.projectId
    && item.teachingUnitId === unit.id)
  const configured = data.teachingUnitSubjects.some((item) => item.projectId === ctx.projectId
    && item.teachingUnitId === unit.id && item.subjectId === subjectId)
  if (!school || !subject || !schoolClass || !configured
    || !subject.applicableSchoolLevels.includes(unit.schoolLevel)) return null
  return { projectId: ctx.projectId, timetableId: ctx.timetableId, teachingUnitId: unit.id,
    teachingUnitName: unit.name, schoolId: school.id, schoolName: school.name, schoolColor: school.color,
    subjectId: subject.id, subjectName: subject.name, subjectColor: subject.color,
    classId: schoolClass.id, className: classDisplayName(schoolClass), classRoom: schoolClass.room }
}

function resolveDay(data: AppDataV9, ctx: ReadContext, date: Date, filters: V9ReadFilters): V9ReadOccurrence[] {
  if (Number.isNaN(date.getTime())) return []
  const key = toDateKey(date)
  const units = eligibleUnit(data, ctx, filters)
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  const lessons = data.recurringLessons.filter((item) => item.projectId === ctx.projectId
    && item.timetableId === ctx.timetableId && unitById.has(item.teachingUnitId))
  const overrides = data.overrides.filter((item) => item.projectId === ctx.projectId
    && item.timetableId === ctx.timetableId && item.teachingUnitId !== null
    && unitById.has(item.teachingUnitId))
  const sourceOverrides = overrides.filter((item) => item.date === key)
  const recurring = lessons.flatMap<V9ReadOccurrence>((lesson) => {
    const unit = unitById.get(lesson.teachingUnitId)!
    if (!applies(lesson, unit, date, key)) return []
    const period = unit.periods.find((item) => item.id === lesson.periodId)
    if (!period) return []
    const slotCount = lessons.filter((item) => item.teachingUnitId === unit.id && item.periodId === lesson.periodId
      && applies(item, unit, date, key)).length
    const override = sourceOverrides.find((item) => item.teachingUnitId === unit.id
      && item.periodId === lesson.periodId
      && (item.originalLessonId === lesson.id || (!item.originalLessonId && slotCount === 1)))
    if (override?.action === 'move') {
      const fields = resolvedFields(data, ctx, unit, lesson.subjectId, lesson.classId)
      if (!fields) return []
      return [{ ...fields, kind: 'recurring', id: lesson.id, seriesId: lesson.seriesId,
        occurrenceId: JSON.stringify(['recurring', ctx.projectId, ctx.timetableId, lesson.id,
          lesson.seriesId, key, override.id, 'source']), sourceDate: key, date: key,
        periodId: period.id, periodLabel: period.label, startTime: period.startTime,
        endTime: period.endTime, room: lesson.room ?? fields.classRoom,
        status: 'moved', movementRole: 'source', overrideId: override.id, groupId: override.groupId,
        note: override.note, hasConflict: false }]
    }
    const subjectId = override?.action === 'replace' ? override.replacement?.subjectId : lesson.subjectId
    const classId = override?.action === 'replace' ? override.replacement?.classId : lesson.classId
    if (!subjectId || !classId) return []
    const fields = resolvedFields(data, ctx, unit, subjectId, classId)
    if (!fields) return []
    return [{ ...fields, kind: 'recurring', id: lesson.id, seriesId: lesson.seriesId,
      occurrenceId: JSON.stringify(['recurring', ctx.projectId, ctx.timetableId, lesson.id,
        lesson.seriesId, key, override?.id ?? null]), sourceDate: key, date: key,
      periodId: period.id, periodLabel: period.label, startTime: period.startTime,
      endTime: period.endTime, room: override?.action === 'replace'
        ? override.replacement?.room : lesson.room ?? fields.classRoom,
      status: override?.action === 'cancel' ? 'cancelled' : override?.action === 'replace' ? 'replaced' : 'regular',
      overrideId: override?.id, groupId: override?.groupId, note: override?.note, hasConflict: false }]
  })
  const moved = overrides.flatMap<V9ReadOccurrence>((override) => {
    if (override.action !== 'move' || override.target?.date !== key || !override.originalLessonId
      || !override.teachingUnitId) return []
    const lesson = lessons.find((item) => item.id === override.originalLessonId
      && item.teachingUnitId === override.teachingUnitId)
    const unit = unitById.get(override.teachingUnitId)
    if (!lesson || !unit || key < unit.startDate || key > unit.endDate
      || !applies(lesson, unit, fromDateKey(override.date), override.date)) return []
    const period = unit.periods.find((item) => item.id === override.target?.periodId)
    const fields = resolvedFields(data, ctx, unit, lesson.subjectId, lesson.classId)
    if (!period || !fields) return []
    return [{ ...fields, kind: 'recurring', id: lesson.id, seriesId: lesson.seriesId,
      occurrenceId: JSON.stringify(['recurring', ctx.projectId, ctx.timetableId, lesson.id,
        lesson.seriesId, override.date, override.id, 'target']), sourceDate: override.date, date: key,
      periodId: period.id, periodLabel: period.label, startTime: period.startTime,
      endTime: period.endTime, room: lesson.room ?? fields.classRoom,
      status: 'moved', movementRole: 'target', overrideId: override.id, groupId: override.groupId,
      note: override.note, hasConflict: false }]
  })
  const oneOffs = data.oneOffLessons.flatMap<V9ReadOccurrence>((item) => {
    if (item.projectId !== ctx.projectId || item.timetableId !== ctx.timetableId || item.date !== key) return []
    const unit = unitById.get(item.teachingUnitId)
    if (!unit || key < unit.startDate || key > unit.endDate) return []
    const fields = resolvedFields(data, ctx, unit, item.subjectId, item.classId)
    if (!fields) return []
    const common = { ...fields, kind: 'one-off' as const, id: item.id,
      occurrenceId: JSON.stringify(['one-off', ctx.projectId, ctx.timetableId, item.id, key]),
      date: key, purpose: item.purpose, relatedRecurringLessonId: item.relatedRecurringLessonId,
      room: item.room ?? fields.classRoom, hasConflict: false }
    if (item.time.mode === 'period') {
      const period = unit.periods.find((value) => value.id === item.time.periodId)
      return period ? [{ ...common, timeMode: 'period', periodId: period.id, periodLabel: period.label,
        startTime: period.startTime, endTime: period.endTime }] : []
    }
    return [{ ...common, timeMode: 'custom', startTime: item.time.startTime, endTime: item.time.endTime }]
  })
  const sorted = [...recurring, ...moved, ...oneOffs].sort((left, right) =>
    left.startTime.localeCompare(right.startTime) || left.endTime.localeCompare(right.endTime)
    || left.schoolName.localeCompare(right.schoolName)
    || left.teachingUnitName.localeCompare(right.teachingUnitName)
    || left.occurrenceId.localeCompare(right.occurrenceId))
  const active = sorted.filter((item) => item.kind === 'one-off'
    || (item.status !== 'cancelled' && item.movementRole !== 'source'))
  const conflicts = new Set<string>()
  active.forEach((item, index) => active.slice(index + 1).forEach((other) => {
    if (timeIntervalsOverlap(item, other)) {
      conflicts.add(item.occurrenceId)
      conflicts.add(other.occurrenceId)
    }
  }))
  return sorted.map((item) => ({ ...item, hasConflict: conflicts.has(item.occurrenceId) }))
}

export function resolveV9DayResult(data: AppDataV9, scope: V9ReadScope, date: Date,
  filters: V9ReadFilters = {}): V9ReadResult<readonly V9ReadOccurrence[]> {
  const result = context(data, scope)
  return result.status === 'ready'
    ? { status: 'ready', value: resolveDay(data, result.context, date, filters) }
    : { status: result.status, value: [] }
}

export function resolveV9Day(data: AppDataV9, scope: V9ReadScope, date: Date,
  filters: V9ReadFilters = {}): readonly V9ReadOccurrence[] {
  return resolveV9DayResult(data, scope, date, filters).value
}

export function resolveV9WeekResult(data: AppDataV9, scope: V9ReadScope, dates: Date[],
  filters: V9ReadFilters = {}): V9ReadResult<readonly V9ReadDay[]> {
  const result = context(data, scope)
  const value = dates.map((date) => ({ date: new Date(date),
    lessons: result.status === 'ready' ? resolveDay(data, result.context, date, filters) : [] }))
  return { status: result.status, value }
}

export function resolveV9Week(data: AppDataV9, scope: V9ReadScope, dates: Date[],
  filters: V9ReadFilters = {}): readonly V9ReadDay[] {
  return resolveV9WeekResult(data, scope, dates, filters).value
}

export function selectV9HeaderWeekPatternResult(data: AppDataV9, scope: V9ReadScope,
  date: Date): V9ReadResult<'A' | 'B' | null> {
  const result = context(data, scope)
  if (result.status !== 'ready') return { status: result.status, value: null }
  const ctx = result.context
  if (!ctx.unit || Number.isNaN(date.getTime())) return { status: 'ready', value: null }
  const key = toDateKey(date)
  if (key < ctx.unit.startDate || key > ctx.unit.endDate) return { status: 'ready', value: null }
  return { status: 'ready', value: getTeachingUnitWeekPattern(date, ctx.unit) }
}

export function selectV9HeaderWeekPattern(data: AppDataV9, scope: V9ReadScope, date: Date): 'A' | 'B' | null {
  return selectV9HeaderWeekPatternResult(data, scope, date).value
}

/** Only explicitly resolved meetings and activities owned by this teacher are visible. */
export function selectV9ResolvedEventsResult(data: AppDataV9, scope: V9ReadScope,
  date?: string): V9ReadResult<readonly Readonly<ResolvedCalendarEventV8>[]> {
  const result = context(data, scope)
  if (result.status !== 'ready') return { status: result.status, value: [] }
  const ctx = result.context
  const value = data.events.filter((event): event is ResolvedCalendarEventV8 =>
    event.ownershipStatus === 'resolved' && event.projectId === ctx.projectId
    && event.timetableId === ctx.timetableId && (event.type === 'meeting' || event.type === 'activity')
    && (date === undefined || event.date === date))
    .map((event) => ({ ...event }))
  return { status: 'ready', value }
}

export function selectV9ResolvedEvents(data: AppDataV9, scope: V9ReadScope,
  date?: string): readonly Readonly<ResolvedCalendarEventV8>[] {
  return selectV9ResolvedEventsResult(data, scope, date).value
}

import { SCHOOL_LEVELS, type AppDataV8, type TimetableProject } from '../../types'
import type { AppDataV9, SubjectV9 } from '../../types/v9'
import { normalizeSubjectText } from '../../lib/subjectSearch'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './v8'

const subjectKeys = new Set([
  'id', 'name', 'shortName', 'color', 'applicableSchoolLevels', 'origin', 'projectId', 'timetableId',
])
const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value)
const named = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const timestamp = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const date = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
const fiveMinuteTime = (value: unknown): value is string => typeof value === 'string'
  && /^([01]\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$/.test(value)

function validPeriods(value: unknown): boolean {
  if (!Array.isArray(value) || !value.length) return false
  const periods = value as { id: unknown; order: unknown; label: unknown; startTime: unknown; endTime: unknown }[]
  if (new Set(periods.map((item) => item.id)).size !== periods.length
    || new Set(periods.map((item) => item.order)).size !== periods.length) return false
  const ordered = [...periods].sort((left, right) => String(left.startTime).localeCompare(String(right.startTime)))
  return ordered.every((period, index) => Number.isInteger(period.id) && Number.isInteger(period.order)
    && named(period.label) && fiveMinuteTime(period.startTime) && fiveMinuteTime(period.endTime)
    && period.startTime < period.endTime
    && (index === 0 || String(ordered[index - 1].endTime) <= period.startTime))
}

function validProject(value: unknown): boolean {
  if (!record(value) || !named(value.id) || !named(value.name)
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt)
    || (value.archivedAt !== undefined && !timestamp(value.archivedAt))) return false
  if (value.term === null) return true
  const term = value.term
  return record(term) && Object.keys(term).every((key) => ['academicYear', 'semester', 'customLabel'].includes(key))
    && Number.isInteger(term.academicYear) && Number(term.academicYear) > 0
    && ['first', 'second', 'summer', 'custom'].includes(String(term.semester))
    && (term.customLabel === undefined || typeof term.customLabel === 'string')
    && (term.semester !== 'custom' || named(term.customLabel))
}

/** Resources for an unset Project are checked here, never through a fabricated V8 term. */
function validUnsetProjects(data: AppDataV9): boolean {
  if (!data.projects.every(validProject)
    || new Set(data.projects.map((item) => item.id)).size !== data.projects.length) return false
  const projects = new Map(data.projects.map((item) => [item.id, item]))
  if (data.activeProjectId !== null && (!projects.has(data.activeProjectId)
    || projects.get(data.activeProjectId)?.archivedAt)) return false
  if (data.activeProjectId === null && data.projects.some((item) => !item.archivedAt)) return false
  const unset = new Set(data.projects.filter((item) => item.term === null).map((item) => item.id))
  // A fully configured document is checked by the established V8 validator below. The native
  // scan is only needed for resources that projection must exclude from that validator.
  if (!unset.size) return true
  const dated = [...data.recurringLessons, ...data.oneOffLessons, ...data.overrides,
    ...data.events, ...data.teachingProgress]
  if (dated.some((item) => item.projectId !== null && unset.has(item.projectId))) return false
  const entities = [...data.projects, ...data.schools, ...data.teachingUnits, ...data.timetables,
    ...data.subjects, ...data.teachingUnitSubjects, ...data.classes, ...data.recurringLessons,
    ...data.oneOffLessons, ...data.overrides, ...data.events, ...data.teachingProgress,
    ...data.migrationWarnings]
  const entityIds = entities.map((item) => item.id)
  if (entityIds.some((id) => !named(id)) || new Set(entityIds).size !== entityIds.length) return false
  const seriesIds = new Set(data.recurringLessons.map((item) => item.seriesId))
  const nonLessonIds = entities.filter((item) => !data.recurringLessons.includes(item as never)).map((item) => item.id)
  if ([...seriesIds].some((id) => !named(id) || nonLessonIds.includes(id))) return false

  const schools = new Map(data.schools.map((item) => [item.id, item]))
  const units = new Map(data.teachingUnits.map((item) => [item.id, item]))
  const timetables = new Map(data.timetables.map((item) => [item.id, item]))
  const subjects = new Map(data.subjects.map((item) => [item.id, item]))
  if (data.schools.some((item) => unset.has(item.projectId)
    && (!named(item.name) || !/^#[0-9a-f]{6}$/i.test(item.color)))) return false
  if (data.timetables.some((item) => unset.has(item.projectId) && (!named(item.name)
    || !((item.teacherName === null && item.teacherNamePending === true)
      || (named(item.teacherName) && item.teacherNamePending === undefined))))) return false
  if (data.teachingUnits.some((item) => unset.has(item.projectId) && (
    schools.get(item.schoolId)?.projectId !== item.projectId || !named(item.name)
    || !SCHOOL_LEVELS.includes(item.schoolLevel) || item.timezone !== 'Asia/Taipei'
    || !date(item.startDate) || !date(item.endDate) || item.startDate > item.endDate
    || !date(item.weekCycle?.anchorDate) || typeof item.weekCycle?.enabled !== 'boolean'
    || !['A', 'B'].includes(item.weekCycle?.anchorPattern) || !validPeriods(item.periods)))) return false
  const unsetUnits = data.teachingUnits.filter((item) => unset.has(item.projectId))
  if (new Set(unsetUnits.map((item) => JSON.stringify([item.schoolId, item.schoolLevel]))).size
    !== unsetUnits.length) return false
  if (data.classes.some((item) => unset.has(item.projectId) && (() => {
    const unit = units.get(item.teachingUnitId)
    const structured = item.grade !== undefined || item.classNumber !== undefined
    return unit?.projectId !== item.projectId || !named(item.name)
      || (structured && (item.grade === undefined || item.classNumber === undefined
        || !Number.isInteger(item.grade) || !Number.isInteger(item.classNumber) || item.classNumber <= 0
        || (unit.schoolLevel === 'junior-high' ? ![7, 8, 9].includes(item.grade)
          : unit.schoolLevel === 'senior-high' ? ![1, 2, 3].includes(item.grade) : true)))
      || (item.room !== undefined && typeof item.room !== 'string')
      || (item.origin !== undefined && !['demo', 'user'].includes(item.origin))
  })())) return false
  const structuredClasses = data.classes.filter((item) => unset.has(item.projectId)
    && item.grade !== undefined && item.classNumber !== undefined)
  if (new Set(structuredClasses.map((item) => JSON.stringify([
    item.teachingUnitId, item.grade, item.classNumber,
  ]))).size !== structuredClasses.length) return false
  const pairs = new Set<string>()
  for (const relation of data.teachingUnitSubjects.filter((item) => unset.has(item.projectId))) {
    const unit = units.get(relation.teachingUnitId)
    const subject = subjects.get(relation.subjectId)
    const table = subject && timetables.get(subject.timetableId)
    const pair = JSON.stringify([relation.projectId, relation.teachingUnitId, relation.subjectId])
    if (unit?.projectId !== relation.projectId || subject?.projectId !== relation.projectId
      || table?.projectId !== relation.projectId || !subject.applicableSchoolLevels.includes(unit.schoolLevel)
      || pairs.has(pair)) return false
    pairs.add(pair)
  }
  return true
}

/**
 * Reuse the established V8 document checks without teaching its validator to accept V9.
 * Unset Projects and their date-free resources are validated separately below.
 * The remaining document has real term descriptors and retains every dated record.
 * Subject names are replaced because V8 uniqueness is Project-wide, while V9 is teacher-scoped.
 */
export function asV8ValidationProjection(data: AppDataV9): AppDataV8 {
  const projects = data.projects.filter((item): item is TimetableProject => item.term !== null)
  const included = new Set(projects.map((item) => item.id))
  const unset = new Set(data.projects.filter((item) => item.term === null).map((item) => item.id))
  return {
    ...data,
    schemaVersion: 8,
    projects,
    activeProjectId: data.activeProjectId && included.has(data.activeProjectId) ? data.activeProjectId
      : projects.find((item) => !item.archivedAt)?.id ?? null,
    schools: data.schools.filter((item) => !unset.has(item.projectId)),
    teachingUnits: data.teachingUnits.filter((item) => !unset.has(item.projectId)),
    timetables: data.timetables.filter((item) => !unset.has(item.projectId)),
    classes: data.classes.filter((item) => !unset.has(item.projectId)),
    teachingUnitSubjects: data.teachingUnitSubjects.filter((item) => !unset.has(item.projectId)),
    subjects: data.subjects.filter((item) => !unset.has(item.projectId)).map((subject) => ({
      id: subject.id,
      projectId: subject.projectId,
      name: `v9-validation-name-${[...subject.id].map((value) => value.codePointAt(0)!.toString(16)).join('-')}`,
      shortName: `v9-validation-short-${[...subject.id].map((value) => value.codePointAt(0)!.toString(16)).join('-')}`,
      color: subject.color,
      applicableSchoolLevels: subject.applicableSchoolLevels,
      origin: subject.origin,
    })),
  }
}

/** V9 write guard retains the established V8 non-Subject safety checks. */
export function isSafeAppDataV9Update(current: AppDataV9, next: AppDataV9): boolean {
  if (!isCompatibleAppDataV9(current) || !isCompatibleAppDataV9(next)) return false
  const termTransitions = current.projects.filter((before) => {
    const after = next.projects.find((item) => item.id === before.id)
    return before.term === null && after !== undefined && after.term !== null
  })
  if (termTransitions.length) {
    if (termTransitions.length !== 1) return false
    const before = termTransitions[0]
    const after = next.projects.find((item) => item.id === before.id)!
    const expected = { ...current, projects: current.projects.map((item) => item.id === before.id
      ? { ...item, term: after.term, updatedAt: after.updatedAt } : item) }
    return JSON.stringify(expected) === JSON.stringify(next)
  }
  const oldById = new Map(current.subjects.map((item) => [item.id, item]))
  if (next.subjects.some((item) => {
    const old = oldById.get(item.id)
    return old && (old.projectId !== item.projectId || old.timetableId !== item.timetableId)
  })) return false
  const oldRelations = new Map(current.teachingUnitSubjects.map((item) => [item.id, item]))
  if (next.teachingUnitSubjects.some((item) => {
    const old = oldRelations.get(item.id)
    return old && (old.projectId !== item.projectId || old.teachingUnitId !== item.teachingUnitId
      || old.subjectId !== item.subjectId)
  })) return false
  for (const key of ['schools', 'teachingUnits', 'timetables', 'classes', 'teachingUnitSubjects'] as const) {
    if (next[key].some((item) => current[key].some((before) => before.id === item.id
      && before.projectId !== item.projectId
      && (current.projects.some((project) => project.id === before.projectId && project.term === null)
        || next.projects.some((project) => project.id === item.projectId && project.term === null))))) return false
  }
  // Removing a configured term must not hide dated records from the established guards.
  if (current.projects.some((item) => item.term !== null
    && next.projects.some((after) => after.id === item.id && after.term === null))) return false
  if (!current.projects.some((item) => item.term === null)
    && !next.projects.some((item) => item.term === null)) {
    return isSafeAppDataV8Update(asV8ValidationProjection(current), asV8ValidationProjection(next))
  }
  for (const before of current.projects.filter((item) => item.term === null)) {
    const after = next.projects.find((item) => item.id === before.id)
    if (!after) continue
    if (before.name !== after.name || before.createdAt !== after.createdAt
      || (before.archivedAt === after.archivedAt && before.updatedAt !== after.updatedAt)) return false
    for (const key of ['schools', 'teachingUnits', 'timetables', 'subjects',
      'teachingUnitSubjects', 'classes'] as const) {
      const oldRows = current[key].filter((item) => item.projectId === before.id)
      const newRows = next[key].filter((item) => item.projectId === before.id)
      if ((before.archivedAt || after.archivedAt) && JSON.stringify(oldRows) !== JSON.stringify(newRows)) return false
      if (oldRows.some((item) => next[key].some((row) => row.id === item.id && row.projectId !== item.projectId))) return false
    }
  }
  const nextSchools = new Map(next.schools.map((item) => [item.id, item]))
  for (const school of current.schools) {
    if (!current.projects.some((item) => item.id === school.projectId && item.term === null)) continue
    if (!nextSchools.has(school.id) && next.projects.some((item) => item.id === school.projectId)
      && current.teachingUnits.some((item) => item.schoolId === school.id)) return false
  }
  const nextTables = new Map(next.timetables.map((item) => [item.id, item]))
  for (const table of current.timetables) {
    if (!current.projects.some((item) => item.id === table.projectId && item.term === null)) continue
    if (!nextTables.has(table.id) && next.projects.some((item) => item.id === table.projectId)
      && current.subjects.some((item) => item.timetableId === table.id)) return false
  }
  const nextSubjects = new Map(next.subjects.map((item) => [item.id, item]))
  for (const subject of current.subjects) {
    if (!current.projects.some((item) => item.id === subject.projectId && item.term === null)) continue
    if (nextSubjects.has(subject.id) || !next.projects.some((item) => item.id === subject.projectId)) continue
    if (current.teachingUnitSubjects.some((item) => item.subjectId === subject.id)
      || current.recurringLessons.some((item) => item.subjectId === subject.id)
      || current.oneOffLessons.some((item) => item.subjectId === subject.id)
      || current.overrides.some((item) => item.replacement?.subjectId === subject.id)
      || current.teachingProgress.some((item) => item.subjectId === subject.id)) return false
  }
  const nextUnits = new Map(next.teachingUnits.map((item) => [item.id, item]))
  for (const unit of current.teachingUnits) {
    if (!current.projects.some((item) => item.id === unit.projectId && item.term === null)) continue
    const after = nextUnits.get(unit.id)
    const referenced = [current.classes, current.teachingUnitSubjects, current.recurringLessons,
      current.oneOffLessons, current.overrides, current.events, current.teachingProgress]
      .some((rows) => rows.some((item) => item.teachingUnitId === unit.id))
    if (!after) {
      if (next.projects.some((item) => item.id === unit.projectId) && referenced) return false
      continue
    }
    if (referenced && (unit.schoolId !== after.schoolId || unit.schoolLevel !== after.schoolLevel
      || unit.startDate !== after.startDate || unit.endDate !== after.endDate
      || JSON.stringify(unit.periods) !== JSON.stringify(after.periods)
      || JSON.stringify(unit.weekCycle) !== JSON.stringify(after.weekCycle))) return false
  }
  const nextClasses = new Map(next.classes.map((item) => [item.id, item]))
  for (const schoolClass of current.classes) {
    if (!current.projects.some((item) => item.id === schoolClass.projectId && item.term === null)) continue
    const after = nextClasses.get(schoolClass.id)
    const referenced = current.recurringLessons.some((item) => item.classId === schoolClass.id)
      || current.oneOffLessons.some((item) => item.classId === schoolClass.id)
      || current.overrides.some((item) => item.replacement?.classId === schoolClass.id)
      || current.teachingProgress.some((item) => item.classId === schoolClass.id)
    if ((!after || after.teachingUnitId !== schoolClass.teachingUnitId)
      && next.projects.some((item) => item.id === schoolClass.projectId) && referenced) return false
  }
  const nextRelations = new Map(next.teachingUnitSubjects.map((item) => [item.id, item]))
  for (const relation of current.teachingUnitSubjects) {
    if (!current.projects.some((item) => item.id === relation.projectId && item.term === null)) continue
    const after = nextRelations.get(relation.id)
    if (after && (after.projectId !== relation.projectId || after.teachingUnitId !== relation.teachingUnitId
      || after.subjectId !== relation.subjectId)) return false
    const referenced = current.recurringLessons.some((item) => item.projectId === relation.projectId
      && item.teachingUnitId === relation.teachingUnitId && item.subjectId === relation.subjectId)
      || current.oneOffLessons.some((item) => item.projectId === relation.projectId
        && item.teachingUnitId === relation.teachingUnitId && item.subjectId === relation.subjectId)
      || current.overrides.some((item) => item.projectId === relation.projectId
        && item.teachingUnitId === relation.teachingUnitId && item.replacement?.subjectId === relation.subjectId)
      || current.teachingProgress.some((item) => item.projectId === relation.projectId
        && item.teachingUnitId === relation.teachingUnitId && item.subjectId === relation.subjectId)
    if (!after && next.projects.some((item) => item.id === relation.projectId) && referenced) return false
  }
  if (next.subjects.some((item) => !current.subjects.some((old) => old.id === item.id)
    && next.projects.find((project) => project.id === item.projectId)?.archivedAt)) return false
  return isSafeAppDataV8Update(asV8ValidationProjection(current), asV8ValidationProjection(next))
}

function validSubject(value: unknown): value is SubjectV9 {
  return record(value) && Object.keys(value).every((key) => subjectKeys.has(key))
    && named(value.id) && named(value.projectId) && named(value.timetableId)
    && named(value.name) && named(value.shortName)
    && named(value.color) && Array.isArray(value.applicableSchoolLevels) && value.applicableSchoolLevels.length > 0
    && new Set(value.applicableSchoolLevels).size === value.applicableSchoolLevels.length
    && value.applicableSchoolLevels.every((level) => SCHOOL_LEVELS.includes(level as never))
    && (value.origin === undefined || value.origin === 'demo' || value.origin === 'user')
}

/** Full-document V9 contract; no storage reads or writes. */
export function isCompatibleAppDataV9(value: unknown): value is AppDataV9 {
  try {
    if (!record(value) || value.schemaVersion !== 9 || !Array.isArray(value.subjects)
      || !value.subjects.every(validSubject)) return false
    const data = value as AppDataV9
    if (!validUnsetProjects(data)) return false
    const timetables = new Map(data.timetables.map((item) => [item.id, item]))
    const subjects = new Map(data.subjects.map((item) => [item.id, item]))
    const names = new Set<string>()
    const shortNames = new Set<string>()
    for (const subject of data.subjects) {
      if (timetables.get(subject.timetableId)?.projectId !== subject.projectId) return false
      const nameKey = JSON.stringify([subject.timetableId, normalizeSubjectText(subject.name)])
      const shortKey = JSON.stringify([subject.timetableId, normalizeSubjectText(subject.shortName)])
      if (names.has(nameKey) || shortNames.has(shortKey)) return false
      names.add(nameKey)
      shortNames.add(shortKey)
    }
    if (!isCompatibleAppDataV8(asV8ValidationProjection(data))) return false
    const ownedBy = (subjectId: string, timetableId: string | null | undefined) =>
      named(timetableId) && subjects.get(subjectId)?.timetableId === timetableId
    return data.recurringLessons.every((item) => ownedBy(item.subjectId, item.timetableId))
      && data.oneOffLessons.every((item) => ownedBy(item.subjectId, item.timetableId))
      && data.overrides.every((item) => !item.replacement
        || ownedBy(item.replacement.subjectId, item.timetableId))
      && data.teachingProgress.every((item) => ownedBy(item.subjectId, item.timetableId))
  } catch {
    return false
  }
}

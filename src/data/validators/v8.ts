import type {
  AppDataV7,
  AppDataV8,
  CalendarEventV8,
  SubjectV8,
  TeachingProgress,
  TeachingProgressContent,
} from '../../types'
import { SCHOOL_LEVELS } from '../../types'
import { normalizeSubjectText } from '../../lib/subjectSearch'
import { analyzeSubjectReferences } from '../subjectReferences'
import { deriveLegacyEventOwnershipV8 } from '../eventOwnershipV8'
import { isCompatibleAppDataV7, isSafeAppDataV7UpdateExceptSubjects } from './v7'

type UnknownRecord = Record<string, unknown>

export const TEACHING_PROGRESS_TEXT_LIMITS = {
  chapter: 120,
  unit: 120,
  note: 2000,
} as const

const progressKeys = [
  'id', 'projectId', 'timetableId', 'teachingUnitId', 'classId', 'subjectId',
  'content', 'previousProgress', 'createdAt', 'updatedAt',
] as const
const contentKeys = ['chapter', 'unit', 'note'] as const
const snapshotKeys = ['content', 'updatedAt'] as const
const subjectKeys = ['id', 'name', 'shortName', 'color', 'applicableSchoolLevels', 'origin', 'projectId'] as const
const eventKeys = [
  'id', 'projectId', 'teachingUnitId', 'title', 'type', 'date', 'startTime', 'endTime',
  'location', 'notes', 'color', 'origin', 'ownershipStatus', 'timetableId', 'ownershipIssue',
] as const
const ownershipIssueKeys = ['reason', 'candidateTimetableIds'] as const

const record = (value: unknown): value is UnknownRecord => value !== null && typeof value === 'object' && !Array.isArray(value)
const onlyKeys = (value: UnknownRecord, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key))
const uuidV4 = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const canonicalUtcTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}
const codePointLength = (value: string) => [...value].length
const named = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const hasOwn = (value: UnknownRecord, key: string) => Object.prototype.hasOwnProperty.call(value, key)

function validText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value === value.normalize('NFC') && value === value.trim()
    && codePointLength(value) <= limit
}

function validContent(value: unknown): value is TeachingProgressContent {
  if (!record(value) || !onlyKeys(value, contentKeys)) return false
  if (!validText(value.chapter, TEACHING_PROGRESS_TEXT_LIMITS.chapter)
    || !validText(value.unit, TEACHING_PROGRESS_TEXT_LIMITS.unit)
    || !validText(value.note, TEACHING_PROGRESS_TEXT_LIMITS.note)) return false
  return Boolean(value.chapter || value.unit || value.note)
}

function validProgressShape(value: unknown): value is TeachingProgress {
  if (!record(value) || !onlyKeys(value, progressKeys) || !uuidV4(value.id)
    || typeof value.projectId !== 'string' || typeof value.timetableId !== 'string'
    || typeof value.teachingUnitId !== 'string' || typeof value.classId !== 'string'
    || typeof value.subjectId !== 'string' || !validContent(value.content)
    || !canonicalUtcTimestamp(value.createdAt) || !canonicalUtcTimestamp(value.updatedAt)
    || value.createdAt > value.updatedAt) return false
  if (value.previousProgress === null) return true
  if (!record(value.previousProgress) || !onlyKeys(value.previousProgress, snapshotKeys)
    || !validContent(value.previousProgress.content)
    || !canonicalUtcTimestamp(value.previousProgress.updatedAt)) return false
  return value.createdAt <= value.previousProgress.updatedAt && value.previousProgress.updatedAt < value.updatedAt
}

function validSubjectShape(value: unknown): value is SubjectV8 {
  return record(value) && onlyKeys(value, subjectKeys) && named(value.id) && named(value.projectId)
    && named(value.name) && named(value.shortName) && named(value.color)
    && Array.isArray(value.applicableSchoolLevels) && value.applicableSchoolLevels.length > 0
    && new Set(value.applicableSchoolLevels).size === value.applicableSchoolLevels.length
    && value.applicableSchoolLevels.every((level) => SCHOOL_LEVELS.includes(level as never))
    && (value.origin === undefined || value.origin === 'demo' || value.origin === 'user')
}

function validEventOwnership(data: AppDataV8, value: unknown): value is CalendarEventV8 {
  if (!record(value) || !onlyKeys(value, eventKeys)) return false
  if (value.ownershipStatus === 'resolved') {
    if (!named(value.projectId) || !named(value.teachingUnitId) || !named(value.timetableId)
      || hasOwn(value, 'ownershipIssue')) return false
    const timetable = data.timetables.find((item) => item.id === value.timetableId)
    const unit = data.teachingUnits.find((item) => item.id === value.teachingUnitId)
    return timetable?.projectId === value.projectId && unit?.projectId === value.projectId
  }
  if (value.ownershipStatus !== 'unresolved' || hasOwn(value, 'timetableId') || !record(value.ownershipIssue)
    || !onlyKeys(value.ownershipIssue, ownershipIssueKeys)
    || !Array.isArray(value.ownershipIssue.candidateTimetableIds)
    || value.ownershipIssue.candidateTimetableIds.some((id) => !named(id))
    || new Set(value.ownershipIssue.candidateTimetableIds).size !== value.ownershipIssue.candidateTimetableIds.length) return false

  const expected = deriveLegacyEventOwnershipV8(data, value as unknown as CalendarEventV8)
  return expected.ownershipStatus === 'unresolved'
    && value.ownershipIssue.reason === expected.ownershipIssue.reason
    && JSON.stringify(value.ownershipIssue.candidateTimetableIds)
      === JSON.stringify(expected.ownershipIssue.candidateTimetableIds)
}

const asV7 = (data: AppDataV8): AppDataV7 => ({ ...data, schemaVersion: 7 })
const scopeKey = (progress: Pick<TeachingProgress, 'projectId' | 'timetableId' | 'teachingUnitId' | 'classId' | 'subjectId'>) => JSON.stringify([
  progress.projectId, progress.timetableId, progress.teachingUnitId, progress.classId, progress.subjectId,
])

function nonSubjectEntityIds(data: AppDataV8): Set<string> {
  return new Set([
    ...data.projects.map((item) => item.id), ...data.timetables.map((item) => item.id),
    ...data.schools.map((item) => item.id), ...data.teachingUnits.map((item) => item.id),
    ...data.classes.map((item) => item.id),
    ...data.recurringLessons.flatMap((item) => [item.id, item.seriesId]),
    ...data.events.map((item) => item.id), ...data.overrides.map((item) => item.id),
    ...data.oneOffLessons.map((item) => item.id), ...data.migrationWarnings.map((item) => item.id),
  ])
}

export function isCompatibleAppDataV8(value: unknown): value is AppDataV8 {
  try {
    if (!record(value) || value.schemaVersion !== 8 || !Array.isArray(value.teachingProgress)) return false
    const data = value as unknown as AppDataV8
    if (!isCompatibleAppDataV7(asV7(data))) return false
    const projects = new Set(data.projects.map((item) => item.id))
    const timetables = new Map(data.timetables.map((item) => [item.id, item]))
    const units = new Map(data.teachingUnits.map((item) => [item.id, item]))
    const classes = new Map(data.classes.map((item) => [item.id, item]))
    const subjects = new Map(data.subjects.map((item) => [item.id, item]))
    const usedIds = nonSubjectEntityIds(data)
    const subjectNames = new Set<string>()
    const subjectShortNames = new Set<string>()
    for (const subject of data.subjects) {
      const nameKey = JSON.stringify([subject.projectId, normalizeSubjectText(subject.name)])
      const shortNameKey = JSON.stringify([subject.projectId, normalizeSubjectText(subject.shortName)])
      if (!validSubjectShape(subject) || !projects.has(subject.projectId) || usedIds.has(subject.id)
        || subjectNames.has(nameKey) || subjectShortNames.has(shortNameKey)) return false
      usedIds.add(subject.id)
      subjectNames.add(nameKey)
      subjectShortNames.add(shortNameKey)
    }
    for (const lesson of data.recurringLessons) {
      if (subjects.get(lesson.subjectId)?.projectId !== lesson.projectId) return false
    }
    for (const override of data.overrides) {
      if (override.replacement && (override.projectId === null
        || subjects.get(override.replacement.subjectId)?.projectId !== override.projectId)) return false
    }
    for (const lesson of data.oneOffLessons) {
      if (subjects.get(lesson.subjectId)?.projectId !== lesson.projectId) return false
    }
    if (!data.events.every((event) => validEventOwnership(data, event))) return false
    const scopes = new Set<string>()
    for (const progress of data.teachingProgress) {
      if (!validProgressShape(progress) || usedIds.has(progress.id)) return false
      usedIds.add(progress.id)
      const scope = scopeKey(progress)
      if (scopes.has(scope)) return false
      scopes.add(scope)
      const unit = units.get(progress.teachingUnitId)
      const schoolClass = classes.get(progress.classId)
      const subject = subjects.get(progress.subjectId)
      if (!projects.has(progress.projectId) || timetables.get(progress.timetableId)?.projectId !== progress.projectId
        || unit?.projectId !== progress.projectId || schoolClass?.projectId !== progress.projectId
        || schoolClass.teachingUnitId !== progress.teachingUnitId || subject?.projectId !== progress.projectId
        || (subject.applicableSchoolLevels && !subject.applicableSchoolLevels.includes(unit.schoolLevel))) return false
    }
    return true
  } catch {
    return false
  }
}

const sameContent = (left: TeachingProgressContent, right: TeachingProgressContent) => left.chapter === right.chapter
  && left.unit === right.unit && left.note === right.note
const sameSnapshot = (left: TeachingProgress['previousProgress'], right: TeachingProgress['previousProgress']) => {
  if (left === null || right === null) return left === right
  return left.updatedAt === right.updatedAt && sameContent(left.content, right.content)
}
const sameScope = (left: TeachingProgress, right: TeachingProgress) => scopeKey(left) === scopeKey(right)
const hasPreviousSnapshotOf = (next: TeachingProgress, current: TeachingProgress) => next.previousProgress !== null
  && next.previousProgress.updatedAt === current.updatedAt
  && sameContent(next.previousProgress.content, current.content)

/** Domain restore commands can use this to distinguish user intent from a normal edit. */
export function isTeachingProgressRestore(current: TeachingProgress, next: TeachingProgress): boolean {
  return current.previousProgress !== null && next.id === current.id && sameScope(current, next)
    && next.createdAt === current.createdAt && next.updatedAt > current.updatedAt
    && sameContent(next.content, current.previousProgress.content) && hasPreviousSnapshotOf(next, current)
}

function retainedScopeReferences(data: AppDataV8, progress: TeachingProgress): boolean {
  const unit = data.teachingUnits.find((item) => item.id === progress.teachingUnitId)
  const schoolClass = data.classes.find((item) => item.id === progress.classId)
  const subject = data.subjects.find((item) => item.id === progress.subjectId)
  return unit?.projectId === progress.projectId && schoolClass?.projectId === progress.projectId
    && schoolClass.teachingUnitId === progress.teachingUnitId && subject?.projectId === progress.projectId
    && (!subject?.applicableSchoolLevels || subject.applicableSchoolLevels.includes(unit.schoolLevel))
}

const retainsSubject = (data: AppDataV8, progress: TeachingProgress) => data.subjects
  .some((item) => item.id === progress.subjectId && item.projectId === progress.projectId)

function hasSafeSubjectUpdate(current: AppDataV8, next: AppDataV8): boolean {
  const currentSubjects = new Map(current.subjects.map((subject) => [subject.id, subject]))
  const nextSubjects = new Map(next.subjects.map((subject) => [subject.id, subject]))

  for (const subject of next.subjects) {
    const before = currentSubjects.get(subject.id)
    if (before && before.projectId !== subject.projectId) return false
    if (!before && next.projects.find((project) => project.id === subject.projectId)?.archivedAt) return false
  }

  for (const subject of current.subjects) {
    const after = nextSubjects.get(subject.id)
    if (!after && !next.projects.some((project) => project.id === subject.projectId)) continue
    const removedLevels = subject.applicableSchoolLevels.filter((level) => !after?.applicableSchoolLevels.includes(level))
    if (after && removedLevels.length === 0) continue
    for (const data of [current, next]) {
      if (analyzeSubjectReferences(data, subject.id).some((reference) => !after
        || reference.projectId !== subject.projectId || reference.schoolLevel === null
        || removedLevels.includes(reference.schoolLevel))) return false
    }
    const affectedProgress = (data: AppDataV8) => data.teachingProgress.some((progress) => {
      if (progress.subjectId !== subject.id) return false
      const level = data.teachingUnits.find((unit) => unit.id === progress.teachingUnitId)?.schoolLevel
      return !after || level === undefined || removedLevels.includes(level)
    })
    if (affectedProgress(current) || affectedProgress(next)) return false
  }

  const archivedProjectIds = new Set([
    ...current.projects.filter((project) => project.archivedAt).map((project) => project.id),
    ...next.projects.filter((project) => project.archivedAt).map((project) => project.id),
  ])
  return [...archivedProjectIds].every((projectId) => !next.projects.some((project) => project.id === projectId)
    || JSON.stringify(current.subjects.filter((subject) => subject.projectId === projectId))
      === JSON.stringify(next.subjects.filter((subject) => subject.projectId === projectId)))
}

export function isSafeAppDataV8Update(current: AppDataV8, next: AppDataV8): boolean {
  if (!isCompatibleAppDataV8(current) || !isCompatibleAppDataV8(next)
    || !isSafeAppDataV7UpdateExceptSubjects(asV7(current), asV7(next))
    || !hasSafeSubjectUpdate(current, next)) return false

  const currentById = new Map(current.teachingProgress.map((item) => [item.id, item]))
  const nextById = new Map(next.teachingProgress.map((item) => [item.id, item]))
  const currentByScope = new Map(current.teachingProgress.map((item) => [scopeKey(item), item]))

  for (const progress of next.teachingProgress) {
    const previous = currentById.get(progress.id)
    if (!previous) {
      if (currentByScope.has(scopeKey(progress)) || progress.previousProgress !== null
        || progress.createdAt !== progress.updatedAt
        || next.projects.find((item) => item.id === progress.projectId)?.archivedAt) return false
      continue
    }
    if (!sameScope(previous, progress) || previous.createdAt !== progress.createdAt) return false
    if (sameContent(previous.content, progress.content)) {
      if (previous.updatedAt !== progress.updatedAt || !sameSnapshot(previous.previousProgress, progress.previousProgress)) return false
      continue
    }
    if (progress.updatedAt <= previous.updatedAt || !hasPreviousSnapshotOf(progress, previous)) return false
  }

  for (const progress of current.teachingProgress) {
    if (nextById.has(progress.id)) continue
    const projectRemoved = !next.projects.some((item) => item.id === progress.projectId)
    if (projectRemoved) continue
    if (!retainsSubject(next, progress)) return false
    if (!retainedScopeReferences(next, progress)) return false
    if (next.teachingProgress.some((item) => scopeKey(item) === scopeKey(progress))) return false
  }

  const archivedProjectIds = new Set([
    ...current.projects.filter((item) => item.archivedAt).map((item) => item.id),
    ...next.projects.filter((item) => item.archivedAt).map((item) => item.id),
  ])
  return [...archivedProjectIds].every((projectId) => !next.projects.some((item) => item.id === projectId)
    || JSON.stringify(current.teachingProgress.filter((item) => item.projectId === projectId))
      === JSON.stringify(next.teachingProgress.filter((item) => item.projectId === projectId)))
}

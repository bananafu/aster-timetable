import type { AppDataV8 } from '../../types'
import type { AppDataV9, SubjectV9 } from '../../types/v9'
import { normalizeSubjectText } from '../../lib/subjectSearch'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './v8'

const subjectKeys = new Set([
  'id', 'name', 'shortName', 'color', 'applicableSchoolLevels', 'origin', 'projectId', 'timetableId',
])
const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value)
const named = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

/**
 * Reuse the established V8 document checks without teaching its validator to accept V9.
 * Only Subject names are replaced in this in-memory projection: V8 uniqueness is
 * Project-wide, while V9 uniqueness is checked against each Timetable below.
 */
export function asV8ValidationProjection(data: AppDataV9): AppDataV8 {
  return {
    ...data,
    schemaVersion: 8,
    subjects: data.subjects.map((subject) => ({
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
  const oldById = new Map(current.subjects.map((item) => [item.id, item]))
  if (next.subjects.some((item) => {
    const old = oldById.get(item.id)
    return old && (old.projectId !== item.projectId || old.timetableId !== item.timetableId)
  })) return false
  return isSafeAppDataV8Update(asV8ValidationProjection(current), asV8ValidationProjection(next))
}

function validSubject(value: unknown): value is SubjectV9 {
  return record(value) && Object.keys(value).every((key) => subjectKeys.has(key))
    && named(value.id) && named(value.projectId) && named(value.timetableId)
    && named(value.name) && named(value.shortName)
}

/** Full-document V9 contract; no storage reads or writes. */
export function isCompatibleAppDataV9(value: unknown): value is AppDataV9 {
  try {
    if (!record(value) || value.schemaVersion !== 9 || !Array.isArray(value.subjects)
      || !value.subjects.every(validSubject)) return false
    const data = value as AppDataV9
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

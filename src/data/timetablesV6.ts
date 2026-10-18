import type { AppDataV4, AppDataV6, AppDataV7, Timetable } from '../types'
import { isCompatibleAppDataV6, isSafeAppDataV6Update } from './validators/v6'
import { isCompatibleAppDataV7, isSafeAppDataV7Update } from './validators/v7'

type TimetableData = AppDataV6 | AppDataV7

export interface TimetableDetails {
  name: string
  teacherName: string | null
}

export interface CopyTimetableInput {
  projectId: string
  sourceTimetableId: string
  baseDate: string
  name?: string
  teacherName?: string | null
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function writableProject(data: AppDataV4, projectId: string): asserts data is TimetableData {
  if (!isCompatibleAppDataV6(data) && !isCompatibleAppDataV7(data)) throw new Error('Valid v6 data is required')
  const project = data.projects.find((item) => item.id === projectId)
  if (!project || project.archivedAt) throw new Error('Archived or missing projects are read-only')
}

function validResult<T extends TimetableData>(current: T, next: T): T {
  if (!(current.schemaVersion === 7 ? isSafeAppDataV7Update(current, next) : isSafeAppDataV6Update(current, next))) {
    throw new Error('Timetable operation produced invalid AppData')
  }
  return next
}

export function createTimetable<T extends AppDataV4>(data: T, projectId: string, details: TimetableDetails, id: string): T {
  writableProject(data, projectId)
  const name = details.name.trim()
  const teacherName = details.teacherName?.trim()
  if (!id.trim() || data.timetables.some((item) => item.id === id)) throw new Error('Timetable ID must be unique')
  if (!name || !teacherName) throw new Error('Timetable name and teacher name are required')
  const timetable: Timetable = { id, projectId, name, teacherName }
  return validResult(data, { ...data, timetables: [...data.timetables, timetable] }) as T
}

/** Copy versions effective on baseDate across the whole weekly timetable. */
export function copyTimetable<T extends AppDataV4>(data: T, input: CopyTimetableInput, createId: () => string): T {
  writableProject(data, input.projectId)
  const source = data.timetables.find((item) => item.id === input.sourceTimetableId)
  if (!source || source.projectId !== input.projectId) throw new Error('Source timetable does not belong to the project')
  if (source.teacherNamePending || !source.teacherName?.trim()) throw new Error('Source teacher name is pending')
  if (!isDateKey(input.baseDate)) throw new Error('Base date must be a valid YYYY-MM-DD date')

  const name = (input.name === undefined ? `${source.name}（副本）` : input.name).trim()
  const teacherName = (input.teacherName === undefined ? source.teacherName : input.teacherName)?.trim()
  if (!name || !teacherName) throw new Error('Timetable name and teacher name are required')

  const usedIds = new Set([
    ...data.projects.map((item) => item.id),
    ...data.timetables.map((item) => item.id),
    ...data.schools.map((item) => item.id),
    ...data.teachingUnits.map((item) => item.id),
    ...data.subjects.map((item) => item.id),
    ...data.classes.map((item) => item.id),
    ...data.recurringLessons.flatMap((item) => [item.id, item.seriesId]),
    ...data.events.map((item) => item.id),
    ...data.overrides.map((item) => item.id),
    ...data.migrationWarnings.map((item) => item.id),
    ...(data.schemaVersion === 7 ? data.oneOffLessons.map((item) => item.id) : []),
  ])
  const nextId = () => {
    const id = createId()
    if (typeof id !== 'string' || !id.trim() || usedIds.has(id)) throw new Error('Generated timetable, lesson, or series ID is invalid or already in use')
    usedIds.add(id)
    return id
  }
  const timetableId = nextId()
  const units = new Map(data.teachingUnits.filter((item) => item.projectId === input.projectId).map((item) => [item.id, item]))
  const seriesIds = new Map<string, string>()
  const copiedLessons = data.recurringLessons.filter((lesson) => {
    if (lesson.projectId !== input.projectId || lesson.timetableId !== source.id) return false
    const unit = units.get(lesson.teachingUnitId)
    // Match the resolver's inclusive version window without filtering weekday or A/B pattern.
    return unit !== undefined && unit.startDate <= input.baseDate && input.baseDate <= unit.endDate
      && lesson.effectiveStart <= input.baseDate && (!lesson.effectiveEnd || input.baseDate <= lesson.effectiveEnd)
  }).map((lesson) => {
    let seriesId = seriesIds.get(lesson.seriesId)
    if (!seriesId) {
      seriesId = nextId()
      seriesIds.set(lesson.seriesId, seriesId)
    }
    return {
      ...lesson,
      id: nextId(),
      seriesId,
      timetableId,
      effectiveStart: input.baseDate,
      effectiveEnd: units.get(lesson.teachingUnitId)!.endDate,
    }
  })
  const timetable: Timetable = { id: timetableId, projectId: input.projectId, name, teacherName }
  return validResult(data, {
    ...data,
    timetables: [...data.timetables, timetable],
    recurringLessons: [...data.recurringLessons, ...copiedLessons],
  }) as T
}

export function updateTimetable<T extends AppDataV4>(data: T, timetableId: string, details: TimetableDetails): T {
  if (!isCompatibleAppDataV6(data) && !isCompatibleAppDataV7(data)) throw new Error('Valid v6 data is required')
  const existing = data.timetables.find((item) => item.id === timetableId)
  if (!existing) throw new Error('Timetable does not exist')
  writableProject(data, existing.projectId)
  const name = details.name.trim()
  const teacherName = details.teacherName?.trim() ?? null
  if (!name) throw new Error('Timetable name is required')
  if (!teacherName && !existing.teacherNamePending) throw new Error('Teacher name is required')
  const updated: Timetable = teacherName
    ? { ...existing, name, teacherName, teacherNamePending: undefined }
    : { ...existing, name, teacherName: null, teacherNamePending: true }
  return validResult(data, { ...data, timetables: data.timetables.map((item) => item.id === timetableId ? updated : item) }) as T
}

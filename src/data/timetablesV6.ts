import type { AppDataV4, AppDataV6, Timetable } from '../types'
import { isCompatibleAppDataV6, isSafeAppDataV6Update } from './validators/v6'

export interface TimetableDetails {
  name: string
  teacherName: string | null
}

function writableProject(data: AppDataV4, projectId: string): asserts data is AppDataV6 {
  if (!isCompatibleAppDataV6(data)) throw new Error('Valid v6 data is required')
  const project = data.projects.find((item) => item.id === projectId)
  if (!project || project.archivedAt) throw new Error('Archived or missing projects are read-only')
}

function validResult(current: AppDataV6, next: AppDataV6): AppDataV6 {
  if (!isSafeAppDataV6Update(current, next)) throw new Error('Timetable operation produced invalid AppData')
  return next
}

export function createTimetable(data: AppDataV4, projectId: string, details: TimetableDetails, id: string): AppDataV6 {
  writableProject(data, projectId)
  const name = details.name.trim()
  const teacherName = details.teacherName?.trim()
  if (!id.trim() || data.timetables.some((item) => item.id === id)) throw new Error('Timetable ID must be unique')
  if (!name || !teacherName) throw new Error('Timetable name and teacher name are required')
  const timetable: Timetable = { id, projectId, name, teacherName }
  return validResult(data, { ...data, timetables: [...data.timetables, timetable] })
}

export function updateTimetable(data: AppDataV4, timetableId: string, details: TimetableDetails): AppDataV6 {
  if (!isCompatibleAppDataV6(data)) throw new Error('Valid v6 data is required')
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
  return validResult(data, { ...data, timetables: data.timetables.map((item) => item.id === timetableId ? updated : item) })
}

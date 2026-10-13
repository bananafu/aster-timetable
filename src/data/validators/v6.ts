import type { AppDataV4, AppDataV6 } from '../../types'
import { isCompatibleAppDataV5 } from './v5'

const named = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

export function isCompatibleAppDataV6(value: unknown): value is AppDataV6 {
  try {
    if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 6) return false
    const data = value as AppDataV6
    if (!isCompatibleAppDataV5({ ...data, schemaVersion: 5 }) || !Array.isArray(data.timetables)) return false
    const projects = new Set(data.projects.map((item) => item.id))
    const timetableIds = new Set<string>()
    for (const timetable of data.timetables) {
      if (!timetable || !named(timetable.id) || timetableIds.has(timetable.id)
        || !projects.has(timetable.projectId) || !named(timetable.name)) return false
      const pending = timetable.teacherName === null && timetable.teacherNamePending === true
      const confirmed = named(timetable.teacherName) && timetable.teacherNamePending === undefined
      if (!pending && !confirmed) return false
      timetableIds.add(timetable.id)
    }
    if (data.projects.some((project) => !data.timetables.some((timetable) => timetable.projectId === project.id))) return false
    const timetableById = new Map(data.timetables.map((item) => [item.id, item]))
    const lessons = new Map(data.recurringLessons.map((item) => [item.id, item]))
    const series = new Map<string, string>()
    for (const lesson of data.recurringLessons) {
      if (!named(lesson.timetableId) || timetableById.get(lesson.timetableId)?.projectId !== lesson.projectId) return false
      const prior = series.get(lesson.seriesId)
      if (prior !== undefined && prior !== lesson.timetableId) return false
      series.set(lesson.seriesId, lesson.timetableId)
    }
    const groups = new Map<string, string | null>()
    for (const override of data.overrides) {
      if (override.projectId === null) {
        if (override.timetableId !== null) return false
      } else {
        if (!named(override.timetableId) || timetableById.get(override.timetableId)?.projectId !== override.projectId) return false
        if (override.originalLessonId) {
          const original = lessons.get(override.originalLessonId)
          if (!original || original.projectId !== override.projectId || original.teachingUnitId !== override.teachingUnitId
            || original.timetableId !== override.timetableId) return false
        }
      }
      if (override.groupId) {
        if (groups.has(override.groupId) && groups.get(override.groupId) !== override.timetableId) return false
        groups.set(override.groupId, override.timetableId)
      }
    }
    return true
  } catch {
    return false
  }
}

export function isSafeAppDataV6Update(current: AppDataV4, next: AppDataV4): boolean {
  if (!isCompatibleAppDataV6(next)) return false
  return next.teachingUnits.every((unit) => unit.periods.every((period) => {
    const fiveMinute = (time: string) => Number(time.slice(3)) % 5 === 0
    if (fiveMinute(period.startTime) && fiveMinute(period.endTime)) return true
    const original = current.teachingUnits.find((item) => item.id === unit.id && item.projectId === unit.projectId)
      ?.periods.find((item) => item.id === period.id)
    return original !== undefined && original.startTime === period.startTime && original.endTime === period.endTime
  }))
}

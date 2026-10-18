import type { AppDataV7 } from '../types'
import { isCompatibleAppDataV7, isSafeAppDataV7Update } from './validators/v7'

/** Deletes one teacher timetable and only records owned by that timetable. */
export function deleteTimetable(data: AppDataV7, projectId: string, timetableId: string): AppDataV7 {
  if (!isCompatibleAppDataV7(data)) throw new Error('目前資料不是有效的 AppDataV7。')
  const project = data.projects.find((item) => item.id === projectId)
  if (!project) throw new Error('找不到指定專案。')
  if (project.archivedAt) throw new Error('封存專案為唯讀，不能刪除課表。')
  if (!data.timetables.some((item) => item.id === timetableId && item.projectId === projectId)) {
    throw new Error('課表不存在或不屬於指定專案。')
  }

  const removedLessonIds = new Set(data.recurringLessons.filter((item) => item.timetableId === timetableId).map((item) => item.id))
  const removedOverrideIds = new Set(data.overrides.filter((item) => item.timetableId === timetableId).map((item) => item.id))
  const next: AppDataV7 = {
    ...data,
    timetables: data.timetables.filter((item) => item.id !== timetableId),
    recurringLessons: data.recurringLessons.filter((item) => item.timetableId !== timetableId),
    overrides: data.overrides.filter((item) => item.timetableId !== timetableId),
    oneOffLessons: data.oneOffLessons.filter((item) => item.timetableId !== timetableId),
    migrationWarnings: data.migrationWarnings.filter((item) => !(item.entityType === 'lesson' && removedLessonIds.has(item.entityId))
      && !(item.entityType === 'override' && removedOverrideIds.has(item.entityId))),
  }
  if (!isCompatibleAppDataV7(next) || !isSafeAppDataV7Update(data, next)) throw new Error('課表刪除結果未通過資料安全驗證。')
  return next
}

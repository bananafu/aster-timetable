import type { AppDataV5, AppDataV6 } from '../types'
import { isCompatibleAppDataV5 } from './validators/v5'
import { isCompatibleAppDataV6 } from './validators/v6'

export const legacyTimetableId = (projectId: string) => `legacy-timetable:${encodeURIComponent(projectId)}`

export function migrateV5ToV6(source: AppDataV5): AppDataV6 {
  if (!isCompatibleAppDataV5(source)) throw new Error('Invalid AppData v5')
  const migrated: AppDataV6 = {
    ...source,
    schemaVersion: 6,
    timetables: source.projects.map((project) => ({
      id: legacyTimetableId(project.id), projectId: project.id, name: project.name,
      teacherName: null, teacherNamePending: true,
    })),
    recurringLessons: source.recurringLessons.map((lesson) => ({
      ...lesson, timetableId: legacyTimetableId(lesson.projectId),
    })),
    overrides: source.overrides.map((override) => ({
      ...override, timetableId: override.projectId === null ? null : legacyTimetableId(override.projectId),
    })),
  }
  if (!isCompatibleAppDataV6(migrated)) throw new Error('Invalid AppData v6 migration')
  return migrated
}

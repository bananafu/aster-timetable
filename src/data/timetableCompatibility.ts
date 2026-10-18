import type { AppDataV4 } from '../types'

/** Legacy writers remain available only while a project has exactly one timetable. */
export function singleTimetableId(data: AppDataV4, projectId: string): string | undefined {
  if (data.schemaVersion < 6) return undefined
  const timetables = data.timetables?.filter((item) => item.projectId === projectId) ?? []
  if (timetables.length !== 1) throw new Error('Multiple or missing timetables require timetable-aware editing')
  return timetables[0].id
}

/** An explicit selection is required whenever a project contains multiple timetables. */
export function selectedTimetableId(data: AppDataV4, projectId: string, requestedId?: string | null): string | undefined {
  if (data.schemaVersion < 6) return undefined
  if (requestedId) {
    if (!data.timetables?.some((item) => item.id === requestedId && item.projectId === projectId)) {
      throw new Error('Timetable does not belong to the project')
    }
    return requestedId
  }
  return singleTimetableId(data, projectId)
}

export function assertLessonTimetable(data: AppDataV4, lessonId: string, requestedId?: string | null): string | undefined {
  const lesson = data.recurringLessons.find((item) => item.id === lessonId)
  if (!lesson) throw new Error('Lesson does not exist')
  const id = selectedTimetableId(data, lesson.projectId, requestedId)
  if (id !== undefined && lesson.timetableId !== id) throw new Error('Lesson does not belong to the selected timetable')
  return id
}

export const assertSingleTimetableForLesson = (data: AppDataV4, lessonId: string) => assertLessonTimetable(data, lessonId)

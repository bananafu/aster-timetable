import { fromDateKey } from './date'
import { resolveProjectDay, timeIntervalsOverlap, type ResolvedLessonV4 } from './scheduleV4'
import type { AppDataV4 } from '../types'
import { selectedTimetableId } from '../data/timetableCompatibility'

export interface LessonDragIntent {
  lessonId: string
  projectId: string
  timetableId: string | null
  sourceDate: string
  targetDate: string
  targetPeriodId: number
  targetStartTime: string
  targetEndTime: string
  conflictLessonIds: string[]
}

export type LessonDropResult = { valid: true; intent: LessonDragIntent } | { valid: false; reason: string }

export function createLessonDragIntent(
  data: AppDataV4,
  lesson: ResolvedLessonV4,
  target: { date: string; startTime: string; endTime: string; timetableId?: string },
): LessonDropResult {
  const project = data.projects.find((item) => item.id === lesson.projectId)
  if (!project || project.archivedAt) return { valid: false, reason: '封存或不存在的專案不可拖曳。' }
  if (lesson.status !== 'regular' || lesson.overrideId) return { valid: false, reason: '此課程已有單日異動，請開啟編輯器後使用「修改此異動」。' }
  const source = data.recurringLessons.find((item) => item.id === lesson.id)
  const unit = source ? data.teachingUnits.find((item) => item.id === source.teachingUnitId) : undefined
  if (!source || !unit || source.projectId !== lesson.projectId) return { valid: false, reason: '找不到課程原本的任教單位。' }
  let timetableId: string | undefined
  try { timetableId = selectedTimetableId(data, lesson.projectId, lesson.timetableId) }
  catch { return { valid: false, reason: '請先選擇有效的教師課表。' } }
  if (data.schemaVersion === 6 && (source.timetableId !== timetableId || target.timetableId !== timetableId)) return { valid: false, reason: '拖曳來源與目標必須屬於同一份教師課表。' }
  if (target.date < unit.startDate || target.date > unit.endDate) return { valid: false, reason: '目標日期不在原任教單位的學期範圍內。' }
  const period = unit.periods.find((item) => item.startTime === target.startTime && item.endTime === target.endTime)
  if (!period) return { valid: false, reason: '原任教單位沒有相同實際起訖時間的節次，無法安全跨校映射。' }
  if (target.date === lesson.date && period.id === lesson.periodId) return { valid: false, reason: '目標位置與原位置相同。' }
  const conflicts = resolveProjectDay(data, lesson.projectId, fromDateKey(target.date), { timetableId }).filter((item) => item.status !== 'cancelled'
    && item.id !== lesson.id && timeIntervalsOverlap(item, { startTime: period.startTime, endTime: period.endTime }))
  return {
    valid: true,
    intent: {
      lessonId: lesson.id, projectId: lesson.projectId, timetableId: timetableId ?? null, sourceDate: lesson.date, targetDate: target.date,
      targetPeriodId: period.id, targetStartTime: period.startTime, targetEndTime: period.endTime,
      conflictLessonIds: conflicts.map((item) => item.id),
    },
  }
}

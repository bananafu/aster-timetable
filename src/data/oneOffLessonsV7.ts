import type { AppDataV7, OneOffLesson } from '../types'
import { fromDateKey } from '../lib/date'
import { subjectAppliesToLevel } from '../lib/subjects'
import { resolveProjectDay, timeIntervalsOverlap, type ResolvedScheduleOccurrence } from '../lib/scheduleV4'
import { isCompatibleAppDataV7, isSafeAppDataV7Update } from './validators/v7'

export type OneOffLessonDraft = Omit<OneOffLesson, 'id'>

export type OneOffReferenceTarget =
  | { kind: 'subject' | 'class' | 'teaching-unit' | 'school' | 'project' | 'timetable'; id: string }
  | { kind: 'period'; teachingUnitId: string; periodId: number }

/** Read-only impact query for settings and future confirmation UI. */
export function getOneOffReferences(data: AppDataV7, target: OneOffReferenceTarget): OneOffLesson[] {
  const schoolUnits = target.kind === 'school'
    ? new Set(data.teachingUnits.filter((unit) => unit.schoolId === target.id).map((unit) => unit.id)) : null
  return data.oneOffLessons.filter((lesson) => {
    switch (target.kind) {
      case 'subject': return lesson.subjectId === target.id
      case 'class': return lesson.classId === target.id
      case 'teaching-unit': return lesson.teachingUnitId === target.id
      case 'school': return schoolUnits!.has(lesson.teachingUnitId)
      case 'project': return lesson.projectId === target.id
      case 'timetable': return lesson.timetableId === target.id
      case 'period': return lesson.teachingUnitId === target.teachingUnitId
        && lesson.time.mode === 'period' && lesson.time.periodId === target.periodId
    }
  }).map((lesson) => ({ ...lesson, time: { ...lesson.time } }))
}

export class OneOffConflictError extends Error {
  constructor(public readonly conflicts: ResolvedScheduleOccurrence[]) {
    super(`目標時段已有 ${conflicts.length} 堂課；只有明確允許衝堂才能儲存。`)
  }
}

const dateKey = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
const fiveMinuteTime = (value: string) => /^([01]\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$/.test(value)

function assertValidDraft(data: AppDataV7, draft: OneOffLessonDraft, editingId?: string) {
  if (!isCompatibleAppDataV7(data)) throw new Error('目前 AppDataV7 無效，無法安全修改單日課程。')
  const original = editingId ? data.oneOffLessons.find((item) => item.id === editingId) : undefined
  if (editingId && !original) throw new Error('找不到要編輯的單日課程。')
  if (original && (original.projectId !== draft.projectId || original.timetableId !== draft.timetableId)) {
    throw new Error('單日課程不可跨專案或教師課表編輯。')
  }
  const project = data.projects.find((item) => item.id === draft.projectId)
  const timetable = data.timetables.find((item) => item.id === draft.timetableId)
  const unit = data.teachingUnits.find((item) => item.id === draft.teachingUnitId)
  const schoolClass = data.classes.find((item) => item.id === draft.classId)
  const subject = data.subjects.find((item) => item.id === draft.subjectId)
  if (!project || project.archivedAt) throw new Error('封存或不存在的專案不可修改單日課程。')
  if (!timetable || timetable.projectId !== project.id) throw new Error('教師課表不屬於所選專案。')
  if (!unit || unit.projectId !== project.id || !data.schools.some((school) => school.id === unit.schoolId && school.projectId === project.id)) {
    throw new Error('學制或學校不屬於所選專案。')
  }
  if (!schoolClass || schoolClass.projectId !== project.id || schoolClass.teachingUnitId !== unit.id) throw new Error('班級不屬於所選學制。')
  if (!subject || !subjectAppliesToLevel(subject, unit.schoolLevel)) throw new Error('科目不適用於所選學制。')
  if (!dateKey(draft.date) || draft.date < unit.startDate || draft.date > unit.endDate) throw new Error('日期不在所選學制的有效學期範圍內。')
  if (!['extra', 'make-up', 'substitute'].includes(draft.purpose)) throw new Error('單日課程用途不正確。')
  if (draft.relatedRecurringLessonId !== undefined) {
    if (draft.purpose !== 'make-up' || !draft.relatedRecurringLessonId.trim()) throw new Error('只有補課可設定有效的固定課程來源 ID。')
    const source = data.recurringLessons.find((item) => item.id === draft.relatedRecurringLessonId)
    if (source && (source.projectId !== draft.projectId || source.timetableId !== draft.timetableId)) throw new Error('補課來源不屬於同一專案與教師課表。')
  }
  if (draft.time.mode === 'period') {
    const period = unit.periods.find((item) => item.id === draft.time.periodId)
    if (!period) throw new Error('節次不屬於所選學制。')
    return { startTime: period.startTime, endTime: period.endTime }
  }
  if (draft.time.mode !== 'custom' || !fiveMinuteTime(draft.time.startTime) || !fiveMinuteTime(draft.time.endTime)
    || draft.time.endTime <= draft.time.startTime) throw new Error('自訂時間須為 24 小時制、5 分鐘粒度，且結束晚於開始。')
  return { startTime: draft.time.startTime, endTime: draft.time.endTime }
}

/** Evaluates against the supplied latest snapshot; cancelled recurring occurrences do not occupy time. */
export function getOneOffLessonConflicts(data: AppDataV7, draft: OneOffLessonDraft, editingId?: string): ResolvedScheduleOccurrence[] {
  const time = assertValidDraft(data, draft, editingId)
  return resolveProjectDay(data, draft.projectId, fromDateKey(draft.date), { timetableId: draft.timetableId })
    .filter((item) => (item.kind === 'one-off' || item.status !== 'cancelled')
      && !(editingId && item.kind === 'one-off' && item.id === editingId)
      && timeIntervalsOverlap(item, time))
}

function assertSafeResult(current: AppDataV7, next: AppDataV7): AppDataV7 {
  if (!isSafeAppDataV7Update(current, next)) throw new Error('單日課程變更未通過資料驗證；沒有寫入部分資料。')
  return next
}

function usedId(data: AppDataV7, id: string) {
  return [
    ...data.projects.map((item) => item.id), ...data.timetables.map((item) => item.id),
    ...data.schools.map((item) => item.id), ...data.teachingUnits.map((item) => item.id),
    ...data.subjects.map((item) => item.id), ...data.classes.map((item) => item.id),
    ...data.recurringLessons.flatMap((item) => [item.id, item.seriesId]),
    ...data.events.map((item) => item.id), ...data.overrides.map((item) => item.id),
    ...data.migrationWarnings.map((item) => item.id), ...data.oneOffLessons.map((item) => item.id),
  ].includes(id)
}

/** Pass crypto.randomUUID as createId from the caller; injectable generation keeps this data operation testable. */
export function createOneOffLesson(data: AppDataV7, draft: OneOffLessonDraft, createId: () => string, allowConflict = false): AppDataV7 {
  const conflicts = getOneOffLessonConflicts(data, draft)
  if (conflicts.length && !allowConflict) throw new OneOffConflictError(conflicts)
  const id = createId()
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || usedId(data, id)) {
    throw new Error('新單日課程 ID 必須是未使用的 UUID。')
  }
  return assertSafeResult(data, { ...data, oneOffLessons: [...data.oneOffLessons, { ...draft, id, time: { ...draft.time } }] })
}

export function updateOneOffLesson(data: AppDataV7, id: string, draft: OneOffLessonDraft, allowConflict = false): AppDataV7 {
  const conflicts = getOneOffLessonConflicts(data, draft, id)
  if (conflicts.length && !allowConflict) throw new OneOffConflictError(conflicts)
  return assertSafeResult(data, { ...data, oneOffLessons: data.oneOffLessons.map((item) => item.id === id ? { ...draft, id, time: { ...draft.time } } : item) })
}

export function deleteOneOffLesson(data: AppDataV7, id: string): AppDataV7 {
  if (!isCompatibleAppDataV7(data)) throw new Error('目前 AppDataV7 無效，無法安全刪除單日課程。')
  const existing = data.oneOffLessons.find((item) => item.id === id)
  if (!existing) throw new Error('找不到要刪除的單日課程。')
  if (data.projects.find((item) => item.id === existing.projectId)?.archivedAt) throw new Error('封存專案為唯讀，無法刪除單日課程。')
  return assertSafeResult(data, { ...data, oneOffLessons: data.oneOffLessons.filter((item) => item.id !== id) })
}

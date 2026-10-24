import type { AppDataV8, SchoolPeriod, TeachingUnit } from '../types'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

export type SchoolV8Draft = { name: string; color: string }
export type TeachingUnitV8Draft = Pick<TeachingUnit, 'schoolId' | 'name' | 'schoolLevel' | 'startDate' | 'endDate' | 'periods' | 'weekCycle'>

function safe(current: AppDataV8, next: AppDataV8): AppDataV8 {
  if (!isCompatibleAppDataV8(current) || !isCompatibleAppDataV8(next) || !isSafeAppDataV8Update(current, next)) {
    throw new Error('設定未通過 V8 validator 或安全更新檢查。')
  }
  return next
}
function project(data: AppDataV8, projectId: string) {
  if (!data.projects.some((item) => item.id === projectId && !item.archivedAt)) throw new Error('專案不存在或為唯讀。')
}
function validId(data: AppDataV8, id: string) {
  if (!id || [data.projects, data.schools, data.teachingUnits, data.timetables, data.subjects,
    data.classes, data.recurringLessons, data.oneOffLessons, data.overrides, data.events,
    data.teachingProgress, data.teachingUnitSubjects].some((items) => items.some((item) => item.id === id))) {
    throw new Error('設定 ID 不合法或重複。')
  }
}
function validSchool(draft: SchoolV8Draft) {
  if (!draft.name.trim() || !/^#[0-9a-f]{6}$/i.test(draft.color)) throw new Error('學校名稱或顏色不合法。')
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
function validPeriods(periods: SchoolPeriod[]) {
  if (!periods.length || new Set(periods.map((item) => item.id)).size !== periods.length
    || new Set(periods.map((item) => item.order)).size !== periods.length) throw new Error('節次編號或順序不合法。')
  const time = /^([01]\d|2[0-3]):(00|05|10|15|20|25|30|35|40|45|50|55)$/
  const chronological = [...periods].sort((a, b) => a.startTime.localeCompare(b.startTime))
  if (chronological.some((item, index) => !Number.isInteger(item.id) || !Number.isInteger(item.order)
    || !item.label.trim() || !time.test(item.startTime) || !time.test(item.endTime)
    || item.startTime >= item.endTime || (index > 0 && chronological[index - 1].endTime > item.startTime))) {
    throw new Error('節次名稱或實際時間不合法、非五分鐘間隔，或時段重疊。')
  }
}
function validUnit(data: AppDataV8, projectId: string, draft: TeachingUnitV8Draft, exceptId?: string) {
  if (!data.schools.some((item) => item.id === draft.schoolId && item.projectId === projectId)
    || !draft.name.trim() || !date(draft.startDate) || !date(draft.endDate)
    || draft.startDate > draft.endDate || !date(draft.weekCycle.anchorDate)
    || !['A', 'B'].includes(draft.weekCycle.anchorPattern)
    || data.teachingUnits.some((item) => item.id !== exceptId && item.schoolId === draft.schoolId
      && item.schoolLevel === draft.schoolLevel)) throw new Error('任教單位、學期日期或 A/B 錨點不合法。')
  validPeriods(draft.periods)
}
function hasUnitReferences(data: AppDataV8, unitId: string) {
  return [data.classes, data.teachingUnitSubjects, data.recurringLessons, data.oneOffLessons,
    data.overrides, data.events, data.teachingProgress].some((items) =>
    items.some((item) => item.teachingUnitId === unitId))
}
const normalized = (draft: TeachingUnitV8Draft): TeachingUnitV8Draft => ({ ...draft,
  name: draft.name.trim(), periods: draft.periods.map((item) => ({ ...item, label: item.label.trim() })),
  weekCycle: { ...draft.weekCycle } })

export function createSchoolV8(data: AppDataV8, projectId: string, draft: SchoolV8Draft, id: string): AppDataV8 {
  project(data, projectId); validId(data, id); validSchool(draft)
  return safe(data, { ...data, schools: [...data.schools, { id, projectId, name: draft.name.trim(), color: draft.color }] })
}
export function updateSchoolV8(data: AppDataV8, projectId: string, id: string, draft: SchoolV8Draft): AppDataV8 {
  project(data, projectId); validSchool(draft)
  if (!data.schools.some((item) => item.id === id && item.projectId === projectId)) throw new Error('學校不屬於目前專案。')
  return safe(data, { ...data, schools: data.schools.map((item) => item.id === id
    ? { ...item, name: draft.name.trim(), color: draft.color } : item) })
}
export function createTeachingUnitV8(data: AppDataV8, projectId: string, draft: TeachingUnitV8Draft, id: string): AppDataV8 {
  project(data, projectId); validId(data, id); validUnit(data, projectId, draft)
  return safe(data, { ...data, teachingUnits: [...data.teachingUnits, { id, projectId, timezone: 'Asia/Taipei',
    ...normalized(draft) }] })
}
export function updateTeachingUnitV8(data: AppDataV8, projectId: string, id: string, draft: TeachingUnitV8Draft): AppDataV8 {
  project(data, projectId)
  const existing = data.teachingUnits.find((item) => item.id === id && item.projectId === projectId)
  if (!existing) throw new Error('任教單位不屬於目前專案。')
  validUnit(data, projectId, draft, id)
  const nextDraft = normalized(draft)
  if (hasUnitReferences(data, id) && (existing.schoolId !== nextDraft.schoolId
    || existing.schoolLevel !== nextDraft.schoolLevel || existing.startDate !== nextDraft.startDate
    || existing.endDate !== nextDraft.endDate || JSON.stringify(existing.weekCycle) !== JSON.stringify(nextDraft.weekCycle)
    || JSON.stringify(existing.periods) !== JSON.stringify(nextDraft.periods))) {
    throw new Error('任教單位已有班級、任教配置、課程、事件或進度引用；不得更動學校、學制、學期、A/B 錨點或節次。')
  }
  return safe(data, { ...data, teachingUnits: data.teachingUnits.map((item) => item.id === id
    ? { ...item, ...nextDraft } : item) })
}

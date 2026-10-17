import type { AppDataV4, SchoolLevel, SchoolPeriod, TeachingUnit } from '../types'
import { formatClassCode, isGradeValidForLevel } from '../lib/classes'

export interface SchoolDraft { name: string; color: string }
export interface TeachingUnitDraft {
  name: string
  schoolLevel: SchoolLevel
  startDate: string
  endDate: string
  periods: SchoolPeriod[]
  weekCycle: TeachingUnit['weekCycle']
}
export interface ClassDraft { name?: string; grade?: number; classNumber?: number; room?: string; teachingUnitId: string }

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function minutes(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function timeFromMinutes(value: number) {
  const normalized = Math.max(0, Math.min(value, 23 * 60 + 55))
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function validatePeriods(periods: SchoolPeriod[]) {
  if (!periods.length) throw new Error('任教單位至少需要一個節次。')
  if (new Set(periods.map((item) => item.id)).size !== periods.length) throw new Error('節次 ID 不得重複。')
  if (new Set(periods.map((item) => item.order)).size !== periods.length) throw new Error('節次順序不得重複。')
  const chronological = [...periods].sort((a, b) => a.startTime.localeCompare(b.startTime))
  chronological.forEach((period, index) => {
    if (!period.label.trim() || !TIME_PATTERN.test(period.startTime) || !TIME_PATTERN.test(period.endTime)) throw new Error('節次名稱或時間格式不正確。')
    if (minutes(period.startTime) % 5 !== 0 || minutes(period.endTime) % 5 !== 0) throw new Error('節次時間必須以 5 分鐘為間距。')
    if (period.startTime >= period.endTime) throw new Error('節次結束時間必須晚於開始時間。')
    if (index > 0 && chronological[index - 1].endTime > period.startTime) throw new Error('節次時間不得重疊。')
  })
}

export function createDefaultPeriods(level: SchoolLevel, count = 8, firstStart = '08:10'): SchoolPeriod[] {
  const duration = level === 'junior-high' ? 45 : 50
  let start = minutes(firstStart)
  return Array.from({ length: count }, (_, index) => {
    const end = start + duration
    const period = { id: index + 1, order: index + 1, label: `第 ${index + 1} 節`, startTime: timeFromMinutes(start), endTime: timeFromMinutes(end) }
    start = end + 10
    return period
  })
}

export function addSchool(data: AppDataV4, projectId: string, draft: SchoolDraft, id: string): AppDataV4 {
  if (!data.projects.some((item) => item.id === projectId) || !draft.name.trim() || !/^#[0-9a-f]{6}$/i.test(draft.color) || data.schools.some((item) => item.id === id)) throw new Error('學校資料不正確。')
  return { ...data, schools: [...data.schools, { id, projectId, name: draft.name.trim(), color: draft.color }] }
}

export function updateSchool(data: AppDataV4, schoolId: string, draft: SchoolDraft): AppDataV4 {
  if (!draft.name.trim() || !/^#[0-9a-f]{6}$/i.test(draft.color) || !data.schools.some((item) => item.id === schoolId)) throw new Error('學校資料不正確。')
  return { ...data, schools: data.schools.map((item) => item.id === schoolId ? { ...item, name: draft.name.trim(), color: draft.color } : item) }
}

export function removeSchool(data: AppDataV4, schoolId: string): AppDataV4 {
  const school = data.schools.find((item) => item.id === schoolId)
  if (!school) throw new Error('找不到學校。')
  if (data.teachingUnits.some((item) => item.schoolId === schoolId)) throw new Error('此學校仍有任教單位，請先安全移除任教單位。')
  if (data.schools.filter((item) => item.projectId === school.projectId).length <= 1) throw new Error('專案至少需要保留一所學校。')
  return { ...data, schools: data.schools.filter((item) => item.id !== schoolId) }
}

export function addTeachingUnit(data: AppDataV4, schoolId: string, draft: Omit<TeachingUnitDraft, 'periods'> & { periods?: SchoolPeriod[] }, id: string): AppDataV4 {
  const school = data.schools.find((item) => item.id === schoolId)
  const periods = draft.periods ?? createDefaultPeriods(draft.schoolLevel)
  if (!school || data.teachingUnits.some((item) => item.id === id)) throw new Error('找不到所屬學校或任教單位 ID 重複。')
  if (data.teachingUnits.some((item) => item.schoolId === schoolId && item.schoolLevel === draft.schoolLevel)) throw new Error('同一學校不可重複建立相同學制。')
  validateTeachingUnitDraft({ ...draft, periods })
  return { ...data, teachingUnits: [...data.teachingUnits, { id, projectId: school.projectId, schoolId, timezone: 'Asia/Taipei', ...draft, name: draft.name.trim(), periods: periods.map((item) => ({ ...item })), weekCycle: { ...draft.weekCycle } }] }
}

function validateTeachingUnitDraft(draft: TeachingUnitDraft) {
  if (!draft.name.trim() || !DATE_PATTERN.test(draft.startDate) || !DATE_PATTERN.test(draft.endDate) || draft.startDate > draft.endDate) throw new Error('任教單位名稱或日期範圍不正確。')
  if (!DATE_PATTERN.test(draft.weekCycle.anchorDate)) throw new Error('A/B 週基準日期不正確。')
  validatePeriods(draft.periods)
}

export function updateTeachingUnit(data: AppDataV4, unitId: string, draft: TeachingUnitDraft): AppDataV4 {
  const unit = data.teachingUnits.find((item) => item.id === unitId)
  if (!unit) throw new Error('找不到任教單位。')
  if (data.teachingUnits.some((item) => item.id !== unitId && item.schoolId === unit.schoolId && item.schoolLevel === draft.schoolLevel)) throw new Error('同一學校不可重複建立相同學制。')
  validateTeachingUnitDraft(draft)
  const referencedPeriodIds = new Set([
    ...data.recurringLessons.filter((item) => item.teachingUnitId === unitId).map((item) => item.periodId),
    ...data.overrides.filter((item) => item.teachingUnitId === unitId).map((item) => item.periodId),
  ])
  if ([...referencedPeriodIds].some((id) => !draft.periods.some((period) => period.id === id))) throw new Error('無法移除仍被課程或異動引用的節次。')
  if (!draft.weekCycle.enabled && data.recurringLessons.some((item) => item.teachingUnitId === unitId && item.weekPattern !== 'every')) throw new Error('仍有 A/B 週課程，無法停用輪週。')
  if (data.recurringLessons.some((item) => item.teachingUnitId === unitId && (item.effectiveStart < draft.startDate || (item.effectiveEnd ?? item.effectiveStart) > draft.endDate))) throw new Error('日期範圍會排除既有固定課程版本，無法儲存。')
  if (data.overrides.some((item) => item.teachingUnitId === unitId && (item.date < draft.startDate || item.date > draft.endDate))) throw new Error('日期範圍會排除既有單日異動，無法儲存。')
  return {
    ...data,
    teachingUnits: data.teachingUnits.map((item) => item.id === unitId ? { ...item, ...draft, name: draft.name.trim(), periods: draft.periods.map((period) => ({ ...period })), weekCycle: { ...draft.weekCycle } } : item),
    events: data.events.map((item) => item.teachingUnitId === unitId && (item.date < draft.startDate || item.date > draft.endDate) ? { ...item, teachingUnitId: null } : item),
  }
}

export function removeTeachingUnit(data: AppDataV4, unitId: string): AppDataV4 {
  const unit = data.teachingUnits.find((item) => item.id === unitId)
  if (!unit) throw new Error('找不到任教單位。')
  if (data.classes.some((item) => item.teachingUnitId === unitId)
    || data.recurringLessons.some((item) => item.teachingUnitId === unitId)
    || data.events.some((item) => item.teachingUnitId === unitId)
    || data.overrides.some((item) => item.teachingUnitId === unitId)) throw new Error('任教單位仍被班級、課程、事件或異動引用，無法刪除。')
  if (data.teachingUnits.filter((item) => item.projectId === unit.projectId).length <= 1) throw new Error('專案至少需要保留一個任教單位。')
  return { ...data, teachingUnits: data.teachingUnits.filter((item) => item.id !== unitId) }
}

export function addClass(data: AppDataV4, projectId: string, draft: ClassDraft, id: string): AppDataV4 {
  const unit = data.teachingUnits.find((item) => item.id === draft.teachingUnitId && item.projectId === projectId)
  if (!unit || data.classes.some((item) => item.id === id)) throw new Error('班級資料或所屬學制不正確。')
  const structured = draft.grade !== undefined || draft.classNumber !== undefined
  if (structured && (draft.grade === undefined || draft.classNumber === undefined || !isGradeValidForLevel(unit.schoolLevel, draft.grade) || !Number.isInteger(draft.classNumber) || draft.classNumber <= 0)) throw new Error('年級或班號不符合所選學制。')
  if (!structured && !draft.name?.trim()) throw new Error('班級名稱不得為空白。')
  if (structured && data.classes.some((item) => item.teachingUnitId === unit.id && item.grade === draft.grade && item.classNumber === draft.classNumber)) throw new Error('此學制已存在相同年級與班號。')
  const name = structured ? formatClassCode(draft.grade!, draft.classNumber!) : draft.name!.trim()
  return { ...data, classes: [...data.classes, { id, projectId, teachingUnitId: unit.id, name, grade: draft.grade, classNumber: draft.classNumber, room: draft.room?.trim() || undefined, origin: 'user' }] }
}

export function updateClass(data: AppDataV4, classId: string, draft: ClassDraft): AppDataV4 {
  const schoolClass = data.classes.find((item) => item.id === classId)
  const unit = data.teachingUnits.find((item) => item.id === draft.teachingUnitId && item.projectId === schoolClass?.projectId)
  if (!schoolClass || !unit) throw new Error('班級資料或所屬學制不正確。')
  const structured = draft.grade !== undefined || draft.classNumber !== undefined
  if (structured && (draft.grade === undefined || draft.classNumber === undefined || !isGradeValidForLevel(unit.schoolLevel, draft.grade) || !Number.isInteger(draft.classNumber) || draft.classNumber <= 0)) throw new Error('年級或班號不符合所選學制。')
  if (!structured && !draft.name?.trim()) throw new Error('班級名稱不得為空白。')
  if (structured && data.classes.some((item) => item.id !== classId && item.teachingUnitId === unit.id && item.grade === draft.grade && item.classNumber === draft.classNumber)) throw new Error('此學制已存在相同年級與班號。')
  if (schoolClass.teachingUnitId !== unit.id && (data.recurringLessons.some((item) => item.classId === classId)
    || data.overrides.some((item) => item.replacement?.classId === classId))) throw new Error('班級已有課程或異動引用，無法直接移至其他任教單位。')
  const name = structured ? formatClassCode(draft.grade!, draft.classNumber!) : draft.name!.trim()
  return { ...data, classes: data.classes.map((item) => item.id === classId ? { ...item, teachingUnitId: unit.id, name, grade: draft.grade, classNumber: draft.classNumber, room: draft.room?.trim() || undefined, origin: 'user' } : item) }
}

export function removeClass(data: AppDataV4, classId: string): AppDataV4 {
  if (!data.classes.some((item) => item.id === classId)) throw new Error('找不到班級。')
  if (data.recurringLessons.some((item) => item.classId === classId)
    || data.overrides.some((item) => item.replacement?.classId === classId)) throw new Error('班級仍被課程或異動引用，無法刪除。')
  return { ...data, classes: data.classes.filter((item) => item.id !== classId) }
}

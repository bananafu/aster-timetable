import { SCHOOL_LEVELS, type AppDataV4, type SchoolLevel, type SchoolPeriod, type TeachingUnit } from '../types'
import { isSafeAppDataV4Update } from './validators/v4'
import { isSafeAppDataV5Update } from './validators/v5'
import { isSafeAppDataV6Update } from './validators/v6'
import { isSafeAppDataV7Update } from './validators/v7'
import { addSchool, addTeachingUnit, type SchoolDraft } from './academicSettingsV4'

export interface SchoolUnitCreationContext {
  projectId: string
  /** Pass the current view's read-only state (including archived history views). */
  readOnly: boolean
}

export interface NewTeachingUnitInput {
  schoolLevel: SchoolLevel
  name?: string
  startDate: string
  endDate: string
  periods?: SchoolPeriod[]
  weekCycle?: TeachingUnit['weekCycle']
}

const DEFAULT_NAMES: Record<SchoolLevel, string> = {
  'junior-high': '國中部',
  'senior-high': '高中部',
  other: '',
}

function assertEditable(data: AppDataV4, context: SchoolUnitCreationContext) {
  const project = data.projects.find((item) => item.id === context.projectId)
  if (context.readOnly || !project || project.archivedAt || data.activeProjectId !== context.projectId) {
    throw new Error('目前專案不可編輯或已封存。')
  }
}

function assertUnusedIds(data: AppDataV4, ...ids: string[]) {
  const existing = new Set([
    ...data.projects, ...(data.timetables ?? []), ...data.schools, ...data.teachingUnits,
    ...data.subjects, ...data.classes, ...data.recurringLessons, ...data.events,
    ...data.overrides, ...data.migrationWarnings,
  ].map((item) => item.id))
  if (ids.some((id) => !id || id !== id.trim() || existing.has(id)) || new Set(ids).size !== ids.length) {
    throw new Error('新學校或學制 ID 無效或已被使用。')
  }
}

function unitDraft(input: NewTeachingUnitInput) {
  if (!SCHOOL_LEVELS.includes(input.schoolLevel)) throw new Error('學制類型不正確。')
  const name = input.name?.trim() || DEFAULT_NAMES[input.schoolLevel]
  if (!name) throw new Error('其他學制需要可辨識的自訂名稱。')
  return {
    name,
    schoolLevel: input.schoolLevel,
    startDate: input.startDate,
    endDate: input.endDate,
    periods: input.periods,
    weekCycle: input.weekCycle ?? { enabled: true, anchorDate: input.startDate, anchorPattern: 'A' as const },
  }
}

function assertSafeUpdate(current: AppDataV4, next: AppDataV4) {
  const safe = current.schemaVersion === 7 ? isSafeAppDataV7Update(current, next)
    : current.schemaVersion === 6 ? isSafeAppDataV6Update(current, next)
    : current.schemaVersion === 5 ? isSafeAppDataV5Update(current, next)
      : isSafeAppDataV4Update(current, next)
  if (!safe) throw new Error('學校與學制資料未通過安全驗證，未寫入任何資料。')
  return next
}

/** Call once inside setData(current => createSchoolWithTeachingUnit(current, ...)). */
export function createSchoolWithTeachingUnit(
  current: AppDataV4,
  context: SchoolUnitCreationContext,
  school: SchoolDraft,
  unit: NewTeachingUnitInput,
  ids: { schoolId: string; teachingUnitId: string },
): AppDataV4 {
  assertEditable(current, context)
  assertUnusedIds(current, ids.schoolId, ids.teachingUnitId)
  const withSchool = addSchool(current, context.projectId, school, ids.schoolId)
  const next = addTeachingUnit(withSchool, ids.schoolId, unitDraft(unit), ids.teachingUnitId)
  return assertSafeUpdate(current, next)
}

/** Call once inside setData(current => addTeachingUnitToSchool(current, ...)). */
export function addTeachingUnitToSchool(
  current: AppDataV4,
  context: SchoolUnitCreationContext,
  schoolId: string,
  unit: NewTeachingUnitInput,
  teachingUnitId: string,
): AppDataV4 {
  assertEditable(current, context)
  const school = current.schools.find((item) => item.id === schoolId && item.projectId === context.projectId)
  if (!school) throw new Error('所選學校不屬於目前專案。')
  assertUnusedIds(current, teachingUnitId)
  const next = addTeachingUnit(current, school.id, unitDraft(unit), teachingUnitId)
  return assertSafeUpdate(current, next)
}

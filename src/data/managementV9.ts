import type { AppDataV9 } from '../types/v9'
import type { ClassV8Draft } from './classesV8'
import type { CopyProjectV8Input } from './projectRuntimeV8'
import type { SchoolV8Draft, TeachingUnitV8Draft } from './academicSettingsV8'
import { createSchoolV8, createTeachingUnitV8, updateSchoolV8, updateTeachingUnitV8 } from './academicSettingsV8'
import { createClassV8, deleteClassV8, getClassV8Impact, updateClassV8 } from './classesV8'
import { copyProject, deleteProject, getProjectDeletionImpact } from './projectRuntimeV8'
import { asV8ValidationProjection, isCompatibleAppDataV9, isSafeAppDataV9Update } from './validators/v9'

const valid = (data: AppDataV9) => {
  if (!isCompatibleAppDataV9(data)) throw new Error('教師科目庫文件未通過驗證。')
}
const safe = (current: AppDataV9, next: AppDataV9): AppDataV9 => {
  if (!isSafeAppDataV9Update(current, next)) throw new Error('管理操作未通過新版資料安全檢查。')
  return next
}

/** Reuses the established V8 resource rules; only the selected entity collection is copied back. */
export function createSchoolV9(data: AppDataV9, projectId: string, draft: SchoolV8Draft, id: string): AppDataV9 {
  valid(data)
  return safe(data, { ...data, schools: createSchoolV8(asV8ValidationProjection(data), projectId, draft, id).schools })
}
export function updateSchoolV9(data: AppDataV9, projectId: string, id: string, draft: SchoolV8Draft): AppDataV9 {
  valid(data)
  return safe(data, { ...data, schools: updateSchoolV8(asV8ValidationProjection(data), projectId, id, draft).schools })
}
export function createTeachingUnitV9(data: AppDataV9, projectId: string, draft: TeachingUnitV8Draft, id: string): AppDataV9 {
  valid(data)
  return safe(data, { ...data, teachingUnits: createTeachingUnitV8(asV8ValidationProjection(data), projectId, draft, id).teachingUnits })
}
export function updateTeachingUnitV9(data: AppDataV9, projectId: string, id: string, draft: TeachingUnitV8Draft): AppDataV9 {
  valid(data)
  return safe(data, { ...data, teachingUnits: updateTeachingUnitV8(asV8ValidationProjection(data), projectId, id, draft).teachingUnits })
}
export function createClassV9(data: AppDataV9, projectId: string, draft: ClassV8Draft, id: string): AppDataV9 {
  valid(data)
  return safe(data, { ...data, classes: createClassV8(asV8ValidationProjection(data), projectId, draft, id).classes })
}
export function updateClassV9(data: AppDataV9, projectId: string, classId: string, draft: ClassV8Draft): AppDataV9 {
  valid(data)
  return safe(data, { ...data, classes: updateClassV8(asV8ValidationProjection(data), projectId, classId, draft).classes })
}
export function deleteClassV9(data: AppDataV9, projectId: string, classId: string, confirmed = false): AppDataV9 {
  valid(data)
  return safe(data, { ...data, classes: deleteClassV8(asV8ValidationProjection(data), projectId, classId, confirmed).classes })
}
export function getClassV9Impact(data: AppDataV9, projectId: string, classId: string) {
  valid(data)
  return getClassV8Impact(asV8ValidationProjection(data), projectId, classId)
}

export function copyProjectV9(data: AppDataV9, input: CopyProjectV8Input, createId: () => string): AppDataV9 {
  valid(data)
  const sourceTables = data.timetables.filter((item) => item.projectId === input.sourceProjectId)
  if (!sourceTables.length) return copyProjectWithoutTimetables(data, input, createId)
  const projected = copyProject(asV8ValidationProjection(data), input, createId)
  const newProjectId = projected.activeProjectId!
  const copiedTables = projected.timetables.filter((item) => item.projectId === newProjectId)
  const tableIds = new Map(sourceTables.map((item, index) => [item.id, copiedTables[index]?.id]))
  const sourceSubjects = data.subjects.filter((item) => item.projectId === input.sourceProjectId)
  const copiedSubjects = projected.subjects.filter((item) => item.projectId === newProjectId)
  if (sourceSubjects.length !== copiedSubjects.length || sourceTables.length !== copiedTables.length
    || sourceSubjects.some((item) => !tableIds.get(item.timetableId))) {
    throw new Error('教師課表與科目的複製對應不完整。')
  }
  return safe(data, { ...projected, schemaVersion: 9,
    subjects: [...data.subjects, ...sourceSubjects.map((item, index) => ({ ...item,
      id: copiedSubjects[index].id, projectId: newProjectId, timetableId: tableIds.get(item.timetableId)!,
      applicableSchoolLevels: [...item.applicableSchoolLevels] }))] })
}

/** V8 copy policy requires a Timetable; this narrow branch copies a genuinely empty teacher set. */
function copyProjectWithoutTimetables(data: AppDataV9, input: CopyProjectV8Input, createId: () => string): AppDataV9 {
  const source = data.projects.find((item) => item.id === input.sourceProjectId)
  const schools = data.schools.filter((item) => item.projectId === input.sourceProjectId)
  const units = data.teachingUnits.filter((item) => item.projectId === input.sourceProjectId)
  const classes = data.classes.filter((item) => item.projectId === input.sourceProjectId)
  const configured = new Map(input.units.map((item) => [item.sourceUnitId, item]))
  const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!source || !schools.length || !units.length || !input.name.trim()
    || !Number.isInteger(input.academicYear) || input.academicYear <= 0
    || !['first', 'second', 'summer', 'custom'].includes(input.semester)
    || (input.semester === 'custom' && !input.customLabel?.trim())
    || configured.size !== units.length || input.units.length !== units.length
    || units.some((unit) => { const config = configured.get(unit.id)
      return !config || !date(config.sourceEffectiveDate) || config.sourceEffectiveDate < unit.startDate
        || config.sourceEffectiveDate > unit.endDate || !date(config.startDate) || !date(config.endDate)
        || config.startDate > config.endDate || !date(config.anchorDate)
        || config.anchorDate < config.startDate || config.anchorDate > config.endDate
        || !['A', 'B'].includes(config.anchorPattern) })) {
    throw new Error('空白課表專案的來源日期或新學期設定不合法。')
  }
  const occupied = new Set([
    ...data.projects, ...data.schools, ...data.teachingUnits, ...data.timetables, ...data.subjects,
    ...data.teachingUnitSubjects, ...data.classes, ...data.recurringLessons, ...data.oneOffLessons,
    ...data.overrides, ...data.events, ...data.teachingProgress, ...data.migrationWarnings,
  ].map((item) => item.id))
  data.recurringLessons.forEach((item) => occupied.add(item.seriesId))
  const nextId = () => { const id = createId()
    if (!id?.trim() || id !== id.trim() || occupied.has(id)) throw new Error('複製產生的 ID 不合法或重複。')
    occupied.add(id); return id }
  const projectId = nextId()
  const schoolIds = new Map(schools.map((item) => [item.id, nextId()]))
  const unitIds = new Map(units.map((item) => [item.id, nextId()]))
  const now = new Date().toISOString()
  return safe(data, { ...data, activeProjectId: projectId,
    projects: [...data.projects, { id: projectId, name: input.name.trim(),
      term: { academicYear: input.academicYear, semester: input.semester,
        customLabel: input.semester === 'custom' ? input.customLabel?.trim() : undefined },
      createdAt: now, updatedAt: now }],
    schools: [...data.schools, ...schools.map((item) => ({ ...item, id: schoolIds.get(item.id)!, projectId }))],
    teachingUnits: [...data.teachingUnits, ...units.map((item) => { const config = configured.get(item.id)!
      return { ...item, id: unitIds.get(item.id)!, projectId, schoolId: schoolIds.get(item.schoolId)!,
        startDate: config.startDate, endDate: config.endDate, periods: item.periods.map((period) => ({ ...period })),
        weekCycle: { ...item.weekCycle, anchorDate: config.anchorDate, anchorPattern: config.anchorPattern } } })],
    classes: [...data.classes, ...classes.map((item) => ({ ...item, id: nextId(), projectId,
      teachingUnitId: unitIds.get(item.teachingUnitId)! }))] })
}

export function archiveProjectV9(data: AppDataV9, projectId: string, at = new Date().toISOString()): AppDataV9 {
  valid(data)
  const project = data.projects.find((item) => item.id === projectId && !item.archivedAt)
  if (!project) throw new Error('專案不存在或已封存。')
  const activeProjectId = data.activeProjectId === projectId
    ? data.projects.find((item) => item.id !== projectId && !item.archivedAt)?.id ?? null : data.activeProjectId
  return safe(data, { ...data, activeProjectId, projects: data.projects.map((item) => item.id === projectId
    ? { ...item, archivedAt: at, updatedAt: at } : item) })
}
export function reactivateProjectV9(data: AppDataV9, projectId: string, at = new Date().toISOString()): AppDataV9 {
  valid(data)
  if (!data.projects.some((item) => item.id === projectId && item.archivedAt)) throw new Error('找不到已封存專案。')
  return safe(data, { ...data, activeProjectId: projectId,
    projects: data.projects.map((item) => item.id === projectId
      ? { ...item, archivedAt: undefined, updatedAt: at } : item) })
}
export function getProjectV9Impact(data: AppDataV9, projectId: string) {
  valid(data)
  return getProjectDeletionImpact(asV8ValidationProjection(data), projectId)
}
export function deleteEmptyProjectV9(data: AppDataV9, projectId: string, confirmed = false): AppDataV9 {
  valid(data)
  const impact = getProjectV9Impact(data, projectId)
  if (impact.timetables || impact.subjects || impact.teachingUnitSubjects || impact.classes
    || impact.recurringLessons || impact.oneOffLessons || impact.overrides || impact.events || impact.teachingProgress) {
    throw new Error('專案仍有教師課表、科目、班級、課程、事件或進度；請先處理依賴資料，不能級聯刪除。')
  }
  const projected = deleteProject(asV8ValidationProjection(data), projectId, confirmed)
  return safe(data, { ...projected, schemaVersion: 9, subjects: data.subjects })
}

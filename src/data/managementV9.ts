import type { AcademicTermDescriptor } from '../types'
import type { AppDataV9 } from '../types/v9'
import { formatClassCode, isGradeValidForLevel } from '../lib/classes'
import type { ClassV8Draft } from './classesV8'
import type { CopyProjectV8Input } from './projectRuntimeV8'
import type { SchoolV8Draft, TeachingUnitV8Draft } from './academicSettingsV8'
import { createSchoolV8, createTeachingUnitV8, updateSchoolV8, updateTeachingUnitV8 } from './academicSettingsV8'
import { createClassV8, deleteClassV8, getClassV8Impact, updateClassV8 } from './classesV8'
import { copyProject, deleteProject, getProjectDeletionImpact } from './projectRuntimeV8'
import { asV8ValidationProjection, isCompatibleAppDataV9, isSafeAppDataV9Update } from './validators/v9'
import { requireProjectTermV9, retainUnsetProjectResourcesV9 } from './projectContractV9'

export interface EmptyProjectV9Input { name: string }
export type ConfigureProjectTermV9Input = AcademicTermDescriptor

const valid = (data: AppDataV9) => {
  if (!isCompatibleAppDataV9(data)) throw new Error('教師科目庫文件未通過驗證。')
}
const safe = (current: AppDataV9, next: AppDataV9): AppDataV9 => {
  if (!isSafeAppDataV9Update(current, next)) throw new Error('管理操作未通過新版資料安全檢查。')
  return next
}
const isUnsetProject = (data: AppDataV9, projectId: string) =>
  data.projects.some((item) => item.id === projectId && item.term === null)
const editableProject = (data: AppDataV9, projectId: string) => {
  const project = data.projects.find((item) => item.id === projectId)
  if (!project || project.archivedAt) throw new Error('專案不存在或為唯讀。')
  return project
}
const idAvailable = (data: AppDataV9, id: string) => {
  const entities = [data.projects, data.schools, data.teachingUnits, data.timetables, data.subjects,
    data.teachingUnitSubjects, data.classes, data.recurringLessons, data.oneOffLessons,
    data.overrides, data.events, data.teachingProgress, data.migrationWarnings]
  return !!id && id === id.trim() && !entities.some((rows) => rows.some((item) => item.id === id))
    && !data.recurringLessons.some((item) => item.seriesId === id)
}
const classFields = (data: AppDataV9, projectId: string, draft: ClassV8Draft, exceptId?: string) => {
  const unit = data.teachingUnits.find((item) => item.id === draft.teachingUnitId && item.projectId === projectId)
  if (!unit) throw new Error('TeachingUnit does not belong to Project.')
  const structured = draft.grade !== undefined || draft.classNumber !== undefined
  if (structured && (draft.grade === undefined || draft.classNumber === undefined
    || !isGradeValidForLevel(unit.schoolLevel, draft.grade) || !Number.isInteger(draft.classNumber)
    || draft.classNumber <= 0)) throw new Error('Grade and class number are invalid.')
  if (!structured && !draft.name?.trim()) throw new Error('Class name is required.')
  if (structured && data.classes.some((item) => item.id !== exceptId && item.teachingUnitId === unit.id
    && item.grade === draft.grade && item.classNumber === draft.classNumber)) {
    throw new Error('Grade and class number already exist.')
  }
  if (draft.room && draft.room.length > 15) throw new Error('Room must be at most 15 characters.')
  return { teachingUnitId: unit.id,
    name: structured ? formatClassCode(draft.grade!, draft.classNumber!) : draft.name!.trim(),
    grade: draft.grade, classNumber: draft.classNumber, room: draft.room?.trim() || undefined }
}

/** Formal-product creation starts with only the Project record; setup remains an explicit later action. */
export function createEmptyProjectV9(data: AppDataV9, input: EmptyProjectV9Input,
  id: string, now = new Date().toISOString()): AppDataV9 {
  valid(data)
  const name = input.name?.trim()
  const occupied = new Set([
    ...data.projects, ...data.schools, ...data.teachingUnits, ...data.timetables, ...data.subjects,
    ...data.teachingUnitSubjects, ...data.classes, ...data.recurringLessons, ...data.oneOffLessons,
    ...data.overrides, ...data.events, ...data.teachingProgress, ...data.migrationWarnings,
  ].flatMap((item) => 'seriesId' in item ? [item.id, item.seriesId] : [item.id]))
  if (!name || !id?.trim() || id !== id.trim() || occupied.has(id)
    || Number.isNaN(Date.parse(now))) {
    throw new Error('空白專案資料或新 ID 不合法。')
  }
  return safe(data, { ...data, activeProjectId: id,
    projects: [...data.projects, { id, name,
      term: null, createdAt: now, updatedAt: now }] })
}

/** Reuses the established V8 resource rules; only the selected entity collection is copied back. */
export function createSchoolV9(data: AppDataV9, projectId: string, draft: SchoolV8Draft, id: string): AppDataV9 {
  valid(data)
  if (isUnsetProject(data, projectId)) {
    editableProject(data, projectId)
    if (!idAvailable(data, id) || !draft.name.trim() || !/^#[0-9a-f]{6}$/i.test(draft.color)) {
      throw new Error('學校名稱、顏色或 ID 不合法。')
    }
    return safe(data, { ...data, schools: [...data.schools,
      { id, projectId, name: draft.name.trim(), color: draft.color.trim() }] })
  }
  const next = createSchoolV8(asV8ValidationProjection(data), projectId, draft, id)
  return safe(data, { ...data, schools: retainUnsetProjectResourcesV9(data, next).schools })
}
export function updateSchoolV9(data: AppDataV9, projectId: string, id: string, draft: SchoolV8Draft): AppDataV9 {
  valid(data)
  if (isUnsetProject(data, projectId)) {
    editableProject(data, projectId)
    if (!draft.name.trim() || !/^#[0-9a-f]{6}$/i.test(draft.color)) throw new Error('學校名稱或顏色不合法。')
    if (!data.schools.some((item) => item.id === id && item.projectId === projectId)) throw new Error('School is outside Project.')
    return safe(data, { ...data, schools: data.schools.map((item) => item.id === id
      ? { ...item, name: draft.name.trim(), color: draft.color.trim() } : item) })
  }
  const next = updateSchoolV8(asV8ValidationProjection(data), projectId, id, draft)
  return safe(data, { ...data, schools: retainUnsetProjectResourcesV9(data, next).schools })
}
export function createTeachingUnitV9(data: AppDataV9, projectId: string, draft: TeachingUnitV8Draft, id: string): AppDataV9 {
  valid(data)
  if (isUnsetProject(data, projectId)) {
    editableProject(data, projectId)
    if (!idAvailable(data, id)) throw new Error('TeachingUnit ID is invalid or already used.')
    return safe(data, { ...data, teachingUnits: [...data.teachingUnits, { id, projectId,
      timezone: 'Asia/Taipei', ...draft, name: draft.name.trim(),
      periods: draft.periods.map((item) => ({ ...item, label: item.label.trim() })),
      weekCycle: { ...draft.weekCycle } }] })
  }
  const next = createTeachingUnitV8(asV8ValidationProjection(data), projectId, draft, id)
  return safe(data, { ...data, teachingUnits: retainUnsetProjectResourcesV9(data, next).teachingUnits })
}
export function updateTeachingUnitV9(data: AppDataV9, projectId: string, id: string, draft: TeachingUnitV8Draft): AppDataV9 {
  valid(data)
  if (isUnsetProject(data, projectId)) {
    editableProject(data, projectId)
    if (!data.teachingUnits.some((item) => item.id === id && item.projectId === projectId)) {
      throw new Error('TeachingUnit is outside Project.')
    }
    return safe(data, { ...data, teachingUnits: data.teachingUnits.map((item) => item.id === id
      ? { ...item, ...draft, name: draft.name.trim(),
        periods: draft.periods.map((period) => ({ ...period, label: period.label.trim() })),
        weekCycle: { ...draft.weekCycle } } : item) })
  }
  const next = updateTeachingUnitV8(asV8ValidationProjection(data), projectId, id, draft)
  return safe(data, { ...data, teachingUnits: retainUnsetProjectResourcesV9(data, next).teachingUnits })
}
export function createClassV9(data: AppDataV9, projectId: string, draft: ClassV8Draft, id: string): AppDataV9 {
  valid(data)
  if (isUnsetProject(data, projectId)) {
    editableProject(data, projectId)
    if (!idAvailable(data, id)) throw new Error('Class ID is invalid or already used.')
    return safe(data, { ...data, classes: [...data.classes,
      { id, projectId, ...classFields(data, projectId, draft), origin: 'user' }] })
  }
  const next = createClassV8(asV8ValidationProjection(data), projectId, draft, id)
  return safe(data, { ...data, classes: retainUnsetProjectResourcesV9(data, next).classes })
}
export function updateClassV9(data: AppDataV9, projectId: string, classId: string, draft: ClassV8Draft): AppDataV9 {
  valid(data)
  if (isUnsetProject(data, projectId)) {
    editableProject(data, projectId)
    if (!data.classes.some((item) => item.id === classId && item.projectId === projectId)) {
      throw new Error('Class is outside Project.')
    }
    const fields = classFields(data, projectId, draft, classId)
    return safe(data, { ...data, classes: data.classes.map((item) => item.id === classId
      ? { ...item, ...fields, origin: 'user' } : item) })
  }
  const next = updateClassV8(asV8ValidationProjection(data), projectId, classId, draft)
  return safe(data, { ...data, classes: retainUnsetProjectResourcesV9(data, next).classes })
}
export function deleteClassV9(data: AppDataV9, projectId: string, classId: string, confirmed = false): AppDataV9 {
  valid(data)
  if (isUnsetProject(data, projectId)) {
    editableProject(data, projectId)
    const impact = getClassV9Impact(data, projectId, classId)
    if (impact.recurringLessons || impact.oneOffLessons || impact.overrides || impact.teachingProgress) {
      throw new Error('Class is referenced by Lessons, changes or Progress.')
    }
    if (!confirmed) throw new Error('Class deletion requires confirmation.')
    return safe(data, { ...data, classes: data.classes.filter((item) => item.id !== classId) })
  }
  const next = deleteClassV8(asV8ValidationProjection(data), projectId, classId, confirmed)
  return safe(data, { ...data, classes: retainUnsetProjectResourcesV9(data, next).classes })
}
export function getClassV9Impact(data: AppDataV9, projectId: string, classId: string) {
  valid(data)
  if (isUnsetProject(data, projectId)) {
    const schoolClass = data.classes.find((item) => item.id === classId && item.projectId === projectId)
    if (!schoolClass) throw new Error('Class does not belong to Project.')
    return { schoolClass, recurringLessons: data.recurringLessons.filter((item) => item.classId === classId).length,
      oneOffLessons: data.oneOffLessons.filter((item) => item.classId === classId).length,
      overrides: data.overrides.filter((item) => item.replacement?.classId === classId).length,
      teachingProgress: data.teachingProgress.filter((item) => item.classId === classId).length }
  }
  return getClassV8Impact(asV8ValidationProjection(data), projectId, classId)
}

export function copyProjectV9(data: AppDataV9, input: CopyProjectV8Input, createId: () => string): AppDataV9 {
  valid(data)
  requireProjectTermV9(data, input.sourceProjectId)
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
  return safe(data, { ...projected, ...retainUnsetProjectResourcesV9(data, projected), schemaVersion: 9,
    subjects: [...data.subjects, ...sourceSubjects.map((item, index) => ({ ...item,
      id: copiedSubjects[index].id, projectId: newProjectId, timetableId: tableIds.get(item.timetableId)!,
      applicableSchoolLevels: [...item.applicableSchoolLevels] }))] })
}

/** Configures the selected Project descriptor without deriving or changing any dated resource. */
export function configureProjectTermV9(data: AppDataV9, projectId: string,
  term: ConfigureProjectTermV9Input, at = new Date().toISOString()): AppDataV9 {
  valid(data)
  const project = editableProject(data, projectId)
  if (project.term !== null) throw new Error('Project term is already configured.')
  if (Object.keys(term).some((key) => !['academicYear', 'semester', 'customLabel'].includes(key))
    || !Number.isInteger(term.academicYear) || term.academicYear <= 0
    || !['first', 'second', 'summer', 'custom'].includes(term.semester)
    || (term.semester === 'custom' && !term.customLabel?.trim())
    || Number.isNaN(Date.parse(at))) throw new Error('Project term is invalid.')
  const normalized: AcademicTermDescriptor = { academicYear: term.academicYear, semester: term.semester,
    customLabel: term.semester === 'custom' ? term.customLabel!.trim() : undefined }
  return safe(data, { ...data, projects: data.projects.map((item) => item.id === projectId
    ? { ...item, term: normalized, updatedAt: at } : item) })
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
  if (isUnsetProject(data, projectId)) {
    const count = (rows: { projectId: string | null }[]) => rows.filter((item) => item.projectId === projectId).length
    return { projectId, timetables: count(data.timetables), schools: count(data.schools),
      teachingUnits: count(data.teachingUnits), subjects: count(data.subjects),
      teachingUnitSubjects: count(data.teachingUnitSubjects), classes: count(data.classes),
      recurringLessons: 0, events: 0, overrides: 0, oneOffLessons: 0, teachingProgress: 0 }
  }
  return getProjectDeletionImpact(asV8ValidationProjection(data), projectId)
}
export function deleteEmptyProjectV9(data: AppDataV9, projectId: string, confirmed = false): AppDataV9 {
  valid(data)
  const impact = getProjectV9Impact(data, projectId)
  if (impact.schools || impact.teachingUnits || impact.timetables || impact.subjects
    || impact.teachingUnitSubjects || impact.classes
    || impact.recurringLessons || impact.oneOffLessons || impact.overrides || impact.events || impact.teachingProgress) {
    throw new Error('專案仍有學校、任教單位、教師課表、科目、班級、課程、事件或進度；請先處理依賴資料，不能級聯刪除。')
  }
  if (!confirmed) throw new Error('Project deletion requires confirmation.')
  if (data.projects.some((item) => item.id === projectId && item.term === null)) {
    return safe(data, { ...data, projects: data.projects.filter((item) => item.id !== projectId),
      schools: data.schools.filter((item) => item.projectId !== projectId),
      activeProjectId: data.activeProjectId === projectId
        ? data.projects.find((item) => item.id !== projectId && !item.archivedAt)?.id ?? null : data.activeProjectId })
  }
  const projected = deleteProject(asV8ValidationProjection(data), projectId, confirmed)
  return safe(data, { ...projected, ...retainUnsetProjectResourcesV9(data, projected), schemaVersion: 9,
    activeProjectId: data.activeProjectId !== projectId ? data.activeProjectId
      : data.projects.find((item) => item.id !== projectId && !item.archivedAt)?.id ?? null,
    subjects: data.subjects })
}

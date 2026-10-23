import type { AppDataV8, ProjectClass } from '../types'
import { formatClassCode, isGradeValidForLevel } from '../lib/classes'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

export interface ClassV8Draft { teachingUnitId: string; name?: string; grade?: number; classNumber?: number; room?: string }
export class ClassV8Error extends Error {
  constructor(public readonly code: 'invalid-data' | 'invalid-project' | 'invalid-unit' | 'invalid-class'
    | 'invalid-draft' | 'invalid-id' | 'id-collision' | 'duplicate' | 'referenced'
    | 'confirmation-required' | 'unsafe-update', message: string) { super(message); this.name = 'ClassV8Error' }
}
const fail = (code: ClassV8Error['code'], message: string): never => { throw new ClassV8Error(code, message) }
const check = (data: AppDataV8) => { if (!isCompatibleAppDataV8(data)) fail('invalid-data', 'V8 document is invalid.') }
const result = (current: AppDataV8, next: AppDataV8) => {
  if (!isSafeAppDataV8Update(current, next)) fail('unsafe-update', 'Class update is unsafe.')
  return next
}
function unitFor(data: AppDataV8, projectId: string, unitId: string) {
  const project = data.projects.find((item) => item.id === projectId)
  if (!project || project.archivedAt) fail('invalid-project', 'Project is unavailable.')
  const unit = data.teachingUnits.find((item) => item.id === unitId && item.projectId === projectId)
  if (!unit) fail('invalid-unit', 'TeachingUnit does not belong to Project.')
  return unit!
}
function normalized(data: AppDataV8, projectId: string, draft: ClassV8Draft, exceptId?: string) {
  const unit = unitFor(data, projectId, draft.teachingUnitId)
  const structured = draft.grade !== undefined || draft.classNumber !== undefined
  if (structured && (draft.grade === undefined || draft.classNumber === undefined
    || !isGradeValidForLevel(unit.schoolLevel, draft.grade) || !Number.isInteger(draft.classNumber)
    || draft.classNumber <= 0)) fail('invalid-draft', 'Grade and class number are invalid.')
  if (!structured && !draft.name?.trim()) fail('invalid-draft', 'Class name is required.')
  if (structured && data.classes.some((item) => item.id !== exceptId && item.teachingUnitId === unit.id
    && item.grade === draft.grade && item.classNumber === draft.classNumber)) fail('duplicate', 'Grade and class number already exist.')
  if (draft.room && draft.room.length > 15) fail('invalid-draft', 'Room must be at most 15 characters.')
  return { teachingUnitId: unit.id, name: structured ? formatClassCode(draft.grade!, draft.classNumber!) : draft.name!.trim(),
    grade: draft.grade, classNumber: draft.classNumber, room: draft.room?.trim() || undefined }
}
export function getClassV8Impact(data: AppDataV8, projectId: string, classId: string) {
  check(data)
  const schoolClass = data.classes.find((item) => item.id === classId && item.projectId === projectId)
  if (!schoolClass) fail('invalid-class', 'Class does not belong to Project.')
  return { schoolClass: schoolClass!, recurringLessons: data.recurringLessons.filter((item) => item.classId === classId).length,
    oneOffLessons: data.oneOffLessons.filter((item) => item.classId === classId).length,
    overrides: data.overrides.filter((item) => item.replacement?.classId === classId).length,
    teachingProgress: data.teachingProgress.filter((item) => item.classId === classId).length }
}
export function createClassV8(data: AppDataV8, projectId: string, draft: ClassV8Draft, id: string): AppDataV8 {
  check(data)
  if (typeof id !== 'string' || !id.trim() || id !== id.trim()) fail('invalid-id', 'Class ID is invalid.')
  const allIds = [data.projects, data.schools, data.teachingUnits, data.timetables, data.subjects,
    data.teachingUnitSubjects, data.classes, data.recurringLessons, data.events, data.overrides,
    data.oneOffLessons, data.teachingProgress, data.migrationWarnings].flat().map((item) => item.id)
  if (allIds.includes(id) || data.recurringLessons.some((item) => item.seriesId === id)) fail('id-collision', 'Class ID already exists.')
  const fields = normalized(data, projectId, draft)
  return result(data, { ...data, classes: [...data.classes, { id, projectId, ...fields, origin: 'user' }] })
}
export function updateClassV8(data: AppDataV8, projectId: string, classId: string, draft: ClassV8Draft): AppDataV8 {
  check(data)
  const impact = getClassV8Impact(data, projectId, classId)
  const fields = normalized(data, projectId, draft, classId)
  if (impact.schoolClass.teachingUnitId !== fields.teachingUnitId
    && (impact.recurringLessons || impact.oneOffLessons || impact.overrides || impact.teachingProgress)) {
    fail('referenced', 'Referenced Class cannot move to another TeachingUnit.')
  }
  return result(data, { ...data, classes: data.classes.map((item) => item.id === classId
    ? { ...item, ...fields, origin: 'user' } : item) })
}
export function deleteClassV8(data: AppDataV8, projectId: string, classId: string, confirmed = false): AppDataV8 {
  check(data)
  const impact = getClassV8Impact(data, projectId, classId)
  unitFor(data, projectId, impact.schoolClass.teachingUnitId)
  if (impact.recurringLessons || impact.oneOffLessons || impact.overrides || impact.teachingProgress) {
    fail('referenced', 'Class is referenced by Lessons, changes or Progress.')
  }
  if (!confirmed) fail('confirmation-required', 'Class deletion requires confirmation.')
  return result(data, { ...data, classes: data.classes.filter((item) => item.id !== classId) })
}
export function listClassesV8(data: AppDataV8, projectId: string): ProjectClass[] {
  check(data)
  if (!data.projects.some((item) => item.id === projectId)) fail('invalid-project', 'Project does not exist.')
  return data.classes.filter((item) => item.projectId === projectId).map((item) => ({ ...item }))
}

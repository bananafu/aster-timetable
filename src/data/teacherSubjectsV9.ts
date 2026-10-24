import type { AppDataV9, SubjectV9 } from '../types/v9'
import type { SchoolLevel } from '../types'
import type { NewProjectInput } from './projectRuntime'
import { createBlankProject, switchActiveProject } from './projectRuntimeV8'
import { createTeachingUnitV8, type TeachingUnitV8Draft } from './academicSettingsV8'
import { createTeacherTimetableV8, deleteTeacherTimetableV8,
  duplicateTeacherTimetableV8, updateTeacherTimetableV8, type TimetableV8Details } from './timetablesV8'
import { asV8ValidationProjection, isCompatibleAppDataV9, isSafeAppDataV9Update } from './validators/v9'
import { normalizeSubjectText } from '../lib/subjectSearch'

export class TeacherSubjectV9Error extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
const fail = (code: string, message: string): never => { throw new TeacherSubjectV9Error(code, message) }
const safe = (current: AppDataV9, next: AppDataV9): AppDataV9 => {
  if (!isSafeAppDataV9Update(current, next)) fail('unsafe-update', 'V9 document update is unsafe.')
  return next
}
const valid = (data: AppDataV9) => { if (!isCompatibleAppDataV9(data)) fail('invalid-document', 'Invalid V9 document.') }
const timetable = (data: AppDataV9, projectId: string, timetableId: string) => {
  const found = data.timetables.find((item) => item.id === timetableId && item.projectId === projectId)
  if (!found || data.projects.find((item) => item.id === projectId)?.archivedAt) {
    fail('invalid-timetable', 'Timetable does not belong to an editable Project.')
  }
  return found!
}
const idAvailable = (data: AppDataV9, id: string) => !!id && id.trim() === id && ![
  ...data.projects, ...data.schools, ...data.teachingUnits, ...data.timetables, ...data.subjects,
  ...data.teachingUnitSubjects, ...data.classes, ...data.recurringLessons, ...data.oneOffLessons,
  ...data.overrides, ...data.events, ...data.teachingProgress,
].some((item) => item.id === id)

export interface SubjectDraftV9 {
  name: string; shortName: string; color: string; applicableSchoolLevels: SchoolLevel[]
}
export function listTeacherSubjectsV9(data: AppDataV9, projectId: string, timetableId: string): SubjectV9[] {
  valid(data)
  timetable(data, projectId, timetableId)
  return data.subjects.filter((item) => item.projectId === projectId && item.timetableId === timetableId)
}
export function createTeacherSubjectV9(data: AppDataV9, projectId: string, timetableId: string,
  draft: SubjectDraftV9, id: string): AppDataV9 {
  valid(data)
  timetable(data, projectId, timetableId)
  if (!idAvailable(data, id)) fail('id-collision', 'Subject ID is invalid or already used.')
  const subject: SubjectV9 = { id, projectId, timetableId, name: draft.name.trim(),
    shortName: draft.shortName.trim(), color: draft.color,
    applicableSchoolLevels: [...draft.applicableSchoolLevels] }
  if (!subject.name || !subject.shortName || !/^#[0-9a-fA-F]{6}$/.test(subject.color)
    || !subject.applicableSchoolLevels.length || new Set(subject.applicableSchoolLevels).size !== subject.applicableSchoolLevels.length
    || subject.applicableSchoolLevels.some((level) => !['junior-high', 'senior-high', 'other'].includes(level))) {
    fail('invalid-draft', 'Subject fields are invalid.')
  }
  if (data.subjects.some((item) => item.timetableId === timetableId
    && (normalizeSubjectText(item.name) === normalizeSubjectText(subject.name)
      || normalizeSubjectText(item.shortName) === normalizeSubjectText(subject.shortName)))) {
    fail('duplicate-subject', 'Name or short name already exists in this teacher Timetable.')
  }
  return safe(data, { ...data, subjects: [...data.subjects, subject] })
}
export function renameTeacherSubjectV9(data: AppDataV9, projectId: string, timetableId: string,
  subjectId: string, draft: SubjectDraftV9): AppDataV9 {
  valid(data)
  const subject = listTeacherSubjectsV9(data, projectId, timetableId).find((item) => item.id === subjectId)
  if (!subject) fail('subject-not-found', 'Subject does not belong to this teacher.')
  const nextSubject = { ...subject!, name: draft.name.trim(), shortName: draft.shortName.trim(),
    color: draft.color, applicableSchoolLevels: [...draft.applicableSchoolLevels] }
  if (!nextSubject.name || !nextSubject.shortName || !/^#[0-9a-fA-F]{6}$/.test(nextSubject.color)
    || !nextSubject.applicableSchoolLevels.length) fail('invalid-draft', 'Subject fields are invalid.')
  return safe(data, { ...data, subjects: data.subjects.map((item) => item.id === subjectId ? nextSubject : item) })
}
export function configureTeacherSubjectV9(data: AppDataV9, projectId: string, timetableId: string,
  teachingUnitId: string, subjectId: string, relationId: string, confirmLevelExtension = false): AppDataV9 {
  valid(data)
  const subject = listTeacherSubjectsV9(data, projectId, timetableId).find((item) => item.id === subjectId)
  const unit = data.teachingUnits.find((item) => item.id === teachingUnitId && item.projectId === projectId)
  if (!subject || !unit) fail('invalid-relation', 'Subject or TeachingUnit is outside the selected Project and Timetable.')
  if (!idAvailable(data, relationId)) fail('id-collision', 'Configuration ID is invalid or already used.')
  if (data.teachingUnitSubjects.some((item) => item.teachingUnitId === unit!.id && item.subjectId === subject!.id)) {
    fail('already-configured', 'Subject is already configured for this TeachingUnit.')
  }
  const needsExtension = !subject!.applicableSchoolLevels.includes(unit!.schoolLevel)
  if (needsExtension && !confirmLevelExtension) fail('level-confirmation-required', 'Confirm school-level extension before configuration.')
  return safe(data, { ...data,
    subjects: needsExtension ? data.subjects.map((item) => item.id === subject!.id
      ? { ...item, applicableSchoolLevels: [...item.applicableSchoolLevels, unit!.schoolLevel] } : item) : data.subjects,
    teachingUnitSubjects: [...data.teachingUnitSubjects,
      { id: relationId, projectId, teachingUnitId, subjectId }] })
}
export function deleteTeacherSubjectV9(data: AppDataV9, projectId: string, timetableId: string,
  subjectId: string): AppDataV9 {
  valid(data)
  if (!listTeacherSubjectsV9(data, projectId, timetableId).some((item) => item.id === subjectId)) {
    fail('subject-not-found', 'Subject does not belong to this teacher.')
  }
  if (data.teachingUnitSubjects.some((item) => item.subjectId === subjectId)
    || data.recurringLessons.some((item) => item.subjectId === subjectId)
    || data.oneOffLessons.some((item) => item.subjectId === subjectId)
    || data.overrides.some((item) => item.replacement?.subjectId === subjectId)
    || data.teachingProgress.some((item) => item.subjectId === subjectId)) {
    fail('subject-referenced', 'Subject still has a configuration, Lesson, Change, OneOff, or Progress reference.')
  }
  return safe(data, { ...data, subjects: data.subjects.filter((item) => item.id !== subjectId) })
}
export function createBlankProjectV9(data: AppDataV9, input: NewProjectInput, createId: () => string): AppDataV9 {
  valid(data)
  const next = createBlankProject(asV8ValidationProjection(data), input, createId)
  return safe(data, { ...data, activeProjectId: next.activeProjectId,
    projects: next.projects, schools: next.schools, teachingUnits: next.teachingUnits })
}
export function switchActiveProjectV9(data: AppDataV9, projectId: string): AppDataV9 {
  valid(data)
  const next = switchActiveProject(asV8ValidationProjection(data), projectId)
  return safe(data, { ...data, activeProjectId: next.activeProjectId })
}
export function createTeachingUnitV9(data: AppDataV9, projectId: string,
  draft: TeachingUnitV8Draft, id: string): AppDataV9 {
  valid(data)
  const next = createTeachingUnitV8(asV8ValidationProjection(data), projectId, draft, id)
  return safe(data, { ...data, teachingUnits: next.teachingUnits })
}
export function createTeacherTimetableV9(data: AppDataV9, projectId: string,
  details: TimetableV8Details, id: string): AppDataV9 {
  valid(data)
  const next = createTeacherTimetableV8(asV8ValidationProjection(data), projectId, details, id)
  return safe(data, { ...data, timetables: next.timetables })
}
export function updateTeacherTimetableV9(data: AppDataV9, projectId: string, timetableId: string,
  details: TimetableV8Details): AppDataV9 {
  valid(data)
  const next = updateTeacherTimetableV8(asV8ValidationProjection(data), projectId, timetableId, details)
  return safe(data, { ...data, timetables: next.timetables })
}
export function duplicateTeacherTimetableV9(data: AppDataV9, projectId: string, sourceId: string,
  id: string): AppDataV9 {
  valid(data)
  const next = duplicateTeacherTimetableV8(asV8ValidationProjection(data), projectId, sourceId, projectId, id)
  return safe(data, { ...data, timetables: next.timetables })
}
export function deleteTeacherTimetableV9(data: AppDataV9, projectId: string, timetableId: string): AppDataV9 {
  valid(data)
  if (data.subjects.some((item) => item.timetableId === timetableId)) {
    fail('subject-owned', 'Remove this teacher’s Subject library before deleting the Timetable.')
  }
  const next = deleteTeacherTimetableV8(asV8ValidationProjection(data), projectId, timetableId, true)
  return safe(data, { ...data, timetables: next.timetables })
}

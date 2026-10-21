import {
  SCHOOL_LEVELS,
  type AppDataV8,
  type SchoolLevel,
  type SubjectV8,
  type TeachingProgress,
} from '../types'
import { normalizeSubjectText } from '../lib/subjectSearch'
import { analyzeSubjectReferences, type SubjectReference } from './subjectReferences'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

export interface SubjectV8Draft {
  name: string
  shortName: string
  color: string
  applicableSchoolLevels: SchoolLevel[]
}

export interface TeachingProgressSubjectReference {
  kind: 'progress'
  id: string
  projectId: string
  teachingUnitId: string
  schoolLevel: SchoolLevel | null
  archived: boolean
  historical: false
}

export type SubjectV8Reference = SubjectReference | TeachingProgressSubjectReference

export interface SubjectV8Impact {
  subject: SubjectV8
  references: SubjectV8Reference[]
  projectIds: string[]
  archivedProjectIds: string[]
}

export class SubjectV8ManagementError extends Error {
  constructor(
    public readonly code:
      | 'invalid-data'
      | 'invalid-draft'
      | 'invalid-project'
      | 'archived-project'
      | 'invalid-id'
      | 'id-collision'
      | 'duplicate-name'
      | 'duplicate-short-name'
      | 'not-found'
      | 'wrong-project'
      | 'referenced'
      | 'cross-project-reference'
      | 'confirmation-required'
      | 'unsafe-update',
    message: string,
    public readonly details?: {
      subject?: SubjectV8
      existingSubject?: SubjectV8
      references?: SubjectV8Reference[]
    },
  ) {
    super(message)
    this.name = 'SubjectV8ManagementError'
  }
}

const draftKeys = ['name', 'shortName', 'color', 'applicableSchoolLevels'] as const
function fail(code: SubjectV8ManagementError['code'], message: string): never {
  throw new SubjectV8ManagementError(code, message)
}

function normalizeDraft(draft: SubjectV8Draft): SubjectV8Draft {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)
    || Object.keys(draft).some((key) => !draftKeys.includes(key as typeof draftKeys[number]))) {
    fail('invalid-draft', 'Subject draft contains unsupported fields.')
  }
  const name = typeof draft.name === 'string' ? draft.name.trim().normalize('NFC') : ''
  const shortName = typeof draft.shortName === 'string' ? draft.shortName.trim().normalize('NFC') : ''
  const color = typeof draft.color === 'string' ? draft.color.trim() : ''
  if (!name || !shortName || !/^#[0-9a-fA-F]{6}$/.test(color)
    || !Array.isArray(draft.applicableSchoolLevels) || draft.applicableSchoolLevels.length === 0
    || new Set(draft.applicableSchoolLevels).size !== draft.applicableSchoolLevels.length
    || !draft.applicableSchoolLevels.every((level) => SCHOOL_LEVELS.includes(level))) {
    fail('invalid-draft', 'Subject draft is invalid.')
  }
  return { name, shortName, color, applicableSchoolLevels: [...draft.applicableSchoolLevels] }
}

function assertData(data: AppDataV8): void {
  if (!isCompatibleAppDataV8(data)) fail('invalid-data', 'A valid AppDataV8 document is required.')
}

function editableProject(data: AppDataV8, projectId: string) {
  const project = data.projects.find((item) => item.id === projectId)
  if (!project) fail('invalid-project', 'Project does not exist.')
  if (project.archivedAt) fail('archived-project', 'Archived Projects are read-only.')
  return project
}

function cloneSubject(subject: SubjectV8): SubjectV8 {
  return { ...subject, applicableSchoolLevels: [...subject.applicableSchoolLevels] }
}

function assertUnique(data: AppDataV8, projectId: string, draft: SubjectV8Draft, exceptId?: string): void {
  const inProject = data.subjects.filter((subject) => subject.projectId === projectId && subject.id !== exceptId)
  const name = inProject.find((subject) => normalizeSubjectText(subject.name) === normalizeSubjectText(draft.name))
  if (name) throw new SubjectV8ManagementError(
    'duplicate-name', 'A Subject with the same normalized name already exists in this Project.',
    { existingSubject: cloneSubject(name) },
  )
  const shortName = inProject.find((subject) => normalizeSubjectText(subject.shortName) === normalizeSubjectText(draft.shortName))
  if (shortName) throw new SubjectV8ManagementError(
    'duplicate-short-name', 'A Subject with the same normalized short name already exists in this Project.',
    { existingSubject: cloneSubject(shortName) },
  )
}

function allEntityIds(data: AppDataV8): Set<string> {
  return new Set([
    ...data.projects.map((item) => item.id), ...data.timetables.map((item) => item.id),
    ...data.schools.map((item) => item.id), ...data.teachingUnits.map((item) => item.id),
    ...data.subjects.map((item) => item.id), ...data.classes.map((item) => item.id),
    ...data.recurringLessons.flatMap((item) => [item.id, item.seriesId]),
    ...data.events.map((item) => item.id), ...data.overrides.map((item) => item.id),
    ...data.oneOffLessons.map((item) => item.id), ...data.teachingProgress.map((item) => item.id),
    ...data.migrationWarnings.map((item) => item.id),
  ])
}

function assertResult(current: AppDataV8, next: AppDataV8): AppDataV8 {
  if (!isSafeAppDataV8Update(current, next)) fail('unsafe-update', 'Subject update did not pass AppDataV8 safety validation.')
  return next
}

function subjectForProject(data: AppDataV8, projectId: string, subjectId: string): SubjectV8 {
  const subject = data.subjects.find((item) => item.id === subjectId)
  if (!subject) fail('not-found', 'Subject does not exist.')
  if (subject.projectId !== projectId) fail('wrong-project', 'Subject does not belong to the specified Project.')
  return subject
}

function progressReference(data: AppDataV8, progress: TeachingProgress): TeachingProgressSubjectReference {
  const unit = data.teachingUnits.find((item) => item.id === progress.teachingUnitId)
  return {
    kind: 'progress', id: progress.id, projectId: progress.projectId, teachingUnitId: progress.teachingUnitId,
    schoolLevel: unit?.projectId === progress.projectId ? unit.schoolLevel : null,
    archived: Boolean(data.projects.find((item) => item.id === progress.projectId)?.archivedAt), historical: false,
  }
}

function subjectReferences(data: AppDataV8, subject: SubjectV8): SubjectV8Reference[] {
  return [
    ...analyzeSubjectReferences(data, subject.id),
    ...data.teachingProgress.filter((progress) => progress.subjectId === subject.id)
      .map((progress) => progressReference(data, progress)),
  ]
}

export function getSubjectImpact(data: AppDataV8, projectId: string, subjectId: string): SubjectV8Impact {
  assertData(data)
  const subject = subjectForProject(data, projectId, subjectId)
  const references = subjectReferences(data, subject)
  return {
    subject: cloneSubject(subject),
    references,
    projectIds: [...new Set(references.flatMap((reference) => reference.projectId ? [reference.projectId] : []))],
    archivedProjectIds: [...new Set(references.flatMap((reference) => reference.archived && reference.projectId ? [reference.projectId] : []))],
  }
}

export function listSubjects(data: AppDataV8, projectId: string): SubjectV8[] {
  assertData(data)
  if (!data.projects.some((project) => project.id === projectId)) fail('invalid-project', 'Project does not exist.')
  return data.subjects.filter((subject) => subject.projectId === projectId).map(cloneSubject)
}

export function createSubject(
  data: AppDataV8,
  projectId: string,
  draft: SubjectV8Draft,
  id: string,
): AppDataV8 {
  assertData(data)
  editableProject(data, projectId)
  const normalized = normalizeDraft(draft)
  if (typeof id !== 'string' || !id.trim() || id !== id.trim()) fail('invalid-id', 'Subject ID is invalid.')
  if (allEntityIds(data).has(id)) fail('id-collision', 'Subject ID collides with an existing entity ID.')
  assertUnique(data, projectId, normalized)
  return assertResult(data, {
    ...data,
    subjects: [...data.subjects, { id, projectId, ...normalized, origin: 'user' }],
  })
}

export function updateSubject(
  data: AppDataV8,
  projectId: string,
  subjectId: string,
  draft: SubjectV8Draft,
): AppDataV8 {
  assertData(data)
  editableProject(data, projectId)
  subjectForProject(data, projectId, subjectId)
  const normalized = normalizeDraft(draft)
  assertUnique(data, projectId, normalized, subjectId)
  return assertResult(data, {
    ...data,
    subjects: data.subjects.map((subject) => subject.id === subjectId
      ? { ...subject, ...normalized, origin: 'user' }
      : subject),
  })
}

export function deleteSubject(
  data: AppDataV8,
  projectId: string,
  subjectId: string,
  confirmed = false,
): AppDataV8 {
  const subject = subjectForProject(data, projectId, subjectId)
  const references = subjectReferences(data, subject)
  if (references.some((reference) => reference.projectId !== subject.projectId)) {
    throw new SubjectV8ManagementError(
      'cross-project-reference', 'Subject has an invalid cross-Project reference.',
      { subject: cloneSubject(subject), references },
    )
  }
  assertData(data)
  editableProject(data, projectId)
  if (references.length) throw new SubjectV8ManagementError(
    'referenced', 'Subject is still referenced by schedule or TeachingProgress data.',
    { subject: cloneSubject(subject), references },
  )
  if (!confirmed) throw new SubjectV8ManagementError(
    'confirmation-required', 'Subject deletion requires explicit confirmation.',
    { subject: cloneSubject(subject), references },
  )
  return assertResult(data, { ...data, subjects: data.subjects.filter((item) => item.id !== subjectId) })
}

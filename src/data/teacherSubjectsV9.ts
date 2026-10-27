import type { AppDataV9, SubjectV9 } from '../types/v9'
import type { SchoolLevel, TeachingUnitSubject } from '../types'
import type { NewProjectInput } from './projectRuntime'
import { createBlankProject, switchActiveProject } from './projectRuntimeV8'
import { createTeachingUnitV8, type TeachingUnitV8Draft } from './academicSettingsV8'
import { createTeacherTimetableV8, deleteTeacherTimetableV8,
  duplicateTeacherTimetableV8, getTimetableV8Impact, updateTeacherTimetableV8,
  type TimetableV8Details } from './timetablesV8'
import { asV8ValidationProjection, isCompatibleAppDataV9, isSafeAppDataV9Update } from './validators/v9'
import { normalizeSubjectText } from '../lib/subjectSearch'

export class TeacherSubjectV9Error extends Error {
  constructor(readonly code: string, message: string, readonly details?: TeacherSubjectV9ErrorDetails) {
    super(message)
    this.name = 'TeacherSubjectV9Error'
  }
}
const fail = (code: string, message: string, details?: TeacherSubjectV9ErrorDetails): never => {
  throw new TeacherSubjectV9Error(code, message, details)
}
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

export type TeacherSubjectV9ReferenceKind = 'lesson' | 'change' | 'one-off' | 'progress'
export type TeacherSubjectV9ReferenceScope = 'owned' | 'unknown' | 'cross-project' | 'cross-timetable'

export interface TeacherSubjectV9Reference {
  kind: TeacherSubjectV9ReferenceKind
  id: string
  projectId: string | null
  timetableId: string | null
  teachingUnitId: string | null
  schoolLevel: SchoolLevel | null
  archived: boolean
  historical: boolean
  scope: TeacherSubjectV9ReferenceScope
}

export interface TeacherSubjectV9ConfigurationImpact {
  configuration: TeachingUnitSubject
  projectId: string
  timetableId: string
  teachingUnitId: string
  schoolLevel: SchoolLevel | null
  archived: boolean
  scope: 'owned' | 'unknown' | 'cross-project'
  blockedReferences: TeacherSubjectV9Reference[]
}

export interface TeacherSubjectV9Impact {
  documentCompatible: boolean
  subject: SubjectV9
  configurations: TeachingUnitSubject[]
  configurationImpacts: TeacherSubjectV9ConfigurationImpact[]
  references: TeacherSubjectV9Reference[]
  projectIds: string[]
  timetableIds: string[]
  teachingUnitIds: string[]
  archivedProjectIds: string[]
  historicalReferences: TeacherSubjectV9Reference[]
  unknownScopeReferences: TeacherSubjectV9Reference[]
  unsafeScopeReferences: TeacherSubjectV9Reference[]
  deletion: {
    blocked: boolean
    configurations: TeachingUnitSubject[]
    references: TeacherSubjectV9Reference[]
  }
}

export interface TeacherSubjectV9ErrorDetails {
  subject?: SubjectV9
  existingSubject?: SubjectV9
  configuration?: TeachingUnitSubject
  configurations?: TeachingUnitSubject[]
  references?: TeacherSubjectV9Reference[]
  impact?: TeacherSubjectV9Impact
}

const cloneSubject = (subject: SubjectV9): SubjectV9 => ({
  ...subject, applicableSchoolLevels: [...subject.applicableSchoolLevels],
})
const cloneConfiguration = (configuration: TeachingUnitSubject): TeachingUnitSubject => ({ ...configuration })

function normalizeSubjectDraft(draft: SubjectDraftV9): SubjectDraftV9 {
  const normalized: SubjectDraftV9 = {
    name: typeof draft?.name === 'string' ? draft.name.trim() : '',
    shortName: typeof draft?.shortName === 'string' ? draft.shortName.trim() : '',
    color: typeof draft?.color === 'string' ? draft.color : '',
    applicableSchoolLevels: Array.isArray(draft?.applicableSchoolLevels)
      ? [...draft.applicableSchoolLevels] : [],
  }
  if (!normalized.name || !normalized.shortName || !/^#[0-9a-fA-F]{6}$/.test(normalized.color)
    || !normalized.applicableSchoolLevels.length
    || new Set(normalized.applicableSchoolLevels).size !== normalized.applicableSchoolLevels.length
    || normalized.applicableSchoolLevels.some((level) => !['junior-high', 'senior-high', 'other'].includes(level))) {
    fail('invalid-draft', 'Subject fields are invalid.')
  }
  return normalized
}

function assertUniqueTeacherSubject(data: AppDataV9, projectId: string, timetableId: string,
  draft: SubjectDraftV9, exceptId?: string, combinedError = false): void {
  const subjects = data.subjects.filter((item) => item.id !== exceptId
    && item.projectId === projectId && item.timetableId === timetableId)
  const name = subjects.find((item) => normalizeSubjectText(item.name) === normalizeSubjectText(draft.name))
  if (combinedError && name) fail('duplicate-subject', 'Name or short name already exists in this teacher Timetable.', {
    existingSubject: cloneSubject(name),
  })
  if (name) fail('duplicate-name', 'A Subject with the same name already exists in this teacher Timetable.', {
    existingSubject: cloneSubject(name),
  })
  const shortName = subjects.find((item) => normalizeSubjectText(item.shortName) === normalizeSubjectText(draft.shortName))
  if (combinedError && shortName) fail('duplicate-subject', 'Name or short name already exists in this teacher Timetable.', {
    existingSubject: cloneSubject(shortName),
  })
  if (shortName) fail('duplicate-short-name', 'A Subject with the same short name already exists in this teacher Timetable.', {
    existingSubject: cloneSubject(shortName),
  })
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
  const normalized = normalizeSubjectDraft(draft)
  assertUniqueTeacherSubject(data, projectId, timetableId, normalized, undefined, true)
  const subject: SubjectV9 = { id, projectId, timetableId, ...normalized }
  return safe(data, { ...data, subjects: [...data.subjects, subject] })
}
export function renameTeacherSubjectV9(data: AppDataV9, projectId: string, timetableId: string,
  subjectId: string, draft: SubjectDraftV9): AppDataV9 {
  valid(data)
  const subject = listTeacherSubjectsV9(data, projectId, timetableId).find((item) => item.id === subjectId)
  if (!subject) fail('subject-not-found', 'Subject does not belong to this teacher.')
  const normalized = normalizeSubjectDraft(draft)
  assertUniqueTeacherSubject(data, projectId, timetableId, normalized, subjectId)
  const nextSubject: SubjectV9 = { ...subject!, ...normalized }
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

function referenceScope(data: AppDataV9, subject: SubjectV9, reference: {
  projectId: string | null | undefined
  timetableId: string | null | undefined
  teachingUnitId: string | null | undefined
}): { scope: TeacherSubjectV9ReferenceScope; schoolLevel: SchoolLevel | null; archived: boolean } {
  const project = reference.projectId
    ? data.projects.find((item) => item.id === reference.projectId) : undefined
  const table = reference.timetableId
    ? data.timetables.find((item) => item.id === reference.timetableId) : undefined
  const unit = reference.teachingUnitId
    ? data.teachingUnits.find((item) => item.id === reference.teachingUnitId) : undefined
  const archived = Boolean(project?.archivedAt)
  if (!project || !table || !unit) return { scope: 'unknown', schoolLevel: unit?.schoolLevel ?? null, archived }
  if (project.id !== subject.projectId || table.projectId !== subject.projectId
    || unit.projectId !== subject.projectId) {
    return { scope: 'cross-project', schoolLevel: unit.schoolLevel, archived }
  }
  if (table.id !== subject.timetableId) {
    return { scope: 'cross-timetable', schoolLevel: unit.schoolLevel, archived }
  }
  return { scope: 'owned', schoolLevel: unit.schoolLevel, archived }
}

function teacherSubjectReferences(data: AppDataV9, subject: SubjectV9): TeacherSubjectV9Reference[] {
  const latestVersion = new Map<string, string>()
  data.recurringLessons.forEach((item) => {
    if (item.effectiveStart > (latestVersion.get(item.seriesId) ?? '')) latestVersion.set(item.seriesId, item.effectiveStart)
  })
  const lessonById = new Map(data.recurringLessons.map((item) => [item.id, item]))
  const references: TeacherSubjectV9Reference[] = []
  const add = (kind: TeacherSubjectV9ReferenceKind, id: string, reference: {
    projectId: string | null | undefined
    timetableId: string | null | undefined
    teachingUnitId: string | null | undefined
  }, historical: boolean, forceUnknown = false) => {
    const ownership = forceUnknown
      ? { scope: 'unknown' as const, schoolLevel: null, archived: Boolean(reference.projectId
        && data.projects.find((item) => item.id === reference.projectId)?.archivedAt) }
      : referenceScope(data, subject, reference)
    references.push({ kind, id, projectId: reference.projectId ?? null,
      timetableId: reference.timetableId ?? null, teachingUnitId: reference.teachingUnitId ?? null,
      schoolLevel: ownership.schoolLevel, archived: ownership.archived, historical, scope: ownership.scope })
  }
  for (const lesson of data.recurringLessons) {
    if (lesson.subjectId !== subject.id) continue
    add('lesson', lesson.id, lesson,
      lesson.effectiveStart < (latestVersion.get(lesson.seriesId) ?? lesson.effectiveStart))
  }
  for (const change of data.overrides) {
    const original = change.originalLessonId ? lessonById.get(change.originalLessonId) : undefined
    if (change.replacement?.subjectId === subject.id || original?.subjectId === subject.id) {
      add('change', change.id, change, Boolean(original
        && original.effectiveStart < (latestVersion.get(original.seriesId) ?? original.effectiveStart)))
    }
    // An unresolved original Lesson carries no Subject ID. It may belong to any teacher Subject,
    // so every Subject impact must retain it as an unknown-scope blocker rather than infer safety.
    if (change.originalLessonId && !original) add('change', change.id, change, false, true)
  }
  for (const lesson of data.oneOffLessons) {
    if (lesson.subjectId === subject.id) add('one-off', lesson.id, lesson, false)
  }
  for (const progress of data.teachingProgress) {
    if (progress.subjectId === subject.id) add('progress', progress.id, progress, false)
  }
  return references
}

/**
 * Read-only impact analysis is intentionally diagnostic: it reports whether the whole document is
 * compatible and can still expose a direct legacy Subject reference whose scope is incomplete.
 * Every mutation below continues to require a fully compatible V9 document before using this result.
 */
export function getTeacherSubjectImpactV9(data: AppDataV9, projectId: string, timetableId: string,
  subjectId: string): TeacherSubjectV9Impact {
  const table = data.timetables.find((item) => item.id === timetableId && item.projectId === projectId)
  if (!table) fail('invalid-timetable', 'Timetable does not belong to the selected Project.')
  const subject = data.subjects.find((item) => item.id === subjectId
    && item.projectId === projectId && item.timetableId === timetableId)
  if (!subject) fail('subject-not-found', 'Subject does not belong to this teacher.')
  const clonedSubject = cloneSubject(subject!)
  const configurations = data.teachingUnitSubjects.filter((item) => item.subjectId === subjectId)
    .map(cloneConfiguration)
  const references = teacherSubjectReferences(data, subject!)
  const unsafeScopeReferences = references.filter((reference) => reference.scope !== 'owned')
  const configurationImpacts = configurations.map((configuration): TeacherSubjectV9ConfigurationImpact => {
    const project = data.projects.find((item) => item.id === configuration.projectId)
    const unit = data.teachingUnits.find((item) => item.id === configuration.teachingUnitId)
    const scope = !project || !unit ? 'unknown'
      : configuration.projectId !== subject!.projectId || unit.projectId !== subject!.projectId
        ? 'cross-project' : 'owned'
    return {
      configuration: cloneConfiguration(configuration), projectId: configuration.projectId,
      timetableId: subject!.timetableId, teachingUnitId: configuration.teachingUnitId,
      schoolLevel: unit?.schoolLevel ?? null,
      archived: Boolean(project?.archivedAt), scope,
      blockedReferences: references.filter((reference) => reference.scope !== 'owned'
        || (reference.projectId === configuration.projectId
          && reference.timetableId === subject!.timetableId
          && reference.teachingUnitId === configuration.teachingUnitId)),
    }
  })
  const projectIds = new Set<string>([subject!.projectId])
  const timetableIds = new Set<string>([subject!.timetableId])
  const teachingUnitIds = new Set<string>()
  const archivedProjectIds = new Set<string>()
  if (data.projects.find((item) => item.id === subject!.projectId)?.archivedAt) archivedProjectIds.add(subject!.projectId)
  configurations.forEach((configuration) => {
    projectIds.add(configuration.projectId)
    teachingUnitIds.add(configuration.teachingUnitId)
    if (data.projects.find((item) => item.id === configuration.projectId)?.archivedAt) {
      archivedProjectIds.add(configuration.projectId)
    }
  })
  references.forEach((reference) => {
    if (reference.projectId) projectIds.add(reference.projectId)
    if (reference.timetableId) timetableIds.add(reference.timetableId)
    if (reference.teachingUnitId) teachingUnitIds.add(reference.teachingUnitId)
    if (reference.archived && reference.projectId) archivedProjectIds.add(reference.projectId)
  })
  return {
    documentCompatible: isCompatibleAppDataV9(data), subject: clonedSubject, configurations,
    configurationImpacts, references, projectIds: [...projectIds], timetableIds: [...timetableIds],
    teachingUnitIds: [...teachingUnitIds], archivedProjectIds: [...archivedProjectIds],
    historicalReferences: references.filter((reference) => reference.historical),
    unknownScopeReferences: references.filter((reference) => reference.scope === 'unknown'),
    unsafeScopeReferences,
    deletion: { blocked: configurations.length > 0 || references.length > 0 || !isCompatibleAppDataV9(data),
      configurations: configurations.map(cloneConfiguration), references: [...references] },
  }
}

export function unconfigureTeacherSubjectV9(data: AppDataV9, projectId: string, timetableId: string,
  teachingUnitId: string, subjectId: string): AppDataV9 {
  valid(data)
  const subject = listTeacherSubjectsV9(data, projectId, timetableId).find((item) => item.id === subjectId)
  if (!subject) fail('subject-not-found', 'Subject does not belong to this teacher.')
  const unit = data.teachingUnits.find((item) => item.id === teachingUnitId && item.projectId === projectId)
  if (!unit) fail('invalid-teaching-unit', 'TeachingUnit does not belong to the selected Project.')
  const configuration = data.teachingUnitSubjects.find((item) => item.projectId === projectId
    && item.teachingUnitId === teachingUnitId && item.subjectId === subjectId)
  if (!configuration) fail('configuration-not-found', 'Subject is not configured for this TeachingUnit.', {
    subject: cloneSubject(subject!),
  })
  const impact = getTeacherSubjectImpactV9(data, projectId, timetableId, subjectId)
  const configurationImpact = impact.configurationImpacts.find((item) => item.configuration.id === configuration!.id)
  const blockedReferences = configurationImpact?.blockedReferences ?? impact.unsafeScopeReferences
  if (blockedReferences.length) fail('configuration-referenced',
    'TeachingUnitSubject is still referenced by a Lesson, Change, OneOff, or Progress record.', {
      subject: cloneSubject(subject!), configuration: cloneConfiguration(configuration!),
      references: [...blockedReferences], impact,
    })
  return safe(data, { ...data,
    teachingUnitSubjects: data.teachingUnitSubjects.filter((item) => item.id !== configuration!.id) })
}

export function deleteTeacherSubjectV9(data: AppDataV9, projectId: string, timetableId: string,
  subjectId: string): AppDataV9 {
  valid(data)
  const subject = listTeacherSubjectsV9(data, projectId, timetableId).find((item) => item.id === subjectId)
  if (!subject) {
    fail('subject-not-found', 'Subject does not belong to this teacher.')
  }
  const impact = getTeacherSubjectImpactV9(data, projectId, timetableId, subjectId)
  if (impact.references.length) {
    fail('subject-referenced', 'Subject still has a Lesson, Change, OneOff, or Progress reference.', {
      subject: cloneSubject(subject!), configurations: impact.configurations.map(cloneConfiguration),
      references: [...impact.references], impact,
    })
  }
  if (impact.configurations.length) {
    fail('subject-referenced', 'Subject still has a configuration for one or more TeachingUnits.', {
      subject: cloneSubject(subject!), configurations: impact.configurations.map(cloneConfiguration), impact,
    })
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
  id: string, details?: TimetableV8Details): AppDataV9 {
  valid(data)
  const next = duplicateTeacherTimetableV8(asV8ValidationProjection(data), projectId, sourceId, projectId, id, details)
  return safe(data, { ...data, timetables: next.timetables })
}
export function getTeacherTimetableV9Impact(data: AppDataV9, projectId: string, timetableId: string) {
  valid(data)
  return getTimetableV8Impact(asV8ValidationProjection(data), projectId, timetableId)
}
export function deleteTeacherTimetableV9(data: AppDataV9, projectId: string, timetableId: string): AppDataV9 {
  valid(data)
  if (data.subjects.some((item) => item.timetableId === timetableId)) {
    fail('subject-owned', 'Remove this teacher’s Subject library before deleting the Timetable.')
  }
  const next = deleteTeacherTimetableV8(asV8ValidationProjection(data), projectId, timetableId, true)
  return safe(data, { ...data, timetables: next.timetables })
}

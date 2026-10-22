import type { AppDataV8, SubjectV8 } from '../types'
import type { SubjectCatalogEntry } from './defaultSubjects'
import { searchExistingSubjects, normalizeSubjectText } from '../lib/subjectSearch'
import {
  isSubjectConfiguredForTeachingUnit,
  selectSubjectsForTeachingUnit,
} from './subjectSelectorsV8'
import {
  configureSubjectForTeachingUnit,
  createSubjectForTeachingUnit,
  removeSubjectFromTeachingUnit,
  SubjectV8ManagementError,
  updateSubject,
  type SubjectV8Draft,
} from './subjectsV8'

export interface TeachingUnitSubjectView {
  configured: SubjectV8[]
  available: SubjectV8[]
}

export interface TeachingUnitSubjectChange {
  status: 'updated'
  data: AppDataV8
  subjectId: string
  kind: 'configured' | 'created' | 'extended-applicability'
}

export interface TeachingUnitSubjectConfirmation {
  status: 'requires-applicability-confirmation'
  subject: SubjectV8
  schoolLevel: AppDataV8['teachingUnits'][number]['schoolLevel']
}

export type TeachingUnitSubjectAddResult = TeachingUnitSubjectChange | TeachingUnitSubjectConfirmation

export class TeachingUnitSubjectAdapterError extends Error {
  constructor(public readonly code: 'alias-conflict', message: string) {
    super(message)
    this.name = 'TeachingUnitSubjectAdapterError'
  }
}

function unitForProject(data: AppDataV8, projectId: string, teachingUnitId: string) {
  const unit = data.teachingUnits.find((item) => item.id === teachingUnitId && item.projectId === projectId)
  if (!unit) throw new SubjectV8ManagementError(
    'invalid-teaching-unit',
    'TeachingUnit does not belong to the specified Project.',
  )
  return unit
}

function cloneSubject(subject: SubjectV8): SubjectV8 {
  return { ...subject, applicableSchoolLevels: [...subject.applicableSchoolLevels] }
}

export function getTeachingUnitSubjectView(
  data: AppDataV8,
  projectId: string,
  teachingUnitId: string,
  query = '',
  catalog: readonly SubjectCatalogEntry[] = [],
): TeachingUnitSubjectView {
  const unit = unitForProject(data, projectId, teachingUnitId)
  const configured = selectSubjectsForTeachingUnit(data, projectId, teachingUnitId)
  const configuredIds = new Set(configured.map((subject) => subject.id))
  const projectSubjects = data.subjects.filter((subject) => subject.projectId === projectId)
  const available = searchExistingSubjects(projectSubjects, unit.schoolLevel, query, catalog)
    .filter((subject) => !configuredIds.has(subject.id))
    .map((subject) => cloneSubject(subject as SubjectV8))
  return { configured, available }
}

export function configureExistingSubjectForTeachingUnit(
  data: AppDataV8,
  projectId: string,
  teachingUnitId: string,
  subjectId: string,
  relationId: string,
): TeachingUnitSubjectChange {
  return {
    status: 'updated',
    data: configureSubjectForTeachingUnit(data, projectId, teachingUnitId, subjectId, relationId),
    subjectId,
    kind: 'configured',
  }
}

export function addSubjectDraftToTeachingUnit(
  data: AppDataV8,
  projectId: string,
  teachingUnitId: string,
  draft: SubjectV8Draft,
  ids: { subjectId: string; relationId: string },
  confirmApplicabilityExtension = false,
  catalog: readonly SubjectCatalogEntry[] = [],
): TeachingUnitSubjectAddResult {
  const unit = unitForProject(data, projectId, teachingUnitId)
  const name = normalizeSubjectText(draft.name)
  const sameName = data.subjects.filter((subject) => subject.projectId === projectId
    && normalizeSubjectText(subject.name) === name)

  if (sameName.length > 1) {
    throw new SubjectV8ManagementError(
      'duplicate-name',
      'Multiple Subjects with the same normalized name require repair before configuration.',
    )
  }
  const existing = sameName[0]
  if (!existing) {
    const matchingEntries = catalog.filter((entry) => entry.applicableSchoolLevels.includes(unit.schoolLevel)
      && [entry.name, ...entry.aliases].some((value) => normalizeSubjectText(value) === name))
    const aliasConflict = matchingEntries.flatMap((entry) => {
      const names = new Set([entry.name, ...entry.aliases].map(normalizeSubjectText))
      return data.subjects.filter((subject) => subject.projectId === projectId
        && names.has(normalizeSubjectText(subject.name)))
    })[0]
    if (aliasConflict) {
      throw new TeachingUnitSubjectAdapterError(
        'alias-conflict',
        `Subject name matches a catalog alias used by ${aliasConflict.name}; manual review is required.`,
      )
    }
    return {
      status: 'updated',
      data: createSubjectForTeachingUnit(
        data, projectId, teachingUnitId, draft, ids.subjectId, ids.relationId,
      ),
      subjectId: ids.subjectId,
      kind: 'created',
    }
  }
  if (isSubjectConfiguredForTeachingUnit(data, projectId, teachingUnitId, existing.id)) {
    throw new SubjectV8ManagementError(
      'already-configured',
      'Subject is already configured for this TeachingUnit.',
      { subject: cloneSubject(existing) },
    )
  }
  if (existing.applicableSchoolLevels.includes(unit.schoolLevel)) {
    return configureExistingSubjectForTeachingUnit(
      data, projectId, teachingUnitId, existing.id, ids.relationId,
    )
  }
  if (!confirmApplicabilityExtension) {
    return {
      status: 'requires-applicability-confirmation',
      subject: cloneSubject(existing),
      schoolLevel: unit.schoolLevel,
    }
  }

  const extended = updateSubject(data, projectId, existing.id, {
    name: existing.name,
    shortName: existing.shortName,
    color: existing.color,
    applicableSchoolLevels: [...existing.applicableSchoolLevels, unit.schoolLevel],
  })
  return {
    status: 'updated',
    data: configureSubjectForTeachingUnit(
      extended, projectId, teachingUnitId, existing.id, ids.relationId,
    ),
    subjectId: existing.id,
    kind: 'extended-applicability',
  }
}

export function removeConfiguredSubjectFromTeachingUnit(
  data: AppDataV8,
  projectId: string,
  teachingUnitId: string,
  subjectId: string,
): AppDataV8 {
  return removeSubjectFromTeachingUnit(data, projectId, teachingUnitId, subjectId)
}

export function updateConfiguredSubjectForTeachingUnit(
  data: AppDataV8,
  projectId: string,
  teachingUnitId: string,
  subjectId: string,
  draft: SubjectV8Draft,
): AppDataV8 {
  if (!isSubjectConfiguredForTeachingUnit(data, projectId, teachingUnitId, subjectId)) {
    throw new SubjectV8ManagementError(
      'configuration-not-found',
      'Subject is not configured for this TeachingUnit.',
    )
  }
  return updateSubject(data, projectId, subjectId, draft)
}

export function teachingUnitSubjectErrorMessage(cause: unknown): string {
  if (cause instanceof TeachingUnitSubjectAdapterError && cause.code === 'alias-conflict') {
    return '輸入名稱與既有科目的同義名稱相符，請確認要使用哪一個科目；系統不會自動合併。'
  }
  if (!(cause instanceof SubjectV8ManagementError)) {
    return cause instanceof Error ? cause.message : '科目操作未通過驗證，原有資料未變更。'
  }
  switch (cause.code) {
    case 'configuration-referenced':
      return '這個科目仍有課程使用，請先調整相關課程。'
    case 'already-configured':
      return '這個科目已在目前學校與學制中啟用。'
    case 'duplicate-short-name':
      return '已有其他科目使用相同簡稱，請修改簡稱後再試。'
    case 'duplicate-name':
      return '找到無法安全判定的同名科目，請先檢查既有科目資料。'
    case 'not-applicable':
      return '這個科目尚未適用目前學制，請先確認是否擴充適用學制。'
    case 'archived-project':
      return '封存的專案無法修改科目。'
    case 'invalid-draft':
      return '請完整填寫科目名稱、簡稱與有效顏色。'
    default:
      return '科目資料已變更或無法安全更新，請重新確認後再試。'
  }
}

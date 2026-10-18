import { SCHOOL_LEVELS, type AppDataV4, type SchoolLevel, type Subject } from '../types'
import { subjectsForLevel } from '../lib/subjects'
import { normalizeSubjectText } from '../lib/subjectSearch'
import { isSafeAppDataV4Update } from './validators/v4'
import { isSafeAppDataV5Update } from './validators/v5'
import { isSafeAppDataV6Update } from './validators/v6'

export interface SubjectDraft {
  name: string
  shortName: string
  color: string
  applicableSchoolLevels: SchoolLevel[]
}

export interface SubjectReference {
  kind: 'lesson' | 'override'
  id: string
  projectId: string | null
  teachingUnitId: string | null
  schoolLevel: SchoolLevel | null
  archived: boolean
  historical: boolean
}

export interface SubjectImpact {
  subject: Subject
  references: SubjectReference[]
  projectIds: string[]
  archivedProjectIds: string[]
}

export class SubjectManagementError extends Error {
  constructor(
    public readonly code: 'invalid' | 'duplicate-name' | 'duplicate-short-name' | 'not-found' | 'referenced' | 'level-in-use' | 'confirmation-required',
    message: string,
    public readonly details?: { existingSubject?: Subject; impact?: SubjectImpact; blockedReferences?: SubjectReference[] },
  ) { super(message) }
}

const fail = (message: string): never => { throw new SubjectManagementError('invalid', message) }
const nameKey = normalizeSubjectText

function normalizeDraft(draft: SubjectDraft): SubjectDraft {
  const name = draft.name.trim().normalize('NFC')
  const shortName = draft.shortName.trim().normalize('NFC')
  const color = draft.color.trim()
  if (!name) fail('請輸入科目名稱。')
  if (!shortName) fail('請輸入科目簡稱。')
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail('科目顏色必須是六位十六進位色碼。')
  if (!Array.isArray(draft.applicableSchoolLevels) || draft.applicableSchoolLevels.length === 0
    || new Set(draft.applicableSchoolLevels).size !== draft.applicableSchoolLevels.length
    || !draft.applicableSchoolLevels.every((level) => SCHOOL_LEVELS.includes(level))) fail('請選擇至少一個有效且不重複的學制。')
  return { name, shortName, color, applicableSchoolLevels: [...draft.applicableSchoolLevels] }
}

function assertUnique(data: AppDataV4, draft: SubjectDraft, exceptId?: string, checkName = true, checkShortName = true) {
  const nameMatch = checkName && data.subjects.find((item) => item.id !== exceptId && nameKey(item.name) === nameKey(draft.name))
  if (nameMatch) throw new SubjectManagementError('duplicate-name', `科目「${nameMatch.name}」已存在，請擴充其適用學制。`, { existingSubject: { ...nameMatch, applicableSchoolLevels: nameMatch.applicableSchoolLevels && [...nameMatch.applicableSchoolLevels] } })
  const shortMatch = checkShortName && data.subjects.find((item) => item.id !== exceptId && nameKey(item.shortName) === nameKey(draft.shortName))
  if (shortMatch) throw new SubjectManagementError('duplicate-short-name', `簡稱「${shortMatch.shortName}」已由「${shortMatch.name}」使用。`, { existingSubject: { ...shortMatch, applicableSchoolLevels: shortMatch.applicableSchoolLevels && [...shortMatch.applicableSchoolLevels] } })
}

function assertResult(current: AppDataV4, next: AppDataV4): AppDataV4 {
  const safe = current.schemaVersion === 6 ? isSafeAppDataV6Update(current, next)
    : current.schemaVersion === 5 ? isSafeAppDataV5Update(current, next) : isSafeAppDataV4Update(current, next)
  if (!safe) fail('科目變更未通過資料驗證。')
  return next
}

export function analyzeSubjectReferences(data: AppDataV4, subjectId: string): SubjectReference[] {
  const projects = new Map(data.projects.map((item) => [item.id, item]))
  const units = new Map(data.teachingUnits.map((item) => [item.id, item]))
  const latestVersion = new Map<string, string>()
  data.recurringLessons.forEach((item) => {
    if (item.effectiveStart > (latestVersion.get(item.seriesId) ?? '')) latestVersion.set(item.seriesId, item.effectiveStart)
  })
  const references: SubjectReference[] = []
  for (const lesson of data.recurringLessons) {
    if (lesson.subjectId !== subjectId) continue
    const unit = units.get(lesson.teachingUnitId)
    references.push({
      kind: 'lesson', id: lesson.id, projectId: lesson.projectId, teachingUnitId: lesson.teachingUnitId,
      schoolLevel: unit?.projectId === lesson.projectId ? unit.schoolLevel : null,
      archived: Boolean(projects.get(lesson.projectId)?.archivedAt), historical: lesson.effectiveStart < (latestVersion.get(lesson.seriesId) ?? lesson.effectiveStart),
    })
  }
  for (const override of data.overrides) {
    if (override.replacement?.subjectId !== subjectId) continue
    const unit = override.teachingUnitId ? units.get(override.teachingUnitId) : undefined
    references.push({
      kind: 'override', id: override.id, projectId: override.projectId, teachingUnitId: override.teachingUnitId,
      schoolLevel: override.projectId && unit?.projectId === override.projectId ? unit.schoolLevel : null,
      archived: Boolean(override.projectId && projects.get(override.projectId)?.archivedAt), historical: false,
    })
  }
  return references
}

export function getSubjectImpact(data: AppDataV4, subjectId: string): SubjectImpact {
  const subject = data.subjects.find((item) => item.id === subjectId)
  if (!subject) throw new SubjectManagementError('not-found', '找不到科目。')
  const references = analyzeSubjectReferences(data, subjectId)
  return {
    subject: { ...subject, applicableSchoolLevels: subject.applicableSchoolLevels && [...subject.applicableSchoolLevels] }, references,
    projectIds: [...new Set(references.flatMap((item) => item.projectId ? [item.projectId] : []))],
    archivedProjectIds: [...new Set(references.flatMap((item) => item.archived && item.projectId ? [item.projectId] : []))],
  }
}

export function createSubject(data: AppDataV4, draft: SubjectDraft, id: string): AppDataV4 {
  const normalized = normalizeDraft(draft)
  if (!id.trim() || data.subjects.some((item) => item.id === id)) fail('科目 ID 無效或已存在。')
  assertUnique(data, normalized)
  return assertResult(data, { ...data, subjects: [...data.subjects, { id, ...normalized, origin: 'user' }] })
}

export function addSubjectForLevel(data: AppDataV4, name: string, level: SchoolLevel, id: string): AppDataV4 {
  const normalized = name.trim()
  return createSubject(data, { name: normalized, shortName: normalized.slice(0, 2), color: '#A66D52', applicableSchoolLevels: [level] }, id)
}

export function updateSubject(data: AppDataV4, subjectId: string, draft: SubjectDraft, confirmed = false): AppDataV4 {
  const impact = getSubjectImpact(data, subjectId)
  const normalized = normalizeDraft(draft)
  assertUnique(data, normalized, subjectId,
    nameKey(normalized.name) !== nameKey(impact.subject.name), nameKey(normalized.shortName) !== nameKey(impact.subject.shortName))
  const oldLevels = impact.subject.applicableSchoolLevels ?? [...SCHOOL_LEVELS]
  const removed = oldLevels.filter((level) => !normalized.applicableSchoolLevels.includes(level))
  const blockedReferences = removed.length ? impact.references.filter((item) => item.schoolLevel === null || removed.includes(item.schoolLevel)) : []
  if (blockedReferences.length) throw new SubjectManagementError('level-in-use', '此學制仍有固定課程、歷史版本或替換異動引用，無法移除。', { impact, blockedReferences })
  const changesGlobalDisplay = normalized.name !== impact.subject.name || normalized.shortName !== impact.subject.shortName || normalized.color !== impact.subject.color
  if (!confirmed && (changesGlobalDisplay || removed.length > 0)) throw new SubjectManagementError('confirmation-required', '此變更會影響全域科目或適用學制，請先確認。', { impact })
  return assertResult(data, { ...data, subjects: data.subjects.map((item) => item.id === subjectId ? { ...item, ...normalized, origin: 'user' } : item) })
}

export function deleteSubject(data: AppDataV4, subjectId: string, confirmed = false): AppDataV4 {
  const impact = getSubjectImpact(data, subjectId)
  if (impact.references.length) throw new SubjectManagementError('referenced', '科目仍被固定課程、歷史版本或替換異動引用，無法刪除。', { impact, blockedReferences: impact.references })
  if (!confirmed) throw new SubjectManagementError('confirmation-required', '刪除科目前請明確確認。', { impact })
  return assertResult(data, { ...data, subjects: data.subjects.filter((item) => item.id !== subjectId) })
}

export type SubjectSearchResult = { state: 'select-level' | 'no-subjects' | 'no-results' | 'results'; subjects: Subject[] }

export function searchSubjects(data: AppDataV4, level: SchoolLevel | undefined, query: string): SubjectSearchResult {
  if (!level) return { state: 'select-level', subjects: [] }
  const applicable = subjectsForLevel(data.subjects, level)
  if (!applicable.length) return { state: 'no-subjects', subjects: [] }
  const needle = nameKey(query)
  const matches = needle ? applicable.filter((item) => nameKey(item.name).includes(needle) || nameKey(item.shortName).includes(needle)) : applicable
  return { state: matches.length ? 'results' : 'no-results', subjects: matches }
}

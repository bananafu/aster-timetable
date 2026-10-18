import { SCHOOL_LEVELS, type SchoolLevel, type Subject } from '../types'
import { normalizeSubjectText } from '../lib/subjectSearch'
import { subjectAppliesToLevel } from '../lib/subjects'
import type { SubjectCatalogEntry } from './defaultSubjects'

export type SubjectCatalogAnalysisStatus =
  | 'safe-to-add'
  | 'exists-applicable'
  | 'exists-missing-level'
  | 'same-name-review'
  | 'alias-match-review'
  | 'short-name-conflict'
  | 'catalog-key-id-conflict'
  | 'invalid-catalog-entry'

export interface SubjectCatalogAnalysisItem {
  catalogKey: string
  name: string
  status: SubjectCatalogAnalysisStatus
  reason: string
  existingSubjectIds: string[]
}

export interface SubjectCatalogAnalysisReport {
  schoolLevel: SchoolLevel
  items: SubjectCatalogAnalysisItem[]
  counts: Record<SubjectCatalogAnalysisStatus, number>
  hasConflicts: boolean
}

const STATUSES: readonly SubjectCatalogAnalysisStatus[] = [
  'safe-to-add', 'exists-applicable', 'exists-missing-level', 'same-name-review',
  'alias-match-review', 'short-name-conflict', 'catalog-key-id-conflict', 'invalid-catalog-entry',
]
const KEY_PATTERN = /^(?:core|optional)\.[a-z0-9]+(?:-[a-z0-9]+)*$/
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i

function invalidEntry(entry: SubjectCatalogEntry, duplicateKeys: ReadonlySet<string>, duplicateNames: ReadonlySet<string>, duplicateShortNames: ReadonlySet<string>): string | null {
  const key = entry.catalogKey.trim()
  const name = normalizeSubjectText(entry.name)
  const shortName = normalizeSubjectText(entry.shortName)
  if (!KEY_PATTERN.test(key) || duplicateKeys.has(key)) return 'catalogKey 格式不正確或在分析範圍內重複。'
  if (!name || duplicateNames.has(name)) return '正式名稱為空白或在分析範圍內重複。'
  if (!shortName || duplicateShortNames.has(shortName)) return '簡稱為空白或在分析範圍內重複。'
  if (!COLOR_PATTERN.test(entry.color)) return '預設顏色不是六位十六進位色碼。'
  if (!entry.applicableSchoolLevels.length || new Set(entry.applicableSchoolLevels).size !== entry.applicableSchoolLevels.length
    || !entry.applicableSchoolLevels.every((level) => SCHOOL_LEVELS.includes(level))) return '適用學制為空白、重複或含未知值。'
  if (!entry.aliases.every((alias) => normalizeSubjectText(alias)) || !entry.zhuyinAliases.every((alias) => normalizeSubjectText(alias))) return '搜尋 alias 不得為空白。'
  return null
}

function duplicates(values: readonly string[]): Set<string> {
  const counts = new Map<string, number>()
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1))
  return new Set([...counts].filter(([, count]) => count > 1).map(([value]) => value))
}

export function analyzeSubjectCatalog(subjects: readonly Subject[], schoolLevel: SchoolLevel, entries: readonly SubjectCatalogEntry[]): SubjectCatalogAnalysisReport {
  const duplicateKeys = duplicates(entries.map((entry) => entry.catalogKey.trim()))
  const duplicateNames = duplicates(entries.map((entry) => normalizeSubjectText(entry.name)))
  const duplicateShortNames = duplicates(entries.map((entry) => normalizeSubjectText(entry.shortName)))
  const items: SubjectCatalogAnalysisItem[] = []

  for (const entry of entries) {
    if (!entry.applicableSchoolLevels.includes(schoolLevel)) continue
    const invalid = invalidEntry(entry, duplicateKeys, duplicateNames, duplicateShortNames)
    if (invalid) {
      items.push({ catalogKey: entry.catalogKey, name: entry.name, status: 'invalid-catalog-entry', reason: invalid, existingSubjectIds: [] })
      continue
    }

    const nameKey = normalizeSubjectText(entry.name)
    const aliasKeys = new Set(entry.aliases.map(normalizeSubjectText).filter((alias) => alias !== nameKey))
    const exactName = subjects.filter((subject) => normalizeSubjectText(subject.name) === nameKey)
    const catalogKeyCollision = subjects.filter((subject) => subject.id === entry.catalogKey && normalizeSubjectText(subject.name) !== nameKey)
    const aliasMatches = subjects.filter((subject) => aliasKeys.has(normalizeSubjectText(subject.name)))
    const shortMatches = subjects.filter((subject) => normalizeSubjectText(subject.shortName) === normalizeSubjectText(entry.shortName))

    if (catalogKeyCollision.length) {
      items.push({ catalogKey: entry.catalogKey, name: entry.name, status: 'catalog-key-id-conflict', reason: 'catalogKey 與不同名稱的既有 Subject ID 相同；catalogKey 不得被視為可覆寫的資料 ID。', existingSubjectIds: catalogKeyCollision.map((subject) => subject.id) })
    } else if (exactName.length > 1 || exactName.some((subject) => !subject.id.trim())) {
      items.push({ catalogKey: entry.catalogKey, name: entry.name, status: 'same-name-review', reason: '找到多筆同名 Subject，或同名 Subject 的 ID 無效；不得自動選擇。', existingSubjectIds: exactName.map((subject) => subject.id) })
    } else if (exactName.length === 1) {
      const existing = exactName[0]
      items.push({
        catalogKey: entry.catalogKey, name: entry.name,
        status: subjectAppliesToLevel(existing, schoolLevel) ? 'exists-applicable' : 'exists-missing-level',
        reason: subjectAppliesToLevel(existing, schoolLevel) ? '同名 Subject 已存在且適用目前學制；保留既有資料。' : '同名 Subject 已存在但不適用目前學制；需由使用者確認是否擴充。',
        existingSubjectIds: [existing.id],
      })
    } else if (aliasMatches.length) {
      items.push({ catalogKey: entry.catalogKey, name: entry.name, status: 'alias-match-review', reason: '既有 Subject 名稱符合 catalog 同義名稱；不得自動合併。', existingSubjectIds: aliasMatches.map((subject) => subject.id) })
    } else if (shortMatches.length) {
      items.push({ catalogKey: entry.catalogKey, name: entry.name, status: 'short-name-conflict', reason: 'catalog 簡稱已由其他既有 Subject 使用；直接新增會被現有安全流程拒絕。', existingSubjectIds: shortMatches.map((subject) => subject.id) })
    } else {
      items.push({ catalogKey: entry.catalogKey, name: entry.name, status: 'safe-to-add', reason: '未找到名稱、同義名稱或簡稱衝突；未分配持久化 Subject ID。', existingSubjectIds: [] })
    }
  }

  const counts = Object.fromEntries(STATUSES.map((status) => [status, items.filter((item) => item.status === status).length])) as Record<SubjectCatalogAnalysisStatus, number>
  return { schoolLevel, items, counts, hasConflicts: items.some((item) => !['safe-to-add', 'exists-applicable'].includes(item.status)) }
}


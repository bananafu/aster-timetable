import type { AppDataV4, SchoolLevel } from '../types'
import { DEFAULT_SUBJECT_CATALOG, OPTIONAL_SUBJECT_CATALOG, type SubjectCatalogEntry } from './defaultSubjects'
import { analyzeSubjectCatalog } from './subjectCatalogAnalysis'
import { createProjectSubject } from './subjectManagementAdapter'
import { selectProjectSubjects } from './subjectSelectorsV8'

export type CatalogSchoolLevel = Extract<SchoolLevel, 'junior-high' | 'senior-high'>
export type CatalogItemStatus = 'safe-to-add' | 'exists-applicable' | 'needs-review'

export interface CatalogInstallItem {
  catalogKey: string
  name: string
  category: 'core' | 'optional'
  levels: CatalogSchoolLevel[]
  status: CatalogItemStatus
  reasons: string[]
  existingSubjectIds: string[]
}

export interface CatalogInstallPreview {
  levels: CatalogSchoolLevel[]
  optionalKeys: string[]
  items: CatalogInstallItem[]
  counts: Record<CatalogItemStatus, number>
  sourceSnapshot: string
}

export class CatalogInstallError extends Error {
  constructor(public readonly code: 'invalid-selection' | 'stale-preview' | 'read-only' | 'invalid-id' | 'validation', message: string) {
    super(message)
  }
}

const CATALOG = [...DEFAULT_SUBJECT_CATALOG, ...OPTIONAL_SUBJECT_CATALOG] as readonly SubjectCatalogEntry[]
const OPTIONAL_KEYS = new Set<string>(OPTIONAL_SUBJECT_CATALOG.map((entry) => entry.catalogKey))
const CATALOG_KEYS = new Set<string>(CATALOG.map((entry) => entry.catalogKey))
const LEVELS: CatalogSchoolLevel[] = ['junior-high', 'senior-high']

function selection(levels: readonly CatalogSchoolLevel[], optionalKeys: readonly string[]) {
  if (!levels.length || new Set(levels).size !== levels.length || levels.some((level) => !LEVELS.includes(level))) {
    throw new CatalogInstallError('invalid-selection', '請選擇國中部、普通高中部或兩者。')
  }
  if (new Set(optionalKeys).size !== optionalKeys.length || optionalKeys.some((key) => !OPTIONAL_KEYS.has(key))) {
    throw new CatalogInstallError('invalid-selection', '選取的常用其他課程不在內建清單中。')
  }
  const orderedLevels = LEVELS.filter((level) => levels.includes(level))
  const orderedOptionalKeys: string[] = OPTIONAL_SUBJECT_CATALOG.map((entry) => entry.catalogKey).filter((key) => optionalKeys.includes(key))
  const entries = CATALOG.filter((entry) => !OPTIONAL_KEYS.has(entry.catalogKey) || orderedOptionalKeys.includes(entry.catalogKey))
  return { orderedLevels, orderedOptionalKeys, entries }
}

function editableProject(data: AppDataV4): boolean {
  return Boolean(data.activeProjectId && data.projects.some((project) => project.id === data.activeProjectId && !project.archivedAt))
}

export function previewSubjectCatalogInstall(data: AppDataV4, levels: readonly CatalogSchoolLevel[], optionalKeys: readonly string[] = []): CatalogInstallPreview {
  const { orderedLevels, orderedOptionalKeys, entries } = selection(levels, optionalKeys)
  const projectSubjects = selectProjectSubjects(data, data.activeProjectId)
  const reports = orderedLevels.map((level) => analyzeSubjectCatalog(projectSubjects, level, entries))
  const items = entries.flatMap((entry): CatalogInstallItem[] => {
    const applicable = orderedLevels.filter((level) => entry.applicableSchoolLevels.includes(level))
    if (!applicable.length) return []
    const statuses = applicable.map((level) => ({
      level,
      item: reports.find((report) => report.schoolLevel === level)!.items.find((item) => item.catalogKey === entry.catalogKey)!,
    }))
    const safe = statuses.every(({ item }) => item.status === 'safe-to-add')
    const existing = statuses.every(({ item }) => item.status === 'exists-applicable')
    const status: CatalogItemStatus = safe ? 'safe-to-add' : existing ? 'exists-applicable' : 'needs-review'
    return [{
      catalogKey: entry.catalogKey, name: entry.name,
      category: OPTIONAL_KEYS.has(entry.catalogKey) ? 'optional' : 'core',
      levels: applicable, status,
      reasons: statuses.filter(({ item }) => status === 'needs-review' || item.status !== 'safe-to-add')
        .map(({ level, item }) => `${level === 'junior-high' ? '國中部' : '普通高中部'}：${item.reason}`),
      existingSubjectIds: [...new Set(statuses.flatMap(({ item }) => item.existingSubjectIds))],
    }]
  })
  return {
    levels: orderedLevels, optionalKeys: orderedOptionalKeys, items,
    counts: {
      'safe-to-add': items.filter((item) => item.status === 'safe-to-add').length,
      'exists-applicable': items.filter((item) => item.status === 'exists-applicable').length,
      'needs-review': items.filter((item) => item.status === 'needs-review').length,
    },
    sourceSnapshot: JSON.stringify(data),
  }
}

export interface CatalogInstallResult { data: AppDataV4; addedSubjectIds: string[] }

export function installSafeSubjectCatalog(data: AppDataV4, preview: CatalogInstallPreview, createId: () => string): CatalogInstallResult {
  if (!editableProject(data)) throw new CatalogInstallError('read-only', '目前沒有可編輯的使用中專案；封存專案僅供檢視。')
  if (JSON.stringify(data) !== preview.sourceSnapshot) throw new CatalogInstallError('stale-preview', '科目庫或專案資料已變更，請重新預覽後再確認。')
  const current = previewSubjectCatalogInstall(data, preview.levels, preview.optionalKeys)
  if (JSON.stringify(current.items) !== JSON.stringify(preview.items)) {
    throw new CatalogInstallError('stale-preview', '預覽的科目狀態已變更，請重新預覽。')
  }
  const safe = current.items.filter((item) => item.status === 'safe-to-add')
  let candidate = data
  const addedSubjectIds: string[] = []
  try {
    for (const item of safe) {
      const entry = CATALOG.find((candidateEntry) => candidateEntry.catalogKey === item.catalogKey)!
      const id = createId()
      if (!id.trim() || CATALOG_KEYS.has(id)) throw new CatalogInstallError('invalid-id', '新科目 ID 無效或與內建 catalogKey 相同，整批未寫入。')
      const draft = {
        name: entry.name, shortName: entry.shortName, color: entry.color,
        applicableSchoolLevels: [...item.levels],
      }
      candidate = createProjectSubject(candidate, candidate.activeProjectId!, draft, id)
      addedSubjectIds.push(id)
    }
  } catch (error) {
    if (error instanceof CatalogInstallError) throw error
    throw new CatalogInstallError('validation', error instanceof Error ? `科目新增未通過驗證，整批未寫入：${error.message}` : '科目新增未通過驗證，整批未寫入。')
  }
  return { data: candidate, addedSubjectIds }
}


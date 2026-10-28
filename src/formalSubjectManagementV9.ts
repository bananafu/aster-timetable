import type { SchoolLevel, TeachingUnitSubject } from './types'
import type { AppDataV9, SubjectV9 } from './types/v9'
import { DEFAULT_SUBJECT_CATALOG, OPTIONAL_SUBJECT_CATALOG,
  type SubjectCatalogEntry } from './data/defaultSubjects'
import { analyzeSubjectCatalog, type SubjectCatalogAnalysisStatus } from './data/subjectCatalogAnalysis'
import { configureTeacherSubjectV9, createTeacherSubjectV9, deleteTeacherSubjectV9,
  getTeacherSubjectImpactV9, renameTeacherSubjectV9, unconfigureTeacherSubjectV9,
  type SubjectDraftV9, type TeacherSubjectV9Impact } from './data/teacherSubjectsV9'
import { isCompatibleAppDataV9 } from './data/validators/v9'
import type { FormalV9HostPort } from './formalRuntime'

export interface FormalSubjectManagementV9Selection {
  projectId: string | null
  timetableId: string | null
  teachingUnitId: string | null
}

export type FormalSubjectManagementV9ErrorCode =
  | 'invalid-document'
  | 'not-writable'
  | 'duplicate-submit'
  | 'stale-document'
  | 'scope-mismatch'
  | 'invalid-result'
  | 'receipt-mismatch'
  | 'catalog-not-found'
  | 'catalog-conflict'

export class FormalSubjectManagementV9Error extends Error {
  constructor(readonly code: FormalSubjectManagementV9ErrorCode, message: string) {
    super(message)
    this.name = 'FormalSubjectManagementV9Error'
  }
}

export interface FormalSubjectOperationAvailability {
  enabled: boolean
  reason: string | null
}

export type FormalSubjectCatalogStatus =
  | 'safe-to-create-and-configure'
  | 'configured'
  | 'available-to-configure'
  | 'requires-level-confirmation'
  | Exclude<SubjectCatalogAnalysisStatus, 'safe-to-add' | 'exists-applicable' | 'exists-missing-level'>

export interface FormalSubjectCatalogItem {
  entry: SubjectCatalogEntry
  analysisStatus: SubjectCatalogAnalysisStatus
  status: FormalSubjectCatalogStatus
  reason: string
  existingSubjectId: string | null
  canCreateAndConfigure: boolean
  canConfigure: boolean
  requiresLevelConfirmation: boolean
}

export interface FormalSubjectManagementV9ReadModel {
  selection: FormalSubjectManagementV9Selection
  project: AppDataV9['projects'][number] | null
  timetable: AppDataV9['timetables'][number] | null
  teachingUnit: AppDataV9['teachingUnits'][number] | null
  teachingUnits: AppDataV9['teachingUnits']
  subjects: SubjectV9[]
  configuredSubjects: SubjectV9[]
  unconfiguredSubjects: SubjectV9[]
  teacherConfigurations: TeachingUnitSubject[]
  currentTeachingUnitConfigurations: TeachingUnitSubject[]
  impacts: TeacherSubjectV9Impact[]
  catalog: FormalSubjectCatalogItem[]
  actions: {
    createCustom: FormalSubjectOperationAvailability
    createAndConfigureFromCatalog: FormalSubjectOperationAvailability
    update: FormalSubjectOperationAvailability
    configure: FormalSubjectOperationAvailability
    unconfigure: FormalSubjectOperationAvailability
    impact: FormalSubjectOperationAvailability
    delete: FormalSubjectOperationAvailability
  }
}

type FormalSubjectHostState = Pick<FormalV9HostPort, 'status' | 'writable' | 'pending'>

export type FormalSubjectManagementV9Result = {
  document: AppDataV9
  receipt: NonNullable<FormalV9HostPort['receipt']>
  selection: FormalSubjectManagementV9Selection
  view: FormalSubjectManagementV9ReadModel
  subjectId?: string
  configurationId?: string
}

export interface FormalSubjectActions {
  createCustom: (draft: SubjectDraftV9) => Promise<FormalSubjectManagementV9Result>
  createAndConfigureFromCatalog: (catalogKey: string) => Promise<FormalSubjectManagementV9Result>
  update: (subjectId: string, draft: SubjectDraftV9) => Promise<FormalSubjectManagementV9Result>
  configure: (subjectId: string, confirmLevelExtension?: boolean) => Promise<FormalSubjectManagementV9Result>
  unconfigure: (subjectId: string) => Promise<FormalSubjectManagementV9Result>
  impact: (subjectId: string) => TeacherSubjectV9Impact
  delete: (subjectId: string) => Promise<FormalSubjectManagementV9Result>
}

export interface FormalSubjectManagementV9Controller {
  selection: FormalSubjectManagementV9Selection
  document: AppDataV9
  view: FormalSubjectManagementV9ReadModel
  actions: FormalSubjectActions
}

const CATALOG: readonly SubjectCatalogEntry[] = [
  ...DEFAULT_SUBJECT_CATALOG,
  ...OPTIONAL_SUBJECT_CATALOG,
]

const fail = (code: FormalSubjectManagementV9ErrorCode, message: string): never => {
  throw new FormalSubjectManagementV9Error(code, message)
}

const cloneSelection = (selection: FormalSubjectManagementV9Selection): FormalSubjectManagementV9Selection => ({
  projectId: selection.projectId, timetableId: selection.timetableId,
  teachingUnitId: selection.teachingUnitId,
})
const sameSelection = (left: FormalSubjectManagementV9Selection,
  right: FormalSubjectManagementV9Selection) => left.projectId === right.projectId
    && left.timetableId === right.timetableId && left.teachingUnitId === right.teachingUnitId
const cloneSubject = (subject: SubjectV9): SubjectV9 => ({
  ...subject, applicableSchoolLevels: [...subject.applicableSchoolLevels],
})
const cloneUnit = (unit: AppDataV9['teachingUnits'][number]) => ({
  ...unit, periods: unit.periods.map((period) => ({ ...period })), weekCycle: { ...unit.weekCycle },
})
const cloneCatalogEntry = (entry: SubjectCatalogEntry): SubjectCatalogEntry => ({
  ...entry, applicableSchoolLevels: [...entry.applicableSchoolLevels], aliases: [...entry.aliases],
  zhuyinAliases: [...entry.zhuyinAliases],
})
const availability = (enabled: boolean, reason: string | null = null): FormalSubjectOperationAvailability => ({
  enabled, reason: enabled ? null : reason,
})

function hostBlockReason(host?: FormalSubjectHostState): string | null {
  if (!host) return null
  if (host.pending) return 'V9 Host 正在處理另一筆寫入。'
  if (host.status !== 'active') return `V9 Host 目前狀態為 ${host.status}，不可寫入。`
  if (!host.writable) return 'V9 Host 目前為唯讀。'
  return null
}

function relationAwareCatalog(subjects: readonly SubjectV9[], configuredSubjectIds: ReadonlySet<string>,
  schoolLevel: SchoolLevel): FormalSubjectCatalogItem[] {
  const report = analyzeSubjectCatalog(subjects, schoolLevel, CATALOG)
  return report.items.map((analysis) => {
    const entry = CATALOG.find((item) => item.catalogKey === analysis.catalogKey)!
    const existingSubjectId = analysis.existingSubjectIds.length === 1
      ? analysis.existingSubjectIds[0] : null
    if (analysis.status === 'safe-to-add') return {
      entry: cloneCatalogEntry(entry), analysisStatus: analysis.status,
      status: 'safe-to-create-and-configure' as const,
      reason: '目前教師尚無此科目；可建立獨立 Subject 並配置到目前任教單位。',
      existingSubjectId: null, canCreateAndConfigure: true, canConfigure: false,
      requiresLevelConfirmation: false,
    }
    if (analysis.status === 'exists-applicable' && existingSubjectId) {
      const configured = configuredSubjectIds.has(existingSubjectId)
      return {
        entry: cloneCatalogEntry(entry), analysisStatus: analysis.status,
        status: configured ? 'configured' as const : 'available-to-configure' as const,
        reason: configured ? '目前教師的科目已配置到目前任教單位。'
          : '目前教師已有此科目，可配置到目前任教單位。',
        existingSubjectId, canCreateAndConfigure: false, canConfigure: !configured,
        requiresLevelConfirmation: false,
      }
    }
    if (analysis.status === 'exists-missing-level' && existingSubjectId) return {
      entry: cloneCatalogEntry(entry), analysisStatus: analysis.status,
      status: 'requires-level-confirmation' as const,
      reason: '目前教師已有此科目，但不適用目前學制；確認擴充學制後才可配置。',
      existingSubjectId, canCreateAndConfigure: false, canConfigure: true,
      requiresLevelConfirmation: true,
    }
    return {
      entry: cloneCatalogEntry(entry), analysisStatus: analysis.status,
      status: analysis.status as FormalSubjectCatalogStatus, reason: analysis.reason,
      existingSubjectId, canCreateAndConfigure: false, canConfigure: false,
      requiresLevelConfirmation: false,
    }
  })
}

export function presentFormalSubjectManagementV9(document: AppDataV9,
  selection: FormalSubjectManagementV9Selection,
  host?: FormalSubjectHostState): FormalSubjectManagementV9ReadModel {
  if (!isCompatibleAppDataV9(document)) fail('invalid-document', 'V9 document is unavailable or invalid.')
  const selected = cloneSelection(selection)
  const project = selected.projectId
    ? document.projects.find((item) => item.id === selected.projectId) ?? null : null
  const teachingUnits = project
    ? document.teachingUnits.filter((item) => item.projectId === project.id).map(cloneUnit) : []
  const timetable = project && selected.timetableId
    ? document.timetables.find((item) => item.id === selected.timetableId && item.projectId === project.id) ?? null
    : null
  const teachingUnit = project && selected.teachingUnitId
    ? document.teachingUnits.find((item) => item.id === selected.teachingUnitId && item.projectId === project.id) ?? null
    : null
  const subjects = timetable ? document.subjects.filter((item) => item.projectId === project!.id
    && item.timetableId === timetable.id).map(cloneSubject) : []
  const subjectIds = new Set(subjects.map((item) => item.id))
  const projectUnitIds = new Set(teachingUnits.map((item) => item.id))
  const teacherConfigurations = project && timetable ? document.teachingUnitSubjects.filter((item) =>
    item.projectId === project.id && projectUnitIds.has(item.teachingUnitId) && subjectIds.has(item.subjectId))
    .map((item) => ({ ...item })) : []
  const currentTeachingUnitConfigurations = teachingUnit ? teacherConfigurations
    .filter((item) => item.teachingUnitId === teachingUnit.id).map((item) => ({ ...item })) : []
  const configuredIds = new Set(currentTeachingUnitConfigurations.map((item) => item.subjectId))
  const configuredSubjects = subjects.filter((item) => configuredIds.has(item.id)).map(cloneSubject)
  const unconfiguredSubjects = subjects.filter((item) => !configuredIds.has(item.id)).map(cloneSubject)
  const impacts = timetable ? subjects.map((subject) =>
    getTeacherSubjectImpactV9(document, project!.id, timetable.id, subject.id)) : []
  const catalog = timetable && teachingUnit
    ? relationAwareCatalog(subjects, configuredIds, teachingUnit.schoolLevel) : []

  const teacherScopeReason = !project ? '請先選擇有效的 Project。'
    : project.archivedAt ? '封存 Project 為唯讀。'
      : !timetable ? '請先選擇屬於目前 Project 的教師 Timetable。' : null
  const relationScopeReason = teacherScopeReason
    ?? (!teachingUnit ? '請先選擇屬於目前 Project 的 TeachingUnit。' : null)
  const writeReason = hostBlockReason(host)
  const teacherWriteReason = teacherScopeReason ?? writeReason
  const relationWriteReason = relationScopeReason ?? writeReason
  const teacherWrite = availability(!teacherWriteReason, teacherWriteReason)
  const relationWrite = availability(!relationWriteReason, relationWriteReason)
  const impactRead = availability(Boolean(project && timetable), !project
    ? '請先選擇有效的 Project。' : !timetable
      ? '請先選擇屬於目前 Project 的教師 Timetable。' : null)
  return {
    selection: selected, project: project ? { ...project, term: project.term === null ? null : { ...project.term } } : null,
    timetable: timetable ? { ...timetable } : null, teachingUnit: teachingUnit ? cloneUnit(teachingUnit) : null,
    teachingUnits, subjects, configuredSubjects, unconfiguredSubjects, teacherConfigurations,
    currentTeachingUnitConfigurations, impacts, catalog,
    actions: {
      createCustom: teacherWrite, createAndConfigureFromCatalog: relationWrite,
      update: teacherWrite, configure: relationWrite, unconfigure: relationWrite,
      impact: impactRead, delete: teacherWrite,
    },
  }
}

function requireScope(document: AppDataV9, selection: FormalSubjectManagementV9Selection,
  requireTeachingUnit: boolean, editable: boolean) {
  const project = selection.projectId
    ? document.projects.find((item) => item.id === selection.projectId) : undefined
  if (!project || (editable && project.archivedAt)) {
    fail('scope-mismatch', project?.archivedAt ? 'Archived Project is read-only.' : 'Project scope is unavailable.')
  }
  const timetable = selection.timetableId
    ? document.timetables.find((item) => item.id === selection.timetableId && item.projectId === project!.id)
    : undefined
  if (!timetable) fail('scope-mismatch', 'Timetable does not belong to the selected Project.')
  const teachingUnit = selection.teachingUnitId
    ? document.teachingUnits.find((item) => item.id === selection.teachingUnitId && item.projectId === project!.id)
    : undefined
  if (requireTeachingUnit && !teachingUnit) {
    fail('scope-mismatch', 'TeachingUnit does not belong to the selected Project.')
  }
  return { project, timetable, teachingUnit }
}

/**
 * Unmounted formal V9 Subject controller. The optional selection reader lets the later React adapter
 * invalidate callbacks captured before a Project, Timetable or TeachingUnit switch.
 */
export function createFormalSubjectManagementV9Controller(host: FormalV9HostPort,
  createId: () => string, selection: FormalSubjectManagementV9Selection,
  readCurrentSelection: () => FormalSubjectManagementV9Selection = () => selection): FormalSubjectManagementV9Controller {
  const initialCandidate = host.document
  if (!initialCandidate || !isCompatibleAppDataV9(initialCandidate)) {
    throw new FormalSubjectManagementV9Error('invalid-document', 'V9 document is unavailable or invalid.')
  }
  const initial = initialCandidate
  const capturedSelection = cloneSelection(selection)
  const initialRaw = JSON.stringify(initial)
  const initialRevision = host.revision
  let submitting = false

  const assertCurrentSelection = () => {
    if (!sameSelection(readCurrentSelection(), capturedSelection)) {
      fail('scope-mismatch', 'Project, Timetable or TeachingUnit selection changed before submission.')
    }
  }
  const commit = async (produce: (current: AppDataV9) => AppDataV9,
    metadata: () => Pick<FormalSubjectManagementV9Result, 'subjectId' | 'configurationId'> = () => ({})) => {
    assertCurrentSelection()
    if (submitting || host.pending) fail('duplicate-submit', 'A V9 write is already in progress.')
    if (host.status !== 'active' || !host.writable) fail('not-writable', 'V9 Host is read-only.')
    if (host.revision !== initialRevision || !host.document
      || JSON.stringify(host.document) !== initialRaw) {
      fail('stale-document', 'V9 document or revision changed before submission.')
    }
    let nextDocument: AppDataV9 | null = null
    submitting = true
    try {
      const receipt = await host.update((current) => {
        assertCurrentSelection()
        if (JSON.stringify(current) !== initialRaw) {
          fail('stale-document', 'V9 document changed before submission.')
        }
        const next = produce(current)
        if (!isCompatibleAppDataV9(next)) fail('invalid-result', 'V9 operation produced an invalid document.')
        nextDocument = next
        return next
      })
      const confirmed = nextDocument as AppDataV9 | null
      if (!confirmed) {
        throw new FormalSubjectManagementV9Error('receipt-mismatch',
          'V9 Host receipt does not confirm the submitted document.')
      }
      if (receipt.raw !== JSON.stringify(confirmed)
        || receipt.revision !== initialRevision + 1 || !receipt.attemptId) {
        fail('receipt-mismatch', 'V9 Host receipt does not confirm the submitted document.')
      }
      return { document: confirmed, receipt, selection: cloneSelection(capturedSelection),
        view: presentFormalSubjectManagementV9(confirmed, capturedSelection,
          { status: 'active', writable: true, pending: false }), ...metadata() }
    } finally {
      submitting = false
    }
  }

  const actions: FormalSubjectActions = {
    createCustom: async (draft) => {
      requireScope(initial, capturedSelection, false, true)
      let subjectId = ''
      return commit((current) => {
        requireScope(current, capturedSelection, false, true)
        subjectId = createId()
        return createTeacherSubjectV9(current, capturedSelection.projectId!,
          capturedSelection.timetableId!, draft, subjectId)
      }, () => ({ subjectId }))
    },
    createAndConfigureFromCatalog: async (catalogKey) => {
      requireScope(initial, capturedSelection, true, true)
      const catalogItem = presentFormalSubjectManagementV9(initial, capturedSelection).catalog
        .find((item) => item.entry.catalogKey === catalogKey)
      if (!catalogItem) fail('catalog-not-found', 'Catalog entry is not available for the selected school level.')
      if (catalogItem!.status !== 'safe-to-create-and-configure') {
        fail('catalog-conflict', catalogItem!.reason)
      }
      let subjectId = ''
      let configurationId = ''
      return commit((current) => {
        requireScope(current, capturedSelection, true, true)
        subjectId = createId()
        configurationId = createId()
        const entry = CATALOG.find((item) => item.catalogKey === catalogKey)!
        const created = createTeacherSubjectV9(current, capturedSelection.projectId!,
          capturedSelection.timetableId!, {
            name: entry.name, shortName: entry.shortName, color: entry.color,
            applicableSchoolLevels: [...entry.applicableSchoolLevels],
          }, subjectId)
        return configureTeacherSubjectV9(created, capturedSelection.projectId!,
          capturedSelection.timetableId!, capturedSelection.teachingUnitId!,
          subjectId, configurationId)
      }, () => ({ subjectId, configurationId }))
    },
    update: async (subjectId, draft) => {
      requireScope(initial, capturedSelection, false, true)
      return commit((current) => {
        requireScope(current, capturedSelection, false, true)
        return renameTeacherSubjectV9(current, capturedSelection.projectId!,
          capturedSelection.timetableId!, subjectId, draft)
      }, () => ({ subjectId }))
    },
    configure: async (subjectId, confirmLevelExtension = false) => {
      requireScope(initial, capturedSelection, true, true)
      let configurationId = ''
      return commit((current) => {
        requireScope(current, capturedSelection, true, true)
        configurationId = createId()
        return configureTeacherSubjectV9(current, capturedSelection.projectId!,
          capturedSelection.timetableId!, capturedSelection.teachingUnitId!, subjectId,
          configurationId, confirmLevelExtension)
      }, () => ({ subjectId, configurationId }))
    },
    unconfigure: async (subjectId) => {
      requireScope(initial, capturedSelection, true, true)
      return commit((current) => {
        requireScope(current, capturedSelection, true, true)
        return unconfigureTeacherSubjectV9(current, capturedSelection.projectId!,
          capturedSelection.timetableId!, capturedSelection.teachingUnitId!, subjectId)
      }, () => ({ subjectId }))
    },
    impact: (subjectId) => {
      requireScope(initial, capturedSelection, false, false)
      assertCurrentSelection()
      return getTeacherSubjectImpactV9(initial, capturedSelection.projectId!,
        capturedSelection.timetableId!, subjectId)
    },
    delete: async (subjectId) => {
      requireScope(initial, capturedSelection, false, true)
      return commit((current) => {
        requireScope(current, capturedSelection, false, true)
        return deleteTeacherSubjectV9(current, capturedSelection.projectId!,
          capturedSelection.timetableId!, subjectId)
      }, () => ({ subjectId }))
    },
  }

  return { selection: capturedSelection, document: initial,
    view: presentFormalSubjectManagementV9(initial, capturedSelection, host), actions }
}

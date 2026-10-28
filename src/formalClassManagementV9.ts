import type { ClassV8Draft } from './data/classesV8'
import { createClassV9, deleteClassV9, getClassV9Impact, updateClassV9 } from './data/managementV9'
import { isCompatibleAppDataV9 } from './data/validators/v9'
import type { FormalV9HostPort } from './formalRuntime'
import type { AppDataV9 } from './types/v9'

export interface FormalClassManagementV9Selection {
  projectId: string | null
  teachingUnitId: string | null
}

export type FormalClassImpactV9 = ReturnType<typeof getClassV9Impact>

export type FormalClassManagementV9ErrorCode =
  | 'invalid-document'
  | 'not-writable'
  | 'duplicate-submit'
  | 'stale-document'
  | 'scope-mismatch'
  | 'class-referenced'
  | 'invalid-result'
  | 'receipt-mismatch'

export class FormalClassManagementV9Error extends Error {
  constructor(readonly code: FormalClassManagementV9ErrorCode, message: string,
    readonly impact?: FormalClassImpactV9) {
    super(message)
    this.name = 'FormalClassManagementV9Error'
  }
}

export interface FormalClassOperationAvailability {
  enabled: boolean
  reason: string | null
}

export interface FormalClassManagementV9ReadModel {
  selection: FormalClassManagementV9Selection
  project: AppDataV9['projects'][number] | null
  teachingUnit: AppDataV9['teachingUnits'][number] | null
  schools: AppDataV9['schools']
  teachingUnits: AppDataV9['teachingUnits']
  classes: AppDataV9['classes']
  impacts: FormalClassImpactV9[]
  actions: {
    create: FormalClassOperationAvailability
    update: FormalClassOperationAvailability
    impact: FormalClassOperationAvailability
    delete: FormalClassOperationAvailability
  }
}

export interface FormalClassManagementV9Result {
  document: AppDataV9
  receipt: NonNullable<FormalV9HostPort['receipt']>
  selection: FormalClassManagementV9Selection
  view: FormalClassManagementV9ReadModel
  classId?: string
}

export interface FormalClassActions {
  create: (draft: ClassV8Draft) => Promise<FormalClassManagementV9Result>
  update: (classId: string, draft: ClassV8Draft) => Promise<FormalClassManagementV9Result>
  impact: (classId: string) => FormalClassImpactV9
  delete: (classId: string) => Promise<FormalClassManagementV9Result>
}

export interface FormalClassManagementV9Controller {
  selection: FormalClassManagementV9Selection
  document: AppDataV9
  view: FormalClassManagementV9ReadModel
  actions: FormalClassActions
}

type HostState = Pick<FormalV9HostPort, 'status' | 'writable' | 'pending'>

const fail = (code: FormalClassManagementV9ErrorCode, message: string,
  impact?: FormalClassImpactV9): never => {
  throw new FormalClassManagementV9Error(code, message, impact)
}
const cloneSelection = (selection: FormalClassManagementV9Selection): FormalClassManagementV9Selection => ({
  projectId: selection.projectId, teachingUnitId: selection.teachingUnitId,
})
const sameSelection = (left: FormalClassManagementV9Selection,
  right: FormalClassManagementV9Selection) => left.projectId === right.projectId
    && left.teachingUnitId === right.teachingUnitId
const cloneUnit = (unit: AppDataV9['teachingUnits'][number]) => ({ ...unit,
  periods: unit.periods.map((period) => ({ ...period })), weekCycle: { ...unit.weekCycle },
})
const availability = (enabled: boolean, reason: string | null = null): FormalClassOperationAvailability => ({
  enabled, reason: enabled ? null : reason,
})

function hostReason(host?: HostState): string | null {
  if (!host) return null
  if (host.pending) return 'V9 Host 正在處理另一筆寫入。'
  if (host.status !== 'active') return `V9 Host 目前狀態為 ${host.status}，不可寫入。`
  if (!host.writable) return 'V9 Host 目前為唯讀。'
  return null
}

export function presentFormalClassManagementV9(document: AppDataV9,
  selection: FormalClassManagementV9Selection, host?: HostState): FormalClassManagementV9ReadModel {
  if (!isCompatibleAppDataV9(document)) fail('invalid-document', 'V9 document is unavailable or invalid.')
  const selected = cloneSelection(selection)
  const project = selected.projectId
    ? document.projects.find((item) => item.id === selected.projectId) ?? null : null
  const schools = project ? document.schools.filter((item) => item.projectId === project.id)
    .map((item) => ({ ...item })) : []
  const teachingUnits = project ? document.teachingUnits.filter((item) => item.projectId === project.id)
    .map(cloneUnit) : []
  const teachingUnit = project && selected.teachingUnitId
    ? teachingUnits.find((item) => item.id === selected.teachingUnitId) ?? null : null
  const classes = teachingUnit ? document.classes.filter((item) => item.projectId === project!.id
    && item.teachingUnitId === teachingUnit.id).map((item) => ({ ...item })) : []
  const impacts = project ? classes.map((item) => getClassV9Impact(document, project.id, item.id)) : []
  const scopeReason = !project ? '請先選擇有效的 Project。'
    : project.archivedAt ? '封存 Project 為唯讀。'
      : !teachingUnit ? '請先選擇屬於目前 Project 的 TeachingUnit。' : null
  const writeReason = scopeReason ?? hostReason(host)
  const write = availability(!writeReason, writeReason)
  return {
    selection: selected,
    project: project ? { ...project, term: project.term === null ? null : { ...project.term } } : null,
    teachingUnit: teachingUnit ? cloneUnit(teachingUnit) : null,
    schools, teachingUnits, classes, impacts,
    actions: {
      create: write, update: write,
      impact: availability(Boolean(project && teachingUnit), !project
        ? '請先選擇有效的 Project。' : !teachingUnit
          ? '請先選擇屬於目前 Project 的 TeachingUnit。' : null),
      delete: write,
    },
  }
}

function requireScope(document: AppDataV9, selection: FormalClassManagementV9Selection,
  editable: boolean) {
  const project = selection.projectId
    ? document.projects.find((item) => item.id === selection.projectId) : undefined
  if (!project || (editable && project.archivedAt)) {
    fail('scope-mismatch', project?.archivedAt ? 'Archived Project is read-only.' : 'Project scope is unavailable.')
  }
  const teachingUnit = selection.teachingUnitId
    ? document.teachingUnits.find((item) => item.id === selection.teachingUnitId
      && item.projectId === project!.id) : undefined
  if (!teachingUnit) fail('scope-mismatch', 'TeachingUnit does not belong to the selected Project.')
  return { project, teachingUnit }
}

function requireClass(document: AppDataV9, selection: FormalClassManagementV9Selection,
  classId: string) {
  const scope = requireScope(document, selection, true)
  const schoolClass = document.classes.find((item) => item.id === classId
    && item.projectId === scope.project!.id && item.teachingUnitId === scope.teachingUnit!.id)
  if (!schoolClass) fail('scope-mismatch', 'Class does not belong to the selected Project and TeachingUnit.')
  return { ...scope, schoolClass }
}

function referencedMessage(impact: FormalClassImpactV9) {
  const labels = [
    impact.recurringLessons ? `${impact.recurringLessons} 筆固定課程` : '',
    impact.overrides ? `${impact.overrides} 筆課程異動` : '',
    impact.oneOffLessons ? `${impact.oneOffLessons} 筆單日課程` : '',
    impact.teachingProgress ? `${impact.teachingProgress} 筆教學進度` : '',
  ].filter(Boolean)
  return labels.length ? `班級仍被${labels.join('、')}引用；請先處理引用後再刪除。` : null
}

/** Unmounted formal Class controller; all mutations remain behind the existing V9 Host. */
export function createFormalClassManagementV9Controller(host: FormalV9HostPort,
  createId: () => string, selection: FormalClassManagementV9Selection,
  readCurrentSelection: () => FormalClassManagementV9Selection = () => selection): FormalClassManagementV9Controller {
  const candidate = host.document
  if (!candidate || !isCompatibleAppDataV9(candidate)) {
    throw new FormalClassManagementV9Error('invalid-document',
      'V9 document is unavailable or invalid.')
  }
  const initial: AppDataV9 = candidate
  const capturedSelection = cloneSelection(selection)
  const initialRaw = JSON.stringify(initial)
  const initialRevision = host.revision
  let submitting = false

  const assertSelection = () => {
    if (!sameSelection(readCurrentSelection(), capturedSelection)) {
      fail('scope-mismatch', 'Project or TeachingUnit selection changed before submission.')
    }
  }
  const commit = async (produce: (current: AppDataV9) => AppDataV9,
    metadata: () => Pick<FormalClassManagementV9Result, 'classId'> = () => ({})) => {
    assertSelection()
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
        assertSelection()
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
        throw new FormalClassManagementV9Error('receipt-mismatch',
          'V9 Host receipt does not confirm the submitted document.')
      }
      if (receipt.raw !== JSON.stringify(confirmed)
        || receipt.revision !== initialRevision + 1 || !receipt.attemptId) {
        fail('receipt-mismatch', 'V9 Host receipt does not confirm the submitted document.')
      }
      return { document: confirmed, receipt, selection: cloneSelection(capturedSelection),
        view: presentFormalClassManagementV9(confirmed, capturedSelection,
          { status: 'active', writable: true, pending: false }), ...metadata() }
    } finally {
      submitting = false
    }
  }

  const actions: FormalClassActions = {
    create: async (draft) => {
      requireScope(initial, capturedSelection, true)
      if (draft.teachingUnitId !== capturedSelection.teachingUnitId) {
        fail('scope-mismatch', 'Class draft targets another TeachingUnit.')
      }
      let classId = ''
      return commit((current) => {
        requireScope(current, capturedSelection, true)
        classId = createId()
        return createClassV9(current, capturedSelection.projectId!, draft, classId)
      }, () => ({ classId }))
    },
    update: async (classId, draft) => {
      requireClass(initial, capturedSelection, classId)
      if (draft.teachingUnitId !== capturedSelection.teachingUnitId) {
        fail('scope-mismatch', 'Class cannot be moved through another TeachingUnit scope.')
      }
      return commit((current) => {
        requireClass(current, capturedSelection, classId)
        return updateClassV9(current, capturedSelection.projectId!, classId, draft)
      }, () => ({ classId }))
    },
    impact: (classId) => {
      assertSelection()
      requireClass(initial, capturedSelection, classId)
      return getClassV9Impact(initial, capturedSelection.projectId!, classId)
    },
    delete: async (classId) => {
      requireClass(initial, capturedSelection, classId)
      const initialImpact = getClassV9Impact(initial, capturedSelection.projectId!, classId)
      const initialBlocked = referencedMessage(initialImpact)
      if (initialBlocked) fail('class-referenced', initialBlocked, initialImpact)
      return commit((current) => {
        requireClass(current, capturedSelection, classId)
        const impact = getClassV9Impact(current, capturedSelection.projectId!, classId)
        const blocked = referencedMessage(impact)
        if (blocked) fail('class-referenced', blocked, impact)
        return deleteClassV9(current, capturedSelection.projectId!, classId, true)
      }, () => ({ classId }))
    },
  }

  return { selection: capturedSelection, document: initial,
    view: presentFormalClassManagementV9(initial, capturedSelection, host), actions }
}

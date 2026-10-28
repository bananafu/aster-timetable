import type { SchoolV8Draft, TeachingUnitV8Draft } from './data/academicSettingsV8'
import { createDefaultPeriods } from './data/academicSettingsV4'
import { createSchoolV9, createTeachingUnitV9, updateSchoolV9,
  updateTeachingUnitV9 } from './data/managementV9'
import { isCompatibleAppDataV9 } from './data/validators/v9'
import type { FormalV9HostPort } from './formalRuntime'
import type { SchoolLevel } from './types'
import type { AppDataV9 } from './types/v9'

export interface FormalAcademicSettingsV9Selection {
  projectId: string | null
  timetableId: string | null
  teachingUnitId: string | null
}

export interface FormalTeachingUnitV9Input {
  schoolLevel: SchoolLevel
  name?: string
  startDate: string
  endDate: string
}

export type FormalAcademicSettingsV9ErrorCode =
  | 'invalid-document'
  | 'not-writable'
  | 'duplicate-submit'
  | 'stale-document'
  | 'scope-mismatch'
  | 'invalid-result'
  | 'receipt-mismatch'

export class FormalAcademicSettingsV9Error extends Error {
  constructor(readonly code: FormalAcademicSettingsV9ErrorCode, message: string) {
    super(message)
    this.name = 'FormalAcademicSettingsV9Error'
  }
}

export interface FormalAcademicSettingsV9ReadModel {
  selection: FormalAcademicSettingsV9Selection
  project: AppDataV9['projects'][number] | null
  schools: AppDataV9['schools']
  teachingUnits: AppDataV9['teachingUnits']
  writable: boolean
  writeReason: string | null
}

export interface FormalAcademicSettingsV9Result {
  document: AppDataV9
  receipt: NonNullable<FormalV9HostPort['receipt']>
  selection: FormalAcademicSettingsV9Selection
  view: FormalAcademicSettingsV9ReadModel
  schoolId?: string
  teachingUnitId?: string
}

type ResultMetadata = Pick<FormalAcademicSettingsV9Result, 'schoolId' | 'teachingUnitId' | 'selection'>

const fail = (code: FormalAcademicSettingsV9ErrorCode, message: string): never => {
  throw new FormalAcademicSettingsV9Error(code, message)
}
const cloneSelection = (selection: FormalAcademicSettingsV9Selection): FormalAcademicSettingsV9Selection => ({
  projectId: selection.projectId,
  timetableId: selection.timetableId,
  teachingUnitId: selection.teachingUnitId,
})
const sameSelection = (left: FormalAcademicSettingsV9Selection,
  right: FormalAcademicSettingsV9Selection) => left.projectId === right.projectId
    && left.timetableId === right.timetableId && left.teachingUnitId === right.teachingUnitId
const cloneUnit = (unit: AppDataV9['teachingUnits'][number]) => ({ ...unit,
  periods: unit.periods.map((period) => ({ ...period })), weekCycle: { ...unit.weekCycle },
})

function hostReason(host: Pick<FormalV9HostPort, 'status' | 'writable' | 'pending'>): string | null {
  if (host.pending) return 'V9 Host 正在處理另一筆寫入。'
  if (host.status !== 'active') return `V9 Host 目前狀態為 ${host.status}，不可寫入。`
  if (!host.writable) return 'V9 Host 目前為唯讀。'
  return null
}

export function presentFormalAcademicSettingsV9(document: AppDataV9,
  selection: FormalAcademicSettingsV9Selection,
  host: Pick<FormalV9HostPort, 'status' | 'writable' | 'pending'>): FormalAcademicSettingsV9ReadModel {
  if (!isCompatibleAppDataV9(document)) fail('invalid-document', 'V9 document is unavailable or invalid.')
  const selected = cloneSelection(selection)
  const project = selected.projectId
    ? document.projects.find((item) => item.id === selected.projectId) ?? null : null
  const writeReason = !project ? '請先選擇有效的 Project。'
    : project.archivedAt ? '封存 Project 為唯讀。' : hostReason(host)
  return {
    selection: selected,
    project: project ? { ...project, term: project.term === null ? null : { ...project.term } } : null,
    schools: project ? document.schools.filter((item) => item.projectId === project.id)
      .map((item) => ({ ...item })) : [],
    teachingUnits: project ? document.teachingUnits.filter((item) => item.projectId === project.id)
      .map(cloneUnit) : [],
    writable: !writeReason,
    writeReason,
  }
}

function requireProject(document: AppDataV9, projectId: string | null) {
  const project = projectId ? document.projects.find((item) => item.id === projectId) : undefined
  if (!project || project.archivedAt) {
    fail('scope-mismatch', project?.archivedAt ? 'Archived Project is read-only.' : 'Project scope is unavailable.')
  }
  return project
}

function unitDraft(schoolId: string, input: FormalTeachingUnitV9Input): TeachingUnitV8Draft {
  const name = input.name?.trim() || (input.schoolLevel === 'junior-high' ? '國中部'
    : input.schoolLevel === 'senior-high' ? '高中部' : '')
  if (!name) fail('scope-mismatch', '其他學制需要可辨識的自訂名稱。')
  return {
    schoolId,
    name,
    schoolLevel: input.schoolLevel,
    startDate: input.startDate,
    endDate: input.endDate,
    periods: createDefaultPeriods(input.schoolLevel),
    weekCycle: { enabled: true, anchorDate: input.startDate, anchorPattern: 'A' },
  }
}

/** Formal School/TeachingUnit controller; all mutations use the single existing V9 Host. */
export function createFormalAcademicSettingsV9Controller(host: FormalV9HostPort,
  createId: () => string, selection: FormalAcademicSettingsV9Selection,
  readCurrentSelection: () => FormalAcademicSettingsV9Selection = () => selection) {
  const candidate = host.document
  if (!candidate || !isCompatibleAppDataV9(candidate)) {
    throw new FormalAcademicSettingsV9Error('invalid-document', 'V9 document is unavailable or invalid.')
  }
  const initial: AppDataV9 = candidate
  const capturedSelection = cloneSelection(selection)
  const initialRaw = JSON.stringify(initial)
  const initialRevision = host.revision
  let submitting = false

  const assertSelection = () => {
    if (!sameSelection(readCurrentSelection(), capturedSelection)) {
      fail('scope-mismatch', 'Project, Timetable, or TeachingUnit selection changed before submission.')
    }
  }
  const commit = async (produce: (current: AppDataV9) => AppDataV9,
    metadata: () => Partial<ResultMetadata> = () => ({})): Promise<FormalAcademicSettingsV9Result> => {
    assertSelection()
    if (submitting || host.pending) fail('duplicate-submit', 'A V9 write is already in progress.')
    if (host.status !== 'active' || !host.writable) fail('not-writable', 'V9 Host is read-only.')
    if (host.revision !== initialRevision || !host.document || JSON.stringify(host.document) !== initialRaw) {
      fail('stale-document', 'V9 document or revision changed before submission.')
    }
    let nextDocument: AppDataV9 | null = null
    submitting = true
    try {
      const receipt = await host.update((current) => {
        assertSelection()
        if (JSON.stringify(current) !== initialRaw) fail('stale-document', 'V9 document changed before submission.')
        const next = produce(current)
        if (!isCompatibleAppDataV9(next)) fail('invalid-result', 'V9 operation produced an invalid document.')
        nextDocument = next
        return next
      })
      const confirmed = nextDocument as AppDataV9 | null
      if (!confirmed || receipt.raw !== JSON.stringify(confirmed)
        || receipt.revision !== initialRevision + 1 || !receipt.attemptId) {
        fail('receipt-mismatch', 'V9 Host receipt does not confirm the submitted document.')
      }
      const document = confirmed as AppDataV9
      const details = metadata()
      const nextSelection = details.selection ?? cloneSelection(capturedSelection)
      return { document, receipt, selection: nextSelection,
        view: presentFormalAcademicSettingsV9(document, nextSelection,
          { status: 'active', writable: true, pending: false }),
        schoolId: details.schoolId, teachingUnitId: details.teachingUnitId }
    } finally {
      submitting = false
    }
  }

  const actions = {
    createSchool: (draft: SchoolV8Draft) => {
      requireProject(initial, capturedSelection.projectId)
      let schoolId = ''
      return commit((current) => {
        requireProject(current, capturedSelection.projectId)
        schoolId = createId()
        return createSchoolV9(current, capturedSelection.projectId!, draft, schoolId)
      }, () => ({ schoolId }))
    },
    createSchoolWithTeachingUnit: (school: SchoolV8Draft, input: FormalTeachingUnitV9Input) => {
      requireProject(initial, capturedSelection.projectId)
      let schoolId = ''
      let teachingUnitId = ''
      return commit((current) => {
        requireProject(current, capturedSelection.projectId)
        schoolId = createId()
        teachingUnitId = createId()
        const withSchool = createSchoolV9(current, capturedSelection.projectId!, school, schoolId)
        return createTeachingUnitV9(withSchool, capturedSelection.projectId!,
          unitDraft(schoolId, input), teachingUnitId)
      }, () => ({ schoolId, teachingUnitId, selection: { ...capturedSelection, teachingUnitId } }))
    },
    updateSchool: (schoolId: string, draft: SchoolV8Draft) => {
      requireProject(initial, capturedSelection.projectId)
      if (!initial.schools.some((item) => item.id === schoolId
        && item.projectId === capturedSelection.projectId)) fail('scope-mismatch', 'School is outside selected Project.')
      return commit((current) => updateSchoolV9(current, capturedSelection.projectId!, schoolId, draft),
        () => ({ schoolId }))
    },
    createTeachingUnit: (schoolId: string, input: FormalTeachingUnitV9Input) => {
      requireProject(initial, capturedSelection.projectId)
      if (!initial.schools.some((item) => item.id === schoolId
        && item.projectId === capturedSelection.projectId)) fail('scope-mismatch', 'School is outside selected Project.')
      let teachingUnitId = ''
      return commit((current) => {
        teachingUnitId = createId()
        return createTeachingUnitV9(current, capturedSelection.projectId!, unitDraft(schoolId, input), teachingUnitId)
      }, () => ({ teachingUnitId, selection: { ...capturedSelection, teachingUnitId } }))
    },
    updateTeachingUnit: (teachingUnitId: string, draft: TeachingUnitV8Draft) => {
      requireProject(initial, capturedSelection.projectId)
      const existing = initial.teachingUnits.find((item) => item.id === teachingUnitId
        && item.projectId === capturedSelection.projectId)
      if (!existing || draft.schoolId !== existing.schoolId) {
        fail('scope-mismatch', 'TeachingUnit is outside selected Project or cannot change School ownership.')
      }
      return commit((current) => updateTeachingUnitV9(current, capturedSelection.projectId!,
        teachingUnitId, draft), () => ({ teachingUnitId }))
    },
  }

  return { selection: capturedSelection, document: initial,
    view: presentFormalAcademicSettingsV9(initial, capturedSelection, host), actions }
}

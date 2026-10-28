import type { CopyProjectV8Input } from './data/projectRuntimeV8'
import { archiveProjectV9, configureProjectTermV9, copyProjectV9, createEmptyProjectV9,
  deleteEmptyProjectV9, getProjectV9Impact, reactivateProjectV9,
  type ConfigureProjectTermV9Input, type EmptyProjectV9Input } from './data/managementV9'
import { createTeacherTimetableV9, deleteTeacherTimetableV9, duplicateTeacherTimetableV9,
  getTeacherTimetableV9Impact, updateTeacherTimetableV9 } from './data/teacherSubjectsV9'
import type { TimetableV8Details } from './data/timetablesV8'
import { isCompatibleAppDataV9 } from './data/validators/v9'
import type { FormalV9HostPort } from './formalRuntime'
import type { AppDataV9 } from './types/v9'

export type FormalProjectTimetableV9Selection = {
  projectId: string | null
  timetableId: string | null
}

export type FormalProjectTimetableV9ErrorCode = 'not-writable' | 'duplicate-submit'
  | 'stale-document' | 'scope-mismatch' | 'invalid-result' | 'receipt-mismatch'

export class FormalProjectTimetableV9Error extends Error {
  constructor(readonly code: FormalProjectTimetableV9ErrorCode, message: string) {
    super(message)
    this.name = 'FormalProjectTimetableV9Error'
  }
}

export interface FormalTimetableCopyInput extends TimetableV8Details {
  /** Kept for the established V7 callback shape; no Lesson or Event is copied. */
  baseDate: string
}

export type FormalProjectTimetableV9Result = {
  document: AppDataV9
  receipt: NonNullable<FormalV9HostPort['receipt']>
  selection: FormalProjectTimetableV9Selection
}

const fail = (code: FormalProjectTimetableV9ErrorCode, message: string): never => {
  throw new FormalProjectTimetableV9Error(code, message)
}

const validateDocument = (document: AppDataV9 | null): AppDataV9 => {
  if (!document || !isCompatibleAppDataV9(document)) {
    throw new FormalProjectTimetableV9Error('invalid-result', 'V9 document is unavailable or invalid.')
  }
  return document
}

export function reconcileFormalProjectTimetableV9Selection(document: AppDataV9,
  requested: Partial<FormalProjectTimetableV9Selection> = {}): FormalProjectTimetableV9Selection {
  validateDocument(document)
  const project = document.projects.find((item) => item.id === requested.projectId && !item.archivedAt)
    ?? document.projects.find((item) => item.id === document.activeProjectId && !item.archivedAt)
    ?? document.projects.find((item) => !item.archivedAt)
  const timetable = project && document.timetables.find((item) => item.projectId === project.id
    && item.id === requested.timetableId)
    || (project ? document.timetables.find((item) => item.projectId === project.id) : undefined)
  return { projectId: project?.id ?? null, timetableId: timetable?.id ?? null }
}

export function selectFormalProjectV9(document: AppDataV9, projectId: string): FormalProjectTimetableV9Selection {
  validateDocument(document)
  if (!document.projects.some((item) => item.id === projectId && !item.archivedAt)) {
    fail('scope-mismatch', 'Project is unavailable for selection.')
  }
  return reconcileFormalProjectTimetableV9Selection(document, { projectId })
}

export function selectFormalTimetableV9(document: AppDataV9,
  selection: FormalProjectTimetableV9Selection, timetableId: string): FormalProjectTimetableV9Selection {
  validateDocument(document)
  if (!selection.projectId || !document.timetables.some((item) => item.id === timetableId
    && item.projectId === selection.projectId)) {
    fail('scope-mismatch', 'Timetable does not belong to the selected Project.')
  }
  return { projectId: selection.projectId, timetableId }
}

export function listFormalProjectsV9(document: AppDataV9) {
  validateDocument(document)
  return document.projects.map((item) => ({ ...item, term: item.term === null ? null : { ...item.term } }))
}

export function listFormalTimetablesV9(document: AppDataV9, projectId: string) {
  validateDocument(document)
  if (!document.projects.some((item) => item.id === projectId)) fail('scope-mismatch', 'Project does not exist.')
  return document.timetables.filter((item) => item.projectId === projectId).map((item) => ({ ...item }))
}

export const FORMAL_PROJECT_V9_CAPABILITIES = {
  renameProject: false,
  viewArchivedProject: false,
} as const

/**
 * Unmounted Stage 1A action map. Every mutation has one path: the existing V9 Host update.
 * Callers own local Project/Timetable selection and replace it with result.selection after success.
 */
export function createFormalProjectTimetableV9Controller(host: FormalV9HostPort,
  createId: () => string, requestedSelection: Partial<FormalProjectTimetableV9Selection> = {},
  readSelection?: () => FormalProjectTimetableV9Selection) {
  let submitting = false
  const initial = validateDocument(host.document)
  const initialRaw = JSON.stringify(initial)
  const initialRevision = host.revision
  const initialSelection = reconcileFormalProjectTimetableV9Selection(initial, requestedSelection)
  const assertSelection = () => {
    const live = readSelection ? reconcileFormalProjectTimetableV9Selection(initial, readSelection()) : initialSelection
    if (live.projectId !== initialSelection.projectId || live.timetableId !== initialSelection.timetableId) {
      fail('scope-mismatch', 'Project or Timetable selection changed before confirmation.')
    }
  }

  const requireProject = (document: AppDataV9, projectId: string, editable = false) => {
    const project = document.projects.find((item) => item.id === projectId)
    if (!project || (editable && project.archivedAt)) {
      throw new FormalProjectTimetableV9Error('scope-mismatch', 'Project scope is unavailable.')
    }
    return project
  }
  const requireTimetable = (document: AppDataV9, projectId: string, timetableId: string) => {
    requireProject(document, projectId, true)
    const timetable = document.timetables.find((item) => item.id === timetableId && item.projectId === projectId)
    if (!timetable) fail('scope-mismatch', 'Timetable does not belong to Project.')
    return timetable
  }
  const commit = async (produce: (current: AppDataV9) => AppDataV9,
    choose: (next: AppDataV9) => FormalProjectTimetableV9Selection): Promise<FormalProjectTimetableV9Result> => {
    if (submitting || host.pending) fail('duplicate-submit', 'A V9 write is already in progress.')
    if (host.status !== 'active' || !host.writable) fail('not-writable', 'V9 Host is read-only.')
    assertSelection()
    if (host.revision !== initialRevision) fail('stale-document', 'V9 revision changed before submission.')
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
      assertSelection()
      const confirmed = nextDocument as AppDataV9 | null
      if (!confirmed || receipt.raw !== JSON.stringify(confirmed)
        || receipt.revision !== initialRevision + 1 || !receipt.attemptId) {
        throw new FormalProjectTimetableV9Error('receipt-mismatch',
          'V9 Host receipt does not confirm the submitted document.')
      }
      return { document: confirmed, receipt, selection: choose(confirmed) }
    } finally {
      submitting = false
    }
  }

  return {
    document: initial,
    selection: initialSelection,
    projects: listFormalProjectsV9(initial),
    timetables: initialSelection.projectId ? listFormalTimetablesV9(initial, initialSelection.projectId) : [],
    capabilities: FORMAL_PROJECT_V9_CAPABILITIES,
    selectProject: (projectId: string) => selectFormalProjectV9(initial, projectId),
    selectTimetable: (selection: FormalProjectTimetableV9Selection, timetableId: string) =>
      selectFormalTimetableV9(initial, selection, timetableId),
    getProjectImpact: (projectId: string) => getProjectV9Impact(initial, projectId),
    getTimetableImpact: (projectId: string, timetableId: string) =>
      getTeacherTimetableV9Impact(initial, projectId, timetableId),
    createProject: (input: EmptyProjectV9Input) => commit((current) =>
      createEmptyProjectV9(current, input, createId()),
    (next) => reconcileFormalProjectTimetableV9Selection(next, { projectId: next.activeProjectId })),
    configureSelectedProjectTerm: (input: ConfigureProjectTermV9Input) => {
      const projectId = initialSelection.projectId
      if (!projectId) fail('scope-mismatch', 'Select a Project before configuring its term.')
      const project = requireProject(initial, projectId!, true)
      if (project.term !== null) fail('scope-mismatch', 'Project term is already configured.')
      return commit((current) => configureProjectTermV9(current, projectId!, input),
        (next) => reconcileFormalProjectTimetableV9Selection(next, initialSelection))
    },
    copyProject: (input: CopyProjectV8Input) => {
      requireProject(initial, input.sourceProjectId)
      return commit((current) => copyProjectV9(current, input, createId),
        (next) => reconcileFormalProjectTimetableV9Selection(next, { projectId: next.activeProjectId }))
    },
    archiveProject: (projectId: string) => {
      requireProject(initial, projectId, true)
      return commit((current) => archiveProjectV9(current, projectId),
        (next) => reconcileFormalProjectTimetableV9Selection(next, initialSelection))
    },
    reactivateProject: (projectId: string) => {
      const project = requireProject(initial, projectId)
      if (!project.archivedAt) fail('scope-mismatch', 'Project is not archived.')
      return commit((current) => reactivateProjectV9(current, projectId),
        (next) => reconcileFormalProjectTimetableV9Selection(next, { projectId }))
    },
    deleteProject: (projectId: string, confirmed: true) => {
      requireProject(initial, projectId)
      if (confirmed !== true) fail('scope-mismatch', 'Project deletion requires confirmation.')
      return commit((current) => deleteEmptyProjectV9(current, projectId, true),
        (next) => reconcileFormalProjectTimetableV9Selection(next, initialSelection))
    },
    createTimetable: (projectId: string, details: TimetableV8Details) => {
      requireProject(initial, projectId, true)
      let id = ''
      return commit((current) => {
        id = createId()
        return createTeacherTimetableV9(current, projectId, details, id)
      }, (next) => reconcileFormalProjectTimetableV9Selection(next, { projectId, timetableId: id }))
    },
    updateTimetable: (projectId: string, timetableId: string, details: TimetableV8Details) => {
      requireTimetable(initial, projectId, timetableId)
      return commit((current) => updateTeacherTimetableV9(current, projectId, timetableId, details),
        (next) => reconcileFormalProjectTimetableV9Selection(next, { projectId, timetableId }))
    },
    copyTimetableSettings: (projectId: string, timetableId: string, input: FormalTimetableCopyInput) => {
      requireTimetable(initial, projectId, timetableId)
      const date = new Date(`${input.baseDate}T00:00:00Z`)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.baseDate) || Number.isNaN(date.getTime())
        || date.toISOString().slice(0, 10) !== input.baseDate) fail('scope-mismatch', 'Copy base date is invalid.')
      let id = ''
      return commit((current) => {
        id = createId()
        return duplicateTeacherTimetableV9(current, projectId, timetableId, id,
          { name: input.name, teacherName: input.teacherName })
      }, (next) => reconcileFormalProjectTimetableV9Selection(next, { projectId, timetableId: id }))
    },
    deleteTimetable: (projectId: string, timetableId: string, confirmed: true) => {
      requireTimetable(initial, projectId, timetableId)
      if (confirmed !== true) fail('scope-mismatch', 'Timetable deletion requires confirmation.')
      return commit((current) => deleteTeacherTimetableV9(current, projectId, timetableId),
        (next) => reconcileFormalProjectTimetableV9Selection(next, { projectId }))
    },
  }
}

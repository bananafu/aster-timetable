import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConfigureProjectTermV9Input, EmptyProjectV9Input } from '../data/managementV9'
import type { CopyProjectV8Input } from '../data/projectRuntimeV8'
import type { TimetableV8Details } from '../data/timetablesV8'
import { createFormalProjectTimetableV9Controller, reconcileFormalProjectTimetableV9Selection,
  type FormalProjectTimetableV9Selection, type FormalTimetableCopyInput } from '../formalProjectTimetableV9'
import { toFormalV9HostPort, type FormalV9HostPort } from '../formalRuntime'
import { useAppDataV9 } from './useAppDataV9'

type FormalV9Controller = ReturnType<typeof createFormalProjectTimetableV9Controller>
type Select = (selection: FormalProjectTimetableV9Selection) => void

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

/**
 * Maps formal-product callbacks to the Stage 1A controller. It is intentionally
 * not mounted by the production entry while Stage 0 keeps active V9 fail-closed.
 */
export function createFormalProjectTimetableV9Actions(controller: FormalV9Controller, select: Select) {
  const confirmed = async <T extends Promise<{ selection: FormalProjectTimetableV9Selection }>>(write: T) => {
    const result = await write
    select(result.selection)
    return result
  }
  return {
    selection: controller.selection,
    selectProject: (projectId: string) => select(controller.selectProject(projectId)),
    selectTimetable: (timetableId: string) => select(controller.selectTimetable(controller.selection, timetableId)),
    project: {
      createEmptyFromName: (input: EmptyProjectV9Input) => confirmed(controller.createProject(input)),
      configureTerm: (input: ConfigureProjectTermV9Input) =>
        confirmed(controller.configureSelectedProjectTerm(input)),
      rename: null,
      viewArchived: null,
      copy: (input: CopyProjectV8Input) => confirmed(controller.copyProject(input)),
      archive: (projectId: string) => confirmed(controller.archiveProject(projectId)),
      reactivate: (projectId: string) => confirmed(controller.reactivateProject(projectId)),
      deletionImpact: (projectId: string) => controller.getProjectImpact(projectId),
      delete: (projectId: string) => confirmed(controller.deleteProject(projectId, true)),
    },
    timetable: {
      create: (projectId: string, details: TimetableV8Details) =>
        confirmed(controller.createTimetable(projectId, details)),
      update: (projectId: string, timetableId: string, details: TimetableV8Details) =>
        confirmed(controller.updateTimetable(projectId, timetableId, details)),
      copySettings: (projectId: string, timetableId: string, input: FormalTimetableCopyInput) =>
        confirmed(controller.copyTimetableSettings(projectId, timetableId, input)),
      deletionImpact: (projectId: string, timetableId: string) =>
        controller.getTimetableImpact(projectId, timetableId),
      delete: (projectId: string, timetableId: string) =>
        confirmed(controller.deleteTimetable(projectId, timetableId, true)),
    },
  }
}

export function useFormalProjectTimetableV9Adapter() {
  const host = useAppDataV9()
  const [selection, setSelection] = useState<FormalProjectTimetableV9Selection>({
    projectId: null, timetableId: null,
  })
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const snapshotRef = useRef(toFormalV9HostPort(host))
  snapshotRef.current = toFormalV9HostPort(host)
  useEffect(() => {
    const document = host.data
    if (!document) return
    setSelection((current) => reconcileFormalProjectTimetableV9Selection(document, current))
  }, [host.data])
  const port = useMemo(() => ({
    get document() { return snapshotRef.current.document },
    get status() { return snapshotRef.current.status },
    get writable() { return snapshotRef.current.writable },
    get pending() { return snapshotRef.current.pending },
    get receipt() { return snapshotRef.current.receipt },
    get revision() { return snapshotRef.current.revision },
    get errorCode() { return snapshotRef.current.errorCode },
    update: (produce: Parameters<FormalV9HostPort['update']>[0]) => snapshotRef.current.update(produce),
  }), [])
  const controller = useMemo(() => host.data ? createFormalProjectTimetableV9Controller(
    port, uid, selection, () => selectionRef.current,
  ) : null, [host, port, selection])
  const select = useCallback<Select>((next) => setSelection(next), [])
  const actions = useMemo(() => controller
    ? createFormalProjectTimetableV9Actions(controller, select) : null, [controller, select])
  return { host, controller, actions, selection }
}

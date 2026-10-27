import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CopyProjectV8Input } from '../data/projectRuntimeV8'
import type { TimetableV8Details } from '../data/timetablesV8'
import { createFormalProjectTimetableV9Controller, reconcileFormalProjectTimetableV9Selection,
  type FormalProjectTimetableV9Selection, type FormalTimetableCopyInput } from '../formalProjectTimetableV9'
import { toFormalV9HostPort } from '../formalRuntime'
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
      // A name-only Project cannot be mapped while V9 still requires a complete term descriptor.
      createEmptyFromName: null,
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
  useEffect(() => {
    const document = host.data
    if (!document) return
    setSelection((current) => reconcileFormalProjectTimetableV9Selection(document, current))
  }, [host.data])
  const port = useMemo(() => toFormalV9HostPort(host), [host])
  const controller = useMemo(() => host.data ? createFormalProjectTimetableV9Controller(
    port, uid, selection,
  ) : null, [host.data, port, selection])
  const select = useCallback<Select>((next) => setSelection(next), [])
  const actions = useMemo(() => controller
    ? createFormalProjectTimetableV9Actions(controller, select) : null, [controller, select])
  return { host, controller, actions, selection }
}

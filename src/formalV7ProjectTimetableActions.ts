import type { Dispatch, SetStateAction } from 'react'
import { archiveProject, copyProject, createBlankProject, deleteProject, reactivateProject,
  renameProject, type NewProjectInput } from './data/projectRuntime'
import type { CopyProjectV8Input } from './data/projectRuntimeV8'
import { copyTimetable, createTimetable, updateTimetable, type TimetableDetails } from './data/timetablesV6'
import { deleteTimetable } from './data/deleteTimetableV7'
import type { AppDataV4, AppDataV7 } from './types'

export type ProjectLifecycleActionResult = void | Promise<void>

type ProjectLifecycleActionBase = {
  runtime: 'v7' | 'v9'
  copyRequiresSourceEffectiveDate: boolean
  copyProject: (input: CopyProjectV8Input) => ProjectLifecycleActionResult
  renameProject?: (projectId: string, name: string) => ProjectLifecycleActionResult
  archiveProject: (projectId: string) => ProjectLifecycleActionResult
  reactivateProject: (projectId: string) => ProjectLifecycleActionResult
  deleteProject: (projectId: string) => ProjectLifecycleActionResult
}

export type ProjectLifecycleActions = ProjectLifecycleActionBase & ({
  creationMode: 'legacy-v7'
  createProject: (input: NewProjectInput) => ProjectLifecycleActionResult
} | {
  creationMode: 'empty-v9'
  createProject: (input: { name: string }) => ProjectLifecycleActionResult
})

export function createFormalV7ProjectLifecycleActions(data: AppDataV4,
  setData: Dispatch<SetStateAction<AppDataV4>>, createId: () => string): ProjectLifecycleActions {
  return {
    runtime: 'v7', creationMode: 'legacy-v7', copyRequiresSourceEffectiveDate: false,
    createProject: (input) => setData(createBlankProject(data, input, createId)),
    copyProject: (input) => setData(copyProject(data, { ...input,
      units: input.units.map((unit) => ({ sourceUnitId: unit.sourceUnitId, startDate: unit.startDate,
        endDate: unit.endDate, anchorDate: unit.anchorDate, anchorPattern: unit.anchorPattern })) }, createId)),
    renameProject: (projectId, name) => setData((current) => renameProject(current, projectId, name)),
    archiveProject: (projectId) => setData((current) => archiveProject(current, projectId)),
    reactivateProject: (projectId) => setData((current) => reactivateProject(current, projectId)),
    deleteProject: (projectId) => setData((current) => deleteProject(current, projectId)),
  }
}

/** V7-only data operations used by App's existing persistence confirmation flow. */
export const formalV7TimetableActions = {
  create: (data: AppDataV4, projectId: string, details: TimetableDetails, id: string) =>
    createTimetable(data, projectId, details, id),
  update: (data: AppDataV4, timetableId: string, details: TimetableDetails) =>
    updateTimetable(data, timetableId, details),
  copy: (data: AppDataV4, input: Parameters<typeof copyTimetable>[1], createId: () => string) =>
    copyTimetable(data, input, createId),
  deletionImpact: (data: AppDataV4, projectId: string, timetableId: string) => ({
    lessons: data.recurringLessons.filter((item) => item.projectId === projectId && item.timetableId === timetableId).length,
    overrides: data.overrides.filter((item) => item.projectId === projectId && item.timetableId === timetableId).length,
    oneOffLessons: (data.oneOffLessons ?? []).filter((item) => item.projectId === projectId
      && item.timetableId === timetableId).length,
  }),
  delete: (data: AppDataV7, projectId: string, timetableId: string) =>
    deleteTimetable(data, projectId, timetableId),
}

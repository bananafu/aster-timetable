import { useCallback, useRef, useState } from 'react'
import type { LessonDraftV4 } from '../data/lessonsV4'
import { createFormalLessonManagementV9Controller, type FormalLessonV9Result } from '../formalLessonManagementV9'
import type { FormalV9HostPort } from '../formalRuntime'
import type { FormalProjectTimetableV9Selection } from '../formalProjectTimetableV9'
import type { AppDataV8 } from '../types'
import type { AppDataV9 } from '../types/v9'
import type { FixedLessonPersistencePort } from '../components/LessonEditor'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

export interface FormalLessonEditorV9Session {
  data: AppDataV8
  lessonId: string | null
  port: FixedLessonPersistencePort
}

function toDraft(draft: LessonDraftV4) {
  return { projectId: draft.projectId, timetableId: draft.timetableId!,
    teachingUnitId: draft.teachingUnitId, subjectId: draft.subjectId, classId: draft.classId,
    day: draft.day, periodId: draft.periodId, weekPattern: draft.weekPattern, room: draft.room }
}

export function toFormalLessonEditorDataV9(document: AppDataV9,
  selection: FormalProjectTimetableV9Selection, lessonId: string | null = null): AppDataV8 | null {
  const project = document.projects.find((item) => item.id === selection.projectId && !item.archivedAt)
  const timetable = document.timetables.find((item) => item.id === selection.timetableId
    && item.projectId === selection.projectId)
  const lesson = lessonId ? document.recurringLessons.find((item) => item.id === lessonId
    && item.projectId === selection.projectId && item.timetableId === selection.timetableId) : null
  if (!project || project.term === null || !timetable || (lessonId && !lesson)) return null
  const unitIds = new Set(document.teachingUnits
    .filter((item) => item.projectId === project.id && (!lesson || item.id === lesson.teachingUnitId))
    .map((item) => item.id))
  const schoolIds = new Set(document.teachingUnits.filter((item) => unitIds.has(item.id)).map((item) => item.schoolId))
  const subjectIds = new Set(document.subjects
    .filter((item) => item.projectId === project.id && item.timetableId === timetable.id).map((item) => item.id))
  return {
    ...document,
    schemaVersion: 8,
    activeProjectId: project.id,
    projects: [{ ...project, term: project.term }],
    timetables: [timetable],
    schools: document.schools.filter((item) => item.projectId === project.id && schoolIds.has(item.id)),
    teachingUnits: document.teachingUnits.filter((item) => unitIds.has(item.id)),
    subjects: document.subjects.filter((item) => subjectIds.has(item.id)),
    teachingUnitSubjects: document.teachingUnitSubjects.filter((item) => item.projectId === project.id
      && unitIds.has(item.teachingUnitId) && subjectIds.has(item.subjectId)),
    classes: document.classes.filter((item) => item.projectId === project.id && unitIds.has(item.teachingUnitId)),
    recurringLessons: document.recurringLessons.filter((item) => item.projectId === project.id
      && item.timetableId === timetable.id),
    overrides: document.overrides.filter((item) => item.projectId === project.id
      && item.timetableId === timetable.id),
    oneOffLessons: document.oneOffLessons.filter((item) => item.projectId === project.id
      && item.timetableId === timetable.id),
    events: document.events.filter((item) => item.ownershipStatus === 'resolved'
      && item.projectId === project.id && item.timetableId === timetable.id),
    teachingProgress: document.teachingProgress.filter((item) => item.projectId === project.id
      && item.timetableId === timetable.id),
    migrationWarnings: document.migrationWarnings.filter((item) => item.entityType !== 'lesson'
      || document.recurringLessons.some((candidate) => candidate.id === item.entityId
        && candidate.projectId === project.id && candidate.timetableId === timetable.id)),
  }
}

/** Captures a Host snapshot when the editor opens; all writes still complete through the V9 controller. */
export function useFormalLessonManagementV9Adapter(host: FormalV9HostPort,
  selection: FormalProjectTimetableV9Selection, createId: () => string = uid) {
  const hostRef = useRef(host)
  hostRef.current = host
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const submittingRef = useRef(false)
  const [pending, setPending] = useState(false)

  const open = useCallback((lessonId: string | null = null): FormalLessonEditorV9Session | null => {
    const snapshot = hostRef.current
    if (!snapshot.document || !selectionRef.current.projectId || !selectionRef.current.timetableId) return null
    const capturedSelection = { ...selectionRef.current }
    const data = toFormalLessonEditorDataV9(snapshot.document, capturedSelection, lessonId)
    if (!data) return null
    const configuredSubjectIds = Object.fromEntries(data.teachingUnits.map((unit) => [unit.id,
      data.teachingUnitSubjects.filter((item) => item.teachingUnitId === unit.id).map((item) => item.subjectId)]))
    const execute = async (unitId: string, operation: (controller: ReturnType<typeof createFormalLessonManagementV9Controller>) =>
    Promise<FormalLessonV9Result>) => {
      if (submittingRef.current) throw new Error('V9 Host write is already in progress.')
      submittingRef.current = true
      setPending(true)
      try {
        const scope = { projectId: capturedSelection.projectId!, timetableId: capturedSelection.timetableId!,
          teachingUnitId: unitId }
        const controller = createFormalLessonManagementV9Controller(snapshot, createId, scope, () => ({
          projectId: selectionRef.current.projectId ?? '', timetableId: selectionRef.current.timetableId ?? '',
          teachingUnitId: unitId,
        }))
        return await operation(controller)
      } finally {
        submittingRef.current = false
        setPending(false)
      }
    }
    const target = lessonId ? data.recurringLessons.find((item) => item.id === lessonId) : null
    const port: FixedLessonPersistencePort = {
      fixedOnly: true,
      get pending() { return submittingRef.current },
      configuredSubjectIds,
      create: (draft) => execute(draft.teachingUnitId,
        (controller) => controller.createRecurring(toDraft(draft))),
      update: (id, draft) => execute(target?.teachingUnitId ?? draft.teachingUnitId,
        (controller) => controller.updateRecurring(id, toDraft(draft))),
      delete: (id) => {
        if (!target) return Promise.reject(new Error('Lesson does not exist.'))
        return execute(target.teachingUnitId, (controller) => controller.deleteRecurring(id, true))
      },
    }
    return { data, lessonId, port }
  }, [createId])

  return { open, pending }
}

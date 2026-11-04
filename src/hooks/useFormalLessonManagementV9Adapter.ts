import { useCallback, useRef, useState } from 'react'
import type { LessonDraftV4 } from '../data/lessonsV4'
import { createFormalLessonManagementV9Controller, FormalLessonV9Error,
  type FormalLessonV9Result } from '../formalLessonManagementV9'
import type { FormalV9HostPort } from '../formalRuntime'
import type { FormalProjectTimetableV9Selection } from '../formalProjectTimetableV9'
import type { AppDataV8 } from '../types'
import type { AppDataV9 } from '../types/v9'
import type { FixedLessonPersistencePort } from '../components/LessonEditor'
import { fromDateKey } from '../lib/date'
import { resolveV9Day } from '../lib/scheduleV9'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

export interface FormalLessonEditorV9Session {
  readonly data: AppDataV8
  lessonId: string | null
  occurrenceDate: string | null
  occurrenceOverrideId: string | null
  teachingUnitId: string | null
  port: FixedLessonPersistencePort
}

function toDraft(draft: LessonDraftV4) {
  return { projectId: draft.projectId, timetableId: draft.timetableId!,
    teachingUnitId: draft.teachingUnitId, subjectId: draft.subjectId, classId: draft.classId,
    day: draft.day, periodId: draft.periodId, weekPattern: draft.weekPattern, room: draft.room }
}

/** Resource managers may advance these collections while an editor draft remains open. */
function lessonSessionBaseline(document: AppDataV9): string {
  return JSON.stringify({ ...document, subjects: [], teachingUnitSubjects: [], classes: [] })
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

/** Keeps editor identity fixed while projecting confirmed resource collections from the live V9 Host. */
export function useFormalLessonManagementV9Adapter(host: FormalV9HostPort,
  selection: FormalProjectTimetableV9Selection, createId: () => string = uid) {
  const hostRef = useRef(host)
  hostRef.current = host
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const submittingRef = useRef(false)
  const [pending, setPending] = useState(false)

  const open = useCallback((lessonId: string | null = null, occurrenceDate: string | null = null,
    occurrenceOverrideId: string | null = null): FormalLessonEditorV9Session | null => {
    const snapshot = hostRef.current
    if (!snapshot.document || !selectionRef.current.projectId || !selectionRef.current.timetableId) return null
    const capturedSelection = { ...selectionRef.current }
    const initialData = toFormalLessonEditorDataV9(snapshot.document, capturedSelection, lessonId)
    if (!initialData) return null
    const target = lessonId ? snapshot.document.recurringLessons.find((item) => item.id === lessonId
      && item.projectId === capturedSelection.projectId && item.timetableId === capturedSelection.timetableId) : null
    if (lessonId && !target) return null
    if ((occurrenceDate || occurrenceOverrideId) && (!lessonId || !target || !occurrenceDate)) return null
    if (target && occurrenceDate) {
      const occurrence = resolveV9Day(snapshot.document, { projectId: capturedSelection.projectId!,
        timetableId: capturedSelection.timetableId!, teachingUnitId: target.teachingUnitId },
      fromDateKey(occurrenceDate)).find((item) => item.kind === 'recurring' && item.id === target.id
        && item.date === occurrenceDate && (occurrenceOverrideId
          ? item.overrideId === occurrenceOverrideId : item.overrideId === undefined))
      if (!occurrence) return null
    }
    const baseline = lessonSessionBaseline(snapshot.document)
    const readData = () => {
      const current = hostRef.current.document
      return current ? toFormalLessonEditorDataV9(current, capturedSelection, lessonId) ?? initialData : initialData
    }
    const execute = async (unitId: string, operation: (controller: ReturnType<typeof createFormalLessonManagementV9Controller>) =>
    Promise<FormalLessonV9Result>) => {
      if (submittingRef.current) throw new Error('V9 Host write is already in progress.')
      submittingRef.current = true
      setPending(true)
      try {
        const currentHost = hostRef.current
        if (!currentHost.document || lessonSessionBaseline(currentHost.document) !== baseline
          || !toFormalLessonEditorDataV9(currentHost.document, capturedSelection, lessonId)) {
          throw new FormalLessonV9Error('stale-document', 'Lesson session data changed before submission.')
        }
        const scope = { projectId: capturedSelection.projectId!, timetableId: capturedSelection.timetableId!,
          teachingUnitId: unitId }
        const controller = createFormalLessonManagementV9Controller(currentHost, createId, scope, () => ({
          projectId: selectionRef.current.projectId ?? '', timetableId: selectionRef.current.timetableId ?? '',
          teachingUnitId: unitId,
        }))
        return await operation(controller)
      } finally {
        submittingRef.current = false
        setPending(false)
      }
    }
    const projectedTarget = lessonId ? initialData.recurringLessons.find((item) => item.id === lessonId) : null
    const port: FixedLessonPersistencePort = {
      fixedOnly: true,
      get pending() { return submittingRef.current },
      get configuredSubjectIds() {
        const data = readData()
        return Object.fromEntries(data.teachingUnits.map((unit) => [unit.id,
          data.teachingUnitSubjects.filter((item) => item.teachingUnitId === unit.id).map((item) => item.subjectId)]))
      },
      create: (draft) => execute(draft.teachingUnitId,
        (controller) => controller.createRecurring(toDraft(draft))),
      update: (id, draft) => execute(projectedTarget?.teachingUnitId ?? draft.teachingUnitId,
        (controller) => controller.updateRecurring(id, toDraft(draft))),
      permanentlyUpdate: (id, date, draft) => execute(projectedTarget?.teachingUnitId ?? draft.teachingUnitId,
        (controller) => controller.permanentlyUpdateFromDate(id, date, toDraft(draft))),
      delete: (id) => {
        if (!projectedTarget) return Promise.reject(new Error('Lesson does not exist.'))
        return execute(projectedTarget.teachingUnitId, (controller) => controller.deleteRecurring(id, true))
      },
      ...(projectedTarget && { occurrence: {
        cancel: (id: string, date: string) => execute(projectedTarget.teachingUnitId,
          (controller) => controller.cancelOccurrence(id, date)),
        move: (id: string, date: string, moveTarget: { date: string; periodId: number },
          allowConflict: boolean) => execute(projectedTarget.teachingUnitId,
          (controller) => controller.moveOccurrence(id, date, moveTarget, allowConflict === true)),
        replace: (id: string, date: string,
          replacement: { subjectId: string; classId: string; room?: string }) =>
          execute(projectedTarget.teachingUnitId,
            (controller) => controller.replaceOccurrence(id, date, replacement)),
        replaceChange: (id: string, change: Parameters<ReturnType<
          typeof createFormalLessonManagementV9Controller>['replaceOccurrenceChange']>[1]) =>
          execute(projectedTarget.teachingUnitId,
            (controller) => controller.replaceOccurrenceChange(id, change)),
        revoke: (id: string) => execute(projectedTarget.teachingUnitId,
          (controller) => controller.revokeOccurrenceOverride(id)),
      } }),
    }
    return { get data() { return readData() }, lessonId, occurrenceDate, occurrenceOverrideId,
      teachingUnitId: projectedTarget?.teachingUnitId ?? null, port }
  }, [createId])

  return { open, pending }
}

// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClassV9 } from '../data/managementV9'
import type { LessonDraftV4 } from '../data/lessonsV4'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9,
  createTeacherTimetableV9 } from '../data/teacherSubjectsV9'
import { createRecurringLessonV9 } from '../data/lessonMutationsV9'
import type { FormalProjectTimetableV9Selection } from '../formalProjectTimetableV9'
import type { FormalV9HostPort } from '../formalRuntime'
import type { AppDataV9 } from '../types/v9'
import { useFormalLessonManagementV9Adapter } from './useFormalLessonManagementV9Adapter'

const empty = (): AppDataV9 => ({ ...createEmptyAppDataV8(), schemaVersion: 9, subjects: [] })

function fixture() {
  let serial = 0
  const id = () => `lesson-adapter-${++serial}`
  let data = createBlankProjectV9(empty(), { name: 'Project', academicYear: 116, semester: 'first',
    startDate: '2027-08-01', endDate: '2028-01-31' }, id)
  const projectId = data.activeProjectId!
  const unit = data.teachingUnits[0]
  data = createTeacherTimetableV9(data, projectId, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV9(data, projectId, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  data = createTeacherSubjectV9(data, projectId, 'teacher-a', { name: '原科目', shortName: '原',
    color: '#647C88', applicableSchoolLevels: ['senior-high'] }, 'subject-a')
  data = configureTeacherSubjectV9(data, projectId, 'teacher-a', unit.id, 'subject-a', 'relation-a')
  data = createClassV9(data, projectId, { teachingUnitId: unit.id, grade: 1, classNumber: 1 }, 'class-a')
  const selection = { projectId, timetableId: 'teacher-a' } satisfies FormalProjectTimetableV9Selection
  data = createRecurringLessonV9(data, { ...selection, teachingUnitId: unit.id }, {
    projectId, timetableId: 'teacher-a', teachingUnitId: unit.id, subjectId: 'subject-a',
    classId: 'class-a', day: 1, periodId: unit.periods[0].id, weekPattern: 'every', room: '',
  }, 'lesson-a')
  return { data, selection, projectId, unit }
}

function hostFixture(initial: AppDataV9) {
  let document = initial
  let revision = 0
  let writable = true
  let receiptMismatch = false
  const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
    const next = produce(document)
    if (receiptMismatch) return { raw: JSON.stringify(next), revision: revision + 2, attemptId: 'mismatch' }
    document = next
    revision += 1
    return { raw: JSON.stringify(next), revision, attemptId: `lesson-${revision}` }
  })
  const host = {
    get document() { return document }, status: 'active' as const, get writable() { return writable },
    pending: false, receipt: null, get revision() { return revision }, errorCode: null, update,
  } satisfies FormalV9HostPort
  return { host, update, replace(next: AppDataV9) { document = next; revision += 1 },
    revoke() { writable = false }, mismatch() { receiptMismatch = true }, revision: () => revision }
}

describe('useFormalLessonManagementV9Adapter live session', () => {
  it('keeps exact occurrence context and atomically modifies then revokes its override', async () => {
    const source = fixture()
    const host = hostFixture(source.data)
    const ids = ['cancel-a', 'move-a']
    const hook = renderHook(() => useFormalLessonManagementV9Adapter(
      host.host, source.selection, () => ids.shift() ?? 'unused'))
    const session = hook.result.current.open('lesson-a', '2027-08-02')!
    expect(session).toMatchObject({ lessonId: 'lesson-a', occurrenceDate: '2027-08-02',
      occurrenceOverrideId: null, teachingUnitId: source.unit.id })
    expect(hook.result.current.open('lesson-a', '2027-08-03')).toBeNull()
    await act(async () => { await session.port.occurrence!.cancel('lesson-a', '2027-08-02') })
    expect(host.host.document?.overrides).toMatchObject([{ id: 'cancel-a', date: '2027-08-02', action: 'cancel' }])

    hook.rerender()
    const cancelled = hook.result.current.open('lesson-a', '2027-08-02', 'cancel-a')!
    await act(async () => { await cancelled.port.occurrence!.replaceChange('cancel-a',
      { action: 'move', target: { date: '2027-08-09', periodId: source.unit.periods[1].id } }) })
    expect(host.host.document?.overrides).toMatchObject([{ id: 'move-a', date: '2027-08-02', action: 'move',
      target: { date: '2027-08-09', periodId: source.unit.periods[1].id } }])
    expect(host.host.document?.overrides).toHaveLength(1)

    hook.rerender()
    const movedTarget = hook.result.current.open('lesson-a', '2027-08-09', 'move-a')!
    expect(movedTarget.occurrenceDate).toBe('2027-08-09')
    expect(hook.result.current.open('lesson-a', '2027-08-16', 'move-a')).toBeNull()
    await act(async () => { await movedTarget.port.occurrence!.revoke('move-a') })
    expect(host.host.document?.overrides).toEqual([])
    expect(host.update).toHaveBeenCalledTimes(3)
  })

  it('projects confirmed resources live and creates against the latest safe Host snapshot', async () => {
    const source = fixture()
    const host = hostFixture(source.data)
    const createId = vi.fn(() => 'lesson-new')
    const { result, rerender } = renderHook(({ selection }) =>
      useFormalLessonManagementV9Adapter(host.host, selection, createId), {
      initialProps: { selection: source.selection },
    })
    const session = result.current.open()!
    let refreshed = createTeacherSubjectV9(source.data, source.projectId, 'teacher-a', {
      name: '即時科目', shortName: '即時', color: '#718B6C', applicableSchoolLevels: ['senior-high'],
    }, 'subject-live')
    refreshed = configureTeacherSubjectV9(refreshed, source.projectId, 'teacher-a', source.unit.id,
      'subject-live', 'relation-live')
    refreshed = createClassV9(refreshed, source.projectId,
      { teachingUnitId: source.unit.id, grade: 1, classNumber: 2 }, 'class-live')
    host.replace(refreshed)
    rerender({ selection: source.selection })

    expect(session.data.subjects.map((item) => item.id)).toContain('subject-live')
    expect(session.data.classes.map((item) => item.id)).toContain('class-live')
    expect(session.port.configuredSubjectIds[source.unit.id]).toContain('subject-live')
    const before = host.revision()
    await act(async () => {
      await session.port.create({ projectId: source.projectId, timetableId: 'teacher-a',
        schoolId: source.unit.schoolId, teachingUnitId: source.unit.id,
        subjectId: 'subject-live', classId: 'class-live', day: 2,
        periodId: source.unit.periods[1].id, weekPattern: 'every', room: 'Live' })
    })
    expect(host.revision()).toBe(before + 1)
    expect(host.host.document?.recurringLessons).toContainEqual(expect.objectContaining({
      id: 'lesson-new', subjectId: 'subject-live', classId: 'class-live', room: 'Live',
    }))
  })

  it('fails closed for changed Lesson identity, changed selection, revoked writable, and receipt mismatch', async () => {
    const source = fixture()
    const updateDraft = { projectId: source.projectId, timetableId: 'teacher-a',
      schoolId: source.unit.schoolId, teachingUnitId: source.unit.id,
      subjectId: 'subject-a', classId: 'class-a', day: 1,
      periodId: source.unit.periods[0].id, weekPattern: 'every', room: '草稿' } satisfies LessonDraftV4

    const changedHost = hostFixture(source.data)
    const changedHook = renderHook(() => useFormalLessonManagementV9Adapter(
      changedHost.host, source.selection, () => 'unused'))
    const changedSession = changedHook.result.current.open('lesson-a')!
    changedHost.replace({ ...source.data, recurringLessons: source.data.recurringLessons.map((item) =>
      item.id === 'lesson-a' ? { ...item, room: '外部更新' } : item) })
    changedHook.rerender()
    await expect(changedSession.port.update('lesson-a', updateDraft)).rejects.toMatchObject({ code: 'stale-document' })
    expect(changedHost.update).not.toHaveBeenCalled()

    const selectionHost = hostFixture(source.data)
    const selectionHook = renderHook(({ selection }) => useFormalLessonManagementV9Adapter(
      selectionHost.host, selection, () => 'unused'), { initialProps: { selection: source.selection } })
    const selectionSession = selectionHook.result.current.open('lesson-a')!
    selectionHook.rerender({ selection: { projectId: source.projectId, timetableId: 'teacher-b' } })
    await expect(selectionSession.port.update('lesson-a', updateDraft)).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(selectionHost.update).not.toHaveBeenCalled()

    const revokedHost = hostFixture(source.data)
    const revokedHook = renderHook(() => useFormalLessonManagementV9Adapter(
      revokedHost.host, source.selection, () => 'unused'))
    const revokedSession = revokedHook.result.current.open('lesson-a')!
    revokedHost.revoke()
    revokedHook.rerender()
    await expect(revokedSession.port.update('lesson-a', updateDraft)).rejects.toMatchObject({ code: 'not-writable' })

    const mismatchHost = hostFixture(source.data)
    const mismatchHook = renderHook(() => useFormalLessonManagementV9Adapter(
      mismatchHost.host, source.selection, () => 'unused'))
    const mismatchSession = mismatchHook.result.current.open('lesson-a')!
    mismatchHost.mismatch()
    await expect(mismatchSession.port.update('lesson-a', updateDraft)).rejects.toMatchObject({ code: 'receipt-mismatch' })
  })
})

// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createClassV9 } from '../data/managementV9'
import type { LessonDraftV4 } from '../data/lessonsV4'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9,
  createTeacherTimetableV9 } from '../data/teacherSubjectsV9'
import { cancelOccurrenceV9, createRecurringLessonV9 } from '../data/lessonMutationsV9'
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
  it('resolves cross-A/B swap candidates from the latest scoped V9 document and excludes occupied occurrences', () => {
    const source = fixture()
    const alternating = {
      ...source.data,
      teachingUnits: source.data.teachingUnits.map((item) => item.id === source.unit.id
        ? { ...item, weekCycle: { enabled: true, anchorDate: '2027-08-02', anchorPattern: 'A' as const } }
        : item),
      recurringLessons: source.data.recurringLessons.map((item) => item.id === 'lesson-a'
        ? { ...item, weekPattern: 'A' as const } : item),
    }
    const withPartner = createRecurringLessonV9(alternating, {
      ...source.selection, teachingUnitId: source.unit.id }, {
      projectId: source.projectId, timetableId: 'teacher-a', teachingUnitId: source.unit.id,
      subjectId: 'subject-a', classId: 'class-a', day: 1,
      periodId: source.unit.periods[1].id, weekPattern: 'B', room: '',
    }, 'lesson-b')

    const host = hostFixture(withPartner)
    const hook = renderHook(() => useFormalLessonManagementV9Adapter(host.host, source.selection))
    const aSession = hook.result.current.open('lesson-a', '2027-08-02')!
    expect(aSession.port.occurrence!.swapCandidates!('2027-08-02')).toEqual([])
    expect(aSession.port.occurrence!.swapCandidates!('2027-08-09'))
      .toMatchObject([{ id: 'lesson-b', date: '2027-08-09', teachingUnitId: source.unit.id }])
    expect(aSession.port.occurrence!.swapCandidates!('2028-02-07')).toEqual([])
    expect(aSession.port.occurrence!.swapCandidates!('2027-02-31')).toEqual([])

    const bSession = hook.result.current.open('lesson-b', '2027-08-09')!
    expect(bSession.port.occurrence!.swapCandidates!('2027-08-02'))
      .toMatchObject([{ id: 'lesson-a', date: '2027-08-02', teachingUnitId: source.unit.id }])

    const occupied = cancelOccurrenceV9(withPartner, { ...source.selection,
      teachingUnitId: source.unit.id }, 'lesson-b', '2027-08-09', 'cancel-b')
    const occupiedHost = hostFixture(occupied)
    const occupiedHook = renderHook(() => useFormalLessonManagementV9Adapter(
      occupiedHost.host, source.selection))
    const occupiedSession = occupiedHook.result.current.open('lesson-a', '2027-08-02')!
    expect(occupiedSession.port.occurrence!.swapCandidates!('2027-08-09')).toEqual([])
  })

  it('previews without writing and commits, replaces, then revokes an atomic swap group', async () => {
    const source = fixture()
    const withPartner = createRecurringLessonV9(source.data, {
      ...source.selection, teachingUnitId: source.unit.id }, {
      projectId: source.projectId, timetableId: 'teacher-a', teachingUnitId: source.unit.id,
      subjectId: 'subject-a', classId: 'class-a', day: 1,
      periodId: source.unit.periods[1].id, weekPattern: 'every', room: '',
    }, 'lesson-b')
    const host = hostFixture(withPartner)
    const ids = ['swap-group-a', 'swap-override-a', 'swap-override-b',
      'swap-group-b', 'swap-override-c', 'swap-override-d']
    const hook = renderHook(() => useFormalLessonManagementV9Adapter(
      host.host, source.selection, () => ids.shift() ?? 'unused'))
    const session = hook.result.current.open('lesson-a', '2027-08-02')!
    const sameDay = { firstLessonId: 'lesson-a', firstDate: '2027-08-02',
      secondLessonId: 'lesson-b', secondDate: '2027-08-02' }
    session.port.occurrence!.previewSwap!(sameDay)
    expect(host.update).not.toHaveBeenCalled()
    await act(async () => { await session.port.occurrence!.swap!(sameDay) })
    expect(host.update).toHaveBeenCalledOnce()
    expect(host.host.document?.overrides).toHaveLength(2)
    expect(host.host.document?.overrides.map((item) => item.groupId))
      .toEqual(['swap-group-a', 'swap-group-a'])

    hook.rerender()
    const grouped = hook.result.current.open('lesson-a', '2027-08-02', 'swap-override-a')!
    expect(grouped.port.occurrence!.swapCandidates!('2027-08-02', 'swap-override-a'))
      .toMatchObject([{ id: 'lesson-b', date: '2027-08-02' }])
    const crossDate = { ...sameDay, secondDate: '2027-08-09' }
    grouped.port.occurrence!.previewSwap!(crossDate, 'swap-override-a')
    expect(host.update).toHaveBeenCalledOnce()
    await act(async () => {
      await grouped.port.occurrence!.replaceSwapGroup!('swap-override-a', crossDate)
    })
    expect(host.update).toHaveBeenCalledTimes(2)
    expect(host.host.document?.overrides).toHaveLength(2)
    expect(host.host.document?.overrides.map((item) => item.groupId))
      .toEqual(['swap-group-b', 'swap-group-b'])

    hook.rerender()
    const replacement = hook.result.current.open('lesson-a', '2027-08-02', 'swap-override-c')!
    replacement.port.occurrence!.previewRevokeSwapGroup!('swap-override-c')
    expect(host.update).toHaveBeenCalledTimes(2)
    await act(async () => { await replacement.port.occurrence!.revokeSwapGroup!('swap-override-c') })
    expect(host.update).toHaveBeenCalledTimes(3)
    expect(host.host.document?.overrides).toEqual([])
    expect(host.revision()).toBe(3)
  })

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

  it('keeps a OneOff draft eligible for live resources and revalidates V9 conflicts at submit', async () => {
    const source = fixture()
    const host = hostFixture(source.data)
    const createId = vi.fn(() => '11111111-1111-4111-8111-111111111111')
    const { result, rerender } = renderHook(() =>
      useFormalLessonManagementV9Adapter(host.host, source.selection, createId))
    const session = result.current.openOneOff()!
    let refreshed = createTeacherSubjectV9(source.data, source.projectId, 'teacher-a', {
      name: '即時單日科目', shortName: '即單', color: '#718B6C', applicableSchoolLevels: ['senior-high'],
    }, 'one-off-subject-live')
    refreshed = configureTeacherSubjectV9(refreshed, source.projectId, 'teacher-a', source.unit.id,
      'one-off-subject-live', 'one-off-relation-live')
    refreshed = createClassV9(refreshed, source.projectId,
      { teachingUnitId: source.unit.id, grade: 1, classNumber: 3 }, 'one-off-class-live')
    host.replace(refreshed)
    rerender()
    expect(session.data.subjects.map((item) => item.id)).toContain('one-off-subject-live')
    expect(session.port.configuredSubjectIds[source.unit.id]).toContain('one-off-subject-live')
    const draft = { projectId: source.projectId, timetableId: 'teacher-a', teachingUnitId: source.unit.id,
      subjectId: 'one-off-subject-live', classId: 'one-off-class-live', date: '2027-08-03',
      purpose: 'extra' as const, time: { mode: 'period' as const, periodId: source.unit.periods[0].id } }
    expect(session.port.previewConflicts(draft)).toEqual([])
    await act(async () => { await session.port.save({ draft, allowConflict: false }) })
    expect(host.host.document?.oneOffLessons).toMatchObject([{ id: '11111111-1111-4111-8111-111111111111',
      subjectId: 'one-off-subject-live', classId: 'one-off-class-live' }])

    rerender()
    const stale = result.current.openOneOff('11111111-1111-4111-8111-111111111111')!
    host.replace({ ...host.host.document!, events: [...host.host.document!.events, {
      id: 'external-event', projectId: source.projectId, timetableId: 'teacher-a',
      teachingUnitId: source.unit.id, ownershipStatus: 'resolved', title: 'external', type: 'meeting',
      date: '2027-08-03', startTime: '12:00', endTime: '13:00', color: '#112233',
    }] })
    rerender()
    await expect(stale.port.save({ id: '11111111-1111-4111-8111-111111111111', draft,
      allowConflict: false })).rejects.toMatchObject({ code: 'stale-document' })
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

import { describe, expect, it, vi } from 'vitest'
import { fromDateKey } from '../lib/date'
import { resolveV9Day } from '../lib/scheduleV9'
import type { AppDataV9 } from '../types/v9'
import type { FormalV9HostPort } from '../formalRuntime'
import { createFormalLessonManagementV9Controller } from '../formalLessonManagementV9'
import { fingerprintV7Raw } from './activationV8'
import { V9_AUTO_BACKUP_PREFIX, type V9HighRiskOperation } from './storageV9'
import { isCompatibleAppDataV9 } from './validators/v9'
import { cancelOccurrenceV9, createOneOffLessonV9, createRecurringLessonV9,
  deleteOneOffLessonV9, deleteRecurringLessonV9, endRecurringLessonFromDateV9, getOneOffLessonConflictsV9,
  getRecurringLessonV9Impact, moveOccurrenceV9, permanentlySwapLessonsV9, permanentlyUpdateLessonV9,
  replaceOccurrenceChangeV9, replaceOccurrenceV9, replaceSwapGroupV9,
  revokeOccurrenceOverrideV9, revokeSwapGroupV9, swapOccurrencesV9, validateSwapGroupV9,
  updateOneOffLessonV9, updateRecurringLessonV9,
  type LessonV9Scope, type OneOffLessonV9Draft, type RecurringLessonV9Draft } from './lessonMutationsV9'

export function lessonFixture() {
  const stamp = '2026-02-01T00:00:00.000Z'
  const data: AppDataV9 = {
    schemaVersion: 9, activeProjectId: 'p',
    projects: [{ id: 'p', name: '甲', term: { academicYear: 115, semester: 'first' },
      createdAt: stamp, updatedAt: stamp }],
    timetables: [{ id: 't', projectId: 'p', name: '甲課表', teacherName: '甲' },
      { id: 'other', projectId: 'p', name: '乙課表', teacherName: '乙' }],
    schools: [{ id: 's', projectId: 'p', name: '學校', color: '#112233' }],
    teachingUnits: [{ id: 'u', projectId: 'p', schoolId: 's', name: '學期', schoolLevel: 'senior-high',
      startDate: '2026-03-01', endDate: '2026-06-30', timezone: 'Asia/Taipei',
      periods: [{ id: 1, order: 1, label: '第一節', startTime: '08:00', endTime: '08:50' },
        { id: 2, order: 2, label: '第二節', startTime: '09:00', endTime: '09:50' }],
      weekCycle: { enabled: true, anchorDate: '2026-03-02', anchorPattern: 'A' } }],
    subjects: [{ id: 'math', projectId: 'p', timetableId: 't', name: '數學', shortName: '數',
      color: '#223344', applicableSchoolLevels: ['senior-high'] },
    { id: 'english', projectId: 'p', timetableId: 't', name: '英文', shortName: '英',
      color: '#334455', applicableSchoolLevels: ['senior-high'] },
    { id: 'other-subject', projectId: 'p', timetableId: 'other', name: '數學', shortName: '數',
      color: '#445566', applicableSchoolLevels: ['senior-high'] }],
    teachingUnitSubjects: [{ id: 'r1', projectId: 'p', teachingUnitId: 'u', subjectId: 'math' },
      { id: 'r2', projectId: 'p', teachingUnitId: 'u', subjectId: 'english' },
      { id: 'r3', projectId: 'p', teachingUnitId: 'u', subjectId: 'other-subject' }],
    classes: [{ id: 'c', projectId: 'p', teachingUnitId: 'u', name: '一甲' }],
    recurringLessons: [], overrides: [], oneOffLessons: [], events: [], teachingProgress: [], migrationWarnings: [],
  }
  const scope: LessonV9Scope = { projectId: 'p', timetableId: 't', teachingUnitId: 'u' }
  const draft: RecurringLessonV9Draft = { ...scope, subjectId: 'math', classId: 'c', day: 1,
    periodId: 1, weekPattern: 'every' }
  return { data, scope, draft }
}

const swapIds = (suffix = '') => ({ groupId: `swap-group${suffix}`,
  firstOverrideId: `swap-first${suffix}`, secondOverrideId: `swap-second${suffix}` })

function sameDaySwapFixture() {
  const source = lessonFixture()
  source.data.teachingUnits[0].periods.push(
    { id: 3, order: 3, label: '第三節', startTime: '10:00', endTime: '10:50' })
  const first = createRecurringLessonV9(source.data, source.scope, source.draft, 'swap-a')
  const data = createRecurringLessonV9(first, source.scope,
    { ...source.draft, subjectId: 'english', periodId: 3 }, 'swap-b')
  return { ...source, data }
}

describe('V9 Lesson domain mutation', () => {
  it('creates and revokes one exact same-day swap group without changing later recurrence', () => {
    const { data, scope } = sameDaySwapFixture()
    const swapped = swapOccurrencesV9(data, scope, {
      firstLessonId: 'swap-a', firstDate: '2026-03-02',
      secondLessonId: 'swap-b', secondDate: '2026-03-02',
    }, swapIds())
    expect(swapped.overrides).toHaveLength(2)
    expect(validateSwapGroupV9(swapped, scope, 'swap-first')).toHaveLength(2)
    expect(resolveV9Day(swapped, scope, fromDateKey('2026-03-02'))
      .filter((item) => item.kind === 'recurring' && item.movementRole === 'target')
      .map((item) => [item.id, item.kind === 'recurring' ? item.periodId : 0]))
      .toEqual([['swap-b', 1], ['swap-a', 3]])
    expect(resolveV9Day(swapped, scope, fromDateKey('2026-03-09'))
      .filter((item) => item.kind === 'recurring' && ['swap-a', 'swap-b'].includes(item.id))
      .map((item) => [item.id, item.kind === 'recurring' ? item.periodId : 0]))
      .toEqual([['swap-a', 1], ['swap-b', 3]])
    expect(revokeSwapGroupV9(swapped, scope, 'swap-second').overrides).toEqual([])
    expect(data.overrides).toEqual([])
  })

  it('supports cross-date and cross-A/B swap occurrences at inclusive term boundaries', () => {
    const { data, scope, draft } = lessonFixture()
    const a = createRecurringLessonV9(data, scope, { ...draft, weekPattern: 'A' }, 'swap-a')
    const both = createRecurringLessonV9(a, scope,
      { ...draft, subjectId: 'english', periodId: 2, weekPattern: 'B' }, 'swap-b')
    const swapped = swapOccurrencesV9(both, scope, {
      firstLessonId: 'swap-a', firstDate: '2026-03-02',
      secondLessonId: 'swap-b', secondDate: '2026-03-09',
    }, swapIds())
    expect(resolveV9Day(swapped, scope, fromDateKey('2026-03-02'))).toMatchObject([
      { id: 'swap-a', movementRole: 'source' }, { id: 'swap-b', movementRole: 'target', periodId: 1 }])
    expect(resolveV9Day(swapped, scope, fromDateKey('2026-03-09'))).toMatchObject([
      { id: 'swap-a', movementRole: 'target', periodId: 2 }, { id: 'swap-b', movementRole: 'source' }])

    const boundary = structuredClone(data)
    boundary.teachingUnits[0].startDate = '2026-03-02'
    boundary.teachingUnits[0].endDate = '2026-06-30'
    const monday = createRecurringLessonV9(boundary, scope, draft, 'boundary-a')
    const ready = createRecurringLessonV9(monday, scope,
      { ...draft, subjectId: 'english', day: 2, periodId: 2 }, 'boundary-b')
    expect(() => swapOccurrencesV9(ready, scope, {
      firstLessonId: 'boundary-a', firstDate: '2026-03-02',
      secondLessonId: 'boundary-b', secondDate: '2026-06-30',
    }, swapIds('-boundary'))).not.toThrow()
    expect(() => swapOccurrencesV9(ready, scope, {
      firstLessonId: 'boundary-a', firstDate: '2026-02-23',
      secondLessonId: 'boundary-b', secondDate: '2026-06-30',
    }, swapIds('-outside'))).toThrow(expect.objectContaining({ code: 'invalid-date' }))

    const crossYear = structuredClone(data)
    crossYear.teachingUnits[0].startDate = '2026-12-28'
    crossYear.teachingUnits[0].endDate = '2027-01-05'
    crossYear.teachingUnits[0].weekCycle.anchorDate = '2026-12-28'
    const yearA = createRecurringLessonV9(crossYear, scope, draft, 'year-a')
    const yearReady = createRecurringLessonV9(yearA, scope,
      { ...draft, subjectId: 'english', day: 2, periodId: 2 }, 'year-b')
    expect(() => swapOccurrencesV9(yearReady, scope, {
      firstLessonId: 'year-a', firstDate: '2026-12-28',
      secondLessonId: 'year-b', secondDate: '2027-01-05',
    }, swapIds('-year'))).not.toThrow()
  })

  it('rejects reused IDs, occupied occurrences and malformed swap groups', () => {
    const { data, scope } = sameDaySwapFixture()
    const draft = { firstLessonId: 'swap-a', firstDate: '2026-03-02',
      secondLessonId: 'swap-b', secondDate: '2026-03-02' }
    expect(() => swapOccurrencesV9(data, scope, { ...draft, secondLessonId: 'swap-a' }, swapIds()))
      .toThrow(expect.objectContaining({ code: 'invalid-draft' }))
    const swapped = swapOccurrencesV9(data, scope, draft, swapIds())
    const collision: AppDataV9 = { ...data, overrides: [{ id: 'unrelated', groupId: 'swap-group',
      projectId: 'p', timetableId: 't', teachingUnitId: 'u', date: '2026-03-09', periodId: 1,
      action: 'cancel', originalLessonId: 'swap-a' }] }
    expect(() => swapOccurrencesV9(collision, scope, draft, swapIds()))
      .toThrow(expect.objectContaining({ code: 'id-collision' }))
    expect(() => swapOccurrencesV9(swapped, scope, draft, swapIds('-again')))
      .toThrow(expect.objectContaining({ code: 'already-changed' }))

    const one = { ...swapped, overrides: [swapped.overrides[0]] }
    expect(() => validateSwapGroupV9(one, scope, 'swap-first'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
    const three = { ...swapped, overrides: [...swapped.overrides,
      { ...swapped.overrides[0], id: 'swap-third' }] }
    expect(() => validateSwapGroupV9(three, scope, 'swap-first'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
    const nonReciprocal = { ...swapped, overrides: swapped.overrides.map((item, index) => index
      ? { ...item, target: { ...item.target!, periodId: 2 } } : item) }
    expect(() => validateSwapGroupV9(nonReciprocal, scope, 'swap-first'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
  })

  it('atomically replaces a complete swap group and preserves it when replacement validation fails', () => {
    const { data, scope } = sameDaySwapFixture()
    const original = swapOccurrencesV9(data, scope, {
      firstLessonId: 'swap-a', firstDate: '2026-03-02',
      secondLessonId: 'swap-b', secondDate: '2026-03-02',
    }, swapIds())
    const replaced = replaceSwapGroupV9(original, scope, 'swap-first', {
      firstLessonId: 'swap-a', firstDate: '2026-03-09',
      secondLessonId: 'swap-b', secondDate: '2026-03-09',
    }, swapIds('-new'))
    expect(replaced.overrides.map((item) => item.groupId)).toEqual(['swap-group-new', 'swap-group-new'])
    expect(original.overrides.map((item) => item.groupId)).toEqual(['swap-group', 'swap-group'])
    expect(() => replaceSwapGroupV9(original, scope, 'swap-first', {
      firstLessonId: 'swap-a', firstDate: '2026-03-03',
      secondLessonId: 'swap-b', secondDate: '2026-03-09',
    }, swapIds('-bad'))).toThrow(expect.objectContaining({ code: 'invalid-date' }))
    expect(original.overrides).toHaveLength(2)
  })

  it('rejects period and custom OneOff overlap while Meeting overlap remains non-blocking', () => {
    const { data, scope } = sameDaySwapFixture()
    const request = { firstLessonId: 'swap-a', firstDate: '2026-03-02',
      secondLessonId: 'swap-b', secondDate: '2026-03-02' }
    const period: AppDataV9 = { ...data, oneOffLessons: [{ id: 'one-period', projectId: 'p', timetableId: 't',
      teachingUnitId: 'u', subjectId: 'math', classId: 'c', date: '2026-03-02', purpose: 'extra',
      time: { mode: 'period', periodId: 1 } }] }
    expect(() => swapOccurrencesV9(period, scope, request, swapIds('-period')))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    const custom: AppDataV9 = { ...data, oneOffLessons: [{ id: 'one-custom', projectId: 'p', timetableId: 't',
      teachingUnitId: 'u', subjectId: 'math', classId: 'c', date: '2026-03-02', purpose: 'extra',
      time: { mode: 'custom', startTime: '10:05', endTime: '10:45' } }] }
    expect(() => swapOccurrencesV9(custom, scope, request, swapIds('-custom')))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    const meeting: AppDataV9 = { ...data, events: [{ id: 'meeting', projectId: 'p', timetableId: 't',
      teachingUnitId: 'u', ownershipStatus: 'resolved', title: 'meeting', type: 'meeting',
      date: '2026-03-02', startTime: '08:00', endTime: '10:50', color: '#112233' }] }
    expect(() => swapOccurrencesV9(meeting, scope, request, swapIds('-meeting'))).not.toThrow()
    const swapped = swapOccurrencesV9(data, scope, request, swapIds('-revoke'))
    const blockedRevoke: AppDataV9 = { ...swapped, oneOffLessons: period.oneOffLessons }
    expect(() => revokeSwapGroupV9(blockedRevoke, scope, 'swap-first-revoke'))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(blockedRevoke.overrides).toHaveLength(2)
  })
  it('creates, edits and deletes a fixed Lesson while preserving V9 validity', () => {
    const { data, scope, draft } = lessonFixture()
    expect(isCompatibleAppDataV9(data)).toBe(true)
    const created = createRecurringLessonV9(data, scope, draft, 'l1')
    expect(created.recurringLessons).toMatchObject([{ id: 'l1', seriesId: 'l1' }])
    const edited = updateRecurringLessonV9(created, scope, 'l1', { ...draft, room: '301' })
    expect(edited.recurringLessons[0].room).toBe('301')
    expect(getRecurringLessonV9Impact(edited, scope, 'l1').changes).toBe(0)
    expect(deleteRecurringLessonV9(edited, scope, 'l1', true).recurringLessons).toEqual([])
    expect(data.recurringLessons).toEqual([])
  })
  it('rejects absent resources, foreign teacher ownership, scope and date violations', () => {
    const { data, scope, draft } = lessonFixture()
    for (const changed of [{ subjectId: 'missing' }, { subjectId: 'other-subject' },
      { classId: 'missing' }, { timetableId: 'other' }, { teachingUnitId: 'missing' }]) {
      expect(() => createRecurringLessonV9(data, scope, { ...draft, ...changed }, 'bad')).toThrow()
    }
    expect(() => createRecurringLessonV9(data, scope, draft, 'math'))
      .toThrow(expect.objectContaining({ code: 'id-collision' }))
    const unset = { ...data, projects: data.projects.map((item) => ({ ...item, term: null })) }
    expect(() => createRecurringLessonV9(unset, scope, draft, 'bad'))
      .toThrow(expect.objectContaining({ code: 'invalid-scope' }))
    const created = createRecurringLessonV9(data, scope, draft, 'l1')
    expect(() => createRecurringLessonV9(created, scope, draft, 'l2')).toThrow()
    expect(() => updateRecurringLessonV9(created, { ...scope, timetableId: 'other' }, 'l1', draft)).toThrow()
    expect(() => cancelOccurrenceV9(created, scope, 'l1', '2026-07-06', 'o1')).toThrow()
    expect(() => cancelOccurrenceV9(created, scope, 'l1', '2026-03-03', 'o1')).toThrow()
    expect(() => updateRecurringLessonV9(created, scope, 'l1', draft))
      .toThrow(expect.objectContaining({ code: 'already-changed' }))
  })
  it('keeps A/B fixed Lessons separate and resolves a cross-week move at both slots', () => {
    const { data, scope, draft } = lessonFixture()
    const a = createRecurringLessonV9(data, scope, { ...draft, weekPattern: 'A' }, 'la')
    const both = createRecurringLessonV9(a, scope, { ...draft, weekPattern: 'B' }, 'lb')
    expect(resolveV9Day(both, scope, fromDateKey('2026-03-02')).map((item) => item.id)).toEqual(['la'])
    expect(resolveV9Day(both, scope, fromDateKey('2026-03-09')).map((item) => item.id)).toEqual(['lb'])
    const moved = moveOccurrenceV9(both, scope, 'la', '2026-03-02',
      { date: '2026-03-09', periodId: 2 }, 'move')
    expect(resolveV9Day(moved, scope, fromDateKey('2026-03-02'))).toMatchObject([
      { id: 'la', status: 'moved', movementRole: 'source' }])
    expect(resolveV9Day(moved, scope, fromDateKey('2026-03-09'))).toMatchObject([
      { id: 'lb', periodId: 1 }, { id: 'la', periodId: 2, movementRole: 'target' }])
    expect(moved.oneOffLessons).toEqual([])
    expect(() => moveOccurrenceV9(both, scope, 'la', '2026-03-02',
      { date: '2026-07-06', periodId: 2 }, 'bad')).toThrow()
    expect(() => moveOccurrenceV9(both, scope, 'la', '2026-03-02',
      { date: '2026-03-09', periodId: 1 }, 'bad')).toThrow()
  })
  it('cancels, replaces and revokes only the selected occurrence', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    expect(resolveV9Day(cancelled, scope, fromDateKey('2026-03-02'))[0]).toMatchObject({ status: 'cancelled' })
    expect(() => cancelOccurrenceV9(cancelled, scope, 'l1', '2026-03-02', 'again')).toThrow()
    expect(revokeOccurrenceOverrideV9(cancelled, scope, 'cancel').overrides).toEqual([])
    expect(() => revokeOccurrenceOverrideV9(cancelled, { ...scope, timetableId: 'other' }, 'cancel'))
      .toThrow(expect.objectContaining({ code: 'not-found' }))
    const replaced = replaceOccurrenceV9(fixed, scope, 'l1', '2026-03-02',
      { subjectId: 'english', classId: 'c' }, 'replace')
    expect(resolveV9Day(replaced, scope, fromDateKey('2026-03-02'))[0]).toMatchObject({
      id: 'l1', subjectId: 'english', status: 'replaced' })
    expect(resolveV9Day(replaced, scope, fromDateKey('2026-03-09'))[0].subjectId).toBe('math')
    expect(() => replaceOccurrenceV9(fixed, scope, 'l1', '2026-03-02',
      { subjectId: 'other-subject', classId: 'c' }, 'bad')).toThrow()
    expect(() => updateRecurringLessonV9(cancelled, scope, 'l1', { ...draft, room: '301' }))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
    expect(() => deleteRecurringLessonV9(cancelled, scope, 'l1', true))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
  })
  it('rejects revoke when restoring a cancelled occurrence would overlap OneOff or another TeachingUnit', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    const withOneOff: AppDataV9 = { ...cancelled, oneOffLessons: [{ id: 'one-off', projectId: 'p',
      timetableId: 't', teachingUnitId: 'u', subjectId: 'math', classId: 'c', date: '2026-03-02',
      purpose: 'extra', time: { mode: 'period', periodId: 1 } }] }
    expect(isCompatibleAppDataV9(withOneOff)).toBe(true)
    expect(() => revokeOccurrenceOverrideV9(withOneOff, scope, 'cancel'))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(withOneOff.overrides).toEqual(cancelled.overrides)

    const secondUnit = { ...cancelled.teachingUnits[0], id: 'u2', name: '第二學制',
      periods: cancelled.teachingUnits[0].periods.map((period) => ({ ...period, id: period.id + 10 })) }
    const crossUnit: AppDataV9 = { ...cancelled,
      teachingUnits: [...cancelled.teachingUnits, secondUnit],
      teachingUnitSubjects: [...cancelled.teachingUnitSubjects,
        { id: 'r4', projectId: 'p', teachingUnitId: 'u2', subjectId: 'math' },
        { id: 'r5', projectId: 'p', teachingUnitId: 'u2', subjectId: 'english' }],
      classes: [...cancelled.classes, { id: 'c2', projectId: 'p', teachingUnitId: 'u2', name: '二甲' }],
      recurringLessons: [...cancelled.recurringLessons, { id: 'l2', seriesId: 'l2', projectId: 'p',
        timetableId: 't', teachingUnitId: 'u2', subjectId: 'math', classId: 'c2', day: 1,
        periodId: 11, weekPattern: 'every', effectiveStart: '2026-03-01', origin: 'user' }],
    }
    expect(isCompatibleAppDataV9(crossUnit)).toBe(true)
    expect(() => revokeOccurrenceOverrideV9(crossUnit, scope, 'cancel'))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(crossUnit.overrides).toEqual(cancelled.overrides)
    const withReplacement: AppDataV9 = { ...crossUnit, overrides: [...crossUnit.overrides,
      { id: 'replace-other', projectId: 'p', timetableId: 't', teachingUnitId: 'u2',
        date: '2026-03-02', periodId: 11, action: 'replace', originalLessonId: 'l2',
        replacement: { subjectId: 'english', classId: 'c2' }, origin: 'user' }] }
    expect(isCompatibleAppDataV9(withReplacement)).toBe(true)
    expect(() => revokeOccurrenceOverrideV9(withReplacement, scope, 'cancel'))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
  })
  it('rejects revoke when another move target occupies the source, but ignores another teacher', () => {
    const { data, scope, draft } = lessonFixture()
    const first = createRecurringLessonV9(data, scope, draft, 'l1')
    const fixed = createRecurringLessonV9(first, scope, { ...draft, day: 2, periodId: 2 }, 'l2')
    const movedFirst = moveOccurrenceV9(fixed, scope, 'l1', '2026-03-02',
      { date: '2026-03-02', periodId: 2 }, 'move-first')
    const movedSecond = moveOccurrenceV9(movedFirst, scope, 'l2', '2026-03-03',
      { date: '2026-03-02', periodId: 1 }, 'move-second')
    const originalRaw = JSON.stringify(movedSecond)
    expect(() => revokeOccurrenceOverrideV9(movedSecond, scope, 'move-first'))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(JSON.stringify(movedSecond)).toBe(originalRaw)

    const otherScope = { ...scope, timetableId: 'other' }
    const otherDraft = { ...draft, timetableId: 'other', subjectId: 'other-subject' }
    const otherTeacher = createRecurringLessonV9(first, otherScope, otherDraft, 'other-lesson')
    const cancelled = cancelOccurrenceV9(otherTeacher, scope, 'l1', '2026-03-02', 'cancel')
    expect(revokeOccurrenceOverrideV9(cancelled, scope, 'cancel').overrides).toEqual([])
  })
  it('revokes a move by restoring exactly its original occurrence', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const moved = moveOccurrenceV9(fixed, scope, 'l1', '2026-03-02',
      { date: '2026-03-02', periodId: 2 }, 'move')
    const revoked = revokeOccurrenceOverrideV9(moved, scope, 'move')
    expect(revoked.overrides).toEqual([])
    expect(resolveV9Day(revoked, scope, fromDateKey('2026-03-02'))).toMatchObject([
      { id: 'l1', status: 'regular', periodId: 1 }])
  })
  it('keeps grouped overrides blocked until an atomic group operation exists', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    const grouped = { ...cancelled, overrides: cancelled.overrides.map((item) => ({ ...item, groupId: 'group' })) }
    expect(() => revokeOccurrenceOverrideV9(grouped, scope, 'cancel'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
    expect(() => replaceOccurrenceChangeV9(grouped, scope, 'cancel', { action: 'cancel' }, 'replacement'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
  })
  it('atomically replaces cancel, move and replacement changes for the same occurrence', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, { ...draft, weekPattern: 'A' }, 'l1')
    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    const sameDay = replaceOccurrenceChangeV9(cancelled, scope, 'cancel',
      { action: 'move', target: { date: '2026-03-02', periodId: 2 } }, 'same-day')
    expect(sameDay.overrides).toMatchObject([{ id: 'same-day', originalLessonId: 'l1', date: '2026-03-02',
      action: 'move', target: { date: '2026-03-02', periodId: 2 } }])
    const crossWeek = replaceOccurrenceChangeV9(sameDay, scope, 'same-day',
      { action: 'move', target: { date: '2026-03-09', periodId: 2 } }, 'cross-week')
    expect(resolveV9Day(crossWeek, scope, fromDateKey('2026-03-09'))).toMatchObject([
      { id: 'l1', movementRole: 'target', periodId: 2 }])
    const replaced = replaceOccurrenceChangeV9(crossWeek, scope, 'cross-week',
      { action: 'replace', replacement: { subjectId: 'english', classId: 'c', room: '301' } }, 'replace')
    expect(resolveV9Day(replaced, scope, fromDateKey('2026-03-02'))[0]).toMatchObject({
      id: 'l1', status: 'replaced', subjectId: 'english', room: '301' })
    const recancelled = replaceOccurrenceChangeV9(replaced, scope, 'replace', { action: 'cancel' }, 'recancel')
    expect(recancelled.overrides).toMatchObject([{ id: 'recancel', action: 'cancel', date: '2026-03-02' }])
    expect(recancelled.overrides).toHaveLength(1)
  })
  it('retains the original override when an atomic replacement is invalid or crosses the term', () => {
    const { data, scope, draft } = lessonFixture()
    const first = createRecurringLessonV9(data, scope, draft, 'l1')
    const fixed = createRecurringLessonV9(first, scope, { ...draft, periodId: 2 }, 'blocker')
    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    const before = JSON.stringify(cancelled)
    expect(() => replaceOccurrenceChangeV9(cancelled, scope, 'cancel',
      { action: 'move', target: { date: '2026-03-02', periodId: 2 } }, 'conflict'))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(() => replaceOccurrenceChangeV9(cancelled, scope, 'cancel',
      { action: 'move', target: { date: '2026-07-06', periodId: 1 } }, 'outside'))
      .toThrow(expect.objectContaining({ code: 'invalid-date' }))
    expect(() => replaceOccurrenceChangeV9(cancelled, scope, 'cancel',
      { action: 'replace', replacement: { subjectId: 'other-subject', classId: 'c' } }, 'foreign'))
      .toThrow(expect.objectContaining({ code: 'invalid-reference' }))
    expect(JSON.stringify(cancelled)).toBe(before)
    expect(cancelled.overrides).toMatchObject([{ id: 'cancel' }])
  })
  it('requires explicit conflict consent and keeps the conflict visible in the final projection', () => {
    const { data, scope, draft } = lessonFixture()
    const first = createRecurringLessonV9(data, scope, draft, 'l1')
    const fixed = createRecurringLessonV9(first, scope, { ...draft, periodId: 2 }, 'blocker')
    expect(() => moveOccurrenceV9(fixed, scope, 'l1', '2026-03-02',
      { date: '2026-03-02', periodId: 2 }, 'unconfirmed')).toThrow(expect.objectContaining({ code: 'conflict' }))
    const allowed = moveOccurrenceV9(fixed, scope, 'l1', '2026-03-02',
      { date: '2026-03-02', periodId: 2 }, 'confirmed', true)
    const active = resolveV9Day(allowed, scope, fromDateKey('2026-03-02'))
      .filter((item) => item.kind !== 'recurring' || item.movementRole !== 'source')
    expect(active).toHaveLength(2)
    expect(active.every((item) => item.hasConflict)).toBe(true)

    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    expect(() => replaceOccurrenceChangeV9(cancelled, scope, 'cancel',
      { action: 'move', target: { date: '2026-03-02', periodId: 2 } }, 'atomic-unconfirmed'))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    const atomicAllowed = replaceOccurrenceChangeV9(cancelled, scope, 'cancel',
      { action: 'move', target: { date: '2026-03-02', periodId: 2 }, allowConflict: true }, 'atomic-confirmed')
    expect(atomicAllowed.overrides).toMatchObject([{ id: 'atomic-confirmed', action: 'move' }])
    expect(resolveV9Day(atomicAllowed, scope, fromDateKey('2026-03-02'))
      .filter((item) => item.kind !== 'recurring' || item.movementRole !== 'source')
      .every((item) => item.hasConflict)).toBe(true)
  })
  it('splits a series without rewriting history and reassigns only future override references', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const historical = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-09', 'historical')
    const changed = cancelOccurrenceV9(historical, scope, 'l1', '2026-03-23', 'future')
    const split = permanentlyUpdateLessonV9(changed, scope, 'l1', '2026-03-16',
      { ...draft, subjectId: 'english' }, 'l2')
    expect(split.recurringLessons).toMatchObject([
      { id: 'l1', effectiveEnd: '2026-03-15' }, { id: 'l2', seriesId: 'l1', effectiveStart: '2026-03-16' }])
    expect(split.overrides).toMatchObject([
      { id: 'historical', originalLessonId: 'l1' }, { id: 'future', originalLessonId: 'l2' },
    ])
    expect(resolveV9Day(split, scope, fromDateKey('2026-03-09'))[0].subjectId).toBe('math')
    expect(resolveV9Day(split, scope, fromDateKey('2026-03-16'))[0].subjectId).toBe('english')
    expect(() => permanentlyUpdateLessonV9(fixed, scope, 'l1', '2026-03-01', draft, 'bad')).toThrow()
    expect(() => permanentlyUpdateLessonV9(fixed, scope, 'l1', '2026-07-01', draft, 'bad')).toThrow()
    expect(() => permanentlyUpdateLessonV9(changed, scope, 'l1', '2026-03-16',
      { ...draft, day: 2 }, 'bad')).toThrow(expect.objectContaining({ code: 'referenced' }))
  })

  it('ends the latest series inclusively while preserving history and past overrides', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const historical = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-09', 'historical')
    const ended = endRecurringLessonFromDateV9(historical, scope, 'l1', '2026-03-16')
    expect(ended.recurringLessons).toMatchObject([{ id: 'l1', effectiveEnd: '2026-03-15' }])
    expect(ended.overrides).toEqual(historical.overrides)
    expect(resolveV9Day(ended, scope, fromDateKey('2026-03-09'))[0]).toMatchObject({
      id: 'l1', status: 'cancelled', overrideId: 'historical',
    })
    expect(resolveV9Day(ended, scope, fromDateKey('2026-03-16'))).toEqual([])
    expect(isCompatibleAppDataV9(ended)).toBe(true)
    expect(fixed.recurringLessons[0].effectiveEnd).toBe('2026-06-30')
  })

  it('removes an initial version without creating an empty range and supports inclusive term boundaries', () => {
    const { data, scope, draft } = lessonFixture()
    const firstDay = structuredClone(data)
    firstDay.teachingUnits[0].startDate = '2026-03-02'
    const fixed = createRecurringLessonV9(firstDay, scope, draft, 'first')
    const removed = endRecurringLessonFromDateV9(fixed, scope, 'first', '2026-03-02')
    expect(removed.recurringLessons).toEqual([])
    expect(isCompatibleAppDataV9(removed)).toBe(true)

    const lastDayDraft = { ...draft, day: 2 as const }
    const lastDay = createRecurringLessonV9(data, scope, lastDayDraft, 'last')
    const endedLast = endRecurringLessonFromDateV9(lastDay, scope, 'last', '2026-06-30')
    expect(endedLast.recurringLessons[0].effectiveEnd).toBe('2026-06-29')
    expect(resolveV9Day(endedLast, scope, fromDateKey('2026-06-30'))).toEqual([])

    const crossYear = structuredClone(data)
    crossYear.teachingUnits[0].startDate = '2026-12-28'
    crossYear.teachingUnits[0].endDate = '2027-01-04'
    crossYear.teachingUnits[0].weekCycle.anchorDate = '2026-12-28'
    const yearLesson = createRecurringLessonV9(crossYear, scope, draft, 'year')
    expect(endRecurringLessonFromDateV9(yearLesson, scope, 'year', '2027-01-04')
      .recurringLessons[0].effectiveEnd).toBe('2027-01-03')
  })

  it('rejects invalid, repeated, historical-version, and cross-boundary override ends without mutation', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    expect(() => endRecurringLessonFromDateV9(fixed, scope, 'l1', '2026-02-23'))
      .toThrow(expect.objectContaining({ code: 'invalid-date' }))
    expect(() => endRecurringLessonFromDateV9(fixed, scope, 'l1', '2026-03-03'))
      .toThrow(expect.objectContaining({ code: 'invalid-date' }))
    const ended = endRecurringLessonFromDateV9(fixed, scope, 'l1', '2026-03-16')
    expect(() => endRecurringLessonFromDateV9(ended, scope, 'l1', '2026-03-16'))
      .toThrow(expect.objectContaining({ code: 'invalid-date' }))
    const split = permanentlyUpdateLessonV9(fixed, scope, 'l1', '2026-03-16',
      { ...draft, subjectId: 'english' }, 'l2')
    expect(() => endRecurringLessonFromDateV9(split, scope, 'l1', '2026-03-09'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))

    const futureSource = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-23', 'future')
    expect(() => endRecurringLessonFromDateV9(futureSource, scope, 'l1', '2026-03-16'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
    const futureTarget = moveOccurrenceV9(fixed, scope, 'l1', '2026-03-09',
      { date: '2026-03-16', periodId: 2 }, 'future-target', true)
    expect(() => endRecurringLessonFromDateV9(futureTarget, scope, 'l1', '2026-03-16'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
    expect(futureSource.recurringLessons[0].effectiveEnd).toBe('2026-06-30')
    expect(futureTarget.recurringLessons[0].effectiveEnd).toBe('2026-06-30')
  })

  it('validates complete swap groups across the end boundary and fails closed on malformed groups', () => {
    const { data, scope } = sameDaySwapFixture()
    const crossing = swapOccurrencesV9(data, scope, {
      firstLessonId: 'swap-a', firstDate: '2026-03-09',
      secondLessonId: 'swap-b', secondDate: '2026-03-16',
    }, swapIds('-crossing'))
    expect(() => endRecurringLessonFromDateV9(crossing, scope, 'swap-a', '2026-03-16'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
    const historical = swapOccurrencesV9(data, scope, {
      firstLessonId: 'swap-a', firstDate: '2026-03-02',
      secondLessonId: 'swap-b', secondDate: '2026-03-02',
    }, swapIds('-historical'))
    const malformed = { ...historical, overrides: historical.overrides.slice(0, 1) }
    expect(() => endRecurringLessonFromDateV9(malformed, scope, 'swap-a', '2026-03-16'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
    expect(crossing.recurringLessons.every((item) => item.effectiveEnd === '2026-06-30')).toBe(true)
  })

  it('preserves OneOff lessons, make-up references, and teaching progress byte-for-byte', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const withOneOff = createOneOffLessonV9(fixed, scope, {
      ...scope, subjectId: 'math', classId: 'c', date: '2026-03-10', purpose: 'make-up',
      relatedRecurringLessonId: 'l1', time: { mode: 'period', periodId: 2 },
    }, '11111111-1111-4111-8111-111111111111')
    const progress = { ...withOneOff, teachingProgress: [{
      id: '22222222-2222-4222-8222-222222222222', projectId: 'p', timetableId: 't', teachingUnitId: 'u',
      classId: 'c', subjectId: 'math', content: { chapter: '1', unit: '1', note: 'kept' },
      previousProgress: null, createdAt: '2026-03-09T00:00:00.000Z', updatedAt: '2026-03-09T00:00:00.000Z',
    }] }
    const ended = endRecurringLessonFromDateV9(progress, scope, 'l1', '2026-03-16')
    expect(ended.oneOffLessons).toEqual(progress.oneOffLessons)
    expect(ended.teachingProgress).toEqual(progress.teachingProgress)
    expect(isCompatibleAppDataV9(ended)).toBe(true)
    const startsAtFirstOccurrence = { ...progress, recurringLessons: progress.recurringLessons.map((item) => ({
      ...item, effectiveStart: '2026-03-02',
    })) }
    expect(() => endRecurringLessonFromDateV9(startsAtFirstOccurrence, scope, 'l1', '2026-03-02'))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
  })

  it.each([
    ['every', 'A', '2026-03-16'],
    ['A', 'B', '2026-03-16'],
    ['B', 'every', '2026-03-09'],
  ] as const)('splits week pattern %s to %s on a real anchored occurrence', (before, after, date) => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, { ...draft, weekPattern: before }, 'l1')
    const split = permanentlyUpdateLessonV9(fixed, scope, 'l1', date,
      { ...draft, weekPattern: after }, 'l2')
    expect(split.recurringLessons).toMatchObject([
      { id: 'l1', weekPattern: before }, { id: 'l2', weekPattern: after, effectiveStart: date },
    ])
    expect(isCompatibleAppDataV9(split)).toBe(true)
  })

  it('permanently swaps two latest versions from a non-occurrence date in one valid candidate', () => {
    const { data, scope, draft } = lessonFixture()
    const first = createRecurringLessonV9(data, scope, draft, 'swap-a')
    const ready = createRecurringLessonV9(first, scope,
      { ...draft, subjectId: 'english', day: 3, periodId: 2 }, 'swap-b')
    const oneOff = createOneOffLessonV9(ready, scope, {
      ...scope, subjectId: 'math', classId: 'c', date: '2026-03-03', purpose: 'extra',
      time: { mode: 'custom', startTime: '18:00', endTime: '18:45' },
    }, '11111111-1111-4111-8111-111111111111')
    const withRecords = { ...oneOff, teachingProgress: [{ id: '44444444-4444-4444-8444-444444444444', ...scope,
      classId: 'c', subjectId: 'math', content: { chapter: '1', unit: '1', note: '' },
      previousProgress: null, createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z' }] }
    const swapped = permanentlySwapLessonsV9(withRecords, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' })
    expect(swapped.recurringLessons).toMatchObject([
      { id: 'swap-a', effectiveEnd: '2026-03-03', day: 1, periodId: 1 },
      { id: 'swap-a-v2', seriesId: 'swap-a', effectiveStart: '2026-03-04', day: 3, periodId: 2,
        weekPattern: 'every', subjectId: 'math' },
      { id: 'swap-b', effectiveEnd: '2026-03-03', day: 3, periodId: 2 },
      { id: 'swap-b-v2', seriesId: 'swap-b', effectiveStart: '2026-03-04', day: 1, periodId: 1,
        weekPattern: 'every', subjectId: 'english' },
    ])
    expect(resolveV9Day(swapped, scope, fromDateKey('2026-03-02'))
      .filter((item) => item.kind === 'recurring').map((item) => [item.id, item.periodId]))
      .toEqual([['swap-a', 1]])
    expect(resolveV9Day(swapped, scope, fromDateKey('2026-03-09'))
      .filter((item) => item.kind === 'recurring').map((item) => [item.id, item.periodId]))
      .toEqual([['swap-b-v2', 1]])
    expect(resolveV9Day(swapped, scope, fromDateKey('2026-03-11'))
      .filter((item) => item.kind === 'recurring').map((item) => [item.id, item.periodId]))
      .toEqual([['swap-a-v2', 2]])
    expect(isCompatibleAppDataV9(swapped)).toBe(true)
    expect(swapped.oneOffLessons).toEqual(withRecords.oneOffLessons)
    expect(swapped.teachingProgress).toEqual(withRecords.teachingProgress)
    expect(ready.recurringLessons).toHaveLength(2)
  })

  it.each([
    ['A', 'B'], ['every', 'A'], ['A', 'every'], ['B', 'every'], ['every', 'every'],
  ] as const)('keeps %s and %s week patterns while exchanging only day and period', (firstPattern, secondPattern) => {
    const { data, scope, draft } = lessonFixture()
    const first = createRecurringLessonV9(data, scope, { ...draft, weekPattern: firstPattern }, 'swap-a')
    const ready = createRecurringLessonV9(first, scope,
      { ...draft, subjectId: 'english', day: 4, periodId: 2, weekPattern: secondPattern }, 'swap-b')
    const swapped = permanentlySwapLessonsV9(ready, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' })
    expect(swapped.recurringLessons.find((item) => item.id === 'swap-a-v2'))
      .toMatchObject({ day: 4, periodId: 2, weekPattern: firstPattern })
    expect(swapped.recurringLessons.find((item) => item.id === 'swap-b-v2'))
      .toMatchObject({ day: 1, periodId: 1, weekPattern: secondPattern })
  })

  it('safely replaces versions at effectiveStart and rejects linked OneOff or colliding IDs', () => {
    const { data, scope, draft } = lessonFixture()
    const aligned = structuredClone(data)
    aligned.teachingUnits[0].startDate = '2026-03-02'
    const first = createRecurringLessonV9(aligned, scope, draft, 'swap-a')
    const ready = createRecurringLessonV9(first, scope,
      { ...draft, subjectId: 'english', day: 2, periodId: 2 }, 'swap-b')
    const swapped = permanentlySwapLessonsV9(ready, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-02',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' })
    expect(swapped.recurringLessons.map((item) => item.id)).toEqual(['swap-a-v2', 'swap-b-v2'])
    expect(() => permanentlySwapLessonsV9(ready, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-02',
    }, { firstLessonId: 'swap-a', secondLessonId: 'swap-b-v2' }))
      .toThrow(expect.objectContaining({ code: 'id-collision' }))
    const linked = createOneOffLessonV9(ready, scope, {
      ...scope, subjectId: 'math', classId: 'c', date: '2026-03-03', purpose: 'make-up',
      relatedRecurringLessonId: 'swap-a', time: { mode: 'period', periodId: 1 },
    }, '11111111-1111-4111-8111-111111111111')
    expect(() => permanentlySwapLessonsV9(linked, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-02',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' }))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
  })

  it('requires two latest series in one scope and a shared effective-date interval', () => {
    const { data, scope, draft } = lessonFixture()
    const first = createRecurringLessonV9(data, scope, draft, 'swap-a')
    const ready = createRecurringLessonV9(first, scope,
      { ...draft, subjectId: 'english', day: 2, periodId: 2 }, 'swap-b')
    expect(() => permanentlySwapLessonsV9(ready, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-a', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' }))
      .toThrow(expect.objectContaining({ code: 'invalid-draft' }))
    const noIntersection = { ...ready, recurringLessons: ready.recurringLessons.map((item) => item.id === 'swap-a'
      ? { ...item, effectiveEnd: '2026-03-03' } : { ...item, effectiveStart: '2026-03-04' }) }
    expect(() => permanentlySwapLessonsV9(noIntersection, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' }))
      .toThrow(expect.objectContaining({ code: 'invalid-date' }))
    const otherScope = { projectId: 'p', timetableId: 'other', teachingUnitId: 'u' }
    const foreign = createRecurringLessonV9(ready, otherScope, {
      ...draft, timetableId: 'other', subjectId: 'other-subject', day: 3, periodId: 2,
    }, 'foreign')
    expect(() => permanentlySwapLessonsV9(foreign, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'foreign', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'foreign-v2' }))
      .toThrow(expect.objectContaining({ code: 'not-found' }))

    const secondUnit = { ...ready,
      teachingUnits: [...ready.teachingUnits, { ...ready.teachingUnits[0], id: 'u2', name: 'Second Unit' }],
      teachingUnitSubjects: [...ready.teachingUnitSubjects,
        { id: 'u2-math', projectId: 'p', teachingUnitId: 'u2', subjectId: 'math' }],
      classes: [...ready.classes, { id: 'c2', projectId: 'p', teachingUnitId: 'u2', name: 'Second Class' }],
    }
    const otherUnit = createRecurringLessonV9(secondUnit,
      { projectId: 'p', timetableId: 't', teachingUnitId: 'u2' }, {
      ...draft, teachingUnitId: 'u2', classId: 'c2', day: 3, periodId: 2,
    }, 'other-unit')
    expect(() => permanentlySwapLessonsV9(otherUnit, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'other-unit', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'other-unit-v2' }))
      .toThrow(expect.objectContaining({ code: 'not-found' }))

    const otherProjectBase: AppDataV9 = { ...ready,
      projects: [...ready.projects, { ...ready.projects[0], id: 'p2', name: 'Second Project' }],
      timetables: [...ready.timetables, { id: 't2', projectId: 'p2', name: 'Second', teacherName: 'Second' }],
      schools: [...ready.schools, { id: 's2', projectId: 'p2', name: 'Second School', color: '#556677' }],
      teachingUnits: [...ready.teachingUnits, { ...ready.teachingUnits[0], id: 'u2', projectId: 'p2',
        schoolId: 's2', name: 'Second Unit' }],
      subjects: [...ready.subjects, { ...ready.subjects[0], id: 'math2', projectId: 'p2',
        timetableId: 't2', name: 'Second Math' }],
      teachingUnitSubjects: [...ready.teachingUnitSubjects,
        { id: 'p2-math', projectId: 'p2', teachingUnitId: 'u2', subjectId: 'math2' }],
      classes: [...ready.classes, { id: 'p2-class', projectId: 'p2', teachingUnitId: 'u2', name: 'Second Class' }],
    }
    const otherProject = createRecurringLessonV9(otherProjectBase,
      { projectId: 'p2', timetableId: 't2', teachingUnitId: 'u2' }, {
      projectId: 'p2', timetableId: 't2', teachingUnitId: 'u2', subjectId: 'math2',
      classId: 'p2-class', day: 3, periodId: 2, weekPattern: 'every',
    }, 'other-project')
    expect(() => permanentlySwapLessonsV9(otherProject, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'other-project', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'other-project-v2' }))
      .toThrow(expect.objectContaining({ code: 'not-found' }))
  })

  it('accepts TeachingUnit first, last, cross-month and cross-year dates and rejects outside dates', () => {
    const source = lessonFixture()
    source.data.teachingUnits[0].startDate = '2026-03-02'
    source.data.teachingUnits[0].endDate = '2027-01-31'
    const first = createRecurringLessonV9(source.data, source.scope, source.draft, 'swap-a')
    const ready = createRecurringLessonV9(first, source.scope,
      { ...source.draft, subjectId: 'english', day: 3, periodId: 2 }, 'swap-b')
    expect(() => permanentlySwapLessonsV9(ready, source.scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-02',
    }, { firstLessonId: 'start-a', secondLessonId: 'start-b' })).not.toThrow()
    expect(() => permanentlySwapLessonsV9(ready, source.scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-04-01',
    }, { firstLessonId: 'month-a', secondLessonId: 'month-b' })).not.toThrow()
    expect(() => permanentlySwapLessonsV9(ready, source.scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2027-01-01',
    }, { firstLessonId: 'year-a', secondLessonId: 'year-b' })).not.toThrow()
    expect(() => permanentlySwapLessonsV9(ready, source.scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2027-01-31',
    }, { firstLessonId: 'end-a', secondLessonId: 'end-b' })).not.toThrow()
    for (const date of ['2026-03-01', '2027-02-01']) {
      expect(() => permanentlySwapLessonsV9(ready, source.scope, {
        firstLessonId: 'swap-a', secondLessonId: 'swap-b', date,
      }, { firstLessonId: `outside-a-${date}`, secondLessonId: `outside-b-${date}` }))
        .toThrow(expect.objectContaining({ code: 'invalid-date' }))
    }
  })

  it('rebinds a legal future override to the same week and rejects an unrepresentable mapping', () => {
    const { data, scope, draft } = lessonFixture()
    const first = createRecurringLessonV9(data, scope, draft, 'swap-a')
    const ready = createRecurringLessonV9(first, scope,
      { ...draft, subjectId: 'english', day: 3, periodId: 2 }, 'swap-b')
    const historical = cancelOccurrenceV9(ready, scope, 'swap-a', '2026-03-02', 'historical-cancel')
    const changed = cancelOccurrenceV9(historical, scope, 'swap-a', '2026-03-09', 'future-cancel')
    const swapped = permanentlySwapLessonsV9(changed, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' })
    expect(swapped.overrides).toMatchObject([{
      id: 'historical-cancel', originalLessonId: 'swap-a', date: '2026-03-02', periodId: 1,
    }, {
      id: 'future-cancel', originalLessonId: 'swap-a-v2', date: '2026-03-11', periodId: 2,
    }])
    expect(resolveV9Day(swapped, scope, fromDateKey('2026-03-11'))[0])
      .toMatchObject({ id: 'swap-a-v2', status: 'cancelled', overrideId: 'future-cancel' })

    const friday = createRecurringLessonV9(data, scope, { ...draft, day: 5 }, 'friday')
    const monday = createRecurringLessonV9(friday, scope,
      { ...draft, subjectId: 'english', day: 1, periodId: 2 }, 'monday')
    const impossible = cancelOccurrenceV9(monday, scope, 'friday', '2026-03-06', 'future-friday')
    expect(() => permanentlySwapLessonsV9(impossible, scope, {
      firstLessonId: 'friday', secondLessonId: 'monday', date: '2026-03-06',
    }, { firstLessonId: 'friday-v2', secondLessonId: 'monday-v2' }))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
  })

  it('atomically rebinds a complete future swap group and rejects malformed or cross-boundary groups', () => {
    const { data, scope } = sameDaySwapFixture()
    const grouped = swapOccurrencesV9(data, scope, {
      firstLessonId: 'swap-a', firstDate: '2026-03-09',
      secondLessonId: 'swap-b', secondDate: '2026-03-09',
    }, swapIds('-future'))
    const permanent = permanentlySwapLessonsV9(grouped, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' })
    expect(validateSwapGroupV9(permanent, scope, 'swap-first-future')).toHaveLength(2)
    expect(new Set(permanent.overrides.map((item) => item.originalLessonId)))
      .toEqual(new Set(['swap-a-v2', 'swap-b-v2']))
    const malformed = { ...grouped, overrides: grouped.overrides.slice(0, 1) }
    expect(() => permanentlySwapLessonsV9(malformed, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' }))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
  })

  it('rejects new fixed and OneOff conflicts while Meeting remains non-blocking', () => {
    const { data, scope, draft } = lessonFixture()
    const first = createRecurringLessonV9(data, scope, draft, 'swap-a')
    const second = createRecurringLessonV9(first, scope,
      { ...draft, subjectId: 'english', day: 2, periodId: 2, weekPattern: 'A' }, 'swap-b')
    const blocked = createRecurringLessonV9(second, scope,
      { ...draft, day: 2, periodId: 2, weekPattern: 'B' }, 'third')
    expect(() => permanentlySwapLessonsV9(blocked, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' }))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    const oneOff = createOneOffLessonV9(second, scope, {
      ...scope, subjectId: 'math', classId: 'c', date: '2026-03-10', purpose: 'extra',
      time: { mode: 'period', periodId: 2 },
    }, '11111111-1111-4111-8111-111111111111')
    expect(() => permanentlySwapLessonsV9(oneOff, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' }))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    const meeting = { ...second, events: [{ id: 'meeting', projectId: 'p', timetableId: 't',
      teachingUnitId: 'u', ownershipStatus: 'resolved' as const, title: 'Meeting', type: 'meeting' as const,
      date: '2026-03-10', startTime: '09:00', endTime: '09:50', color: '#112233' }] }
    expect(() => permanentlySwapLessonsV9(meeting, scope, {
      firstLessonId: 'swap-a', secondLessonId: 'swap-b', date: '2026-03-04',
    }, { firstLessonId: 'swap-a-v2', secondLessonId: 'swap-b-v2' })).not.toThrow()
  })
})

describe('V9 OneOff Lesson domain mutation', () => {
  const firstId = '11111111-1111-4111-8111-111111111111'
  const secondId = '22222222-2222-4222-8222-222222222222'
  const thirdId = '33333333-3333-4333-8333-333333333333'
  const oneOffDraft = (scope: LessonV9Scope, purpose: OneOffLessonV9Draft['purpose'] = 'extra') => ({
    ...scope, subjectId: 'math', classId: 'c', date: '2026-03-02', purpose,
    time: { mode: 'period' as const, periodId: 1 },
  })

  it('creates all purposes, edits across dates with a stable ID, and deletes only the target', () => {
    const { data, scope } = lessonFixture()
    const extra = createOneOffLessonV9(data, scope, oneOffDraft(scope), firstId)
    const makeUp = createOneOffLessonV9(extra, scope, {
      ...oneOffDraft(scope, 'make-up'), date: '2026-03-03', relatedRecurringLessonId: 'removed-source',
      time: { mode: 'custom', startTime: '10:00', endTime: '10:45' },
    }, secondId)
    const all = createOneOffLessonV9(makeUp, scope, {
      ...oneOffDraft(scope, 'substitute'), date: '2026-03-04', time: { mode: 'period', periodId: 2 },
    }, thirdId)
    expect(all.oneOffLessons.map((item) => item.purpose)).toEqual(['extra', 'make-up', 'substitute'])
    const edited = updateOneOffLessonV9(all, scope, firstId, {
      ...oneOffDraft(scope), date: '2026-03-05', room: '301',
      time: { mode: 'custom', startTime: '08:05', endTime: '08:50' },
    })
    expect(edited.oneOffLessons.find((item) => item.id === firstId)).toMatchObject({
      id: firstId, date: '2026-03-05', room: '301', time: { mode: 'custom' },
    })
    expect(deleteOneOffLessonV9(edited, scope, firstId, true).oneOffLessons.map((item) => item.id))
      .toEqual([secondId, thirdId])
    expect(data.oneOffLessons).toEqual([])
  })

  it('rejects invalid ownership, configuration, dates, time, IDs, and cross-scope edits', () => {
    const { data, scope } = lessonFixture()
    const draft = oneOffDraft(scope)
    expect(() => createOneOffLessonV9(data, scope, { ...draft, subjectId: 'other-subject' }, firstId))
      .toThrow(expect.objectContaining({ code: 'invalid-reference' }))
    expect(() => createOneOffLessonV9(data, scope, { ...draft, date: '2026-07-01' }, firstId))
      .toThrow(expect.objectContaining({ code: 'invalid-date' }))
    expect(() => createOneOffLessonV9(data, scope, { ...draft,
      time: { mode: 'custom', startTime: '23:55', endTime: '00:05' } }, firstId))
      .toThrow(expect.objectContaining({ code: 'invalid-draft' }))
    expect(() => createOneOffLessonV9(data, scope, draft, 'not-a-uuid'))
      .toThrow(expect.objectContaining({ code: 'id-collision' }))
    const created = createOneOffLessonV9(data, scope, draft, firstId)
    expect(() => createOneOffLessonV9(created, scope, { ...draft, date: '2026-03-03' }, firstId))
      .toThrow(expect.objectContaining({ code: 'id-collision' }))
    expect(() => updateOneOffLessonV9(created, scope, 'missing', draft))
      .toThrow(expect.objectContaining({ code: 'not-found' }))
    expect(() => updateOneOffLessonV9(created, { ...scope, timetableId: 'other' }, firstId,
      { ...draft, timetableId: 'other', subjectId: 'other-subject' }))
      .toThrow(expect.objectContaining({ code: 'invalid-scope' }))
    const unset = { ...data, projects: data.projects.map((item) => ({ ...item, term: null })) }
    expect(() => createOneOffLessonV9(unset, scope, draft, secondId))
      .toThrow(expect.objectContaining({ code: 'invalid-scope' }))
  })

  it('keeps boundary dates, five-minute custom times, half-open intervals, and cross-year A/B resolution exact', () => {
    const { data, scope, draft } = lessonFixture()
    expect(() => createOneOffLessonV9(data, scope, { ...oneOffDraft(scope),
      time: { mode: 'custom', startTime: '08:03', endTime: '08:50' } }, firstId))
      .toThrow(expect.objectContaining({ code: 'invalid-draft' }))
    const fixed = createRecurringLessonV9(data, scope, draft, 'fixed')
    expect(getOneOffLessonConflictsV9(fixed, scope, { ...oneOffDraft(scope),
      time: { mode: 'custom', startTime: '08:50', endTime: '09:00' } })).toEqual([])
    expect(getOneOffLessonConflictsV9(fixed, scope, { ...oneOffDraft(scope),
      time: { mode: 'custom', startTime: '08:45', endTime: '08:55' } })).toMatchObject([{ id: 'fixed' }])
    const boundaries = createOneOffLessonV9(data, scope,
      { ...oneOffDraft(scope), date: '2026-03-01' }, firstId)
    expect(createOneOffLessonV9(boundaries, scope,
      { ...oneOffDraft(scope), date: '2026-06-30' }, secondId).oneOffLessons).toHaveLength(2)

    const extended = { ...data, teachingUnits: data.teachingUnits.map((item) => ({ ...item,
      endDate: '2027-01-31', weekCycle: { enabled: true as const,
        anchorDate: '2026-12-28', anchorPattern: 'A' as const } })) }
    const aWeek = createRecurringLessonV9(extended, scope, { ...draft, weekPattern: 'A' }, 'cross-year')
    expect(getOneOffLessonConflictsV9(aWeek, scope,
      { ...oneOffDraft(scope), date: '2026-12-28' })).toMatchObject([{ id: 'cross-year' }])
    expect(getOneOffLessonConflictsV9(aWeek, scope,
      { ...oneOffDraft(scope), date: '2027-01-04' })).toEqual([])
  })

  it('moves across TeachingUnits in one Project and keeps make-up references deletion-blocking', () => {
    const { data, scope, draft } = lessonFixture()
    const secondUnit = { ...data.teachingUnits[0], id: 'u2', name: '第二學期',
      startDate: '2026-07-01', endDate: '2026-12-31',
      weekCycle: { enabled: true as const, anchorDate: '2026-07-06', anchorPattern: 'A' as const } }
    const multi: AppDataV9 = { ...data, teachingUnits: [...data.teachingUnits, secondUnit],
      teachingUnitSubjects: [...data.teachingUnitSubjects,
        { id: 'r4', projectId: 'p', teachingUnitId: 'u2', subjectId: 'math' }],
      classes: [...data.classes, { id: 'c2', projectId: 'p', teachingUnitId: 'u2', name: '二甲' }] }
    const created = createOneOffLessonV9(multi, scope, oneOffDraft(scope), firstId)
    const targetScope = { ...scope, teachingUnitId: 'u2' }
    const moved = updateOneOffLessonV9(created, targetScope, firstId, {
      ...oneOffDraft(targetScope), classId: 'c2', date: '2026-07-06',
    })
    expect(moved.oneOffLessons).toMatchObject([{ id: firstId, teachingUnitId: 'u2',
      classId: 'c2', date: '2026-07-06' }])

    const fixed = createRecurringLessonV9(data, scope, draft, 'fixed')
    const related = createOneOffLessonV9(fixed, scope, {
      ...oneOffDraft(scope, 'make-up'), date: '2026-03-03', relatedRecurringLessonId: 'fixed',
      time: { mode: 'custom', startTime: '10:00', endTime: '10:45' },
    }, secondId)
    expect(getRecurringLessonV9Impact(related, scope, 'fixed').oneOff).toBe(1)
    expect(() => deleteRecurringLessonV9(related, scope, 'fixed', true))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
  })

  it('uses resolved V9 occupancy, explicit conflict consent, A/B anchors, and timetable isolation', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, { ...draft, weekPattern: 'A' }, 'fixed')
    const oneOff = oneOffDraft(scope)
    expect(getOneOffLessonConflictsV9(fixed, scope, oneOff)).toMatchObject([{ id: 'fixed' }])
    expect(() => createOneOffLessonV9(fixed, scope, oneOff, firstId))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
    const allowed = createOneOffLessonV9(fixed, scope, oneOff, firstId, true)
    expect(resolveV9Day(allowed, scope, fromDateKey(oneOff.date)).every((item) => item.hasConflict)).toBe(true)
    const nextBWeek = { ...oneOff, date: '2026-03-09' }
    expect(getOneOffLessonConflictsV9(fixed, scope, nextBWeek)).toEqual([])
    const cancelled = cancelOccurrenceV9(fixed, scope, 'fixed', '2026-03-02', 'cancel')
    expect(getOneOffLessonConflictsV9(cancelled, scope, oneOff)).toEqual([])
    const moved = moveOccurrenceV9(fixed, scope, 'fixed', '2026-03-02',
      { date: '2026-03-02', periodId: 2 }, 'move')
    expect(getOneOffLessonConflictsV9(moved, scope, oneOff)).toEqual([])
    expect(getOneOffLessonConflictsV9(moved, scope, { ...oneOff,
      time: { mode: 'period', periodId: 2 } })).toMatchObject([{ id: 'fixed', movementRole: 'target' }])
    const otherScope = { ...scope, timetableId: 'other' }
    const other = createRecurringLessonV9(data, otherScope, { ...draft, timetableId: 'other',
      subjectId: 'other-subject' }, 'other-fixed')
    expect(getOneOffLessonConflictsV9(other, scope, oneOff)).toEqual([])
    const withEvent = { ...data, events: [{ id: 'event', projectId: 'p', timetableId: 't',
      teachingUnitId: 'u', ownershipStatus: 'resolved' as const, title: 'event', type: 'meeting' as const,
      date: oneOff.date, startTime: '08:00', endTime: '08:50', color: '#112233' }] }
    expect(getOneOffLessonConflictsV9(withEvent, scope, oneOff)).toEqual([])
  })
})

function hostFixture(initial: AppDataV9, options: { badReceipt?: boolean; reject?: Error;
  currentForUpdate?: AppDataV9; hold?: boolean } = {}) {
  let document = initial
  let revision = 0
  let release: (() => void) | undefined
  const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
    if (options.reject) throw options.reject
    const next = produce(options.currentForUpdate ?? document)
    if (options.hold) await new Promise<void>((resolve) => { release = resolve })
    if (!options.badReceipt) { document = next; revision++ }
    return { raw: options.badReceipt ? '{}' : JSON.stringify(next),
      revision: options.badReceipt ? 7 : revision, attemptId: 'host-attempt' }
  })
  const host = { get document() { return document }, status: 'active' as const, writable: true,
    pending: false, receipt: null, get revision() { return revision }, errorCode: null, update } satisfies FormalV9HostPort
  return { host, update, document: () => document, release: () => release?.() }
}

describe('formal V9 Lesson Host action port', () => {
  it('commits through Host and reports success only with the matching receipt', async () => {
    const { data, scope, draft } = lessonFixture()
    const state = hostFixture(data)
    const actions = createFormalLessonManagementV9Controller(state.host, () => 'l1', scope)
    const result = await actions.createRecurring(draft)
    expect(state.update).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ affectedId: 'l1', receipt: { revision: 1, attemptId: 'host-attempt' } })
    expect(state.document().recurringLessons).toHaveLength(1)
    await expect(actions.createRecurring(draft)).rejects.toMatchObject({ code: 'stale-document' })
    expect(state.update).toHaveBeenCalledOnce()
  })
  it('fails closed on stale selection or revision, receipt mismatch and Host failure', async () => {
    const { data, scope, draft } = lessonFixture()
    const failed = hostFixture(data, { reject: new Error('write failed') })
    await expect(createFormalLessonManagementV9Controller(failed.host, () => 'l1', scope)
      .createRecurring(draft)).rejects.toThrow('write failed')
    expect(failed.document()).toBe(data)
    const bad = hostFixture(data, { badReceipt: true })
    await expect(createFormalLessonManagementV9Controller(bad.host, () => 'l1', scope)
      .createRecurring(draft)).rejects.toMatchObject({ code: 'receipt-mismatch' })
    expect(bad.document()).toBe(data)
    let selected = { ...scope }
    const stale = hostFixture(data)
    const actions = createFormalLessonManagementV9Controller(stale.host, () => 'l1', scope, () => selected)
    selected = { ...scope, timetableId: 'other' }
    await expect(actions.createRecurring(draft)).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(stale.update).not.toHaveBeenCalled()
    const changed = hostFixture(data)
    const old = createFormalLessonManagementV9Controller(changed.host, () => 'l1', scope)
    await createFormalLessonManagementV9Controller(changed.host, () => 'l2', scope)
      .createRecurring({ ...draft, day: 2 })
    await expect(old.createRecurring(draft)).rejects.toMatchObject({ code: 'stale-document' })
  })
  it('rejects duplicate in-flight writes and does not submit blocked destructive actions', async () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const state = hostFixture(fixed, { hold: true })
    const actions = createFormalLessonManagementV9Controller(state.host, () => 'override', scope)
    const pending = actions.cancelOccurrence('l1', '2026-03-02')
    await expect(actions.cancelOccurrence('l1', '2026-03-09')).rejects.toMatchObject({ code: 'duplicate-submit' })
    state.release()
    await pending
    const blocked = hostFixture(fixed)
    const destructive = createFormalLessonManagementV9Controller(blocked.host, () => 'l2', scope)
    await expect(destructive.deleteRecurring('l1', true)).rejects.toMatchObject({ code: 'backup-required' })
    await expect(destructive.permanentlyUpdateFromDate('l1', '2026-03-16', draft))
      .rejects.toMatchObject({ code: 'backup-required' })
    expect(blocked.update).not.toHaveBeenCalled()
  })
  it('fails OneOff writes closed while the Host is readonly or already pending', async () => {
    const { data, scope } = lessonFixture()
    const draft = { ...scope, subjectId: 'math', classId: 'c', date: '2026-03-02', purpose: 'extra' as const,
      time: { mode: 'period' as const, periodId: 1 } }
    const readonly = hostFixture(data)
    const readonlyHost = { ...readonly.host, writable: false } satisfies FormalV9HostPort
    await expect(createFormalLessonManagementV9Controller(readonlyHost,
      () => '11111111-1111-4111-8111-111111111111', scope).createOneOff(draft))
      .rejects.toMatchObject({ code: 'not-writable' })
    expect(readonly.update).not.toHaveBeenCalled()
    const busy = hostFixture(data)
    const busyHost = { ...busy.host, pending: true } satisfies FormalV9HostPort
    await expect(createFormalLessonManagementV9Controller(busyHost,
      () => '11111111-1111-4111-8111-111111111111', scope).createOneOff(draft))
      .rejects.toMatchObject({ code: 'duplicate-submit' })
    expect(busy.update).not.toHaveBeenCalled()
  })
  it('atomically replaces an occurrence change with one Host mutation and matching receipt', async () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    const state = hostFixture(cancelled)
    const actions = createFormalLessonManagementV9Controller(state.host, () => 'move', scope)
    const result = await actions.replaceOccurrenceChange('cancel',
      { action: 'move', target: { date: '2026-03-09', periodId: 2 } })
    expect(state.update).toHaveBeenCalledOnce()
    expect(state.host.revision).toBe(1)
    expect(result).toMatchObject({ affectedId: 'move', receipt: { revision: 1, attemptId: 'host-attempt' } })
    expect(state.document().overrides).toMatchObject([{ id: 'move', originalLessonId: 'l1',
      date: '2026-03-02', action: 'move', target: { date: '2026-03-09', periodId: 2 } }])
    expect(state.document().overrides).toHaveLength(1)
  })
  it('keeps the original change and revision when atomic replacement validation fails', async () => {
    const { data, scope, draft } = lessonFixture()
    const first = createRecurringLessonV9(data, scope, draft, 'l1')
    const fixed = createRecurringLessonV9(first, scope, { ...draft, periodId: 2 }, 'blocker')
    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    const state = hostFixture(cancelled)
    const actions = createFormalLessonManagementV9Controller(state.host, () => 'move', scope)
    await expect(actions.replaceOccurrenceChange('cancel',
      { action: 'move', target: { date: '2026-03-02', periodId: 2 } }))
      .rejects.toMatchObject({ code: 'conflict' })
    expect(state.update).toHaveBeenCalledOnce()
    expect(state.host.revision).toBe(0)
    expect(state.document()).toBe(cancelled)
    expect(state.document().overrides).toMatchObject([{ id: 'cancel' }])
  })
  it('keeps the original override and revision when revoke would restore a conflict', async () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    const occupied: AppDataV9 = { ...cancelled, oneOffLessons: [{ id: 'one-off', projectId: 'p',
      timetableId: 't', teachingUnitId: 'u', subjectId: 'math', classId: 'c', date: '2026-03-02',
      purpose: 'extra', time: { mode: 'period', periodId: 1 } }] }
    const state = hostFixture(occupied)
    await expect(createFormalLessonManagementV9Controller(state.host, () => 'unused', scope)
      .revokeOccurrenceOverride('cancel')).rejects.toMatchObject({ code: 'conflict' })
    expect(state.update).toHaveBeenCalledOnce()
    expect(state.host.revision).toBe(0)
    expect(state.document()).toBe(occupied)
    expect(state.document().overrides).toMatchObject([{ id: 'cancel' }])
  })
  it('protects atomic replacement from duplicate, stale selection and receipt mismatch', async () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    const held = hostFixture(cancelled, { hold: true })
    const heldActions = createFormalLessonManagementV9Controller(held.host,
      () => 'move', scope)
    const pending = heldActions.replaceOccurrenceChange('cancel',
      { action: 'move', target: { date: '2026-03-09', periodId: 2 } })
    await expect(heldActions.replaceOccurrenceChange('cancel', { action: 'cancel' }))
      .rejects.toMatchObject({ code: 'duplicate-submit' })
    held.release()
    await pending
    expect(held.update).toHaveBeenCalledOnce()

    let selected = { ...scope }
    const stale = hostFixture(cancelled)
    const staleActions = createFormalLessonManagementV9Controller(stale.host,
      () => 'move', scope, () => selected)
    selected = { ...scope, timetableId: 'other' }
    await expect(staleActions.replaceOccurrenceChange('cancel',
      { action: 'move', target: { date: '2026-03-09', periodId: 2 } }))
      .rejects.toMatchObject({ code: 'invalid-scope' })
    expect(stale.update).not.toHaveBeenCalled()

    const mismatch = hostFixture(cancelled, { badReceipt: true })
    await expect(createFormalLessonManagementV9Controller(mismatch.host, () => 'move', scope)
      .replaceOccurrenceChange('cancel',
        { action: 'move', target: { date: '2026-03-09', periodId: 2 } }))
      .rejects.toMatchObject({ code: 'receipt-mismatch' })
    expect(mismatch.document()).toBe(cancelled)
    expect(mismatch.host.revision).toBe(0)
  })
  it('requires explicit conflict consent through the Controller action', async () => {
    const { data, scope, draft } = lessonFixture()
    const first = createRecurringLessonV9(data, scope, draft, 'l1')
    const fixed = createRecurringLessonV9(first, scope, { ...draft, periodId: 2 }, 'blocker')
    const rejected = hostFixture(fixed)
    await expect(createFormalLessonManagementV9Controller(rejected.host, () => 'move', scope)
      .moveOccurrence('l1', '2026-03-02', { date: '2026-03-02', periodId: 2 }))
      .rejects.toMatchObject({ code: 'conflict' })
    expect(rejected.host.revision).toBe(0)
    const accepted = hostFixture(fixed)
    const result = await createFormalLessonManagementV9Controller(accepted.host, () => 'move', scope)
      .moveOccurrence('l1', '2026-03-02', { date: '2026-03-02', periodId: 2 }, true)
    expect(result.receipt.revision).toBe(1)
    expect(resolveV9Day(result.document, scope, fromDateKey('2026-03-02'))
      .filter((item) => item.kind !== 'recurring' || item.movementRole !== 'source')
      .every((item) => item.hasConflict)).toBe(true)
  })
  it('commits swap create, replacement and revoke as one ordinary Host update each', async () => {
    const { data, scope } = sameDaySwapFixture()
    const ids = ['swap-group-a', 'swap-first-a', 'swap-second-a']
    const createdHost = hostFixture(data)
    const created = await createFormalLessonManagementV9Controller(createdHost.host,
      () => ids.shift() ?? 'unused', scope).swapOccurrences({
      firstLessonId: 'swap-a', firstDate: '2026-03-02',
      secondLessonId: 'swap-b', secondDate: '2026-03-02',
    })
    expect(createdHost.update).toHaveBeenCalledOnce()
    expect(created).toMatchObject({ affectedId: 'swap-group-a', receipt: {
      revision: 1, attemptId: 'host-attempt' } })
    expect(created.document.overrides).toHaveLength(2)

    const replacementIds = ['swap-group-b', 'swap-first-b', 'swap-second-b']
    const replacementHost = hostFixture(created.document)
    const replaced = await createFormalLessonManagementV9Controller(replacementHost.host,
      () => replacementIds.shift() ?? 'unused', scope).replaceSwapGroup('swap-first-a', {
      firstLessonId: 'swap-a', firstDate: '2026-03-09',
      secondLessonId: 'swap-b', secondDate: '2026-03-09',
    })
    expect(replacementHost.update).toHaveBeenCalledOnce()
    expect(replaced.document.overrides).toHaveLength(2)
    expect(replaced.document.overrides.map((item) => item.groupId))
      .toEqual(['swap-group-b', 'swap-group-b'])

    const revokeHost = hostFixture(replaced.document)
    const revoked = await createFormalLessonManagementV9Controller(revokeHost.host,
      () => 'unused', scope).revokeSwapGroup('swap-second-b')
    expect(revokeHost.update).toHaveBeenCalledOnce()
    expect(revoked.document.overrides).toEqual([])
  })

  it('fails swap closed for readonly, pending, stale selection, duplicate and receipt mismatch', async () => {
    const { data, scope } = sameDaySwapFixture()
    const draft = { firstLessonId: 'swap-a', firstDate: '2026-03-02',
      secondLessonId: 'swap-b', secondDate: '2026-03-02' }
    const readonly = hostFixture(data)
    await expect(createFormalLessonManagementV9Controller({ ...readonly.host, writable: false },
      () => 'unused', scope).swapOccurrences(draft)).rejects.toMatchObject({ code: 'not-writable' })
    expect(readonly.update).not.toHaveBeenCalled()
    const busy = hostFixture(data)
    await expect(createFormalLessonManagementV9Controller({ ...busy.host, pending: true },
      () => 'unused', scope).swapOccurrences(draft)).rejects.toMatchObject({ code: 'duplicate-submit' })
    expect(busy.update).not.toHaveBeenCalled()

    let selected = { ...scope }
    const stale = hostFixture(data)
    const staleActions = createFormalLessonManagementV9Controller(stale.host,
      () => 'unused', scope, () => selected)
    selected = { ...scope, timetableId: 'other' }
    await expect(staleActions.swapOccurrences(draft)).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(stale.update).not.toHaveBeenCalled()

    const held = hostFixture(data, { hold: true })
    const heldIds = ['swap-group', 'swap-first', 'swap-second']
    const heldActions = createFormalLessonManagementV9Controller(held.host,
      () => heldIds.shift() ?? 'unused', scope)
    const pending = heldActions.swapOccurrences(draft)
    await expect(heldActions.swapOccurrences(draft)).rejects.toMatchObject({ code: 'duplicate-submit' })
    held.release()
    await pending
    expect(held.update).toHaveBeenCalledOnce()

    const mismatch = hostFixture(data, { badReceipt: true })
    const mismatchIds = ['swap-group', 'swap-first', 'swap-second']
    await expect(createFormalLessonManagementV9Controller(mismatch.host,
      () => mismatchIds.shift() ?? 'unused', scope).swapOccurrences(draft))
      .rejects.toMatchObject({ code: 'receipt-mismatch' })
    expect(mismatch.document()).toBe(data)
    expect(mismatch.host.revision).toBe(0)
  })
  it('passes validation and transaction-staleness failures through without reporting a receipt', async () => {
    const { data, scope, draft } = lessonFixture()
    const state = hostFixture(data)
    const actions = createFormalLessonManagementV9Controller(state.host, () => 'l1', scope)
    await expect(actions.createRecurring({ ...draft, subjectId: 'other-subject' }))
      .rejects.toMatchObject({ code: 'invalid-reference' })
    expect(state.document()).toBe(data)
    const malformed = { ...data, recurringLessons: [{ ...draft, id: 'broken', seriesId: 'broken',
      effectiveStart: '2026-03-01', subjectId: 'other-subject' }] } as AppDataV9
    const invalid = hostFixture(data, { currentForUpdate: malformed })
    await expect(createFormalLessonManagementV9Controller(invalid.host, () => 'l1', scope)
      .createRecurring(draft)).rejects.toMatchObject({ code: 'stale-document' })
    expect(invalid.document()).toBe(data)
  })
  it('uses the Host pre-backup port for deletion and permanent split, and verifies the bound evidence', async () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const backedHost = (initial: AppDataV9,
      evidenceFault?: 'operation' | 'revision' | 'mutation-attempt') => {
      const base = hostFixture(initial)
      const updateHighRisk = vi.fn(async (produce: (current: AppDataV9) => AppDataV9,
        operation: V9HighRiskOperation) => {
        const rawDocument = JSON.stringify(base.document())
        const revision = base.host.revision
        const receipt = await base.update(produce)
        const mutationAttemptId = `mutation-${receipt.revision}`
        const backupMutationAttemptId = evidenceFault === 'mutation-attempt'
          ? `${mutationAttemptId}-other` : mutationAttemptId
        return { ...receipt, mutationAttemptId,
          preMutationBackup: { key: `${V9_AUTO_BACKUP_PREFIX}${backupMutationAttemptId}`,
            mutationAttemptId: backupMutationAttemptId,
            operation: evidenceFault === 'operation' ? 'permanently-update-lesson' as const : operation,
            revision: evidenceFault === 'revision' ? revision + 1 : revision,
            digest: await fingerprintV7Raw(rawDocument), rawDocument } }
      })
      const host = { ...base.host, get document() { return base.document() },
        get revision() { return base.host.revision }, updateHighRisk } satisfies FormalV9HostPort
      return { base, host, updateHighRisk }
    }
    const deletion = backedHost(fixed)
    const deleted = await createFormalLessonManagementV9Controller(deletion.host, () => 'unused', scope)
      .deleteRecurring('l1', true)
    expect(deleted.document.recurringLessons).toEqual([])
    expect(deleted.receipt.preMutationBackup).toMatchObject({ operation: 'delete-recurring-lesson', revision: 0 })
    expect(deletion.updateHighRisk).toHaveBeenCalledOnce()
    const permanent = backedHost(fixed)
    const split = await createFormalLessonManagementV9Controller(permanent.host, () => 'l2', scope)
      .permanentlyUpdateFromDate('l1', '2026-03-16', { ...draft, subjectId: 'english' })
    expect(split.document.recurringLessons.map((item) => item.id)).toEqual(['l1', 'l2'])
    expect(split.receipt.preMutationBackup?.operation).toBe('permanently-update-lesson')
    const permanentEnd = backedHost(fixed)
    const ended = await createFormalLessonManagementV9Controller(permanentEnd.host, () => 'unused', scope)
      .permanentlyEndFromDate('l1', '2026-03-16')
    expect(ended.document.recurringLessons).toMatchObject([{ id: 'l1', effectiveEnd: '2026-03-15' }])
    expect(ended.receipt.preMutationBackup).toMatchObject({
      operation: 'permanently-end-lesson', revision: 0, mutationAttemptId: 'mutation-1',
    })
    expect(permanentEnd.updateHighRisk).toHaveBeenCalledOnce()
    const swapReady = createRecurringLessonV9(fixed, scope, {
      ...draft, day: 3, periodId: data.teachingUnits[0].periods[1].id, weekPattern: 'B',
    }, 'l2')
    const permanentSwap = backedHost(swapReady)
    const swapIds = ['l1-v2', 'l2-v2']
    const swapped = await createFormalLessonManagementV9Controller(
      permanentSwap.host, () => swapIds.shift() ?? 'unused', scope)
      .permanentlySwapFromDate({ firstLessonId: 'l1', secondLessonId: 'l2', date: '2026-03-04' })
    expect(swapped.document.recurringLessons).toMatchObject([
      { id: 'l1', effectiveEnd: '2026-03-03' },
      { id: 'l1-v2', seriesId: 'l1', day: 3, weekPattern: 'every', effectiveStart: '2026-03-04' },
      { id: 'l2', effectiveEnd: '2026-03-03' },
      { id: 'l2-v2', seriesId: 'l2', day: 1, weekPattern: 'B', effectiveStart: '2026-03-04' },
    ])
    expect(swapped.receipt.preMutationBackup).toMatchObject({
      operation: 'permanently-swap-lessons', revision: 0, mutationAttemptId: 'mutation-1',
    })
    expect(permanentSwap.updateHighRisk).toHaveBeenCalledOnce()
    const oneOff = createOneOffLessonV9(data, scope, {
      ...scope, subjectId: 'math', classId: 'c', date: '2026-03-02', purpose: 'extra',
      time: { mode: 'period', periodId: 2 },
    }, '11111111-1111-4111-8111-111111111111')
    const oneOffDeletion = backedHost(oneOff)
    const removed = await createFormalLessonManagementV9Controller(oneOffDeletion.host, () => 'unused', scope)
      .deleteOneOff('11111111-1111-4111-8111-111111111111', true)
    expect(removed.document.oneOffLessons).toEqual([])
    expect(removed.receipt.preMutationBackup).toMatchObject({ operation: 'delete-one-off-lesson', revision: 0 })
    for (const fault of ['operation', 'revision', 'mutation-attempt'] as const) {
      const mismatch = backedHost(swapReady, fault)
      const mismatchIds = ['l1-v2', 'l2-v2']
      await expect(createFormalLessonManagementV9Controller(
        mismatch.host, () => mismatchIds.shift() ?? 'unused', scope)
        .permanentlySwapFromDate({ firstLessonId: 'l1', secondLessonId: 'l2', date: '2026-03-04' }))
        .rejects.toMatchObject({ code: 'receipt-mismatch' })
    }
  })
  it('rejects a referenced deletion before the Host reaches backup storage', async () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const referenced = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'override')
    const base = hostFixture(referenced)
    const updateHighRisk = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
      produce(base.document())
      throw new Error('must not reach storage')
    })
    const host = { ...base.host, updateHighRisk } satisfies FormalV9HostPort
    await expect(createFormalLessonManagementV9Controller(host, () => 'unused', scope)
      .deleteRecurring('l1', true)).rejects.toMatchObject({ code: 'referenced' })
    expect(updateHighRisk).toHaveBeenCalledOnce()
    expect(base.document()).toBe(referenced)
  })
})

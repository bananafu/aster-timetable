import { describe, expect, it } from 'vitest'
import { fromDateKey } from './date'
import { resolveProjectDay } from './scheduleV4'
import { resolveV9Day, resolveV9DayResult, resolveV9Week, resolveV9WeekResult,
  selectV9HeaderWeekPattern, selectV9HeaderWeekPatternResult,
  selectV9ResolvedEvents, selectV9ResolvedEventsResult,
  type V9ReadScope } from './scheduleV9'
import { isCompatibleAppDataV9 } from '../data/validators/v9'
import type { AppDataV7 } from '../types'
import type { AppDataV9 } from '../types/v9'

const monday = fromDateKey('2026-03-02')
const nextMonday = fromDateKey('2026-03-09')
const scope: V9ReadScope = { projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1' }

function fixture(): AppDataV9 {
  const createdAt = '2026-02-01T00:00:00.000Z'
  const term = { academicYear: 115, semester: 'first' as const }
  const period = (startTime: string, endTime: string) => [{ id: 1, order: 1, label: '第一節', startTime, endTime }]
  return {
    schemaVersion: 9, activeProjectId: 'p1',
    projects: [
      { id: 'p1', name: '甲專案', term, createdAt, updatedAt: createdAt },
      { id: 'p2', name: '乙專案', term, createdAt, updatedAt: createdAt },
    ],
    timetables: [
      { id: 't1', projectId: 'p1', name: '教師甲', teacherName: '甲' },
      { id: 't2', projectId: 'p1', name: '教師乙', teacherName: '乙' },
      { id: 't3', projectId: 'p2', name: '教師丙', teacherName: '丙' },
    ],
    schools: [
      { id: 'school1', projectId: 'p1', name: '一校', color: '#111111' },
      { id: 'school2', projectId: 'p1', name: '二校', color: '#222222' },
      { id: 'school3', projectId: 'p2', name: '三校', color: '#333333' },
    ],
    teachingUnits: [
      { id: 'u1', projectId: 'p1', schoolId: 'school1', name: '一校學期', schoolLevel: 'junior-high',
        startDate: '2026-03-01', endDate: '2026-06-30', timezone: 'Asia/Taipei',
        periods: period('08:00', '08:50'), weekCycle: { enabled: true, anchorDate: '2026-03-02', anchorPattern: 'A' } },
      { id: 'u2', projectId: 'p1', schoolId: 'school2', name: '二校學期', schoolLevel: 'senior-high',
        startDate: '2026-03-01', endDate: '2026-06-30', timezone: 'Asia/Taipei',
        periods: period('08:30', '09:20'), weekCycle: { enabled: true, anchorDate: '2026-03-02', anchorPattern: 'B' } },
      { id: 'u3', projectId: 'p2', schoolId: 'school3', name: '三校學期', schoolLevel: 'junior-high',
        startDate: '2026-03-01', endDate: '2026-06-30', timezone: 'Asia/Taipei',
        periods: period('10:00', '10:50'), weekCycle: { enabled: false, anchorDate: '2026-03-02', anchorPattern: 'A' } },
    ],
    subjects: [
      { id: 'sub1', projectId: 'p1', timetableId: 't1', name: '國文', shortName: '國', color: '#aa0000', applicableSchoolLevels: ['junior-high'] },
      { id: 'sub2', projectId: 'p1', timetableId: 't1', name: '英文', shortName: '英', color: '#00aa00', applicableSchoolLevels: ['senior-high'] },
      { id: 'sub3', projectId: 'p1', timetableId: 't2', name: '數學', shortName: '數', color: '#0000aa', applicableSchoolLevels: ['junior-high'] },
      { id: 'sub4', projectId: 'p2', timetableId: 't3', name: '自然', shortName: '自', color: '#aaaa00', applicableSchoolLevels: ['junior-high'] },
    ],
    teachingUnitSubjects: [
      { id: 'rel1', projectId: 'p1', teachingUnitId: 'u1', subjectId: 'sub1' },
      { id: 'rel2', projectId: 'p1', teachingUnitId: 'u2', subjectId: 'sub2' },
      { id: 'rel3', projectId: 'p1', teachingUnitId: 'u1', subjectId: 'sub3' },
      { id: 'rel4', projectId: 'p2', teachingUnitId: 'u3', subjectId: 'sub4' },
    ],
    classes: [
      { id: 'class1', projectId: 'p1', teachingUnitId: 'u1', name: '七年一班', room: '101' },
      { id: 'class2', projectId: 'p1', teachingUnitId: 'u2', name: '一年一班', room: '201' },
      { id: 'class3', projectId: 'p2', teachingUnitId: 'u3', name: '七年二班' },
    ],
    recurringLessons: [
      { id: 'l1', seriesId: 'series1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1',
        subjectId: 'sub1', classId: 'class1', day: 1, periodId: 1, weekPattern: 'A', effectiveStart: '2026-03-01' },
      { id: 'l2', seriesId: 'series2', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u2',
        subjectId: 'sub2', classId: 'class2', day: 1, periodId: 1, weekPattern: 'B', effectiveStart: '2026-03-01' },
      { id: 'l3', seriesId: 'series3', projectId: 'p1', timetableId: 't2', teachingUnitId: 'u1',
        subjectId: 'sub3', classId: 'class1', day: 1, periodId: 1, weekPattern: 'every', effectiveStart: '2026-03-01' },
      { id: 'l4', seriesId: 'series4', projectId: 'p2', timetableId: 't3', teachingUnitId: 'u3',
        subjectId: 'sub4', classId: 'class3', day: 1, periodId: 1, weekPattern: 'every', effectiveStart: '2026-03-01' },
    ],
    overrides: [], oneOffLessons: [], events: [], teachingProgress: [], migrationWarnings: [],
  }
}

function event(id: string, projectId: string, timetableId: string, teachingUnitId: string,
  type: 'meeting' | 'activity' | 'task' = 'meeting'): AppDataV9['events'][number] {
  return { id, projectId, timetableId, teachingUnitId, ownershipStatus: 'resolved',
    title: id, type, date: '2026-03-02', startTime: '11:00', endTime: '11:50', color: '#abcdef' }
}

describe('V9 native read resolver', () => {
  it('accepts a valid V9 document', () => expect(isCompatibleAppDataV9(fixture())).toBe(true))
  it('resolves only the selected teacher across both schools', () => {
    const rows = resolveV9Day(fixture(), scope, monday)
    expect(rows.map((row) => row.id)).toEqual(['l1', 'l2'])
    expect(rows.map((row) => row.schoolName)).toEqual(['一校', '二校'])
    expect(rows.every((row) => row.kind === 'one-off' || row.movementRole === undefined)).toBe(true)
  })
  it('does not narrow total lessons to the header TeachingUnit', () =>
    expect(resolveV9Day(fixture(), { ...scope, teachingUnitId: 'u2' }, monday).map((row) => row.id)).toEqual(['l1', 'l2']))
  it('keeps another teacher out of the selected timetable', () =>
    expect(resolveV9Day(fixture(), scope, monday).some((row) => row.id === 'l3')).toBe(false))
  it('keeps another Project out of the selected timetable', () =>
    expect(resolveV9Day(fixture(), scope, monday).some((row) => row.id === 'l4')).toBe(false))
  it('can select another teacher without mixing the first', () =>
    expect(resolveV9Day(fixture(), { ...scope, timetableId: 't2' }, monday).map((row) => row.id)).toEqual(['l3']))
  it('can select another Project with its own timetable', () =>
    expect(resolveV9Day(fixture(), { projectId: 'p2', timetableId: 't3', teachingUnitId: 'u3' }, monday)
      .map((row) => row.id)).toEqual(['l4']))
  it.each([
    { projectId: null, timetableId: 't1', teachingUnitId: 'u1' },
    { projectId: 'missing', timetableId: 't1', teachingUnitId: 'u1' },
    { projectId: 'p1', timetableId: null, teachingUnitId: 'u1' },
    { projectId: 'p1', timetableId: 't3', teachingUnitId: 'u1' },
    { projectId: 'p1', timetableId: 't1', teachingUnitId: 'u3' },
  ] satisfies V9ReadScope[])('returns empty for invalid selection %#', (invalid) =>
    expect(resolveV9Day(fixture(), invalid, monday)).toEqual([]))
  it('does not auto-select a timetable when none is supplied', () =>
    expect(resolveV9Day(fixture(), { ...scope, timetableId: null }, monday)).toEqual([]))
  it('distinguishes invalid Project, Timetable, and TeachingUnit scopes', () => {
    expect(resolveV9DayResult(fixture(), { ...scope, projectId: 'missing' }, monday).status).toBe('invalid-scope')
    expect(resolveV9DayResult(fixture(), { ...scope, timetableId: 't3' }, monday).status).toBe('invalid-scope')
    expect(resolveV9DayResult(fixture(), { ...scope, teachingUnitId: 'u3' }, monday).status).toBe('invalid-scope')
  })
  it('returns ready with an empty value for a legal day without lessons', () =>
    expect(resolveV9DayResult(fixture(), scope, fromDateKey('2026-03-07')))
      .toEqual({ status: 'ready', value: [] }))
  it('allows an explicit school filter', () =>
    expect(resolveV9Day(fixture(), scope, monday, { schoolId: 'school2' }).map((row) => row.id)).toEqual(['l2']))
  it('allows an explicit TeachingUnit filter', () =>
    expect(resolveV9Day(fixture(), scope, monday, { teachingUnitId: 'u1' }).map((row) => row.id)).toEqual(['l1']))
  it('rejects a filter from another Project', () =>
    expect(resolveV9Day(fixture(), scope, monday, { schoolId: 'school3' })).toEqual([]))
  it('uses the selected unit for the header A/B pattern', () => {
    expect(selectV9HeaderWeekPattern(fixture(), scope, monday)).toBe('A')
    expect(selectV9HeaderWeekPattern(fixture(), { ...scope, teachingUnitId: 'u2' }, monday)).toBe('B')
  })
  it('flips each unit independently the next week', () => {
    expect(selectV9HeaderWeekPattern(fixture(), scope, nextMonday)).toBe('B')
    expect(selectV9HeaderWeekPattern(fixture(), { ...scope, teachingUnitId: 'u2' }, nextMonday)).toBe('A')
  })
  it('uses each lesson own unit week even when another unit is selected', () => {
    const data = fixture()
    data.recurringLessons[1].weekPattern = 'A'
    expect(resolveV9Day(data, scope, nextMonday).map((row) => row.id)).toEqual(['l2'])
  })
  it('returns null header pattern without an explicit unit', () =>
    expect(selectV9HeaderWeekPattern(fixture(), { ...scope, teachingUnitId: null }, monday)).toBeNull())
  it('distinguishes a ready-null header from an invalid scope', () => {
    expect(selectV9HeaderWeekPatternResult(fixture(), { ...scope, teachingUnitId: null }, monday))
      .toEqual({ status: 'ready', value: null })
    expect(selectV9HeaderWeekPatternResult(fixture(), { ...scope, teachingUnitId: 'u3' }, monday))
      .toEqual({ status: 'invalid-scope', value: null })
  })
  it('returns null for a disabled week cycle', () =>
    expect(selectV9HeaderWeekPattern(fixture(), { projectId: 'p2', timetableId: 't3', teachingUnitId: 'u3' }, monday)).toBeNull())
  it('returns null outside the selected unit date range', () =>
    expect(selectV9HeaderWeekPattern(fixture(), scope, fromDateKey('2026-07-01'))).toBeNull())
  it('respects recurring effective dates and unit boundaries', () => {
    const data = fixture()
    data.recurringLessons[0].effectiveStart = '2026-03-16'
    expect(resolveV9Day(data, scope, monday).map((row) => row.id)).toEqual(['l2'])
    expect(resolveV9Day(data, scope, fromDateKey('2026-07-06'))).toEqual([])
  })
  it('does not create recurring lessons on a weekend', () =>
    expect(resolveV9Day(fixture(), scope, fromDateKey('2026-03-07'))).toEqual([]))
  it('returns empty content for a Project whose term is null', () => {
    const data = fixture()
    data.projects[0].term = null
    data.recurringLessons = data.recurringLessons.filter((item) => item.projectId !== 'p1')
    expect(resolveV9Day(data, scope, monday)).toEqual([])
    expect(selectV9HeaderWeekPattern(data, scope, monday)).toBeNull()
    expect(selectV9ResolvedEvents(data, scope)).toEqual([])
    expect(resolveV9DayResult(data, scope, monday)).toEqual({ status: 'unset-term', value: [] })
    expect(resolveV9WeekResult(data, scope, [monday]).status).toBe('unset-term')
    expect(selectV9HeaderWeekPatternResult(data, scope, monday).status).toBe('unset-term')
    expect(selectV9ResolvedEventsResult(data, scope).status).toBe('unset-term')
  })
  it('classifies a legal term-null Project without a Timetable as unset-term', () => {
    const data = fixture()
    data.projects[0].term = null
    data.timetables = data.timetables.filter((item) => item.projectId !== 'p1')
    data.subjects = data.subjects.filter((item) => item.projectId !== 'p1')
    data.teachingUnitSubjects = data.teachingUnitSubjects.filter((item) => item.projectId !== 'p1')
    data.recurringLessons = data.recurringLessons.filter((item) => item.projectId !== 'p1')
    expect(isCompatibleAppDataV9(data)).toBe(true)
    expect(resolveV9DayResult(data, { projectId: 'p1', timetableId: null, teachingUnitId: null }, monday))
      .toEqual({ status: 'unset-term', value: [] })
  })
  it('reports real cross-school time conflicts', () =>
    expect(resolveV9Day(fixture(), scope, monday).map((row) => row.hasConflict)).toEqual([true, true]))
  it('sorts by actual start time instead of period number or unit selection', () => {
    const data = fixture()
    data.teachingUnits[0].periods[0].startTime = '09:30'
    data.teachingUnits[0].periods[0].endTime = '10:20'
    expect(resolveV9Day(data, scope, monday).map((row) => row.id)).toEqual(['l2', 'l1'])
  })
  it('does not count a cancelled lesson as a live conflict', () => {
    const data = fixture()
    data.overrides.push({ id: 'o1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1',
      date: '2026-03-02', periodId: 1, action: 'cancel', originalLessonId: 'l1' })
    const rows = resolveV9Day(data, scope, monday)
    expect(rows.map((row) => row.kind === 'recurring' && row.status)).toEqual(['cancelled', 'regular'])
    expect(rows.map((row) => row.hasConflict)).toEqual([false, false])
  })
  it('resolves a replacement using the selected teacher Subject and Class', () => {
    const data = fixture()
    data.subjects.push({ id: 'sub1b', projectId: 'p1', timetableId: 't1', name: '歷史', shortName: '史',
      color: '#123456', applicableSchoolLevels: ['junior-high'] })
    data.teachingUnitSubjects.push({ id: 'rel1b', projectId: 'p1', teachingUnitId: 'u1', subjectId: 'sub1b' })
    data.classes.push({ id: 'class1b', projectId: 'p1', teachingUnitId: 'u1', name: '七年三班' })
    data.overrides.push({ id: 'o1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1',
      date: '2026-03-02', periodId: 1, action: 'replace', originalLessonId: 'l1',
      replacement: { subjectId: 'sub1b', classId: 'class1b', room: '301' } })
    const row = resolveV9Day(data, scope, monday).find((item) => item.id === 'l1')
    expect(row).toMatchObject({ status: 'replaced', subjectName: '歷史', className: '七年三班', room: '301' })
  })
  it('moves a source occurrence without duplicating it', () => {
    const data = fixture()
    data.overrides.push({ id: 'o1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1',
      date: '2026-03-02', periodId: 1, action: 'move', originalLessonId: 'l1',
      target: { date: '2026-03-03', periodId: 1 } })
    const sourceDay = resolveV9Day(data, scope, monday)
    expect(sourceDay.map((row) => row.id)).toEqual(['l1', 'l2'])
    expect(sourceDay[0]).toMatchObject({ id: 'l1', status: 'moved', movementRole: 'source',
      sourceDate: '2026-03-02', date: '2026-03-02', periodId: 1,
      startTime: '08:00', endTime: '08:50', overrideId: 'o1', hasConflict: false })
    expect(resolveV9Day(data, scope, fromDateKey('2026-03-03'))).toMatchObject([
      { id: 'l1', status: 'moved', movementRole: 'target', sourceDate: '2026-03-02',
        date: '2026-03-03', periodId: 1, startTime: '08:00', endTime: '08:50', overrideId: 'o1' },
    ])
  })
  it('shows source and target for a same-day move and only target participates in conflicts', () => {
    const data = fixture()
    data.teachingUnits[0].periods.push({ id: 2, order: 2, label: '第二節', startTime: '09:00', endTime: '09:50' })
    data.overrides.push({ id: 'o1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1',
      date: '2026-03-02', periodId: 1, action: 'move', originalLessonId: 'l1',
      target: { date: '2026-03-02', periodId: 2 } })
    const rows = resolveV9Day(data, scope, monday)
    const moved = rows.filter((row) => row.id === 'l1')
    expect(moved).toMatchObject([
      { movementRole: 'source', date: '2026-03-02', sourceDate: '2026-03-02', periodId: 1,
        startTime: '08:00', endTime: '08:50', hasConflict: false },
      { movementRole: 'target', date: '2026-03-02', sourceDate: '2026-03-02', periodId: 2,
        startTime: '09:00', endTime: '09:50', hasConflict: true },
    ])
    expect(rows.find((row) => row.id === 'l2')).toMatchObject({ hasConflict: true })
    expect(moved.filter((row) => row.kind === 'recurring' && row.movementRole === 'target')).toHaveLength(1)
    expect(new Set(moved.map((row) => row.occurrenceId)).size).toBe(2)
  })
  it('can move an A-week source into a B-week target date', () => {
    const data = fixture()
    data.overrides.push({ id: 'o1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1',
      date: '2026-03-02', periodId: 1, action: 'move', originalLessonId: 'l1',
      target: { date: '2026-03-09', periodId: 1 } })
    expect(resolveV9Day(data, scope, monday).find((row) => row.id === 'l1')).toMatchObject({
      movementRole: 'source', sourceDate: '2026-03-02', date: '2026-03-02',
    })
    expect(resolveV9Day(data, scope, nextMonday)).toMatchObject([
      { id: 'l1', movementRole: 'target', sourceDate: '2026-03-02', date: '2026-03-09' },
    ])
  })
  it('resolves both members of a grouped cross-school swap independently', () => {
    const data = fixture()
    data.overrides.push(
      { id: 'o1', groupId: 'g1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1',
        date: '2026-03-02', periodId: 1, action: 'move', originalLessonId: 'l1', target: { date: '2026-03-03', periodId: 1 } },
      { id: 'o2', groupId: 'g1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u2',
        date: '2026-03-02', periodId: 1, action: 'move', originalLessonId: 'l2', target: { date: '2026-03-03', periodId: 1 } },
    )
    expect(resolveV9Day(data, scope, monday).map((row) =>
      [row.id, row.kind === 'recurring' ? row.movementRole : null,
        row.kind === 'recurring' ? row.groupId : null]))
      .toEqual([['l1', 'source', 'g1'], ['l2', 'source', 'g1']])
    expect(resolveV9Day(data, scope, fromDateKey('2026-03-03')).map((row) =>
      [row.id, row.kind === 'recurring' ? row.movementRole : null,
        row.kind === 'recurring' ? row.groupId : null]))
      .toEqual([['l1', 'target', 'g1'], ['l2', 'target', 'g1']])
  })
  it('does not leak move overrides from another Project or Timetable', () => {
    const data = fixture()
    data.overrides.push(
      { id: 'other-teacher-move', projectId: 'p1', timetableId: 't2', teachingUnitId: 'u1',
        date: '2026-03-02', periodId: 1, action: 'move', originalLessonId: 'l3',
        target: { date: '2026-03-03', periodId: 1 } },
      { id: 'other-project-move', projectId: 'p2', timetableId: 't3', teachingUnitId: 'u3',
        date: '2026-03-02', periodId: 1, action: 'move', originalLessonId: 'l4',
        target: { date: '2026-03-03', periodId: 1 } },
    )
    expect(resolveV9Day(data, scope, fromDateKey('2026-03-03'))).toEqual([])
  })
  it('shows a period based one-off lesson', () => {
    const data = fixture()
    data.oneOffLessons.push({ id: 'once1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1',
      classId: 'class1', subjectId: 'sub1', date: '2026-03-03', purpose: 'extra', time: { mode: 'period', periodId: 1 } })
    expect(resolveV9Day(data, scope, fromDateKey('2026-03-03'))).toMatchObject([
      { kind: 'one-off', id: 'once1', timeMode: 'period', startTime: '08:00', endTime: '08:50' },
    ])
  })
  it('shows a custom-time one-off without inventing a period', () => {
    const data = fixture()
    data.oneOffLessons.push({ id: 'once1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1',
      classId: 'class1', subjectId: 'sub1', date: '2026-03-03', purpose: 'make-up',
      relatedRecurringLessonId: 'l1', time: { mode: 'custom', startTime: '09:00', endTime: '09:40' } })
    const row = resolveV9Day(data, scope, fromDateKey('2026-03-03'))[0]
    expect(row).toMatchObject({ kind: 'one-off', timeMode: 'custom', purpose: 'make-up', relatedRecurringLessonId: 'l1' })
    expect(row).not.toHaveProperty('periodId')
  })
  it('does not flag touching half-open time intervals as conflict', () => {
    const data = fixture()
    data.oneOffLessons.push({ id: 'once1', projectId: 'p1', timetableId: 't1', teachingUnitId: 'u1',
      classId: 'class1', subjectId: 'sub1', date: '2026-03-02', purpose: 'extra',
      time: { mode: 'custom', startTime: '08:50', endTime: '09:30' } })
    expect(resolveV9Day(data, scope, monday, { teachingUnitId: 'u1' }).map((row) => row.hasConflict)).toEqual([false, false])
  })
  it('returns resolved meetings and activities for only this teacher', () => {
    const data = fixture()
    data.events.push(event('meeting1', 'p1', 't1', 'u1'), event('activity1', 'p1', 't1', 'u2', 'activity'),
      event('otherTeacher', 'p1', 't2', 'u1'), event('otherProject', 'p2', 't3', 'u3'))
    expect(selectV9ResolvedEvents(data, scope).map((item) => item.id)).toEqual(['meeting1', 'activity1'])
  })
  it('does not show unresolved events or tasks', () => {
    const data = fixture()
    data.events.push(event('task1', 'p1', 't1', 'u1', 'task'), {
      id: 'unresolved1', projectId: 'p1', teachingUnitId: 'u1', ownershipStatus: 'unresolved',
      ownershipIssue: { reason: 'ambiguous-timetable', candidateTimetableIds: ['t1', 't2'] },
      title: '未確認', type: 'meeting', date: '2026-03-02', startTime: '11:00', endTime: '11:50', color: '#abcdef',
    })
    expect(isCompatibleAppDataV9(data)).toBe(true)
    expect(selectV9ResolvedEvents(data, scope)).toEqual([])
  })
  it('returns ready for a legal empty Event selection', () =>
    expect(selectV9ResolvedEventsResult(fixture(), scope)).toEqual({ status: 'ready', value: [] }))
  it('filters resolved events by exact date', () => {
    const data = fixture()
    data.events.push(event('meeting1', 'p1', 't1', 'u1'))
    expect(selectV9ResolvedEvents(data, scope, '2026-03-03')).toEqual([])
    expect(selectV9ResolvedEvents(data, scope, '2026-03-02')).toHaveLength(1)
  })
  it('keeps resolved events outside the TeachingUnit date range', () => {
    const data = fixture()
    const outside = event('meeting1', 'p1', 't1', 'u1')
    outside.date = '2026-07-01'
    data.events.push(outside)
    expect(selectV9ResolvedEvents(data, scope, '2026-07-01').map((item) => item.id)).toEqual(['meeting1'])
  })
  it('does not infer event ownership from the selected unit', () => {
    const data = fixture()
    data.events.push(event('meeting1', 'p1', 't1', 'u2'))
    expect(selectV9ResolvedEvents(data, scope).map((item) => item.id)).toEqual(['meeting1'])
  })
  it('returns safe empty content for a malformed ownership link', () => {
    const data = fixture()
    data.recurringLessons[0].subjectId = 'sub3'
    expect(isCompatibleAppDataV9(data)).toBe(false)
    expect(resolveV9DayResult(data, scope, monday)).toEqual({ status: 'invalid-document', value: [] })
    expect(selectV9ResolvedEventsResult(data, scope)).toEqual({ status: 'invalid-document', value: [] })
    expect(resolveV9Day(data, scope, monday)).toEqual([])
  })
  it('distinguishes a ready-empty week from an invalid document', () => {
    const dates = [fromDateKey('2026-03-07')]
    expect(resolveV9WeekResult(fixture(), scope, dates)).toMatchObject({
      status: 'ready', value: [{ lessons: [] }],
    })
    const invalid = fixture()
    invalid.recurringLessons[0].subjectId = 'sub3'
    expect(resolveV9WeekResult(invalid, scope, dates)).toMatchObject({
      status: 'invalid-document', value: [{ lessons: [] }],
    })
  })
  it('keeps all convenience functions compatible with their Result values', () => {
    const data = fixture()
    const dates = [monday, fromDateKey('2026-03-03')]
    expect(resolveV9Day(data, scope, monday)).toEqual(resolveV9DayResult(data, scope, monday).value)
    expect(resolveV9Week(data, scope, dates)).toEqual(resolveV9WeekResult(data, scope, dates).value)
    expect(selectV9ResolvedEvents(data, scope)).toEqual(selectV9ResolvedEventsResult(data, scope).value)
    expect(selectV9HeaderWeekPattern(data, scope, monday))
      .toBe(selectV9HeaderWeekPatternResult(data, scope, monday).value)
  })
  it('does not leak lessons or Events through any non-ready Result API', () => {
    const data = fixture()
    data.recurringLessons[0].subjectId = 'sub3'
    expect(resolveV9DayResult(data, scope, monday).value).toEqual([])
    expect(resolveV9WeekResult(data, scope, [monday]).value[0].lessons).toEqual([])
    expect(selectV9ResolvedEventsResult(data, scope).value).toEqual([])
    expect(selectV9HeaderWeekPatternResult(data, scope, monday).value).toBeNull()
  })
  it('resolves a week without changing its input dates', () => {
    const data = fixture()
    const dates = [monday, fromDateKey('2026-03-03')]
    const result = resolveV9Week(data, scope, dates)
    expect(result.map((day) => day.lessons.length)).toEqual([2, 0])
    expect(dates.map((day) => day.getDate())).toEqual([2, 3])
  })
  it('is deterministic and leaves the V9 document untouched', () => {
    const data = fixture()
    const before = JSON.stringify(data)
    const first = resolveV9Day(data, scope, monday)
    const firstResult = resolveV9DayResult(data, scope, monday)
    expect(resolveV9Day(data, scope, monday)).toEqual(first)
    expect(resolveV9DayResult(data, scope, monday)).toEqual(firstResult)
    expect(JSON.stringify(data)).toBe(before)
  })
  it('leaves the independent V7 resolver semantics intact', () => {
    const v7: AppDataV7 = { schemaVersion: 7, activeProjectId: 'p1',
      projects: [{ id: 'p1', name: '原有專案', term: { academicYear: 115, semester: 'first' },
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      timetables: [{ id: 't1', projectId: 'p1', name: '教師', teacherName: '甲' }],
      schools: [], teachingUnits: [], subjects: [], classes: [], recurringLessons: [], events: [],
      overrides: [], oneOffLessons: [], migrationWarnings: [] }
    expect(resolveProjectDay(v7, 'p1', monday)).toEqual([])
  })
})

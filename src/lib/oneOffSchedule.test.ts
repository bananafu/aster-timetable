import { describe, expect, it } from 'vitest'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { cancelLessonOnDate, moveLessonOnDate, replaceLessonOnDate } from '../data/lessonChangesV4'
import { createLessonDragIntent } from './lessonDrag'
import { addDays, fromDateKey } from './date'
import { getMoveTargetConflicts, getTeachingUnitWeekPattern, getTodayTeachingSummaryV4, resolveProjectDay, resolveProjectWeek } from './scheduleV4'
import type { AppDataV7, OneOffLesson } from '../types'

const fixture = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
const day = (data: AppDataV7, date: string, filters: { timetableId?: string; schoolId?: string; teachingUnitId?: string } = {}) =>
  resolveProjectDay(data, data.projects[0].id, fromDateKey(date), { timetableId: data.timetables[0].id, ...filters })
const oneOff = (data: AppDataV7, id: string, date: string, time: OneOffLesson['time'] = { mode: 'custom', startTime: '09:30', endTime: '11:00' }): OneOffLesson => ({
  id, projectId: data.projects[0].id, timetableId: data.timetables[0].id,
  teachingUnitId: data.teachingUnits[0].id, classId: data.classes[0].id,
  subjectId: data.subjects[0].id, date, purpose: 'extra', time,
})

describe('v7 read-only one-off schedule resolution', () => {
  it('resolves Sunday custom time without inventing a series, period or override', () => {
    const data = fixture()
    data.oneOffLessons.push(oneOff(data, 'extra-sunday', '2026-09-06'))
    const before = structuredClone(data)
    const [item] = day(data, '2026-09-06')
    expect(item).toMatchObject({ kind: 'one-off', id: 'extra-sunday', timeMode: 'custom', purpose: 'extra', startTime: '09:30', endTime: '11:00' })
    expect(item).not.toHaveProperty('seriesId')
    expect(item).not.toHaveProperty('periodId')
    expect(item).not.toHaveProperty('overrideId')
    expect(item?.occurrenceKey).toContain('one-off')
    expect(day(data, '2026-09-07').some((lesson) => lesson.id === 'extra-sunday')).toBe(false)
    expect(data).toEqual(before)
  })

  it('resolves Saturday period time from its teaching unit and preserves purpose and optional source information', () => {
    const data = fixture()
    const sourceId = data.recurringLessons[0].id
    data.oneOffLessons.push({ ...oneOff(data, 'make-up', '2026-09-05', { mode: 'period', periodId: 3 }), purpose: 'make-up', relatedRecurringLessonId: sourceId })
    const [item] = day(data, '2026-09-05')
    expect(item).toMatchObject({ kind: 'one-off', purpose: 'make-up', relatedRecurringLessonId: sourceId,
      periodId: 3, periodLabel: '第 3 節', startTime: '10:10', endTime: '11:00', timeMode: 'period' })
    data.recurringLessons = data.recurringLessons.filter((lesson) => lesson.id !== sourceId)
    expect(day(data, '2026-09-05')[0].id).toBe('make-up')
  })

  it('uses distinct kind-tagged identity even if an invalid import reuses a recurring ID, and distinguishes dates', () => {
    const data = fixture()
    const recurringId = data.recurringLessons[0].id
    data.oneOffLessons.push(oneOff(data, recurringId, '2026-09-07', { mode: 'period', periodId: 1 }))
    const monday = day(data, '2026-09-07').filter((item) => item.id === recurringId)
    expect(monday).toHaveLength(2)
    expect(new Set(monday.map((item) => item.occurrenceKey)).size).toBe(2)
    expect(monday.every((item) => item.hasConflict)).toBe(true)
    const nextMonday = day(data, '2026-09-14').find((item) => item.kind === 'recurring' && item.id === recurringId)
    expect(nextMonday?.occurrenceKey).not.toBe(monday.find((item) => item.kind === 'recurring')?.occurrenceKey)
  })

  it('isolates timetable, project, school and teaching-unit filters', () => {
    const data = fixture()
    const first = oneOff(data, 'extra-a', '2026-09-08')
    const secondUnit = { ...data.teachingUnits[0], id: 'unit-b', schoolId: 'school-b', name: '高中部', schoolLevel: 'senior-high' as const }
    data.schools.push({ ...data.schools[0], id: 'school-b', name: '乙校' })
    data.teachingUnits.push(secondUnit)
    data.classes.push({ ...data.classes[0], id: 'class-b', teachingUnitId: secondUnit.id })
    data.timetables.push({ ...data.timetables[0], id: 'teacher-b', name: 'B 課表' })
    data.projects.push({ ...data.projects[0], id: 'other-project', name: '其他專案' })
    data.timetables.push({ ...data.timetables[0], id: 'other-project-timetable', projectId: 'other-project' })
    data.oneOffLessons.push(first,
      { ...first, id: 'extra-b', teachingUnitId: secondUnit.id, classId: 'class-b' },
      { ...first, id: 'extra-other-timetable', timetableId: 'teacher-b' })
    expect(day(data, '2026-09-08').filter((item) => item.kind === 'one-off').map((item) => item.id).sort()).toEqual(['extra-a', 'extra-b'])
    expect(day(data, '2026-09-08', { schoolId: 'school-b' }).map((item) => item.id)).toEqual(['extra-b'])
    expect(day(data, '2026-09-08', { teachingUnitId: secondUnit.id }).map((item) => item.id)).toEqual(['extra-b'])
    expect(day(data, '2026-09-08', { timetableId: 'teacher-b' }).filter((item) => item.kind === 'one-off').map((item) => item.id)).toEqual(['extra-other-timetable'])
    expect(day(data, '2026-09-08', { timetableId: 'teacher-b' })[0].hasConflict).toBe(false)
    expect(resolveProjectDay(data, 'other-project', fromDateKey('2026-09-08'), { timetableId: 'other-project-timetable' })).toEqual([])
  })

  it('finds conflicts across teaching units on the same timetable, but not adjacent half-open intervals', () => {
    const data = fixture()
    data.oneOffLessons.push(oneOff(data, 'first', '2026-09-06', { mode: 'custom', startTime: '09:30', endTime: '10:00' }))
    data.oneOffLessons.push(oneOff(data, 'adjacent', '2026-09-06', { mode: 'custom', startTime: '10:00', endTime: '10:45' }))
    expect(day(data, '2026-09-06').map((item) => [item.id, item.hasConflict])).toEqual([['first', false], ['adjacent', false]])
    data.oneOffLessons.push(oneOff(data, 'overlap', '2026-09-06', { mode: 'custom', startTime: '09:55', endTime: '10:05' }))
    expect(day(data, '2026-09-06').map((item) => [item.id, item.hasConflict])).toEqual([['first', true], ['overlap', true], ['adjacent', true]])
  })

  it('compares real times across schools and teaching units without mixing their period IDs', () => {
    const data = fixture()
    const secondUnit = { ...data.teachingUnits[0], id: 'unit-other', schoolId: 'school-other',
      periods: [{ id: 91, order: 1, label: '高中第一節', startTime: '08:40', endTime: '09:30' }] }
    data.schools.push({ ...data.schools[0], id: 'school-other', name: '乙校' })
    data.teachingUnits.push(secondUnit)
    data.classes.push({ ...data.classes[0], id: 'class-other', teachingUnitId: secondUnit.id })
    data.oneOffLessons.push({ ...oneOff(data, 'cross-school', '2026-09-07', { mode: 'period', periodId: 91 }),
      teachingUnitId: secondUnit.id, classId: 'class-other' })
    const both = day(data, '2026-09-07')
    expect(both.find((item) => item.id === 'cross-school')).toMatchObject({ startTime: '08:40', endTime: '09:30', hasConflict: true })
    expect(both.find((item) => item.id === 'c1')?.hasConflict).toBe(true)
    expect(day(data, '2026-09-07', { schoolId: 'school-other' }).map((item) => item.id)).toEqual(['cross-school'])
    expect(day(data, '2026-09-07', { schoolId: data.schools[0].id }).find((item) => item.id === 'c1')?.hasConflict).toBe(false)
  })

  it('makes drag preview and actual move agree about one-off occupancy', () => {
    const data = fixture()
    data.oneOffLessons.push(oneOff(data, 'extra-target', '2026-09-07', { mode: 'period', periodId: 8 }))
    const source = day(data, '2026-09-07').find((item) => item.kind === 'recurring' && item.id === 'c1')!
    const target = { date: '2026-09-07', startTime: '16:10', endTime: '17:00', timetableId: data.timetables[0].id }
    expect(getMoveTargetConflicts(data, source, target).map((item) => item.id)).toEqual(['extra-target'])
    expect(createLessonDragIntent(data, source, target)).toMatchObject({ valid: true, intent: { conflictLessonIds: ['extra-target'] } })
    expect(() => moveLessonOnDate(data, 'c1', '2026-09-07', { date: target.date, periodId: 8 }, false, () => 'blocked', target.timetableId)).toThrow('occupied')
    const moved = moveLessonOnDate(data, 'c1', '2026-09-07', { date: target.date, periodId: 8 }, true, () => 'allowed', target.timetableId)
    expect(day(moved as AppDataV7, target.date).filter((item) => ['c1', 'extra-target'].includes(item.id)).every((item) => item.hasConflict)).toBe(true)
    expect(data.overrides).toHaveLength(0)
  })

  it('keeps a same-day source out of collisions but detects its next-week occurrence', () => {
    const data = fixture()
    data.oneOffLessons.push(oneOff(data, 'extra-next-week', '2026-09-14', { mode: 'period', periodId: 1 }))
    const source = day(data, '2026-09-07').find((item) => item.kind === 'recurring' && item.id === 'c1')!
    expect(getMoveTargetConflicts(data, source, { date: '2026-09-07', startTime: '08:10', endTime: '09:00' })).toEqual([])
    expect(getMoveTargetConflicts(data, source, { date: '2026-09-14', startTime: '08:10', endTime: '09:00' }).map((item) => item.id).sort()).toEqual(['c1', 'extra-next-week'])
  })

  it('does not let recurring overrides cancel, replace or move a one-off', () => {
    const data = fixture()
    data.oneOffLessons.push(oneOff(data, 'independent', '2026-09-07', { mode: 'period', periodId: 1 }))
    const cancelled = cancelLessonOnDate(data, 'c1', '2026-09-07', () => 'cancel', data.timetables[0].id) as AppDataV7
    expect(day(cancelled, '2026-09-07').find((item) => item.id === 'c1')?.status).toBe('cancelled')
    expect(day(cancelled, '2026-09-07').find((item) => item.id === 'independent')).toMatchObject({ kind: 'one-off', hasConflict: false })
    const replaced = replaceLessonOnDate(data, 'c1', '2026-09-07', { subjectId: data.subjects[1].id, classId: data.classes[0].id }, () => 'replace', undefined, data.timetables[0].id) as AppDataV7
    expect(day(replaced, '2026-09-07').find((item) => item.id === 'independent')?.subjectId).toBe(data.subjects[0].id)
    const moved = moveLessonOnDate(data, 'c1', '2026-09-07', { date: '2026-09-08', periodId: 1 }, true, () => 'move', data.timetables[0].id) as AppDataV7
    expect(day(moved, '2026-09-07').map((item) => item.id)).toContain('independent')
    expect(day(moved, '2026-09-08').find((item) => item.id === 'c1')).toMatchObject({ kind: 'recurring', status: 'moved', sourceDate: '2026-09-07' })
    expect(createLessonDragIntent(data, day(data, '2026-09-07').find((item) => item.id === 'independent')!,
      { date: '2026-09-08', startTime: '08:10', endTime: '09:00', timetableId: data.timetables[0].id })).toMatchObject({ valid: false })
    expect(() => getMoveTargetConflicts(data, day(data, '2026-09-07').find((item) => item.id === 'independent')!,
      { date: '2026-09-08', startTime: '08:10', endTime: '09:00' })).toThrow('Only recurring occurrences')
  })

  it('includes one-offs across month and year boundaries without altering Monday-based A/B weeks', () => {
    const data = fixture()
    for (const date of ['2026-09-06', '2026-12-31', '2027-01-01', '2027-01-03']) data.oneOffLessons.push(oneOff(data, `extra-${date}`, date))
    const week = resolveProjectWeek(data, data.projects[0].id,
      Array.from({ length: 7 }, (_, index) => addDays(fromDateKey('2026-12-27'), index)), { timetableId: data.timetables[0].id })
    expect(week.map((item) => item.date.getDay())).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(week[4].lessons.map((item) => item.id)).toContain('extra-2026-12-31')
    expect(week[5].lessons.map((item) => item.id)).toContain('extra-2027-01-01')
    expect(day(data, '2027-01-03').map((item) => item.id)).toContain('extra-2027-01-03')
    expect(getTeachingUnitWeekPattern(fromDateKey('2026-09-06'), data.teachingUnits[0])).toBe(getTeachingUnitWeekPattern(fromDateKey('2026-09-01'), data.teachingUnits[0]))
    expect(getTeachingUnitWeekPattern(fromDateKey('2026-09-07'), data.teachingUnits[0])).not.toBe(getTeachingUnitWeekPattern(fromDateKey('2026-09-06'), data.teachingUnits[0]))
  })

  it('includes one-offs in the read-only today summary and archived history', () => {
    const data = fixture()
    data.oneOffLessons.push(oneOff(data, 'substitute', '2026-09-06'))
    data.oneOffLessons[0].purpose = 'substitute'
    const now = new Date(2026, 8, 6, 10, 0)
    expect(getTodayTeachingSummaryV4(data, data.projects[0].id, now, data.timetables[0].id)).toMatchObject({ count: 1, state: 'current', lesson: { id: 'substitute', kind: 'one-off' } })
    data.projects[0].archivedAt = '2027-02-01T00:00:00.000Z'
    data.activeProjectId = null
    expect(day(data, '2026-09-06').map((item) => item.id)).toEqual(['substitute'])
  })

  it('keeps v4-v6 resolution unchanged when one-off data is absent', () => {
    const data = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))
    const monday = resolveProjectDay(data, data.projects[0].id, fromDateKey('2026-09-07'), { timetableId: data.timetables[0].id })
    expect(monday.every((item) => item.kind === 'recurring')).toBe(true)
    expect(monday.find((item) => item.id === 'c1')).toMatchObject({ sourceDate: '2026-09-07', status: 'regular' })
  })
})

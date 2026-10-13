import { describe, expect, it } from 'vitest'
import { resolveProjectDay, timeIntervalsOverlap } from './scheduleV4'
import type { AppDataV4, TeachingUnit } from '../types'

const period = (id: number, label: string, startTime: string, endTime: string, order = id) => ({ id, order, label, startTime, endTime })

function fixture(): AppDataV4 {
  const unitA: TeachingUnit = {
    id: 'unit-a', projectId: 'project-a', schoolId: 'school-a', name: '國中部', schoolLevel: 'junior-high',
    startDate: '2026-09-01', endDate: '2027-01-31', timezone: 'Asia/Taipei',
    periods: [period(1, '第一節', '08:10', '08:55')],
    weekCycle: { enabled: true, anchorDate: '2026-09-09', anchorPattern: 'A' },
  }
  const unitB: TeachingUnit = {
    id: 'unit-b', projectId: 'project-a', schoolId: 'school-b', name: '高中部', schoolLevel: 'senior-high',
    startDate: '2026-09-07', endDate: '2027-01-20', timezone: 'Asia/Taipei',
    periods: [period(91, '第一節', '08:40', '09:30')],
    weekCycle: { enabled: true, anchorDate: '2026-09-07', anchorPattern: 'B' },
  }
  return {
    schemaVersion: 4,
    activeProjectId: 'project-a',
    projects: [
      { id: 'project-a', name: '跨校課表', term: { academicYear: 115, semester: 'first' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'project-b', name: '其他專案', term: { academicYear: 115, semester: 'first' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    schools: [
      { id: 'school-a', projectId: 'project-a', name: '甲校', color: '#A5A051' },
      { id: 'school-b', projectId: 'project-a', name: '乙校', color: '#563F2E' },
      { id: 'school-c', projectId: 'project-b', name: '丙校', color: '#445566' },
    ],
    teachingUnits: [unitA, unitB, { ...unitA, id: 'unit-c', projectId: 'project-b', schoolId: 'school-c' }],
    subjects: [
      { id: 'subject-a', name: '國文', shortName: '國', color: '#D9C6A5' },
      { id: 'subject-b', name: '英文', shortName: '英', color: '#B8CBD0' },
    ],
    classes: [
      { id: 'class-a', projectId: 'project-a', teachingUnitId: 'unit-a', name: '七年一班' },
      { id: 'class-b', projectId: 'project-a', teachingUnitId: 'unit-b', name: '高一甲' },
      { id: 'class-c', projectId: 'project-b', teachingUnitId: 'unit-c', name: '其他班' },
    ],
    recurringLessons: [
      { id: 'lesson-a', seriesId: 'series-a', projectId: 'project-a', teachingUnitId: 'unit-a', subjectId: 'subject-a', classId: 'class-a', day: 1, periodId: 1, weekPattern: 'A', effectiveStart: '2026-09-01' },
      { id: 'lesson-b', seriesId: 'series-b', projectId: 'project-a', teachingUnitId: 'unit-b', subjectId: 'subject-b', classId: 'class-b', day: 1, periodId: 91, weekPattern: 'B', effectiveStart: '2026-09-07' },
      { id: 'lesson-c', seriesId: 'series-c', projectId: 'project-b', teachingUnitId: 'unit-c', subjectId: 'subject-a', classId: 'class-c', day: 1, periodId: 1, weekPattern: 'A', effectiveStart: '2026-09-01' },
    ],
    events: [],
    overrides: [],
    migrationWarnings: [],
  }
}

describe('v4 multi-school schedule resolver', () => {
  it('resolves each unit date range, A/B anchor and its own period IDs independently', () => {
    const data = fixture()
    const firstWeek = resolveProjectDay(data, 'project-a', new Date(2026, 8, 7))
    expect(firstWeek.map((item) => item.id)).toEqual(['lesson-a', 'lesson-b'])
    expect(firstWeek.map((item) => [item.periodId, item.startTime])).toEqual([[1, '08:10'], [91, '08:40']])

    const nextWeek = resolveProjectDay(data, 'project-a', new Date(2026, 8, 14))
    expect(nextWeek).toEqual([])
    expect(resolveProjectDay(data, 'project-a', new Date(2027, 0, 25)).map((item) => item.id)).toEqual(['lesson-a'])
  })

  it('uses half-open actual time ranges and keeps both conflicting lessons visible', () => {
    const data = fixture()
    const lessons = resolveProjectDay(data, 'project-a', new Date(2026, 8, 7))
    expect(lessons).toHaveLength(2)
    expect(lessons.every((item) => item.hasConflict)).toBe(true)
    expect(timeIntervalsOverlap({ startTime: '08:00', endTime: '08:50' }, { startTime: '08:50', endTime: '09:40' })).toBe(false)
  })

  it('preserves cancel and replacement effects while excluding unassigned overrides', () => {
    const data = fixture()
    data.overrides = [
      { id: 'cancel-a', projectId: 'project-a', teachingUnitId: 'unit-a', date: '2026-09-07', periodId: 1, action: 'cancel', originalLessonId: 'lesson-a' },
      { id: 'replace-b', projectId: 'project-a', teachingUnitId: 'unit-b', date: '2026-09-07', periodId: 91, action: 'replace', originalLessonId: 'lesson-b', replacement: { subjectId: 'subject-a', classId: 'class-b', room: 'R201' } },
      { id: 'unassigned', projectId: null, teachingUnitId: null, date: '2026-09-07', periodId: 91, action: 'cancel' },
    ]
    const lessons = resolveProjectDay(data, 'project-a', new Date(2026, 8, 7))
    expect(lessons.find((item) => item.id === 'lesson-a')?.status).toBe('cancelled')
    expect(lessons.find((item) => item.id === 'lesson-b')).toMatchObject({ status: 'replaced', subjectName: '國文', room: 'R201' })
  })

  it('does not apply an override without an original lesson to an ambiguous slot', () => {
    const data = fixture()
    data.recurringLessons.push({ ...data.recurringLessons[0], id: 'lesson-a-conflict', seriesId: 'series-a-conflict' })
    data.overrides = [{ id: 'ambiguous', projectId: 'project-a', teachingUnitId: 'unit-a', date: '2026-09-07', periodId: 1, action: 'cancel' }]
    const lessons = resolveProjectDay(data, 'project-a', new Date(2026, 8, 7)).filter((item) => item.teachingUnitId === 'unit-a')
    expect(lessons).toHaveLength(2)
    expect(lessons.every((item) => item.status === 'regular')).toBe(true)
  })

  it('isolates projects and supports school and teaching-unit filters', () => {
    const data = fixture()
    expect(resolveProjectDay(data, 'project-b', new Date(2026, 8, 7)).map((item) => item.id)).toEqual(['lesson-c'])
    expect(resolveProjectDay(data, 'project-a', new Date(2026, 8, 7), { schoolId: 'school-a' }).map((item) => item.id)).toEqual(['lesson-a'])
    expect(resolveProjectDay(data, 'project-a', new Date(2026, 8, 7), { teachingUnitId: 'unit-b' }).map((item) => item.id)).toEqual(['lesson-b'])
  })

  it('selects only the effective lesson version for the viewed date', () => {
    const data = fixture()
    data.recurringLessons[0].effectiveEnd = '2026-09-13'
    data.recurringLessons.push({ ...data.recurringLessons[0], id: 'lesson-a-v2', subjectId: 'subject-b', effectiveStart: '2026-09-14', effectiveEnd: undefined })
    expect(resolveProjectDay(data, 'project-a', new Date(2026, 8, 7)).filter((item) => item.seriesId === 'series-a').map((item) => item.id)).toEqual(['lesson-a'])
    expect(resolveProjectDay(data, 'project-a', new Date(2026, 8, 21)).filter((item) => item.seriesId === 'series-a').map((item) => item.id)).toEqual(['lesson-a-v2'])
  })
})

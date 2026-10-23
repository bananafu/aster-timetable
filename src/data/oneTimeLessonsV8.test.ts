import { describe, expect, it } from 'vitest'
import { addDays, fromDateKey, toDateKey } from '../lib/date'
import { getTeachingUnitWeekPattern } from '../lib/scheduleV4'
import { createEmptyAppDataV8 } from './storageV8'
import { createBlankProject } from './projectRuntimeV8'
import { createSubject, configureSubjectForTeachingUnit } from './subjectsV8'
import { createClassV8 } from './classesV8'
import { createTeacherTimetableV8 } from './timetablesV8'
import { createRecurringLessonV8 } from './recurringLessonsV8'
import { cancelLessonOnceV8, createExtraLessonV8, deleteExtraLessonV8, listOneTimeLessonsV8,
  moveLessonOnceV8, resolveEffectiveLessonsV8, revokeOneTimeChangeV8 } from './oneTimeLessonsV8'
import { isCompatibleAppDataV8 } from './validators/v8'

const extraId = '123e4567-e89b-42d3-a456-426614174030'
const extraId2 = '123e4567-e89b-42d3-a456-426614174031'

function fixture() {
  let id = 0
  let data = createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `base-${++id}`)
  const projectId = data.activeProjectId!
  const unit = data.teachingUnits[0]
  data = createSubject(data, projectId, { name: '數學', shortName: '數', color: '#123456',
    applicableSchoolLevels: ['senior-high'] }, 'subject-a')
  data = createClassV8(data, projectId, { teachingUnitId: unit.id, name: '一甲' }, 'class-a')
  data = configureSubjectForTeachingUnit(data, projectId, unit.id, 'subject-a', 'relation-a')
  data = createTeacherTimetableV8(data, projectId, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV8(data, projectId, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  data = createRecurringLessonV8(data, { projectId, timetableId: 'teacher-a', teachingUnitId: unit.id,
    classId: 'class-a', subjectId: 'subject-a', day: 1, periodId: unit.periods[0].id,
    weekPattern: 'every' }, 'lesson-a')
  const extra = { projectId, timetableId: 'teacher-a', teachingUnitId: unit.id,
    classId: 'class-a', subjectId: 'subject-a', date: '2026-09-08',
    time: { mode: 'period' as const, periodId: unit.periods[0].id } }
  return { data, projectId, unit, extra }
}

describe('V8 one-time Lesson changes and extras', () => {
  it('moves only one real occurrence, traces it without duplicate, and allows cross-A/B target', () => {
    const { data, projectId, unit } = fixture()
    const moved = moveLessonOnceV8(data, projectId, 'teacher-a', 'lesson-a', '2026-09-07',
      { date: '2026-09-15', periodId: unit.periods[0].id }, 'move-a')
    expect(isCompatibleAppDataV8(moved)).toBe(true)
    expect(moved.recurringLessons).toEqual(data.recurringLessons)
    expect(moved.overrides[0]).toMatchObject({ action: 'move', originalLessonId: 'lesson-a',
      date: '2026-09-07', target: { date: '2026-09-15' } })
    expect(resolveEffectiveLessonsV8(moved, projectId, 'teacher-a', '2026-09-07')).toEqual([])
    expect(resolveEffectiveLessonsV8(moved, projectId, 'teacher-a', '2026-09-15'))
      .toMatchObject([{ kind: 'recurring', status: 'moved', sourceDate: '2026-09-07' }])
    expect(resolveEffectiveLessonsV8(moved, projectId, 'teacher-a', '2026-09-14')).toHaveLength(1)
    expect(getTeachingUnitWeekPattern(fromDateKey('2026-09-07'), unit))
      .not.toBe(getTeachingUnitWeekPattern(fromDateKey('2026-09-15'), unit))
    expect(() => moveLessonOnceV8(moved, projectId, 'teacher-a', 'lesson-a', '2026-09-07',
      { date: '2026-09-16', periodId: unit.periods[0].id }, 'again')).toThrow()
    expect(() => moveLessonOnceV8(data, projectId, 'teacher-b', 'lesson-a', '2026-09-07',
      { date: '2026-09-15', periodId: unit.periods[0].id }, 'wrong-teacher')).toThrow()
  })

  it('rejects nonexistent weekday/A-B occurrences and term boundaries', () => {
    const { data, projectId, unit } = fixture()
    expect(() => cancelLessonOnceV8(data, projectId, 'teacher-a', 'lesson-a', '2026-09-08', 'bad')).toThrow()
    expect(() => cancelLessonOnceV8(data, projectId, 'teacher-a', 'lesson-a', '2026-07-27', 'bad')).toThrow()
    expect(() => moveLessonOnceV8(data, projectId, 'teacher-a', 'lesson-a', '2026-09-07',
      { date: '2027-02-01', periodId: unit.periods[0].id }, 'bad')).toThrow()
    expect(() => moveLessonOnceV8(data, projectId, 'teacher-a', 'lesson-a', '2026-09-07',
      { date: '2026-09-07', periodId: unit.periods[0].id }, 'no-op')).toThrow()
    const a = createRecurringLessonV8(data, { projectId, timetableId: 'teacher-a',
      teachingUnitId: unit.id, classId: 'class-a', subjectId: 'subject-a', day: 2,
      periodId: unit.periods[0].id, weekPattern: 'A' }, 'lesson-A')
    const first = fromDateKey('2026-08-04')
    const wrong = getTeachingUnitWeekPattern(first, unit) === 'A' ? addDays(first, 7) : first
    expect(() => cancelLessonOnceV8(a, projectId, 'teacher-a', 'lesson-A', toDateKey(wrong), 'bad')).toThrow()
    expect(() => resolveEffectiveLessonsV8(data, projectId, 'teacher-a', '2026-02-30')).toThrow()
  })

  it('cancels a single occurrence without deleting recurring Lesson and releases its time', () => {
    const { data, projectId, unit } = fixture()
    const cancelled = cancelLessonOnceV8(data, projectId, 'teacher-a', 'lesson-a', '2026-09-07', 'cancel-a')
    expect(cancelled.recurringLessons).toEqual(data.recurringLessons)
    expect(resolveEffectiveLessonsV8(cancelled, projectId, 'teacher-a', '2026-09-07')).toEqual([])
    expect(resolveEffectiveLessonsV8(cancelled, projectId, 'teacher-a', '2026-09-14')).toHaveLength(1)
    const freed = createExtraLessonV8(cancelled, { ...fixture().extra, date: '2026-09-07',
      time: { mode: 'period', periodId: unit.periods[0].id } }, extraId)
    expect(resolveEffectiveLessonsV8(freed, projectId, 'teacher-a', '2026-09-07'))
      .toMatchObject([{ kind: 'one-off', id: extraId }])
    expect(() => revokeOneTimeChangeV8(freed, projectId, 'teacher-a', 'cancel-a')).toThrow()
    expect(revokeOneTimeChangeV8(cancelled, projectId, 'teacher-a', 'cancel-a').overrides).toEqual([])
  })

  it('creates an independent extra, validates scope and safely deletes only that extra', () => {
    const { data, projectId, extra } = fixture()
    const created = createExtraLessonV8(data, extra, extraId)
    expect(created.oneOffLessons[0]).toMatchObject({ purpose: 'extra', projectId,
      timetableId: 'teacher-a' })
    expect(created.oneOffLessons[0].relatedRecurringLessonId).toBeUndefined()
    expect(created.recurringLessons).toEqual(data.recurringLessons)
    expect(resolveEffectiveLessonsV8(created, projectId, 'teacher-a', extra.date)).toHaveLength(1)
    expect(resolveEffectiveLessonsV8(created, projectId, 'teacher-b', extra.date)).toEqual([])
    expect(listOneTimeLessonsV8(created, projectId, 'teacher-b').extras).toEqual([])
    for (const change of [{ projectId: 'other' }, { timetableId: 'other' }, { teachingUnitId: 'other' },
      { classId: 'other' }, { subjectId: 'other' }, { date: '2027-02-01' }]) {
      expect(() => createExtraLessonV8(data, { ...extra, ...change }, extraId)).toThrow()
    }
    expect(() => deleteExtraLessonV8(created, projectId, 'teacher-b', extraId)).toThrow()
    expect(deleteExtraLessonV8(created, projectId, 'teacher-a', extraId).oneOffLessons).toEqual([])
  })

  it('checks actual effective time against recurring, moved and extra Lessons', () => {
    const { data, projectId, unit, extra } = fixture()
    const mondayExtra = { ...extra, date: '2026-09-07' }
    expect(() => createExtraLessonV8(data, mondayExtra, extraId)).toThrow()
    const withExtra = createExtraLessonV8(data, extra, extraId)
    expect(() => createExtraLessonV8(withExtra, extra, extraId2)).toThrow()
    expect(() => moveLessonOnceV8(withExtra, projectId, 'teacher-a', 'lesson-a', '2026-09-07',
      { date: extra.date, periodId: unit.periods[0].id }, 'blocked')).toThrow()
    const moved = moveLessonOnceV8(data, projectId, 'teacher-a', 'lesson-a', '2026-09-07',
      { date: '2026-09-08', periodId: unit.periods[0].id }, 'move-a')
    expect(() => createExtraLessonV8(moved, extra, extraId)).toThrow()
    expect(createExtraLessonV8(moved, mondayExtra, extraId).oneOffLessons).toHaveLength(1)
    expect(() => moveLessonOnceV8(data, projectId, 'teacher-a', 'lesson-a', '2026-09-07',
      { date: '2026-09-14', periodId: unit.periods[0].id }, 'fixed-conflict')).toThrow()
  })

  it('detects two moves into the same target and preserves source dates across year boundary', () => {
    const { data, projectId, unit } = fixture()
    const withSecond = createRecurringLessonV8(data, { projectId, timetableId: 'teacher-a',
      teachingUnitId: unit.id, classId: 'class-a', subjectId: 'subject-a', day: 2,
      periodId: unit.periods[0].id, weekPattern: 'every' }, 'lesson-b')
    const first = moveLessonOnceV8(withSecond, projectId, 'teacher-a', 'lesson-a', '2026-12-28',
      { date: '2027-01-06', periodId: unit.periods[0].id }, 'move-a')
    expect(() => moveLessonOnceV8(first, projectId, 'teacher-a', 'lesson-b', '2026-12-29',
      { date: '2027-01-06', periodId: unit.periods[0].id }, 'move-b')).toThrow()
    expect(resolveEffectiveLessonsV8(first, projectId, 'teacher-a', '2026-12-28')).toEqual([])
    expect(resolveEffectiveLessonsV8(first, projectId, 'teacher-a', '2027-01-06'))
      .toMatchObject([{ status: 'moved', sourceDate: '2026-12-28' }])
  })

  it('respects TeachingUnit anchors, actual cross-unit time and separate teachers', () => {
    const { data, projectId, unit, extra } = fixture()
    const unitB = { ...unit, id: 'unit-b', name: '乙單位',
      weekCycle: { ...unit.weekCycle, anchorPattern: 'B' as const },
      periods: unit.periods.map((period) => ({ ...period, id: period.id + 100 })) }
    let cross = { ...data, teachingUnits: [...data.teachingUnits, unitB] }
    cross = createClassV8(cross, projectId, { teachingUnitId: unitB.id, name: '一乙' }, 'class-b')
    cross = configureSubjectForTeachingUnit(cross, projectId, unitB.id, 'subject-a', 'relation-b')
    cross = createRecurringLessonV8(cross, { projectId, timetableId: 'teacher-a', teachingUnitId: unitB.id,
      classId: 'class-b', subjectId: 'subject-a', day: 2, periodId: unitB.periods[0].id,
      weekPattern: 'A' }, 'lesson-b')
    const firstTuesday = fromDateKey('2026-09-08')
    const validTuesday = getTeachingUnitWeekPattern(firstTuesday, unitB) === 'A'
      ? firstTuesday : addDays(firstTuesday, 7)
    const date = toDateKey(validTuesday)
    expect(resolveEffectiveLessonsV8(cross, projectId, 'teacher-a', date)).toHaveLength(1)
    expect(() => createExtraLessonV8(cross, { ...extra, teachingUnitId: unitB.id,
      classId: 'class-b', date, time: { mode: 'period', periodId: unitB.periods[0].id } }, extraId)).toThrow()
    expect(() => createExtraLessonV8(cross, { ...extra, date,
      time: { mode: 'custom', startTime: unitB.periods[0].startTime,
        endTime: unitB.periods[0].endTime } }, extraId)).toThrow()
    expect(createExtraLessonV8(cross, { ...extra, timetableId: 'teacher-b', teachingUnitId: unitB.id,
      classId: 'class-b', date, time: { mode: 'period', periodId: unitB.periods[0].id } }, extraId)
      .oneOffLessons).toHaveLength(1)
    expect(isCompatibleAppDataV8(cross)).toBe(true)
  })
})

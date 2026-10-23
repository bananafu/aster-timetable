import { describe, expect, it } from 'vitest'
import { addDays, fromDateKey } from '../lib/date'
import { getTeachingUnitWeekPattern } from '../lib/scheduleV4'
import { createEmptyAppDataV8 } from './storageV8'
import { createBlankProject } from './projectRuntimeV8'
import { createSubject, configureSubjectForTeachingUnit } from './subjectsV8'
import { createClassV8 } from './classesV8'
import { createTeacherTimetableV8 } from './timetablesV8'
import { createRecurringLessonV8, deleteRecurringLessonV8, getRecurringLessonV8Impact,
  listRecurringLessonsV8, recurringLessonAppliesV8, updateRecurringLessonV8,
  type RecurringLessonV8Draft } from './recurringLessonsV8'
import { isCompatibleAppDataV8 } from './validators/v8'

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
  const draft: RecurringLessonV8Draft = { projectId, timetableId: 'teacher-a', teachingUnitId: unit.id,
    classId: 'class-a', subjectId: 'subject-a', day: 1, periodId: unit.periods[0].id, weekPattern: 'every' }
  return { data, draft, unit }
}

describe('V8 recurring lessons', () => {
  it('creates, edits and deletes only the selected teacher Lesson with full validation', () => {
    const { data, draft } = fixture()
    expect(data.recurringLessons).toEqual([])
    const created = createRecurringLessonV8(data, draft, 'lesson-a')
    expect(isCompatibleAppDataV8(created)).toBe(true)
    expect(listRecurringLessonsV8(created, draft.projectId, 'teacher-a')).toHaveLength(1)
    expect(listRecurringLessonsV8(created, draft.projectId, 'teacher-b')).toEqual([])
    const edited = updateRecurringLessonV8(created, draft.projectId, 'teacher-a', 'lesson-a', { ...draft, room: '301' })
    expect(edited.recurringLessons[0]).toMatchObject({ id: 'lesson-a', seriesId: 'lesson-a', room: '301' })
    expect(() => updateRecurringLessonV8(created, draft.projectId, 'teacher-b', 'lesson-a', draft)).toThrow()
    expect(deleteRecurringLessonV8(edited, draft.projectId, 'teacher-a', 'lesson-a', true).recurringLessons).toEqual([])
    expect(data.recurringLessons).toEqual([])
  })

  it('rejects invalid Project, Timetable, Class, Subject and configuration scope', () => {
    const { data, draft } = fixture()
    for (const changed of [{ projectId: 'other' }, { timetableId: 'other' }, { classId: 'other' },
      { subjectId: 'other' }, { teachingUnitId: 'other' }]) {
      expect(() => createRecurringLessonV8(data, { ...draft, ...changed }, 'bad')).toThrow()
    }
    const withoutRelation = { ...data, teachingUnitSubjects: [] }
    expect(() => createRecurringLessonV8(withoutRelation, draft, 'bad')).toThrow()
  })

  it('uses existing A/B anchors across months and years and respects term boundaries', () => {
    const { data, draft, unit } = fixture()
    const weekly = createRecurringLessonV8(data, draft, 'weekly')
    const a = createRecurringLessonV8(weekly, { ...draft, day: 2, weekPattern: 'A' }, 'a-week')
    const all = createRecurringLessonV8(a, { ...draft, day: 2, weekPattern: 'B' }, 'b-week')
    const firstMonday = fromDateKey('2026-08-03')
    for (let week = 0; week < 26; week++) {
      const monday = addDays(firstMonday, week * 7)
      const tuesday = addDays(monday, 1)
      const pattern = getTeachingUnitWeekPattern(tuesday, unit)
      expect(recurringLessonAppliesV8(all, all.recurringLessons[0], monday)).toBe(true)
      expect(recurringLessonAppliesV8(all, all.recurringLessons[1], tuesday)).toBe(pattern === 'A')
      expect(recurringLessonAppliesV8(all, all.recurringLessons[2], tuesday)).toBe(pattern === 'B')
      if (week > 0) expect(pattern).not.toBe(getTeachingUnitWeekPattern(addDays(tuesday, -7), unit))
    }
    expect(recurringLessonAppliesV8(all, all.recurringLessons[0], fromDateKey('2026-07-27'))).toBe(false)
    expect(recurringLessonAppliesV8(all, all.recurringLessons[0], fromDateKey('2027-02-01'))).toBe(false)
  })

  it('enforces the six week-pattern conflict combinations and excludes self on edit', () => {
    for (const first of ['every', 'A', 'B'] as const) for (const second of ['every', 'A', 'B'] as const) {
      const { data, draft } = fixture()
      const withFirst = createRecurringLessonV8(data, { ...draft, weekPattern: first }, 'first')
      const shouldConflict = first === 'every' || second === 'every' || first === second
      if (shouldConflict) expect(() => createRecurringLessonV8(withFirst, { ...draft, weekPattern: second }, 'second')).toThrow()
      else expect(createRecurringLessonV8(withFirst, { ...draft, weekPattern: second }, 'second').recurringLessons).toHaveLength(2)
      expect(updateRecurringLessonV8(withFirst, draft.projectId, 'teacher-a', 'first',
        { ...draft, weekPattern: first, room: '301' }).recurringLessons).toHaveLength(1)
      expect(createRecurringLessonV8(withFirst, { ...draft, timetableId: 'teacher-b', weekPattern: second },
        'other-teacher').recurringLessons).toHaveLength(2)
    }
  })

  it('compares actual time across TeachingUnits and blocks references on delete', () => {
    const { data, draft, unit } = fixture()
    const otherUnit = { ...unit, id: 'unit-b', name: '第二單位', periods: unit.periods.map((period) => ({ ...period,
      id: period.id + 100 })) }
    let cross = { ...data, teachingUnits: [...data.teachingUnits, otherUnit] }
    cross = createClassV8(cross, draft.projectId, { teachingUnitId: otherUnit.id, name: '一乙' }, 'class-b')
    cross = configureSubjectForTeachingUnit(cross, draft.projectId, otherUnit.id, draft.subjectId, 'relation-b')
    cross = createRecurringLessonV8(cross, draft, 'lesson-a')
    const otherDraft = { ...draft, teachingUnitId: otherUnit.id, classId: 'class-b', periodId: otherUnit.periods[0].id }
    expect(() => createRecurringLessonV8(cross, otherDraft, 'conflict')).toThrow()
    expect(createRecurringLessonV8(cross, { ...otherDraft, timetableId: 'teacher-b' }, 'other-teacher').recurringLessons).toHaveLength(2)
    const linked = { ...cross, oneOffLessons: [{ id: 'linked', projectId: draft.projectId,
      timetableId: draft.timetableId!, teachingUnitId: draft.teachingUnitId, classId: draft.classId,
      subjectId: draft.subjectId, date: '2026-09-01', purpose: 'make-up' as const,
      relatedRecurringLessonId: 'lesson-a', time: { mode: 'period' as const, periodId: draft.periodId } }] }
    expect(isCompatibleAppDataV8(linked)).toBe(true)
    expect(getRecurringLessonV8Impact(linked, draft.projectId, 'teacher-a', 'lesson-a').oneOff).toBe(1)
    expect(() => deleteRecurringLessonV8(linked, draft.projectId, 'teacher-a', 'lesson-a', true)).toThrow()
  })

  it('uses each TeachingUnit anchor when deciding cross-unit A/B overlap', () => {
    const { data, draft, unit } = fixture()
    const otherUnit = { ...unit, id: 'unit-opposite', name: '反向錨點單位',
      weekCycle: { ...unit.weekCycle, anchorPattern: 'B' as const } }
    let cross = { ...data, teachingUnits: [...data.teachingUnits, otherUnit] }
    cross = createClassV8(cross, draft.projectId, { teachingUnitId: otherUnit.id, name: '一乙' }, 'class-opposite')
    cross = configureSubjectForTeachingUnit(cross, draft.projectId, otherUnit.id, draft.subjectId, 'relation-opposite')
    cross = createRecurringLessonV8(cross, { ...draft, weekPattern: 'A' }, 'first-a')
    const other = { ...draft, teachingUnitId: otherUnit.id, classId: 'class-opposite' }
    expect(createRecurringLessonV8(cross, { ...other, weekPattern: 'A' }, 'other-a').recurringLessons).toHaveLength(2)
    expect(() => createRecurringLessonV8(cross, { ...other, weekPattern: 'B' }, 'other-b')).toThrow()
  })

  it('protects dated changes and same-scope progress, including structural edits', () => {
    const { data, draft } = fixture()
    const created = createRecurringLessonV8(data, draft, 'lesson-a')
    const withChange = { ...created, overrides: [{ id: 'change-a', projectId: draft.projectId,
      timetableId: draft.timetableId, teachingUnitId: draft.teachingUnitId, date: '2026-09-07',
      periodId: draft.periodId, action: 'cancel' as const, originalLessonId: 'lesson-a' }] }
    expect(isCompatibleAppDataV8(withChange)).toBe(true)
    expect(() => deleteRecurringLessonV8(withChange, draft.projectId, 'teacher-a', 'lesson-a', true)).toThrow()
    expect(() => updateRecurringLessonV8(withChange, draft.projectId, 'teacher-a', 'lesson-a',
      { ...draft, day: 2 })).toThrow()
    const withProgress = { ...created, teachingProgress: [{ id: '123e4567-e89b-42d3-a456-426614174022',
      projectId: draft.projectId, timetableId: draft.timetableId!, teachingUnitId: draft.teachingUnitId,
      classId: draft.classId, subjectId: draft.subjectId,
      content: { chapter: '一', unit: '', note: '' }, previousProgress: null,
      createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z' }] }
    expect(isCompatibleAppDataV8(withProgress)).toBe(true)
    expect(() => deleteRecurringLessonV8(withProgress, draft.projectId, 'teacher-a', 'lesson-a', true)).toThrow()
  })
})

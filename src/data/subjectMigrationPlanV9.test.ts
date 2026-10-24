import { describe, expect, it } from 'vitest'
import type { AppDataV8 } from '../types'
import { createEmptyAppDataV8 } from './storageV8'
import { createBlankProject } from './projectRuntimeV8'
import { createTeacherTimetableV8 } from './timetablesV8'
import { createSubject, configureSubjectForTeachingUnit } from './subjectsV8'
import { createClassV8 } from './classesV8'
import { createRecurringLessonV8 } from './recurringLessonsV8'
import { inspectSubjectMigrationV9 } from './subjectMigrationPlanV9'
import { isCompatibleAppDataV8 } from './validators/v8'

function fixture(configured = true) {
  let id = 0
  let data = createBlankProject(createEmptyAppDataV8(), { name: 'Project', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `base-${++id}`)
  const projectId = data.activeProjectId!
  const unit = data.teachingUnits[0]
  data = createTeacherTimetableV8(data, projectId, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV8(data, projectId, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  data = createSubject(data, projectId, { name: '數學', shortName: '數', color: '#123456',
    applicableSchoolLevels: ['senior-high', 'junior-high'] }, 'subject-a')
  data = createClassV8(data, projectId, { teachingUnitId: unit.id, name: '一甲' }, 'class-a')
  if (configured) data = configureSubjectForTeachingUnit(data, projectId, unit.id, 'subject-a', 'relation-a')
  return { data, projectId, unit }
}

function lesson(data: AppDataV8, timetableId: string, teachingUnitId: string,
  classId: string, id: string, day: 1 | 2 = 1): AppDataV8 {
  const unit = data.teachingUnits.find((item) => item.id === teachingUnitId)!
  return createRecurringLessonV8(data, { projectId: data.activeProjectId!, timetableId,
    teachingUnitId, classId, subjectId: 'subject-a', day,
    periodId: unit.periods[0].id, weekPattern: 'every' }, id)
}

const entry = (data: AppDataV8) => inspectSubjectMigrationV9(data).entries[0]

describe('read-only V8 Subject migration inspection', () => {
  it('classifies an unreferenced Subject without guessing an owner', () => {
    const { data } = fixture(false)
    expect(isCompatibleAppDataV8(data)).toBe(true)
    expect(entry(data)).toMatchObject({ classification: 'unreferenced', autoAssignable: false,
      requiresSubjectCopy: false, requiresUserDecision: true,
      possibleTargetTimetableIds: ['teacher-a', 'teacher-b'],
      issues: [{ code: 'unassigned-owner' }] })
  })

  it('classifies a configuration-only Subject as undecidable even with valid relation', () => {
    const { data } = fixture()
    expect(entry(data)).toMatchObject({ classification: 'configuration-only', autoAssignable: false,
      referenceCounts: { 'teaching-unit-subject': 1 }, issues: [{ code: 'configuration-only' }] })
  })

  it('finds one Timetable from direct Lesson references and stays pure', () => {
    const { data, unit } = fixture()
    const withLesson = lesson(data, 'teacher-a', unit.id, 'class-a', 'lesson-a')
    const before = JSON.stringify(withLesson)
    const result = inspectSubjectMigrationV9(withLesson)
    expect(result.sourceCompatibleV8).toBe(true)
    expect(result.canAutoAssignAll).toBe(true)
    expect(result.entries[0]).toMatchObject({ classification: 'single-timetable',
      possibleTargetTimetableIds: ['teacher-a'], autoAssignable: true,
      referenceCounts: { lesson: 1, 'teaching-unit-subject': 1 } })
    expect(JSON.stringify(withLesson)).toBe(before)
  })

  it('plans a separate Subject per teacher when Lessons share the old Subject ID', () => {
    const { data, unit } = fixture()
    const first = lesson(data, 'teacher-a', unit.id, 'class-a', 'lesson-a')
    const both = lesson(first, 'teacher-b', unit.id, 'class-a', 'lesson-b')
    expect(isCompatibleAppDataV8(both)).toBe(true)
    expect(entry(both)).toMatchObject({ classification: 'multiple-timetables',
      possibleTargetTimetableIds: ['teacher-a', 'teacher-b'], requiresSubjectCopy: true,
      requiresUserDecision: true, issues: [{ code: 'multiple-owners' }] })
  })

  it('keeps one owner when a Subject is used across two TeachingUnits', () => {
    const { data, projectId, unit } = fixture()
    const junior = { ...unit, id: 'junior-unit', name: '國中部', schoolLevel: 'junior-high' as const }
    let cross = { ...data, teachingUnits: [...data.teachingUnits, junior] }
    cross = createClassV8(cross, projectId, { teachingUnitId: junior.id, name: '七甲' }, 'junior-class')
    cross = configureSubjectForTeachingUnit(cross, projectId, junior.id, 'subject-a', 'relation-junior')
    cross = lesson(cross, 'teacher-a', unit.id, 'class-a', 'lesson-senior')
    cross = lesson(cross, 'teacher-a', junior.id, 'junior-class', 'lesson-junior', 2)
    expect(isCompatibleAppDataV8(cross)).toBe(true)
    expect(entry(cross)).toMatchObject({ classification: 'cross-teaching-units',
      possibleTargetTimetableIds: ['teacher-a'], autoAssignable: true,
      referenceCounts: { lesson: 2, 'teaching-unit-subject': 2 } })
  })

  it('scans OneOff, Change replacement, Progress, and configuration references', () => {
    const { data, projectId, unit } = fixture()
    const withLesson = lesson(data, 'teacher-a', unit.id, 'class-a', 'lesson-a')
    const withOthers: AppDataV8 = { ...withLesson,
      oneOffLessons: [{ id: 'one-off-a', projectId, timetableId: 'teacher-a', teachingUnitId: unit.id,
        classId: 'class-a', subjectId: 'subject-a', date: '2026-09-08', purpose: 'extra',
        time: { mode: 'period', periodId: unit.periods[0].id } }],
      overrides: [{ id: 'change-a', projectId, timetableId: 'teacher-a', teachingUnitId: unit.id,
        date: '2026-09-07', periodId: unit.periods[0].id, action: 'replace',
        originalLessonId: 'lesson-a', replacement: { subjectId: 'subject-a', classId: 'class-a' } }],
      teachingProgress: [{ id: '123e4567-e89b-42d3-a456-426614174022', projectId,
        timetableId: 'teacher-a', teachingUnitId: unit.id, classId: 'class-a', subjectId: 'subject-a',
        content: { chapter: '一', unit: '', note: '' }, previousProgress: null,
        createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z' }] }
    expect(isCompatibleAppDataV8(withOthers)).toBe(true)
    expect(entry(withOthers).referenceCounts).toEqual({ lesson: 1, 'one-off': 1,
      'change-replacement': 1, progress: 1, 'teaching-unit-subject': 1 })
    expect(entry(withOthers).autoAssignable).toBe(true)
  })

  it('reports malformed or ambiguous references instead of assigning by guess', () => {
    const { data, unit } = fixture()
    const withLesson = lesson(data, 'teacher-a', unit.id, 'class-a', 'lesson-a')
    const broken: AppDataV8 = { ...withLesson, recurringLessons: [
      { ...withLesson.recurringLessons[0], timetableId: 'missing-timetable' },
    ], teachingUnitSubjects: [{ ...withLesson.teachingUnitSubjects[0], teachingUnitId: 'missing-unit' }] }
    const plan = inspectSubjectMigrationV9(broken)
    expect(plan.sourceCompatibleV8).toBe(false)
    expect(plan.entries[0].classification).toBe('invalid-or-ambiguous')
    expect(plan.entries[0].autoAssignable).toBe(false)
    expect(plan.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      'invalid-v8-source', 'reference-timetable-missing', 'reference-teaching-unit-missing',
    ]))
    const orphan = inspectSubjectMigrationV9({ ...data, oneOffLessons: [{ id: 'orphan',
      projectId: data.activeProjectId!, timetableId: 'teacher-a', teachingUnitId: unit.id,
      classId: 'class-a', subjectId: 'missing-subject', date: '2026-09-08', purpose: 'extra',
      time: { mode: 'period', periodId: unit.periods[0].id } }] })
    expect(orphan.issues).toContainEqual(expect.objectContaining({ code: 'missing-subject',
      subjectId: 'missing-subject', referenceKind: 'one-off' }))
  })
})

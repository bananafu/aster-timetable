import { describe, expect, it } from 'vitest'
import type { AppDataV8, TimetableProject } from '../../types'
import type { AppDataV9 } from '../../types/v9'
import { createEmptyAppDataV8, loadAppDataV8Only, APP_DATA_V8_KEY } from '../storageV8'
import { createBlankProject } from '../projectRuntimeV8'
import { createTeacherTimetableV8 } from '../timetablesV8'
import { createSubject, configureSubjectForTeachingUnit } from '../subjectsV8'
import { createClassV8 } from '../classesV8'
import { createRecurringLessonV8 } from '../recurringLessonsV8'
import { isCompatibleAppDataV8 } from './v8'
import { createClassV9, createEmptyProjectV9, createSchoolV9, createTeachingUnitV9 } from '../managementV9'
import { asV8ValidationProjection, isCompatibleAppDataV9 } from './v9'

function fixture(): AppDataV9 {
  let id = 0
  let data = createBlankProject(createEmptyAppDataV8(), { name: 'Project', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `base-${++id}`)
  const projectId = data.activeProjectId!
  data = createTeacherTimetableV8(data, projectId, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV8(data, projectId, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  data = createSubject(data, projectId, { name: '數學', shortName: '數', color: '#123456',
    applicableSchoolLevels: ['senior-high', 'junior-high'] }, 'subject-a')
  data = configureSubjectForTeachingUnit(data, projectId, data.teachingUnits[0].id, 'subject-a', 'relation-a')
  data = createClassV8(data, projectId, { teachingUnitId: data.teachingUnits[0].id, name: '一甲' }, 'class-a')
  return { ...data, schemaVersion: 9, subjects: data.subjects.map((subject) => ({ ...subject, timetableId: 'teacher-a' })) }
}

function withReferences(data: AppDataV9): AppDataV9 {
  const unit = data.teachingUnits[0]
  const projectId = data.activeProjectId!
  const v8 = { ...data, schemaVersion: 8,
    projects: data.projects.filter((item): item is TimetableProject => item.term !== null),
    subjects: data.subjects.map((subject) => {
    const { id, name, shortName, color, applicableSchoolLevels, origin } = subject
    return { id, name, shortName, color, applicableSchoolLevels, origin, projectId: subject.projectId }
  }) } satisfies AppDataV8
  const withLesson = createRecurringLessonV8(v8, { projectId, timetableId: 'teacher-a',
    teachingUnitId: unit.id, classId: 'class-a', subjectId: 'subject-a', day: 1,
    periodId: unit.periods[0].id, weekPattern: 'every' }, 'lesson-a')
  return { ...data, recurringLessons: withLesson.recurringLessons,
    oneOffLessons: [{ id: 'one-off-a', projectId, timetableId: 'teacher-a', teachingUnitId: unit.id,
      classId: 'class-a', subjectId: 'subject-a', date: '2026-09-08', purpose: 'extra',
      time: { mode: 'period', periodId: unit.periods[0].id } }],
    overrides: [{ id: 'change-a', projectId, timetableId: 'teacher-a', teachingUnitId: unit.id,
      date: '2026-09-07', periodId: unit.periods[0].id, action: 'replace', originalLessonId: 'lesson-a',
      replacement: { subjectId: 'subject-a', classId: 'class-a' } }],
    teachingProgress: [{ id: '123e4567-e89b-42d3-a456-426614174022', projectId,
      timetableId: 'teacher-a', teachingUnitId: unit.id, classId: 'class-a', subjectId: 'subject-a',
      content: { chapter: '一', unit: '', note: '' }, previousProgress: null,
      createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z' }] }
}

describe('V9 Timetable-owned Subject contract', () => {
  it('validates null-term structural resources natively while excluding them from V8 projection', () => {
    const source = fixture()
    const unit = source.teachingUnits[0]
    let data = createEmptyProjectV9(source, { name: '未設定' }, 'blank')
    data = createSchoolV9(data, 'blank', { name: '乙校', color: '#123456' }, 'blank-school')
    data = createTeachingUnitV9(data, 'blank', { schoolId: 'blank-school', name: '高中部',
      schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31', periods: unit.periods,
      weekCycle: { enabled: true, anchorDate: '2027-08-01', anchorPattern: 'A' } }, 'blank-unit')
    data = createClassV9(data, 'blank', { teachingUnitId: 'blank-unit', grade: 1, classNumber: 1 }, 'blank-class')
    expect(isCompatibleAppDataV9(data)).toBe(true)
    const projected = asV8ValidationProjection(data)
    expect(projected.schools.some((item) => item.projectId === 'blank')).toBe(false)
    expect(projected.teachingUnits.some((item) => item.projectId === 'blank')).toBe(false)
    expect(projected.classes.some((item) => item.projectId === 'blank')).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, teachingUnits: data.teachingUnits.map((item) =>
      item.id === 'blank-unit' ? { ...item, endDate: '2027-02-30' } : item) })).toBe(false)
  })

  it('accepts empty V9, but neither V8 validator nor V8 loader accepts it', () => {
    const empty = { ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9
    expect(isCompatibleAppDataV9(empty)).toBe(true)
    expect(isCompatibleAppDataV8(empty)).toBe(false)
    const storage = { getItem: (key: string) => key === APP_DATA_V8_KEY ? JSON.stringify(empty) : null }
    expect(loadAppDataV8Only(storage, createEmptyAppDataV8()).status).toBe('corrupt-v8')
  })

  it('permits same names in different Timetables, but not in one Timetable', () => {
    const data = fixture()
    const second = { ...data.subjects[0], id: 'subject-b', timetableId: 'teacher-b' }
    const withSecond = { ...data, subjects: [...data.subjects, second] }
    expect(isCompatibleAppDataV9(withSecond)).toBe(true)
    expect(isCompatibleAppDataV9({ ...withSecond, subjects: withSecond.subjects.map((item) =>
      item.id === 'subject-b' ? { ...item, timetableId: 'teacher-a' } : item) })).toBe(false)
    expect(isCompatibleAppDataV9({ ...withSecond, subjects: withSecond.subjects.map((item) =>
      item.id === 'subject-b' ? { ...item, timetableId: 'teacher-a', name: '物理' } : item) })).toBe(false)
  })

  it('allows one teacher Subject across senior and junior TeachingUnits', () => {
    const data = fixture()
    const senior = data.teachingUnits[0]
    const junior = { ...senior, id: 'unit-junior', name: '國中部', schoolLevel: 'junior-high' as const }
    const both = { ...data, teachingUnits: [...data.teachingUnits, junior],
      teachingUnitSubjects: [...data.teachingUnitSubjects, { id: 'relation-junior',
        projectId: senior.projectId, teachingUnitId: junior.id, subjectId: 'subject-a' }] }
    expect(isCompatibleAppDataV9(both)).toBe(true)
    expect(isCompatibleAppDataV9({ ...both, teachingUnitSubjects: [...both.teachingUnitSubjects,
      { id: 'cross-project', projectId: 'other', teachingUnitId: junior.id, subjectId: 'subject-a' }] })).toBe(false)
  })

  it('requires Subject and Timetable to share a Project and rejects unknown Subject fields', () => {
    const data = fixture()
    expect(isCompatibleAppDataV9({ ...data, subjects: [{ ...data.subjects[0], projectId: 'other' }] })).toBe(false)
    const otherProject = { ...data.projects[0], id: 'project-b', name: 'Project B' }
    expect(isCompatibleAppDataV9({ ...data, projects: [...data.projects, otherProject],
      teachingUnitSubjects: [], subjects: [{ ...data.subjects[0], projectId: otherProject.id }] })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, subjects: [{ ...data.subjects[0], timetableId: 'missing' }] })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, subjects: [{ ...data.subjects[0], extra: true }] })).toBe(false)
  })

  it('keeps a rename in one teacher Subject entity without changing another teacher or reference IDs', () => {
    const data = withReferences(fixture())
    const second = { ...data.subjects[0], id: 'subject-b', timetableId: 'teacher-b' }
    const withSecond = { ...data, subjects: [...data.subjects, second] }
    const renamed = { ...withSecond, subjects: withSecond.subjects.map((item) => item.id === 'subject-a'
      ? { ...item, name: '新數學', shortName: '新數' } : item) }
    expect(isCompatibleAppDataV9(renamed)).toBe(true)
    expect(renamed.subjects[1]).toEqual(second)
    expect(renamed.recurringLessons[0].subjectId).toBe('subject-a')
    expect(renamed.teachingProgress[0].subjectId).toBe('subject-a')
  })

  it('validates Lesson, OneOff, Change replacement, and Progress ownership independently', () => {
    const data = withReferences(fixture())
    expect(isCompatibleAppDataV9(data)).toBe(true)
    expect(isCompatibleAppDataV9({ ...data, recurringLessons: data.recurringLessons.map((item) =>
      ({ ...item, timetableId: 'teacher-b' })) })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, oneOffLessons: data.oneOffLessons.map((item) =>
      ({ ...item, timetableId: 'teacher-b' })) })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, overrides: data.overrides.map((item) =>
      ({ ...item, timetableId: 'teacher-b', originalLessonId: undefined })) })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, teachingProgress: data.teachingProgress.map((item) =>
      ({ ...item, timetableId: 'teacher-b' })) })).toBe(false)
  })
})

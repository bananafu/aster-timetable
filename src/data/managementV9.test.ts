import { describe, expect, it } from 'vitest'
import type { AppDataV9 } from '../types/v9'
import { createEmptyAppDataV8 } from './storageV8'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9,
  createTeacherTimetableV9 } from './teacherSubjectsV9'
import { createRecurringLessonV8 } from './recurringLessonsV8'
import { archiveProjectV9, copyProjectV9, createClassV9, createSchoolV9,
  createEmptyProjectV9, createTeachingUnitV9, deleteClassV9, deleteEmptyProjectV9,
  getClassV9Impact, getProjectV9Impact,
  reactivateProjectV9, updateClassV9, updateSchoolV9, updateTeachingUnitV9 } from './managementV9'
import { asV8ValidationProjection, isCompatibleAppDataV9 } from './validators/v9'

function fixture() {
  let serial = 0
  const id = () => `management-${++serial}`
  let data = createBlankProjectV9({ ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9,
    { name: '來源', academicYear: 115, semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, id)
  const projectId = data.activeProjectId!
  data = createTeacherTimetableV9(data, projectId, { name: 'A 課表', teacherName: 'A' }, id())
  data = createTeacherTimetableV9(data, projectId, { name: 'B 課表', teacherName: 'B' }, id())
  return { data, projectId, id }
}
const math = { name: '數學', shortName: '數', color: '#123456', applicableSchoolLevels: ['senior-high' as const] }

describe('V8 teacher-owned management adapters', () => {
  it('manages School, TeachingUnit and Class natively before Project term configuration', () => {
    const source = fixture()
    const sourceUnit = source.data.teachingUnits[0]
    let data = createEmptyProjectV9(source.data, { name: '未設定' }, 'blank')
    data = createSchoolV9(data, 'blank', { name: '乙校', color: '#123456' }, 'blank-school')
    data = updateSchoolV9(data, 'blank', 'blank-school', { name: '乙校更新', color: '#654321' })
    data = createTeachingUnitV9(data, 'blank', { schoolId: 'blank-school', name: '高中部',
      schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31',
      periods: sourceUnit.periods, weekCycle: { enabled: true, anchorDate: '2027-08-01', anchorPattern: 'A' } },
    'blank-unit')
    data = updateTeachingUnitV9(data, 'blank', 'blank-unit', { schoolId: 'blank-school', name: '高中部更新',
      schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31',
      periods: sourceUnit.periods, weekCycle: { enabled: true, anchorDate: '2027-08-01', anchorPattern: 'B' } })
    data = createClassV9(data, 'blank', { teachingUnitId: 'blank-unit', grade: 1, classNumber: 1 }, 'blank-class')
    data = updateClassV9(data, 'blank', 'blank-class',
      { teachingUnitId: 'blank-unit', grade: 2, classNumber: 3, room: '201' })
    expect(data.schools.find((item) => item.id === 'blank-school'))
      .toMatchObject({ projectId: 'blank', name: '乙校更新', color: '#654321' })
    expect(data.teachingUnits.find((item) => item.id === 'blank-unit'))
      .toMatchObject({ projectId: 'blank', name: '高中部更新', weekCycle: { anchorPattern: 'B' } })
    expect(data.classes.find((item) => item.id === 'blank-class'))
      .toMatchObject({ projectId: 'blank', teachingUnitId: 'blank-unit', name: '203', room: '201' })
    expect(getClassV9Impact(data, 'blank', 'blank-class')).toMatchObject({ recurringLessons: 0,
      oneOffLessons: 0, overrides: 0, teachingProgress: 0 })
    expect(() => createTeachingUnitV9(data, 'blank', { schoolId: 'blank-school', name: '重複高中部',
      schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31',
      periods: sourceUnit.periods, weekCycle: { enabled: true, anchorDate: '2027-08-01', anchorPattern: 'A' } },
    'duplicate-unit')).toThrow()
    expect(() => createClassV9(data, 'blank',
      { teachingUnitId: sourceUnit.id, grade: 1, classNumber: 2 }, 'cross-project-class')).toThrow()
    expect(() => deleteClassV9(data, 'blank', 'blank-class')).toThrow(/confirmation/)
    const deleted = deleteClassV9(data, 'blank', 'blank-class', true)
    expect(deleted.classes.some((item) => item.id === 'blank-class')).toBe(false)
    expect(isCompatibleAppDataV9(deleted)).toBe(true)
  })

  it('counts null-term structural dependencies and refuses cascading Project deletion', () => {
    const source = fixture()
    const sourceUnit = source.data.teachingUnits[0]
    let data = createEmptyProjectV9(source.data, { name: '未設定' }, 'blank')
    data = createSchoolV9(data, 'blank', { name: '乙校', color: '#123456' }, 'blank-school')
    data = createTeachingUnitV9(data, 'blank', { schoolId: 'blank-school', name: '高中部',
      schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31',
      periods: sourceUnit.periods, weekCycle: { enabled: true, anchorDate: '2027-08-01', anchorPattern: 'A' } },
    'blank-unit')
    data = createTeacherTimetableV9(data, 'blank', { name: '乙課表', teacherName: '乙' }, 'blank-table')
    data = createTeacherSubjectV9(data, 'blank', 'blank-table', math, 'blank-subject')
    data = configureTeacherSubjectV9(data, 'blank', 'blank-table', 'blank-unit', 'blank-subject', 'blank-relation')
    data = createClassV9(data, 'blank', { teachingUnitId: 'blank-unit', grade: 1, classNumber: 1 }, 'blank-class')
    expect(getProjectV9Impact(data, 'blank')).toMatchObject({ teachingUnits: 1, timetables: 1,
      subjects: 1, teachingUnitSubjects: 1, classes: 1 })
    expect(() => deleteEmptyProjectV9(data, 'blank', true)).toThrow(/不能級聯刪除/)
  })

  it('reuses school, unit and class rules without changing another Project', () => {
    const f = fixture()
    let data = createSchoolV9(f.data, f.projectId, { name: '第二學校', color: '#123456' }, f.id())
    const school = data.schools.at(-1)!
    const sourceUnit = data.teachingUnits[0]
    data = createTeachingUnitV9(data, f.projectId, { schoolId: school.id, name: '國中部', schoolLevel: 'junior-high',
      startDate: sourceUnit.startDate, endDate: sourceUnit.endDate, periods: sourceUnit.periods,
      weekCycle: sourceUnit.weekCycle }, f.id())
    const junior = data.teachingUnits.at(-1)!
    data = createClassV9(data, f.projectId, { teachingUnitId: junior.id, grade: 7, classNumber: 1 }, f.id())
    const schoolClass = data.classes.at(-1)!
    expect(schoolClass.name).toBe('701')
    data = updateClassV9(data, f.projectId, schoolClass.id, { teachingUnitId: junior.id, grade: 8, classNumber: 2 })
    expect(data.classes.at(-1)?.name).toBe('802')
    expect(() => deleteClassV9(data, f.projectId, schoolClass.id)).toThrow()
    data = deleteClassV9(data, f.projectId, schoolClass.id, true)
    data = updateTeachingUnitV9(data, f.projectId, junior.id, { schoolId: school.id, name: '國中部更新',
      schoolLevel: 'junior-high', startDate: sourceUnit.startDate, endDate: sourceUnit.endDate,
      periods: sourceUnit.periods, weekCycle: sourceUnit.weekCycle })
    expect(data.teachingUnits.at(-1)?.name).toBe('國中部更新')
    expect(isCompatibleAppDataV9(data)).toBe(true)
  })

  it('copies each teacher Subject to a new owner and keeps source resources independent', () => {
    const f = fixture()
    const [a, b] = f.data.timetables
    let data = createTeacherSubjectV9(f.data, f.projectId, a.id, math, f.id())
    data = createTeacherSubjectV9(data, f.projectId, b.id, math, f.id())
    const sourceUnit = data.teachingUnits[0]
    const copied = copyProjectV9(data, { sourceProjectId: f.projectId, name: '新學期', academicYear: 116,
      semester: 'second', units: [{ sourceUnitId: sourceUnit.id, sourceEffectiveDate: '2026-10-01',
        startDate: '2027-02-01', endDate: '2027-07-31', anchorDate: '2027-02-01', anchorPattern: 'A' }] }, f.id)
    const newProjectId = copied.activeProjectId!
    const newTables = copied.timetables.filter((item) => item.projectId === newProjectId)
    const newSubjects = copied.subjects.filter((item) => item.projectId === newProjectId)
    expect(newTables).toHaveLength(2)
    expect(newSubjects.map((item) => item.name)).toEqual(['數學', '數學'])
    expect(new Set(newSubjects.map((item) => item.timetableId))).toEqual(new Set(newTables.map((item) => item.id)))
    expect(new Set(newSubjects.map((item) => item.id)).size).toBe(2)
    expect(copied.oneOffLessons).toEqual(data.oneOffLessons)
    expect(copied.events).toEqual(data.events)
    expect(isCompatibleAppDataV9(copied)).toBe(true)
    expect(data.activeProjectId).toBe(f.projectId)
  })

  it('remaps fixed Lesson, Class, Subject and Timetable together while rejecting referenced Class deletion', () => {
    const f = fixture()
    const unit = f.data.teachingUnits[0]
    const teacher = f.data.timetables[0]
    let data = createTeacherSubjectV9(f.data, f.projectId, teacher.id, math, f.id())
    const subjectId = data.subjects[0].id
    data = configureTeacherSubjectV9(data, f.projectId, teacher.id, unit.id, subjectId, f.id())
    data = createClassV9(data, f.projectId, { teachingUnitId: unit.id, grade: 1, classNumber: 1 }, f.id())
    const classId = data.classes[0].id
    const projected = createRecurringLessonV8(asV8ValidationProjection(data), {
      projectId: f.projectId, timetableId: teacher.id, teachingUnitId: unit.id,
      classId, subjectId, day: 1, periodId: unit.periods[0].id, weekPattern: 'every',
    }, f.id())
    data = { ...data, recurringLessons: projected.recurringLessons }
    expect(isCompatibleAppDataV9(data)).toBe(true)
    expect(() => deleteClassV9(data, f.projectId, classId, true)).toThrow(/referenced/)
    const copied = copyProjectV9(data, { sourceProjectId: f.projectId, name: '新學期', academicYear: 116,
      semester: 'second', units: [{ sourceUnitId: unit.id, sourceEffectiveDate: '2026-10-01',
        startDate: '2027-02-01', endDate: '2027-07-31', anchorDate: '2027-02-01', anchorPattern: 'A' }] }, f.id)
    const lesson = copied.recurringLessons.at(-1)!
    expect(lesson.projectId).toBe(copied.activeProjectId)
    expect(lesson.timetableId).not.toBe(teacher.id)
    expect(lesson.subjectId).not.toBe(subjectId)
    expect(lesson.classId).not.toBe(classId)
    expect(copied.subjects.find((item) => item.id === lesson.subjectId)?.timetableId).toBe(lesson.timetableId)
    expect(isCompatibleAppDataV9(copied)).toBe(true)
  })

  it('lets two teachers reference one Class with separate Subject IDs without cross-owner leakage', () => {
    const f = fixture()
    const [teacherA, teacherB] = f.data.timetables
    const unit = f.data.teachingUnits[0]
    let data = createTeacherSubjectV9(f.data, f.projectId, teacherA.id, math, f.id())
    data = createTeacherSubjectV9(data, f.projectId, teacherB.id, math, f.id())
    const [subjectA, subjectB] = data.subjects
    data = configureTeacherSubjectV9(data, f.projectId, teacherA.id, unit.id, subjectA.id, f.id())
    data = configureTeacherSubjectV9(data, f.projectId, teacherB.id, unit.id, subjectB.id, f.id())
    data = createClassV9(data, f.projectId, { teachingUnitId: unit.id, grade: 1, classNumber: 1 }, f.id())
    const classId = data.classes[0].id
    for (const [teacher, subject] of [[teacherA, subjectA], [teacherB, subjectB]] as const) {
      const projected = createRecurringLessonV8(asV8ValidationProjection(data), {
        projectId: f.projectId, timetableId: teacher.id, teachingUnitId: unit.id,
        classId, subjectId: subject.id, day: 1, periodId: unit.periods[0].id, weekPattern: 'every',
      }, f.id())
      data = { ...data, recurringLessons: projected.recurringLessons }
    }
    expect(data.recurringLessons.map((item) => item.classId)).toEqual([classId, classId])
    expect(data.recurringLessons.map((item) => item.subjectId)).toEqual([subjectA.id, subjectB.id])
    expect(isCompatibleAppDataV9(data)).toBe(true)
    expect(() => deleteClassV9(data, f.projectId, classId, true)).toThrow(/referenced/)
  })

  it('rejects Class deletion for each other legal reference without changing the input document', () => {
    const f = fixture()
    const teacher = f.data.timetables[0]
    const unit = f.data.teachingUnits[0]
    let base = createTeacherSubjectV9(f.data, f.projectId, teacher.id, math, f.id())
    const subjectId = base.subjects[0].id
    base = configureTeacherSubjectV9(base, f.projectId, teacher.id, unit.id, subjectId, f.id())
    base = createClassV9(base, f.projectId, { teachingUnitId: unit.id, grade: 1, classNumber: 1 }, f.id())
    const sourceClassId = base.classes[0].id
    base = createClassV9(base, f.projectId, { teachingUnitId: unit.id, grade: 1, classNumber: 2 }, f.id())
    const targetClassId = base.classes[1].id
    const sourceLesson = createRecurringLessonV8(asV8ValidationProjection(base), {
      projectId: f.projectId, timetableId: teacher.id, teachingUnitId: unit.id,
      classId: sourceClassId, subjectId, day: 1, periodId: unit.periods[0].id,
      weekPattern: 'every',
    }, f.id())
    base = { ...base, recurringLessons: sourceLesson.recurringLessons }
    const targetLesson = createRecurringLessonV8(asV8ValidationProjection(base), {
      projectId: f.projectId, timetableId: teacher.id, teachingUnitId: unit.id,
      classId: targetClassId, subjectId, day: 2, periodId: unit.periods[0].id,
      weekPattern: 'every',
    }, f.id())
    const cases = [
      { kind: 'recurringLessons' as const, data: { ...base, recurringLessons: targetLesson.recurringLessons } },
      { kind: 'oneOffLessons' as const, data: { ...base, oneOffLessons: [{ id: f.id(),
        projectId: f.projectId, timetableId: teacher.id, teachingUnitId: unit.id,
        classId: targetClassId, subjectId, date: '2026-09-08', purpose: 'extra' as const,
        time: { mode: 'period' as const, periodId: unit.periods[0].id } }] } },
      { kind: 'overrides' as const, data: { ...base, overrides: [{ id: f.id(),
        projectId: f.projectId, timetableId: teacher.id, teachingUnitId: unit.id,
        date: '2026-09-07', periodId: unit.periods[0].id, action: 'replace' as const,
        originalLessonId: base.recurringLessons[0].id,
        replacement: { subjectId, classId: targetClassId } }] } },
      { kind: 'teachingProgress' as const, data: { ...base, teachingProgress: [{
        id: '123e4567-e89b-42d3-a456-426614174022', projectId: f.projectId,
        timetableId: teacher.id, teachingUnitId: unit.id, classId: targetClassId, subjectId,
        content: { chapter: '一', unit: '', note: '' }, previousProgress: null,
        createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
      }] } },
    ]
    for (const { kind, data } of cases) {
      expect(isCompatibleAppDataV9(data), kind).toBe(true)
      const raw = JSON.stringify(data)
      expect(getClassV9Impact(data, f.projectId, targetClassId)[kind], kind).toBe(1)
      expect(() => deleteClassV9(data, f.projectId, targetClassId, true), kind).toThrow(/referenced/)
      expect(JSON.stringify(data), kind).toBe(raw)
    }
  })

  it('copies a Project with no teacher Timetable without inventing a teacher or Subject', () => {
    let serial = 0
    const id = () => `empty-copy-${++serial}`
    let data = createBlankProjectV9({ ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9,
      { name: '空白來源', academicYear: 115, semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, id)
    const sourceId = data.activeProjectId!
    const unit = data.teachingUnits[0]
    data = createClassV9(data, sourceId, { teachingUnitId: unit.id, grade: 1, classNumber: 1 }, id())
    const copied = copyProjectV9(data, { sourceProjectId: sourceId, name: '空白副本', academicYear: 116,
      semester: 'second', units: [{ sourceUnitId: unit.id, sourceEffectiveDate: '2026-10-01',
        startDate: '2027-02-01', endDate: '2027-07-31', anchorDate: '2027-02-01', anchorPattern: 'A' }] }, id)
    expect(copied.timetables).toEqual([])
    expect(copied.subjects).toEqual([])
    expect(copied.classes.at(-1)?.id).not.toBe(data.classes[0].id)
    expect(copied.classes.at(-1)?.teachingUnitId).not.toBe(unit.id)
    expect(isCompatibleAppDataV9(copied)).toBe(true)
  })

  it('archives and reactivates without deleting resources; permanent deletion blocks dependencies', () => {
    const f = fixture()
    const archived = archiveProjectV9(f.data, f.projectId)
    expect(archived.timetables).toEqual(f.data.timetables)
    expect(reactivateProjectV9(archived, f.projectId).activeProjectId).toBe(f.projectId)
    expect(getProjectV9Impact(f.data, f.projectId).timetables).toBe(2)
    expect(() => deleteEmptyProjectV9(f.data, f.projectId, true)).toThrow(/不能級聯刪除/)
    const empty = createEmptyProjectV9(f.data, { name: '空白' }, f.id())
    const emptyId = empty.activeProjectId!
    expect(() => deleteEmptyProjectV9(empty, emptyId)).toThrow()
    expect(deleteEmptyProjectV9(empty, emptyId, true).projects.some((item) => item.id === emptyId)).toBe(false)
  })
})

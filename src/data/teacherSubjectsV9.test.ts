import { describe, expect, it } from 'vitest'
import type { AppDataV9 } from '../types/v9'
import { createEmptyAppDataV8 } from './storageV8'
import { createBlankProjectV9, createTeacherTimetableV9, createTeacherSubjectV9,
  configureTeacherSubjectV9, deleteTeacherSubjectV9, deleteTeacherTimetableV9,
  duplicateTeacherTimetableV9, renameTeacherSubjectV9, switchActiveProjectV9,
  createTeachingUnitV9 } from './teacherSubjectsV9'
import { isCompatibleAppDataV9 } from './validators/v9'

function fixture() {
  let serial = 0
  const id = () => `generated-${++serial}`
  let data = createBlankProjectV9({ ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9,
    { name: 'Project A', academicYear: 115, semester: 'first',
      startDate: '2026-08-01', endDate: '2027-01-31' }, id)
  const projectId = data.activeProjectId!
  data = createTeacherTimetableV9(data, projectId, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV9(data, projectId, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  return { data, projectId, id }
}
const math = { name: '數學', shortName: '數', color: '#123456', applicableSchoolLevels: ['senior-high' as const] }

describe('V8 Preview teacher-owned Subject operations on internal V9 contract', () => {
  it('keeps two teachers independent, permits duplicate names and cross-unit configuration', () => {
    const initial = fixture()
    let { data } = initial
    const { projectId } = initial
    const senior = data.teachingUnits[0]
    data = createTeachingUnitV9(data, projectId, { schoolId: senior.schoolId, name: '國中部',
      schoolLevel: 'junior-high', startDate: senior.startDate, endDate: senior.endDate,
      periods: senior.periods, weekCycle: senior.weekCycle }, 'junior-unit')
    data = createTeacherSubjectV9(data, projectId, 'teacher-a', math, 'subject-a')
    data = createTeacherSubjectV9(data, projectId, 'teacher-b', math, 'subject-b')
    expect(() => configureTeacherSubjectV9(data, projectId, 'teacher-a', 'junior-unit', 'subject-a', 'junior-relation'))
      .toThrow('Confirm school-level extension')
    data = configureTeacherSubjectV9(data, projectId, 'teacher-a', senior.id, 'subject-a', 'senior-relation')
    data = configureTeacherSubjectV9(data, projectId, 'teacher-a', 'junior-unit', 'subject-a', 'junior-relation', true)
    expect(isCompatibleAppDataV9(data)).toBe(true)
    expect(data.teachingUnitSubjects.filter((item) => item.subjectId === 'subject-a')).toHaveLength(2)
    expect(data.subjects.find((item) => item.id === 'subject-a')?.applicableSchoolLevels)
      .toEqual(['senior-high', 'junior-high'])
    const renamed = renameTeacherSubjectV9(data, projectId, 'teacher-b', 'subject-b',
      { ...math, name: '新數學', shortName: '新數' })
    expect(renamed.subjects.find((item) => item.id === 'subject-a')?.name).toBe('數學')
    expect(renamed.subjects.find((item) => item.id === 'subject-b')?.name).toBe('新數學')
    expect(() => deleteTeacherSubjectV9(data, projectId, 'teacher-a', 'subject-a'))
      .toThrow('still has a configuration')
    expect(deleteTeacherSubjectV9(renamed, projectId, 'teacher-b', 'subject-b').subjects)
      .toHaveLength(1)
  })

  it('new and copied Timetables do not inherit Subjects; deletion refuses owned Subjects', () => {
    const initial = fixture()
    let { data } = initial
    const { projectId } = initial
    data = createTeacherSubjectV9(data, projectId, 'teacher-a', math, 'subject-a')
    data = duplicateTeacherTimetableV9(data, projectId, 'teacher-a', 'teacher-copy')
    expect(data.subjects.filter((item) => item.timetableId === 'teacher-copy')).toEqual([])
    expect(deleteTeacherTimetableV9(data, projectId, 'teacher-copy').timetables)
      .not.toContainEqual(expect.objectContaining({ id: 'teacher-copy' }))
    expect(() => deleteTeacherTimetableV9(data, projectId, 'teacher-a')).toThrow('Subject library')
  })

  it('blank Project B has no Subject or Timetable and cannot mutate Project A by ID', () => {
    const initial = fixture()
    let { data } = initial
    const { projectId, id } = initial
    data = createTeacherSubjectV9(data, projectId, 'teacher-a', math, 'subject-a')
    data = createBlankProjectV9(data, { name: 'Project B', academicYear: 116, semester: 'second',
      startDate: '2027-02-01', endDate: '2027-07-31' }, id)
    const otherId = data.activeProjectId!
    expect(data.subjects.filter((item) => item.projectId === otherId)).toEqual([])
    expect(data.timetables.filter((item) => item.projectId === otherId)).toEqual([])
    expect(() => createTeacherSubjectV9(data, otherId, 'teacher-a', math, 'wrong')).toThrow()
    expect(switchActiveProjectV9(data, projectId).subjects).toEqual(data.subjects)
  })
})

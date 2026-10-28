import { describe, expect, it } from 'vitest'
import type { AppDataV9 } from '../types/v9'
import { createEmptyAppDataV8 } from './storageV8'
import { archiveProjectV9, configureProjectTermV9, copyProjectV9, createClassV9, createEmptyProjectV9,
  createSchoolV9, createTeachingUnitV9, deleteEmptyProjectV9, updateSchoolV9 } from './managementV9'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9, createTeacherTimetableV9,
  switchActiveProjectV9, updateTeacherTimetableV9 } from './teacherSubjectsV9'
import { asV8ValidationProjection, isCompatibleAppDataV9, isSafeAppDataV9Update } from './validators/v9'
import { isCompatibleAppDataV7 } from './validators/v7'
import { listFormalProjectsV9, selectFormalProjectV9, selectFormalTimetableV9 } from '../formalProjectTimetableV9'
import { presentFormalSubjectManagementV9 } from '../formalSubjectManagementV9'
import { presentFormalClassManagementV9 } from '../formalClassManagementV9'

const empty = (): AppDataV9 => ({ ...createEmptyAppDataV8(), schemaVersion: 9, subjects: [] })
const input = { name: '已設定', academicYear: 115, semester: 'first' as const,
  startDate: '2026-08-01', endDate: '2027-01-31' }
const math = { name: '數學', shortName: '數', color: '#123456', applicableSchoolLevels: ['senior-high' as const] }
function configured() {
  let serial = 0
  let data = createBlankProjectV9(empty(), input, () => `configured-${++serial}`)
  const projectId = data.activeProjectId!
  data = createTeacherTimetableV9(data, projectId, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  return { data, projectId, unit: data.teachingUnits[0] }
}

describe('V9 unset Project term contract', () => {
  it('creates only a name, null term and record metadata without term dates or implicit resources', () => {
    const data = createEmptyProjectV9(empty(), { name: ' 名稱專案 ' }, 'blank')
    expect(data.projects).toEqual([{ id: 'blank', name: '名稱專案', term: null,
      createdAt: expect.any(String), updatedAt: expect.any(String) }])
    for (const key of ['timetables', 'schools', 'teachingUnits', 'subjects', 'teachingUnitSubjects',
      'classes', 'recurringLessons', 'oneOffLessons', 'overrides', 'events', 'teachingProgress'] as const) {
      expect(data[key], key).toEqual([])
    }
    expect(isCompatibleAppDataV9(data)).toBe(true)
    expect(isSafeAppDataV9Update(empty(), data)).toBe(true)
    expect(() => createEmptyProjectV9(data, { name: '重複 ID' }, 'blank')).toThrow()
    expect(() => createEmptyProjectV9(data, { name: ' ' }, 'invalid')).toThrow()
  })

  it.each([undefined, {}, { academicYear: 115 }, { semester: 'first' },
    { academicYear: 0, semester: 'first' }, { academicYear: 115, semester: '' },
    { academicYear: 115, semester: 'custom' }, { academicYear: 115, semester: 'other' },
    { academicYear: 115, semester: 'first', startDate: '2026-02-30' }])('rejects partial or invalid term %j', (term) => {
    const data = createEmptyProjectV9(empty(), { name: '名稱' }, 'blank')
    const invalid = { ...data, projects: [{ ...data.projects[0], term }] }
    expect(isCompatibleAppDataV9(invalid)).toBe(false)
  })

  it('retains complete old V9 terms and leaves V7 term requirements intact', () => {
    const { data } = configured()
    const raw = JSON.stringify(data)
    expect(isCompatibleAppDataV9(JSON.parse(raw))).toBe(true)
    expect(JSON.stringify(data)).toBe(raw)
    expect(isCompatibleAppDataV7({ ...data, schemaVersion: 7 })).toBe(true)
    const blank = createEmptyProjectV9(empty(), { name: '名稱' }, 'blank')
    expect(isCompatibleAppDataV7({ ...blank, schemaVersion: 7 })).toBe(false)
  })

  it('accepts explicit TeachingUnit dates but keeps term-dependent records unavailable', () => {
    const source = configured()
    let data = createEmptyProjectV9(source.data, { name: '未設定' }, 'blank')
    data = createSchoolV9(data, 'blank', { name: '學校', color: '#123456' }, 'blank-school')
    const draft = { schoolId: 'blank-school', name: source.unit.name, schoolLevel: source.unit.schoolLevel,
      startDate: source.unit.startDate, endDate: source.unit.endDate, periods: source.unit.periods,
      weekCycle: source.unit.weekCycle }
    data = createTeachingUnitV9(data, 'blank', draft, 'blank-unit')
    expect(data.teachingUnits.find((item) => item.id === 'blank-unit')).toMatchObject({
      projectId: 'blank', startDate: source.unit.startDate, endDate: source.unit.endDate,
    })
    expect(() => copyProjectV9(data, { sourceProjectId: 'blank', name: '不應複製', academicYear: 116,
      semester: 'second', units: [] }, () => 'copy')).toThrow(/term is not configured/)
    const invalid = { ...data, recurringLessons: [{ id: 'lesson', seriesId: 'series', projectId: 'blank',
      timetableId: 'missing', teachingUnitId: 'blank-unit', subjectId: 'missing', classId: 'missing',
      day: 1 as const, periodId: source.unit.periods[0].id, weekPattern: 'every' as const,
      effectiveStart: source.unit.startDate }] }
    expect(isCompatibleAppDataV9(invalid)).toBe(false)
    expect(isSafeAppDataV9Update(data, invalid)).toBe(false)
    const configuredTerm = configureProjectTermV9(data, 'blank', { academicYear: 115, semester: 'first' })
    expect(configuredTerm.projects.find((item) => item.id === 'blank')?.term)
      .toEqual({ academicYear: 115, semester: 'first', customLabel: undefined })
    expect(configuredTerm.teachingUnits).toEqual(data.teachingUnits)
    const stripped = { ...source.data, projects: source.data.projects.map((item) => ({ ...item, term: null })) }
    expect(isCompatibleAppDataV9(stripped)).toBe(true)
    expect(isSafeAppDataV9Update(source.data, stripped)).toBe(false)
  })

  it('natively validates every structural resource excluded from the V8 projection', () => {
    const source = configured()
    let data = createEmptyProjectV9(source.data, { name: '未設定' }, 'blank')
    data = createSchoolV9(data, 'blank', { name: '乙校', color: '#123456' }, 'blank-school')
    data = createTeachingUnitV9(data, 'blank', { schoolId: 'blank-school', name: '高中部',
      schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31',
      periods: source.unit.periods, weekCycle: { enabled: true, anchorDate: '2027-08-01', anchorPattern: 'A' } },
    'blank-unit')
    data = createTeacherTimetableV9(data, 'blank', { name: '乙課表', teacherName: '乙' }, 'blank-table')
    data = createTeacherSubjectV9(data, 'blank', 'blank-table', math, 'blank-subject')
    data = createTeacherSubjectV9(data, 'blank', 'blank-table',
      { ...math, name: '英文', shortName: '英' }, 'blank-subject-2')
    data = configureTeacherSubjectV9(data, 'blank', 'blank-table', 'blank-unit', 'blank-subject', 'blank-relation')
    data = createClassV9(data, 'blank', { teachingUnitId: 'blank-unit', grade: 1, classNumber: 1 }, 'blank-class')

    const projection = asV8ValidationProjection(data)
    for (const key of ['schools', 'teachingUnits', 'timetables', 'subjects',
      'teachingUnitSubjects', 'classes'] as const) {
      expect(projection[key].some((item) => item.projectId === 'blank'), key).toBe(false)
    }
    expect(isCompatibleAppDataV9(data)).toBe(true)
    const changeUnit = (change: Partial<AppDataV9['teachingUnits'][number]>) => ({ ...data,
      teachingUnits: data.teachingUnits.map((item) => item.id === 'blank-unit' ? { ...item, ...change } : item) })
    expect(isCompatibleAppDataV9(changeUnit({ startDate: '2027-02-30' }))).toBe(false)
    expect(isCompatibleAppDataV9(changeUnit({ weekCycle: { enabled: true,
      anchorDate: 'invalid', anchorPattern: 'A' } }))).toBe(false)
    expect(isCompatibleAppDataV9(changeUnit({ periods: source.unit.periods.map((item, index) => index === 1
      ? { ...item, startTime: source.unit.periods[0].startTime } : item) }))).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, teachingUnits: [...data.teachingUnits,
      { ...data.teachingUnits.find((item) => item.id === 'blank-unit')!, id: 'duplicate-unit' }] })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, classes: data.classes.map((item) => item.id === 'blank-class'
      ? { ...item, grade: 7 } : item) })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, teachingUnitSubjects: data.teachingUnitSubjects.map((item) =>
      ({ ...item, projectId: source.projectId })) })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, schools: data.schools.map((item) => item.id === 'blank-school'
      ? { ...item, name: ' ' } : item) })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, classes: data.classes.map((item) => item.id === 'blank-class'
      ? { ...item, id: 'blank-subject' } : item) })).toBe(false)
    const rebound = { ...data, teachingUnitSubjects: data.teachingUnitSubjects.map((item) =>
      item.id === 'blank-relation' ? { ...item, subjectId: 'blank-subject-2' } : item) }
    expect(isCompatibleAppDataV9(rebound)).toBe(true)
    expect(isSafeAppDataV9Update(data, rebound)).toBe(false)
    const archived = archiveProjectV9(data, 'blank')
    const renamedArchived = { ...archived, projects: archived.projects.map((item) => item.id === 'blank'
      ? { ...item, name: '封存後旁路改名' } : item) }
    expect(isCompatibleAppDataV9(renamedArchived)).toBe(true)
    expect(isSafeAppDataV9Update(archived, renamedArchived)).toBe(false)
    expect(isSafeAppDataV9Update(archived, { ...archived, schools: archived.schools.map((item) =>
      item.id === 'blank-school' ? { ...item, name: '封存後旁路修改' } : item) })).toBe(false)
  })

  it('keeps all dated collections unavailable until the Project term is configured', () => {
    const data = createEmptyProjectV9(empty(), { name: '未設定' }, 'blank')
    for (const key of ['recurringLessons', 'oneOffLessons', 'overrides', 'events',
      'teachingProgress'] as const) {
      const blocked = ({ ...data, [key]: [{ id: `blocked-${key}`, projectId: 'blank' }] } as unknown as AppDataV9)
      expect(isCompatibleAppDataV9(blocked), key).toBe(false)
      expect(isSafeAppDataV9Update(data, blocked), key).toBe(false)
    }
  })

  it('configures a null term as one isolated update and preserves every resource byte-for-byte', () => {
    const source = configured()
    let data = createEmptyProjectV9(source.data, { name: '未設定' }, 'blank')
    data = createSchoolV9(data, 'blank', { name: '乙校', color: '#123456' }, 'blank-school')
    data = createTeachingUnitV9(data, 'blank', { schoolId: 'blank-school', name: '高中部',
      schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31',
      periods: source.unit.periods, weekCycle: { enabled: true, anchorDate: '2027-08-01', anchorPattern: 'A' } },
    'blank-unit')
    data = createTeacherTimetableV9(data, 'blank', { name: '乙課表', teacherName: '乙' }, 'blank-table')
    data = createTeacherSubjectV9(data, 'blank', 'blank-table', math, 'blank-subject')
    data = configureTeacherSubjectV9(data, 'blank', 'blank-table', 'blank-unit', 'blank-subject', 'blank-relation')
    data = createClassV9(data, 'blank', { teachingUnitId: 'blank-unit', grade: 1, classNumber: 1 }, 'blank-class')
    const beforeResources = Object.fromEntries(['schools', 'teachingUnits', 'timetables', 'subjects',
      'teachingUnitSubjects', 'classes'].map((key) => [key, JSON.stringify(data[key as keyof AppDataV9])]))
    const configuredTerm = configureProjectTermV9(data, 'blank',
      { academicYear: 116, semester: 'custom', customLabel: '暑期' }, '2027-01-02T00:00:00.000Z')
    expect(configuredTerm.projects.find((item) => item.id === 'blank')?.term)
      .toEqual({ academicYear: 116, semester: 'custom', customLabel: '暑期' })
    for (const [key, raw] of Object.entries(beforeResources)) {
      expect(JSON.stringify(configuredTerm[key as keyof AppDataV9]), key).toBe(raw)
    }
    expect(isSafeAppDataV9Update(data, configuredTerm)).toBe(true)
    expect(isSafeAppDataV9Update(data, { ...configuredTerm,
      schools: configuredTerm.schools.map((item) => item.id === 'blank-school'
        ? { ...item, name: '夾帶修改' } : item) })).toBe(false)
    expect(() => configureProjectTermV9(configuredTerm, 'blank',
      { academicYear: 117, semester: 'first' })).toThrow(/already configured/)
    expect(() => configureProjectTermV9(data, 'blank',
      { academicYear: 116, semester: 'first', startDate: '2027-08-01' } as never)).toThrow(/invalid/)
    expect(() => configureProjectTermV9(data, 'blank',
      { academicYear: 116 } as never)).toThrow(/invalid/)
    expect(() => configureProjectTermV9(archiveProjectV9(data, 'blank'), 'blank',
      { academicYear: 116, semester: 'first' })).toThrow()
  })

  it('keeps date-free resources owned by their unset Project and excludes no invalid foreign references', () => {
    const source = configured()
    let data = createEmptyProjectV9(source.data, { name: '未設定' }, 'blank')
    data = createSchoolV9(data, 'blank', { name: '學校', color: '#123456' }, 'blank-school')
    data = createTeacherTimetableV9(data, 'blank', { name: '乙課表', teacherName: '乙' }, 'teacher-b')
    data = createTeacherSubjectV9(data, 'blank', 'teacher-b', math, 'subject-b')
    expect(isCompatibleAppDataV9(data)).toBe(true)
    expect(asV8ValidationProjection(data).projects).toEqual(source.data.projects)
    expect(data.projects.find((item) => item.id === 'blank')?.term).toBeNull()
    expect(isCompatibleAppDataV9({ ...data, schools: [...data.schools,
      { id: 'foreign', projectId: 'missing', name: '錯誤', color: '#123456' }] })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, subjects: data.subjects.map((item) => ({ ...item, timetableId: 'teacher-a' })) })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, subjects: [...data.subjects,
      { ...data.subjects[0], id: 'duplicate-name' }] })).toBe(false)
    expect(isCompatibleAppDataV9({ ...data, schools: [...data.schools,
      { id: source.unit.id, projectId: 'blank', name: '衝突', color: '#123456' }] })).toBe(false)
    expect(() => createTeacherTimetableV9(data, source.projectId,
      { name: '衝突', teacherName: '丙' }, 'teacher-b')).toThrow()
    const archived = archiveProjectV9(data, 'blank')
    expect(() => createTeacherSubjectV9(archived, 'blank', 'teacher-b', { ...math, name: '英文' }, 'new-subject')).toThrow()
  })

  it('preserves unset resources during configured Project operations, copying and deletion', () => {
    const source = configured()
    let data = createEmptyProjectV9(source.data, { name: '未設定' }, 'blank')
    data = createSchoolV9(data, 'blank', { name: '乙校', color: '#123456' }, 'blank-school')
    data = createTeachingUnitV9(data, 'blank', { schoolId: 'blank-school', name: '高中部',
      schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31',
      periods: source.unit.periods,
      weekCycle: { enabled: true, anchorDate: '2027-08-01', anchorPattern: 'A' } }, 'blank-unit')
    data = createTeacherTimetableV9(data, 'blank', { name: '乙課表', teacherName: '乙' }, 'teacher-b')
    data = createTeacherSubjectV9(data, 'blank', 'teacher-b', math, 'subject-b')
    data = configureTeacherSubjectV9(data, 'blank', 'teacher-b', 'blank-unit', 'subject-b', 'blank-relation')
    data = createClassV9(data, 'blank', { teachingUnitId: 'blank-unit', grade: 1, classNumber: 1 }, 'blank-class')
    const before = JSON.stringify(data)
    const updated = updateTeacherTimetableV9(data, source.projectId, 'teacher-a', { name: '更新', teacherName: '甲' })
    expect(updated.timetables.find((item) => item.id === 'teacher-b')).toEqual(data.timetables.find((item) => item.id === 'teacher-b'))
    const schools = updateSchoolV9(data, source.projectId, source.unit.schoolId, { name: '甲校更新', color: '#123456' })
    expect(schools.schools.find((item) => item.id === 'blank-school')).toEqual(data.schools.find((item) => item.id === 'blank-school'))
    let serial = 0
    const copied = copyProjectV9(data, { sourceProjectId: source.projectId, name: '新學期', academicYear: 116,
      semester: 'second', units: [{ sourceUnitId: source.unit.id, sourceEffectiveDate: '2026-09-01',
        startDate: '2027-02-01', endDate: '2027-07-31', anchorDate: '2027-02-01', anchorPattern: 'A' }] }, () => `copy-${++serial}`)
    expect(copied.projects.find((item) => item.id === 'blank')).toEqual(data.projects.find((item) => item.id === 'blank'))
    expect(copied.subjects).toEqual(data.subjects)
    expect(copied.projects.at(-1)?.term).toEqual({ academicYear: 116, semester: 'second', customLabel: undefined })
    expect(copied.timetables.find((item) => item.id === 'teacher-b')).toEqual(data.timetables.find((item) => item.id === 'teacher-b'))
    expect(copied.teachingUnits.find((item) => item.id === 'blank-unit'))
      .toEqual(data.teachingUnits.find((item) => item.id === 'blank-unit'))
    expect(copied.classes.find((item) => item.id === 'blank-class'))
      .toEqual(data.classes.find((item) => item.id === 'blank-class'))
    expect(copied.teachingUnitSubjects.find((item) => item.id === 'blank-relation'))
      .toEqual(data.teachingUnitSubjects.find((item) => item.id === 'blank-relation'))
    expect(isCompatibleAppDataV9(copied)).toBe(true)
    expect(JSON.stringify(data)).toBe(before)
    const withEmpty = createEmptyProjectV9(copied, { name: '可刪除' }, 'delete-me')
    const deleted = deleteEmptyProjectV9(withEmpty, 'delete-me', true)
    expect(deleted.projects).toEqual(copied.projects)
    expect(deleted.subjects).toEqual(copied.subjects)
    expect(() => deleteEmptyProjectV9(copied, 'blank', true)).toThrow(/不能級聯刪除/)
  })

  it('selects unset Projects locally, reconciles Timetables and preserves null in every presenter', () => {
    const source = configured()
    let data = createEmptyProjectV9(source.data, { name: '未設定' }, 'blank')
    expect(selectFormalProjectV9(data, 'blank')).toEqual({ projectId: 'blank', timetableId: null })
    expect(() => selectFormalTimetableV9(data, { projectId: 'blank', timetableId: null }, 'teacher-a')).toThrow()
    data = createTeacherTimetableV9(data, 'blank', { name: '乙課表', teacherName: '乙' }, 'teacher-b')
    expect(selectFormalProjectV9(data, 'blank').timetableId).toBe('teacher-b')
    expect(switchActiveProjectV9(data, 'blank').activeProjectId).toBe('blank')
    expect(listFormalProjectsV9(data).find((item) => item.id === 'blank')?.term).toBeNull()
    const selection = { projectId: 'blank', timetableId: 'teacher-b', teachingUnitId: null }
    expect(presentFormalSubjectManagementV9(data, selection).project?.term).toBeNull()
    expect(presentFormalClassManagementV9(data, selection).project?.term).toBeNull()
  })
})

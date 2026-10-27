import { describe, expect, it } from 'vitest'
import type { AppDataV9 } from '../types/v9'
import { archiveProjectV9, createClassV9 } from './managementV9'
import { createEmptyAppDataV8 } from './storageV8'
import { createBlankProjectV9, createTeacherTimetableV9, createTeacherSubjectV9,
  configureTeacherSubjectV9, deleteTeacherSubjectV9, deleteTeacherTimetableV9,
  duplicateTeacherTimetableV9, renameTeacherSubjectV9, switchActiveProjectV9,
  createTeachingUnitV9, getTeacherSubjectImpactV9, unconfigureTeacherSubjectV9,
  TeacherSubjectV9Error } from './teacherSubjectsV9'
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

function operationError(operation: () => unknown): TeacherSubjectV9Error {
  try { operation() } catch (cause) {
    if (cause instanceof TeacherSubjectV9Error) return cause
    throw cause
  }
  throw new Error('Expected TeacherSubjectV9Error')
}

function configuredFixture() {
  const initial = fixture()
  let { data } = initial
  const { projectId } = initial
  const unit = data.teachingUnits[0]
  data = createClassV9(data, projectId,
    { teachingUnitId: unit.id, grade: 1, classNumber: 1 }, 'class-a')
  data = createTeacherSubjectV9(data, projectId, 'teacher-a', math, 'subject-a')
  data = configureTeacherSubjectV9(data, projectId, 'teacher-a', unit.id, 'subject-a', 'relation-a')
  return { ...initial, data, unit, schoolClass: data.classes.find((item) => item.id === 'class-a')! }
}

function dateAfter(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function withReference(kind: 'lesson' | 'historical' | 'change' | 'one-off' | 'progress') {
  const configured = configuredFixture()
  const { data, projectId, unit, schoolClass } = configured
  const lesson = {
    id: 'lesson-a', seriesId: 'series-a', projectId, timetableId: 'teacher-a',
    teachingUnitId: unit.id, subjectId: 'subject-a', classId: schoolClass.id,
    day: 1 as const, periodId: unit.periods[0].id, weekPattern: 'every' as const,
    effectiveStart: unit.startDate, effectiveEnd: unit.endDate,
  }
  let referenced: AppDataV9
  if (kind === 'lesson') referenced = { ...data, recurringLessons: [lesson] }
  else if (kind === 'historical') referenced = { ...data, recurringLessons: [
    { ...lesson, id: 'lesson-history', effectiveEnd: unit.startDate },
    { ...lesson, id: 'lesson-current', effectiveStart: dateAfter(unit.startDate, 1) },
  ] }
  else if (kind === 'change') referenced = { ...data, overrides: [{
    id: 'change-a', projectId, timetableId: 'teacher-a', teachingUnitId: unit.id,
    date: unit.startDate, periodId: unit.periods[0].id, action: 'replace',
    replacement: { subjectId: 'subject-a', classId: schoolClass.id },
  }] }
  else if (kind === 'one-off') referenced = { ...data, oneOffLessons: [{
    id: 'one-off-a', projectId, timetableId: 'teacher-a', teachingUnitId: unit.id,
    classId: schoolClass.id, subjectId: 'subject-a', date: unit.startDate,
    purpose: 'extra', time: { mode: 'period', periodId: unit.periods[0].id },
  }] }
  else referenced = { ...data, teachingProgress: [{
    id: '123e4567-e89b-42d3-a456-426614174000', projectId, timetableId: 'teacher-a',
    teachingUnitId: unit.id, classId: schoolClass.id, subjectId: 'subject-a',
    content: { chapter: '第一章', unit: '', note: '' }, previousProgress: null,
    createdAt: '2026-10-27T01:00:00.000Z', updatedAt: '2026-10-27T01:00:00.000Z',
  }] }
  expect(isCompatibleAppDataV9(referenced)).toBe(true)
  return { ...configured, data: referenced }
}

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

  it('removes only the selected unreferenced configuration and retains the Subject after its last configuration', () => {
    const source = configuredFixture()
    const removed = unconfigureTeacherSubjectV9(
      source.data, source.projectId, 'teacher-a', source.unit.id, 'subject-a',
    )
    expect(removed.teachingUnitSubjects.some((item) => item.id === 'relation-a')).toBe(false)
    expect(removed.subjects).toContainEqual(expect.objectContaining({
      id: 'subject-a', projectId: source.projectId, timetableId: 'teacher-a',
    }))
    expect(isCompatibleAppDataV9(removed)).toBe(true)
  })

  it.each([
    ['lesson', 'lesson', false],
    ['historical', 'lesson', true],
    ['change', 'change', false],
    ['one-off', 'one-off', false],
    ['progress', 'progress', false],
  ] as const)('blocks unconfiguration for a %s reference with structured impact', (fixtureKind, referenceKind, historical) => {
    const source = withReference(fixtureKind)
    const impact = getTeacherSubjectImpactV9(source.data, source.projectId, 'teacher-a', 'subject-a')
    expect(impact.documentCompatible).toBe(true)
    expect(impact.configurationImpacts[0].blockedReferences).toContainEqual(expect.objectContaining({
      kind: referenceKind, projectId: source.projectId, timetableId: 'teacher-a',
      teachingUnitId: source.unit.id, scope: 'owned', historical,
    }))
    const error = operationError(() => unconfigureTeacherSubjectV9(
      source.data, source.projectId, 'teacher-a', source.unit.id, 'subject-a',
    ))
    expect(error).toMatchObject({
      code: 'configuration-referenced',
      details: { configuration: { id: 'relation-a' }, references: expect.any(Array) },
    })
    expect(error.details?.references).toContainEqual(expect.objectContaining({ kind: referenceKind, historical }))
    const deleteError = operationError(() => deleteTeacherSubjectV9(
      source.data, source.projectId, 'teacher-a', 'subject-a',
    ))
    expect(deleteError.code).toBe('subject-referenced')
    expect(deleteError.details?.references).toContainEqual(expect.objectContaining({ kind: referenceKind, historical }))
  })

  it('reports archived and historical ownership without permitting an archived mutation', () => {
    const source = withReference('historical')
    const archived = archiveProjectV9(source.data, source.projectId, '2026-10-27T02:00:00.000Z')
    expect(isCompatibleAppDataV9(archived)).toBe(true)
    const impact = getTeacherSubjectImpactV9(archived, source.projectId, 'teacher-a', 'subject-a')
    expect(impact.archivedProjectIds).toContain(source.projectId)
    expect(impact.historicalReferences).toContainEqual(expect.objectContaining({
      id: 'lesson-history', archived: true, historical: true,
    }))
    expect(operationError(() => unconfigureTeacherSubjectV9(
      archived, source.projectId, 'teacher-a', source.unit.id, 'subject-a',
    )).code).toBe('invalid-timetable')
  })

  it('rejects cross-Project, cross-Timetable and wrong-TeachingUnit unconfiguration', () => {
    const source = configuredFixture()
    let data = createTeachingUnitV9(source.data, source.projectId, {
      schoolId: source.unit.schoolId, name: '國中部', schoolLevel: 'junior-high',
      startDate: source.unit.startDate, endDate: source.unit.endDate,
      periods: source.unit.periods, weekCycle: source.unit.weekCycle,
    }, 'same-project-other-unit')
    expect(operationError(() => unconfigureTeacherSubjectV9(
      data, source.projectId, 'teacher-a', 'same-project-other-unit', 'subject-a',
    )).code).toBe('configuration-not-found')

    data = createBlankProjectV9(data, {
      name: 'Project B', academicYear: 116, semester: 'second',
      startDate: '2027-02-01', endDate: '2027-07-31',
    }, source.id)
    const projectB = data.activeProjectId!
    const unitB = data.teachingUnits.find((item) => item.projectId === projectB)!
    data = createTeacherTimetableV9(data, projectB, { name: '丙課表', teacherName: '丙' }, 'teacher-c')

    expect(operationError(() => unconfigureTeacherSubjectV9(
      data, projectB, 'teacher-c', unitB.id, 'subject-a',
    )).code).toBe('subject-not-found')
    expect(operationError(() => unconfigureTeacherSubjectV9(
      data, source.projectId, 'teacher-b', source.unit.id, 'subject-a',
    )).code).toBe('subject-not-found')
    expect(operationError(() => unconfigureTeacherSubjectV9(
      data, source.projectId, 'teacher-a', unitB.id, 'subject-a',
    )).code).toBe('invalid-teaching-unit')
    expect(operationError(() => unconfigureTeacherSubjectV9(
      data, source.projectId, 'teacher-a', source.unit.id, 'missing-subject',
    )).code).toBe('subject-not-found')
    expect(data.teachingUnitSubjects).toContainEqual(expect.objectContaining({ id: 'relation-a' }))
  })

  it('keeps another teacher configuration untouched when both teachers use the same Subject name', () => {
    const source = configuredFixture()
    let data = createTeacherSubjectV9(source.data, source.projectId, 'teacher-b', math, 'subject-b')
    data = configureTeacherSubjectV9(
      data, source.projectId, 'teacher-b', source.unit.id, 'subject-b', 'relation-b',
    )
    const removed = unconfigureTeacherSubjectV9(
      data, source.projectId, 'teacher-a', source.unit.id, 'subject-a',
    )
    expect(removed.teachingUnitSubjects.some((item) => item.id === 'relation-a')).toBe(false)
    expect(removed.teachingUnitSubjects).toContainEqual(expect.objectContaining({
      id: 'relation-b', subjectId: 'subject-b', teachingUnitId: source.unit.id,
    }))
    expect(removed.subjects.filter((item) => item.name === math.name)).toHaveLength(2)
  })

  it('blocks configured deletion, then permits unconfigure, permanent deletion and same-name recreation with a new ID', () => {
    const source = configuredFixture()
    const configuredError = operationError(() => deleteTeacherSubjectV9(
      source.data, source.projectId, 'teacher-a', 'subject-a',
    ))
    expect(configuredError).toMatchObject({
      code: 'subject-referenced', details: { configurations: [{ id: 'relation-a' }] },
    })
    const unconfigured = unconfigureTeacherSubjectV9(
      source.data, source.projectId, 'teacher-a', source.unit.id, 'subject-a',
    )
    const deleted = deleteTeacherSubjectV9(unconfigured, source.projectId, 'teacher-a', 'subject-a')
    const recreated = createTeacherSubjectV9(deleted, source.projectId, 'teacher-a', math, 'subject-a-recreated')
    expect(recreated.subjects.some((item) => item.id === 'subject-a')).toBe(false)
    expect(recreated.subjects).toContainEqual(expect.objectContaining({
      id: 'subject-a-recreated', name: math.name, timetableId: 'teacher-a',
    }))
  })

  it('keeps a custom Subject unconfigured until an explicit TeachingUnit configuration', () => {
    const source = fixture()
    const created = createTeacherSubjectV9(source.data, source.projectId, 'teacher-a', math, 'custom-subject')
    expect(created.subjects).toContainEqual(expect.objectContaining({ id: 'custom-subject' }))
    expect(created.teachingUnitSubjects.some((item) => item.subjectId === 'custom-subject')).toBe(false)
    expect(getTeacherSubjectImpactV9(created, source.projectId, 'teacher-a', 'custom-subject'))
      .toMatchObject({ configurations: [], references: [], deletion: { blocked: false } })
  })

  it('reports normalized name and short-name conflicts only inside the same teacher Timetable', () => {
    const source = fixture()
    let data = createTeacherSubjectV9(source.data, source.projectId, 'teacher-a', math, 'subject-a')
    data = createTeacherSubjectV9(data, source.projectId, 'teacher-a', {
      ...math, name: '物理', shortName: '物',
    }, 'subject-physics')
    expect(operationError(() => renameTeacherSubjectV9(data, source.projectId, 'teacher-a', 'subject-physics', {
      ...math, name: ' 數學 ', shortName: '物理',
    }))).toMatchObject({ code: 'duplicate-name', details: { existingSubject: { id: 'subject-a' } } })
    expect(operationError(() => renameTeacherSubjectV9(data, source.projectId, 'teacher-a', 'subject-physics', {
      ...math, name: '自然科學', shortName: ' 數 ',
    }))).toMatchObject({ code: 'duplicate-short-name', details: { existingSubject: { id: 'subject-a' } } })

    data = createTeacherSubjectV9(data, source.projectId, 'teacher-b', math, 'subject-b')
    data = createBlankProjectV9(data, { name: 'Project B', academicYear: 116, semester: 'second',
      startDate: '2027-02-01', endDate: '2027-07-31' }, source.id)
    const projectB = data.activeProjectId!
    data = createTeacherTimetableV9(data, projectB, { name: '丙課表', teacherName: '丙' }, 'teacher-c')
    data = createTeacherSubjectV9(data, projectB, 'teacher-c', math, 'subject-c')
    expect(data.subjects.filter((item) => item.name === math.name)).toHaveLength(3)
    expect(isCompatibleAppDataV9(data)).toBe(true)
  })

  it('reports an unresolved legacy Change as unknown scope and fails closed before mutation', () => {
    const source = configuredFixture()
    const legacy: AppDataV9 = { ...source.data, overrides: [{
      id: 'legacy-change', projectId: null, timetableId: null, teachingUnitId: null,
      date: source.unit.startDate, periodId: source.unit.periods[0].id, action: 'cancel',
      originalLessonId: 'missing-legacy-lesson',
    }] }
    expect(isCompatibleAppDataV9(legacy)).toBe(true)
    const impact = getTeacherSubjectImpactV9(legacy, source.projectId, 'teacher-a', 'subject-a')
    expect(impact).toMatchObject({
      documentCompatible: true,
      unknownScopeReferences: [{ kind: 'change', id: 'legacy-change', scope: 'unknown' }],
      deletion: { blocked: true },
    })
    expect(impact.configurationImpacts[0].blockedReferences)
      .toContainEqual(expect.objectContaining({ id: 'legacy-change', scope: 'unknown' }))
    expect(operationError(() => unconfigureTeacherSubjectV9(
      legacy, source.projectId, 'teacher-a', source.unit.id, 'subject-a',
    ))).toMatchObject({ code: 'configuration-referenced',
      details: { references: [{ id: 'legacy-change', scope: 'unknown' }] } })
    expect(operationError(() => deleteTeacherSubjectV9(
      legacy, source.projectId, 'teacher-a', 'subject-a',
    ))).toMatchObject({ code: 'subject-referenced',
      details: { references: [{ id: 'legacy-change', scope: 'unknown' }] } })
  })
})

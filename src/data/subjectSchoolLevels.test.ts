import { describe, expect, it } from 'vitest'
import type { AppDataV7, SchoolLevel } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { deleteSubject, removeSubjectSchoolLevel, SubjectManagementError } from './subjectsV5'
import { isCompatibleAppDataV7, isSafeAppDataV7Update } from './validators/v7'
import { subjectsForLevel } from '../lib/subjects'

type ReferenceKind = 'recurring' | 'replacement' | 'one-off'
function fixture(kind?: ReferenceKind): AppDataV7 {
  const data = migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
  const lesson = data.recurringLessons[0]
  data.teachingUnits[0].schoolLevel = 'junior-high'
  data.subjects[0].applicableSchoolLevels = ['junior-high', 'senior-high']
  data.recurringLessons = kind === 'recurring' ? [lesson] : []
  if (kind === 'replacement') data.overrides.push({ id: 'replacement', projectId: lesson.projectId,
    timetableId: lesson.timetableId, teachingUnitId: lesson.teachingUnitId, date: '2026-09-07',
    periodId: lesson.periodId, action: 'replace', replacement: { subjectId: lesson.subjectId, classId: lesson.classId } })
  if (kind === 'one-off') data.oneOffLessons.push({ id: 'one-off', projectId: lesson.projectId,
    timetableId: lesson.timetableId, teachingUnitId: lesson.teachingUnitId, subjectId: lesson.subjectId,
    classId: lesson.classId, date: '2026-09-07', purpose: 'extra', time: { mode: 'period', periodId: lesson.periodId } })
  expect(isCompatibleAppDataV7(data)).toBe(true)
  return data
}

function code(operation: () => unknown) {
  try { operation() } catch (error) { return error instanceof SubjectManagementError ? error.code : 'unexpected' }
  return 'none'
}

describe('removeSubjectSchoolLevel', () => {
  it('removes only the requested global association, keeping identity, display, origin and all other data', () => {
    const data = fixture()
    const before = structuredClone(data)
    const subject = data.subjects[0]
    const next = removeSubjectSchoolLevel(data, subject.id, 'junior-high', true)
    expect(next).toEqual({ ...data, subjects: [{ ...subject, applicableSchoolLevels: ['senior-high'] }, ...data.subjects.slice(1)] })
    expect(subjectsForLevel(next.subjects, 'junior-high').some((item) => item.id === subject.id)).toBe(false)
    expect(subjectsForLevel(next.subjects, 'senior-high').some((item) => item.id === subject.id)).toBe(true)
    expect(isSafeAppDataV7Update(data, next)).toBe(true)
    expect(data).toEqual(before)
  })

  it.each(['recurring', 'replacement', 'one-off'] as const)('rejects a used junior-high level with a %s reference', (kind) => {
    const data = fixture(kind)
    const before = structuredClone(data)
    expect(code(() => removeSubjectSchoolLevel(data, data.subjects[0].id, 'junior-high', true))).toBe('level-in-use')
    expect(data).toEqual(before)
  })

  it.each(['recurring', 'replacement', 'one-off'] as const)('preserves a %s reference in the retained senior-high level', (kind) => {
    const data = fixture(kind)
    data.teachingUnits[0].schoolLevel = 'senior-high'
    const next = removeSubjectSchoolLevel(data, data.subjects[0].id, 'junior-high', true)
    expect(next.recurringLessons).toEqual(data.recurringLessons)
    expect(next.overrides).toEqual(data.overrides)
    expect(next.oneOffLessons).toEqual(data.oneOffLessons)
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(code(() => deleteSubject(next, data.subjects[0].id, true))).toBe('referenced')
  })

  it('rejects unknown-level references with an explicit reason', () => {
    const data = fixture('replacement')
    Object.assign(data.overrides[0], { projectId: null, timetableId: null, teachingUnitId: null })
    expect(isCompatibleAppDataV7(data)).toBe(true)
    expect(() => removeSubjectSchoolLevel(data, data.subjects[0].id, 'junior-high', true)).toThrow('引用資料無法判斷學制')
  })

  it('refuses the last association without falling back to other or deleting the subject', () => {
    const data = fixture()
    data.subjects[0].applicableSchoolLevels = ['junior-high']
    const before = structuredClone(data)
    expect(code(() => removeSubjectSchoolLevel(data, data.subjects[0].id, 'junior-high', true))).toBe('last-level')
    expect(data).toEqual(before)
  })

  it.each(['recurring', 'replacement', 'one-off'] as const)('protects %s references across projects, timetables and archives', (kind) => {
    const data = fixture(kind)
    data.projects[0].archivedAt = '2027-02-01T00:00:00.000Z'
    data.projects.push({ ...data.projects[0], id: 'active-project', archivedAt: undefined })
    data.timetables.push({ ...data.timetables[0], id: 'active-timetable', projectId: 'active-project' })
    data.activeProjectId = 'active-project'
    expect(isCompatibleAppDataV7(data)).toBe(true)
    expect(code(() => removeSubjectSchoolLevel(data, data.subjects[0].id, 'junior-high', true))).toBe('level-in-use')
  })

  it.each(['historical', 'future'] as const)('protects the subject used only by a %s recurring version', (version) => {
    const data = fixture('recurring')
    const lesson = data.recurringLessons[0]
    if (version === 'historical') {
      lesson.effectiveEnd = '2026-09-13'
      data.recurringLessons.push({ ...lesson, id: 'later-version', subjectId: data.subjects[1].id,
        effectiveStart: '2026-09-14', effectiveEnd: '2027-01-20' })
    } else lesson.effectiveStart = '2027-01-04'
    expect(isCompatibleAppDataV7(data)).toBe(true)
    expect(code(() => removeSubjectSchoolLevel(data, data.subjects[0].id, 'junior-high', true))).toBe('level-in-use')
  })

  it('requires confirmation and rejects missing subjects, invalid levels and stale associations', () => {
    const data = fixture()
    const id = data.subjects[0].id
    expect(code(() => removeSubjectSchoolLevel(data, id, 'junior-high'))).toBe('confirmation-required')
    expect(code(() => removeSubjectSchoolLevel(data, 'missing', 'junior-high', true))).toBe('not-found')
    expect(code(() => removeSubjectSchoolLevel(data, id, 'invalid' as SchoolLevel, true))).toBe('invalid')
    expect(code(() => removeSubjectSchoolLevel(data, id, 'other', true))).toBe('invalid')
    const next = removeSubjectSchoolLevel(data, id, 'junior-high', true)
    expect(code(() => removeSubjectSchoolLevel(next, id, 'junior-high', true))).toBe('invalid')
  })

  it('preserves readable legacy names, duplicate short names and old color formats verbatim', () => {
    const data = fixture()
    Object.assign(data.subjects[0], { name: ' Cafe\u0301 ', shortName: ' CF ', color: 'rgb(12, 34, 56)' })
    Object.assign(data.subjects[1], { name: 'Café', shortName: 'cf' })
    expect(isCompatibleAppDataV7(data)).toBe(true)
    const next = removeSubjectSchoolLevel(data, data.subjects[0].id, 'junior-high', true)
    expect(next.subjects[0]).toEqual({ ...data.subjects[0], applicableSchoolLevels: ['senior-high'] })
    expect(isCompatibleAppDataV7(next)).toBe(true)
  })

  it('leaves explicit global deletion governed by its existing confirmation and zero-reference rules', () => {
    const data = fixture()
    const id = data.subjects[0].id
    const next = removeSubjectSchoolLevel(data, id, 'junior-high', true)
    expect(next.subjects.some((subject) => subject.id === id)).toBe(true)
    expect(code(() => deleteSubject(next, id))).toBe('confirmation-required')
    expect(deleteSubject(next, id, true).subjects.some((subject) => subject.id === id)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { resolveProjectDay } from '../lib/scheduleV4'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { initialData } from './seed'
import { copyProject } from './projectRuntime'
import { replaceLessonOnDate } from './lessonChangesV4'
import { addSubjectForLevel, analyzeSubjectReferences, createSubject, deleteSubject, getSubjectImpact, searchSubjects, SubjectManagementError, updateSubject, type SubjectDraft } from './subjectsV5'

const setup = () => migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))
const draft: SubjectDraft = { name: ' 科學 ', shortName: ' 科 ', color: '#123AbC', applicableSchoolLevels: ['junior-high'] }
const errorCode = (operation: () => unknown) => {
  try { operation() } catch (reason) { return reason instanceof SubjectManagementError ? reason.code : 'unexpected' }
  return 'none'
}

describe('global subject management', () => {
  it('creates one subject for the current level and can extend it to several levels without changing its ID', () => {
    const data = createSubject(setup(), draft, 'science')
    expect(data.subjects.at(-1)).toMatchObject({ id: 'science', name: '科學', shortName: '科', color: '#123AbC', applicableSchoolLevels: ['junior-high'] })
    const expanded = updateSubject(data, 'science', { ...draft, applicableSchoolLevels: ['junior-high', 'senior-high', 'other'] })
    expect(expanded.subjects.at(-1)?.id).toBe('science')
    expect(expanded.subjects.at(-1)?.applicableSchoolLevels).toEqual(['junior-high', 'senior-high', 'other'])
    expect(addSubjectForLevel(setup(), '新增科目', 'senior-high', 'new').subjects.at(-1)?.applicableSchoolLevels).toEqual(['senior-high'])
  })

  it('rejects invalid fields and duplicate names or short names with the existing subject attached', () => {
    const data = setup()
    for (const invalid of [
      { ...draft, name: '  ' }, { ...draft, shortName: ' ' }, { ...draft, color: '#12345' },
      { ...draft, applicableSchoolLevels: [] },
      { ...draft, applicableSchoolLevels: ['junior-high', 'junior-high'] as SubjectDraft['applicableSchoolLevels'] },
      { ...draft, applicableSchoolLevels: ['invalid'] as unknown as SubjectDraft['applicableSchoolLevels'] },
    ]) expect(errorCode(() => createSubject(data, invalid, 'bad'))).toBe('invalid')
    const duplicate = { ...draft, name: ` ${data.subjects[0].name} ` }
    try { createSubject(data, duplicate, 'same') } catch (reason) {
      expect(reason).toBeInstanceOf(SubjectManagementError)
      expect((reason as SubjectManagementError).code).toBe('duplicate-name')
      expect((reason as SubjectManagementError).details?.existingSubject?.id).toBe(data.subjects[0].id)
    }
    expect(errorCode(() => createSubject(data, { ...draft, shortName: data.subjects[0].shortName }, 'same-short'))).toBe('duplicate-short-name')
  })

  it('requires confirmation for global display changes and updates all project views through one subject', () => {
    const data = setup()
    const subject = data.subjects[0]
    const edited = { name: '新國文', shortName: '新國', color: '#112233', applicableSchoolLevels: [...(subject.applicableSchoolLevels ?? [])] }
    expect(errorCode(() => updateSubject(data, subject.id, edited))).toBe('confirmation-required')
    const result = updateSubject(data, subject.id, edited, true)
    expect(result.subjects.find((item) => item.id === subject.id)).toMatchObject({ id: subject.id, name: '新國文', color: '#112233' })
    expect(result.recurringLessons).toEqual(data.recurringLessons)
    expect(resolveProjectDay(result, result.projects[0].id, new Date(2026, 8, 7)).find((item) => item.subjectId === subject.id)).toMatchObject({ subjectName: '新國文', subjectColor: '#112233' })
    expect(getSubjectImpact(data, subject.id).projectIds).toEqual([data.projects[0].id])
  })

  it('blocks shrinking a level used by historical versions in an archived project', () => {
    const data = setup()
    data.teachingUnits[0].schoolLevel = 'senior-high'
    const lesson = data.recurringLessons[0]
    lesson.effectiveEnd = '2026-09-13'
    data.recurringLessons.push({ ...lesson, id: 'c1-v2', effectiveStart: '2026-09-14', effectiveEnd: '2027-01-20' })
    data.projects[0].archivedAt = '2027-02-01T00:00:00.000Z'
    data.activeProjectId = null
    const impact = getSubjectImpact(data, lesson.subjectId)
    expect(impact.references.filter((item) => item.historical && item.archived).length).toBeGreaterThanOrEqual(1)
    const subject = impact.subject
    const next = { name: subject.name, shortName: subject.shortName, color: subject.color, applicableSchoolLevels: ['junior-high', 'other'] as SubjectDraft['applicableSchoolLevels'] }
    expect(errorCode(() => updateSubject(data, subject.id, next, true))).toBe('level-in-use')
    expect(errorCode(() => deleteSubject(data, subject.id, true))).toBe('referenced')
  })

  it('blocks deletion and shrink when an unassigned override references the subject', () => {
    const data = createSubject(setup(), { ...draft, applicableSchoolLevels: ['junior-high', 'other'] }, 'unassigned')
    const subject = data.subjects.at(-1)!
    data.overrides.push({ id: 'orphan', projectId: null, teachingUnitId: null, action: 'replace', date: '2026-09-07', periodId: 1, replacement: { subjectId: subject.id, classId: 'unknown' } })
    expect(analyzeSubjectReferences(data, subject.id)).toMatchObject([{ kind: 'override', id: 'orphan', schoolLevel: null }])
    expect(errorCode(() => updateSubject(data, subject.id, { ...draft, applicableSchoolLevels: ['junior-high'] }, true))).toBe('level-in-use')
    expect(errorCode(() => deleteSubject(data, subject.id, true))).toBe('referenced')
  })

  it('counts a dated replacement even when no fixed lesson uses its subject', () => {
    const initial = createSubject(setup(), { ...draft, applicableSchoolLevels: ['other', 'junior-high'] }, 'replacement-only')
    const data = replaceLessonOnDate(initial, 'c1', '2026-09-07', { subjectId: 'replacement-only', classId: initial.recurringLessons[0].classId }, () => 'replace-only')
    const subject = data.subjects.find((item) => item.id === 'replacement-only')!
    const impact = getSubjectImpact(data, subject.id)
    expect(impact.references).toMatchObject([{ kind: 'override', id: 'replace-only' }])
    expect(errorCode(() => updateSubject(data, subject.id, { ...draft, applicableSchoolLevels: ['senior-high'] }, true))).toBe('level-in-use')
    expect(errorCode(() => deleteSubject(data, subject.id, true))).toBe('referenced')
  })

  it('deletes only unreferenced subjects after confirmation and searches the selected level', () => {
    const data = createSubject(setup(), draft, 'science')
    expect(errorCode(() => deleteSubject(data, 'science'))).toBe('confirmation-required')
    expect(deleteSubject(data, 'science', true).subjects.some((item) => item.id === 'science')).toBe(false)
    expect(searchSubjects(data, undefined, '科')).toMatchObject({ state: 'select-level', subjects: [] })
    expect(searchSubjects(data, 'senior-high', '科學')).toMatchObject({ state: 'no-results', subjects: [] })
    expect(searchSubjects(data, 'junior-high', ' 科學 ').subjects.map((item) => item.id)).toContain('science')
    expect(searchSubjects(data, 'junior-high', ' 科 ').subjects.map((item) => item.id)).toContain('science')
    const none = { ...data, subjects: [data.subjects.at(-1)!] }
    expect(searchSubjects(none, 'other', '')).toMatchObject({ state: 'no-subjects', subjects: [] })
  })

  it('counts copied projects and their references before changing shared metadata', () => {
    const data = setup()
    const unit = data.teachingUnits[0]
    const copied = copyProject(data, {
      sourceProjectId: data.projects[0].id, name: '下一學期', academicYear: 116, semester: 'first',
      units: [{ sourceUnitId: unit.id, startDate: '2027-08-30', endDate: '2028-01-19', anchorDate: '2027-08-30', anchorPattern: 'A' }],
    }, (() => { let index = 0; return () => `copy-${++index}` })())
    const impact = getSubjectImpact(copied, 'chinese')
    expect(impact.projectIds).toHaveLength(2)
    expect(impact.references.filter((item) => item.kind === 'lesson').length).toBe(data.recurringLessons.filter((item) => item.subjectId === 'chinese').length * 2)
  })
})

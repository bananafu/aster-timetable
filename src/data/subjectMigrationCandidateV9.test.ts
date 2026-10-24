import { describe, expect, it } from 'vitest'
import { createEmptyAppDataV8 } from './storageV8'
import { createBlankProject } from './projectRuntimeV8'
import { createTeacherTimetableV8 } from './timetablesV8'
import { createSubject, configureSubjectForTeachingUnit } from './subjectsV8'
import { createClassV8 } from './classesV8'
import { createRecurringLessonV8 } from './recurringLessonsV8'
import { buildSubjectMigrationCandidateV9, type SubjectMigrationDecisionV9 } from './subjectMigrationCandidateV9'
import { isCompatibleAppDataV8 } from './validators/v8'
import { isCompatibleAppDataV9 } from './validators/v9'

function fixture() {
  let serial = 0
  let data = createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `base-${++serial}`)
  const projectId = data.activeProjectId!
  const unit = data.teachingUnits[0]
  data = createTeacherTimetableV8(data, projectId, { name: '甲', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV8(data, projectId, { name: '乙', teacherName: '乙' }, 'teacher-b')
  data = createSubject(data, projectId, { name: '數學', shortName: '數', color: '#123456',
    applicableSchoolLevels: ['senior-high'] }, 'subject-old')
  data = configureSubjectForTeachingUnit(data, projectId, unit.id, 'subject-old', 'relation-old')
  data = createClassV8(data, projectId, { teachingUnitId: unit.id, name: '一甲' }, 'class-a')
  data = createRecurringLessonV8(data, { projectId, timetableId: 'teacher-a',
    teachingUnitId: unit.id, classId: 'class-a', subjectId: 'subject-old',
    day: 1, periodId: unit.periods[0].id, weekPattern: 'every' }, 'lesson-a')
  data = createRecurringLessonV8(data, { projectId, timetableId: 'teacher-b',
    teachingUnitId: unit.id, classId: 'class-a', subjectId: 'subject-old',
    day: 1, periodId: unit.periods[0].id, weekPattern: 'every' }, 'lesson-b')
  return data
}

const explicitDecision: SubjectMigrationDecisionV9 = {
  sourceSubjectId: 'subject-old',
  owners: [{ timetableId: 'teacher-a', subjectId: 'subject-old' },
    { timetableId: 'teacher-b', subjectId: 'subject-b' }],
  relations: [{ sourceRelationId: 'relation-old', timetableId: 'teacher-a', relationId: 'relation-old' },
    { sourceRelationId: 'relation-old', timetableId: 'teacher-b', relationId: 'relation-b' }],
}

describe('explicit, read-only V8 to Timetable-owned Subject candidate', () => {
  it('preserves the input and maps each teacher to an independent Subject ID', () => {
    const source = fixture()
    const raw = JSON.stringify(source)
    expect(isCompatibleAppDataV8(source)).toBe(true)
    const result = buildSubjectMigrationCandidateV9(source, [explicitDecision])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(isCompatibleAppDataV9(result.candidate)).toBe(true)
    expect(isCompatibleAppDataV8(result.candidate)).toBe(false)
    expect(result.candidate.subjects).toMatchObject([
      { id: 'subject-old', timetableId: 'teacher-a', name: '數學' },
      { id: 'subject-b', timetableId: 'teacher-b', name: '數學' },
    ])
    expect(result.candidate.recurringLessons.map((item) => item.subjectId))
      .toEqual(['subject-old', 'subject-b'])
    expect(result.candidate.teachingUnitSubjects.map((item) => item.subjectId))
      .toEqual(['subject-old', 'subject-b'])
    expect(JSON.stringify(source)).toBe(raw)
  })

  it('refuses missing decisions and refuses silently dropping a configuration', () => {
    const source = fixture()
    expect(buildSubjectMigrationCandidateV9(source, []).issues)
      .toContainEqual(expect.objectContaining({ code: 'missing-decision', sourceSubjectId: 'subject-old' }))
    expect(buildSubjectMigrationCandidateV9(source, [{ ...explicitDecision, relations: [] }]).issues)
      .toContainEqual(expect.objectContaining({ code: 'missing-relation-assignment',
        sourceSubjectId: 'subject-old', referenceId: 'relation-old' }))
  })

  it('refuses an unassigned teacher, duplicate IDs, and an invalid source', () => {
    const source = fixture()
    const onlyFirst = { ...explicitDecision, owners: explicitDecision.owners.slice(0, 1),
      relations: explicitDecision.relations.slice(0, 1) }
    expect(buildSubjectMigrationCandidateV9(source, [onlyFirst]).issues)
      .toContainEqual(expect.objectContaining({ code: 'missing-reference-owner', referenceId: 'lesson-b' }))
    const collision = { ...explicitDecision, owners: explicitDecision.owners.map((item) =>
      ({ ...item, subjectId: 'subject-old' })) }
    expect(buildSubjectMigrationCandidateV9(source, [collision]).issues)
      .toContainEqual(expect.objectContaining({ code: 'missing-original-id' }))
    const invalid = { ...source, recurringLessons: source.recurringLessons.map((item) =>
      ({ ...item, classId: 'missing' })) }
    expect(buildSubjectMigrationCandidateV9(invalid, [explicitDecision]))
      .toMatchObject({ ok: false, issues: [{ code: 'invalid-source' }] })
  })
})

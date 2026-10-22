import { describe, expect, it } from 'vitest'
import type { AppDataV8 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import { createBlankProject } from './projectRuntimeV8'
import {
  configureSubjectForTeachingUnit,
  createSubjectForTeachingUnit,
  deleteSubject,
  removeSubjectFromTeachingUnit,
  SubjectV8ManagementError,
  type SubjectV8Draft,
} from './subjectsV8'
import {
  isSubjectConfiguredForTeachingUnit,
  selectSubjectsForTeachingUnit,
} from './subjectSelectorsV8'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

const base = () => migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))
const sharedDraft: SubjectV8Draft = {
  name: '國語文', shortName: '國語', color: '#A66D52',
  applicableSchoolLevels: ['junior-high', 'senior-high'],
}

function schoolScopeFixture(): AppDataV8 {
  const data = base()
  const projectId = data.projects[0].id
  const sourceUnit = data.teachingUnits[0]
  return {
    ...data,
    schools: [
      ...data.schools,
      { id: 'school-a', projectId, name: 'A 學校', color: '#123456' },
      { id: 'school-b', projectId, name: 'B 學校', color: '#654321' },
    ],
    teachingUnits: [
      ...data.teachingUnits,
      { ...structuredClone(sourceUnit), id: 'unit-a-junior', schoolId: 'school-a', name: 'A 國中部', schoolLevel: 'junior-high' },
      { ...structuredClone(sourceUnit), id: 'unit-a-senior', schoolId: 'school-a', name: 'A 高中部', schoolLevel: 'senior-high' },
      { ...structuredClone(sourceUnit), id: 'unit-b-senior', schoolId: 'school-b', name: 'B 高中部', schoolLevel: 'senior-high' },
    ],
  }
}

function code(action: () => unknown) {
  try { action(); return null } catch (cause) {
    return cause instanceof SubjectV8ManagementError ? cause.code : 'unknown'
  }
}

function withSharedSubject() {
  const data = schoolScopeFixture()
  const projectId = data.projects[0].id
  return createSubjectForTeachingUnit(
    data, projectId, 'unit-a-junior', sharedDraft, 'shared-chinese', 'config-a-junior-chinese',
  )
}

describe('TeachingUnitSubject V8 configuration domain', () => {
  it('isolates configuration by school and school level while sharing one Subject definition', () => {
    const first = withSharedSubject()
    const projectId = first.projects[0].id
    const snapshot = structuredClone(first)

    expect(selectSubjectsForTeachingUnit(first, projectId, 'unit-a-junior').map((subject) => subject.id))
      .toEqual(['shared-chinese'])
    expect(selectSubjectsForTeachingUnit(first, projectId, 'unit-a-senior')).toEqual([])
    expect(selectSubjectsForTeachingUnit(first, projectId, 'unit-b-senior')).toEqual([])
    expect(first).toEqual(snapshot)

    const bothLevels = configureSubjectForTeachingUnit(
      first, projectId, 'unit-a-senior', 'shared-chinese', 'config-a-senior-chinese',
    )
    const bothSchools = configureSubjectForTeachingUnit(
      bothLevels, projectId, 'unit-b-senior', 'shared-chinese', 'config-b-senior-chinese',
    )
    expect(bothSchools.subjects.filter((subject) => subject.id === 'shared-chinese')).toHaveLength(1)
    expect(selectSubjectsForTeachingUnit(bothSchools, projectId, 'unit-a-junior')[0].name).toBe('國語文')
    expect(selectSubjectsForTeachingUnit(bothSchools, projectId, 'unit-a-senior')[0].name).toBe('國語文')
    expect(selectSubjectsForTeachingUnit(bothSchools, projectId, 'unit-b-senior')[0].name).toBe('國語文')
  })

  it('removes one unreferenced configuration without affecting other TeachingUnits', () => {
    const first = withSharedSubject()
    const projectId = first.projects[0].id
    const configured = configureSubjectForTeachingUnit(
      first, projectId, 'unit-b-senior', 'shared-chinese', 'config-b-senior-chinese',
    )
    const removed = removeSubjectFromTeachingUnit(configured, projectId, 'unit-a-junior', 'shared-chinese')

    expect(isSubjectConfiguredForTeachingUnit(removed, projectId, 'unit-a-junior', 'shared-chinese')).toBe(false)
    expect(isSubjectConfiguredForTeachingUnit(removed, projectId, 'unit-b-senior', 'shared-chinese')).toBe(true)
    expect(removed.subjects.some((subject) => subject.id === 'shared-chinese')).toBe(true)
  })

  it('rejects duplicate pairs and blocks removal while schedule data references the configuration', () => {
    const configured = withSharedSubject()
    const projectId = configured.projects[0].id
    expect(code(() => configureSubjectForTeachingUnit(
      configured, projectId, 'unit-a-junior', 'shared-chinese', 'duplicate-pair',
    ))).toBe('already-configured')

    const sourceLesson = configured.recurringLessons[0]
    const schoolClass = {
      id: 'class-a-junior', projectId, teachingUnitId: 'unit-a-junior', name: '701', grade: 7, classNumber: 1,
    }
    const referenced: AppDataV8 = {
      ...configured,
      classes: [...configured.classes, schoolClass],
      recurringLessons: [...configured.recurringLessons, {
        ...sourceLesson,
        id: 'lesson-a-junior-chinese', seriesId: 'series-a-junior-chinese',
        teachingUnitId: 'unit-a-junior', classId: schoolClass.id, subjectId: 'shared-chinese',
      }],
    }
    expect(isCompatibleAppDataV8(referenced)).toBe(true)
    expect(code(() => removeSubjectFromTeachingUnit(
      referenced, projectId, 'unit-a-junior', 'shared-chinese',
    ))).toBe('configuration-referenced')
  })

  it('blocks permanent deletion while configured and prevents unlink-delete update bypasses', () => {
    const current = withSharedSubject()
    const projectId = current.projects[0].id
    expect(code(() => deleteSubject(current, projectId, 'shared-chinese', true))).toBe('configured')

    const unconfigured = removeSubjectFromTeachingUnit(current, projectId, 'unit-a-junior', 'shared-chinese')
    const deleted = deleteSubject(unconfigured, projectId, 'shared-chinese', true)
    expect(deleted.subjects.some((subject) => subject.id === 'shared-chinese')).toBe(false)
    expect(isSafeAppDataV8Update(current, deleted)).toBe(false)
  })

  it('keeps creation atomic when validation fails', () => {
    const data = withSharedSubject()
    const projectId = data.projects[0].id
    const snapshot = structuredClone(data)

    expect(code(() => createSubjectForTeachingUnit(
      data, projectId, 'unit-a-senior', sharedDraft, 'duplicate-subject', 'orphan-relation',
    ))).toBe('duplicate-name')
    expect(data).toEqual(snapshot)
    expect(data.subjects.some((subject) => subject.id === 'duplicate-subject')).toBe(false)
    expect(data.teachingUnitSubjects.some((relation) => relation.id === 'orphan-relation')).toBe(false)
  })

  it('does not leak configurations across Projects', () => {
    const first = withSharedSubject()
    const ids = ['project-b', 'school-project-b', 'unit-project-b', 'timetable-project-b']
    const data = createBlankProject(first, {
      name: 'Project B', teacherName: 'Teacher B', academicYear: 116, semester: 'first',
      startDate: '2027-08-30', endDate: '2028-01-19',
    }, () => ids.shift()!, '2027-08-01T00:00:00.000Z')

    expect(selectSubjectsForTeachingUnit(data, 'project-b', 'unit-project-b')).toEqual([])
    expect(code(() => configureSubjectForTeachingUnit(
      data, 'project-b', 'unit-project-b', 'shared-chinese', 'cross-project-relation',
    ))).toBe('wrong-project')
    expect(data.teachingUnitSubjects.some((relation) => relation.projectId === 'project-b')).toBe(false)
  })
})

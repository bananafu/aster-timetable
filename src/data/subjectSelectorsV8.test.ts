import { describe, expect, it } from 'vitest'
import type { AppDataV8 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import { createBlankProject } from './projectRuntimeV8'
import { projectToLegacyView } from './projectRuntime'
import { previewSubjectCatalogInstall } from './subjectCatalogInstall'
import { deleteProjectSubject, updateProjectSubject } from './subjectManagementAdapter'
import {
  findProjectSubject,
  searchProjectSubjects,
  selectDisplayProject,
  selectProjectSubjects,
  selectProjectSubjectsForLevel,
} from './subjectSelectorsV8'
import { createSubject } from './subjectsV8'

const base = () => migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))

function withBlankProject(data = base()): AppDataV8 {
  const ids = ['project-b', 'school-b', 'unit-b', 'timetable-b']
  return createBlankProject(data, {
    name: 'Project B', teacherName: 'Teacher B', academicYear: 116, semester: 'first',
    startDate: '2027-08-30', endDate: '2028-01-19',
  }, () => ids.shift()!, '2027-08-01T00:00:00.000Z')
}

describe('Project-scoped Subject selectors and compatibility boundary', () => {
  it('keeps a blank Project empty and never leaks another Project Subject', () => {
    const data = withBlankProject()
    const projectA = data.projects.find((project) => project.id !== 'project-b')!.id

    expect(selectProjectSubjects(data, 'project-b')).toEqual([])
    expect(selectProjectSubjectsForLevel(data, 'project-b', 'senior-high')).toEqual([])
    expect(findProjectSubject(data, 'project-b', data.subjects[0].id)).toBeUndefined()
    expect(selectProjectSubjects(data, projectA)).toEqual(data.subjects.filter((subject) => subject.projectId === projectA))
    expect(selectProjectSubjects(data, 'missing-project')).toEqual([])
    expect(selectProjectSubjects(data, null)).toEqual([])
  })

  it('keeps same-name Subjects independent and preserves stable search order', () => {
    const blank = withBlankProject()
    const projectA = blank.projects.find((project) => project.id !== 'project-b')!.id
    const source = blank.subjects.find((subject) => subject.projectId === projectA && subject.name === '國文')!
    const withSameName = createSubject(blank, 'project-b', {
      name: source.name,
      shortName: source.shortName,
      color: '#123456',
      applicableSchoolLevels: ['senior-high'],
    }, 'subject-b-chinese')
    const data = createSubject(withSameName, 'project-b', {
      name: '國文閱讀', shortName: '國閱', color: '#654321', applicableSchoolLevels: ['senior-high'],
    }, 'subject-b-reading')

    expect(searchProjectSubjects(data, 'project-b', 'senior-high', '國文').map((subject) => subject.id))
      .toEqual(['subject-b-chinese', 'subject-b-reading'])
    expect(searchProjectSubjects(data, projectA, 'senior-high', '國文').map((subject) => subject.id))
      .not.toContain('subject-b-chinese')
    expect(data.subjects.filter((subject) => subject.name === '國文').map((subject) => subject.id))
      .toEqual(expect.arrayContaining([source.id, 'subject-b-chinese']))
  })

  it('uses the actual archived display Project and its own Subject set', () => {
    const withSubject = createSubject(withBlankProject(), 'project-b', {
      name: '歷史專案科目', shortName: '歷史', color: '#123456', applicableSchoolLevels: ['senior-high'],
    }, 'history-subject')
    const activeProjectId = withSubject.projects.find((project) => project.id !== 'project-b')!.id
    const data: AppDataV8 = {
      ...withSubject,
      activeProjectId,
      projects: withSubject.projects.map((project) => project.id === 'project-b'
        ? { ...project, archivedAt: '2028-02-01T00:00:00.000Z' }
        : project),
    }

    const displayProject = selectDisplayProject(data, 'project-b')
    expect(displayProject?.id).toBe('project-b')
    expect(selectProjectSubjects(data, displayProject?.id).map((subject) => subject.id)).toEqual(['history-subject'])
    expect(selectDisplayProject(data, 'not-archived')?.id).toBe(activeProjectId)
  })

  it('routes CRUD and catalog analysis through the owning Project without changing V7 semantics', () => {
    const blank = withBlankProject()
    const preview = previewSubjectCatalogInstall(blank, ['senior-high'])
    expect(preview.items.find((item) => item.name === '國語文')?.status).toBe('safe-to-add')

    const withSubject = createSubject(blank, 'project-b', {
      name: '獨立科目', shortName: '獨立', color: '#123456', applicableSchoolLevels: ['senior-high'],
    }, 'project-b-subject')
    const updated = updateProjectSubject(withSubject, 'project-b', 'project-b-subject', {
      name: '已更新科目', shortName: '更新', color: '#654321', applicableSchoolLevels: ['senior-high'],
    }, true) as AppDataV8
    expect(findProjectSubject(updated, 'project-b', 'project-b-subject')?.name).toBe('已更新科目')
    const deleted = deleteProjectSubject(updated, 'project-b', 'project-b-subject', true) as AppDataV8
    expect(selectProjectSubjects(deleted, 'project-b')).toEqual([])
    expect(deleted.subjects.filter((subject) => subject.projectId !== 'project-b'))
      .toEqual(blank.subjects.filter((subject) => subject.projectId !== 'project-b'))

    const v7 = migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
    expect(selectProjectSubjects(v7, v7.activeProjectId)).toBe(v7.subjects)
    expect(projectToLegacyView(v7).subjects).toEqual(v7.subjects)
    expect(projectToLegacyView(withSubject, 'project-b').subjects.map((subject) => subject.id))
      .toEqual(['project-b-subject'])
  })
})

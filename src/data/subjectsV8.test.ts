import { describe, expect, it } from 'vitest'
import type { AppDataV8, TeachingProgress } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import { archiveProject } from './projectRuntime'
import { createBlankProject } from './projectRuntimeV8'
import {
  createSubject,
  deleteSubject,
  listSubjects,
  SubjectV8ManagementError,
  updateSubject,
  type SubjectV8Draft,
} from './subjectsV8'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

const draft: SubjectV8Draft = {
  name: '地球科學', shortName: '地科', color: '#345678',
  applicableSchoolLevels: ['junior-high', 'senior-high', 'other'],
}

const base = () => migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))

function withSecondProject(data = base()): AppDataV8 {
  const ids = ['project-b', 'school-b', 'unit-b', 'timetable-b']
  return createBlankProject(data, {
    name: 'Project B', teacherName: 'Teacher B', academicYear: 116, semester: 'first',
    startDate: '2027-08-30', endDate: '2028-01-19',
  }, () => ids.shift()!, '2027-08-01T00:00:00.000Z')
}

function code(action: () => unknown) {
  try { action(); return null } catch (cause) {
    return cause instanceof SubjectV8ManagementError ? cause.code : 'unknown'
  }
}

function withUnreferencedSubject(data = base(), id = 'earth-science') {
  return createSubject(data, data.projects[0].id, draft, id)
}

describe('Project-scoped Subject V8 operations', () => {
  it('creates, lists, updates, and deletes same-name Subjects independently by Project', () => {
    const initial = withSecondProject()
    const projectA = initial.projects[0].id
    const projectB = 'project-b'
    const withA = createSubject(initial, projectA, draft, 'earth-a')
    const withBoth = createSubject(withA, projectB, draft, 'earth-b')

    expect(listSubjects(withBoth, projectA).some((subject) => subject.id === 'earth-a')).toBe(true)
    expect(listSubjects(withBoth, projectA).some((subject) => subject.id === 'earth-b')).toBe(false)
    expect(listSubjects(withBoth, projectB)).toEqual([
      expect.objectContaining({ id: 'earth-b', projectId: projectB, name: draft.name }),
    ])

    const renamed = updateSubject(withBoth, projectA, 'earth-a', { ...draft, name: '地質學', shortName: '地質' })
    expect(renamed.subjects.find((subject) => subject.id === 'earth-a')?.name).toBe('地質學')
    expect(renamed.subjects.find((subject) => subject.id === 'earth-b')?.name).toBe('地球科學')

    expect(code(() => deleteSubject(renamed, projectA, 'earth-a'))).toBe('confirmation-required')
    const deleted = deleteSubject(renamed, projectA, 'earth-a', true)
    expect(deleted.subjects.some((subject) => subject.id === 'earth-a')).toBe(false)
    expect(deleted.subjects.find((subject) => subject.id === 'earth-b')).toEqual(
      renamed.subjects.find((subject) => subject.id === 'earth-b'),
    )
  })

  it('enforces same-Project uniqueness and globally collision-free new IDs', () => {
    const data = withUnreferencedSubject()
    const projectId = data.projects[0].id
    expect(code(() => createSubject(data, projectId, { ...draft, name: ` ${draft.name} ` }, 'duplicate-name')))
      .toBe('duplicate-name')
    expect(code(() => createSubject(data, projectId, { ...draft, name: 'Other' }, 'duplicate-short')))
      .toBe('duplicate-short-name')
    expect(code(() => createSubject(data, projectId, { ...draft, name: 'Other', shortName: 'Other' }, data.classes[0].id)))
      .toBe('id-collision')
    expect(code(() => createSubject(data, projectId, { ...draft, name: 'Other', shortName: 'Other' }, ' padded ')))
      .toBe('invalid-id')
  })

  it('rejects cross-Project CRUD, projectId transfer attempts, and archived Project changes', () => {
    const initial = withSecondProject()
    const projectA = initial.projects[0].id
    const projectB = 'project-b'
    const data = createSubject(initial, projectA, draft, 'earth-a')
    expect(code(() => updateSubject(data, projectB, 'earth-a', draft))).toBe('wrong-project')
    expect(code(() => deleteSubject(data, projectB, 'earth-a', true))).toBe('wrong-project')
    expect(code(() => updateSubject(data, projectA, 'earth-a', { ...draft, projectId: projectB } as SubjectV8Draft)))
      .toBe('invalid-draft')

    const transferred = {
      ...data,
      subjects: data.subjects.map((subject) => subject.id === 'earth-a' ? { ...subject, projectId: projectB } : subject),
    }
    expect(isCompatibleAppDataV8(transferred)).toBe(true)
    expect(isSafeAppDataV8Update(data, transferred)).toBe(false)

    const archived = archiveProject(data, projectA, '2027-01-01T00:00:00.000Z') as AppDataV8
    expect(code(() => createSubject(archived, projectA, { ...draft, name: 'New', shortName: 'New' }, 'new')))
      .toBe('archived-project')
    expect(code(() => updateSubject(archived, projectA, 'earth-a', { ...draft, name: 'Changed' })))
      .toBe('archived-project')
    expect(code(() => deleteSubject(archived, projectA, 'earth-a', true))).toBe('archived-project')
  })

  it('blocks deletion when any historical recurring Lesson references the Subject', () => {
    const withSubject = withUnreferencedSubject()
    const original = withSubject.recurringLessons[0]
    const unit = withSubject.teachingUnits.find((item) => item.id === original.teachingUnitId)!
    const nextDate = new Date(`${unit.startDate}T00:00:00.000Z`)
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    const data: AppDataV8 = {
      ...withSubject,
      recurringLessons: [
        { ...original, subjectId: 'earth-science', effectiveEnd: unit.startDate },
        { ...original, id: 'historical-next', subjectId: 'earth-science', effectiveStart: nextDate.toISOString().slice(0, 10) },
        ...withSubject.recurringLessons.slice(1),
      ],
    }
    expect(isCompatibleAppDataV8(data)).toBe(true)
    let error: unknown
    try { deleteSubject(data, original.projectId, 'earth-science', true) } catch (cause) { error = cause }
    expect(error).toMatchObject({
      code: 'referenced',
      details: { references: expect.arrayContaining([expect.objectContaining({ kind: 'lesson', historical: true })]) },
    })
  })

  it.each(['override', 'one-off', 'progress'] as const)('blocks deletion for a %s reference', (kind) => {
    const source = withUnreferencedSubject()
    const lesson = source.recurringLessons[0]
    const unit = source.teachingUnits.find((item) => item.id === lesson.teachingUnitId)!
    const progress: TeachingProgress = {
      id: '123e4567-e89b-42d3-a456-426614174000', projectId: lesson.projectId,
      timetableId: lesson.timetableId, teachingUnitId: lesson.teachingUnitId,
      classId: lesson.classId, subjectId: 'earth-science',
      content: { chapter: '第一章', unit: '', note: '' }, previousProgress: null,
      createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
    }
    const data: AppDataV8 = kind === 'override' ? {
      ...source,
      overrides: [...source.overrides, {
        id: 'earth-override', projectId: lesson.projectId, timetableId: lesson.timetableId,
        teachingUnitId: lesson.teachingUnitId, date: unit.startDate, periodId: lesson.periodId,
        action: 'replace', originalLessonId: lesson.id,
        replacement: { subjectId: 'earth-science', classId: lesson.classId },
      }],
    } : kind === 'one-off' ? {
      ...source,
      oneOffLessons: [...source.oneOffLessons, {
        id: 'earth-one-off', projectId: lesson.projectId, timetableId: lesson.timetableId,
        teachingUnitId: lesson.teachingUnitId, classId: lesson.classId, subjectId: 'earth-science',
        date: unit.startDate, purpose: 'extra', time: { mode: 'period', periodId: unit.periods[0].id },
      }],
    } : { ...source, teachingProgress: [progress] }
    expect(isCompatibleAppDataV8(data)).toBe(true)
    let error: unknown
    try { deleteSubject(data, lesson.projectId, 'earth-science', true) } catch (cause) { error = cause }
    expect(error).toMatchObject({
      code: 'referenced', details: { references: [expect.objectContaining({ kind })] },
    })
  })

  it('reports anomalous cross-Project references and keeps batch unlink-delete unsafe', () => {
    const initial = withSecondProject()
    const projectA = initial.projects[0].id
    const projectB = 'project-b'
    const withB = createSubject(initial, projectB, draft, 'earth-b')
    const crossReferenced: AppDataV8 = {
      ...withB,
      recurringLessons: withB.recurringLessons.map((lesson, index) => index === 0
        ? { ...lesson, subjectId: 'earth-b' }
        : lesson),
    }
    expect(isCompatibleAppDataV8(crossReferenced)).toBe(false)
    expect(code(() => deleteSubject(crossReferenced, projectB, 'earth-b', true))).toBe('cross-project-reference')

    const current = base()
    const referencedId = current.recurringLessons[0].subjectId
    const unlinked: AppDataV8 = {
      ...current,
      recurringLessons: current.recurringLessons.filter((lesson) => lesson.subjectId !== referencedId),
      overrides: current.overrides.filter((override) => override.replacement?.subjectId !== referencedId),
      oneOffLessons: current.oneOffLessons.filter((lesson) => lesson.subjectId !== referencedId),
    }
    const deleted = deleteSubject(unlinked, projectA, referencedId, true)
    expect(isCompatibleAppDataV8(deleted)).toBe(true)
    expect(isSafeAppDataV8Update(current, deleted)).toBe(false)
  })
})

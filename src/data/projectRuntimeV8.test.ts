import { describe, expect, it, vi } from 'vitest'
import type { AppDataV8, TeachingProgress } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import {
  createBlankProject,
  deleteProject,
  getProjectDeletionImpact,
  ProjectLifecycleV8Error,
} from './projectRuntimeV8'
import { createSubject } from './subjectsV8'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

const base = () => migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))

function code(action: () => unknown) {
  try { action(); return null } catch (cause) {
    return cause instanceof ProjectLifecycleV8Error ? cause.code : 'unknown'
  }
}

function addSecondProject(data = base()) {
  const ids = ['project-b', 'school-b', 'unit-b', 'timetable-b']
  const created = createBlankProject(data, {
    name: 'Project B', teacherName: 'Teacher B', academicYear: 116, semester: 'first',
    startDate: '2027-08-30', endDate: '2028-01-19',
  }, () => ids.shift()!, '2027-08-01T00:00:00.000Z')
  return createSubject(created, 'project-b', {
    name: 'Project B Subject', shortName: 'B', color: '#123456', applicableSchoolLevels: ['senior-high'],
  }, 'subject-b')
}

describe('AppDataV8 Project lifecycle operations', () => {
  it('creates a blank Project with required structure and no inherited domain data', () => {
    const source = base()
    const snapshot = structuredClone(source)
    const ids = ['blank-project', 'blank-school', 'blank-unit', 'blank-timetable']
    const created = createBlankProject(source, {
      name: 'Blank', teacherName: 'Teacher', academicYear: 116, semester: 'second',
      startDate: '2028-02-01', endDate: '2028-06-30',
    }, () => ids.shift()!, '2028-01-01T00:00:00.000Z')

    expect(created.activeProjectId).toBe('blank-project')
    expect(created.projects.filter((item) => item.id === 'blank-project')).toHaveLength(1)
    expect(created.timetables.filter((item) => item.projectId === 'blank-project')).toHaveLength(1)
    expect(created.schools.filter((item) => item.projectId === 'blank-project')).toHaveLength(1)
    expect(created.teachingUnits.filter((item) => item.projectId === 'blank-project')).toHaveLength(1)
    expect(created.subjects.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.classes.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.recurringLessons.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.events.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.overrides.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.oneOffLessons.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.teachingProgress.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.subjects).toEqual(snapshot.subjects)
    expect(created.classes).toEqual(snapshot.classes)
    expect(created.recurringLessons).toEqual(snapshot.recurringLessons)
    expect(source).toEqual(snapshot)
    expect(isCompatibleAppDataV8(created)).toBe(true)
    expect(isSafeAppDataV8Update(source, created)).toBe(true)
  })

  it('rejects invalid or globally colliding generated IDs', () => {
    const data = base()
    const input = {
      name: 'Blank', teacherName: 'Teacher', academicYear: 116, semester: 'first' as const,
      startDate: '2027-08-30', endDate: '2028-01-19',
    }
    expect(code(() => createBlankProject(data, input, () => ' '))).toBe('invalid-id')
    expect(code(() => createBlankProject(data, input, () => data.subjects[0].id))).toBe('id-collision')
    let calls = 0
    expect(code(() => createBlankProject(data, input, () => `same-${Math.min(++calls, 1)}`))).toBe('id-collision')
  })

  it('atomically deletes every target-Project entity and preserves every other Project', () => {
    const initial = addSecondProject()
    const projectId = initial.projects[0].id
    const lesson = initial.recurringLessons[0]
    const unit = initial.teachingUnits.find((item) => item.id === lesson.teachingUnitId)!
    const progress: TeachingProgress = {
      id: '123e4567-e89b-42d3-a456-426614174000', projectId,
      timetableId: lesson.timetableId, teachingUnitId: lesson.teachingUnitId,
      classId: lesson.classId, subjectId: lesson.subjectId,
      content: { chapter: '第一章', unit: '', note: '' }, previousProgress: null,
      createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
    }
    const current: AppDataV8 = {
      ...initial,
      events: [...initial.events, {
        id: 'event-a', projectId, teachingUnitId: unit.id, title: 'Event', type: 'meeting',
        date: unit.startDate, startTime: '09:00', endTime: '10:00', color: '#123456',
      }],
      overrides: [...initial.overrides, {
        id: 'override-a', projectId, timetableId: lesson.timetableId, teachingUnitId: unit.id,
        date: unit.startDate, periodId: lesson.periodId, action: 'replace', originalLessonId: lesson.id,
        replacement: { subjectId: lesson.subjectId, classId: lesson.classId },
      }],
      oneOffLessons: [...initial.oneOffLessons, {
        id: 'one-off-a', projectId, timetableId: lesson.timetableId, teachingUnitId: unit.id,
        classId: lesson.classId, subjectId: lesson.subjectId, date: unit.startDate,
        purpose: 'extra', time: { mode: 'period', periodId: unit.periods[0].id },
      }],
      teachingProgress: [progress],
      migrationWarnings: [...initial.migrationWarnings, {
        id: 'warning-a', entityType: 'lesson', entityId: lesson.id, message: 'Target warning',
      }],
    }
    expect(isCompatibleAppDataV8(current)).toBe(true)
    expect(getProjectDeletionImpact(current, projectId)).toMatchObject({
      projectId, subjects: current.subjects.filter((item) => item.projectId === projectId).length,
      recurringLessons: current.recurringLessons.filter((item) => item.projectId === projectId).length,
      events: 1, overrides: 1, oneOffLessons: 1, teachingProgress: 1,
    })
    expect(code(() => deleteProject(current, projectId))).toBe('confirmation-required')

    const projectBSnapshot = {
      project: structuredClone(current.projects.find((item) => item.id === 'project-b')),
      timetable: structuredClone(current.timetables.filter((item) => item.projectId === 'project-b')),
      schools: structuredClone(current.schools.filter((item) => item.projectId === 'project-b')),
      units: structuredClone(current.teachingUnits.filter((item) => item.projectId === 'project-b')),
      subjects: structuredClone(current.subjects.filter((item) => item.projectId === 'project-b')),
      classes: structuredClone(current.classes.filter((item) => item.projectId === 'project-b')),
    }
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    const deleted = deleteProject(current, projectId, true)

    expect(isCompatibleAppDataV8(deleted)).toBe(true)
    expect(isSafeAppDataV8Update(current, deleted)).toBe(true)
    expect(deleted.activeProjectId).toBe('project-b')
    expect(deleted.projects.some((item) => item.id === projectId)).toBe(false)
    for (const collection of [
      deleted.timetables, deleted.schools, deleted.teachingUnits, deleted.subjects, deleted.classes,
      deleted.recurringLessons, deleted.events, deleted.overrides, deleted.oneOffLessons, deleted.teachingProgress,
    ]) expect(collection.some((item) => item.projectId === projectId)).toBe(false)
    expect(deleted.migrationWarnings.some((item) => item.id === 'warning-a')).toBe(false)
    expect({
      project: deleted.projects.find((item) => item.id === 'project-b'),
      timetable: deleted.timetables.filter((item) => item.projectId === 'project-b'),
      schools: deleted.schools.filter((item) => item.projectId === 'project-b'),
      units: deleted.teachingUnits.filter((item) => item.projectId === 'project-b'),
      subjects: deleted.subjects.filter((item) => item.projectId === 'project-b'),
      classes: deleted.classes.filter((item) => item.projectId === 'project-b'),
    }).toEqual(projectBSnapshot)
    expect(setItem).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

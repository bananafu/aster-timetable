import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataV8, TeachingProgress } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import {
  copyProject,
  createBlankProject,
  deleteProject,
  getProjectDeletionImpact,
  ProjectLifecycleV8Error,
  switchActiveProject,
} from './projectRuntimeV8'
import { copyProject as copyProjectV7 } from './projectRuntime'
import { createSubject, deleteSubject, updateSubject } from './subjectsV8'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

const baseV7 = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
const base = () => migrateV7ToV8(baseV7())

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

function copyInput(data: AppDataV8, sourceEffectiveDate = '2026-10-05') {
  const sourceProjectId = data.projects[0].id
  return {
    sourceProjectId,
    name: '下一學期',
    academicYear: 116,
    semester: 'first' as const,
    units: data.teachingUnits.filter((unit) => unit.projectId === sourceProjectId).map((unit) => ({
      sourceUnitId: unit.id,
      sourceEffectiveDate,
      startDate: '2027-08-30',
      endDate: '2028-01-19',
      anchorDate: '2027-09-06',
      anchorPattern: 'B' as const,
    })),
  }
}

function copyFixture(): AppDataV8 {
  const withUnusedSubject = createSubject(base(), base().projects[0].id, {
    name: '未排課科目', shortName: '未排', color: '#345678', applicableSchoolLevels: ['senior-high'],
  }, 'unused-source-subject')
  const projectId = withUnusedSubject.projects[0].id
  const unit = withUnusedSubject.teachingUnits.find((item) => item.projectId === projectId)!
  const timetable = withUnusedSubject.timetables.find((item) => item.projectId === projectId)!
  const first = withUnusedSubject.recurringLessons.find((item) => item.projectId === projectId)!
  const currentSubject = withUnusedSubject.subjects.find((item) => item.projectId === projectId && item.id !== first.subjectId)!
  const secondTimetableId = 'second-source-timetable'
  const secondTimetableLesson = withUnusedSubject.recurringLessons.find((item) => item.id !== first.id)!
  const progress: TeachingProgress = {
    id: '123e4567-e89b-42d3-a456-426614174000', projectId,
    timetableId: timetable.id, teachingUnitId: unit.id, classId: first.classId, subjectId: first.subjectId,
    content: { chapter: '第一章', unit: '', note: '' }, previousProgress: null,
    createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
  }
  const fixture: AppDataV8 = {
    ...withUnusedSubject,
    timetables: [...withUnusedSubject.timetables, {
      ...timetable, id: secondTimetableId, name: '第二份來源課表', teacherName: '陳老師', teacherNamePending: undefined,
    }],
    recurringLessons: [
      ...withUnusedSubject.recurringLessons.map((lesson) => lesson.id === first.id
        ? { ...lesson, effectiveEnd: '2026-10-04' }
        : lesson),
      { ...first, id: 'current-version', subjectId: currentSubject.id, effectiveStart: '2026-10-05' },
      {
        ...secondTimetableLesson,
        id: 'second-timetable-lesson', seriesId: 'second-timetable-series', timetableId: secondTimetableId,
      },
    ],
    events: [...withUnusedSubject.events, {
      id: 'source-event', projectId, teachingUnitId: unit.id, title: '來源事件', type: 'meeting',
      date: '2026-10-05', startTime: '09:00', endTime: '10:00', color: '#123456',
      ownershipStatus: 'resolved', timetableId: timetable.id,
    }],
    overrides: [...withUnusedSubject.overrides, {
      id: 'source-override', projectId, timetableId: timetable.id, teachingUnitId: unit.id,
      date: '2026-10-05', periodId: first.periodId, action: 'cancel', originalLessonId: 'current-version',
    }],
    oneOffLessons: [...withUnusedSubject.oneOffLessons, {
      id: 'source-one-off', projectId, timetableId: timetable.id, teachingUnitId: unit.id,
      classId: first.classId, subjectId: first.subjectId, date: '2026-10-05', purpose: 'extra',
      time: { mode: 'period', periodId: first.periodId },
    }],
    teachingProgress: [progress],
  }
  expect(isCompatibleAppDataV8(fixture)).toBe(true)
  return fixture
}

afterEach(() => vi.unstubAllGlobals())

describe('AppDataV8 Project lifecycle operations', () => {
  it('switches only the active Project pointer and rejects missing or archived targets', () => {
    const data = addSecondProject()
    const snapshot = structuredClone(data)
    const switched = switchActiveProject(data, data.projects[0].id)
    expect(switched.activeProjectId).toBe(data.projects[0].id)
    expect({ ...switched, activeProjectId: data.activeProjectId }).toEqual(snapshot)
    expect(data).toEqual(snapshot)
    expect(code(() => switchActiveProject(data, 'missing'))).toBe('not-found')
    const archived = { ...data, activeProjectId: data.projects[0].id, projects: data.projects.map((item) => item.id === 'project-b'
      ? { ...item, archivedAt: '2027-08-01T00:00:00.000Z' } : item) }
    expect(code(() => switchActiveProject(archived, 'project-b'))).toBe('not-found')
  })
  it('creates a blank Project with required structure and no inherited domain data', () => {
    const source = base()
    const snapshot = structuredClone(source)
    const ids = ['blank-project', 'blank-school', 'blank-unit']
    const created = createBlankProject(source, {
      name: 'Blank', teacherName: 'Teacher', academicYear: 116, semester: 'second',
      startDate: '2028-02-01', endDate: '2028-06-30',
    }, () => ids.shift()!, '2028-01-01T00:00:00.000Z')

    expect(created.activeProjectId).toBe('blank-project')
    expect(created.projects.filter((item) => item.id === 'blank-project')).toHaveLength(1)
    expect(created.timetables.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.timetables).toEqual(snapshot.timetables)
    expect(created.schools.filter((item) => item.projectId === 'blank-project')).toHaveLength(1)
    expect(created.teachingUnits.filter((item) => item.projectId === 'blank-project')).toHaveLength(1)
    expect(created.subjects.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.teachingUnitSubjects.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.classes.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.recurringLessons.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.events.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.overrides.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.oneOffLessons.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.teachingProgress.filter((item) => item.projectId === 'blank-project')).toEqual([])
    expect(created.subjects).toEqual(snapshot.subjects)
    expect(created.teachingUnitSubjects).toEqual(snapshot.teachingUnitSubjects)
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

  it('copies a complete independent Project using each TeachingUnit source-effective date', () => {
    const source = copyFixture()
    const snapshot = structuredClone(source)
    const sourceProjectId = source.projects[0].id
    let sequence = 0
    const copied = copyProject(source, copyInput(source), () => `copy-id-${++sequence}`, '2027-08-01T00:00:00.000Z')
    const copiedProjectId = copied.activeProjectId!
    const sourceUnits = source.teachingUnits.filter((item) => item.projectId === sourceProjectId)
    const copiedUnits = copied.teachingUnits.filter((item) => item.projectId === copiedProjectId)
    const sourceSubjects = source.subjects.filter((item) => item.projectId === sourceProjectId)
    const copiedSubjects = copied.subjects.filter((item) => item.projectId === copiedProjectId)
    const sourceRelations = source.teachingUnitSubjects.filter((item) => item.projectId === sourceProjectId)
    const copiedRelations = copied.teachingUnitSubjects.filter((item) => item.projectId === copiedProjectId)
    const sourceClasses = source.classes.filter((item) => item.projectId === sourceProjectId)
    const copiedClasses = copied.classes.filter((item) => item.projectId === copiedProjectId)
    const sourceTimetables = source.timetables.filter((item) => item.projectId === sourceProjectId)
    const copiedTimetables = copied.timetables.filter((item) => item.projectId === copiedProjectId)
    const copiedLessons = copied.recurringLessons.filter((item) => item.projectId === copiedProjectId)
    const effectiveSourceLessons = source.recurringLessons.filter((lesson) => lesson.projectId === sourceProjectId
      && lesson.effectiveStart <= '2026-10-05' && (!lesson.effectiveEnd || lesson.effectiveEnd >= '2026-10-05'))

    expect(source).toEqual(snapshot)
    expect(isCompatibleAppDataV8(copied)).toBe(true)
    expect(isSafeAppDataV8Update(source, copied)).toBe(true)
    expect(copied.projects.find((item) => item.id === copiedProjectId)).toMatchObject({
      name: '下一學期', term: { academicYear: 116, semester: 'first' },
      createdAt: '2027-08-01T00:00:00.000Z', updatedAt: '2027-08-01T00:00:00.000Z',
    })
    expect(copiedTimetables).toHaveLength(2)
    expect(copiedTimetables.map((item) => [item.name, item.teacherName]))
      .toEqual(sourceTimetables.map((item) => [item.name, item.teacherName]))
    expect(copiedUnits).toHaveLength(sourceUnits.length)
    expect(copiedUnits[0]).toMatchObject({
      startDate: '2027-08-30', endDate: '2028-01-19',
      weekCycle: { enabled: true, anchorDate: '2027-09-06', anchorPattern: 'B' },
    })
    expect(copiedSubjects.map((item) => item.name)).toEqual(sourceSubjects.map((item) => item.name))
    expect(copiedRelations).toHaveLength(sourceRelations.length)
    expect(copiedClasses.map((item) => item.name)).toEqual(sourceClasses.map((item) => item.name))
    expect(copiedLessons).toHaveLength(effectiveSourceLessons.length)
    expect(copiedLessons.some((item) => item.id === 'current-version')).toBe(false)
    expect(copiedLessons.some((item) => item.subjectId === source.recurringLessons.find((item) => item.id === 'current-version')!.subjectId)).toBe(false)
    expect(copiedLessons.every((item) => item.effectiveStart === '2027-08-30' && item.effectiveEnd === '2028-01-19')).toBe(true)
    expect(new Set(copiedLessons.map((item) => item.weekPattern))).toEqual(new Set(['every', 'A', 'B']))

    const allSourceIds = new Set([
      ...source.projects.map((item) => item.id), ...source.timetables.map((item) => item.id),
      ...source.schools.map((item) => item.id), ...source.teachingUnits.map((item) => item.id),
      ...source.subjects.map((item) => item.id), ...source.teachingUnitSubjects.map((item) => item.id),
      ...source.classes.map((item) => item.id),
      ...source.recurringLessons.flatMap((item) => [item.id, item.seriesId]),
      ...source.events.map((item) => item.id), ...source.overrides.map((item) => item.id),
      ...source.oneOffLessons.map((item) => item.id), ...source.teachingProgress.map((item) => item.id),
    ])
    const generatedIds = [
      copiedProjectId, ...copiedTimetables.map((item) => item.id),
      ...copied.schools.filter((item) => item.projectId === copiedProjectId).map((item) => item.id),
      ...copiedUnits.map((item) => item.id), ...copiedSubjects.map((item) => item.id),
      ...copiedRelations.map((item) => item.id),
      ...copiedClasses.map((item) => item.id), ...copiedLessons.flatMap((item) => [item.id, item.seriesId]),
    ]
    expect(new Set(generatedIds).size).toBe(generatedIds.length)
    expect(generatedIds.every((id) => !allSourceIds.has(id))).toBe(true)

    const subjectMap = new Map(sourceSubjects.map((item, index) => [item.id, copiedSubjects[index].id]))
    const sourceSchools = source.schools.filter((item) => item.projectId === sourceProjectId)
    const copiedSchools = copied.schools.filter((item) => item.projectId === copiedProjectId)
    const schoolMap = new Map(sourceSchools.map((item, index) => [item.id, copiedSchools[index].id]))
    const classMap = new Map(sourceClasses.map((item, index) => [item.id, copiedClasses[index].id]))
    const unitMap = new Map(sourceUnits.map((item, index) => [item.id, copiedUnits[index].id]))
    const timetableMap = new Map(sourceTimetables.map((item, index) => [item.id, copiedTimetables[index].id]))
    sourceRelations.forEach((relation, index) => expect(copiedRelations[index]).toMatchObject({
      projectId: copiedProjectId,
      teachingUnitId: unitMap.get(relation.teachingUnitId),
      subjectId: subjectMap.get(relation.subjectId),
    }))
    sourceUnits.forEach((unit, index) => expect(copiedUnits[index].schoolId).toBe(schoolMap.get(unit.schoolId)))
    sourceClasses.forEach((schoolClass, index) => expect(copiedClasses[index].teachingUnitId).toBe(unitMap.get(schoolClass.teachingUnitId)))
    effectiveSourceLessons.forEach((lesson, index) => {
      expect(copiedLessons[index]).toMatchObject({
        projectId: copiedProjectId,
        subjectId: subjectMap.get(lesson.subjectId),
        classId: classMap.get(lesson.classId),
        teachingUnitId: unitMap.get(lesson.teachingUnitId),
        timetableId: timetableMap.get(lesson.timetableId),
        day: lesson.day, periodId: lesson.periodId, weekPattern: lesson.weekPattern,
      })
    })
    expect(copied.events.filter((item) => item.projectId === copiedProjectId)).toEqual([])
    expect(copied.overrides.filter((item) => item.projectId === copiedProjectId)).toEqual([])
    expect(copied.oneOffLessons.filter((item) => item.projectId === copiedProjectId)).toEqual([])
    expect(copied.teachingProgress.filter((item) => item.projectId === copiedProjectId)).toEqual([])
  })

  it.each([
    ['2026-10-04', false],
    ['2026-10-05', true],
  ])('selects exactly the lesson version effective on the inclusive %s boundary', (sourceEffectiveDate, currentVersion) => {
    const source = copyFixture()
    const sourceProjectId = source.projects[0].id
    const historical = source.recurringLessons.find((item) => item.projectId === sourceProjectId && item.effectiveEnd === '2026-10-04')!
    const expected = currentVersion ? source.recurringLessons.find((item) => item.id === 'current-version')! : historical
    let sequence = 0
    const copied = copyProject(source, copyInput(source, sourceEffectiveDate), () => `boundary-${sourceEffectiveDate}-${++sequence}`)
    const copiedProjectId = copied.activeProjectId!
    const copiedTimetable = copied.timetables.find((item) => item.projectId === copiedProjectId
      && item.name === source.timetables.find((table) => table.id === expected.timetableId)!.name)!
    const copiedClass = copied.classes.find((item) => item.projectId === copiedProjectId
      && item.name === source.classes.find((schoolClass) => schoolClass.id === expected.classId)!.name)!
    const matching = copied.recurringLessons.filter((item) => item.projectId === copiedProjectId
      && item.timetableId === copiedTimetable.id && item.classId === copiedClass.id
      && item.day === expected.day && item.periodId === expected.periodId)
    expect(matching).toHaveLength(1)
    expect(copied.subjects.find((item) => item.id === matching[0].subjectId)?.name)
      .toBe(source.subjects.find((item) => item.id === expected.subjectId)?.name)
  })

  it('keeps copied Subjects independent, including an unused Subject deletion', () => {
    const source = copyFixture()
    let sequence = 0
    const copied = copyProject(source, copyInput(source), () => `isolated-${++sequence}`)
    const copiedProjectId = copied.activeProjectId!
    const sourceSubject = source.subjects.find((item) => item.projectId === source.projects[0].id && item.name === '國文')!
    const copiedSubject = copied.subjects.find((item) => item.projectId === copiedProjectId && item.name === sourceSubject.name)!
    const updated = updateSubject(copied, copiedProjectId, copiedSubject.id, {
      name: '新學期國文', shortName: copiedSubject.shortName, color: copiedSubject.color,
      applicableSchoolLevels: copiedSubject.applicableSchoolLevels,
    })
    expect(updated.subjects.find((item) => item.id === sourceSubject.id)?.name).toBe(sourceSubject.name)

    const copiedUnused = updated.subjects.find((item) => item.projectId === copiedProjectId && item.name === '未排課科目')!
    const deleted = deleteSubject(updated, copiedProjectId, copiedUnused.id, true)
    expect(deleted.subjects.some((item) => item.id === copiedUnused.id)).toBe(false)
    expect(deleted.subjects.some((item) => item.id === 'unused-source-subject')).toBe(true)
    expect(isCompatibleAppDataV8(deleted)).toBe(true)
  })

  it('requires explicit valid source-effective dates and rejects ID collisions or invalid references atomically', () => {
    const data = copyFixture()
    const invalidDate = copyInput(data)
    invalidDate.units[0].sourceEffectiveDate = '2028-01-01'
    expect(code(() => copyProject(data, invalidDate, () => 'unused'))).toBe('invalid-input')
    expect(code(() => copyProject(data, copyInput(data), () => data.subjects[0].id))).toBe('id-collision')
    let calls = 0
    expect(code(() => copyProject(data, copyInput(data), () => `duplicate-${Math.min(++calls, 2)}`))).toBe('id-collision')

    const contaminated = {
      ...data,
      recurringLessons: data.recurringLessons.map((lesson, index) => index === 0
        ? { ...lesson, subjectId: data.subjects.find((subject) => subject.projectId !== lesson.projectId)?.id ?? 'missing' }
        : lesson),
    }
    expect(code(() => copyProject(contaminated, copyInput(data), () => 'unused'))).toBe('invalid-data')
    expect(data).toEqual(copyFixture())
  })

  it('has no LocalStorage write side effect', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    const data = copyFixture()
    let sequence = 0
    copyProject(data, copyInput(data), () => `no-storage-${++sequence}`)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('preserves the existing archived-source contract without modifying the archive', () => {
    const source = copyFixture()
    const archivedAt = '2027-02-01T00:00:00.000Z'
    const archived: AppDataV8 = {
      ...source,
      activeProjectId: null,
      projects: source.projects.map((project) => ({ ...project, archivedAt, updatedAt: archivedAt })),
    }
    let sequence = 0
    const copied = copyProject(archived, copyInput(archived), () => `archive-copy-${++sequence}`)
    expect(copied.projects.find((item) => item.id === source.projects[0].id)).toEqual(archived.projects[0])
    expect(copied.projects.find((item) => item.id === copied.activeProjectId)?.archivedAt).toBeUndefined()
    expect(isSafeAppDataV8Update(archived, copied)).toBe(true)
  })

  it('does not change the public V7 copyProject behavior', () => {
    const source = baseV7()
    const unit = source.teachingUnits[0]
    let sequence = 0
    const copied = copyProjectV7(source, {
      sourceProjectId: source.projects[0].id, name: 'V7 副本', academicYear: 116, semester: 'first',
      units: [{
        sourceUnitId: unit.id, startDate: '2027-08-30', endDate: '2028-01-19',
        anchorDate: '2027-08-30', anchorPattern: 'A',
      }],
    }, () => `v7-copy-${++sequence}`)
    expect(copied.schemaVersion).toBe(7)
    expect(copied.subjects).toBe(source.subjects)
    expect(copied.recurringLessons.filter((item) => item.projectId === copied.activeProjectId)).toHaveLength(source.recurringLessons.length)
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
        ownershipStatus: 'resolved', timetableId: lesson.timetableId,
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
      teachingUnitSubjects: structuredClone(current.teachingUnitSubjects.filter((item) => item.projectId === 'project-b')),
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
      deleted.teachingUnitSubjects, deleted.recurringLessons, deleted.events, deleted.overrides,
      deleted.oneOffLessons, deleted.teachingProgress,
    ]) expect(collection.some((item) => item.projectId === projectId)).toBe(false)
    expect(deleted.migrationWarnings.some((item) => item.id === 'warning-a')).toBe(false)
    expect({
      project: deleted.projects.find((item) => item.id === 'project-b'),
      timetable: deleted.timetables.filter((item) => item.projectId === 'project-b'),
      schools: deleted.schools.filter((item) => item.projectId === 'project-b'),
      units: deleted.teachingUnits.filter((item) => item.projectId === 'project-b'),
      subjects: deleted.subjects.filter((item) => item.projectId === 'project-b'),
      teachingUnitSubjects: deleted.teachingUnitSubjects.filter((item) => item.projectId === 'project-b'),
      classes: deleted.classes.filter((item) => item.projectId === 'project-b'),
    }).toEqual(projectBSnapshot)
    expect(setItem).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

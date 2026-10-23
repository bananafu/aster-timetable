import { describe, expect, it } from 'vitest'
import { createEmptyAppDataV8, APP_DATA_V8_KEY, loadAppDataV8Only, persistAppDataV8 } from './storageV8'
import { createBlankProject, copyProject, switchActiveProject } from './projectRuntimeV8'
import { createSubject, configureSubjectForTeachingUnit, deleteSubject } from './subjectsV8'
import { createClassV8, deleteClassV8, updateClassV8 } from './classesV8'
import { createTeacherTimetableV8, deleteTeacherTimetableV8 } from './timetablesV8'
import { reconcileTimetableSelectionV8, visibleTimetableContentV8 } from './timetableSelectionV8'
import { isCompatibleAppDataV8 } from './validators/v8'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import type { AppDataV8 } from '../types'

const subject = { name: '地球科學', shortName: '地科', color: '#345678',
  applicableSchoolLevels: ['senior-high' as const] }
const migrated = () => migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))
const addProject = (data: AppDataV8, name: string, prefix: string) => {
  let id = 0
  return createBlankProject(data, { name, academicYear: 115, semester: 'first',
    startDate: '2026-08-01', endDate: '2027-01-31' }, () => `${prefix}-${++id}`)
}

describe('V8 resource document integration', () => {
  it('builds Project, Subject, Class, configuration and teacher on one validated, reloadable document', () => {
    const values: AppDataV8[] = [createEmptyAppDataV8()]
    const add = (next: AppDataV8) => { expect(isCompatibleAppDataV8(next)).toBe(true); values.push(next); return next }
    const project = add(addProject(values.at(-1)!, 'A', 'a'))
    const projectId = project.activeProjectId!
    const unitId = project.teachingUnits[0].id
    expect(project.subjects).toEqual([])
    expect(project.classes).toEqual([])
    expect(project.timetables).toEqual([])
    expect(project.recurringLessons).toEqual([])
    expect(project.events).toEqual([])
    expect(project.teachingProgress).toEqual([])
    add(createSubject(values.at(-1)!, projectId, subject, 'subject-a'))
    add(createClassV8(values.at(-1)!, projectId, { teachingUnitId: unitId, name: '一甲' }, 'class-a'))
    add(configureSubjectForTeachingUnit(values.at(-1)!, projectId, unitId, 'subject-a', 'relation-a'))
    const finished = add(createTeacherTimetableV8(values.at(-1)!, projectId,
      { name: '甲課表', teacherName: '甲老師' }, 'timetable-a'))
    expect(finished.recurringLessons).toEqual([])
    expect(finished.events).toEqual([])
    expect(finished.teachingProgress).toEqual([])
    const entries = new Map<string, string>()
    const storage = { getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value) } }
    let revision = 0
    let raw: string | null = null
    for (let index = 1; index < values.length; index++) {
      const receipt = persistAppDataV8(storage, values[index - 1], values[index],
        { raw, legacyGuardRaw: null, revision }, revision)
      revision = receipt.revision
      raw = receipt.raw
      expect(loadAppDataV8Only(storage, createEmptyAppDataV8()).value).toEqual(values[index])
    }
    expect(entries.get(APP_DATA_V8_KEY)).toBe(JSON.stringify(finished))
    expect(() => persistAppDataV8(storage, project, finished,
      { raw: JSON.stringify(project), legacyGuardRaw: null, revision }, revision)).toThrow()
  })

  it('isolates same-name resources by Project and copies a semester without transient records', () => {
    let data = migrated()
    const sourceId = data.projects[0].id
    data = addProject(data, 'B', 'b')
    const destinationId = data.activeProjectId!
    expect(data.subjects.some((item) => item.projectId === destinationId)).toBe(false)
    expect(data.classes.some((item) => item.projectId === destinationId)).toBe(false)
    expect(data.timetables.some((item) => item.projectId === destinationId)).toBe(false)
    const sourceSubject = createSubject(data, sourceId, subject, 'same-name-a')
    const both = createSubject(sourceSubject, destinationId, subject, 'same-name-b')
    expect(both.subjects.find((item) => item.id === 'same-name-a')?.name)
      .toBe(both.subjects.find((item) => item.id === 'same-name-b')?.name)
    expect(() => configureSubjectForTeachingUnit(both, destinationId,
      both.teachingUnits.find((item) => item.projectId === destinationId)!.id, 'same-name-a', 'bad')).toThrow()
    expect(reconcileTimetableSelectionV8(both, destinationId, both.timetables[0].id)).toBeNull()
    expect(switchActiveProject(both, sourceId).timetables).toEqual(both.timetables)
    let counter = 0
    const copy = copyProject(both, { sourceProjectId: sourceId, name: '新學期', academicYear: 116,
      semester: 'first', units: both.teachingUnits.filter((item) => item.projectId === sourceId).map((unit) => ({
        sourceUnitId: unit.id, sourceEffectiveDate: '2026-10-05', startDate: '2027-08-30',
        endDate: '2028-01-19', anchorDate: '2027-09-06', anchorPattern: 'B' as const,
      })) }, () => `copy-${++counter}`)
    const copyId = copy.activeProjectId!
    expect(isCompatibleAppDataV8(copy)).toBe(true)
    expect(copy.events.filter((item) => item.projectId === copyId)).toEqual([])
    expect(copy.oneOffLessons.filter((item) => item.projectId === copyId)).toEqual([])
    expect(copy.overrides.filter((item) => item.projectId === copyId)).toEqual([])
    expect(copy.teachingProgress.filter((item) => item.projectId === copyId)).toEqual([])
    expect(copy.timetables.filter((item) => item.projectId === copyId).every((item) =>
      !both.timetables.some((source) => source.id === item.id))).toBe(true)
  })

  it('keeps two teachers separate across TeachingUnits and protects referenced resources', () => {
    let data = migrated()
    const first = data.timetables[0]
    const projectId = first.projectId
    const unit = data.teachingUnits.find((item) => item.projectId === projectId)!
    const lesson = data.recurringLessons.find((item) => item.timetableId === first.id)!
    const schoolClass = data.classes.find((item) => item.id === lesson.classId)!
    const extraUnit = { ...unit, id: 'extra-unit', name: '另一任教單位' }
    data = { ...data, teachingUnits: [...data.teachingUnits, extraUnit],
      classes: [...data.classes, { ...schoolClass, id: 'extra-class', teachingUnitId: extraUnit.id }] }
    data = configureSubjectForTeachingUnit(data, projectId, extraUnit.id, lesson.subjectId, 'extra-relation')
    data = createTeacherTimetableV8(data, projectId, { name: '同名教師', teacherName: '乙' }, 'teacher-b')
    data = { ...data, recurringLessons: [...data.recurringLessons, { ...lesson, id: 'extra-lesson',
      seriesId: 'extra-series', teachingUnitId: extraUnit.id, classId: 'extra-class' },
    { ...lesson, id: 'other-teacher-lesson', seriesId: 'other-teacher-series', timetableId: 'teacher-b' }],
    events: [...data.events, { id: 'extra-event', projectId, teachingUnitId: extraUnit.id,
      timetableId: first.id, ownershipStatus: 'resolved', title: '跨單位會議', type: 'meeting',
      date: unit.startDate, startTime: '09:00', endTime: '10:00', color: '#123456' },
    { id: 'other-teacher-event', projectId, teachingUnitId: unit.id,
      timetableId: 'teacher-b', ownershipStatus: 'resolved', title: '另一教師會議', type: 'meeting',
      date: unit.startDate, startTime: '11:00', endTime: '12:00', color: '#654321' }],
    teachingProgress: [...data.teachingProgress,
      { id: '123e4567-e89b-42d3-a456-426614174020', projectId, timetableId: first.id,
        teachingUnitId: unit.id, classId: lesson.classId, subjectId: lesson.subjectId,
        content: { chapter: '甲', unit: '', note: '' }, previousProgress: null,
        createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z' },
      { id: '123e4567-e89b-42d3-a456-426614174021', projectId, timetableId: 'teacher-b',
        teachingUnitId: unit.id, classId: lesson.classId, subjectId: lesson.subjectId,
        content: { chapter: '乙', unit: '', note: '' }, previousProgress: null,
        createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z' }] }
    expect(isCompatibleAppDataV8(data)).toBe(true)
    const firstContent = visibleTimetableContentV8(data, projectId, first.id)
    expect(firstContent.recurringLessons.some((item) => item.id === 'extra-lesson')).toBe(true)
    expect(firstContent.events.some((item) => item.id === 'extra-event')).toBe(true)
    expect(firstContent.recurringLessons.some((item) => item.id === 'other-teacher-lesson')).toBe(false)
    expect(firstContent.events.some((item) => item.id === 'other-teacher-event')).toBe(false)
    expect(firstContent.progress.some((item) => item.content.chapter === '乙')).toBe(false)
    const secondContent = visibleTimetableContentV8(data, projectId, 'teacher-b')
    expect(secondContent.recurringLessons.map((item) => item.id)).toEqual(['other-teacher-lesson'])
    expect(secondContent.events.map((item) => item.id)).toEqual(['other-teacher-event'])
    expect(secondContent.progress.map((item) => item.content.chapter)).toEqual(['乙'])
    expect(() => deleteSubject(data, projectId, lesson.subjectId, true)).toThrow()
    expect(() => deleteClassV8(data, projectId, lesson.classId, true)).toThrow()
    expect(() => deleteTeacherTimetableV8(data, projectId, first.id, true)).toThrow()
    expect(() => updateClassV8(data, projectId, lesson.classId,
      { teachingUnitId: extraUnit.id, name: schoolClass.name })).toThrow()
    expect(() => deleteTeacherTimetableV8(data, projectId, 'teacher-b', true)).toThrow()
    const withoutSecondRefs = { ...data,
      recurringLessons: data.recurringLessons.filter((item) => item.timetableId !== 'teacher-b'),
      events: data.events.filter((item) => item.id !== 'other-teacher-event'),
      teachingProgress: data.teachingProgress.filter((item) => item.timetableId !== 'teacher-b') }
    expect(deleteTeacherTimetableV8(withoutSecondRefs, projectId, 'teacher-b', true).recurringLessons)
      .toEqual(withoutSecondRefs.recurringLessons)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataV7 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8, V8MigrationError } from './migrationsV8'
import { createBlankProject } from './projectRuntime'

const source = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))

function multiProjectSource(): AppDataV7 {
  const original = source()
  const ids = ['project-2', 'school-2', 'unit-2', 'timetable-2']
  const second = createBlankProject(original, {
    name: 'Second project', teacherName: 'Teacher', academicYear: 116, semester: 'first',
    startDate: '2027-08-30', endDate: '2028-01-19',
  }, () => ids.shift()!, '2027-08-01T00:00:00.000Z') as AppDataV7
  const firstLesson = second.recurringLessons[0]
  const firstUnit = second.teachingUnits.find((item) => item.id === firstLesson.teachingUnitId)!
  const historicalEnd = firstUnit.startDate
  const nextStart = new Date(`${historicalEnd}T00:00:00.000Z`)
  nextStart.setUTCDate(nextStart.getUTCDate() + 1)
  const project2 = second.projects.find((item) => item.id === 'project-2')!
  const timetable2 = second.timetables.find((item) => item.projectId === project2.id)!
  const unit2 = second.teachingUnits.find((item) => item.projectId === project2.id)!
  unit2.schoolLevel = firstUnit.schoolLevel
  const class2 = { id: 'class-2', projectId: project2.id, teachingUnitId: unit2.id, name: 'Second class' }
  const lesson2 = {
    ...firstLesson,
    id: 'lesson-2', seriesId: 'series-2', projectId: project2.id, timetableId: timetable2.id,
    teachingUnitId: unit2.id, classId: class2.id, effectiveStart: unit2.startDate, effectiveEnd: unit2.endDate,
  }
  return {
    ...second,
    classes: [...second.classes, class2],
    recurringLessons: [
      { ...firstLesson, effectiveEnd: historicalEnd },
      { ...firstLesson, id: 'lesson-current-version', effectiveStart: nextStart.toISOString().slice(0, 10) },
      ...second.recurringLessons.slice(1),
      lesson2,
    ],
    overrides: [...second.overrides, {
      id: 'replacement-1', projectId: firstLesson.projectId, timetableId: firstLesson.timetableId,
      teachingUnitId: firstLesson.teachingUnitId, date: firstUnit.startDate, periodId: firstLesson.periodId,
      action: 'replace', originalLessonId: firstLesson.id,
      replacement: { subjectId: second.subjects[1].id, classId: firstLesson.classId },
    }],
    oneOffLessons: [{
      id: 'one-off-1', projectId: project2.id, timetableId: timetable2.id, teachingUnitId: unit2.id,
      classId: class2.id, subjectId: second.subjects[2].id, date: unit2.startDate, purpose: 'extra',
      time: { mode: 'period', periodId: unit2.periods[0].id },
    }],
  }
}

const mappingFor = (data: ReturnType<typeof migrateV7ToV8>, projectId: string) =>
  new Map(data.subjects.filter((subject) => subject.projectId === projectId).map((subject) => [subject.name, subject.id]))

afterEach(() => vi.unstubAllGlobals())

describe('v7 to v8 migration', () => {
  it('creates a complete independent Subject collection for every Project', () => {
    const v7 = multiProjectSource()
    const snapshot = structuredClone(v7)
    const migrated = migrateV7ToV8(v7)

    expect(migrated.schemaVersion).toBe(8)
    expect(migrated.teachingProgress).toEqual([])
    expect(migrated.subjects).toHaveLength(v7.projects.length * v7.subjects.length)
    for (const project of v7.projects) {
      const projectSubjects = migrated.subjects.filter((subject) => subject.projectId === project.id)
      expect(projectSubjects.map((subject) => ({
        name: subject.name, shortName: subject.shortName, color: subject.color,
        applicableSchoolLevels: subject.applicableSchoolLevels, origin: subject.origin,
      }))).toEqual(v7.subjects.map((subject) => ({
        name: subject.name, shortName: subject.shortName, color: subject.color,
        applicableSchoolLevels: subject.applicableSchoolLevels, origin: subject.origin,
      })))
    }
    const firstName = v7.subjects[0].name
    expect(new Set(v7.projects.map((project) => mappingFor(migrated, project.id).get(firstName))).size).toBe(v7.projects.length)
    expect(v7).toEqual(snapshot)
    expect(migrateV7ToV8(v7)).toEqual(migrated)
  })

  it('remaps every recurring history version, replacement, and one-off by Project without changing other IDs', () => {
    const v7 = multiProjectSource()
    const migrated = migrateV7ToV8(v7)
    const oldSubjectNames = new Map(v7.subjects.map((subject) => [subject.id, subject.name]))

    for (const [index, lesson] of migrated.recurringLessons.entries()) {
      expect(lesson.id).toBe(v7.recurringLessons[index].id)
      expect(lesson.seriesId).toBe(v7.recurringLessons[index].seriesId)
      expect(lesson.subjectId).toBe(mappingFor(migrated, lesson.projectId).get(oldSubjectNames.get(v7.recurringLessons[index].subjectId)!))
    }
    for (const [index, override] of migrated.overrides.entries()) {
      expect(override.id).toBe(v7.overrides[index].id)
      if (override.replacement && override.projectId) {
        expect(override.replacement.subjectId).toBe(mappingFor(migrated, override.projectId)
          .get(oldSubjectNames.get(v7.overrides[index].replacement!.subjectId)!))
      }
    }
    for (const [index, lesson] of migrated.oneOffLessons.entries()) {
      expect(lesson.id).toBe(v7.oneOffLessons[index].id)
      expect(lesson.subjectId).toBe(mappingFor(migrated, lesson.projectId).get(oldSubjectNames.get(v7.oneOffLessons[index].subjectId)!))
    }
    for (const key of ['projects', 'timetables', 'schools', 'teachingUnits', 'classes', 'events', 'migrationWarnings'] as const) {
      expect(migrated[key].map((item) => item.id)).toEqual(v7[key].map((item) => item.id))
    }
  })

  it('allocates deterministic globally unique Subject IDs even when the base candidate is occupied', () => {
    const v7 = source()
    const baseId = `v8-subject:${encodeURIComponent(v7.projects[0].id)}:${encodeURIComponent(v7.subjects[0].id)}`
    const collision: AppDataV7 = {
      ...v7,
      migrationWarnings: [{ id: baseId, entityType: 'lesson', entityId: v7.recurringLessons[0].id, message: 'collision' }],
    }
    const first = migrateV7ToV8(collision)
    const second = migrateV7ToV8(collision)
    const allIds = [
      ...first.subjects.map((item) => item.id), ...first.projects.map((item) => item.id),
      ...first.timetables.map((item) => item.id), ...first.schools.map((item) => item.id),
      ...first.teachingUnits.map((item) => item.id), ...first.classes.map((item) => item.id),
      ...first.recurringLessons.flatMap((item) => [item.id, item.seriesId]),
      ...first.events.map((item) => item.id), ...first.overrides.map((item) => item.id),
      ...first.oneOffLessons.map((item) => item.id), ...first.migrationWarnings.map((item) => item.id),
    ]
    expect(first.subjects[0].id).toBe(`${baseId}:1`)
    const allowedLessonSeriesAliases = first.recurringLessons.filter((item) => item.id === item.seriesId).length
    expect(new Set(allIds).size).toBe(allIds.length - allowedLessonSeriesAliases)
    expect(second).toEqual(first)
  })

  it('rejects an unassigned legacy Subject reference with recoverable identifiers', () => {
    const v7 = source()
    const entityId = 'legacy-unassigned-replacement'
    const subjectId = v7.subjects[0].id
    const contaminated: AppDataV7 = { ...v7, overrides: [...v7.overrides, {
      id: entityId, projectId: null, timetableId: null, teachingUnitId: null,
      date: '2026-09-01', periodId: 1, action: 'replace', replacement: { subjectId, classId: 'legacy-class' },
    }] }

    let error: unknown
    try { migrateV7ToV8(contaminated) } catch (cause) { error = cause }
    expect(error).toBeInstanceOf(V8MigrationError)
    expect(error).toMatchObject({ code: 'unassigned-subject-reference', entityId, subjectId })
    expect(contaminated.overrides.at(-1)?.replacement?.subjectId).toBe(subjectId)
  })

  it('rejects a legacy normalized Subject-name collision without changing the source', () => {
    const v7 = source()
    const duplicate = { ...v7.subjects[0], id: 'duplicate-name', name: ` ${v7.subjects[0].name} ` }
    const contaminated: AppDataV7 = { ...v7, subjects: [...v7.subjects, duplicate] }
    const snapshot = structuredClone(contaminated)

    let error: unknown
    try { migrateV7ToV8(contaminated) } catch (cause) { error = cause }
    expect(error).toBeInstanceOf(V8MigrationError)
    expect(error).toMatchObject({
      code: 'subject-name-conflict', entityId: duplicate.id, subjectId: v7.subjects[0].id,
    })
    expect(contaminated).toEqual(snapshot)
  })

  it('rejects invalid or contaminated v7 input', () => {
    const v7 = source()
    const invalidReference = {
      ...v7,
      recurringLessons: [{ ...v7.recurringLessons[0], classId: 'missing-class' }, ...v7.recurringLessons.slice(1)],
    }
    expect(() => migrateV7ToV8(invalidReference)).toThrow('Invalid AppData v7')
    expect(() => migrateV7ToV8({ ...v7, schemaVersion: 6 } as unknown as AppDataV7)).toThrow('Invalid AppData v7')
    expect(() => migrateV7ToV8({ ...v7, teachingProgress: [] } as AppDataV7)).toThrow('Unexpected teaching progress data')
  })

  it('has no LocalStorage write side effect', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    migrateV7ToV8(source())
    expect(setItem).not.toHaveBeenCalled()
  })
})

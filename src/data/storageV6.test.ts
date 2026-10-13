import { describe, expect, it } from 'vitest'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { legacyTimetableId, migrateV5ToV6 } from './migrationsV6'
import { APP_DATA_V1_KEY, APP_DATA_V3_KEY, APP_DATA_V4_KEY } from './storageV4'
import { APP_DATA_V5_KEY } from './storageV5'
import { APP_DATA_V6_KEY, loadAppDataV6, persistAppDataV6 } from './storageV6'
import { isCompatibleAppDataV6 } from './validators/v6'
import { createInitialAppDataV6 } from '../hooks/useAppDataV4'
import { addLessonV4, deleteLessonV4, updateLessonV4 } from './lessonsV4'
import { cancelLessonOnDate, permanentlyUpdateLesson, replaceLessonOnDate } from './lessonChangesV4'
import { copyProject, createBlankProject, mergeProjectView, projectToLegacyView } from './projectRuntime'
import type { AppDataV5, AppDataV6 } from '../types'

const source = (): AppDataV5 => migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))
const ready = (): AppDataV6 => migrateV5ToV6(source())
const store = (values: Map<string, string>) => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value) },
})

describe('AppData v6 data foundation', () => {
  it('migrates every project, including archived projects, to stable pending timetables', () => {
    const v5 = source()
    const archived = { ...v5.projects[0], id: 'archived-project', archivedAt: '2027-02-01T00:00:00.000Z' }
    v5.projects.push(archived)
    const v6 = migrateV5ToV6(v5)
    expect(v6.timetables).toEqual(v5.projects.map((project) => ({
      id: legacyTimetableId(project.id), projectId: project.id, name: project.name,
      teacherName: null, teacherNamePending: true,
    })))
    expect(migrateV5ToV6(v5)).toEqual(v6)
  })

  it('retains lesson and series IDs, versions, subjects, and historical details', () => {
    const v5 = source()
    const first = v5.recurringLessons[0]
    first.effectiveEnd = '2026-09-13'
    v5.recurringLessons.push({ ...first, id: 'historical-next', effectiveStart: '2026-09-14', effectiveEnd: '2027-01-20' })
    const original = structuredClone(v5)
    const v6 = migrateV5ToV6(v5)
    expect(v5).toEqual(original)
    expect(v6.recurringLessons.map(({ id, seriesId, subjectId, classId, effectiveStart, effectiveEnd }) => ({ id, seriesId, subjectId, classId, effectiveStart, effectiveEnd })))
      .toEqual(v5.recurringLessons.map(({ id, seriesId, subjectId, classId, effectiveStart, effectiveEnd }) => ({ id, seriesId, subjectId, classId, effectiveStart, effectiveEnd })))
    expect(v6.recurringLessons.every((item) => item.timetableId === legacyTimetableId(item.projectId))).toBe(true)
    expect(v6.subjects).toEqual(v5.subjects)
  })

  it('keeps assigned overrides in the project timetable and orphan overrides unassigned with warnings', () => {
    const v5 = source()
    const lesson = v5.recurringLessons[0]
    v5.overrides.push({ id: 'assigned', projectId: lesson.projectId, teachingUnitId: lesson.teachingUnitId,
      date: '2026-09-07', periodId: lesson.periodId, action: 'cancel', originalLessonId: lesson.id })
    v5.overrides.push({ id: 'orphan', projectId: null, teachingUnitId: null,
      date: '2026-09-07', periodId: lesson.periodId, action: 'replace', originalLessonId: lesson.id,
      replacement: { subjectId: lesson.subjectId, classId: lesson.classId } })
    v5.migrationWarnings.push({ id: 'warning-orphan', entityType: 'override', entityId: 'orphan', message: 'Unassigned' })
    const v6 = migrateV5ToV6(v5)
    expect(v6.overrides.find((item) => item.id === 'assigned')?.timetableId).toBe(legacyTimetableId(lesson.projectId))
    expect(v6.overrides.find((item) => item.id === 'orphan')).toMatchObject({ projectId: null, timetableId: null, replacement: { subjectId: lesson.subjectId } })
    expect(v6.migrationWarnings).toEqual(v5.migrationWarnings)
  })

  it('rejects missing, duplicate, and cross-project timetable references', () => {
    const v6 = ready()
    expect(isCompatibleAppDataV6(v6)).toBe(true)
    expect(isCompatibleAppDataV6({ ...v6, timetables: [] })).toBe(false)
    expect(isCompatibleAppDataV6({ ...v6, timetables: [...v6.timetables, { ...v6.timetables[0] }] })).toBe(false)
    expect(isCompatibleAppDataV6({ ...v6, recurringLessons: [{ ...v6.recurringLessons[0], timetableId: 'missing' }, ...v6.recurringLessons.slice(1)] })).toBe(false)
    expect(isCompatibleAppDataV6({ ...v6, timetables: [{ ...v6.timetables[0], projectId: 'missing' }] })).toBe(false)
  })

  it('requires a real teacher name on confirmed timetables and marks legacy pending names explicitly', () => {
    const v6 = ready()
    expect(isCompatibleAppDataV6({ ...v6, timetables: [{ ...v6.timetables[0], teacherName: ' ' , teacherNamePending: undefined }] })).toBe(false)
    expect(isCompatibleAppDataV6({ ...v6, timetables: [{ ...v6.timetables[0], teacherName: null, teacherNamePending: undefined }] })).toBe(false)
    expect(isCompatibleAppDataV6({ ...v6, timetables: [{ ...v6.timetables[0], teacherName: '陳老師', teacherNamePending: undefined }] })).toBe(true)
  })

  it('rejects a series split across timetables and a cross-timetable override', () => {
    const v6 = ready()
    const second = { id: 'teacher-2', projectId: v6.projects[0].id, name: '第二課表', teacherName: '林老師' }
    const timetables = [...v6.timetables, second]
    const split = { ...v6.recurringLessons[0], timetableId: second.id }
    expect(isCompatibleAppDataV6({ ...v6, timetables, recurringLessons: [split, ...v6.recurringLessons.slice(1)] })).toBe(true)
    const firstVersion = { ...v6.recurringLessons[0], effectiveEnd: '2026-09-13' }
    const otherVersion = { ...v6.recurringLessons[0], id: 'version-2', effectiveStart: '2026-09-14', timetableId: second.id }
    expect(isCompatibleAppDataV6({ ...v6, timetables, recurringLessons: [firstVersion, ...v6.recurringLessons.slice(1), otherVersion] })).toBe(false)
    const original = v6.recurringLessons[0]
    const override = { id: 'cross', projectId: original.projectId, timetableId: second.id, teachingUnitId: original.teachingUnitId,
      date: '2026-09-07', periodId: original.periodId, action: 'cancel' as const, originalLessonId: original.id }
    expect(isCompatibleAppDataV6({ ...v6, timetables, overrides: [override] })).toBe(false)
  })

  it('rejects exchange group IDs shared by different timetables', () => {
    const v6 = ready()
    const second = { id: 'teacher-2', projectId: v6.projects[0].id, name: '第二課表', teacherName: '林老師' }
    const firstLesson = v6.recurringLessons[0]
    const secondLesson = { ...v6.recurringLessons[1], id: 'teacher-2-lesson', seriesId: 'teacher-2-lesson', timetableId: second.id }
    const base = { date: '2026-09-07', periodId: firstLesson.periodId, action: 'cancel' as const, groupId: 'exchange' }
    const overrides = [
      { ...base, id: 'first-override', projectId: firstLesson.projectId, timetableId: firstLesson.timetableId, teachingUnitId: firstLesson.teachingUnitId, originalLessonId: firstLesson.id },
      { ...base, id: 'second-override', projectId: secondLesson.projectId, timetableId: second.id, teachingUnitId: secondLesson.teachingUnitId, originalLessonId: secondLesson.id },
    ]
    expect(isCompatibleAppDataV6({ ...v6, timetables: [...v6.timetables, second], recurringLessons: [...v6.recurringLessons, secondLesson], overrides })).toBe(false)
  })

  it('rejects a timetable from another existing project even if both projects are valid', () => {
    const data = ready()
    let id = 0
    const withSecondProject = createBlankProject(data, { name: '第二專案', teacherName: '林老師', academicYear: 116,
      semester: 'first', startDate: '2027-08-30', endDate: '2028-01-20' }, () => `new-${++id}`)
    const secondTimetable = withSecondProject.timetables!.at(-1)!
    expect(isCompatibleAppDataV6(withSecondProject)).toBe(true)
    expect(isCompatibleAppDataV6({ ...withSecondProject, recurringLessons: withSecondProject.recurringLessons.map((item, index) => index === 0
      ? { ...item, timetableId: secondTimetable.id } : item) })).toBe(false)
  })

  it('does not fall back from a damaged v6 key or change old keys', () => {
    const v5 = source()
    const rawV5 = JSON.stringify(v5)
    const values = new Map([[APP_DATA_V6_KEY, '{bad-v6'], [APP_DATA_V5_KEY, rawV5]])
    const result = loadAppDataV6(store(values), createInitialAppDataV6())
    expect(result).toMatchObject({ status: 'read-error', source: 'v6', rawBackup: '{bad-v6', shouldPersist: false })
    expect(values.get(APP_DATA_V5_KEY)).toBe(rawV5)
    expect(values.get(APP_DATA_V6_KEY)).toBe('{bad-v6')
  })

  it('blocks an ambiguous legacy exchange group without writing or changing its v5 source', () => {
    const v5 = source()
    const lesson = v5.recurringLessons[0]
    v5.overrides.push({ id: 'assigned-group', groupId: 'ambiguous', projectId: lesson.projectId,
      teachingUnitId: lesson.teachingUnitId, date: '2026-09-07', periodId: lesson.periodId,
      action: 'cancel', originalLessonId: lesson.id })
    v5.overrides.push({ id: 'orphan-group', groupId: 'ambiguous', projectId: null,
      teachingUnitId: null, date: '2026-09-07', periodId: lesson.periodId, action: 'cancel' })
    const rawV5 = JSON.stringify(v5)
    const values = new Map([[APP_DATA_V5_KEY, rawV5]])
    expect(loadAppDataV6(store(values), createInitialAppDataV6())).toMatchObject({
      status: 'read-error', source: 'v5', rawBackup: rawV5, shouldPersist: false,
    })
    expect(values.get(APP_DATA_V5_KEY)).toBe(rawV5)
    expect(values.has(APP_DATA_V6_KEY)).toBe(false)
  })

  it('migrates v5 and older sources into only the v6 key without changing source bytes', () => {
    const v5 = source()
    const rawV5 = JSON.stringify(v5)
    const rawV4 = JSON.stringify(migrateV3ToV4(initialData))
    const rawV3 = JSON.stringify(initialData)
    const term = initialData.academicTerms[0]
    const rawV1 = JSON.stringify({
      subjects: initialData.subjects, classes: initialData.classes,
      periods: term.periods.map(({ id, label, startTime, endTime }) => ({ id, label, startTime, endTime })),
      courses: initialData.courses.map(({ id, subjectId, classId, day, periodId, weekPattern, room, origin }) => ({ id, subjectId, classId, day, periodId, weekPattern, room, origin })),
      events: [], overrides: [], semester: { name: term.name, startDate: term.startDate, endDate: term.endDate, firstWeekPattern: 'A' },
    })
    for (const [key, raw] of [[APP_DATA_V5_KEY, rawV5], [APP_DATA_V4_KEY, rawV4], [APP_DATA_V3_KEY, rawV3], [APP_DATA_V1_KEY, rawV1]]) {
      const values = new Map([[key, raw]])
      const result = loadAppDataV6(store(values), createInitialAppDataV6())
      expect(result.status).toBe('saved')
      expect(result.value.schemaVersion).toBe(6)
      expect(result.shouldPersist).toBe(true)
      persistAppDataV6(store(values), result.value)
      expect(values.get(key)).toBe(raw)
      expect(JSON.parse(values.get(APP_DATA_V6_KEY)!).schemaVersion).toBe(6)
    }
  })

  it('leaves source data intact when v6 storage write fails', () => {
    const rawV5 = JSON.stringify(source())
    const values = new Map([[APP_DATA_V5_KEY, rawV5]])
    const result = loadAppDataV6(store(values), createInitialAppDataV6())
    expect(() => persistAppDataV6({ setItem: () => { throw new Error('quota') } }, result.value)).toThrow('quota')
    expect(values.get(APP_DATA_V5_KEY)).toBe(rawV5)
    expect(values.has(APP_DATA_V6_KEY)).toBe(false)
  })

  it('preserves legacy non-five-minute periods while rejecting new invalid times', () => {
    const v5 = source()
    v5.teachingUnits[0].periods[0].startTime = '08:03'
    v5.teachingUnits[0].periods[0].endTime = '08:58'
    const result = loadAppDataV6(store(new Map([[APP_DATA_V5_KEY, JSON.stringify(v5)]])), createInitialAppDataV6())
    expect(result.status).toBe('saved')
    expect(result.value.teachingUnits[0].periods[0]).toMatchObject({ startTime: '08:03', endTime: '08:58' })
  })

  it('keeps single-timetable add, edit, delete, replacement, and permanent changes writable', () => {
    const data = ready()
    const sourceLesson = data.recurringLessons[0]
    const school = data.schools.find((item) => item.projectId === sourceLesson.projectId)!
    const draft = { projectId: sourceLesson.projectId, schoolId: school.id, teachingUnitId: sourceLesson.teachingUnitId,
      subjectId: sourceLesson.subjectId, classId: sourceLesson.classId, day: 5 as const, periodId: 8, weekPattern: 'every' as const }
    const added = addLessonV4(data, draft, () => 'new-lesson')
    expect(added.recurringLessons.at(-1)?.timetableId).toBe(data.timetables[0].id)
    const edited = updateLessonV4(added, 'new-lesson', { ...draft, room: '201' })
    expect(edited.recurringLessons.at(-1)).toMatchObject({ id: 'new-lesson', room: '201', timetableId: data.timetables[0].id })
    expect(deleteLessonV4(edited, 'new-lesson').recurringLessons).toHaveLength(data.recurringLessons.length)
    const cancelled = cancelLessonOnDate(data, sourceLesson.id, '2026-09-07', () => 'cancel-1')
    expect(cancelled.overrides[0].timetableId).toBe(data.timetables[0].id)
    const replaced = replaceLessonOnDate(data, sourceLesson.id, '2026-09-07', { subjectId: sourceLesson.subjectId, classId: sourceLesson.classId }, () => 'replace-1')
    expect(replaced.overrides[0].timetableId).toBe(data.timetables[0].id)
    const permanent = permanentlyUpdateLesson(data, sourceLesson.id, '2026-09-14', { ...draft, day: sourceLesson.day, periodId: sourceLesson.periodId }, () => 'version-2')
    expect(permanent.recurringLessons.find((item) => item.id === 'version-2')?.timetableId).toBe(data.timetables[0].id)
  })

  it('rejects legacy lesson writers when a project has multiple timetables', () => {
    const data = ready()
    const projectId = data.projects[0].id
    const multi = { ...data, timetables: [...data.timetables, { id: 'second', projectId, name: '第二課表', teacherName: '林老師' }] }
    const lesson = data.recurringLessons[0]
    const school = data.schools.find((item) => item.projectId === projectId)!
    expect(() => addLessonV4(multi, { projectId, schoolId: school.id, teachingUnitId: lesson.teachingUnitId,
      subjectId: lesson.subjectId, classId: lesson.classId, day: 5, periodId: 8, weekPattern: 'every' }, () => 'unsafe')).toThrow('Multiple or missing timetables')
    expect(() => cancelLessonOnDate(multi, lesson.id, '2026-09-07', () => 'unsafe')).toThrow('Multiple or missing timetables')
  })

  it('requires a teacher name when creating a new v6 project', () => {
    const data = ready()
    const draft = { name: '新學期', academicYear: 116, semester: 'first' as const, startDate: '2027-08-30', endDate: '2028-01-20' }
    expect(() => createBlankProject(data, draft, () => crypto.randomUUID())).toThrow('New project data is invalid')
    let id = 0
    const result = createBlankProject(data, { ...draft, teacherName: '  陳老師  ' }, () => `new-${++id}`)
    expect(result.timetables?.at(-1)).toMatchObject({ projectId: 'new-1', teacherName: '陳老師' })
    expect(isCompatibleAppDataV6(result)).toBe(true)
  })

  it('copies a single legacy timetable safely and blocks multi-timetable copies', () => {
    const data = ready()
    const unit = data.teachingUnits[0]
    const input = { sourceProjectId: data.projects[0].id, name: '下一學期', academicYear: 116,
      semester: 'first' as const, units: [{ sourceUnitId: unit.id, startDate: '2027-08-30', endDate: '2028-01-19', anchorDate: '2027-08-30', anchorPattern: 'A' as const }] }
    let id = 0
    const copied = copyProject(data, input, () => `copy-${++id}`)
    const newProjectId = copied.activeProjectId!
    const newTimetable = copied.timetables?.find((item) => item.projectId === newProjectId)
    expect(newTimetable).toMatchObject({ name: data.timetables[0].name, teacherName: null, teacherNamePending: true })
    expect(copied.recurringLessons.filter((item) => item.projectId === newProjectId).every((item) => item.timetableId === newTimetable?.id)).toBe(true)
    expect(isCompatibleAppDataV6(copied)).toBe(true)
    const multi = { ...data, timetables: [...data.timetables, { id: 'second', projectId: data.projects[0].id, name: '第二課表', teacherName: '林老師' }] }
    expect(() => copyProject(multi, input, () => 'unused')).toThrow('Multiple or missing timetables')
  })

  it('retains timetable IDs through a single-timetable legacy merge and blocks multi-timetable merges', () => {
    const data = ready()
    const view = projectToLegacyView(data)
    const merged = mergeProjectView(data, data.projects[0].id, view)
    expect(merged.recurringLessons.map((item) => item.timetableId)).toEqual(data.recurringLessons.map((item) => item.timetableId))
    expect(isCompatibleAppDataV6(merged)).toBe(true)
    const multi = { ...data, timetables: [...data.timetables, { id: 'second', projectId: data.projects[0].id, name: '第二課表', teacherName: '林老師' }] }
    expect(() => mergeProjectView(multi, data.projects[0].id, view)).toThrow('Multiple or missing timetables')
  })
})

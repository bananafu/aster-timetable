import { describe, expect, it } from 'vitest'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { cancelLessonOnDate } from './lessonChangesV4'
import { copyTimetable, updateTimetable } from './timetablesV6'
import { archiveProject, copyProject, deleteProject } from './projectRuntime'
import { deleteSubject, getSubjectImpact, updateSubject } from './subjectsV5'
import { removeClass, removeSchool, removeTeachingUnit, updateClass, updateTeachingUnit } from './academicSettingsV4'
import { isCompatibleAppDataV7, isSafeAppDataV7Update } from './validators/v7'
import { createOneOffLesson, deleteOneOffLesson, getOneOffLessonConflicts, getOneOffReferences, OneOffConflictError, updateOneOffLesson, type OneOffLessonDraft } from './oneOffLessonsV7'
import { resolveProjectDay } from '../lib/scheduleV4'
import { fromDateKey } from '../lib/date'
import type { AppDataV7 } from '../types'

const base = (): AppDataV7 => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const draft = (data: AppDataV7, date = '2026-09-06', time: OneOffLessonDraft['time'] = { mode: 'custom', startTime: '09:30', endTime: '11:00' }): OneOffLessonDraft => ({
  projectId: data.projects[0].id, timetableId: data.timetables[0].id,
  teachingUnitId: data.teachingUnits[0].id, classId: data.classes[0].id,
  subjectId: data.subjects[0].id, date, purpose: 'extra', time,
})
const add = (data: AppDataV7, candidate = draft(data), n = 1, allowConflict = false) =>
  createOneOffLesson(data, candidate, () => uuid(n), allowConflict)
const day = (data: AppDataV7, date: string, timetableId = data.timetables[0].id) =>
  resolveProjectDay(data, data.projects[0].id, fromDateKey(date), { timetableId })

describe('OneOffLesson v7 CRUD', () => {
  it('creates extra, make-up and substitute lessons without touching recurring lessons or overrides', () => {
    const data = base()
    const original = structuredClone(data)
    const extra = add(data)
    const makeUp = add(extra, { ...draft(extra, '2026-09-05', { mode: 'period', periodId: 3 }),
      purpose: 'make-up', relatedRecurringLessonId: data.recurringLessons[0].id }, 2)
    const substitute = add(makeUp, { ...draft(makeUp, '2026-09-06', { mode: 'custom', startTime: '13:10', endTime: '14:00' }), purpose: 'substitute' }, 3)
    expect(substitute.oneOffLessons.map((item) => [item.id, item.purpose])).toEqual([
      [uuid(1), 'extra'], [uuid(2), 'make-up'], [uuid(3), 'substitute'],
    ])
    expect(substitute.recurringLessons).toEqual(original.recurringLessons)
    expect(substitute.overrides).toEqual(original.overrides)
    expect(data).toEqual(original)
    expect(isCompatibleAppDataV7(substitute)).toBe(true)
  })

  it.each(['2026-09-04', '2026-09-05', '2026-09-06', '2027-01-03'])('creates valid weekday or weekend dates including a new year: %s', (date) => {
    const data = base()
    const result = add(data, draft(data, date, { mode: 'custom', startTime: '17:10', endTime: '18:00' }))
    expect(day(result, date).find((item) => item.id === uuid(1))).toMatchObject({ kind: 'one-off', date })
  })

  it('validates period owner, custom 24-hour five-minute time and source scope', () => {
    const data = base()
    expect(() => add(data, draft(data, '2026-09-06', { mode: 'period', periodId: 999 }))).toThrow('節次')
    for (const [startTime, endTime] of [['09:32', '11:00'], ['24:00', '11:00'], ['11:00', '10:00'], ['11:00', '11:00']]) {
      expect(() => add(data, draft(data, '2026-09-06', { mode: 'custom', startTime, endTime }))).toThrow('自訂時間')
    }
    const invalidMix = { ...draft(data), time: { mode: 'period', periodId: 1, startTime: '09:30' } } as unknown as OneOffLessonDraft
    expect(() => add(data, invalidMix)).toThrow('資料驗證')
    expect(() => add(data, { ...draft(data), purpose: 'extra', relatedRecurringLessonId: 'source' })).toThrow('只有補課')
    expect(() => add(data, { ...draft(data), purpose: 'make-up', relatedRecurringLessonId: 'deleted-source' })).not.toThrow()
    data.timetables.push({ ...data.timetables[0], id: 'other-timetable', name: '其他課表' })
    expect(() => add(data, { ...draft(data), timetableId: 'other-timetable', purpose: 'make-up',
      relatedRecurringLessonId: data.recurringLessons[0].id })).toThrow('補課來源')
    expect(() => add(data, draft(data, '2027-01-21'))).toThrow('學期')
    expect(() => add(data, draft(data, '2026-02-30'))).toThrow('學期')
  })

  it('rejects invalid ownership, applicability, archived projects and UUID collisions without mutating input', () => {
    const data = base()
    const before = structuredClone(data)
    for (const field of ['projectId', 'timetableId', 'teachingUnitId', 'classId', 'subjectId'] as const) {
      expect(() => add(data, { ...draft(data), [field]: 'missing' })).toThrow()
    }
    const restricted = { ...data, subjects: data.subjects.map((item, index) => index === 0 ? { ...item, applicableSchoolLevels: ['junior-high' as const] } : item) }
    expect(() => add(restricted, draft(restricted))).toThrow('科目不適用')
    expect(() => createOneOffLesson(data, draft(data), () => data.recurringLessons[0].id)).toThrow('UUID')
    expect(() => createOneOffLesson(data, draft(data), () => 'not-a-uuid')).toThrow('UUID')
    const added = add(data)
    expect(() => createOneOffLesson(added, { ...draft(added), time: { mode: 'custom', startTime: '13:00', endTime: '14:00' } }, () => uuid(1))).toThrow('UUID')
    const archived = archiveProject(data, data.projects[0].id) as AppDataV7
    expect(() => add(archived)).toThrow('封存')
    expect(data).toEqual(before)
  })

  it('rejects recurring and one-off collisions by default, but explicitly allows them and retains both cards', () => {
    const data = base()
    const candidate = draft(data, '2026-09-07', { mode: 'custom', startTime: '08:40', endTime: '09:10' })
    expect(getOneOffLessonConflicts(data, candidate).map((item) => item.id)).toEqual(['c1'])
    expect(() => add(data, candidate)).toThrow(OneOffConflictError)
    const allowed = add(data, candidate, 1, true)
    expect(day(allowed, candidate.date).filter((item) => ['c1', uuid(1)].includes(item.id)).every((item) => item.hasConflict)).toBe(true)
    const next = { ...candidate, time: { mode: 'custom' as const, startTime: '08:50', endTime: '09:00' } }
    expect(getOneOffLessonConflicts(allowed, next).map((item) => item.id)).toEqual(['c1', uuid(1)])
    expect(() => add(allowed, next, 2)).toThrow(OneOffConflictError)
    expect(data.oneOffLessons).toEqual([])
  })

  it('does not count cancelled recurring occurrences or adjacent half-open intervals as collisions', () => {
    const data = base()
    expect(getOneOffLessonConflicts(data, draft(data, '2026-09-07', { mode: 'custom', startTime: '09:00', endTime: '09:10' }))).toEqual([])
    const cancelled = cancelLessonOnDate(data, 'c1', '2026-09-07', () => 'cancel-c1', data.timetables[0].id) as AppDataV7
    expect(getOneOffLessonConflicts(cancelled, draft(cancelled, '2026-09-07', { mode: 'period', periodId: 1 }))).toEqual([])
    const first = add(data)
    const adjacent = draft(first, '2026-09-06', { mode: 'custom', startTime: '11:00', endTime: '11:30' })
    expect(getOneOffLessonConflicts(first, adjacent)).toEqual([])
    expect(() => add(first, adjacent, 2)).not.toThrow()
  })

  it('rechecks a stale preview against the latest input instead of applying an old safe result', () => {
    const original = base()
    const candidate = draft(original)
    expect(getOneOffLessonConflicts(original, candidate)).toEqual([])
    const latest = add(original, candidate)
    expect(() => createOneOffLesson(latest, candidate, () => uuid(2))).toThrow(OneOffConflictError)
    expect(latest.oneOffLessons).toHaveLength(1)
    expect(original.oneOffLessons).toEqual([])
  })

  it('checks collisions across schools and units only within one timetable', () => {
    const data = base()
    const otherUnit = { ...data.teachingUnits[0], id: 'unit-b', schoolId: 'school-b', name: '另一學制',
      periods: [{ id: 91, order: 1, label: '第一節', startTime: '08:40', endTime: '09:30' }] }
    data.schools.push({ ...data.schools[0], id: 'school-b', name: '乙校' })
    data.teachingUnits.push(otherUnit)
    data.classes.push({ ...data.classes[0], id: 'class-b', teachingUnitId: otherUnit.id })
    data.timetables.push({ ...data.timetables[0], id: 'teacher-b', name: '第二課表' })
    const crossSchool = { ...draft(data, '2026-09-07', { mode: 'period' as const, periodId: 91 }), teachingUnitId: otherUnit.id, classId: 'class-b' }
    expect(getOneOffLessonConflicts(data, crossSchool).map((item) => item.id)).toEqual(['c1'])
    expect(getOneOffLessonConflicts(data, { ...crossSchool, timetableId: 'teacher-b' })).toEqual([])
  })

  it('edits only its own occurrence, keeps the ID, and rechecks new time against current data', () => {
    const data = add(base())
    const original = data.oneOffLessons[0]
    const same = updateOneOffLesson(data, original.id, { ...draft(data), room: '圖書館' })
    expect(same.oneOffLessons[0]).toMatchObject({ id: original.id, room: '圖書館' })
    expect(getOneOffLessonConflicts(data, draft(data), original.id)).toEqual([])
    const changed = { ...draft(data, '2026-09-07', { mode: 'period' as const, periodId: 1 }), purpose: 'substitute' as const }
    expect(() => updateOneOffLesson(data, original.id, changed)).toThrow(OneOffConflictError)
    const allowed = updateOneOffLesson(data, original.id, changed, true)
    expect(allowed.oneOffLessons[0]).toMatchObject({ id: original.id, date: '2026-09-07', purpose: 'substitute' })
    expect(data.oneOffLessons[0]).toEqual(original)
    expect(() => updateOneOffLesson(data, original.id, { ...draft(data), timetableId: 'other' })).toThrow('不可跨')
    expect(() => updateOneOffLesson(data, 'missing', draft(data))).toThrow('找不到')
  })

  it('deletes one-off only, without changing fixed lessons, overrides or other dates', () => {
    const data = add(base())
    const result = deleteOneOffLesson(data, uuid(1))
    expect(result.oneOffLessons).toEqual([])
    expect(result.recurringLessons).toEqual(data.recurringLessons)
    expect(result.overrides).toEqual(data.overrides)
    expect(data.oneOffLessons).toHaveLength(1)
    expect(() => deleteOneOffLesson(result, uuid(1))).toThrow('找不到')
    const archived = archiveProject(data, data.projects[0].id) as AppDataV7
    expect(() => updateOneOffLesson(archived, uuid(1), draft(archived))).toThrow('封存')
    expect(() => deleteOneOffLesson(archived, uuid(1))).toThrow('封存')
  })
})

describe('OneOffLesson reference protection', () => {
  it('exposes reference queries and prevents subject deletion or removing the applicable level', () => {
    const original = base()
    original.subjects.push({ id: 'one-off-only', name: '單日專用', shortName: '單', color: '#123456', applicableSchoolLevels: ['other'] })
    const data = add(original, { ...draft(original), subjectId: 'one-off-only' })
    expect(getOneOffReferences(data, { kind: 'subject', id: 'one-off-only' }).map((item) => item.id)).toEqual([uuid(1)])
    expect(getSubjectImpact(data, 'one-off-only').references).toMatchObject([{ kind: 'one-off', id: uuid(1) }])
    expect(() => deleteSubject(data, 'one-off-only', true)).toThrow('引用')
    expect(() => updateSubject(data, 'one-off-only', { name: '單日專用', shortName: '單', color: '#123456', applicableSchoolLevels: ['junior-high'] }, true)).toThrow('引用')
  })

  it('protects class, school and teaching unit references with clear errors', () => {
    const data = add(base())
    const item = data.oneOffLessons[0]
    expect(getOneOffReferences(data, { kind: 'class', id: item.classId })).toHaveLength(1)
    expect(getOneOffReferences(data, { kind: 'teaching-unit', id: item.teachingUnitId })).toHaveLength(1)
    expect(getOneOffReferences(data, { kind: 'school', id: data.teachingUnits[0].schoolId })).toHaveLength(1)
    expect(getOneOffReferences(data, { kind: 'project', id: item.projectId })).toHaveLength(1)
    expect(getOneOffReferences(data, { kind: 'timetable', id: item.timetableId })).toHaveLength(1)
    expect(() => removeClass(data, item.classId)).toThrow('引用')
    expect(() => removeTeachingUnit(data, item.teachingUnitId)).toThrow('引用')
    expect(() => removeSchool(data, data.teachingUnits[0].schoolId)).toThrow('任教單位')
    const otherUnit = { ...data.teachingUnits[0], id: 'unit-b' }
    data.teachingUnits.push(otherUnit)
    expect(() => updateClass(data, item.classId, { teachingUnitId: otherUnit.id, name: data.classes[0].name })).toThrow('引用')
  })

  it('protects referenced period removal, retiming and academic-term date shrink', () => {
    const data = add(base(), draft(base(), '2026-09-06', { mode: 'period', periodId: 1 }))
    const unit = data.teachingUnits[0]
    const settings = { ...unit, periods: unit.periods.map((item) => ({ ...item })), weekCycle: { ...unit.weekCycle } }
    expect(getOneOffReferences(data, { kind: 'period', teachingUnitId: unit.id, periodId: 1 })).toHaveLength(1)
    expect(() => updateTeachingUnit(data, unit.id, { ...settings, periods: settings.periods.filter((item) => item.id !== 1) })).toThrow('引用')
    const retimed = { ...settings, periods: settings.periods.map((item) => item.id === 1 ? { ...item, startTime: '08:15', endTime: '09:05' } : item) }
    expect(() => updateTeachingUnit(data, unit.id, retimed)).toThrow('起訖時間')
    expect(isSafeAppDataV7Update(data, { ...data, teachingUnits: [retimed] })).toBe(false)
    expect(() => updateTeachingUnit(data, unit.id, { ...settings, startDate: '2026-09-07' })).toThrow('單日課程')
    expect(updateTeachingUnit(data, unit.id, { ...settings, periods: settings.periods.map((item) => item.id === 1 ? { ...item, label: '新第一節' } : item) }).teachingUnits[0].periods[0].label).toBe('新第一節')
    const custom = add(base())
    expect(updateTeachingUnit(custom, unit.id, retimed).teachingUnits[0].periods[0].startTime).toBe('08:15')
  })

  it('atomically cleans one-offs with project deletion, including archived history; timetable copy excludes them', () => {
    const data = add(base())
    const projectId = data.projects[0].id
    const archived = archiveProject(data, projectId) as AppDataV7
    const removed = deleteProject(archived, projectId) as AppDataV7
    expect(removed.oneOffLessons).toEqual([])
    expect(isSafeAppDataV7Update(archived, removed)).toBe(true)
    const named = updateTimetable(data, data.timetables[0].id, { name: '原課表', teacherName: '林老師' })
    let id = 0
    const copied = copyTimetable(named, { projectId, sourceTimetableId: named.timetables[0].id, baseDate: '2026-09-07' }, () => `copied-${++id}`)
    expect(copied.oneOffLessons).toEqual(named.oneOffLessons)
    expect(getOneOffReferences(copied, { kind: 'timetable', id: copied.timetables.at(-1)!.id })).toEqual([])
    let projectIdIndex = 0
    const projectCopy = copyProject(data, { sourceProjectId: projectId, name: '新學期', academicYear: 116, semester: 'first', teacherName: '林老師',
      units: [{ sourceUnitId: data.teachingUnits[0].id, startDate: '2027-08-31', endDate: '2028-01-20', anchorDate: '2027-08-31', anchorPattern: 'A' }] }, () => `project-copy-${++projectIdIndex}`) as AppDataV7
    expect(projectCopy.oneOffLessons).toEqual(data.oneOffLessons)
    expect(getOneOffReferences(projectCopy, { kind: 'project', id: projectCopy.activeProjectId! })).toEqual([])
  })

  it('rejects dangling timetable deletion and leaves the current data untouched after failures', () => {
    const data = add(base())
    const before = JSON.stringify(data)
    expect(isCompatibleAppDataV7({ ...data, timetables: [] })).toBe(false)
    expect(isSafeAppDataV7Update(data, { ...data, timetables: [] })).toBe(false)
    expect(() => add(data, draft(data, '2026-09-07', { mode: 'period', periodId: 1 }), 2)).toThrow(OneOffConflictError)
    expect(JSON.stringify(data)).toBe(before)
  })
})

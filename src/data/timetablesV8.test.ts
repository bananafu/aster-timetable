import { describe, expect, it } from 'vitest'
import { createEmptyAppDataV8 } from './storageV8'
import { createBlankProject } from './projectRuntimeV8'
import { createTeacherTimetableV8, deleteTeacherTimetableV8, duplicateTeacherTimetableV8,
  getTimetableV8Impact, updateTeacherTimetableV8 } from './timetablesV8'
import { reconcileTimetableSelectionV8, visibleTimetableContentV8 } from './timetableSelectionV8'
import { isCompatibleAppDataV8 } from './validators/v8'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import { configureSubjectForTeachingUnit } from './subjectsV8'

function projects() {
  let count = 0
  const a = createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115, semester: 'first',
    startDate: '2026-08-01', endDate: '2027-01-31' }, () => `a-${++count}`)
  return createBlankProject(a, { name: 'B', academicYear: 116, semester: 'first',
    startDate: '2027-08-01', endDate: '2028-01-31' }, () => `b-${++count}`)
}
const migrated = () => migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))

describe('V8 teacher Timetable management', () => {
  it('creates independent teachers without TeachingUnits, lessons or events', () => {
    const base = projects()
    const [a, b] = base.projects
    const noUnits = { ...base, schools: [], teachingUnits: [] }
    expect(isCompatibleAppDataV8(noUnits)).toBe(true)
    const first = createTeacherTimetableV8(noUnits, a.id, { name: '甲課表', teacherName: '甲老師' }, 'teacher-a')
    const second = createTeacherTimetableV8(first, a.id, { name: '乙課表', teacherName: '乙老師' }, 'teacher-b')
    expect(second.timetables.map((item) => item.projectId)).toEqual([a.id, a.id])
    expect(second.recurringLessons).toEqual([])
    expect(second.events).toEqual([])
    expect(second.teachingProgress).toEqual([])
    expect(reconcileTimetableSelectionV8(second, b.id, 'teacher-a')).toBeNull()
    expect(reconcileTimetableSelectionV8(second, a.id, 'teacher-b')).toBe('teacher-b')
    expect(reconcileTimetableSelectionV8(second, a.id, 'wrong')).toBe('teacher-a')
    expect(() => visibleTimetableContentV8(second, b.id, 'teacher-a')).toThrow()
  })

  it('updates by ID, duplicates only settings across Projects and deletes only unreferenced target', () => {
    const base = projects()
    const [a, b] = base.projects
    const first = createTeacherTimetableV8(base, a.id, { name: '課表', teacherName: '甲' }, 'teacher-a')
    const second = createTeacherTimetableV8(first, a.id, { name: '課表', teacherName: '乙' }, 'teacher-b')
    const updated = updateTeacherTimetableV8(second, a.id, 'teacher-a', { name: '新名稱', teacherName: '甲' })
    expect(updated.timetables.find((item) => item.id === 'teacher-b')?.name).toBe('課表')
    expect(updated.timetables.find((item) => item.id === 'teacher-a')?.id).toBe('teacher-a')
    const copied = duplicateTeacherTimetableV8(updated, a.id, 'teacher-a', b.id, 'teacher-copy')
    expect(copied.timetables.find((item) => item.id === 'teacher-copy')).toMatchObject({ projectId: b.id, teacherName: '甲' })
    expect(copied.recurringLessons).toEqual([])
    expect(copied.events).toEqual([])
    expect(copied.teachingProgress).toEqual([])
    expect(() => duplicateTeacherTimetableV8(updated, b.id, 'teacher-a', b.id, 'bad')).toThrow()
    expect(() => updateTeacherTimetableV8(updated, b.id, 'teacher-a', { name: 'X', teacherName: 'X' })).toThrow()
    expect(getTimetableV8Impact(copied, a.id, 'teacher-b').events).toBe(0)
    const deleted = deleteTeacherTimetableV8(copied, a.id, 'teacher-b', true)
    expect(deleted.timetables.some((item) => item.id === 'teacher-b')).toBe(false)
    expect(deleted.timetables.some((item) => item.id === 'teacher-a' || item.id === 'teacher-copy')).toBe(true)
  })

  it('keeps teacher content separate while allowing one timetable to span TeachingUnits', () => {
    const source = migrated()
    const first = source.timetables[0]
    const withTeacher = createTeacherTimetableV8(source, first.projectId, { name: '其他教師', teacherName: '乙' }, 'other-teacher')
    const unit = source.teachingUnits.find((item) => item.projectId === first.projectId)!
    const extraUnit = { ...unit, id: 'other-unit', name: '另一任教單位' }
    const sourceLesson = source.recurringLessons.find((item) => item.projectId === first.projectId)!
    const sourceClass = source.classes.find((item) => item.id === sourceLesson.classId)!
    const withUnit = { ...withTeacher, teachingUnits: [...withTeacher.teachingUnits, extraUnit],
      classes: [...withTeacher.classes, { ...sourceClass, id: 'other-class', teachingUnitId: extraUnit.id }] }
    const configured = configureSubjectForTeachingUnit(withUnit, first.projectId, extraUnit.id,
      sourceLesson.subjectId, 'other-relation')
    const crossUnit = { ...configured,
      recurringLessons: [...configured.recurringLessons, { ...sourceLesson, id: 'other-lesson',
        seriesId: 'other-series', teachingUnitId: extraUnit.id, classId: 'other-class' }],
      events: [...withTeacher.events, { id: 'cross-unit-event', projectId: first.projectId,
        teachingUnitId: extraUnit.id, timetableId: first.id, ownershipStatus: 'resolved' as const,
        title: '跨任教單位會議', type: 'meeting' as const, date: unit.startDate,
        startTime: '09:00', endTime: '10:00', color: '#123456' }],
      teachingProgress: [...configured.teachingProgress, { id: '123e4567-e89b-42d3-a456-426614174010', projectId: first.projectId,
        timetableId: first.id, teachingUnitId: extraUnit.id, classId: 'other-class', subjectId: sourceLesson.subjectId,
        content: { chapter: '跨單位', unit: '', note: '' }, previousProgress: null,
        createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z' }] }
    expect(isCompatibleAppDataV8(crossUnit)).toBe(true)
    const visible = visibleTimetableContentV8(crossUnit, first.projectId, first.id)
    expect(visible.events.some((item) => item.id === 'cross-unit-event')).toBe(true)
    expect(visible.recurringLessons.some((item) => item.id === 'other-lesson')).toBe(true)
    expect(visible.progress.some((item) => item.id === '123e4567-e89b-42d3-a456-426614174010')).toBe(true)
    expect(visibleTimetableContentV8(crossUnit, first.projectId, 'other-teacher').events).toEqual([])
    expect(visibleTimetableContentV8(crossUnit, first.projectId, 'other-teacher').progress).toEqual([])
    expect(() => deleteTeacherTimetableV8(crossUnit, first.projectId, first.id, true)).toThrow()
    expect(deleteTeacherTimetableV8(crossUnit, first.projectId, 'other-teacher', true).timetables
      .some((item) => item.id === first.id)).toBe(true)
  })

  it('blocks deletion for OneOff, Change and Progress references independently', () => {
    const source = migrated()
    const projectId = source.projects[0].id
    const lesson = source.recurringLessons[0]
    const clean = createTeacherTimetableV8(source, projectId, { name: '空課表', teacherName: '乙' }, 'clean-teacher')
    const oneOff = { ...clean, oneOffLessons: [...clean.oneOffLessons, { id: 'one-off-ref', projectId,
      timetableId: 'clean-teacher', teachingUnitId: lesson.teachingUnitId, classId: lesson.classId,
      subjectId: lesson.subjectId, date: lesson.effectiveStart, purpose: 'extra' as const,
      time: { mode: 'period' as const, periodId: lesson.periodId } }] }
    expect(isCompatibleAppDataV8(oneOff)).toBe(true)
    expect(() => deleteTeacherTimetableV8(oneOff, projectId, 'clean-teacher', true)).toThrow()
    const change = { ...clean, overrides: [...clean.overrides, { id: 'change-ref', projectId,
      timetableId: 'clean-teacher', teachingUnitId: lesson.teachingUnitId,
      date: lesson.effectiveStart, periodId: lesson.periodId, action: 'cancel' as const }] }
    expect(isCompatibleAppDataV8(change)).toBe(true)
    expect(() => deleteTeacherTimetableV8(change, projectId, 'clean-teacher', true)).toThrow()
    const progress = { ...clean, teachingProgress: [...clean.teachingProgress, { id: '123e4567-e89b-42d3-a456-426614174011', projectId,
      timetableId: 'clean-teacher', teachingUnitId: lesson.teachingUnitId, classId: lesson.classId,
      subjectId: lesson.subjectId, content: { chapter: '一', unit: '', note: '' }, previousProgress: null,
      createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z' }] }
    expect(isCompatibleAppDataV8(progress)).toBe(true)
    expect(() => deleteTeacherTimetableV8(progress, projectId, 'clean-teacher', true)).toThrow()
  })

  it('blocks deletion for a fixed Lesson or resolved Event, but not another teacher reference', () => {
    const source = migrated()
    const existing = source.timetables[0]
    expect(source.recurringLessons.some((item) => item.timetableId === existing.id)).toBe(true)
    expect(() => deleteTeacherTimetableV8(source, existing.projectId, existing.id, true)).toThrow()
    const added = createTeacherTimetableV8(source, existing.projectId,
      { name: '另一位教師', teacherName: '乙' }, 'event-teacher')
    const unit = source.teachingUnits.find((item) => item.projectId === existing.projectId)!
    const withEvent = { ...added, events: [...added.events, { id: 'event-ref', projectId: existing.projectId,
      teachingUnitId: unit.id, timetableId: 'event-teacher', ownershipStatus: 'resolved' as const,
      title: '教師會議', type: 'meeting' as const, date: unit.startDate,
      startTime: '09:00', endTime: '10:00', color: '#123456' }] }
    expect(isCompatibleAppDataV8(withEvent)).toBe(true)
    expect(() => deleteTeacherTimetableV8(withEvent, existing.projectId, 'event-teacher', true)).toThrow()
    const eventFree = { ...withEvent, events: withEvent.events.filter((item) => item.id !== 'event-ref') }
    const deleted = deleteTeacherTimetableV8(eventFree, existing.projectId, 'event-teacher', true)
    expect(deleted.timetables.some((item) => item.id === existing.id)).toBe(true)
  })
})

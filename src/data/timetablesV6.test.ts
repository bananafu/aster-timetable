import { describe, expect, it } from 'vitest'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { copyTimetable, createTimetable, updateTimetable } from './timetablesV6'
import { createBlankProject, copyProject } from './projectRuntime'
import { updateLessonV4 } from './lessonsV4'
import { cancelLessonOnDate, permanentlyUpdateLesson } from './lessonChangesV4'
import { resolveProjectDay } from '../lib/scheduleV4'
import { isCompatibleAppDataV6 } from './validators/v6'
import type { AppDataV6 } from '../types'

const ready = () => migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))
const confirmed = () => {
  const data = ready()
  return updateTimetable(data, data.timetables[0].id, { name: '原課表', teacherName: '林老師' })
}
const duplicate = (data: AppDataV6, baseDate: string, input: Partial<Parameters<typeof copyTimetable>[1]> = {}) => {
  let id = 0
  return copyTimetable(data, { projectId: data.projects[0].id, sourceTimetableId: data.timetables[0].id, baseDate, ...input }, () => `copied-${++id}`)
}
const newLessons = (data: AppDataV6) => data.recurringLessons.filter((item) => item.timetableId === data.timetables.at(-1)!.id)

describe('v6 timetable management', () => {
  it('creates two empty teacher timetables under the same project without copying shared or teacher data', () => {
    const data = ready()
    const projectId = data.projects[0].id
    const first = createTimetable(data, projectId, { name: '  一年級課表  ', teacherName: '  林老師  ' }, 'teacher-a')
    const second = createTimetable(first, projectId, { name: '二年級課表', teacherName: '陳老師' }, 'teacher-b')
    expect(second.timetables.slice(-2)).toEqual([
      { id: 'teacher-a', projectId, name: '一年級課表', teacherName: '林老師' },
      { id: 'teacher-b', projectId, name: '二年級課表', teacherName: '陳老師' },
    ])
    expect(second.projects).toEqual(data.projects)
    expect(second.schools).toEqual(data.schools)
    expect(second.teachingUnits).toEqual(data.teachingUnits)
    expect(second.classes).toEqual(data.classes)
    expect(second.recurringLessons).toEqual(data.recurringLessons)
    expect(second.overrides).toEqual(data.overrides)
    expect(second.recurringLessons.some((item) => item.timetableId === 'teacher-a' || item.timetableId === 'teacher-b')).toBe(false)
    expect(isCompatibleAppDataV6(second)).toBe(true)
    expect(data.timetables).toHaveLength(1)
  })

  it('rejects missing project, archive, duplicate IDs, and blank names', () => {
    const data = ready()
    const projectId = data.projects[0].id
    const valid = { name: '課表', teacherName: '林老師' }
    expect(() => createTimetable(data, 'missing', valid, 'new')).toThrow('read-only')
    expect(() => createTimetable(data, projectId, valid, data.timetables[0].id)).toThrow('unique')
    expect(() => createTimetable(data, projectId, valid, ' ')).toThrow('unique')
    expect(() => createTimetable(data, projectId, { ...valid, name: '  ' }, 'new')).toThrow('required')
    expect(() => createTimetable(data, projectId, { ...valid, teacherName: '  ' }, 'new')).toThrow('required')
    const archived = { ...data, activeProjectId: null, projects: data.projects.map((item) => ({ ...item, archivedAt: '2027-01-31T00:00:00.000Z' })) }
    expect(() => createTimetable(archived, projectId, valid, 'new')).toThrow('read-only')
    expect(() => updateTimetable(archived, data.timetables[0].id, valid)).toThrow('read-only')
  })

  it('updates pending teacher details without changing timetable, lesson, or override IDs', () => {
    const data = ready()
    const originalId = data.timetables[0].id
    const retained = updateTimetable(data, originalId, { name: '  新名稱  ', teacherName: null })
    expect(retained.timetables[0]).toMatchObject({ id: originalId, projectId: data.projects[0].id, name: '新名稱', teacherName: null, teacherNamePending: true })
    const filled = updateTimetable(retained, originalId, { name: '  數學課表  ', teacherName: '  張老師  ' })
    expect(filled.timetables[0]).toEqual({ id: originalId, projectId: data.projects[0].id, name: '數學課表', teacherName: '張老師', teacherNamePending: undefined })
    expect(filled.recurringLessons).toEqual(data.recurringLessons)
    expect(filled.overrides).toEqual(data.overrides)
    expect(filled.projects).toEqual(data.projects)
    expect(isCompatibleAppDataV6(filled)).toBe(true)
    expect(() => updateTimetable(filled, originalId, { name: '仍在', teacherName: null })).toThrow('Teacher name')
    expect(() => updateTimetable(filled, originalId, { name: ' ', teacherName: '張老師' })).toThrow('name is required')
    expect(() => updateTimetable(filled, 'missing', { name: '課表', teacherName: '張老師' })).toThrow('does not exist')
  })

  it('preserves legacy non-five-minute period values when changing timetable metadata', () => {
    const data = ready()
    data.teachingUnits[0].periods[0].startTime = '08:03'
    data.teachingUnits[0].periods[0].endTime = '08:58'
    const next = createTimetable(data, data.projects[0].id, { name: '第二課表', teacherName: '王老師' }, 'new')
    expect(next.teachingUnits[0].periods[0]).toMatchObject({ startTime: '08:03', endTime: '08:58' })
  })
})

describe('copyTimetable', () => {
  it('copies an empty timetable with default metadata and shared project data only', () => {
    const data = confirmed()
    const empty = createTimetable(data, data.projects[0].id, { name: '空白', teacherName: '王老師' }, 'empty')
    const original = structuredClone(empty)
    const result = duplicate(empty, '2026-09-09', { sourceTimetableId: 'empty' })
    expect(result.timetables.at(-1)).toEqual({ id: 'copied-1', projectId: data.projects[0].id, name: '空白（副本）', teacherName: '王老師' })
    expect(newLessons(result)).toEqual([])
    expect(result.projects).toBe(empty.projects)
    expect(result.schools).toBe(empty.schools)
    expect(result.teachingUnits).toBe(empty.teachingUnits)
    expect(result.classes).toBe(empty.classes)
    expect(result.subjects).toBe(empty.subjects)
    expect(result.events).toBe(empty.events)
    expect(result.overrides).toBe(empty.overrides)
    const customized = duplicate(empty, '2026-09-09', { sourceTimetableId: 'empty', name: '自訂課表', teacherName: '張老師' })
    expect(customized.timetables.at(-1)).toMatchObject({ name: '自訂課表', teacherName: '張老師' })
    expect(empty).toEqual(original)
  })

  it.each(['2026-09-02', '2026-09-09'])('copies all weekdays and both week patterns on %s', (baseDate) => {
    const data = confirmed()
    const result = duplicate(data, baseDate)
    const lessons = newLessons(result)
    expect(lessons).toHaveLength(data.recurringLessons.length)
    expect(new Set(lessons.map((item) => item.day))).toEqual(new Set([1, 2, 3, 4, 5]))
    expect(new Set(lessons.map((item) => item.weekPattern))).toEqual(new Set(['every', 'A', 'B']))
    expect(lessons.every((item) => item.effectiveStart === baseDate && item.effectiveEnd === data.teachingUnits[0].endDate)).toBe(true)
    expect(lessons.map(({ day, periodId, weekPattern, classId, subjectId, teachingUnitId, origin }) => ({ day, periodId, weekPattern, classId, subjectId, teachingUnitId, origin })))
      .toEqual(data.recurringLessons.map(({ day, periodId, weekPattern, classId, subjectId, teachingUnitId, origin }) => ({ day, periodId, weekPattern, classId, subjectId, teachingUnitId, origin })))
    expect(result.teachingUnits[0].weekCycle).toEqual(data.teachingUnits[0].weekCycle)
    expect(result.teachingUnits[0].periods).toEqual(data.teachingUnits[0].periods)
    expect(isCompatibleAppDataV6(result)).toBe(true)
  })

  it('maps timetable, lesson, and series IDs independently without changing the source', () => {
    const data = confirmed()
    const original = structuredClone(data)
    const result = duplicate(data, '2026-09-09')
    const lessons = newLessons(result)
    const originalIds = new Set([...data.timetables.map((item) => item.id), ...data.recurringLessons.flatMap((item) => [item.id, item.seriesId])])
    const generatedIds = [result.timetables.at(-1)!.id, ...lessons.flatMap((item) => [item.id, item.seriesId])]
    expect(new Set(generatedIds).size).toBe(generatedIds.length)
    expect(generatedIds.every((id) => !originalIds.has(id))).toBe(true)
    expect(data).toEqual(original)
  })

  it('selects the version containing the base date at historical, current, and future boundaries', () => {
    const data = confirmed()
    const first = data.recurringLessons.find((item) => item.id === 'c1')!
    first.effectiveEnd = '2026-10-04'
    data.recurringLessons.push({ ...first, id: 'c1-v2', subjectId: 'history', effectiveStart: '2026-10-05', effectiveEnd: '2026-11-01' })
    data.recurringLessons.push({ ...first, id: 'c1-v3', subjectId: 'reading', effectiveStart: '2026-11-02', effectiveEnd: undefined })
    expect(isCompatibleAppDataV6(data)).toBe(true)
    for (const [baseDate, subjectId] of [
      ['2026-10-04', 'chinese'], ['2026-10-05', 'history'], ['2026-11-01', 'history'], ['2026-11-02', 'reading'],
    ]) {
      const result = duplicate(data, baseDate)
      const copied = newLessons(result).filter((item) => item.day === 1 && item.periodId === first.periodId && item.classId === first.classId)
      expect(copied).toHaveLength(1)
      expect(copied[0]).toMatchObject({ subjectId, effectiveStart: baseDate, effectiveEnd: data.teachingUnits[0].endDate })
      expect(copied[0].id).not.toBe(first.id)
      expect(copied[0].seriesId).not.toBe(first.seriesId)
      expect(result.recurringLessons.filter((item) => item.seriesId === copied[0].seriesId)).toHaveLength(1)
      expect(isCompatibleAppDataV6(result)).toBe(true)
    }
    expect(first.effectiveEnd).toBe('2026-10-04')
  })

  it('skips series with no version effective on the base date', () => {
    const data = confirmed()
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    lesson.effectiveStart = '2026-10-05'
    expect(isCompatibleAppDataV6(data)).toBe(true)
    const result = duplicate(data, '2026-09-09')
    expect(newLessons(result)).toHaveLength(data.recurringLessons.length - 1)
    expect(newLessons(result).some((item) => item.day === lesson.day && item.periodId === lesson.periodId && item.classId === lesson.classId)).toBe(false)
  })

  it('includes both teaching-unit boundaries and skips units outside their own term', () => {
    const data = confirmed()
    const originalUnit = data.teachingUnits[0]
    const otherUnit = { ...originalUnit, id: 'unit-next', startDate: '2027-02-01', endDate: '2027-06-30', weekCycle: { ...originalUnit.weekCycle, anchorDate: '2027-02-01' } }
    data.teachingUnits.push(otherUnit)
    data.classes.push({ ...data.classes[0], id: 'class-next', teachingUnitId: otherUnit.id })
    data.recurringLessons.push({ ...data.recurringLessons[0], id: 'lesson-next', seriesId: 'series-next', teachingUnitId: otherUnit.id,
      classId: 'class-next', effectiveStart: otherUnit.startDate, effectiveEnd: otherUnit.endDate })
    expect(isCompatibleAppDataV6(data)).toBe(true)
    for (const baseDate of [originalUnit.startDate, originalUnit.endDate]) {
      const result = duplicate(data, baseDate)
      expect(newLessons(result)).toHaveLength(15)
      expect(newLessons(result).every((item) => item.teachingUnitId === originalUnit.id)).toBe(true)
    }
    for (const baseDate of [otherUnit.startDate, otherUnit.endDate]) {
      const result = duplicate(data, baseDate)
      expect(newLessons(result)).toHaveLength(1)
      expect(newLessons(result)[0]).toMatchObject({ teachingUnitId: otherUnit.id, effectiveStart: baseDate, effectiveEnd: otherUnit.endDate })
    }
    expect(newLessons(duplicate(data, '2027-01-21'))).toEqual([])
  })

  it('handles cross-year and leap-day boundaries without normalizing invalid dates', () => {
    const data = confirmed()
    data.teachingUnits[0].startDate = '2027-12-01'
    data.teachingUnits[0].endDate = '2028-02-29'
    data.teachingUnits[0].weekCycle.anchorDate = '2027-12-01'
    data.recurringLessons.forEach((lesson) => { lesson.effectiveStart = '2027-12-01'; lesson.effectiveEnd = '2028-02-29' })
    expect(isCompatibleAppDataV6(data)).toBe(true)
    for (const baseDate of ['2027-12-01', '2028-01-01', '2028-02-29']) {
      const result = duplicate(data, baseDate)
      expect(newLessons(result)).toHaveLength(data.recurringLessons.length)
      expect(newLessons(result).every((item) => item.effectiveStart === baseDate && item.effectiveEnd === '2028-02-29')).toBe(true)
    }
    expect(newLessons(duplicate(data, '2027-11-30'))).toEqual([])
    expect(newLessons(duplicate(data, '2028-03-01'))).toEqual([])
    for (const baseDate of ['2028-02-30', '2027-02-29', '2028/02/29', '2028-2-9', '']) {
      expect(() => duplicate(data, baseDate)).toThrow('Base date')
    }
  })

  it('leaves project events and all source or unassigned overrides shared or unchanged', () => {
    const data = confirmed()
    const lesson = data.recurringLessons[0]
    const base = { projectId: lesson.projectId, timetableId: lesson.timetableId, teachingUnitId: lesson.teachingUnitId,
      date: '2026-09-07', periodId: lesson.periodId, originalLessonId: lesson.id }
    data.events.push({ id: 'shared-event', projectId: lesson.projectId, title: '共同會議', type: 'meeting', date: '2026-09-09', startTime: '12:00', endTime: '13:00', color: '#A66D52' })
    data.overrides.push({ ...base, id: 'cancel', action: 'cancel' })
    data.overrides.push({ ...base, id: 'replace', action: 'replace', replacement: { subjectId: lesson.subjectId, classId: lesson.classId } })
    data.overrides.push({ ...base, id: 'move-a', action: 'move', groupId: 'swap', target: { date: '2026-09-08', periodId: 2 } })
    data.overrides.push({ ...base, id: 'move-b', action: 'move', groupId: 'swap', target: { date: '2026-09-08', periodId: 3 } })
    data.overrides.push({ id: 'orphan', projectId: null, timetableId: null, teachingUnitId: null, date: '2026-09-09', periodId: 1, action: 'cancel' })
    expect(isCompatibleAppDataV6(data)).toBe(true)
    const result = duplicate(data, '2026-09-09')
    expect(result.events).toBe(data.events)
    expect(result.overrides).toBe(data.overrides)
    expect(result.overrides.some((item) => item.timetableId === result.timetables.at(-1)!.id)).toBe(false)
    expect(newLessons(result)).toHaveLength(data.recurringLessons.length)
  })

  it('keeps copied and source lessons independent for edits, versions, overrides, and conflicts', () => {
    const data = confirmed()
    const copied = duplicate(data, '2026-09-09')
    const original = data.recurringLessons.find((item) => item.id === 'c1')!
    const clone = newLessons(copied).find((item) => item.day === original.day && item.periodId === original.periodId && item.classId === original.classId)!
    const schoolId = copied.teachingUnits.find((item) => item.id === clone.teachingUnitId)!.schoolId
    const draft = { projectId: clone.projectId, timetableId: clone.timetableId, schoolId, teachingUnitId: clone.teachingUnitId,
      subjectId: clone.subjectId, classId: clone.classId, day: clone.day, periodId: clone.periodId, weekPattern: clone.weekPattern }
    const edited = updateLessonV4(copied, clone.id, { ...draft, room: '副本教室' })
    expect(edited.recurringLessons.find((item) => item.id === original.id)).toEqual(original)
    expect(edited.recurringLessons.find((item) => item.id === clone.id)?.room).toBe('副本教室')
    const versioned = permanentlyUpdateLesson(edited, clone.id, '2026-09-14', { ...draft, room: '新教室' }, () => 'copy-version')
    expect(versioned.recurringLessons.find((item) => item.id === 'copy-version')).toMatchObject({ seriesId: clone.seriesId, timetableId: clone.timetableId })
    expect(versioned.recurringLessons.find((item) => item.id === original.id)).toEqual(original)
    const changed = cancelLessonOnDate(versioned, 'copy-version', '2026-09-14', () => 'copy-cancel', clone.timetableId)
    expect(changed.overrides.at(-1)).toMatchObject({ timetableId: clone.timetableId, originalLessonId: 'copy-version' })
    expect(resolveProjectDay(changed, clone.projectId, new Date(2026, 8, 14), { timetableId: data.timetables[0].id }).find((item) => item.id === original.id)?.status).toBe('regular')
    expect(resolveProjectDay(changed, clone.projectId, new Date(2026, 8, 14), { timetableId: clone.timetableId }).find((item) => item.id === 'copy-version')?.status).toBe('cancelled')
    expect(resolveProjectDay(copied, clone.projectId, new Date(2026, 8, 14), { timetableId: clone.timetableId }).find((item) => item.id === clone.id)?.hasConflict).toBe(false)
    expect(resolveProjectDay(copied, clone.projectId, new Date(2026, 8, 14), { timetableId: data.timetables[0].id }).find((item) => item.id === original.id)?.hasConflict).toBe(false)
  })

  it('rejects missing or cross-project sources, archived projects, and pending teachers', () => {
    const data = confirmed()
    const input = { projectId: data.projects[0].id, sourceTimetableId: data.timetables[0].id, baseDate: '2026-09-09' }
    expect(() => copyTimetable(data, { ...input, sourceTimetableId: 'missing' }, () => 'new')).toThrow('Source timetable')
    const pending = ready()
    expect(() => duplicate(pending, input.baseDate)).toThrow('Source teacher name is pending')
    const archived = { ...data, activeProjectId: null, projects: data.projects.map((item) => ({ ...item, archivedAt: '2027-02-01T00:00:00.000Z' })) }
    expect(() => copyTimetable(archived, input, () => 'new')).toThrow('read-only')
    let id = 0
    const other = createBlankProject(data, { name: '其他專案', teacherName: '王老師', academicYear: 116, semester: 'first', startDate: '2027-08-30', endDate: '2028-01-20' }, () => `other-${++id}`)
    expect(() => copyTimetable(other, { ...input, projectId: other.projects.at(-1)!.id }, () => 'new')).toThrow('does not belong')
  })

  it('rejects blank metadata and invalid or colliding generated IDs without changing input', () => {
    const data = confirmed()
    data.events.push({ id: 'event-existing', projectId: data.projects[0].id, title: '共同會議', type: 'meeting', date: '2026-09-09', startTime: '12:00', endTime: '13:00', color: '#A66D52' })
    const original = structuredClone(data)
    const input = { projectId: data.projects[0].id, sourceTimetableId: data.timetables[0].id, baseDate: '2026-09-09' }
    expect(() => copyTimetable(data, { ...input, name: '   ' }, () => 'new')).toThrow('required')
    expect(() => copyTimetable(data, { ...input, teacherName: '   ' }, () => 'new')).toThrow('required')
    expect(() => copyTimetable(data, { ...input, teacherName: null }, () => 'new')).toThrow('required')
    for (const id of ['', '   ', data.projects[0].id, data.timetables[0].id, data.recurringLessons[0].id, data.recurringLessons[0].seriesId, 'event-existing']) {
      expect(() => copyTimetable(data, input, () => id)).toThrow('ID is invalid or already in use')
    }
    expect(() => copyTimetable(data, input, () => 'same-id')).toThrow('ID is invalid or already in use')
    const ids = ['new-table', 'new-series', data.recurringLessons[0].id]
    expect(() => copyTimetable(data, input, () => ids.shift()!)).toThrow('ID is invalid or already in use')
    expect(data).toEqual(original)
  })

  it('rejects invalid source data atomically and keeps the existing multi-timetable project-copy guard', () => {
    const data = confirmed()
    const original = structuredClone(data)
    const invalid = structuredClone(data)
    invalid.recurringLessons[0].effectiveEnd = '2026-08-30'
    expect(() => duplicate(invalid, '2026-09-09')).toThrow('Valid v6 data is required')
    expect(invalid.recurringLessons).toHaveLength(data.recurringLessons.length)
    const invalidReference = structuredClone(data)
    invalidReference.recurringLessons[0].classId = 'missing-class'
    expect(() => duplicate(invalidReference, '2026-09-09')).toThrow('Valid v6 data is required')
    const invalidSeries = structuredClone(data)
    invalidSeries.recurringLessons[0].seriesId = invalidSeries.recurringLessons[1].seriesId
    expect(() => duplicate(invalidSeries, '2026-09-09')).toThrow('Valid v6 data is required')
    const copied = duplicate(data, '2026-09-09')
    const unit = data.teachingUnits[0]
    expect(() => copyProject(copied, { sourceProjectId: data.projects[0].id, name: '下一學期', academicYear: 116,
      semester: 'first', units: [{ sourceUnitId: unit.id, startDate: '2027-08-30', endDate: '2028-01-19', anchorDate: '2027-08-30', anchorPattern: 'A' }] }, () => 'unused'))
      .toThrow('Multiple or missing timetables')
    expect(data).toEqual(original)
  })
})

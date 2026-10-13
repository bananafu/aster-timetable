import { describe, expect, it } from 'vitest'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { createTimetable, updateTimetable } from './timetablesV6'
import { isCompatibleAppDataV6 } from './validators/v6'

const ready = () => migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))

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

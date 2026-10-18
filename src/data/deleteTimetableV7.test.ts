import { describe, expect, it } from 'vitest'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { createTimetable } from './timetablesV6'
import { isCompatibleAppDataV7 } from './validators/v7'
import { deleteTimetable } from './deleteTimetableV7'

const base = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))

describe('deleteTimetable', () => {
  it('removes only the selected timetable and its lessons, overrides, one-offs and related warnings', () => {
    const source = base()
    const projectId = source.projects[0].id
    const targetId = source.timetables[0].id
    const second = createTimetable(source, projectId, { name: '另一份課表', teacherName: '王老師' }, 'second-timetable')
    const otherProject = { ...second,
      projects: [...second.projects, { ...second.projects[0], id: 'other-project', name: '其他專案' }],
      timetables: [...second.timetables, { id: 'other-timetable', projectId: 'other-project', name: '其他教師課表', teacherName: '陳老師' }] }
    const lesson = otherProject.recurringLessons[0]
    const override = { id: 'target-override', projectId, timetableId: targetId, teachingUnitId: lesson.teachingUnitId,
      date: '2026-09-07', periodId: lesson.periodId, action: 'cancel' as const, originalLessonId: lesson.id }
    const siblingLesson = { ...lesson, id: 'sibling-lesson', seriesId: 'sibling-lesson', timetableId: 'second-timetable' }
    const targetOneOff = { id: 'target-one-off', projectId, timetableId: targetId, teachingUnitId: lesson.teachingUnitId,
      classId: lesson.classId, subjectId: lesson.subjectId, date: '2026-09-08', purpose: 'extra' as const,
      time: { mode: 'custom' as const, startTime: '18:00', endTime: '18:45' } }
    const siblingOneOff = { ...targetOneOff, id: 'sibling-one-off', timetableId: 'second-timetable' }
    const data = { ...otherProject, recurringLessons: [...otherProject.recurringLessons, siblingLesson],
      overrides: [...otherProject.overrides, override], oneOffLessons: [targetOneOff, siblingOneOff],
      migrationWarnings: [...otherProject.migrationWarnings,
        { id: 'lesson-warning', entityType: 'lesson' as const, entityId: lesson.id, message: '舊課程' },
        { id: 'override-warning', entityType: 'override' as const, entityId: override.id, message: '舊異動' },
        { id: 'class-warning', entityType: 'class' as const, entityId: otherProject.classes[0].id, message: '舊班級' }] }
    expect(isCompatibleAppDataV7(data)).toBe(true)
    const snapshot = structuredClone(data)
    const next = deleteTimetable(data, projectId, targetId)
    expect(data).toEqual(snapshot)
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(next.timetables.map((item) => item.id)).not.toContain(targetId)
    expect(next.timetables).toContainEqual(data.timetables.find((item) => item.id === 'second-timetable'))
    expect(next.recurringLessons).toEqual([siblingLesson])
    expect(next.overrides).toEqual([])
    expect(next.oneOffLessons).toEqual([siblingOneOff])
    expect(next.migrationWarnings.map((item) => item.id)).toEqual(['class-warning'])
    for (const field of ['projects', 'schools', 'teachingUnits', 'classes', 'subjects', 'events'] as const) expect(next[field]).toEqual(data[field])
  })

  it('allows deleting the final timetable while preserving the project and settings', () => {
    const data = base()
    const projectId = data.projects[0].id
    const next = deleteTimetable(data, projectId, data.timetables[0].id)
    expect(next.timetables).toEqual([])
    expect(next.recurringLessons).toEqual([])
    expect(next.projects).toEqual(data.projects)
    expect(next.schools).toEqual(data.schools)
    expect(next.teachingUnits).toEqual(data.teachingUnits)
    expect(isCompatibleAppDataV7(next)).toBe(true)
  })

  it('rejects missing, cross-project, archived and invalid source data without mutation', () => {
    const data = base()
    const snapshot = structuredClone(data)
    const projectId = data.projects[0].id
    expect(() => deleteTimetable(data, 'missing', data.timetables[0].id)).toThrow('找不到')
    expect(() => deleteTimetable(data, projectId, 'missing')).toThrow('不屬於')
    const secondProject = { ...data.projects[0], id: 'second-project', name: '第二專案' }
    const multi = { ...data, projects: [...data.projects, secondProject] }
    expect(() => deleteTimetable(multi, secondProject.id, data.timetables[0].id)).toThrow('不屬於')
    const archived = { ...data, activeProjectId: null, projects: data.projects.map((item) => ({ ...item, archivedAt: '2026-10-01T00:00:00.000Z' })) }
    expect(() => deleteTimetable(archived, projectId, data.timetables[0].id)).toThrow('唯讀')
    expect(() => deleteTimetable({ ...data, recurringLessons: [{ ...data.recurringLessons[0], timetableId: 'missing' }] }, projectId, data.timetables[0].id)).toThrow('有效')
    expect(data).toEqual(snapshot)
  })
})

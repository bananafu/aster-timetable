import { describe, expect, it } from 'vitest'
import type { AppDataV4 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { createProject, mergeProjectView, projectToLegacyView, renameProject, switchActiveProject } from './projectRuntime'

function twoProjects(): AppDataV4 {
  const data = migrateV3ToV4(structuredClone(initialData))
  const firstProject = data.projects[0]
  const firstSchool = data.schools[0]
  const firstUnit = data.teachingUnits[0]
  data.projects.push({ ...firstProject, id: 'project-2', name: '第二份課表' })
  data.schools.push({ ...firstSchool, id: 'school-2', projectId: 'project-2', name: '第二所學校' })
  data.teachingUnits.push({ ...firstUnit, id: 'unit-2', projectId: 'project-2', schoolId: 'school-2' })
  data.classes.push({ id: 'class-2', projectId: 'project-2', teachingUnitId: 'unit-2', name: '二年二班' })
  data.recurringLessons.push({ ...data.recurringLessons[0], id: 'lesson-2', seriesId: 'lesson-2', projectId: 'project-2', teachingUnitId: 'unit-2', classId: 'class-2' })
  data.events.push({ id: 'event-2', projectId: 'project-2', teachingUnitId: 'unit-2', title: '第二專案事件', type: 'meeting', date: firstUnit.startDate, startTime: '10:00', endTime: '11:00', color: '#563F2E' })
  data.overrides.push({ id: 'override-2', projectId: 'project-2', teachingUnitId: 'unit-2', date: firstUnit.startDate, periodId: firstUnit.periods[0].id, action: 'cancel', originalLessonId: 'lesson-2' })
  return data
}

describe('v4 project runtime projection', () => {
  it('可新增、重新命名與切換專案，且不複製業務資料', () => {
    const source = migrateV3ToV4(structuredClone(initialData))
    const ids = ['new-project', 'new-school', 'new-unit']
    const created = createProject(source, { name: ' 新課表 ', academicYear: 116, semester: 'first', startDate: '2027-08-30', endDate: '2028-01-20' }, () => ids.shift()!, '2027-07-01T00:00:00.000Z')
    expect(created.activeProjectId).toBe('new-project')
    expect(created.projects.find((item) => item.id === 'new-project')?.name).toBe('新課表')
    expect(created.classes.filter((item) => item.projectId === 'new-project')).toHaveLength(0)
    expect(created.recurringLessons.filter((item) => item.projectId === 'new-project')).toHaveLength(0)
    expect(created.events.filter((item) => item.projectId === 'new-project')).toHaveLength(0)
    expect(created.overrides.filter((item) => item.projectId === 'new-project')).toHaveLength(0)
    const renamed = renameProject(created, 'new-project', '更名後', '2027-07-02T00:00:00.000Z')
    expect(renamed.projects.find((item) => item.id === 'new-project')).toMatchObject({ name: '更名後', updatedAt: '2027-07-02T00:00:00.000Z' })
    expect(switchActiveProject(renamed, source.activeProjectId!).activeProjectId).toBe(source.activeProjectId)
  })

  it('切換 project 時只投影該專案的課程、班級、事件及異動', () => {
    const data = twoProjects()
    const first = projectToLegacyView(data, data.projects[0].id)
    const second = projectToLegacyView(data, 'project-2')
    expect(first.classes.some((item) => item.id === 'class-2')).toBe(false)
    expect(first.courses.some((item) => item.id === 'lesson-2')).toBe(false)
    expect(first.events.some((item) => item.id === 'event-2')).toBe(false)
    expect(first.overrides.some((item) => item.id === 'override-2')).toBe(false)
    expect(second.classes.map((item) => item.id)).toEqual(['class-2'])
    expect(second.courses.map((item) => item.id)).toEqual(['lesson-2'])
    expect(second.events.map((item) => item.id)).toContain('event-2')
    expect(second.overrides.map((item) => item.id)).toEqual(['override-2'])
  })

  it('更新目前 project 不會覆寫其他專案資料', () => {
    const data = twoProjects()
    const firstId = data.projects[0].id
    const view = projectToLegacyView(data, firstId)
    view.courses[0] = { ...view.courses[0], room: '更新教室' }
    const result = mergeProjectView(data, firstId, view)
    expect(result.recurringLessons.find((item) => item.id === view.courses[0].id)?.room).toBe('更新教室')
    expect(result.recurringLessons.find((item) => item.id === 'lesson-2')).toEqual(data.recurringLessons.find((item) => item.id === 'lesson-2'))
    expect(result.classes.find((item) => item.id === 'class-2')).toEqual(data.classes.find((item) => item.id === 'class-2'))
    expect(result.events.find((item) => item.id === 'event-2')).toEqual(data.events.find((item) => item.id === 'event-2'))
    expect(result.overrides.find((item) => item.id === 'override-2')).toEqual(data.overrides.find((item) => item.id === 'override-2'))
  })

  it('未歸屬事件可按日期顯示，未歸屬異動不參與任何 project 排課', () => {
    const data = twoProjects()
    data.events.push({ id: 'global-event', projectId: null, teachingUnitId: null, title: '未分類活動', type: 'activity', date: '2026-10-01', startTime: '12:00', endTime: '13:00', color: '#563F2E' })
    data.overrides.push({ id: 'orphan', projectId: null, teachingUnitId: null, date: '2026-10-01', periodId: 1, action: 'cancel' })
    expect(projectToLegacyView(data, data.projects[0].id).events.some((item) => item.id === 'global-event')).toBe(true)
    expect(projectToLegacyView(data, 'project-2').events.some((item) => item.id === 'global-event')).toBe(true)
    expect(projectToLegacyView(data, data.projects[0].id).overrides.some((item) => item.id === 'orphan')).toBe(false)
    expect(projectToLegacyView(data, 'project-2').overrides.some((item) => item.id === 'orphan')).toBe(false)
  })
})

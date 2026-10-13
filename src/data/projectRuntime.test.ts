import { describe, expect, it } from 'vitest'
import type { AppDataV4 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { archiveProject, copyProject, createBlankProject, createProject, deleteProject, mergeProjectView, projectToLegacyView, reactivateProject, renameProject, switchActiveProject } from './projectRuntime'
import { isAppDataV4 } from './validators/v4'

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
  it('建立空白專案使用明確預設，不複製目前專案資料', () => {
    const source = migrateV3ToV4(structuredClone(initialData))
    const ids = ['blank-project', 'blank-school', 'blank-unit']
    const created = createBlankProject(source, { name: '空白課表', academicYear: 116, semester: 'second', startDate: '2028-02-01', endDate: '2028-06-30' }, () => ids.shift()!, '2028-01-01T00:00:00.000Z')
    expect(created.schools.find((item) => item.id === 'blank-school')).toMatchObject({ name: '我的學校', color: '#A5A051' })
    expect(created.teachingUnits.find((item) => item.id === 'blank-unit')).toMatchObject({ schoolLevel: 'senior-high', startDate: '2028-02-01', endDate: '2028-06-30' })
    expect(created.classes.filter((item) => item.projectId === 'blank-project')).toHaveLength(0)
    expect(created.recurringLessons.filter((item) => item.projectId === 'blank-project')).toHaveLength(0)
    expect(isAppDataV4(created)).toBe(true)
  })

  it('複製新學期建立全新 project-scoped IDs 且不複製事件與異動', () => {
    const source = migrateV3ToV4(structuredClone(initialData))
    let counter = 0
    const copied = copyProject(source, {
      sourceProjectId: source.activeProjectId!, name: '116 學年度課表', academicYear: 116, semester: 'first',
      units: source.teachingUnits.map((unit) => ({ sourceUnitId: unit.id, startDate: '2027-08-30', endDate: '2028-01-19', anchorDate: '2027-08-30', anchorPattern: 'B' })),
    }, () => `copy-${++counter}`, '2027-07-01T00:00:00.000Z')
    const copiedId = copied.activeProjectId!
    const originalIds = new Set([
      ...source.schools.map((item) => item.id), ...source.teachingUnits.map((item) => item.id),
      ...source.classes.map((item) => item.id), ...source.recurringLessons.map((item) => item.id),
    ])
    const newEntityIds = [
      ...copied.schools.filter((item) => item.projectId === copiedId).map((item) => item.id),
      ...copied.teachingUnits.filter((item) => item.projectId === copiedId).map((item) => item.id),
      ...copied.classes.filter((item) => item.projectId === copiedId).map((item) => item.id),
      ...copied.recurringLessons.filter((item) => item.projectId === copiedId).map((item) => item.id),
    ]
    expect(newEntityIds.every((id) => !originalIds.has(id))).toBe(true)
    expect(copied.recurringLessons.filter((item) => item.projectId === copiedId)).toHaveLength(source.recurringLessons.length)
    expect(copied.events.filter((item) => item.projectId === copiedId)).toHaveLength(0)
    expect(copied.overrides.filter((item) => item.projectId === copiedId)).toHaveLength(0)
    expect(copied.teachingUnits.find((item) => item.projectId === copiedId)).toMatchObject({ startDate: '2027-08-30', endDate: '2028-01-19', weekCycle: { anchorDate: '2027-08-30', anchorPattern: 'B', enabled: true } })
    expect(isAppDataV4(copied)).toBe(true)
  })

  it('複製時缺少新日期或含多版本課程會阻止操作', () => {
    const source = migrateV3ToV4(structuredClone(initialData))
    expect(() => copyProject(source, { sourceProjectId: source.activeProjectId!, name: '新學期', academicYear: 116, semester: 'first', units: [] }, () => 'id')).toThrow()
    source.recurringLessons.push({ ...source.recurringLessons[0], id: 'version-2', effectiveStart: '2026-10-01', effectiveEnd: source.recurringLessons[0].effectiveEnd })
    source.recurringLessons[0].effectiveEnd = '2026-09-30'
    expect(() => copyProject(source, {
      sourceProjectId: source.activeProjectId!, name: '新學期', academicYear: 116, semester: 'first',
      units: source.teachingUnits.map((unit) => ({ sourceUnitId: unit.id, startDate: '2027-08-30', endDate: '2028-01-19', anchorDate: '2027-08-30', anchorPattern: 'A' })),
    }, () => crypto.randomUUID())).toThrow('Versioned lessons')
  })

  it('封存、重新啟用與刪除維持其他專案及全域科目不變', () => {
    const data = twoProjects()
    const firstId = data.projects[0].id
    const subjects = structuredClone(data.subjects)
    const archived = archiveProject(data, firstId, '2027-01-01T00:00:00.000Z')
    expect(archived.activeProjectId).toBe('project-2')
    expect(archived.projects.find((item) => item.id === firstId)?.archivedAt).toBeTruthy()
    const restored = reactivateProject(archived, firstId, '2027-01-02T00:00:00.000Z')
    expect(restored.activeProjectId).toBe(firstId)
    expect(restored.projects.find((item) => item.id === firstId)?.archivedAt).toBeUndefined()
    const deleted = deleteProject(restored, firstId)
    expect(deleted.projects.map((item) => item.id)).toEqual(['project-2'])
    expect(deleted.schools.some((item) => item.projectId === firstId)).toBe(false)
    expect(deleted.recurringLessons.some((item) => item.projectId === firstId)).toBe(false)
    expect(deleted.projects.find((item) => item.id === 'project-2')).toEqual(data.projects.find((item) => item.id === 'project-2'))
    expect(deleted.subjects).toEqual(subjects)
    expect(isAppDataV4(deleted)).toBe(true)
  })

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

  it('legacy view 寫回時保留原生 v4 move override', () => {
    const data = twoProjects()
    const projectId = data.projects[0].id
    const lesson = data.recurringLessons.find((item) => item.projectId === projectId)!
    data.overrides.push({
      id: 'native-move', projectId, teachingUnitId: lesson.teachingUnitId, date: '2026-09-07',
      periodId: lesson.periodId, action: 'move', originalLessonId: lesson.id,
      target: { date: '2026-09-07', periodId: lesson.periodId },
    })
    const view = projectToLegacyView(data, projectId)
    expect(view.overrides.some((item) => item.id === 'native-move')).toBe(false)
    const merged = mergeProjectView(data, projectId, view)
    expect(merged.overrides.find((item) => item.id === 'native-move')).toEqual(data.overrides.find((item) => item.id === 'native-move'))
  })
})

import { describe, expect, it } from 'vitest'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { addClass, addSchool, addTeachingUnit, createDefaultPeriods, removeClass, removeSchool, removeTeachingUnit, updateClass, updateSchool, updateTeachingUnit } from './academicSettingsV4'
import { isAppDataV4 } from './validators/v4'

const source = () => migrateV3ToV4(structuredClone(initialData))

describe('v4 academic settings', () => {
  it('同一 project 可新增及編輯多所學校，顏色由 School 共用', () => {
    const data = source(); const projectId = data.activeProjectId!
    const added = addSchool(data, projectId, { name: '第二所學校', color: '#718B6C' }, 'school-2')
    const updated = updateSchool(added, 'school-2', { name: '第二所高中', color: '#563F2E' })
    expect(updated.schools.filter((item) => item.projectId === projectId)).toHaveLength(2)
    expect(updated.schools.find((item) => item.id === 'school-2')).toMatchObject({ name: '第二所高中', color: '#563F2E' })
    expect(isAppDataV4(updated)).toBe(true)
  })

  it('國中預設 45 分鐘、高中預設 50 分鐘，且皆使用 5 分鐘刻度', () => {
    const junior = createDefaultPeriods('junior-high')
    const senior = createDefaultPeriods('senior-high')
    expect(junior[0]).toMatchObject({ startTime: '08:10', endTime: '08:55' })
    expect(senior[0]).toMatchObject({ startTime: '08:10', endTime: '09:00' })
    expect([...junior, ...senior].every((item) => Number(item.startTime.slice(3)) % 5 === 0 && Number(item.endTime.slice(3)) % 5 === 0)).toBe(true)
  })

  it('每所學校可有多個獨立日期、節次及輪週設定的任教單位', () => {
    const data = source(); const schoolId = data.schools[0].id
    const result = addTeachingUnit(data, schoolId, { name: '國中部', schoolLevel: 'junior-high', startDate: '2026-09-01', endDate: '2027-01-15', weekCycle: { enabled: true, anchorDate: '2026-09-02', anchorPattern: 'B' } }, 'junior-unit')
    const unit = result.teachingUnits.find((item) => item.id === 'junior-unit')!
    expect(unit).toMatchObject({ schoolId, schoolLevel: 'junior-high', startDate: '2026-09-01', endDate: '2027-01-15', weekCycle: { anchorPattern: 'B' } })
    expect(unit.periods[0]).toMatchObject({ startTime: '08:10', endTime: '08:55' })
    expect(isAppDataV4(result)).toBe(true)
  })

  it('可新增及編輯 project-scoped 班級與所屬 TeachingUnit', () => {
    const data = source(); const projectId = data.activeProjectId!; const firstUnit = data.teachingUnits[0]
    const withUnit = addTeachingUnit(data, data.schools[0].id, { name: '第二單位', schoolLevel: 'senior-high', startDate: '2026-08-31', endDate: '2027-01-20', weekCycle: { enabled: true, anchorDate: '2026-08-31', anchorPattern: 'A' } }, 'unit-2')
    const added = addClass(withUnit, projectId, { name: '新班級', room: '301', teachingUnitId: firstUnit.id }, 'new-class')
    const moved = updateClass(added, 'new-class', { name: '新班級甲', room: '302', teachingUnitId: 'unit-2' })
    expect(moved.classes.find((item) => item.id === 'new-class')).toMatchObject({ name: '新班級甲', room: '302', teachingUnitId: 'unit-2', projectId })
    expect(isAppDataV4(moved)).toBe(true)
  })

  it('阻止刪除仍被引用的學校、任教單位、班級與節次', () => {
    const data = source(); const unit = data.teachingUnits[0]; const schoolClass = data.classes[0]
    expect(() => removeSchool(data, data.schools[0].id)).toThrow('仍有任教單位')
    expect(() => removeTeachingUnit(data, unit.id)).toThrow('仍被班級')
    expect(() => removeClass(data, schoolClass.id)).toThrow('仍被課程')
    expect(() => updateTeachingUnit(data, unit.id, { ...unit, periods: unit.periods.filter((item) => item.id !== data.recurringLessons[0].periodId) })).toThrow('仍被課程或異動引用')
  })

  it('阻止有 A/B 課程時停用輪週及有課程時跨單位搬移班級', () => {
    const data = source(); const unit = data.teachingUnits[0]; const schoolClass = data.classes.find((item) => item.id === data.recurringLessons.find((item) => item.weekPattern === 'A')?.classId)!
    expect(() => updateTeachingUnit(data, unit.id, { ...unit, weekCycle: { ...unit.weekCycle, enabled: false } })).toThrow('仍有 A/B 週課程')
    const withUnit = addTeachingUnit(data, data.schools[0].id, { name: '第二單位', schoolLevel: 'senior-high', startDate: unit.startDate, endDate: unit.endDate, weekCycle: { ...unit.weekCycle } }, 'unit-2')
    expect(() => updateClass(withUnit, schoolClass.id, { name: schoolClass.name, room: schoolClass.room, teachingUnitId: 'unit-2' })).toThrow('已有課程或異動引用')
  })

  it('日期範圍改變時保護課程與異動，並解除範圍外事件的 unit 分類', () => {
    const data = source(); const unit = data.teachingUnits[0]
    expect(() => updateTeachingUnit(data, unit.id, { ...unit, startDate: '2026-09-01' })).toThrow('既有固定課程版本')
    const withoutLessons = { ...data, recurringLessons: [], overrides: [], events: [{ id: 'event', projectId: data.activeProjectId, teachingUnitId: unit.id, title: '活動', type: 'activity' as const, date: '2026-08-31', startTime: '09:00', endTime: '10:00', color: '#563F2E' }] }
    const result = updateTeachingUnit(withoutLessons, unit.id, { ...unit, startDate: '2026-09-01' })
    expect(result.events[0].teachingUnitId).toBeNull()
    expect(result.events[0].projectId).toBe(data.activeProjectId)
  })

  it('允許安全刪除沒有引用的班級、任教單位與學校', () => {
    const data = source(); const projectId = data.activeProjectId!
    let result = addSchool(data, projectId, { name: '臨時學校', color: '#718B6C' }, 'temporary-school')
    result = addTeachingUnit(result, 'temporary-school', { name: '臨時單位', schoolLevel: 'other', startDate: '2026-09-01', endDate: '2027-01-15', weekCycle: { enabled: false, anchorDate: '2026-09-01', anchorPattern: 'A' } }, 'temporary-unit')
    result = addClass(result, projectId, { name: '臨時班級', teachingUnitId: 'temporary-unit' }, 'temporary-class')
    result = removeClass(result, 'temporary-class')
    result = removeTeachingUnit(result, 'temporary-unit')
    result = removeSchool(result, 'temporary-school')
    expect(isAppDataV4(result)).toBe(true)
  })
})

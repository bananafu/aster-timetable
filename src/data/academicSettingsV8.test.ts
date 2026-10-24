import { describe, expect, it } from 'vitest'
import { createBlankProject } from './projectRuntimeV8'
import { createEmptyAppDataV8 } from './storageV8'
import { createSchoolV8, createTeachingUnitV8, updateSchoolV8, updateTeachingUnitV8 } from './academicSettingsV8'
import { createClassV8 } from './classesV8'
import { isCompatibleAppDataV8 } from './validators/v8'

function fixture() {
  let id = 0
  return createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `id-${++id}`)
}
describe('V8 academic settings', () => {
  it('creates Project-scoped schools and independent TeachingUnit terms, anchors and periods', () => {
    const base = fixture()
    const projectId = base.activeProjectId!
    const withSchool = createSchoolV8(base, projectId, { name: '第二校', color: '#123456' }, 'school-b')
    const original = withSchool.teachingUnits[0]
    const withUnit = createTeachingUnitV8(withSchool, projectId, { schoolId: 'school-b', name: '第二單位',
      schoolLevel: 'junior-high', startDate: '2026-09-01', endDate: '2027-01-20',
      weekCycle: { enabled: true, anchorDate: '2026-09-08', anchorPattern: 'B' },
      periods: [{ id: 2, order: 1, label: '第 1 節', startTime: '08:15', endTime: '09:00' }] }, 'unit-b')
    expect(isCompatibleAppDataV8(withUnit)).toBe(true)
    expect(withUnit.teachingUnits[0]).toEqual(original)
    expect(withUnit.teachingUnits[1].weekCycle.anchorPattern).toBe('B')
    expect(withUnit.teachingUnits[1].periods[0].startTime).toBe('08:15')
    expect(updateSchoolV8(withUnit, projectId, 'school-b', { name: '新校名', color: '#654321' })
      .schools.find((item) => item.id === 'school-b')?.name).toBe('新校名')
    expect(() => createSchoolV8(withUnit, 'other', { name: '外校', color: '#123456' }, 'wrong')).toThrow()
  })

  it('rejects invalid actual time and high-risk changes after a Unit gains references', () => {
    const base = fixture()
    const projectId = base.activeProjectId!
    const unit = base.teachingUnits[0]
    const draft = { schoolId: unit.schoolId, name: unit.name, schoolLevel: unit.schoolLevel,
      startDate: unit.startDate, endDate: unit.endDate, periods: unit.periods.map((item) => ({ ...item })),
      weekCycle: { ...unit.weekCycle } }
    expect(() => updateTeachingUnitV8(base, projectId, unit.id, { ...draft,
      periods: [{ id: 1, order: 1, label: '錯誤', startTime: '09:00', endTime: '08:00' }] })).toThrow()
    expect(() => updateTeachingUnitV8(base, projectId, unit.id, { ...draft, startDate: '2026-02-30' })).toThrow()
    const referenced = createClassV8(base, projectId, { teachingUnitId: unit.id, name: '一甲' }, 'class-a')
    expect(() => updateTeachingUnitV8(referenced, projectId, unit.id, { ...draft,
      weekCycle: { ...draft.weekCycle, anchorPattern: 'B' } })).toThrow(/引用/)
    expect(() => updateTeachingUnitV8(referenced, projectId, unit.id, { ...draft,
      periods: draft.periods.map((item, index) => index === 0 ? { ...item, startTime: '08:15' } : item) })).toThrow(/引用/)
    expect(updateTeachingUnitV8(referenced, projectId, unit.id, { ...draft, name: '改名' })
      .teachingUnits[0].name).toBe('改名')
    expect(referenced.teachingUnits[0].name).toBe(unit.name)
  })
})

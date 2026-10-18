import { describe, expect, it } from 'vitest'
import { initialData } from './seed'
import { createBlankProject } from './projectRuntime'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { isCompatibleAppDataV6, isSafeAppDataV6Update } from './validators/v6'
import { createInitialAppDataV6 } from '../hooks/useAppDataV4'
import { addTeachingUnitToSchool, createSchoolWithTeachingUnit, type NewTeachingUnitInput, type SchoolUnitCreationContext } from './schoolUnitCreation'

function setup() {
  let index = 0
  return createBlankProject(createInitialAppDataV6(), {
    name: '教師專案', teacherName: '林老師', academicYear: 115, semester: 'first',
    startDate: '2026-08-31', endDate: '2027-01-20',
  }, () => `setup-${++index}`, '2026-08-01T00:00:00.000Z')
}

const context = (projectId: string): SchoolUnitCreationContext => ({ projectId, readOnly: false })
const unit = (schoolLevel: 'junior-high' | 'senior-high'): NewTeachingUnitInput => ({
  schoolLevel, startDate: '2027-02-01', endDate: '2027-06-30',
})

describe('atomic school and teaching-unit creation', () => {
  it.each([['junior-high', 45], ['senior-high', 50]] as const)('creates a school and first %s unit in one valid AppData (%i minutes)', (level, duration) => {
    const current = setup()
    const next = createSchoolWithTeachingUnit(current, context(current.activeProjectId!), { name: '  第二學校  ', color: '#345678' }, unit(level), { schoolId: 'new-school', teachingUnitId: 'new-unit' })
    const school = next.schools.find((item) => item.id === 'new-school')!
    const teachingUnit = next.teachingUnits.find((item) => item.id === 'new-unit')!
    expect(school).toMatchObject({ projectId: current.activeProjectId, name: '第二學校', color: '#345678' })
    expect(teachingUnit).toMatchObject({ projectId: current.activeProjectId, schoolId: school.id, name: level === 'junior-high' ? '國中部' : '高中部', schoolLevel: level, startDate: '2027-02-01', endDate: '2027-06-30', timezone: 'Asia/Taipei', weekCycle: { enabled: true, anchorDate: '2027-02-01', anchorPattern: 'A' } })
    expect(teachingUnit.periods).toHaveLength(8)
    expect(teachingUnit.periods.map((period) => period.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(teachingUnit.periods.every((period) => {
      const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
      return minutes(period.endTime) - minutes(period.startTime) === duration
        && minutes(period.startTime) % 5 === 0 && minutes(period.endTime) % 5 === 0
    })).toBe(true)
    expect(next.projects).toEqual(current.projects)
    expect(next.timetables).toEqual(current.timetables)
    expect(isCompatibleAppDataV6(next)).toBe(true)
    expect(isSafeAppDataV6Update(current, next)).toBe(true)
    expect(current.schools).toHaveLength(1)
    expect(current.teachingUnits).toHaveLength(1)
  })

  it('adds another level to an existing school without changing its color, IDs, other units or references', () => {
    const current = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))
    const school = current.schools.find((item) => item.projectId === current.activeProjectId)!
    const original = structuredClone(current)
    const next = addTeachingUnitToSchool(current, context(current.activeProjectId!), school.id, unit('junior-high'), 'new-junior-unit')
    expect(next.schools).toEqual(original.schools)
    expect(next.teachingUnits.slice(0, -1)).toEqual(original.teachingUnits)
    expect(next.teachingUnits.at(-1)).toMatchObject({ id: 'new-junior-unit', schoolId: school.id, schoolLevel: 'junior-high' })
    expect(next.schools.find((item) => item.id === school.id)?.color).toBe(school.color)
    expect(next.projects).toEqual(original.projects)
    expect(next.timetables).toEqual(original.timetables)
    expect(next.subjects).toEqual(original.subjects)
    expect(next.classes).toEqual(original.classes)
    expect(next.recurringLessons).toEqual(original.recurringLessons)
    expect(next.overrides).toEqual(original.overrides)
    expect(next.events).toEqual(original.events)
    expect(current).toEqual(original)
    expect(isSafeAppDataV6Update(current, next)).toBe(true)
  })

  it('rejects the same schoolLevel and does not merge legacy duplicate units', () => {
    const current = setup()
    const duplicate = { ...current.teachingUnits[0], id: 'legacy-duplicate', periods: current.teachingUnits[0].periods.map((item) => ({ ...item })) }
    const legacy = { ...current, teachingUnits: [...current.teachingUnits, duplicate] }
    const snapshot = structuredClone(legacy)
    expect(() => addTeachingUnitToSchool(legacy, context(legacy.activeProjectId!), legacy.schools[0].id, unit('senior-high'), 'another-senior')).toThrow('同一學校不可重複建立相同學制')
    const next = addTeachingUnitToSchool(legacy, context(legacy.activeProjectId!), legacy.schools[0].id, unit('junior-high'), 'new-junior')
    expect(next.teachingUnits.slice(0, 2)).toEqual(snapshot.teachingUnits)
    expect(next.teachingUnits).toHaveLength(3)
    expect(legacy).toEqual(snapshot)
  })

  it('rejects invalid school, unit, dates and IDs without producing orphan records', () => {
    const current = setup()
    const snapshot = structuredClone(current)
    const base = { schoolId: 'new-school', teachingUnitId: 'new-unit' }
    const create = (school = { name: '新學校', color: '#345678' }, draft: NewTeachingUnitInput = unit('junior-high'), ids = base) => createSchoolWithTeachingUnit(current, context(current.activeProjectId!), school, draft, ids)
    expect(() => create({ name: '', color: '#345678' })).toThrow()
    expect(() => create({ name: '新學校', color: 'invalid' })).toThrow()
    expect(() => create(undefined, { ...unit('junior-high'), endDate: '2027-01-01' })).toThrow()
    expect(() => create(undefined, { ...unit('junior-high'), startDate: '2027-02-30' })).toThrow('安全驗證')
    expect(() => create(undefined, { schoolLevel: 'other', startDate: '2027-02-01', endDate: '2027-06-30' })).toThrow('自訂名稱')
    expect(() => create(undefined, unit('junior-high'), { schoolId: 'same-id', teachingUnitId: 'same-id' })).toThrow('ID')
    expect(() => create(undefined, unit('junior-high'), { schoolId: current.schools[0].id, teachingUnitId: 'new-unit' })).toThrow('ID')
    const subjectId = current.subjects[0]?.id ?? 'shared-id'
    const withSubject = { ...current, subjects: [...current.subjects, { id: subjectId, name: '既有科目', shortName: '既科', color: '#123456', applicableSchoolLevels: ['junior-high' as const] }] }
    expect(() => createSchoolWithTeachingUnit(withSubject, context(withSubject.activeProjectId!), { name: '新學校', color: '#345678' }, unit('junior-high'), { schoolId: 'new-school', teachingUnitId: subjectId })).toThrow('ID')
    expect(() => addTeachingUnitToSchool(current, context(current.activeProjectId!), 'missing-school', unit('junior-high'), 'new-unit')).toThrow('不屬於目前專案')
    expect(current).toEqual(snapshot)
  })

  it('rejects archived, inactive and explicitly read-only projects', () => {
    const current = setup()
    const archived = { ...current, projects: current.projects.map((project) => ({ ...project, archivedAt: '2027-01-01T00:00:00.000Z' })) }
    const school = { name: '新學校', color: '#345678' }
    const ids = { schoolId: 'new-school', teachingUnitId: 'new-unit' }
    expect(() => createSchoolWithTeachingUnit(archived, context(current.activeProjectId!), school, unit('junior-high'), ids)).toThrow('不可編輯')
    expect(() => createSchoolWithTeachingUnit(current, { ...context(current.activeProjectId!), readOnly: true }, school, unit('junior-high'), ids)).toThrow('不可編輯')
    expect(() => addTeachingUnitToSchool(current, { projectId: 'another-project', readOnly: false }, current.schools[0].id, unit('junior-high'), 'new-unit')).toThrow('不可編輯')
    expect(current.schools).toHaveLength(1)
    expect(current.teachingUnits).toHaveLength(1)
  })
})

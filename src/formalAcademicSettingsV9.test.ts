import { describe, expect, it, vi } from 'vitest'
import { createEmptyProjectV9 } from './data/managementV9'
import { createEmptyAppDataV8 } from './data/storageV8'
import { createFormalAcademicSettingsV9Controller,
  type FormalAcademicSettingsV9Selection } from './formalAcademicSettingsV9'
import type { FormalV9HostPort } from './formalRuntime'
import type { AppDataV9 } from './types/v9'

const empty = (): AppDataV9 => ({ ...createEmptyAppDataV8(), schemaVersion: 9, subjects: [] })
const selection = (projectId: string, timetableId: string | null = null,
  teachingUnitId: string | null = null): FormalAcademicSettingsV9Selection => ({
  projectId, timetableId, teachingUnitId,
})
const ids = (...values: string[]) => {
  let index = 0
  return () => values[index++] ?? `unused-${index}`
}

function hostFixture(initial: AppDataV9, options: {
  writable?: boolean
  status?: FormalV9HostPort['status']
  pending?: boolean
  currentForUpdate?: AppDataV9
  receiptRevisionOffset?: number
} = {}) {
  let document = initial
  let revision = 0
  const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
    const next = produce(options.currentForUpdate ?? document)
    const mismatch = options.receiptRevisionOffset !== undefined
    const receipt = { raw: JSON.stringify(next), revision: revision + 1 + (options.receiptRevisionOffset ?? 0),
      attemptId: 'academic-v9' }
    if (!mismatch) { document = next; revision += 1 }
    return receipt
  })
  const host = {
    get document() { return document }, status: options.status ?? 'active',
    writable: options.writable ?? true, pending: options.pending ?? false,
    receipt: null, get revision() { return revision }, errorCode: null, update,
  } satisfies FormalV9HostPort
  return { host, update, document: () => document }
}

const unitInput = { schoolLevel: 'senior-high' as const, startDate: '2027-08-01', endDate: '2028-01-31' }

describe('formal V9 School and TeachingUnit controller', () => {
  it('creates a School and first level in a null-term Project through one Host receipt', async () => {
    const data = createEmptyProjectV9(empty(), { name: '空白專案' }, 'project-a')
    const host = hostFixture(data)
    const result = await createFormalAcademicSettingsV9Controller(host.host,
      ids('school-a', 'unit-a'), selection('project-a')).actions
      .createSchoolWithTeachingUnit({ name: '甲校', color: '#718B6C' }, unitInput)

    expect(host.update).toHaveBeenCalledOnce()
    expect(result.document.projects[0].term).toBeNull()
    expect(result.document.schools).toEqual([expect.objectContaining({
      id: 'school-a', projectId: 'project-a', name: '甲校',
    })])
    expect(result.document.teachingUnits).toEqual([expect.objectContaining({
      id: 'unit-a', projectId: 'project-a', schoolId: 'school-a', name: '高中部',
      startDate: unitInput.startDate, endDate: unitInput.endDate,
      weekCycle: { enabled: true, anchorDate: unitInput.startDate, anchorPattern: 'A' },
    })])
    expect(result.selection).toEqual(selection('project-a', null, 'unit-a'))
    expect(result.document.timetables).toEqual([])
    expect(result.document.classes).toEqual([])
    expect(result.document.subjects).toEqual([])
  })

  it('requires explicit valid dates and does not leave a partial School on failure', async () => {
    const data = createEmptyProjectV9(empty(), { name: '空白專案' }, 'project-a')
    const host = hostFixture(data)
    const controller = createFormalAcademicSettingsV9Controller(host.host,
      ids('school-a', 'unit-a'), selection('project-a'))
    await expect(controller.actions.createSchoolWithTeachingUnit(
      { name: '甲校', color: '#718B6C' }, { ...unitInput, startDate: '', endDate: '' }))
      .rejects.toThrow()
    expect(host.document().schools).toEqual([])
    expect(host.document().teachingUnits).toEqual([])
  })

  it('creates another level and edits School/TeachingUnit without changing ownership', async () => {
    let data = createEmptyProjectV9(empty(), { name: '空白專案' }, 'project-a')
    let host = hostFixture(data)
    data = (await createFormalAcademicSettingsV9Controller(host.host,
      ids('school-a', 'unit-a'), selection('project-a')).actions
      .createSchoolWithTeachingUnit({ name: '甲校', color: '#718B6C' }, unitInput)).document

    host = hostFixture(data)
    const added = await createFormalAcademicSettingsV9Controller(host.host,
      ids('unit-b'), selection('project-a', null, 'unit-a')).actions.createTeachingUnit('school-a', {
        schoolLevel: 'junior-high', startDate: '2027-08-15', endDate: '2028-01-15',
      })
    expect(added.document.teachingUnits.at(-1)).toMatchObject({
      id: 'unit-b', projectId: 'project-a', schoolId: 'school-a', name: '國中部',
    })

    host = hostFixture(added.document)
    const controller = createFormalAcademicSettingsV9Controller(host.host,
      ids(), selection('project-a', null, 'unit-b'))
    const school = await controller.actions.updateSchool('school-a', { name: '甲校更新', color: '#123456' })
    expect(school.document.schools[0]).toMatchObject({ name: '甲校更新', color: '#123456' })

    host = hostFixture(school.document)
    const unit = school.document.teachingUnits.find((item) => item.id === 'unit-b')!
    const updated = await createFormalAcademicSettingsV9Controller(host.host,
      ids(), selection('project-a', null, 'unit-b')).actions.updateTeachingUnit('unit-b', {
        schoolId: unit.schoolId, name: unit.name, schoolLevel: unit.schoolLevel,
        startDate: '2027-08-20', endDate: unit.endDate, periods: unit.periods,
        weekCycle: { ...unit.weekCycle, anchorDate: '2027-08-20' },
      })
    expect(updated.document.teachingUnits.find((item) => item.id === 'unit-b')).toMatchObject({
      projectId: 'project-a', schoolId: 'school-a', startDate: '2027-08-20',
    })
  })

  it('rejects cross-Project ownership and callbacks captured before Project or Timetable switch', async () => {
    let data = createEmptyProjectV9(empty(), { name: '甲' }, 'project-a')
    data = createEmptyProjectV9(data, { name: '乙' }, 'project-b')
    const host = hostFixture(data)
    const current = selection('project-a', 'teacher-a')
    const controller = createFormalAcademicSettingsV9Controller(host.host, ids('school-a'), current,
      () => current)
    expect(() => controller.actions.updateSchool('missing', { name: '跨專案', color: '#718B6C' }))
      .toThrow(expect.objectContaining({ code: 'scope-mismatch' }))

    let live = current
    const staleSelection = createFormalAcademicSettingsV9Controller(host.host, ids('school-a'), current,
      () => live)
    live = selection('project-a', 'teacher-b')
    await expect(staleSelection.actions.createSchool({ name: '不應建立', color: '#718B6C' }))
      .rejects.toMatchObject({ code: 'scope-mismatch' })
    expect(host.update).not.toHaveBeenCalled()
  })

  it.each([
    [{ pending: true }, 'duplicate-submit'],
    [{ writable: false }, 'not-writable'],
    [{ status: 'conflict' as const }, 'not-writable'],
    [{ receiptRevisionOffset: 3 }, 'receipt-mismatch'],
  ] as const)('fails closed for Host state %#', async (options, code) => {
    const data = createEmptyProjectV9(empty(), { name: '空白專案' }, 'project-a')
    const host = hostFixture(data, options)
    await expect(createFormalAcademicSettingsV9Controller(host.host, ids('school-a'), selection('project-a'))
      .actions.createSchool({ name: '不應建立', color: '#718B6C' })).rejects.toMatchObject({ code })
    expect(host.document().schools).toEqual([])
  })

  it('rejects a stale document and keeps deletion outside the formal action contract', async () => {
    const data = createEmptyProjectV9(empty(), { name: '空白專案' }, 'project-a')
    const changed = { ...data, activeProjectId: null }
    const host = hostFixture(data, { currentForUpdate: changed })
    const controller = createFormalAcademicSettingsV9Controller(host.host, ids('school-a'), selection('project-a'))
    await expect(controller.actions.createSchool({ name: '不應建立', color: '#718B6C' }))
      .rejects.toMatchObject({ code: 'stale-document' })
    expect('deleteSchool' in controller.actions).toBe(false)
    expect('deleteTeachingUnit' in controller.actions).toBe(false)
  })
})

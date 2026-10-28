import { describe, expect, it, vi } from 'vitest'
import { archiveProjectV9, createClassV9, createEmptyProjectV9, createSchoolV9 } from './data/managementV9'
import { createEmptyAppDataV8 } from './data/storageV8'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9,
  createTeacherTimetableV9, createTeachingUnitV9, TeacherSubjectV9Error,
  type SubjectDraftV9 } from './data/teacherSubjectsV9'
import { isCompatibleAppDataV9 } from './data/validators/v9'
import type { FormalV9HostPort } from './formalRuntime'
import { createFormalSubjectManagementV9Controller, FormalSubjectManagementV9Error,
  presentFormalSubjectManagementV9, type FormalSubjectManagementV9Selection } from './formalSubjectManagementV9'
import type { AppDataV9 } from './types/v9'

const empty = (): AppDataV9 => ({ ...createEmptyAppDataV8(), schemaVersion: 9 }) as AppDataV9
const projectInput = (name: string, semester: 'first' | 'second' = 'first') => ({
  name, academicYear: 116, semester, startDate: semester === 'first' ? '2027-08-01' : '2028-02-01',
  endDate: semester === 'first' ? '2028-01-31' : '2028-07-31',
})
const math = { name: '數學', shortName: '數', color: '#647C88',
  applicableSchoolLevels: ['junior-high', 'senior-high'] as const }
const custom = (name = '自訂科目', shortName = '自訂') => ({ name, shortName, color: '#123456',
  applicableSchoolLevels: ['senior-high' as const] })
const idFactory = (prefix: string) => {
  let serial = 0
  return () => `${prefix}-${++serial}`
}

function scopeFixture() {
  const id = idFactory('fixture')
  let data = createBlankProjectV9(empty(), projectInput('Project A'), id)
  const projectA = data.activeProjectId!
  const seniorA = data.teachingUnits.find((item) => item.projectId === projectA)!
  data = createTeachingUnitV9(data, projectA, {
    schoolId: seniorA.schoolId, name: '國中部', schoolLevel: 'junior-high',
    startDate: seniorA.startDate, endDate: seniorA.endDate, periods: seniorA.periods,
    weekCycle: seniorA.weekCycle,
  }, 'unit-a-junior')
  data = createTeacherTimetableV9(data, projectA, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV9(data, projectA, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  data = createBlankProjectV9(data, projectInput('Project B', 'second'), id)
  const projectB = data.activeProjectId!
  const seniorB = data.teachingUnits.find((item) => item.projectId === projectB)!
  data = createTeacherTimetableV9(data, projectB, { name: '丙課表', teacherName: '丙' }, 'teacher-c')
  return { data, projectA, projectB, seniorA, juniorA: data.teachingUnits.find((item) => item.id === 'unit-a-junior')!,
    seniorB, selectionA: { projectId: projectA, timetableId: 'teacher-a',
      teachingUnitId: seniorA.id } satisfies FormalSubjectManagementV9Selection }
}

function hostFixture(initial: AppDataV9, options: {
  writable?: boolean
  status?: FormalV9HostPort['status']
  pending?: boolean
  reject?: Error
  currentForUpdate?: AppDataV9
  receiptRevisionOffset?: number
  receiptRaw?: string
  emptyAttemptId?: boolean
  hold?: boolean
} = {}) {
  let document = initial
  let revision = 0
  let release: (() => void) | null = null
  const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
    if (options.reject) throw options.reject
    const next = produce(options.currentForUpdate ?? document)
    if (options.hold) await new Promise<void>((resolve) => { release = resolve })
    const mismatched = options.receiptRevisionOffset !== undefined || options.receiptRaw !== undefined
      || options.emptyAttemptId
    const receipt = { raw: options.receiptRaw ?? JSON.stringify(next),
      revision: revision + 1 + (options.receiptRevisionOffset ?? 0),
      attemptId: options.emptyAttemptId ? '' : 'stage-s2-2' }
    if (!mismatched) {
      document = next
      revision += 1
    }
    return receipt
  })
  const host = {
    get document() { return document }, status: options.status ?? 'active',
    writable: options.writable ?? true, pending: options.pending ?? false,
    receipt: null, get revision() { return revision }, errorCode: null, update,
  } satisfies FormalV9HostPort
  return { host, update, document: () => document, revision: () => revision,
    release: () => { const complete = release as (() => void) | null; complete?.() } }
}

function addSubject(data: AppDataV9, projectId: string, timetableId: string,
  subjectId: string, draft: SubjectDraftV9 = { ...math,
    applicableSchoolLevels: [...math.applicableSchoolLevels] }) {
  return createTeacherSubjectV9(data, projectId, timetableId, {
    ...draft, applicableSchoolLevels: [...draft.applicableSchoolLevels],
  }, subjectId)
}

describe('formal V9 Subject controller and presenter', () => {
  it('keeps teacher Subject ownership isolated in a null-term Project through one Host write', async () => {
    const source = scopeFixture()
    let data = createEmptyProjectV9(source.data, { name: '未設定' }, 'blank')
    data = createSchoolV9(data, 'blank', { name: '乙校', color: '#123456' }, 'blank-school')
    data = createTeachingUnitV9(data, 'blank', { schoolId: 'blank-school', name: '高中部',
      schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31',
      periods: source.seniorA.periods,
      weekCycle: { enabled: true, anchorDate: '2027-08-01', anchorPattern: 'A' } }, 'blank-unit')
    data = createTeacherTimetableV9(data, 'blank', { name: '甲課表', teacherName: '甲' }, 'blank-teacher-a')
    data = createTeacherTimetableV9(data, 'blank', { name: '乙課表', teacherName: '乙' }, 'blank-teacher-b')
    data = addSubject(data, 'blank', 'blank-teacher-b', 'blank-subject-b')
    const host = hostFixture(data)
    const selection = { projectId: 'blank', timetableId: 'blank-teacher-a', teachingUnitId: 'blank-unit' }
    const result = await createFormalSubjectManagementV9Controller(host.host, () => 'blank-subject-a', selection)
      .actions.createCustom({ ...math, applicableSchoolLevels: [...math.applicableSchoolLevels] })
    expect(result.document.projects.find((item) => item.id === 'blank')?.term).toBeNull()
    expect(presentFormalSubjectManagementV9(result.document, selection).subjects.map((item) => item.id))
      .toEqual(['blank-subject-a'])
    expect(result.document.subjects.find((item) => item.id === 'blank-subject-b')?.timetableId)
      .toBe('blank-teacher-b')
    expect(host.update).toHaveBeenCalledTimes(1)
  })

  it('isolates Subjects with the same name between teachers', () => {
    const fixture = scopeFixture()
    let data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    data = addSubject(data, fixture.projectA, 'teacher-b', 'math-b')
    const view = presentFormalSubjectManagementV9(data, fixture.selectionA)
    expect(view.subjects.map((item) => item.id)).toEqual(['math-a'])
    expect(view.subjects[0].name).toBe('數學')
    expect(isCompatibleAppDataV9(data)).toBe(true)
  })

  it('isolates Subjects with the same name between Projects', () => {
    const fixture = scopeFixture()
    let data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    data = addSubject(data, fixture.projectB, 'teacher-c', 'math-c')
    const viewA = presentFormalSubjectManagementV9(data, fixture.selectionA)
    const viewB = presentFormalSubjectManagementV9(data, {
      projectId: fixture.projectB, timetableId: 'teacher-c', teachingUnitId: fixture.seniorB.id,
    })
    expect(viewA.subjects.map((item) => item.id)).toEqual(['math-a'])
    expect(viewB.subjects.map((item) => item.id)).toEqual(['math-c'])
    expect(viewA.catalog.find((item) => item.entry.name === '數學')?.existingSubjectId).toBe('math-a')
    expect(viewB.catalog.find((item) => item.entry.name === '數學')?.existingSubjectId).toBe('math-c')
  })

  it('permits same-name Subjects across teachers and Projects without conflict states', () => {
    const fixture = scopeFixture()
    let data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    data = addSubject(data, fixture.projectA, 'teacher-b', 'math-b')
    data = addSubject(data, fixture.projectB, 'teacher-c', 'math-c')
    expect(isCompatibleAppDataV9(data)).toBe(true)
    const item = presentFormalSubjectManagementV9(data, fixture.selectionA).catalog
      .find((candidate) => candidate.entry.name === '數學')!
    expect(item.status).toBe('available-to-configure')
    expect(item.existingSubjectId).toBe('math-a')
  })

  it('includes only current-teacher relations in the selected TeachingUnit', () => {
    const fixture = scopeFixture()
    let data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    data = addSubject(data, fixture.projectA, 'teacher-b', 'math-b')
    data = configureTeacherSubjectV9(data, fixture.projectA, 'teacher-a', fixture.seniorA.id,
      'math-a', 'relation-a')
    data = configureTeacherSubjectV9(data, fixture.projectA, 'teacher-b', fixture.seniorA.id,
      'math-b', 'relation-b')
    const view = presentFormalSubjectManagementV9(data, fixture.selectionA)
    expect(view.currentTeachingUnitConfigurations).toEqual([
      expect.objectContaining({ id: 'relation-a', subjectId: 'math-a' }),
    ])
    expect(view.configuredSubjects.map((item) => item.id)).toEqual(['math-a'])
  })

  it('configures an existing unconfigured Subject without creating another Subject', async () => {
    const fixture = scopeFixture()
    const data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    const host = hostFixture(data)
    const controller = createFormalSubjectManagementV9Controller(host.host, () => 'relation-new', fixture.selectionA)
    const catalog = controller.view.catalog.find((item) => item.entry.name === '數學')!
    expect(catalog.status).toBe('available-to-configure')
    const result = await controller.actions.configure('math-a')
    expect(result.document.subjects.filter((item) => item.id === 'math-a')).toHaveLength(1)
    expect(result.document.teachingUnitSubjects).toContainEqual(expect.objectContaining({
      id: 'relation-new', subjectId: 'math-a', teachingUnitId: fixture.seniorA.id,
    }))
  })

  it('reports an already configured catalog Subject as configured', () => {
    const fixture = scopeFixture()
    let data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    data = configureTeacherSubjectV9(data, fixture.projectA, 'teacher-a', fixture.seniorA.id,
      'math-a', 'relation-a')
    const item = presentFormalSubjectManagementV9(data, fixture.selectionA).catalog
      .find((candidate) => candidate.entry.name === '數學')!
    expect(item).toMatchObject({ status: 'configured', existingSubjectId: 'math-a',
      canCreateAndConfigure: false, canConfigure: false })
  })

  it('requires explicit confirmation before extending a Subject school level', async () => {
    const fixture = scopeFixture()
    const juniorOnly = { name: '生物', shortName: '生', color: '#718B6C',
      applicableSchoolLevels: ['junior-high' as const] }
    const data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'biology-a', juniorOnly)
    const ids = idFactory('relation')
    const host = hostFixture(data)
    const controller = createFormalSubjectManagementV9Controller(host.host, ids, fixture.selectionA)
    expect(controller.view.catalog.find((item) => item.entry.name === '生物'))
      .toMatchObject({ status: 'requires-level-confirmation', requiresLevelConfirmation: true })
    await expect(controller.actions.configure('biology-a')).rejects
      .toMatchObject({ code: 'level-confirmation-required' })
    expect(host.document().teachingUnitSubjects).toEqual(data.teachingUnitSubjects)
    const result = await controller.actions.configure('biology-a', true)
    expect(result.document.subjects.find((item) => item.id === 'biology-a')?.applicableSchoolLevels)
      .toEqual(['junior-high', 'senior-high'])
  })

  it('creates a custom Subject without an implicit configuration', async () => {
    const fixture = scopeFixture()
    const host = hostFixture(fixture.data)
    const result = await createFormalSubjectManagementV9Controller(
      host.host, () => 'custom-a', fixture.selectionA,
    ).actions.createCustom(custom())
    expect(result.subjectId).toBe('custom-a')
    expect(result.document.subjects).toContainEqual(expect.objectContaining({
      id: 'custom-a', projectId: fixture.projectA, timetableId: 'teacher-a',
    }))
    expect(result.document.teachingUnitSubjects.some((item) => item.subjectId === 'custom-a')).toBe(false)
  })

  it('creates and configures one catalog Subject atomically in one Host update', async () => {
    const fixture = scopeFixture()
    const host = hostFixture(fixture.data)
    const ids = ['catalog-subject', 'catalog-relation']
    const result = await createFormalSubjectManagementV9Controller(
      host.host, () => ids.shift()!, fixture.selectionA,
    ).actions.createAndConfigureFromCatalog('core.mathematics')
    expect(host.update).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ subjectId: 'catalog-subject', configurationId: 'catalog-relation',
      receipt: { revision: 1, attemptId: 'stage-s2-2' } })
    expect(result.document.subjects).toContainEqual(expect.objectContaining({
      id: 'catalog-subject', name: '數學', timetableId: 'teacher-a',
    }))
    expect(result.document.teachingUnitSubjects).toContainEqual(expect.objectContaining({
      id: 'catalog-relation', subjectId: 'catalog-subject', teachingUnitId: fixture.seniorA.id,
    }))
    expect(result.view.catalog.find((item) => item.entry.name === '數學')?.status).toBe('configured')
  })

  it('does not persist a half-created Subject when atomic catalog configuration fails', async () => {
    const fixture = scopeFixture()
    const host = hostFixture(fixture.data)
    const ids = ['catalog-subject', fixture.projectA]
    const controller = createFormalSubjectManagementV9Controller(host.host, () => ids.shift()!, fixture.selectionA)
    await expect(controller.actions.createAndConfigureFromCatalog('core.mathematics'))
      .rejects.toMatchObject({ code: 'id-collision' })
    expect(host.update).toHaveBeenCalledTimes(1)
    expect(host.document()).toEqual(fixture.data)
    expect(host.document().subjects.some((item) => item.id === 'catalog-subject')).toBe(false)
  })

  it('retains a Subject after removing its last configuration', async () => {
    const fixture = scopeFixture()
    let data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    data = configureTeacherSubjectV9(data, fixture.projectA, 'teacher-a', fixture.seniorA.id,
      'math-a', 'relation-a')
    const host = hostFixture(data)
    const result = await createFormalSubjectManagementV9Controller(
      host.host, idFactory('unused'), fixture.selectionA,
    ).actions.unconfigure('math-a')
    expect(result.document.teachingUnitSubjects.some((item) => item.id === 'relation-a')).toBe(false)
    expect(result.document.subjects).toContainEqual(expect.objectContaining({ id: 'math-a' }))
  })

  it('blocks unconfiguration and permanent deletion while the Subject has a Lesson reference', async () => {
    const fixture = scopeFixture()
    let data = createClassV9(fixture.data, fixture.projectA,
      { teachingUnitId: fixture.seniorA.id, grade: 1, classNumber: 1 }, 'class-a')
    data = addSubject(data, fixture.projectA, 'teacher-a', 'math-a')
    data = configureTeacherSubjectV9(data, fixture.projectA, 'teacher-a', fixture.seniorA.id,
      'math-a', 'relation-a')
    data = { ...data, recurringLessons: [{
      id: 'lesson-a', seriesId: 'series-a', projectId: fixture.projectA, timetableId: 'teacher-a',
      teachingUnitId: fixture.seniorA.id, subjectId: 'math-a', classId: 'class-a', day: 1,
      periodId: fixture.seniorA.periods[0].id, weekPattern: 'every',
      effectiveStart: fixture.seniorA.startDate, effectiveEnd: fixture.seniorA.endDate,
    }] }
    expect(isCompatibleAppDataV9(data)).toBe(true)
    const host = hostFixture(data)
    const controller = createFormalSubjectManagementV9Controller(host.host, idFactory('unused'), fixture.selectionA)
    expect(controller.actions.impact('math-a').references).toContainEqual(expect.objectContaining({ kind: 'lesson' }))
    await expect(controller.actions.unconfigure('math-a')).rejects
      .toMatchObject({ code: 'configuration-referenced' })
    await expect(controller.actions.delete('math-a')).rejects.toMatchObject({ code: 'subject-referenced' })
    expect(host.document()).toEqual(data)
  })

  it('rejects stale snapshots and callbacks captured before a selection switch', async () => {
    const fixture = scopeFixture()
    const external = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'external-subject', custom('外部', '外'))
    const stale = hostFixture(fixture.data, { currentForUpdate: external })
    await expect(createFormalSubjectManagementV9Controller(stale.host, () => 'new-subject', fixture.selectionA)
      .actions.createCustom(custom())).rejects.toMatchObject({ code: 'stale-document' })
    expect(stale.document()).toEqual(fixture.data)

    let currentSelection = fixture.selectionA
    const switched = hostFixture(fixture.data)
    const controller = createFormalSubjectManagementV9Controller(switched.host, () => 'not-created',
      fixture.selectionA, () => currentSelection)
    currentSelection = { ...fixture.selectionA, timetableId: 'teacher-b' }
    await expect(controller.actions.createCustom(custom())).rejects.toMatchObject({ code: 'scope-mismatch' })
    expect(switched.update).not.toHaveBeenCalled()
  })

  it('fails closed for pending, readonly, conflict, rejected and mismatched-receipt Hosts', async () => {
    const fixture = scopeFixture()
    const pending = hostFixture(fixture.data, { pending: true })
    await expect(createFormalSubjectManagementV9Controller(pending.host, idFactory('pending'), fixture.selectionA)
      .actions.createCustom(custom())).rejects.toMatchObject({ code: 'duplicate-submit' })
    const readonly = hostFixture(fixture.data, { writable: false })
    await expect(createFormalSubjectManagementV9Controller(readonly.host, idFactory('readonly'), fixture.selectionA)
      .actions.createCustom(custom())).rejects.toMatchObject({ code: 'not-writable' })
    const conflict = hostFixture(fixture.data, { status: 'conflict' })
    await expect(createFormalSubjectManagementV9Controller(conflict.host, idFactory('conflict'), fixture.selectionA)
      .actions.createCustom(custom())).rejects.toMatchObject({ code: 'not-writable' })
    const rejected = hostFixture(fixture.data, { reject: new Error('storage-conflict') })
    await expect(createFormalSubjectManagementV9Controller(rejected.host, idFactory('rejected'), fixture.selectionA)
      .actions.createCustom(custom())).rejects.toThrow('storage-conflict')
    const mismatch = hostFixture(fixture.data, { receiptRevisionOffset: 2 })
    await expect(createFormalSubjectManagementV9Controller(mismatch.host, idFactory('mismatch'), fixture.selectionA)
      .actions.createCustom(custom())).rejects.toMatchObject({ code: 'receipt-mismatch' })
    expect(mismatch.document()).toEqual(fixture.data)
  })

  it('prevents duplicate submission from creating duplicate Subjects', async () => {
    const fixture = scopeFixture()
    const host = hostFixture(fixture.data, { hold: true })
    const controller = createFormalSubjectManagementV9Controller(host.host, idFactory('subject'), fixture.selectionA)
    const first = controller.actions.createCustom(custom('第一科', '第一'))
    await expect(controller.actions.createCustom(custom('第二科', '第二')))
      .rejects.toMatchObject({ code: 'duplicate-submit' })
    host.release()
    await expect(first).resolves.toMatchObject({ receipt: { revision: 1 } })
    expect(host.document().subjects.filter((item) => item.timetableId === 'teacher-a')).toHaveLength(1)
  })

  it('deletes an unconfigured Subject and recreates the same name with a new ID', async () => {
    const fixture = scopeFixture()
    const data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'old-id')
    const host = hostFixture(data)
    await createFormalSubjectManagementV9Controller(host.host, idFactory('unused'), fixture.selectionA)
      .actions.delete('old-id')
    const recreated = await createFormalSubjectManagementV9Controller(host.host, () => 'new-id', fixture.selectionA)
      .actions.createCustom({ ...math, applicableSchoolLevels: [...math.applicableSchoolLevels] })
    expect(recreated.document.subjects.some((item) => item.id === 'old-id')).toBe(false)
    expect(recreated.document.subjects).toContainEqual(expect.objectContaining({ id: 'new-id', name: '數學' }))
  })

  it('keeps an archived Project readable but disables and rejects writes', async () => {
    const fixture = scopeFixture()
    let data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    data = archiveProjectV9(data, fixture.projectA, '2026-10-27T03:00:00.000Z')
    const host = hostFixture(data)
    const controller = createFormalSubjectManagementV9Controller(host.host, idFactory('archived'), fixture.selectionA)
    expect(controller.view.subjects.map((item) => item.id)).toEqual(['math-a'])
    expect(controller.view.actions.createCustom).toMatchObject({ enabled: false, reason: '封存 Project 為唯讀。' })
    await expect(controller.actions.createCustom(custom())).rejects.toMatchObject({ code: 'scope-mismatch' })
    expect(host.update).not.toHaveBeenCalled()
  })

  it('removes only the selected TeachingUnit configuration', async () => {
    const fixture = scopeFixture()
    let data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    data = configureTeacherSubjectV9(data, fixture.projectA, 'teacher-a', fixture.seniorA.id,
      'math-a', 'relation-senior')
    data = configureTeacherSubjectV9(data, fixture.projectA, 'teacher-a', fixture.juniorA.id,
      'math-a', 'relation-junior')
    const host = hostFixture(data)
    const result = await createFormalSubjectManagementV9Controller(
      host.host, idFactory('unused'), fixture.selectionA,
    ).actions.unconfigure('math-a')
    expect(result.document.teachingUnitSubjects.some((item) => item.id === 'relation-senior')).toBe(false)
    expect(result.document.teachingUnitSubjects).toContainEqual(expect.objectContaining({ id: 'relation-junior' }))
  })

  it('preserves concrete alias and short-name catalog conflicts without auto-merging', () => {
    const fixture = scopeFixture()
    let data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'legacy-chinese',
      { name: '國文', shortName: '文', color: '#123456', applicableSchoolLevels: ['senior-high'] as const })
    data = addSubject(data, fixture.projectA, 'teacher-a', 'custom-arts',
      { name: '生活藝術課', shortName: '藝生', color: '#654321', applicableSchoolLevels: ['senior-high'] as const })
    const catalog = presentFormalSubjectManagementV9(data, fixture.selectionA).catalog
    expect(catalog.find((item) => item.entry.name === '國語文')).toMatchObject({
      status: 'alias-match-review', canConfigure: false, canCreateAndConfigure: false,
    })
    expect(catalog.find((item) => item.entry.name === '藝術生活')).toMatchObject({
      status: 'short-name-conflict', canConfigure: false, canCreateAndConfigure: false,
    })
  })

  it('updates a Subject and preserves understandable same-teacher conflict errors', async () => {
    const fixture = scopeFixture()
    let data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    data = addSubject(data, fixture.projectA, 'teacher-a', 'custom-a', custom())
    const host = hostFixture(data)
    const updated = await createFormalSubjectManagementV9Controller(host.host, idFactory('unused'), fixture.selectionA)
      .actions.update('custom-a', custom('專題研究', '專題'))
    expect(updated.document.subjects.find((item) => item.id === 'custom-a'))
      .toMatchObject({ name: '專題研究', shortName: '專題' })

    const conflictHost = hostFixture(data)
    await expect(createFormalSubjectManagementV9Controller(
      conflictHost.host, idFactory('unused'), fixture.selectionA,
    ).actions.update('custom-a', custom('數學', '自訂'))).rejects
      .toEqual(expect.objectContaining({ code: 'duplicate-name' } satisfies Partial<TeacherSubjectV9Error>))
  })

  it('returns empty scoped data instead of leaking another scope when selection is invalid', () => {
    const fixture = scopeFixture()
    const data = addSubject(fixture.data, fixture.projectA, 'teacher-a', 'math-a')
    const view = presentFormalSubjectManagementV9(data, {
      projectId: fixture.projectA, timetableId: 'teacher-c', teachingUnitId: fixture.seniorB.id,
    })
    expect(view.subjects).toEqual([])
    expect(view.currentTeachingUnitConfigurations).toEqual([])
    expect(view.catalog).toEqual([])
    expect(view.actions.createCustom.enabled).toBe(false)
    expect(() => new FormalSubjectManagementV9Error('scope-mismatch', 'x')).not.toThrow()
  })
})

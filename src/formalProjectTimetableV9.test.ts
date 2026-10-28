import { describe, expect, it, vi } from 'vitest'
import { createBlankProjectV9, createTeacherSubjectV9, createTeacherTimetableV9 } from './data/teacherSubjectsV9'
import { createEmptyProjectV9 } from './data/managementV9'
import { createEmptyAppDataV8 } from './data/storageV8'
import type { FormalV9HostPort } from './formalRuntime'
import { FORMAL_PROJECT_V9_CAPABILITIES, FormalProjectTimetableV9Error,
  createFormalProjectTimetableV9Controller } from './formalProjectTimetableV9'
import { createFormalProjectTimetableV9Actions } from './hooks/useFormalProjectTimetableV9Adapter'
import type { AppDataV9 } from './types/v9'

const empty = (): AppDataV9 => ({ ...createEmptyAppDataV8(), schemaVersion: 9 }) as AppDataV9
const projectInput = (name = '新專案') => ({ name, teacherName: '不應自動建立教師課表',
  academicYear: 116, semester: 'first' as const, startDate: '2027-08-01', endDate: '2028-01-31' })

function hostFixture(initial: AppDataV9, options: {
  writable?: boolean
  pending?: boolean
  status?: FormalV9HostPort['status']
  reject?: Error
  currentForUpdate?: AppDataV9
  receiptRevisionOffset?: number
  receiptRawMismatch?: boolean
  hold?: boolean
} = {}) {
  let document = initial
  let revision = 0
  let release: (() => void) | null = null
  const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
    if (options.reject) throw options.reject
    const next = produce(options.currentForUpdate ?? document)
    if (options.hold) await new Promise<void>((resolve) => { release = resolve })
    const receipt = { raw: options.receiptRawMismatch ? '{}' : JSON.stringify(next),
      revision: revision + 1 + (options.receiptRevisionOffset ?? 0), attemptId: 'stage-1a' }
    if (!options.receiptRevisionOffset && !options.receiptRawMismatch) {
      document = next
      revision += 1
    }
    return receipt
  })
  const host = {
    get document() { return document }, status: options.status ?? 'active',
    writable: options.writable ?? true, pending: options.pending ?? false, receipt: null,
    get revision() { return revision }, errorCode: null, update,
  } satisfies FormalV9HostPort
  return { host, update, document: () => document, revision: () => revision,
    release: () => { const complete = release as (() => void) | null; complete?.() } }
}

const idFactory = (prefix: string) => {
  let serial = 0
  return () => `${prefix}-${++serial}`
}

function twoProjectFixture() {
  const id = idFactory('fixture')
  let data = createBlankProjectV9(empty(), { ...projectInput('Project A'), semester: 'first' }, id)
  const projectA = data.activeProjectId!
  data = createTeacherTimetableV9(data, projectA, { name: '甲課表', teacherName: '甲' }, id())
  const timetableA = data.timetables.at(-1)!.id
  data = createBlankProjectV9(data, { ...projectInput('Project B'), semester: 'second' }, id)
  const projectB = data.activeProjectId!
  data = createTeacherTimetableV9(data, projectB, { name: '乙課表', teacherName: '乙' }, id())
  const timetableB = data.timetables.at(-1)!.id
  return { data, projectA, projectB, timetableA, timetableB }
}

describe('formal V9 Project and Timetable controller', () => {
  it('creates an ordinary Project with no implicit school, unit, timetable, Subject or content', async () => {
    const fixture = hostFixture(empty())
    const result = await createFormalProjectTimetableV9Controller(fixture.host, () => 'new-project')
      .createProject({ name: '新專案' })
    expect(result.document.activeProjectId).toBe('new-project')
    expect(result.document.projects).toHaveLength(1)
    expect(result.document.projects[0].term).toBeNull()
    for (const key of ['schools', 'teachingUnits', 'timetables', 'subjects', 'teachingUnitSubjects',
      'classes', 'recurringLessons', 'oneOffLessons', 'events', 'overrides', 'teachingProgress'] as const) {
      expect(result.document[key], key).toEqual([])
    }
    expect(result.receipt).toMatchObject({ revision: 1, attemptId: 'stage-1a' })
    expect(result.selection).toEqual({ projectId: 'new-project', timetableId: null })
    expect(fixture.update).toHaveBeenCalledTimes(1)
  })

  it('configures only the selected null-term Project after a matching Host receipt', async () => {
    let data = createEmptyProjectV9(empty(), { name: '未設定' }, 'blank', '2026-10-28T00:00:00.000Z')
    data = createTeacherTimetableV9(data, 'blank', { name: '甲課表', teacherName: '甲' }, 'table-a')
    const fixture = hostFixture(data)
    const selected = vi.fn()
    const controller = createFormalProjectTimetableV9Controller(fixture.host, idFactory('unused'),
      { projectId: 'blank', timetableId: 'table-a' })
    const actions = createFormalProjectTimetableV9Actions(controller, selected)
    expect(actions.project.configureTerm).toBeTypeOf('function')
    const result = await actions.project.configureTerm({ academicYear: 116, semester: 'second' })
    expect(result.document.projects[0].term)
      .toEqual({ academicYear: 116, semester: 'second', customLabel: undefined })
    expect(result.document.timetables).toEqual(data.timetables)
    expect(result.selection).toEqual({ projectId: 'blank', timetableId: 'table-a' })
    expect(result.receipt).toMatchObject({ revision: 1, attemptId: 'stage-1a' })
    expect(selected).toHaveBeenCalledExactlyOnceWith({ projectId: 'blank', timetableId: 'table-a' })
    expect(fixture.update).toHaveBeenCalledTimes(1)
  })

  it('fails closed when configuring term through pending, readonly, stale or mismatched Host state', async () => {
    const data = createEmptyProjectV9(empty(), { name: '未設定' }, 'blank')
    const selection = { projectId: 'blank', timetableId: null }
    const pending = hostFixture(data, { pending: true })
    await expect(createFormalProjectTimetableV9Controller(pending.host, idFactory('unused'), selection)
      .configureSelectedProjectTerm({ academicYear: 116, semester: 'first' }))
      .rejects.toMatchObject({ code: 'duplicate-submit' })
    const readonly = hostFixture(data, { writable: false })
    await expect(createFormalProjectTimetableV9Controller(readonly.host, idFactory('unused'), selection)
      .configureSelectedProjectTerm({ academicYear: 116, semester: 'first' }))
      .rejects.toMatchObject({ code: 'not-writable' })
    const external = createEmptyProjectV9(data, { name: '外部' }, 'external')
    const stale = hostFixture(data, { currentForUpdate: external })
    await expect(createFormalProjectTimetableV9Controller(stale.host, idFactory('unused'), selection)
      .configureSelectedProjectTerm({ academicYear: 116, semester: 'first' }))
      .rejects.toMatchObject({ code: 'stale-document' })
    const mismatch = hostFixture(data, { receiptRawMismatch: true })
    await expect(createFormalProjectTimetableV9Controller(mismatch.host, idFactory('unused'), selection)
      .configureSelectedProjectTerm({ academicYear: 116, semester: 'first' }))
      .rejects.toMatchObject({ code: 'receipt-mismatch' })
    for (const item of [pending, readonly, stale, mismatch]) {
      expect(item.document().projects.find((project) => project.id === 'blank')?.term).toBeNull()
    }
  })

  it('keeps ordinary creation distinct from the explicit new-term copy operation', async () => {
    const id = idFactory('copy-source')
    let source = createBlankProjectV9(empty(), projectInput('來源'), id)
    const sourceId = source.activeProjectId!
    source = createTeacherTimetableV9(source, sourceId, { name: '來源課表', teacherName: '甲' }, id())
    const unit = source.teachingUnits[0]

    const blankHost = hostFixture(source)
    const blank = await createFormalProjectTimetableV9Controller(blankHost.host, () => 'ordinary-empty')
      .createProject(projectInput('普通新增'))
    expect(blank.document.schools.filter((item) => item.projectId === 'ordinary-empty')).toEqual([])
    expect(blank.document.timetables.filter((item) => item.projectId === 'ordinary-empty')).toEqual([])

    const copyHost = hostFixture(source)
    const copied = await createFormalProjectTimetableV9Controller(copyHost.host, idFactory('copied'))
      .copyProject({ sourceProjectId: sourceId, name: '新學期', academicYear: 116, semester: 'second',
        units: [{ sourceUnitId: unit.id, sourceEffectiveDate: '2027-09-01', startDate: '2028-02-01',
          endDate: '2028-07-31', anchorDate: '2028-02-01', anchorPattern: 'A' }] })
    const copiedId = copied.selection.projectId!
    expect(copiedId).not.toBe(sourceId)
    expect(copied.document.schools.some((item) => item.projectId === copiedId)).toBe(true)
    expect(copied.document.timetables.some((item) => item.projectId === copiedId)).toBe(true)
  })

  it('keeps Project and Timetable selection local and rejects cross-Project selection', () => {
    const data = twoProjectFixture()
    const fixture = hostFixture(data.data)
    const controller = createFormalProjectTimetableV9Controller(fixture.host, idFactory('unused'),
      { projectId: data.projectA, timetableId: data.timetableA })
    expect(controller.selection).toEqual({ projectId: data.projectA, timetableId: data.timetableA })
    const selectedA = controller.selectProject(data.projectA)
    expect(selectedA).toEqual({ projectId: data.projectA, timetableId: data.timetableA })
    expect(controller.selectTimetable(selectedA, data.timetableA)).toEqual(selectedA)
    expect(() => controller.selectTimetable(selectedA, data.timetableB))
      .toThrowError(expect.objectContaining({ code: 'scope-mismatch' }))
    expect(fixture.update).not.toHaveBeenCalled()
  })

  it('creates, renames, copies only settings and safely deletes a Timetable', async () => {
    const base = createEmptyProjectV9(empty(), projectInput(), 'project-a', '2026-10-26T00:00:00.000Z')
    const fixture = hostFixture(base)
    let controller = createFormalProjectTimetableV9Controller(fixture.host, idFactory('table'))
    const created = await controller.createTimetable('project-a', { name: '甲課表', teacherName: '甲' })
    const timetableId = created.selection.timetableId!

    controller = createFormalProjectTimetableV9Controller(fixture.host, idFactory('unused'))
    await controller.updateTimetable('project-a', timetableId, { name: '甲課表更新', teacherName: '甲老師' })
    expect(fixture.document().timetables.find((item) => item.id === timetableId))
      .toMatchObject({ name: '甲課表更新', teacherName: '甲老師' })

    controller = createFormalProjectTimetableV9Controller(fixture.host, () => 'table-copy')
    const copied = await controller.copyTimetableSettings('project-a', timetableId,
      { name: '乙課表', teacherName: '乙', baseDate: '2027-09-01' })
    expect(copied.document.timetables.find((item) => item.id === 'table-copy'))
      .toMatchObject({ projectId: 'project-a', name: '乙課表', teacherName: '乙' })
    expect(copied.document.subjects).toEqual([])
    expect(copied.document.recurringLessons).toEqual([])
    expect(copied.document.events).toEqual([])

    controller = createFormalProjectTimetableV9Controller(fixture.host, idFactory('unused'))
    const deleted = await controller.deleteTimetable('project-a', 'table-copy', true)
    expect(deleted.document.timetables.some((item) => item.id === 'table-copy')).toBe(false)
  })

  it('keeps teacher ownership isolated and rejects a Timetable from another Project before Host update', async () => {
    const f = twoProjectFixture()
    const math = { name: '數學', shortName: '數', color: '#123456',
      applicableSchoolLevels: ['senior-high' as const] }
    let data = createTeacherSubjectV9(f.data, f.projectA, f.timetableA, math, 'subject-a')
    data = createTeacherSubjectV9(data, f.projectB, f.timetableB, math, 'subject-b')
    const fixture = hostFixture(data)
    const controller = createFormalProjectTimetableV9Controller(fixture.host, () => 'copy-a')
    expect(() => controller.updateTimetable(f.projectA, f.timetableB,
      { name: '錯誤範圍', teacherName: 'X' }))
      .toThrowError(expect.objectContaining({ code: 'scope-mismatch' }))
    expect(fixture.update).not.toHaveBeenCalled()

    const copied = await controller.copyTimetableSettings(f.projectA, f.timetableA,
      { name: '甲副本', teacherName: '甲', baseDate: '2027-01-01' })
    expect(copied.document.subjects).toEqual(data.subjects)
    expect(copied.document.subjects.filter((item) => item.timetableId === 'copy-a')).toEqual([])

    const guardedDelete = createFormalProjectTimetableV9Controller(fixture.host, idFactory('unused'))
    await expect(guardedDelete.deleteTimetable(f.projectA, f.timetableA, true))
      .rejects.toThrow(/Subject library/)
    expect(fixture.document().timetables.some((item) => item.id === f.timetableA)).toBe(true)
  })

  it('retains archive data, supports existing reactivation, and blocks unsafe permanent deletion', async () => {
    const f = twoProjectFixture()
    const fixture = hostFixture(f.data)
    let controller = createFormalProjectTimetableV9Controller(fixture.host, idFactory('unused'))
    const archived = await controller.archiveProject(f.projectA)
    expect(archived.document.projects.find((item) => item.id === f.projectA)?.archivedAt).toBeTruthy()
    expect(archived.document.timetables.some((item) => item.id === f.timetableA)).toBe(true)

    controller = createFormalProjectTimetableV9Controller(fixture.host, idFactory('unused'))
    const reactivated = await controller.reactivateProject(f.projectA)
    expect(reactivated.selection.projectId).toBe(f.projectA)

    controller = createFormalProjectTimetableV9Controller(fixture.host, idFactory('unused'))
    await expect(controller.deleteProject(f.projectA, true)).rejects.toThrow(/不能級聯刪除/)
    expect(fixture.document().projects.some((item) => item.id === f.projectA)).toBe(true)
  })

  it('does not report success for read-only, rejected, stale, mismatched-receipt or duplicate writes', async () => {
    const readonly = hostFixture(empty(), { writable: false })
    await expect(createFormalProjectTimetableV9Controller(readonly.host, () => 'read-only')
      .createProject(projectInput())).rejects.toMatchObject({ code: 'not-writable' })
    expect(readonly.update).not.toHaveBeenCalled()

    const conflict = hostFixture(empty(), { status: 'conflict' })
    await expect(createFormalProjectTimetableV9Controller(conflict.host, () => 'conflict')
      .createProject(projectInput())).rejects.toMatchObject({ code: 'not-writable' })
    expect(conflict.update).not.toHaveBeenCalled()

    const rejected = hostFixture(empty(), { reject: new Error('host-rejected') })
    await expect(createFormalProjectTimetableV9Controller(rejected.host, () => 'rejected')
      .createProject(projectInput())).rejects.toThrow('host-rejected')
    expect(rejected.document().projects).toEqual([])

    const external = createEmptyProjectV9(empty(), projectInput('External'), 'external-project')
    const stale = hostFixture(empty(), { currentForUpdate: external })
    await expect(createFormalProjectTimetableV9Controller(stale.host, () => 'stale')
      .createProject(projectInput())).rejects.toMatchObject({ code: 'stale-document' })
    expect(stale.revision()).toBe(0)

    const badReceipt = hostFixture(empty(), { receiptRevisionOffset: 3 })
    await expect(createFormalProjectTimetableV9Controller(badReceipt.host, () => 'bad-receipt')
      .createProject(projectInput())).rejects.toMatchObject({ code: 'receipt-mismatch' })
    expect(badReceipt.revision()).toBe(0)

    const held = hostFixture(empty(), { hold: true })
    const controller = createFormalProjectTimetableV9Controller(held.host, idFactory('held'))
    const first = controller.createProject(projectInput('First'))
    await expect(controller.createProject(projectInput('Second')))
      .rejects.toMatchObject({ code: 'duplicate-submit' })
    held.release()
    await expect(first).resolves.toMatchObject({ receipt: { revision: 1 } })
  })

  it('does not expose unsupported Project rename or archived-history actions', () => {
    expect(FORMAL_PROJECT_V9_CAPABILITIES).toEqual({ renameProject: false, viewArchivedProject: false })
    expect(new FormalProjectTimetableV9Error('not-writable', 'x').name)
      .toBe('FormalProjectTimetableV9Error')
  })

  it('maps formal UI callbacks to one V9 Host write and changes selection only after receipt success', async () => {
    const base = createEmptyProjectV9(empty(), projectInput(), 'project-a')
    const fixture = hostFixture(base)
    const selected = vi.fn()
    const controller = createFormalProjectTimetableV9Controller(fixture.host, () => 'table-a')
    const actions = createFormalProjectTimetableV9Actions(controller, selected)

    actions.selectProject('project-a')
    expect(fixture.update).not.toHaveBeenCalled()
    expect(actions.project.createEmptyFromName).toBeTypeOf('function')
    expect(actions.project.rename).toBeNull()

    const result = await actions.timetable.create('project-a', { name: '教師課表', teacherName: '教師' })
    expect(result.receipt).toMatchObject({ revision: 1, attemptId: 'stage-1a' })
    expect(fixture.update).toHaveBeenCalledTimes(1)
    expect(selected).toHaveBeenLastCalledWith({ projectId: 'project-a', timetableId: 'table-a' })
  })

  it('does not change UI selection when the V9 Host rejects a callback write', async () => {
    const base = createEmptyProjectV9(empty(), projectInput(), 'project-a')
    const fixture = hostFixture(base, { reject: new Error('host-rejected') })
    const selected = vi.fn()
    const actions = createFormalProjectTimetableV9Actions(
      createFormalProjectTimetableV9Controller(fixture.host, () => 'table-a'), selected,
    )

    await expect(actions.timetable.create('project-a', { name: '教師課表', teacherName: '教師' }))
      .rejects.toThrow('host-rejected')
    expect(selected).not.toHaveBeenCalled()
    expect(fixture.document().timetables).toEqual([])
  })

  it('creates from the name callback only after a matching receipt and rejects pending or duplicate submissions', async () => {
    const held = hostFixture(empty(), { hold: true })
    const selected = vi.fn()
    const actions = createFormalProjectTimetableV9Actions(
      createFormalProjectTimetableV9Controller(held.host, () => 'name-only'), selected)
    const first = actions.project.createEmptyFromName({ name: ' 名稱專案 ' })
    expect(selected).not.toHaveBeenCalled()
    await expect(actions.project.createEmptyFromName({ name: '重複' }))
      .rejects.toMatchObject({ code: 'duplicate-submit' })
    held.release()
    await expect(first).resolves.toMatchObject({ document: { projects: [{ name: '名稱專案', term: null }] } })
    expect(held.document().projects).toHaveLength(1)
    expect(selected).toHaveBeenCalledExactlyOnceWith({ projectId: 'name-only', timetableId: null })
    const pending = hostFixture(empty(), { pending: true })
    await expect(createFormalProjectTimetableV9Controller(pending.host, () => 'pending')
      .createProject({ name: '名稱' })).rejects.toMatchObject({ code: 'duplicate-submit' })
    expect(pending.update).not.toHaveBeenCalled()
  })

  it('does not select a new Project on receipt mismatch or live selection change', async () => {
    const bad = hostFixture(empty(), { receiptRevisionOffset: 2 })
    const selected = vi.fn()
    const actions = createFormalProjectTimetableV9Actions(
      createFormalProjectTimetableV9Controller(bad.host, () => 'bad'), selected)
    await expect(actions.project.createEmptyFromName({ name: '名稱' }))
      .rejects.toMatchObject({ code: 'receipt-mismatch' })
    expect(selected).not.toHaveBeenCalled()
    const source = twoProjectFixture()
    const host = hostFixture(source.data)
    let selection = { projectId: source.projectA, timetableId: source.timetableA }
    const controller = createFormalProjectTimetableV9Controller(host.host, () => 'stale-scope', selection, () => selection)
    selection = { projectId: source.projectB, timetableId: source.timetableB }
    await expect(controller.createProject({ name: '舊操作' })).rejects.toMatchObject({ code: 'scope-mismatch' })
    expect(host.update).not.toHaveBeenCalled()
  })

  it('rejects a mismatched receipt raw and does not replace a selection changed during persistence', async () => {
    const mismatch = hostFixture(empty(), { receiptRawMismatch: true })
    const selected = vi.fn()
    const bad = createFormalProjectTimetableV9Actions(
      createFormalProjectTimetableV9Controller(mismatch.host, () => 'bad'), selected)
    await expect(bad.project.createEmptyFromName({ name: '名稱' })).rejects.toMatchObject({ code: 'receipt-mismatch' })
    expect(selected).not.toHaveBeenCalled()
    expect(mismatch.document().projects).toEqual([])

    const source = twoProjectFixture()
    const held = hostFixture(source.data, { hold: true })
    let selection = { projectId: source.projectA, timetableId: source.timetableA }
    const actions = createFormalProjectTimetableV9Actions(createFormalProjectTimetableV9Controller(
      held.host, () => 'persisted', selection, () => selection), selected)
    const pending = actions.project.createEmptyFromName({ name: '等待確認' })
    selection = { projectId: source.projectB, timetableId: source.timetableB }
    const rejected = expect(pending).rejects.toMatchObject({ code: 'scope-mismatch' })
    held.release()
    await rejected
    expect(selected).not.toHaveBeenCalled()
    expect(selection.projectId).toBe(source.projectB)
  })
})

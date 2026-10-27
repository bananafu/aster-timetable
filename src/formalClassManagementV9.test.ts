import { describe, expect, it, vi } from 'vitest'
import { archiveProjectV9, createClassV9 } from './data/managementV9'
import { createEmptyAppDataV8 } from './data/storageV8'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9,
  createTeacherTimetableV9, createTeachingUnitV9 } from './data/teacherSubjectsV9'
import type { FormalV9HostPort } from './formalRuntime'
import { createFormalClassManagementV9Controller, presentFormalClassManagementV9,
  type FormalClassManagementV9Selection } from './formalClassManagementV9'
import type { AppDataV9 } from './types/v9'

const empty = (): AppDataV9 => ({ ...createEmptyAppDataV8(), schemaVersion: 9 }) as AppDataV9
const projectInput = (name: string, semester: 'first' | 'second' = 'first') => ({
  name, academicYear: 116, semester, startDate: semester === 'first' ? '2027-08-01' : '2028-02-01',
  endDate: semester === 'first' ? '2028-01-31' : '2028-07-31',
})
const idFactory = (prefix: string) => {
  let serial = 0
  return () => `${prefix}-${++serial}`
}

function fixture() {
  const id = idFactory('fixture')
  let data = createBlankProjectV9(empty(), projectInput('Project A'), id)
  const projectA = data.activeProjectId!
  const seniorA = data.teachingUnits.find((item) => item.projectId === projectA)!
  data = createTeachingUnitV9(data, projectA, {
    schoolId: seniorA.schoolId, name: '國中部', schoolLevel: 'junior-high',
    startDate: seniorA.startDate, endDate: seniorA.endDate, periods: seniorA.periods,
    weekCycle: seniorA.weekCycle,
  }, 'junior-a')
  data = createTeacherTimetableV9(data, projectA, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV9(data, projectA, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  data = createBlankProjectV9(data, projectInput('Project B', 'second'), id)
  const projectB = data.activeProjectId!
  const seniorB = data.teachingUnits.find((item) => item.projectId === projectB)!
  data = createTeacherTimetableV9(data, projectB, { name: '丙課表', teacherName: '丙' }, 'teacher-c')
  const selectionA: FormalClassManagementV9Selection = {
    projectId: projectA, teachingUnitId: seniorA.id,
  }
  return { data, projectA, projectB, seniorA,
    juniorA: data.teachingUnits.find((item) => item.id === 'junior-a')!, seniorB,
    selectionA }
}

function hostFixture(initial: AppDataV9, options: {
  writable?: boolean
  status?: FormalV9HostPort['status']
  pending?: boolean
  reject?: Error
  currentForUpdate?: AppDataV9
  receiptRevisionOffset?: number
  hold?: boolean
} = {}) {
  let document = initial
  let revision = 0
  let release: (() => void) | null = null
  const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
    if (options.reject) throw options.reject
    const next = produce(options.currentForUpdate ?? document)
    if (options.hold) await new Promise<void>((resolve) => { release = resolve })
    const mismatch = options.receiptRevisionOffset !== undefined
    const receipt = { raw: JSON.stringify(next),
      revision: revision + 1 + (options.receiptRevisionOffset ?? 0), attemptId: 'class-s2-4' }
    if (!mismatch) { document = next; revision += 1 }
    return receipt
  })
  const host = {
    get document() { return document }, status: options.status ?? 'active',
    writable: options.writable ?? true, pending: options.pending ?? false,
    receipt: null, get revision() { return revision }, errorCode: null, update,
  } satisfies FormalV9HostPort
  return { host, document: () => document, update,
    release: () => { const done = release as (() => void) | null; done?.() } }
}

function classDraft(teachingUnitId: string, classNumber = 1) {
  return { teachingUnitId, grade: 1, classNumber, room: 'A101' }
}

function referencedFixture(kind: 'recurringLessons' | 'overrides' | 'oneOffLessons' | 'teachingProgress') {
  const source = fixture()
  const subjectDraft = { name: '數學', shortName: '數', color: '#647C88',
    applicableSchoolLevels: ['senior-high' as const] }
  let data = createTeacherSubjectV9(source.data, source.projectA, 'teacher-a', subjectDraft, 'subject-a')
  data = configureTeacherSubjectV9(data, source.projectA, 'teacher-a', source.seniorA.id,
    'subject-a', 'subject-relation')
  data = createClassV9(data, source.projectA, classDraft(source.seniorA.id), 'class-a')
  data = createClassV9(data, source.projectA, classDraft(source.seniorA.id, 2), 'source-class')
  const lesson = {
    id: 'lesson-a', seriesId: 'series-a', projectId: source.projectA, timetableId: 'teacher-a',
    teachingUnitId: source.seniorA.id, subjectId: 'subject-a', classId: 'source-class', day: 1 as const,
    periodId: source.seniorA.periods[0].id, weekPattern: 'every' as const,
    effectiveStart: source.seniorA.startDate, effectiveEnd: source.seniorA.endDate,
  }
  if (kind === 'recurringLessons') data = { ...data,
    recurringLessons: [{ ...lesson, classId: 'class-a' }] }
  if (kind === 'overrides') data = { ...data, recurringLessons: [lesson], overrides: [{
    id: 'change-a', projectId: source.projectA, timetableId: 'teacher-a',
    teachingUnitId: source.seniorA.id, date: source.seniorA.startDate,
    periodId: source.seniorA.periods[0].id, action: 'replace' as const,
    originalLessonId: lesson.id, replacement: { subjectId: 'subject-a', classId: 'class-a' },
  }] }
  if (kind === 'oneOffLessons') data = { ...data, oneOffLessons: [{
    id: 'one-off-a', projectId: source.projectA, timetableId: 'teacher-a',
    teachingUnitId: source.seniorA.id, subjectId: 'subject-a', classId: 'class-a',
    date: source.seniorA.startDate, purpose: 'extra' as const,
    time: { mode: 'period' as const, periodId: source.seniorA.periods[0].id },
  }] }
  if (kind === 'teachingProgress') data = { ...data, teachingProgress: [{
    id: '123e4567-e89b-42d3-a456-426614174099', projectId: source.projectA,
    timetableId: 'teacher-a', teachingUnitId: source.seniorA.id, subjectId: 'subject-a',
    classId: 'class-a', content: { chapter: '一', unit: '', note: '' }, previousProgress: null,
    createdAt: '2026-10-27T01:00:00.000Z', updatedAt: '2026-10-27T01:00:00.000Z',
  }] }
  return { ...source, data }
}

describe('formal V9 Class controller and presenter', () => {
  it('scopes classes to the selected Project and TeachingUnit', () => {
    const source = fixture()
    let data = createClassV9(source.data, source.projectA, classDraft(source.seniorA.id), 'senior-class')
    data = createClassV9(data, source.projectA,
      { teachingUnitId: source.juniorA.id, grade: 7, classNumber: 1 }, 'junior-class')
    data = createClassV9(data, source.projectB, classDraft(source.seniorB.id), 'other-project-class')
    expect(presentFormalClassManagementV9(data, source.selectionA).classes.map((item) => item.id))
      .toEqual(['senior-class'])
  })

  it('shares one Project Class across teachers without Timetable ownership', () => {
    const source = fixture()
    const data = createClassV9(source.data, source.projectA, classDraft(source.seniorA.id), 'shared-class')
    const view = presentFormalClassManagementV9(data, source.selectionA)
    expect(source.data.timetables.filter((item) => item.projectId === source.projectA)).toHaveLength(2)
    expect(view.classes).toContainEqual(expect.objectContaining({ id: 'shared-class' }))
    expect('timetableId' in view.classes[0]).toBe(false)
  })

  it('creates a Class through one verified Host update', async () => {
    const source = fixture()
    const host = hostFixture(source.data)
    const result = await createFormalClassManagementV9Controller(
      host.host, () => 'class-new', source.selectionA,
    ).actions.create(classDraft(source.seniorA.id))
    expect(host.update).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ classId: 'class-new', receipt: { revision: 1 } })
    expect(result.document.classes).toContainEqual(expect.objectContaining({
      id: 'class-new', projectId: source.projectA, teachingUnitId: source.seniorA.id,
    }))
  })

  it('updates a Class without changing its ownership', async () => {
    const source = fixture()
    const data = createClassV9(source.data, source.projectA, classDraft(source.seniorA.id), 'class-a')
    const host = hostFixture(data)
    const result = await createFormalClassManagementV9Controller(
      host.host, idFactory('unused'), source.selectionA,
    ).actions.update('class-a', { ...classDraft(source.seniorA.id, 2), room: 'B202' })
    expect(result.document.classes.find((item) => item.id === 'class-a')).toMatchObject({
      projectId: source.projectA, teachingUnitId: source.seniorA.id,
      name: '102', grade: 1, classNumber: 2, room: 'B202',
    })
  })

  it('safely deletes an unreferenced Class', async () => {
    const source = fixture()
    const data = createClassV9(source.data, source.projectA, classDraft(source.seniorA.id), 'class-a')
    const host = hostFixture(data)
    const result = await createFormalClassManagementV9Controller(
      host.host, idFactory('unused'), source.selectionA,
    ).actions.delete('class-a')
    expect(result.document.classes.some((item) => item.id === 'class-a')).toBe(false)
  })

  it.each([
    ['recurringLessons', '固定課程'], ['overrides', '課程異動'],
    ['oneOffLessons', '單日課程'], ['teachingProgress', '教學進度'],
  ] as const)('blocks deletion for %s with a concrete impact reason', async (kind, label) => {
    const source = referencedFixture(kind)
    const host = hostFixture(source.data)
    const controller = createFormalClassManagementV9Controller(
      host.host, idFactory('unused'), source.selectionA)
    expect(controller.actions.impact('class-a')[kind]).toBe(1)
    await expect(controller.actions.delete('class-a')).rejects.toMatchObject({
      code: 'class-referenced', message: expect.stringContaining(label),
    })
    expect(host.update).not.toHaveBeenCalled()
  })

  it('rejects cross-Project and cross-TeachingUnit mutations', async () => {
    const source = fixture()
    let data = createClassV9(source.data, source.projectA, classDraft(source.seniorA.id), 'senior-class')
    data = createClassV9(data, source.projectA,
      { teachingUnitId: source.juniorA.id, grade: 7, classNumber: 1 }, 'junior-class')
    data = createClassV9(data, source.projectB, classDraft(source.seniorB.id), 'other-project-class')
    const host = hostFixture(data)
    const controller = createFormalClassManagementV9Controller(host.host, idFactory('unused'), source.selectionA)
    await expect(controller.actions.update('junior-class', classDraft(source.seniorA.id)))
      .rejects.toMatchObject({ code: 'scope-mismatch' })
    await expect(controller.actions.delete('other-project-class'))
      .rejects.toMatchObject({ code: 'scope-mismatch' })
    await expect(controller.actions.create({ teachingUnitId: source.juniorA.id,
      grade: 7, classNumber: 2 })).rejects.toMatchObject({ code: 'scope-mismatch' })
    expect(host.update).not.toHaveBeenCalled()
  })

  it('rejects a stale document and a callback captured before scope switch', async () => {
    const source = fixture()
    const external = createClassV9(source.data, source.projectA,
      classDraft(source.seniorA.id), 'external-class')
    const stale = hostFixture(source.data, { currentForUpdate: external })
    await expect(createFormalClassManagementV9Controller(
      stale.host, () => 'not-created', source.selectionA,
    ).actions.create(classDraft(source.seniorA.id))).rejects.toMatchObject({ code: 'stale-document' })

    let selection = source.selectionA
    const switched = hostFixture(source.data)
    const controller = createFormalClassManagementV9Controller(switched.host, () => 'not-created',
      source.selectionA, () => selection)
    selection = { ...source.selectionA, teachingUnitId: source.juniorA.id }
    await expect(controller.actions.create(classDraft(source.seniorA.id)))
      .rejects.toMatchObject({ code: 'scope-mismatch' })
    expect(switched.update).not.toHaveBeenCalled()
  })

  it('fails closed for pending, readonly, conflict, reject and receipt mismatch', async () => {
    const source = fixture()
    for (const [options, code] of [
      [{ pending: true }, 'duplicate-submit'],
      [{ writable: false }, 'not-writable'],
      [{ status: 'conflict' as const }, 'not-writable'],
      [{ receiptRevisionOffset: 2 }, 'receipt-mismatch'],
    ] as const) {
      const host = hostFixture(source.data, options)
      await expect(createFormalClassManagementV9Controller(
        host.host, () => 'class-new', source.selectionA,
      ).actions.create(classDraft(source.seniorA.id))).rejects.toMatchObject({ code })
      expect(host.document().classes).toHaveLength(0)
    }
    const rejected = hostFixture(source.data, { reject: new Error('storage conflict') })
    await expect(createFormalClassManagementV9Controller(
      rejected.host, () => 'class-new', source.selectionA,
    ).actions.create(classDraft(source.seniorA.id))).rejects.toThrow('storage conflict')
  })

  it('prevents duplicate submission from creating duplicate Classes', async () => {
    const source = fixture()
    const host = hostFixture(source.data, { hold: true })
    const controller = createFormalClassManagementV9Controller(
      host.host, idFactory('class'), source.selectionA)
    const first = controller.actions.create(classDraft(source.seniorA.id))
    await expect(controller.actions.create(classDraft(source.seniorA.id, 2)))
      .rejects.toMatchObject({ code: 'duplicate-submit' })
    host.release()
    await first
    expect(host.document().classes).toHaveLength(1)
  })

  it('keeps archived Project data readable while disabling writes', async () => {
    const source = fixture()
    let data = createClassV9(source.data, source.projectA, classDraft(source.seniorA.id), 'class-a')
    data = archiveProjectV9(data, source.projectA, '2026-10-27T01:00:00.000Z')
    const host = hostFixture(data)
    const controller = createFormalClassManagementV9Controller(
      host.host, idFactory('class'), source.selectionA)
    expect(controller.view.classes).toContainEqual(expect.objectContaining({ id: 'class-a' }))
    expect(controller.view.actions.create).toMatchObject({ enabled: false, reason: '封存 Project 為唯讀。' })
    await expect(controller.actions.create(classDraft(source.seniorA.id)))
      .rejects.toMatchObject({ code: 'scope-mismatch' })
  })
})

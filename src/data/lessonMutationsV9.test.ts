import { describe, expect, it, vi } from 'vitest'
import { fromDateKey } from '../lib/date'
import { resolveV9Day } from '../lib/scheduleV9'
import type { AppDataV9 } from '../types/v9'
import type { FormalV9HostPort } from '../formalRuntime'
import { createFormalLessonManagementV9Controller } from '../formalLessonManagementV9'
import { fingerprintV7Raw } from './activationV8'
import { V9_AUTO_BACKUP_PREFIX, type V9HighRiskOperation } from './storageV9'
import { isCompatibleAppDataV9 } from './validators/v9'
import { cancelOccurrenceV9, createRecurringLessonV9, deleteRecurringLessonV9,
  getRecurringLessonV9Impact, moveOccurrenceV9, permanentlyUpdateLessonV9,
  replaceOccurrenceV9, revokeOccurrenceOverrideV9, updateRecurringLessonV9,
  type LessonV9Scope, type RecurringLessonV9Draft } from './lessonMutationsV9'

export function lessonFixture() {
  const stamp = '2026-02-01T00:00:00.000Z'
  const data: AppDataV9 = {
    schemaVersion: 9, activeProjectId: 'p',
    projects: [{ id: 'p', name: '甲', term: { academicYear: 115, semester: 'first' },
      createdAt: stamp, updatedAt: stamp }],
    timetables: [{ id: 't', projectId: 'p', name: '甲課表', teacherName: '甲' },
      { id: 'other', projectId: 'p', name: '乙課表', teacherName: '乙' }],
    schools: [{ id: 's', projectId: 'p', name: '學校', color: '#112233' }],
    teachingUnits: [{ id: 'u', projectId: 'p', schoolId: 's', name: '學期', schoolLevel: 'senior-high',
      startDate: '2026-03-01', endDate: '2026-06-30', timezone: 'Asia/Taipei',
      periods: [{ id: 1, order: 1, label: '第一節', startTime: '08:00', endTime: '08:50' },
        { id: 2, order: 2, label: '第二節', startTime: '09:00', endTime: '09:50' }],
      weekCycle: { enabled: true, anchorDate: '2026-03-02', anchorPattern: 'A' } }],
    subjects: [{ id: 'math', projectId: 'p', timetableId: 't', name: '數學', shortName: '數',
      color: '#223344', applicableSchoolLevels: ['senior-high'] },
    { id: 'english', projectId: 'p', timetableId: 't', name: '英文', shortName: '英',
      color: '#334455', applicableSchoolLevels: ['senior-high'] },
    { id: 'other-subject', projectId: 'p', timetableId: 'other', name: '數學', shortName: '數',
      color: '#445566', applicableSchoolLevels: ['senior-high'] }],
    teachingUnitSubjects: [{ id: 'r1', projectId: 'p', teachingUnitId: 'u', subjectId: 'math' },
      { id: 'r2', projectId: 'p', teachingUnitId: 'u', subjectId: 'english' },
      { id: 'r3', projectId: 'p', teachingUnitId: 'u', subjectId: 'other-subject' }],
    classes: [{ id: 'c', projectId: 'p', teachingUnitId: 'u', name: '一甲' }],
    recurringLessons: [], overrides: [], oneOffLessons: [], events: [], teachingProgress: [], migrationWarnings: [],
  }
  const scope: LessonV9Scope = { projectId: 'p', timetableId: 't', teachingUnitId: 'u' }
  const draft: RecurringLessonV9Draft = { ...scope, subjectId: 'math', classId: 'c', day: 1,
    periodId: 1, weekPattern: 'every' }
  return { data, scope, draft }
}

describe('V9 Lesson domain mutation', () => {
  it('creates, edits and deletes a fixed Lesson while preserving V9 validity', () => {
    const { data, scope, draft } = lessonFixture()
    expect(isCompatibleAppDataV9(data)).toBe(true)
    const created = createRecurringLessonV9(data, scope, draft, 'l1')
    expect(created.recurringLessons).toMatchObject([{ id: 'l1', seriesId: 'l1' }])
    const edited = updateRecurringLessonV9(created, scope, 'l1', { ...draft, room: '301' })
    expect(edited.recurringLessons[0].room).toBe('301')
    expect(getRecurringLessonV9Impact(edited, scope, 'l1').changes).toBe(0)
    expect(deleteRecurringLessonV9(edited, scope, 'l1', true).recurringLessons).toEqual([])
    expect(data.recurringLessons).toEqual([])
  })
  it('rejects absent resources, foreign teacher ownership, scope and date violations', () => {
    const { data, scope, draft } = lessonFixture()
    for (const changed of [{ subjectId: 'missing' }, { subjectId: 'other-subject' },
      { classId: 'missing' }, { timetableId: 'other' }, { teachingUnitId: 'missing' }]) {
      expect(() => createRecurringLessonV9(data, scope, { ...draft, ...changed }, 'bad')).toThrow()
    }
    expect(() => createRecurringLessonV9(data, scope, draft, 'math'))
      .toThrow(expect.objectContaining({ code: 'id-collision' }))
    const unset = { ...data, projects: data.projects.map((item) => ({ ...item, term: null })) }
    expect(() => createRecurringLessonV9(unset, scope, draft, 'bad'))
      .toThrow(expect.objectContaining({ code: 'invalid-scope' }))
    const created = createRecurringLessonV9(data, scope, draft, 'l1')
    expect(() => createRecurringLessonV9(created, scope, draft, 'l2')).toThrow()
    expect(() => updateRecurringLessonV9(created, { ...scope, timetableId: 'other' }, 'l1', draft)).toThrow()
    expect(() => cancelOccurrenceV9(created, scope, 'l1', '2026-07-06', 'o1')).toThrow()
    expect(() => cancelOccurrenceV9(created, scope, 'l1', '2026-03-03', 'o1')).toThrow()
    expect(() => updateRecurringLessonV9(created, scope, 'l1', draft))
      .toThrow(expect.objectContaining({ code: 'already-changed' }))
  })
  it('keeps A/B fixed Lessons separate and resolves a cross-week move at both slots', () => {
    const { data, scope, draft } = lessonFixture()
    const a = createRecurringLessonV9(data, scope, { ...draft, weekPattern: 'A' }, 'la')
    const both = createRecurringLessonV9(a, scope, { ...draft, weekPattern: 'B' }, 'lb')
    expect(resolveV9Day(both, scope, fromDateKey('2026-03-02')).map((item) => item.id)).toEqual(['la'])
    expect(resolveV9Day(both, scope, fromDateKey('2026-03-09')).map((item) => item.id)).toEqual(['lb'])
    const moved = moveOccurrenceV9(both, scope, 'la', '2026-03-02',
      { date: '2026-03-09', periodId: 2 }, 'move')
    expect(resolveV9Day(moved, scope, fromDateKey('2026-03-02'))).toMatchObject([
      { id: 'la', status: 'moved', movementRole: 'source' }])
    expect(resolveV9Day(moved, scope, fromDateKey('2026-03-09'))).toMatchObject([
      { id: 'lb', periodId: 1 }, { id: 'la', periodId: 2, movementRole: 'target' }])
    expect(moved.oneOffLessons).toEqual([])
    expect(() => moveOccurrenceV9(both, scope, 'la', '2026-03-02',
      { date: '2026-07-06', periodId: 2 }, 'bad')).toThrow()
    expect(() => moveOccurrenceV9(both, scope, 'la', '2026-03-02',
      { date: '2026-03-09', periodId: 1 }, 'bad')).toThrow()
  })
  it('cancels, replaces and revokes only the selected occurrence', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const cancelled = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'cancel')
    expect(resolveV9Day(cancelled, scope, fromDateKey('2026-03-02'))[0]).toMatchObject({ status: 'cancelled' })
    expect(() => cancelOccurrenceV9(cancelled, scope, 'l1', '2026-03-02', 'again')).toThrow()
    expect(revokeOccurrenceOverrideV9(cancelled, scope, 'cancel').overrides).toEqual([])
    expect(() => revokeOccurrenceOverrideV9(cancelled, { ...scope, timetableId: 'other' }, 'cancel'))
      .toThrow(expect.objectContaining({ code: 'not-found' }))
    const replaced = replaceOccurrenceV9(fixed, scope, 'l1', '2026-03-02',
      { subjectId: 'english', classId: 'c' }, 'replace')
    expect(resolveV9Day(replaced, scope, fromDateKey('2026-03-02'))[0]).toMatchObject({
      id: 'l1', subjectId: 'english', status: 'replaced' })
    expect(resolveV9Day(replaced, scope, fromDateKey('2026-03-09'))[0].subjectId).toBe('math')
    expect(() => replaceOccurrenceV9(fixed, scope, 'l1', '2026-03-02',
      { subjectId: 'other-subject', classId: 'c' }, 'bad')).toThrow()
    expect(() => updateRecurringLessonV9(cancelled, scope, 'l1', { ...draft, room: '301' }))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
    expect(() => deleteRecurringLessonV9(cancelled, scope, 'l1', true))
      .toThrow(expect.objectContaining({ code: 'referenced' }))
  })
  it('splits a series without rewriting history and reassigns only future override references', () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const changed = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-23', 'future')
    const split = permanentlyUpdateLessonV9(changed, scope, 'l1', '2026-03-16',
      { ...draft, subjectId: 'english' }, 'l2')
    expect(split.recurringLessons).toMatchObject([
      { id: 'l1', effectiveEnd: '2026-03-15' }, { id: 'l2', seriesId: 'l1', effectiveStart: '2026-03-16' }])
    expect(split.overrides[0].originalLessonId).toBe('l2')
    expect(resolveV9Day(split, scope, fromDateKey('2026-03-09'))[0].subjectId).toBe('math')
    expect(resolveV9Day(split, scope, fromDateKey('2026-03-16'))[0].subjectId).toBe('english')
    expect(() => permanentlyUpdateLessonV9(fixed, scope, 'l1', '2026-03-01', draft, 'bad')).toThrow()
    expect(() => permanentlyUpdateLessonV9(fixed, scope, 'l1', '2026-07-01', draft, 'bad')).toThrow()
    expect(() => permanentlyUpdateLessonV9(changed, scope, 'l1', '2026-03-16',
      { ...draft, day: 2 }, 'bad')).toThrow(expect.objectContaining({ code: 'referenced' }))
  })
})

function hostFixture(initial: AppDataV9, options: { badReceipt?: boolean; reject?: Error;
  currentForUpdate?: AppDataV9; hold?: boolean } = {}) {
  let document = initial
  let revision = 0
  let release: (() => void) | undefined
  const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
    if (options.reject) throw options.reject
    const next = produce(options.currentForUpdate ?? document)
    if (options.hold) await new Promise<void>((resolve) => { release = resolve })
    if (!options.badReceipt) { document = next; revision++ }
    return { raw: options.badReceipt ? '{}' : JSON.stringify(next),
      revision: options.badReceipt ? 7 : revision, attemptId: 'host-attempt' }
  })
  const host = { get document() { return document }, status: 'active' as const, writable: true,
    pending: false, receipt: null, get revision() { return revision }, errorCode: null, update } satisfies FormalV9HostPort
  return { host, update, document: () => document, release: () => release?.() }
}

describe('formal V9 Lesson Host action port', () => {
  it('commits through Host and reports success only with the matching receipt', async () => {
    const { data, scope, draft } = lessonFixture()
    const state = hostFixture(data)
    const actions = createFormalLessonManagementV9Controller(state.host, () => 'l1', scope)
    const result = await actions.createRecurring(draft)
    expect(state.update).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ affectedId: 'l1', receipt: { revision: 1, attemptId: 'host-attempt' } })
    expect(state.document().recurringLessons).toHaveLength(1)
    await expect(actions.createRecurring(draft)).rejects.toMatchObject({ code: 'stale-document' })
    expect(state.update).toHaveBeenCalledOnce()
  })
  it('fails closed on stale selection or revision, receipt mismatch and Host failure', async () => {
    const { data, scope, draft } = lessonFixture()
    const failed = hostFixture(data, { reject: new Error('write failed') })
    await expect(createFormalLessonManagementV9Controller(failed.host, () => 'l1', scope)
      .createRecurring(draft)).rejects.toThrow('write failed')
    expect(failed.document()).toBe(data)
    const bad = hostFixture(data, { badReceipt: true })
    await expect(createFormalLessonManagementV9Controller(bad.host, () => 'l1', scope)
      .createRecurring(draft)).rejects.toMatchObject({ code: 'receipt-mismatch' })
    expect(bad.document()).toBe(data)
    let selected = { ...scope }
    const stale = hostFixture(data)
    const actions = createFormalLessonManagementV9Controller(stale.host, () => 'l1', scope, () => selected)
    selected = { ...scope, timetableId: 'other' }
    await expect(actions.createRecurring(draft)).rejects.toMatchObject({ code: 'invalid-scope' })
    expect(stale.update).not.toHaveBeenCalled()
    const changed = hostFixture(data)
    const old = createFormalLessonManagementV9Controller(changed.host, () => 'l1', scope)
    await createFormalLessonManagementV9Controller(changed.host, () => 'l2', scope)
      .createRecurring({ ...draft, day: 2 })
    await expect(old.createRecurring(draft)).rejects.toMatchObject({ code: 'stale-document' })
  })
  it('rejects duplicate in-flight writes and does not submit blocked destructive actions', async () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const state = hostFixture(fixed, { hold: true })
    const actions = createFormalLessonManagementV9Controller(state.host, () => 'override', scope)
    const pending = actions.cancelOccurrence('l1', '2026-03-02')
    await expect(actions.cancelOccurrence('l1', '2026-03-09')).rejects.toMatchObject({ code: 'duplicate-submit' })
    state.release()
    await pending
    const blocked = hostFixture(fixed)
    const destructive = createFormalLessonManagementV9Controller(blocked.host, () => 'l2', scope)
    await expect(destructive.deleteRecurring('l1', true)).rejects.toMatchObject({ code: 'backup-required' })
    await expect(destructive.permanentlyUpdateFromDate('l1', '2026-03-16', draft))
      .rejects.toMatchObject({ code: 'backup-required' })
    expect(blocked.update).not.toHaveBeenCalled()
  })
  it('passes validation and transaction-staleness failures through without reporting a receipt', async () => {
    const { data, scope, draft } = lessonFixture()
    const state = hostFixture(data)
    const actions = createFormalLessonManagementV9Controller(state.host, () => 'l1', scope)
    await expect(actions.createRecurring({ ...draft, subjectId: 'other-subject' }))
      .rejects.toMatchObject({ code: 'invalid-reference' })
    expect(state.document()).toBe(data)
    const malformed = { ...data, recurringLessons: [{ ...draft, id: 'broken', seriesId: 'broken',
      effectiveStart: '2026-03-01', subjectId: 'other-subject' }] } as AppDataV9
    const invalid = hostFixture(data, { currentForUpdate: malformed })
    await expect(createFormalLessonManagementV9Controller(invalid.host, () => 'l1', scope)
      .createRecurring(draft)).rejects.toMatchObject({ code: 'stale-document' })
    expect(invalid.document()).toBe(data)
  })
  it('uses the Host pre-backup port for deletion and permanent split, and verifies the bound evidence', async () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const backedHost = (initial: AppDataV9,
      evidenceFault?: 'operation' | 'revision' | 'mutation-attempt') => {
      const base = hostFixture(initial)
      const updateHighRisk = vi.fn(async (produce: (current: AppDataV9) => AppDataV9,
        operation: V9HighRiskOperation) => {
        const rawDocument = JSON.stringify(base.document())
        const revision = base.host.revision
        const receipt = await base.update(produce)
        const mutationAttemptId = `mutation-${receipt.revision}`
        const backupMutationAttemptId = evidenceFault === 'mutation-attempt'
          ? `${mutationAttemptId}-other` : mutationAttemptId
        return { ...receipt, mutationAttemptId,
          preMutationBackup: { key: `${V9_AUTO_BACKUP_PREFIX}${backupMutationAttemptId}`,
            mutationAttemptId: backupMutationAttemptId,
            operation: evidenceFault === 'operation' ? 'permanently-update-lesson' as const : operation,
            revision: evidenceFault === 'revision' ? revision + 1 : revision,
            digest: await fingerprintV7Raw(rawDocument), rawDocument } }
      })
      const host = { ...base.host, get document() { return base.document() },
        get revision() { return base.host.revision }, updateHighRisk } satisfies FormalV9HostPort
      return { base, host, updateHighRisk }
    }
    const deletion = backedHost(fixed)
    const deleted = await createFormalLessonManagementV9Controller(deletion.host, () => 'unused', scope)
      .deleteRecurring('l1', true)
    expect(deleted.document.recurringLessons).toEqual([])
    expect(deleted.receipt.preMutationBackup).toMatchObject({ operation: 'delete-recurring-lesson', revision: 0 })
    expect(deletion.updateHighRisk).toHaveBeenCalledOnce()
    const permanent = backedHost(fixed)
    const split = await createFormalLessonManagementV9Controller(permanent.host, () => 'l2', scope)
      .permanentlyUpdateFromDate('l1', '2026-03-16', { ...draft, subjectId: 'english' })
    expect(split.document.recurringLessons.map((item) => item.id)).toEqual(['l1', 'l2'])
    expect(split.receipt.preMutationBackup?.operation).toBe('permanently-update-lesson')
    for (const fault of ['operation', 'revision', 'mutation-attempt'] as const) {
      const mismatch = backedHost(fixed, fault)
      await expect(createFormalLessonManagementV9Controller(mismatch.host, () => 'unused', scope)
        .deleteRecurring('l1', true)).rejects.toMatchObject({ code: 'receipt-mismatch' })
    }
  })
  it('rejects a referenced deletion before the Host reaches backup storage', async () => {
    const { data, scope, draft } = lessonFixture()
    const fixed = createRecurringLessonV9(data, scope, draft, 'l1')
    const referenced = cancelOccurrenceV9(fixed, scope, 'l1', '2026-03-02', 'override')
    const base = hostFixture(referenced)
    const updateHighRisk = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
      produce(base.document())
      throw new Error('must not reach storage')
    })
    const host = { ...base.host, updateHighRisk } satisfies FormalV9HostPort
    await expect(createFormalLessonManagementV9Controller(host, () => 'unused', scope)
      .deleteRecurring('l1', true)).rejects.toMatchObject({ code: 'referenced' })
    expect(updateHighRisk).toHaveBeenCalledOnce()
    expect(base.document()).toBe(referenced)
  })
})

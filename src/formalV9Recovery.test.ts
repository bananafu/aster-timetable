import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fingerprintV7Raw, V8_BOOTSTRAP_KEY } from './data/activationV8'
import { activateTimetableSubjectsV9 } from './data/activateSubjectV9'
import { bootstrapEmptyV8 } from './data/bootstrapV8'
import { initializeFreshV9 } from './data/initializeFreshV9'
import { createBlankProject } from './data/projectRuntimeV8'
import { APP_DATA_V8_KEY, createEmptyAppDataV8, persistAppDataV8 } from './data/storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_AUTO_BACKUP_PREFIX, V9_BACKUP_PREFIX } from './data/storageV9'
import { createSubject } from './data/subjectsV8'
import { createTeacherTimetableV8 } from './data/timetablesV8'
import { createFormalV9RecoveryCoordinator, createFormalV9RecoveryExportPort,
  inspectFormalV9Recovery, reinspectFormalV9RecoveryRuntime } from './formalV9Recovery'

const time = '2026-11-02T01:00:00.000Z'

function memory(entries: [string, string][] = []) {
  const values = new Map(entries)
  return {
    values,
    get length() { return values.size },
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  }
}

beforeEach(() => vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
  operation: (lock: unknown) => Promise<unknown>) => operation({}) } }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function activeV8(withAmbiguousSubject = false) {
  const storage = memory()
  const bootstrap = await bootstrapEmptyV8(storage, { attemptId: 'v8-source', createdAt: time })
  if (!bootstrap.ok) throw new Error(bootstrap.code)
  let data = createEmptyAppDataV8()
  if (withAmbiguousSubject) {
    let serial = 0
    data = createBlankProject(data, { name: 'Project A', academicYear: 115, semester: 'first',
      startDate: '2026-08-01', endDate: '2027-01-31' }, () => `fixture-${++serial}`)
    data = createTeacherTimetableV8(data, data.activeProjectId!,
      { name: '甲課表', teacherName: '甲' }, 'teacher-a')
    data = createTeacherTimetableV8(data, data.activeProjectId!,
      { name: '乙課表', teacherName: '乙' }, 'teacher-b')
    data = createSubject(data, data.activeProjectId!, { name: '數學', shortName: '數', color: '#647C88',
      applicableSchoolLevels: ['senior-high'] }, 'subject-a')
    const saved = persistAppDataV8(storage, createEmptyAppDataV8(), data,
      { raw: bootstrap.receipt.raw, legacyGuardRaw: null, revision: 0 }, 0)
    const metadata = JSON.parse(storage.getItem(V8_BOOTSTRAP_KEY)!)
    storage.setItem(V8_BOOTSTRAP_KEY, JSON.stringify({ ...metadata,
      currentDigest: await fingerprintV7Raw(saved.raw), documentRevision: saved.revision }))
  }
  return { storage, data, rawV8: storage.getItem(APP_DATA_V8_KEY)! }
}

async function interruptedUpgrade(target: 'document' | 'metadata') {
  const base = await activeV8()
  const realWrite = base.storage.setItem.getMockImplementation()!
  base.storage.setItem.mockImplementation((key, value) => {
    if ((target === 'document' && key === APP_DATA_V9_KEY)
      || (target === 'metadata' && key === V9_ACTIVATION_KEY)) throw new Error('interrupted')
    realWrite(key, value)
  })
  const result = await activateTimetableSubjectsV9(base.storage, {
    attemptId: target === 'document' ? 'resume-attempt' : 'orphan-attempt', createdAt: time,
    expectedV8Raw: base.rawV8, candidate: { ...base.data, schemaVersion: 9, subjects: [] }, decisions: [],
    confirmedExternalV8Digest: await fingerprintV7Raw(base.rawV8), userConfirmedExternalBackup: true,
  })
  base.storage.setItem.mockImplementation(realWrite)
  return { ...base, result }
}

describe('Formal V9 recovery core', () => {
  it('classifies an eligible V8 source without writing or mounting a Host', async () => {
    const { storage, rawV8 } = await activeV8()
    storage.setItem.mockClear()
    const value = await inspectFormalV9Recovery(storage)
    expect(value).toMatchObject({ kind: 'migration-ready', runtimeReason: 'absent',
      capabilities: { activate: true, resume: false, resumeOrphan: false, export: true },
      migration: { sourceRaw: rawV8, plan: { sourceCompatibleV8: true } } })
    expect(value.evidenceIdentity).toMatch(/^sha256:/)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('requires complete explicit ownership decisions and confirmed external export evidence', async () => {
    const { storage, rawV8 } = await activeV8(true)
    const coordinator = createFormalV9RecoveryCoordinator(storage)
    const value = await coordinator.inspect()
    expect(value.kind).toBe('migration-ready')
    expect(value.migration?.plan.entries[0]).toMatchObject({ classification: 'unreferenced',
      requiresUserDecision: true })
    const common = { attemptId: 'upgrade', createdAt: time, decisions: [],
      externalExportRaw: rawV8, externalExportDigest: await fingerprintV7Raw(rawV8) }
    expect(await coordinator.activate(value, { ...common, userConfirmedExternalBackup: false }))
      .toMatchObject({ ok: false, code: 'confirmation-required' })
    expect(await coordinator.activate(value, { ...common, userConfirmedExternalBackup: true }))
      .toMatchObject({ ok: false, code: 'invalid-decisions' })
    expect(storage.getItem(APP_DATA_V9_KEY)).toBeNull()
  })

  it('activates an ambiguous-owner source only after receiving complete explicit decisions', async () => {
    const { storage, rawV8 } = await activeV8(true)
    const coordinator = createFormalV9RecoveryCoordinator(storage)
    const value = await coordinator.inspect()
    const result = await coordinator.activate(value, { attemptId: 'owned-upgrade', createdAt: time,
      decisions: [{ sourceSubjectId: 'subject-a',
        owners: [{ timetableId: 'teacher-a', subjectId: 'subject-a' }], relations: [] }],
      externalExportRaw: rawV8, externalExportDigest: await fingerprintV7Raw(rawV8),
      userConfirmedExternalBackup: true })
    expect(result).toMatchObject({ ok: true, runtimeDecision: { runtime: 'v9' } })
    expect(JSON.parse(storage.getItem(APP_DATA_V9_KEY)!).subjects)
      .toMatchObject([{ id: 'subject-a', timetableId: 'teacher-a' }])
  })

  it('activates only from matching snapshot-bound external export evidence', async () => {
    const { storage, rawV8 } = await activeV8()
    const coordinator = createFormalV9RecoveryCoordinator(storage)
    const value = await coordinator.inspect()
    const digest = await fingerprintV7Raw(rawV8)
    expect(await coordinator.activate(value, { attemptId: 'formal-upgrade', createdAt: time, decisions: [],
      externalExportRaw: `${rawV8} `, externalExportDigest: digest, userConfirmedExternalBackup: true }))
      .toMatchObject({ ok: false, code: 'export-evidence-mismatch' })
    expect(await coordinator.activate(value, { attemptId: 'formal-upgrade', createdAt: time, decisions: [],
      externalExportRaw: rawV8, externalExportDigest: digest, userConfirmedExternalBackup: true }))
      .toMatchObject({ ok: true, runtimeDecision: { runtime: 'v9' } })
  })

  it.each(['preparing', 'interrupted'] as const)('classifies exact %s evidence and resumes it', async (status) => {
    const base = await interruptedUpgrade('document')
    expect(base.result).toMatchObject({ ok: false, code: 'document-failed' })
    if (status === 'interrupted') {
      const metadata = JSON.parse(base.storage.getItem(V9_ACTIVATION_KEY)!)
      base.storage.setItem(V9_ACTIVATION_KEY, JSON.stringify({ ...metadata, status: 'interrupted' }))
    }
    const coordinator = createFormalV9RecoveryCoordinator(base.storage)
    const value = await coordinator.inspect()
    expect(value).toMatchObject({ kind: 'resume-ready', recoveryAttemptId: 'resume-attempt' })
    expect(await coordinator.resume(value, { userConfirmed: false }))
      .toMatchObject({ ok: false, code: 'confirmation-required' })
    expect(await coordinator.resume(value, { userConfirmed: true }))
      .toMatchObject({ ok: true, runtimeDecision: { runtime: 'v9' } })
  })

  it('classifies and resumes only one exact orphan backup', async () => {
    const base = await interruptedUpgrade('metadata')
    expect(base.result).toMatchObject({ ok: false, code: 'preparing-failed' })
    const coordinator = createFormalV9RecoveryCoordinator(base.storage)
    const value = await coordinator.inspect()
    expect(value).toMatchObject({ kind: 'orphan-ready', recoveryAttemptId: 'orphan-attempt' })
    expect(await coordinator.resumeOrphan(value, { userConfirmed: true }))
      .toMatchObject({ ok: true, runtimeDecision: { runtime: 'v9' } })
  })

  it('fails closed for multiple orphan backups, unknown evidence and a tampered backup', async () => {
    const multiple = await interruptedUpgrade('metadata')
    multiple.storage.setItem(`${V9_BACKUP_PREFIX}other`, '{partial}')
    expect(await inspectFormalV9Recovery(multiple.storage)).toMatchObject({ kind: 'ambiguous' })

    const unknown = await activeV8()
    unknown.storage.setItem(`${APP_DATA_V9_KEY}-future`, '{}')
    expect(await inspectFormalV9Recovery(unknown.storage)).toMatchObject({ kind: 'ambiguous' })

    const detachedAutoBackup = await activeV8()
    detachedAutoBackup.storage.setItem(`${V9_AUTO_BACKUP_PREFIX}detached`, '{}')
    expect(await inspectFormalV9Recovery(detachedAutoBackup.storage)).toMatchObject({ kind: 'ambiguous' })

    const tampered = await interruptedUpgrade('document')
    const key = `${V9_BACKUP_PREFIX}resume-attempt`
    tampered.storage.setItem(key, JSON.stringify({ ...JSON.parse(tampered.storage.getItem(key)!), candidateRaw: '{}' }))
    const value = await inspectFormalV9Recovery(tampered.storage)
    expect(value).toMatchObject({ kind: 'export-only', capabilities: { resume: false } })
    expect(tampered.storage.getItem(V9_ACTIVATION_KEY)).not.toBeNull()
  })

  it('rejects source mutation and explicit storage-event invalidation before calling recovery', async () => {
    const changed = await interruptedUpgrade('document')
    const coordinator = createFormalV9RecoveryCoordinator(changed.storage)
    const value = await coordinator.inspect()
    changed.storage.setItem(APP_DATA_V8_KEY, `${changed.rawV8} `)
    expect(await coordinator.resume(value, { userConfirmed: true }))
      .toMatchObject({ ok: false, code: 'snapshot-stale' })
    expect(changed.storage.getItem(APP_DATA_V9_KEY)).toBeNull()

    const invalidated = await interruptedUpgrade('document')
    const coordinator2 = createFormalV9RecoveryCoordinator(invalidated.storage)
    const value2 = await coordinator2.inspect()
    coordinator2.invalidate(value2)
    expect(await coordinator2.resume(value2, { userConfirmed: true }))
      .toMatchObject({ ok: false, code: 'snapshot-stale' })
    expect(invalidated.storage.getItem(APP_DATA_V9_KEY)).toBeNull()
  })

  it('keeps an interrupted Fresh initialization export-only', async () => {
    const storage = memory()
    const realWrite = storage.setItem.getMockImplementation()!
    storage.setItem.mockImplementation((key, value) => {
      if (key === APP_DATA_V9_KEY) throw new Error('interrupted')
      realWrite(key, value)
    })
    expect(await initializeFreshV9(storage, { attemptId: 'fresh', createdAt: time }))
      .toMatchObject({ ok: false, code: 'document-failed' })
    storage.setItem.mockImplementation(realWrite)
    expect(await inspectFormalV9Recovery(storage)).toMatchObject({ kind: 'export-only',
      capabilities: { activate: false, resume: false, resumeOrphan: false, export: true } })
  })

  it('classifies unreadable storage as read-error without attempting a write', async () => {
    const setItem = vi.fn()
    const storage = { length: 1, key: () => APP_DATA_V8_KEY,
      getItem: () => { throw new Error('denied') }, setItem }
    const value = await inspectFormalV9Recovery(storage)
    expect(value).toMatchObject({ kind: 'read-error', runtimeReason: 'read-error',
      evidenceIdentity: null, capabilities: { activate: false, resume: false, resumeOrphan: false, export: false } })
    expect(setItem).not.toHaveBeenCalled()
  })

  it('exports exact snapshot raw without rereading or writing storage', async () => {
    const { storage, rawV8 } = await activeV8()
    const value = await inspectFormalV9Recovery(storage)
    storage.getItem.mockClear()
    storage.setItem.mockClear()
    const port = createFormalV9RecoveryExportPort(value)
    expect(port.readExact(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(port.entries).toContainEqual({ key: APP_DATA_V8_KEY, role: 'v8-source' })
    expect(port.readExact('missing')).toBeNull()
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('explicitly reinspects the Runtime Gate and exposes no success when the second Gate is not V9', async () => {
    const success = await interruptedUpgrade('document')
    const coordinator = createFormalV9RecoveryCoordinator(success.storage)
    const value = await coordinator.inspect()
    expect(await coordinator.resume(value, { userConfirmed: true })).toMatchObject({ ok: true })
    expect(await reinspectFormalV9RecoveryRuntime(memory())).toEqual({ ok: false,
      code: 'runtime-blocked', runtimeDecision: { runtime: 'v7', v9Status: 'absent' } })
  })
})

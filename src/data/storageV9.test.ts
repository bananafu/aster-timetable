import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapEmptyV8 } from './bootstrapV8'
import { fingerprintV7Raw, V8_BOOTSTRAP_KEY } from './activationV8'
import { activateTimetableSubjectsV9, resumeOrphanedSubjectUpgradeV9,
  resumeTimetableSubjectsV9 } from './activateSubjectV9'
import { APP_DATA_V8_KEY, createEmptyAppDataV8 } from './storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, checkV9WriteEvidence,
  loadAppDataV9, persistAppDataV9, type V9ActivationRecord } from './storageV9'
import { checkV8HostWriteEligibility } from '../hooks/useAppDataV8'
import { createBlankProjectV9 } from './teacherSubjectsV9'
import type { AppDataV9 } from '../types/v9'

const time = '2026-10-23T01:00:00.000Z'
function memory() {
  const values = new Map<string, string>()
  const store = {
    values,
    get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  }
  return store
}
beforeEach(() => vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
  operation: (lock: unknown) => Promise<unknown>) => operation({}) } }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function ready() {
  const storage = memory()
  const bootstrap = await bootstrapEmptyV8(storage, { attemptId: 'v8-source', createdAt: time })
  if (!bootstrap.ok) throw new Error(bootstrap.code)
  const rawV8 = storage.getItem(APP_DATA_V8_KEY)!
  const candidate = { ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9
  const result = await activateTimetableSubjectsV9(storage, { attemptId: 'upgrade-a', createdAt: time,
    expectedV8Raw: rawV8, candidate, decisions: [], confirmedExternalV8Digest: await fingerprintV7Raw(rawV8), userConfirmedExternalBackup: true })
  return { storage, rawV8, candidate, result }
}

describe('explicit teacher Subject upgrade and V9 storage', () => {
  it('backs up exact V8 and activation raw, verifies readback, and never overwrites old keys', async () => {
    const { storage, rawV8, result } = await ready()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const backup = JSON.parse(storage.getItem(result.backupKey)!)
    expect(backup.sourceV8Raw).toBe(rawV8)
    expect(backup.sourceV8Digest).toBe(await fingerprintV7Raw(rawV8))
    expect(backup.sourceActivationRaw).toBe(storage.getItem(V8_BOOTSTRAP_KEY))
    expect(backup.sourceActivationDigest).toBe(await fingerprintV7Raw(backup.sourceActivationRaw))
    expect(storage.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(loadAppDataV9(storage)).toMatchObject({ status: 'active', document: { schemaVersion: 9 } })
    expect(await checkV9WriteEvidence(storage, result.rawDocument, storage.getItem(V9_ACTIVATION_KEY)!)).toBe(true)
    expect((await checkV8HostWriteEligibility(storage, rawV8)).eligible).toBe(false)
  })

  it('advances digest and revision for normal writes; stale snapshots cannot overwrite them', async () => {
    const { storage, candidate, result } = await ready()
    if (!result.ok) throw new Error('fixture failed')
    const firstMetaRaw = storage.getItem(V9_ACTIVATION_KEY)!
    let serial = 0
    const next = createBlankProjectV9(candidate, { name: '新專案', academicYear: 115,
      semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `new-${++serial}`)
    const receipt = await persistAppDataV9(storage, candidate, next,
      { raw: result.rawDocument, metadataRaw: firstMetaRaw, revision: 0 })
    expect(receipt.revision).toBe(1)
    const meta = JSON.parse(storage.getItem(V9_ACTIVATION_KEY)!) as V9ActivationRecord
    expect(meta.initialDigest).toBe(result.metadata.initialDigest)
    expect(meta.currentDigest).toBe(await fingerprintV7Raw(receipt.raw))
    expect(meta.documentRevision).toBe(1)
    await expect(persistAppDataV9(storage, candidate, next,
      { raw: result.rawDocument, metadataRaw: firstMetaRaw, revision: 0 }))
      .rejects.toMatchObject({ code: 'activation-conflict' })
    expect(storage.getItem(APP_DATA_V9_KEY)).toBe(receipt.raw)
  })

  it('is fail-closed after source V8 changes, metadata corruption, or backup tampering', async () => {
    const { storage, result, candidate } = await ready()
    if (!result.ok) throw new Error('fixture failed')
    const metadataRaw = storage.getItem(V9_ACTIVATION_KEY)!
    storage.setItem(APP_DATA_V8_KEY, '{}')
    expect(await checkV9WriteEvidence(storage, result.rawDocument, metadataRaw)).toBe(false)
    await expect(persistAppDataV9(storage, candidate, candidate,
      { raw: result.rawDocument, metadataRaw, revision: 0 }))
      .rejects.toMatchObject({ code: 'activation-conflict' })
    expect(storage.getItem(APP_DATA_V9_KEY)).toBe(result.rawDocument)
    storage.setItem(APP_DATA_V8_KEY, JSON.parse(storage.getItem(result.backupKey)!).sourceV8Raw)
    storage.setItem(result.backupKey, '{}')
    expect(await checkV9WriteEvidence(storage, result.rawDocument, metadataRaw)).toBe(false)
    storage.setItem(V9_ACTIVATION_KEY, '{bad')
    expect(loadAppDataV9(storage).status).toBe('corrupt-metadata')
  })

  it('preserves preparing and backup after document write failure, without touching V8', async () => {
    const store = memory()
    const bootstrap = await bootstrapEmptyV8(store, { attemptId: 'v8-source', createdAt: time })
    if (!bootstrap.ok) throw new Error('fixture failed')
    const rawV8 = store.getItem(APP_DATA_V8_KEY)!
    const realWrite = store.setItem.getMockImplementation()!
    store.setItem.mockImplementation((key, value) => {
      if (key === APP_DATA_V9_KEY) throw new Error('quota')
      realWrite(key, value)
    })
    const result = await activateTimetableSubjectsV9(store, { attemptId: 'failed-attempt', createdAt: time,
      expectedV8Raw: rawV8, candidate: { ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9,
      decisions: [], confirmedExternalV8Digest: await fingerprintV7Raw(rawV8), userConfirmedExternalBackup: true })
    expect(result).toMatchObject({ ok: false, code: 'document-failed' })
    expect(loadAppDataV9(store).status).toBe('preparing')
    expect(store.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(store.getItem('aster-timetable-v9-subject-backup:failed-attempt')).not.toBeNull()
    store.setItem.mockImplementation(realWrite)
    const resumed = await resumeTimetableSubjectsV9(store)
    expect(resumed.ok).toBe(true)
    expect(loadAppDataV9(store).status).toBe('active')
    expect(store.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(await resumeTimetableSubjectsV9(store)).toMatchObject({ ok: false, code: 'not-interrupted' })
  })

  it('requires a snapshot-bound external confirmation and refuses an unrelated candidate', async () => {
    const store = memory()
    const bootstrap = await bootstrapEmptyV8(store, { attemptId: 'v8-source', createdAt: time })
    if (!bootstrap.ok) throw new Error('fixture failed')
    const rawV8 = store.getItem(APP_DATA_V8_KEY)!
    const candidate = { ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9
    expect(await activateTimetableSubjectsV9(store, { attemptId: 'wrong-digest', createdAt: time,
      expectedV8Raw: rawV8, candidate, decisions: [], confirmedExternalV8Digest: `sha256:${'0'.repeat(64)}`, userConfirmedExternalBackup: true }))
      .toMatchObject({ ok: false, code: 'source-changed' })
    expect(store.getItem(V9_ACTIVATION_KEY)).toBeNull()
  })

  it('blocks orphaned backup attempts and keeps old V8 writable only before upgrade starts', async () => {
    const store = memory()
    const bootstrap = await bootstrapEmptyV8(store, { attemptId: 'v8-source', createdAt: time })
    if (!bootstrap.ok) throw new Error('fixture failed')
    const rawV8 = store.getItem(APP_DATA_V8_KEY)!
    store.setItem('aster-timetable-v9-subject-backup:orphan', '{partial}')
    expect(await activateTimetableSubjectsV9(store, { attemptId: 'new-attempt', createdAt: time,
      expectedV8Raw: rawV8, candidate: { ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9,
      decisions: [], confirmedExternalV8Digest: await fingerprintV7Raw(rawV8), userConfirmedExternalBackup: true }))
      .toMatchObject({ ok: false, code: 'already-started' })
    expect(store.getItem(APP_DATA_V9_KEY)).toBeNull()
    expect(store.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
  })

  it('refuses activation when internal backup write fails and leaves source untouched', async () => {
    const store = memory()
    const bootstrap = await bootstrapEmptyV8(store, { attemptId: 'v8-source', createdAt: time })
    if (!bootstrap.ok) throw new Error('fixture failed')
    const rawV8 = store.getItem(APP_DATA_V8_KEY)!
    const realWrite = store.setItem.getMockImplementation()!
    store.setItem.mockImplementation((key, value) => {
      if (key.startsWith('aster-timetable-v9-subject-backup:')) throw new Error('quota')
      realWrite(key, value)
    })
    expect(await activateTimetableSubjectsV9(store, { attemptId: 'failed-backup', createdAt: time,
      expectedV8Raw: rawV8, candidate: { ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9,
      decisions: [], confirmedExternalV8Digest: await fingerprintV7Raw(rawV8), userConfirmedExternalBackup: true }))
      .toMatchObject({ ok: false, code: 'backup-failed' })
    expect(store.getItem(APP_DATA_V9_KEY)).toBeNull()
    expect(store.getItem(V9_ACTIVATION_KEY)).toBeNull()
    expect(store.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
  })

  it('resumes exact candidate after active metadata write failure, but rejects changed source', async () => {
    const store = memory()
    const bootstrap = await bootstrapEmptyV8(store, { attemptId: 'v8-source', createdAt: time })
    if (!bootstrap.ok) throw new Error('fixture failed')
    const rawV8 = store.getItem(APP_DATA_V8_KEY)!
    const realWrite = store.setItem.getMockImplementation()!
    store.setItem.mockImplementation((key, value) => {
      if (key === V9_ACTIVATION_KEY && JSON.parse(value).status === 'active') throw new Error('quota')
      realWrite(key, value)
    })
    const result = await activateTimetableSubjectsV9(store, { attemptId: 'active-failed', createdAt: time,
      expectedV8Raw: rawV8, candidate: { ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9,
      decisions: [], confirmedExternalV8Digest: await fingerprintV7Raw(rawV8), userConfirmedExternalBackup: true })
    expect(result).toMatchObject({ ok: false, code: 'active-failed' })
    expect(loadAppDataV9(store).status).toBe('preparing')
    expect(store.getItem(APP_DATA_V9_KEY)).not.toBeNull()
    store.setItem.mockImplementation(realWrite)
    store.setItem(APP_DATA_V8_KEY, '{changed-by-old-tab}')
    expect(await resumeTimetableSubjectsV9(store)).toMatchObject({ ok: false, code: 'source-changed' })
    expect(loadAppDataV9(store).status).toBe('preparing')
    store.setItem(APP_DATA_V8_KEY, rawV8)
    expect((await resumeTimetableSubjectsV9(store)).ok).toBe(true)
  })

  it('can explicitly resume a backup-only interruption after preparing write failure', async () => {
    const store = memory()
    const bootstrap = await bootstrapEmptyV8(store, { attemptId: 'v8-source', createdAt: time })
    if (!bootstrap.ok) throw new Error('fixture failed')
    const rawV8 = store.getItem(APP_DATA_V8_KEY)!
    const realWrite = store.setItem.getMockImplementation()!
    store.setItem.mockImplementation((key, value) => {
      if (key === V9_ACTIVATION_KEY) throw new Error('quota')
      realWrite(key, value)
    })
    expect(await activateTimetableSubjectsV9(store, { attemptId: 'orphan', createdAt: time,
      expectedV8Raw: rawV8, candidate: { ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9,
      decisions: [], confirmedExternalV8Digest: await fingerprintV7Raw(rawV8), userConfirmedExternalBackup: true }))
      .toMatchObject({ ok: false, code: 'preparing-failed' })
    expect(loadAppDataV9(store).status).toBe('absent')
    expect((await checkV8HostWriteEligibility(store, rawV8)).eligible).toBe(false)
    store.setItem.mockImplementation(realWrite)
    expect((await resumeOrphanedSubjectUpgradeV9(store, 'orphan')).ok).toBe(true)
    expect(loadAppDataV9(store).status).toBe('active')
    expect(store.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
  })
})

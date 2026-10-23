import { afterEach, describe, expect, it, vi } from 'vitest'
import { fingerprintV7Raw, V8_TRANSACTION_KEY, type V8ActivationTransaction } from './activationV8'
import { createCutoverBackupV8 } from './cutoverBackupV8'
import { activateCutoverV8 } from './cutoverTransactionV8'
import { inspectV8Recovery } from './recoveryInspectionV8'
import { createV8RollbackArchive, planV8Rollback, readV8RescueRaw, verifyV8RollbackArchive,
  V8_ROLLBACK_ARCHIVE_PREFIX } from './rollbackArchiveV8'
import { inspectV8BrowserCapability, assessV8SessionSafety, createV8SessionCoordinator,
  inspectCutoverSessionReadiness } from './v8SessionSafety'
import { createInitialAppDataV8 } from '../hooks/useAppDataV8'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY } from './storageV8'

const time = '2026-10-22T01:00:00.000Z'
const validV7 = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
function memory(entries: [string, string][] = []) {
  const values = new Map(entries)
  return { values, getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }) }
}
function locks() {
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
    operation: (lock: unknown) => Promise<unknown>) => operation({}) } })
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function activeFixture() {
  const rawV8 = JSON.stringify(createInitialAppDataV8())
  const digest = await fingerprintV7Raw(rawV8)
  const store = memory([[APP_DATA_V8_KEY, rawV8]])
  const backup = await createCutoverBackupV8(store, { backupId: 'backup-1', expectedRaw: null, createdAt: time })
  if (!backup.ok) throw new Error('fixture backup failed')
  const transaction: V8ActivationTransaction = {
    schemaVersion: 2, transactionId: 'transaction-1', status: 'active', source: { type: 'empty' },
    backup: { id: 'backup-1', key: backup.key, digest: null },
    externalConfirmation: { source: { type: 'empty' }, externalExportPrepared: true, userConfirmedExternalBackup: true },
    candidateDigest: digest, currentDigest: digest, expectedV8Raw: null, documentRevision: 0,
    createdAt: time, updatedAt: time, lastError: null, archive: null,
  }
  store.values.set(V8_TRANSACTION_KEY, JSON.stringify(transaction))
  return { store, transaction, rawV8, backup }
}

describe('B2c session safety', () => {
  it('distinguishes unavailable, available and rejected Web Locks without treating capability as ownership', async () => {
    expect(await inspectV8BrowserCapability({})).toEqual({ webLocks: 'unavailable', coordination: 'unavailable' })
    expect(await inspectV8BrowserCapability({ locks: { request: async () => true } as unknown as LockManager,
      BroadcastChannel })).toEqual({ webLocks: 'available', coordination: 'available' })
    expect(await inspectV8BrowserCapability({ locks: { request: async () => { throw new Error('denied') } } as unknown as LockManager,
      BroadcastChannel })).toEqual({ webLocks: 'request-failed', coordination: 'available' })
  })

  it('keeps readiness blocked for silent legacy tabs, unresponsive modern tabs and collisions', () => {
    const capability = { webLocks: 'available' as const, coordination: 'available' as const }
    expect(assessV8SessionSafety(capability, []).issues).toContain('legacy-tabs-unverifiable')
    const unresolved = assessV8SessionSafety(capability, [{ id: 'peer', responsive: false, stale: true }], true)
    expect(unresolved.readiness).toBe('blocked')
    expect(unresolved.issues).toEqual(expect.arrayContaining(['modern-tab-unresponsive', 'identity-collision']))
  })

  it('exchanges ephemeral presence and close requests without declaring cutover safe', () => {
    const listeners = new Set<(event: MessageEvent) => void>()
    const sent: unknown[] = []
    const channel = { postMessage: (message: unknown) => { sent.push(message) }, close: vi.fn(),
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => { listeners.add(listener) },
      removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => { listeners.delete(listener) } }
    const coordinator = createV8SessionCoordinator(channel, { webLocks: 'available', coordination: 'available' }, 'tab-a', () => 1000)
    listeners.forEach((listener) => listener({ data: { protocol: 1, type: 'hello', sessionId: 'tab-b' } } as MessageEvent))
    expect(coordinator.snapshot().modernSessions).toEqual([{ id: 'tab-b', responsive: false, stale: false }])
    listeners.forEach((listener) => listener({ data: { protocol: 1, type: 'ack', sessionId: 'tab-b' } } as MessageEvent))
    expect(coordinator.snapshot().modernSessions[0].responsive).toBe(true)
    coordinator.requestOtherTabsToClose()
    coordinator.requestOtherTabsToReload()
    expect(sent).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'close-request', sessionId: 'tab-a' })]))
    expect(sent).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'reload-request', sessionId: 'tab-a' })]))
    expect(coordinator.snapshot(32_000).modernSessions[0].stale).toBe(true)
    expect(coordinator.snapshot().readiness).toBe('blocked')
    coordinator.close()
    expect(channel.close).toHaveBeenCalledOnce()
  })

  it('blocks the production activation entry before any write when legacy-tab safety is unverifiable', async () => {
    const store = memory()
    const backup = await createCutoverBackupV8(store, { backupId: 'attempt', expectedRaw: null, createdAt: time })
    if (!backup.ok) throw new Error('fixture failed')
    locks()
    const readiness = await inspectCutoverSessionReadiness()
    expect(readiness.readiness).toBe('blocked')
    const result = await activateCutoverV8(store, { transactionId: 'attempt', backup,
      confirmation: { source: { type: 'empty' }, externalExportPrepared: true,
        userConfirmedExternalBackup: true }, createdAt: time })
    expect(result).toMatchObject({ ok: false, code: 'session-unsafe',
      sessionIssues: expect.arrayContaining(['legacy-tabs-unverifiable']) })
    expect(store.values.has(APP_DATA_V8_KEY)).toBe(false)
    expect(store.values.has(V8_TRANSACTION_KEY)).toBe(false)
  })
})

describe('B2c read-only recovery and rollback archive', () => {
  it('classifies healthy, interrupted and conflicting snapshots without writes', async () => {
    const { store, transaction, rawV8 } = await activeFixture()
    const calls = store.setItem.mock.calls.length
    expect(await inspectV8Recovery(store)).toMatchObject({ status: 'healthy-active', severity: 'none', canViewReadOnly: true })
    store.values.set(V8_TRANSACTION_KEY, JSON.stringify({ ...transaction, status: 'preparing' }))
    expect((await inspectV8Recovery(store)).status).toBe('preparing-interrupted')
    store.values.set(V8_TRANSACTION_KEY, JSON.stringify({ ...transaction, status: 'prepared' }))
    expect((await inspectV8Recovery(store)).status).toBe('prepared-interrupted')
    store.values.set(V8_TRANSACTION_KEY, JSON.stringify(transaction))
    store.values.set(APP_DATA_V7_KEY, '{new-v7')
    expect((await inspectV8Recovery(store)).status).toBe('corrupt-v7')
    store.values.set(APP_DATA_V7_KEY, JSON.stringify({ schemaVersion: 7 }))
    expect((await inspectV8Recovery(store)).status).toBe('corrupt-v7')
    store.values.set(APP_DATA_V7_KEY, JSON.stringify({ schemaVersion: 7, projects: [] }))
    expect((await inspectV8Recovery(store)).status).toBe('corrupt-v7')
    store.values.delete(APP_DATA_V7_KEY)
    store.values.set(APP_DATA_V8_KEY, '{bad')
    expect((await inspectV8Recovery(store)).status).toBe('corrupt-v8')
    store.values.set(APP_DATA_V8_KEY, rawV8)
    store.values.set(V8_TRANSACTION_KEY, '{bad')
    expect((await inspectV8Recovery(store)).status).toBe('corrupt-activation')
    expect(store.setItem.mock.calls.length).toBe(calls)
  })

  it('classifies missing and mismatched backups, empty-source V7 creation and V8 digest conflicts', async () => {
    const { store, transaction, backup } = await activeFixture()
    store.values.delete(backup.key)
    expect((await inspectV8Recovery(store)).status).toBe('missing-backup')
    store.values.set(backup.key, '{bad')
    expect((await inspectV8Recovery(store)).status).toBe('backup-mismatch')
    store.values.set(backup.key, backup.raw)
    store.values.set(APP_DATA_V7_KEY, JSON.stringify(validV7()))
    const sourceConflict = await inspectV8Recovery(store)
    expect(sourceConflict.status).toBe('active-source-conflict')
    expect(sourceConflict.canExport).toBe(true)
    expect(sourceConflict.rawV7).toBe(store.values.get(APP_DATA_V7_KEY))
    store.values.delete(APP_DATA_V7_KEY)
    store.values.set(V8_TRANSACTION_KEY, JSON.stringify({ ...transaction, documentRevision: 1,
      currentDigest: `sha256:${'0'.repeat(64)}` }))
    expect((await inspectV8Recovery(store)).status).toBe('active-v8-conflict')
  })

  it('classifies missing metadata, rollback-recovery archive needs, and non-destructive export', async () => {
    const { store, transaction, rawV8 } = await activeFixture()
    store.values.delete(V8_TRANSACTION_KEY)
    expect(await inspectV8Recovery(store)).toMatchObject({ status: 'unknown-blocking', rawV8,
      blockingIssues: ['missing-transaction'] })
    store.values.set(V8_TRANSACTION_KEY, JSON.stringify({ ...transaction, status: 'rollback-recovery' }))
    expect(await inspectV8Recovery(store)).toMatchObject({ status: 'archive-required', requiresV8Archive: true })
    store.values.set(V8_TRANSACTION_KEY, JSON.stringify({ ...transaction, status: 'rolled-back',
      archive: { id: 'missing', key: `${V8_ROLLBACK_ARCHIVE_PREFIX}missing`, digest: transaction.currentDigest } }))
    expect(await inspectV8Recovery(store)).toMatchObject({ status: 'archive-required',
      blockingIssues: expect.arrayContaining(['archive-missing']) })
  })

  it('archives exact V8 raw, digest, revision and lineage; duplicate ID cannot overwrite', async () => {
    locks()
    const { store, transaction, rawV8 } = await activeFixture()
    const result = await createV8RollbackArchive(store, { archiveId: 'archive-1', archivedAt: time })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record).toMatchObject({ transactionId: transaction.transactionId, rawV8,
      digest: transaction.currentDigest, documentRevision: 0, lineage: { backupId: transaction.backup.id } })
    expect(await verifyV8RollbackArchive(result.raw)).toEqual(result.record)
    expect(await createV8RollbackArchive(store, { archiveId: 'archive-1', archivedAt: time }))
      .toMatchObject({ ok: false, code: 'already-exists' })
    expect(store.values.get(result.key)).toBe(result.raw)
    expect(store.values.get(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(JSON.parse(store.values.get(V8_TRANSACTION_KEY)!).status).toBe('active')
    store.values.set(V8_TRANSACTION_KEY, JSON.stringify({ ...transaction, status: 'rollback-recovery' }))
    expect(await planV8Rollback(store, result.key)).toMatchObject({ readyForManualRecovery: true,
      archiveVerified: true, archiveRevisionMatches: true, v8OnlyChanges: false })
  })

  it('returns a rescue raw, never a verified archive, for corrupt V8; handles write/readback failures', async () => {
    locks()
    const { store, rawV8 } = await activeFixture()
    store.values.set(APP_DATA_V8_KEY, '{corrupt')
    expect(readV8RescueRaw(store)).toEqual({ ok: true, raw: '{corrupt' })
    expect(await createV8RollbackArchive(store, { archiveId: 'rescue', archivedAt: time }))
      .toMatchObject({ ok: false, code: 'corrupt-v8', rescueRawV8: '{corrupt' })
    store.values.set(APP_DATA_V8_KEY, rawV8)
    store.setItem.mockImplementation(() => { throw new Error('quota') })
    expect(await createV8RollbackArchive(store, { archiveId: 'quota', archivedAt: time }))
      .toMatchObject({ ok: false, code: 'write-failure' })
    store.setItem.mockImplementation(() => {})
    expect(await createV8RollbackArchive(store, { archiveId: 'silent', archivedAt: time }))
      .toMatchObject({ ok: false, code: 'readback-mismatch' })
    expect(store.values.has(`${V8_ROLLBACK_ARCHIVE_PREFIX}rescue`)).toBe(false)
  })

  it('fails closed when Web Locks are unavailable for archive creation', async () => {
    const { store, rawV8 } = await activeFixture()
    vi.stubGlobal('navigator', {})
    expect(await createV8RollbackArchive(store, { archiveId: 'no-lock', archivedAt: time }))
      .toMatchObject({ ok: false, code: 'lock-unavailable' })
    expect(store.values.get(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(store.values.has(`${V8_ROLLBACK_ARCHIVE_PREFIX}no-lock`)).toBe(false)
  })

  it('rejects missing V8, digest mismatch and archive tampering without changing source keys', async () => {
    locks()
    const { store, transaction, rawV8 } = await activeFixture()
    store.values.delete(APP_DATA_V8_KEY)
    expect(await createV8RollbackArchive(store, { archiveId: 'missing', archivedAt: time }))
      .toMatchObject({ ok: false, code: 'missing-v8' })
    store.values.set(APP_DATA_V8_KEY, rawV8)
    store.values.set(V8_TRANSACTION_KEY, JSON.stringify({ ...transaction, documentRevision: 1,
      currentDigest: `sha256:${'0'.repeat(64)}` }))
    expect(await createV8RollbackArchive(store, { archiveId: 'mismatch', archivedAt: time }))
      .toMatchObject({ ok: false, code: 'digest-mismatch' })
    store.values.set(V8_TRANSACTION_KEY, JSON.stringify(transaction))
    const result = await createV8RollbackArchive(store, { archiveId: 'verified', archivedAt: time })
    if (!result.ok) throw new Error('archive fixture failed')
    expect(await verifyV8RollbackArchive(JSON.stringify({ ...result.record,
      digest: `sha256:${'0'.repeat(64)}` }))).toBe('digest-mismatch')
    store.values.set(V8_TRANSACTION_KEY, JSON.stringify({ ...transaction, status: 'rollback-recovery', documentRevision: 1,
      currentDigest: await fingerprintV7Raw(rawV8) }))
    expect(await planV8Rollback(store, result.key)).toMatchObject({ readyForManualRecovery: false,
      issues: expect.arrayContaining(['revision-mismatch']), v8OnlyChanges: true })
    expect(store.values.get(APP_DATA_V8_KEY)).toBe(rawV8)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectCutoverSessionReadiness } from './v8SessionSafety'
import { canTransitionV8, fingerprintV7Raw, isV8ActivationTransaction,
  loadV8Transaction, V8_TRANSACTION_KEY } from './activationV8'
import { createCutoverBackupV8 } from './cutoverBackupV8'
import { activateCutoverV8, inspectCutoverV8 } from './cutoverTransactionV8'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY } from './storageV8'

const time = '2026-10-22T01:00:00.000Z'
vi.mock('./v8SessionSafety', () => ({ inspectCutoverSessionReadiness: vi.fn() }))
beforeEach(() => { vi.mocked(inspectCutoverSessionReadiness).mockResolvedValue({
  readiness: 'verified', webLocks: 'available', coordination: 'available', modernSessions: [], issues: [],
}) })
const sourceV7 = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
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

async function evidence(store: ReturnType<typeof memory>, backupId = 'attempt-1') {
  const raw = store.getItem(APP_DATA_V7_KEY)
  const backup = await createCutoverBackupV8(store, { backupId, expectedRaw: raw, createdAt: time })
  if (!backup.ok) throw new Error('backup fixture failed')
  const source = raw === null ? { type: 'empty' as const }
    : { type: 'v7' as const, key: APP_DATA_V7_KEY as typeof APP_DATA_V7_KEY, digest: await fingerprintV7Raw(raw) }
  return { transactionId: backupId, backup,
    confirmation: { source, externalExportPrepared: true, userConfirmedExternalBackup: true }, createdAt: time }
}

describe('V8 activation transaction protocol', () => {
  it('validates state transitions, schema version, status, identity and baseline digest', async () => {
    locks()
    const store = memory()
    const result = await activateCutoverV8(store, await evidence(store))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const active = result.transaction
    expect(isV8ActivationTransaction(active)).toBe(true)
    expect(active.source).toEqual({ type: 'empty' })
    expect(active.documentRevision).toBe(0)
    expect(canTransitionV8('absent', 'preparing')).toBe(true)
    expect(canTransitionV8('preparing', 'prepared')).toBe(true)
    expect(canTransitionV8('prepared', 'active')).toBe(true)
    expect(canTransitionV8('active', 'rollback-recovery')).toBe(true)
    expect(canTransitionV8('rollback-recovery', 'rolled-back')).toBe(true)
    expect(canTransitionV8('interrupted', 'active')).toBe(false)
    expect(canTransitionV8('rolled-back', 'active')).toBe(false)
    expect(isV8ActivationTransaction({ ...active, schemaVersion: 9 })).toBe(false)
    expect(isV8ActivationTransaction({ ...active, status: 'unknown' })).toBe(false)
    expect(isV8ActivationTransaction({ ...active, transactionId: '' })).toBe(false)
    expect(isV8ActivationTransaction({ ...active, currentDigest: `sha256:${'0'.repeat(64)}` })).toBe(false)
    expect(isV8ActivationTransaction({ ...active, source: { type: 'v7' } })).toBe(false)
    expect(isV8ActivationTransaction({ ...active, source: { type: 'empty', digest: active.candidateDigest } })).toBe(false)
    expect(isV8ActivationTransaction({ ...active, externalConfirmation: { ...active.externalConfirmation, source: null } })).toBe(false)
    expect(isV8ActivationTransaction({ ...active, backup: { ...active.backup, key: 'wrong' } })).toBe(false)
    expect(isV8ActivationTransaction({ ...active, status: 'rollback-recovery' })).toBe(true)
    expect(isV8ActivationTransaction({ ...active, status: 'rolled-back' })).toBe(false)
  })

  it('activates a backed-up V7 candidate in preparing → prepared → active order', async () => {
    locks()
    const rawV7 = JSON.stringify(sourceV7())
    const store = memory([[APP_DATA_V7_KEY, rawV7]])
    const input = await evidence(store)
    const result = await activateCutoverV8(store, input)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.transaction.source).toEqual(input.confirmation.source)
    expect(store.values.get(APP_DATA_V7_KEY)).toBe(rawV7)
    expect(store.values.get(APP_DATA_V8_KEY)).toBeTruthy()
    expect(store.setItem.mock.calls.filter(([key]) => key === V8_TRANSACTION_KEY)
      .map(([, raw]) => JSON.parse(raw).status)).toEqual(['preparing', 'prepared', 'active'])
    expect((await inspectCutoverV8(store)).issues).toEqual([])
    const writeCount = store.setItem.mock.calls.length
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: true, replayed: true,
      transaction: { transactionId: 'attempt-1' } })
    expect(store.setItem.mock.calls.length).toBe(writeCount)
  })

  it('requires lock, verified internal backup, and source-bound external confirmation', async () => {
    const store = memory([[APP_DATA_V7_KEY, JSON.stringify(sourceV7())]])
    const input = await evidence(store)
    vi.stubGlobal('navigator', {})
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'lock-unavailable' })
    locks()
    store.values.delete(input.backup.key)
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'backup-invalid' })
    store.values.set(input.backup.key, input.backup.raw)
    expect(await activateCutoverV8(store, { ...input, confirmation: { ...input.confirmation,
      userConfirmedExternalBackup: false } })).toMatchObject({ ok: false, code: 'confirmation-invalid' })
    expect(await activateCutoverV8(store, { ...input, confirmation: { ...input.confirmation,
      source: { type: 'empty' } } })).toMatchObject({ ok: false, code: 'confirmation-invalid' })
    expect(store.values.has(V8_TRANSACTION_KEY)).toBe(false)
    expect(store.values.has(APP_DATA_V8_KEY)).toBe(false)
  })

  it('blocks a changed source, existing V8 or unknown transaction before any activation write', async () => {
    locks()
    const store = memory([[APP_DATA_V7_KEY, JSON.stringify(sourceV7())]])
    const input = await evidence(store)
    const changed = sourceV7()
    store.values.set(APP_DATA_V7_KEY, JSON.stringify({ ...changed,
      projects: changed.projects.map((project) => ({ ...project, name: 'changed' })) }))
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'backup-invalid' })
    store.values.set(APP_DATA_V7_KEY, input.backup.record.source.type === 'v7' ? input.backup.record.source.raw : '')
    store.values.set(APP_DATA_V8_KEY, '{corrupt')
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'preflight-blocked' })
    store.values.delete(APP_DATA_V8_KEY)
    store.values.set(V8_TRANSACTION_KEY, '{unknown')
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'preflight-blocked',
      preflightIssues: [expect.objectContaining({ code: 'unknown-activation' })] })
    expect((await inspectCutoverV8(store)).status).toBe('unknown')
  })

  it('preserves preparing and source when the V8 write fails; inspection never resumes', async () => {
    locks()
    const rawV7 = JSON.stringify(sourceV7())
    const store = memory([[APP_DATA_V7_KEY, rawV7]])
    const input = await evidence(store)
    store.setItem.mockImplementation((key, raw) => {
      if (key === APP_DATA_V8_KEY) throw new Error('quota')
      store.values.set(key, raw)
    })
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'write-failure' })
    expect(loadV8Transaction(store).value?.status).toBe('preparing')
    expect(store.values.get(APP_DATA_V7_KEY)).toBe(rawV7)
    expect(store.values.has(APP_DATA_V8_KEY)).toBe(false)
    expect(await inspectCutoverV8(store)).toMatchObject({ status: 'preparing', manualRetryEligible: true })
    expect(store.values.has(APP_DATA_V8_KEY)).toBe(false)
  })

  it('detects a partial V8 write when prepared metadata cannot be persisted', async () => {
    locks()
    const store = memory()
    const input = await evidence(store)
    store.setItem.mockImplementation((key, raw) => {
      if (key === V8_TRANSACTION_KEY && JSON.parse(raw).status === 'prepared') throw new Error('quota')
      store.values.set(key, raw)
    })
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'write-failure' })
    expect(store.values.has(APP_DATA_V8_KEY)).toBe(true)
    expect(await inspectCutoverV8(store)).toMatchObject({ status: 'preparing', manualRetryEligible: false })
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'preflight-blocked' })
  })

  it('rechecks session readiness before active and leaves prepared when safety changes', async () => {
    locks()
    const store = memory()
    const input = await evidence(store)
    vi.mocked(inspectCutoverSessionReadiness)
      .mockResolvedValueOnce({ readiness: 'verified', webLocks: 'available', coordination: 'available', modernSessions: [], issues: [] })
      .mockResolvedValueOnce({ readiness: 'verified', webLocks: 'available', coordination: 'available', modernSessions: [], issues: [] })
      .mockResolvedValueOnce({ readiness: 'blocked', webLocks: 'available', coordination: 'available', modernSessions: [],
        issues: ['legacy-tabs-unverifiable'] })
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'session-unsafe' })
    expect(loadV8Transaction(store).value?.status).toBe('prepared')
    expect(store.values.has(APP_DATA_V8_KEY)).toBe(true)
  })

  it('leaves a prepared transaction inspectable when final active write fails', async () => {
    locks()
    const store = memory()
    const input = await evidence(store)
    store.setItem.mockImplementation((key, raw) => {
      if (key === V8_TRANSACTION_KEY && JSON.parse(raw).status === 'active') throw new Error('quota')
      store.values.set(key, raw)
    })
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'write-failure' })
    expect(await inspectCutoverV8(store)).toMatchObject({ status: 'prepared', issues: [], manualRetryEligible: false })
    expect(store.values.has(APP_DATA_V8_KEY)).toBe(true)
  })

  it.each(['preparing', 'v8', 'prepared', 'active'] as const)(
    'does not claim success when %s readback is unconfirmed', async (stage) => {
      locks()
      const store = memory()
      const input = await evidence(store)
      store.setItem.mockImplementation((key, raw) => {
        const status = key === V8_TRANSACTION_KEY ? JSON.parse(raw).status : null
        if ((stage === 'v8' && key === APP_DATA_V8_KEY) || status === stage) return
        store.values.set(key, raw)
      })
      expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'readback-failure' })
      expect(loadV8Transaction(store).value?.status).not.toBe('active')
    },
  )

  it('refuses to overwrite a V8 snapshot inserted by another page after preparing', async () => {
    locks()
    const store = memory()
    const input = await evidence(store)
    store.setItem.mockImplementation((key, raw) => {
      store.values.set(key, raw)
      if (key === V8_TRANSACTION_KEY && JSON.parse(raw).status === 'preparing') store.values.set(APP_DATA_V8_KEY, '{external')
    })
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'v8-changed' })
    expect(store.values.get(APP_DATA_V8_KEY)).toBe('{external')
    expect(loadV8Transaction(store).value?.status).toBe('preparing')
  })

  it('refuses V7 changes after preparing and never resets the source fingerprint', async () => {
    locks()
    const rawV7 = JSON.stringify(sourceV7())
    const store = memory([[APP_DATA_V7_KEY, rawV7]])
    const input = await evidence(store)
    store.setItem.mockImplementation((key, raw) => {
      store.values.set(key, raw)
      if (key === V8_TRANSACTION_KEY && JSON.parse(raw).status === 'preparing') store.values.set(APP_DATA_V7_KEY, '{legacy-changed')
    })
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'source-changed' })
    expect(store.values.has(APP_DATA_V8_KEY)).toBe(false)
    expect(loadV8Transaction(store).value?.source).toEqual(input.confirmation.source)
  })

  it('detects an active document digest mismatch during read-only inspection', async () => {
    locks()
    const store = memory()
    const result = await activateCutoverV8(store, await evidence(store))
    expect(result.ok).toBe(true)
    store.values.set(APP_DATA_V8_KEY, '{corrupt')
    expect(await inspectCutoverV8(store)).toMatchObject({ status: 'active', manualRetryEligible: false })
    expect((await inspectCutoverV8(store)).issues).toContain('v8-corrupt')
  })

  it('serializes two cooperating activations; the second cannot overwrite the first', async () => {
    let queue = Promise.resolve()
    vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown,
      operation: (lock: unknown) => Promise<unknown>) => {
      const result = queue.then(() => operation({}))
      queue = result.then(() => undefined)
      return result
    } } })
    const store = memory()
    const first = await evidence(store, 'first')
    const second = await evidence(store, 'second')
    const [one, two] = await Promise.all([activateCutoverV8(store, first), activateCutoverV8(store, second)])
    expect(one.ok).toBe(true)
    expect(two).toMatchObject({ ok: false, code: 'preflight-blocked' })
    expect(loadV8Transaction(store).value?.transactionId).toBe('first')
  })

  it('fails closed if Web Locks rejects or V7 changes while the lock is pending', async () => {
    const store = memory([[APP_DATA_V7_KEY, JSON.stringify(sourceV7())]])
    const input = await evidence(store)
    vi.stubGlobal('navigator', { locks: { request: async () => { throw new Error('denied') } } })
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'lock-failure' })
    locks()
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
      operation: (lock: unknown) => Promise<unknown>) => {
      store.values.set(APP_DATA_V7_KEY, '{changed')
      return operation({})
    } } })
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'preflight-blocked' })
    expect(store.values.has(V8_TRANSACTION_KEY)).toBe(false)
  })

  it.each([V8_TRANSACTION_KEY, APP_DATA_V8_KEY])('rechecks %s after waiting for the lock', async (key) => {
    const store = memory()
    const input = await evidence(store)
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
      operation: (lock: unknown) => Promise<unknown>) => {
      store.values.set(key, '{external')
      return operation({})
    } } })
    expect(await activateCutoverV8(store, input)).toMatchObject({ ok: false, code: 'preflight-blocked' })
    expect(store.values.get(key)).toBe('{external')
    expect(store.setItem.mock.calls.filter(([writtenKey]) => writtenKey === APP_DATA_V8_KEY)).toEqual([])
  })
})

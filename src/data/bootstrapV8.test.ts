import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_DATA_V8_ACTIVATION_KEY, V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY,
  fingerprintV7Raw, isV8BootstrapMetadata, loadV8BootstrapMetadata } from './activationV8'
import { bootstrapEmptyV8, preflightEmptyV8Bootstrap } from './bootstrapV8'
import { CUTOVER_BACKUP_V8_PREFIX } from './cutoverBackupV8'
import { V8_ROLLBACK_ARCHIVE_PREFIX } from './rollbackArchiveV8'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY, loadAppDataV8Only } from './storageV8'
import { createInitialAppDataV8 } from '../hooks/useAppDataV8'

const time = '2026-10-23T01:00:00.000Z'
function memory(entries: [string, string][] = []) {
  const values = new Map(entries)
  return { values, get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }) }
}
function locks(request?: (operation: (lock: unknown) => Promise<unknown>) => Promise<unknown>) {
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
    operation: (lock: unknown) => Promise<unknown>) => request ? request(operation) : operation({}) } })
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
beforeEach(() => locks())

describe('V8-only empty bootstrap', () => {
  it('creates a validated empty document and verified active evidence under one Web Lock', async () => {
    const store = memory()
    const before = preflightEmptyV8Bootstrap(store)
    expect(before).toMatchObject({ canBootstrap: true, issues: [] })
    expect(store.setItem).not.toHaveBeenCalled()
    const result = await bootstrapEmptyV8(store, { attemptId: 'fresh-1', createdAt: time })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.digest).toBe(await fingerprintV7Raw(result.receipt.raw))
    expect(result.receipt.metadata).toMatchObject({ kind: 'empty-bootstrap', status: 'active',
      attemptId: 'fresh-1', documentRevision: 0, initialDigest: result.receipt.digest,
      currentDigest: result.receipt.digest })
    expect(isV8BootstrapMetadata(result.receipt.metadata)).toBe(true)
    expect(isV8BootstrapMetadata({ ...result.receipt.metadata, schemaVersion: 9 })).toBe(false)
    expect(isV8BootstrapMetadata({ ...result.receipt.metadata, kind: 'cutover' })).toBe(false)
    expect(isV8BootstrapMetadata({ ...result.receipt.metadata, attemptId: '' })).toBe(false)
    expect(isV8BootstrapMetadata({ ...result.receipt.metadata, currentDigest: 'sha256:wrong' })).toBe(false)
    expect(isV8BootstrapMetadata({ ...result.receipt.metadata, documentRevision: -1 })).toBe(false)
    expect(isV8BootstrapMetadata({ ...result.receipt.metadata, activatedAt: null })).toBe(false)
    expect(isV8BootstrapMetadata({ ...result.receipt.metadata, status: 'interrupted' })).toBe(false)
    expect(store.setItem.mock.calls.map(([key]) => key)).toEqual([V8_BOOTSTRAP_KEY, APP_DATA_V8_KEY, V8_BOOTSTRAP_KEY])
    expect(JSON.parse(result.receipt.raw)).toMatchObject({ schemaVersion: 8, projects: [], subjects: [],
      timetables: [], events: [], teachingProgress: [] })
    expect(loadAppDataV8Only(store, createInitialAppDataV8()).status).toBe('bootstrap-active')
    expect((await bootstrapEmptyV8(store, { attemptId: 'fresh-1' }))).toMatchObject({ ok: false, code: 'bootstrap-active' })
    expect(store.setItem).toHaveBeenCalledTimes(3)
  })

  it('fails closed for V7, every other legacy generation, existing V8 and activation records', async () => {
    const cases: [string, string, string][] = [
      [APP_DATA_V7_KEY, '{}', 'legacy-v7-present'],
      ['aster-timetable-data-v6', '{}', 'legacy-present'],
      ['aster-timetable-data-v5', '{}', 'legacy-present'],
      ['aster-timetable-data-v4', '{}', 'legacy-present'],
      ['aster-timetable-data-v3', '{}', 'legacy-present'],
      ['aster-timetable-data-v1', '{}', 'legacy-present'],
      [APP_DATA_V8_KEY, JSON.stringify(createInitialAppDataV8()), 'existing-v8'],
      [APP_DATA_V8_KEY, '{broken', 'corrupt-v8'],
      [APP_DATA_V8_ACTIVATION_KEY, '{broken', 'unknown-metadata'],
      [V8_TRANSACTION_KEY, '{broken', 'unknown-metadata'],
      [V8_BOOTSTRAP_KEY, '{broken', 'unknown-metadata'],
    ]
    for (const [key, raw, code] of cases) {
      const store = memory([[key, raw]])
      expect(preflightEmptyV8Bootstrap(store).issues).toContain(code)
      expect(await bootstrapEmptyV8(store, { attemptId: 'blocked' })).toMatchObject({ ok: false, code })
      expect(store.setItem).not.toHaveBeenCalled()
      expect(store.values.get(key)).toBe(raw)
    }
  })

  it('blocks orphaned cutover backups and rollback archives without touching them', async () => {
    for (const prefix of [CUTOVER_BACKUP_V8_PREFIX, V8_ROLLBACK_ARCHIVE_PREFIX]) {
      const key = `${prefix}orphan`
      const store = memory([[key, 'exact raw']])
      expect(preflightEmptyV8Bootstrap(store)).toMatchObject({ canBootstrap: false,
        issues: ['orphaned-cutover-data'], orphanedCutoverKeys: [key] })
      expect(await bootstrapEmptyV8(store, { attemptId: 'blocked' })).toMatchObject({ ok: false,
        code: 'orphaned-cutover-data' })
      expect(store.values.get(key)).toBe('exact raw')
      expect(store.setItem).not.toHaveBeenCalled()
    }
  })

  it('requires Web Locks and rejects failed lock acquisition without any write', async () => {
    const store = memory()
    vi.stubGlobal('navigator', {})
    expect(await bootstrapEmptyV8(store, { attemptId: 'no-lock' })).toMatchObject({ ok: false, code: 'web-locks-unavailable' })
    locks(async () => { throw new Error('denied') })
    expect(await bootstrapEmptyV8(store, { attemptId: 'denied' })).toMatchObject({ ok: false, code: 'lock-failure' })
    locks(async (operation) => operation(null))
    expect(await bootstrapEmptyV8(store, { attemptId: 'null-lock' })).toMatchObject({ ok: false, code: 'web-locks-unavailable' })
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('rechecks all source keys after acquiring the same V8 storage lock', async () => {
    const store = memory()
    const request = vi.fn(async (name: string, _options: unknown, operation: (lock: unknown) => Promise<unknown>) => {
      expect(name).toBe('toki-v8-storage-transaction')
      store.values.set(APP_DATA_V7_KEY, 'late legacy write')
      return operation({})
    })
    vi.stubGlobal('navigator', { locks: { request } })
    expect(await bootstrapEmptyV8(store, { attemptId: 'late-source' })).toMatchObject({ ok: false, code: 'legacy-v7-present' })
    expect(request).toHaveBeenCalledWith('toki-v8-storage-transaction', { mode: 'exclusive' }, expect.any(Function))
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('preserves preparing or interrupted evidence when each write or readback fails', async () => {
    const cases: { stage: string; code: string; fail: (key: string, value: string) => boolean; silent?: boolean }[] = [
      { stage: 'prepare-write', code: 'preparing-write-failure', fail: (key) => key === V8_BOOTSTRAP_KEY },
      { stage: 'prepare-readback', code: 'preparing-readback-failure', fail: (key) => key === V8_BOOTSTRAP_KEY, silent: true },
      { stage: 'document-write', code: 'document-write-failure', fail: (key) => key === APP_DATA_V8_KEY },
      { stage: 'document-readback', code: 'document-readback-failure', fail: (key) => key === APP_DATA_V8_KEY, silent: true },
      { stage: 'active-write', code: 'active-write-failure', fail: (key, value) => key === V8_BOOTSTRAP_KEY && JSON.parse(value).status === 'active' },
      { stage: 'active-readback', code: 'active-readback-failure', fail: (key, value) => key === V8_BOOTSTRAP_KEY && JSON.parse(value).status === 'active', silent: true },
    ]
    for (const item of cases) {
      const store = memory()
      let failed = false
      store.setItem.mockImplementation((key, value) => {
        if (!failed && item.fail(key, value)) {
          failed = true
          if (item.silent) return
          throw new Error(item.stage)
        }
        store.values.set(key, value)
      })
      const result = await bootstrapEmptyV8(store, { attemptId: item.stage, createdAt: time })
      expect(result).toMatchObject({ ok: false, code: item.code })
      expect(loadV8BootstrapMetadata(store).value?.status).not.toBe('active')
      expect(preflightEmptyV8Bootstrap(store).canBootstrap).toBe(item.stage.startsWith('prepare-'))
    }
  })

  it('never automatically resumes interrupted or conflicting metadata', async () => {
    const store = memory()
    const result = await bootstrapEmptyV8(store, { attemptId: 'seed', createdAt: time })
    if (!result.ok) throw new Error('fixture failed')
    const interrupted = { ...result.receipt.metadata, status: 'interrupted', activatedAt: null,
      errorCode: 'document-write-failure' }
    store.values.set(V8_BOOTSTRAP_KEY, JSON.stringify(interrupted))
    expect(loadAppDataV8Only(store, createInitialAppDataV8()).status).toBe('bootstrap-interrupted')
    expect(await bootstrapEmptyV8(store, { attemptId: 'next' })).toMatchObject({ ok: false, code: 'bootstrap-interrupted' })
    store.values.set(V8_TRANSACTION_KEY, '{}')
    expect(loadAppDataV8Only(store, createInitialAppDataV8()).status).toBe('unknown-metadata')
  })
})

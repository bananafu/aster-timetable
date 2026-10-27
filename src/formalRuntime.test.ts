import { describe, expect, it, vi } from 'vitest'
import { V8_BOOTSTRAP_KEY } from './data/activationV8'
import { createEmptyAppDataV8 } from './data/storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_BACKUP_PREFIX, type V9ActivationRecord } from './data/storageV9'
import { inspectFormalRuntime, isV9RuntimeStorageKey, toFormalV9HostPort } from './formalRuntime'
import type { V9Host } from './hooks/useAppDataV9'

const digest = `sha256:${'b'.repeat(64)}` as const
const document = JSON.stringify({ ...createEmptyAppDataV8(), schemaVersion: 9 })
const metadata = (status: V9ActivationRecord['status']): V9ActivationRecord => ({
  schemaVersion: 1, kind: 'timetable-subject-upgrade', attemptId: 'runtime-test', status,
  sourceV8Digest: digest, sourceActivationKey: V8_BOOTSTRAP_KEY,
  sourceActivationDigest: digest, sourceV7Digest: null,
  backupKey: `${V9_BACKUP_PREFIX}runtime-test`, initialDigest: digest, currentDigest: digest,
  documentRevision: 0, createdAt: '2026-10-26T00:00:00.000Z',
  updatedAt: '2026-10-26T00:00:00.000Z',
  activatedAt: status === 'active' ? '2026-10-26T00:00:00.000Z' : null,
})
const storage = (entries: [string, string][] = []) => {
  const values = new Map(entries)
  return {
    get length() { return values.size },
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
  }
}

describe('formal Runtime boundary', () => {
  it('selects V7 only when all V9 evidence is absent', () => {
    expect(inspectFormalRuntime(storage())).toEqual({ runtime: 'v7', v9Status: 'absent' })
  })

  it.each([
    ['active', true], ['preparing', true], ['interrupted', true], ['active', false],
  ] as const)('blocks V7 for %s V9 metadata with document=%s', (status, withDocument) => {
    const entries: [string, string][] = [[V9_ACTIVATION_KEY, JSON.stringify(metadata(status))]]
    if (withDocument) entries.push([APP_DATA_V9_KEY, document])
    expect(inspectFormalRuntime(storage(entries)).runtime).toBe('blocked-v9')
  })

  it('blocks corrupt, orphaned and unknown V9 evidence without writing', () => {
    const corrupt = storage([[APP_DATA_V9_KEY, '{corrupt']])
    expect(inspectFormalRuntime(corrupt).runtime).toBe('blocked-v9')
    const orphan = storage([[`${V9_BACKUP_PREFIX}orphan`, '{}']])
    expect(inspectFormalRuntime(orphan)).toEqual({ runtime: 'blocked-v9', v9Status: 'unknown-evidence' })
    const unknown = storage([[`${APP_DATA_V9_KEY}-future`, '{}']])
    expect(inspectFormalRuntime(unknown)).toEqual({ runtime: 'blocked-v9', v9Status: 'unknown-evidence' })
  })

  it('fails closed when V9 evidence cannot be inspected', () => {
    expect(inspectFormalRuntime({ getItem: () => { throw new Error('denied') }, key: () => null, length: 0 }))
      .toEqual({ runtime: 'blocked-v9', v9Status: 'read-error' })
  })

  it('recognizes only V9-related storage events and maps no mutation outside host.update', () => {
    expect(isV9RuntimeStorageKey(APP_DATA_V9_KEY)).toBe(true)
    expect(isV9RuntimeStorageKey(V9_ACTIVATION_KEY)).toBe(true)
    expect(isV9RuntimeStorageKey(`${V9_BACKUP_PREFIX}x`)).toBe(true)
    expect(isV9RuntimeStorageKey('aster-timetable-data-v7')).toBe(false)
    const update = vi.fn() as unknown as V9Host['update']
    const host = { data: null, status: 'active', writable: false, pending: false, receipt: null,
      revision: 3, errorCode: null, update } as V9Host
    const port = toFormalV9HostPort(host)
    expect(port).toMatchObject({ document: null, status: 'active', writable: false, revision: 3 })
    expect(port.update).toBe(update)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { fingerprintV7Raw, V8_BOOTSTRAP_KEY } from './data/activationV8'
import { APP_DATA_V8_KEY, createEmptyAppDataV8 } from './data/storageV8'
import {
  APP_DATA_V9_KEY,
  V9_ACTIVATION_KEY,
  V9_BACKUP_PREFIX,
  type V9ActivationRecord,
  type V9BackupRecord,
} from './data/storageV9'
import {
  hasActiveFormalV9Structure,
  inspectFormalRuntime,
  isV9RuntimeStorageKey,
  toFormalV9HostPort,
} from './formalRuntime'
import type { V9Host } from './hooks/useAppDataV9'

const document = JSON.stringify({ ...createEmptyAppDataV8(), schemaVersion: 9 })
const createdAt = '2026-10-26T00:00:00.000Z'

const storage = (entries: [string, string][] = []) => {
  const values = new Map(entries)
  return {
    get length() {
      return values.size
    },
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => [...values.keys()][index] ?? null),
  }
}

async function activeEvidence() {
  const sourceV8Raw = JSON.stringify(createEmptyAppDataV8())
  const sourceActivationRaw = JSON.stringify({ kind: 'empty-bootstrap-source' })
  const sourceV8Digest = await fingerprintV7Raw(sourceV8Raw)
  const sourceActivationDigest = await fingerprintV7Raw(sourceActivationRaw)
  const candidateDigest = await fingerprintV7Raw(document)
  const backupKey = `${V9_BACKUP_PREFIX}runtime-test`
  const metadata: V9ActivationRecord = {
    schemaVersion: 1,
    kind: 'timetable-subject-upgrade',
    attemptId: 'runtime-test',
    status: 'active',
    sourceV8Digest,
    sourceActivationKey: V8_BOOTSTRAP_KEY,
    sourceActivationDigest,
    sourceV7Digest: null,
    backupKey,
    initialDigest: candidateDigest,
    currentDigest: candidateDigest,
    documentRevision: 0,
    createdAt,
    updatedAt: createdAt,
    activatedAt: createdAt,
  }
  const backup: V9BackupRecord = {
    schemaVersion: 1,
    kind: 'timetable-subject-upgrade-backup',
    attemptId: 'runtime-test',
    sourceV8Key: APP_DATA_V8_KEY,
    sourceV8Raw,
    sourceV8Digest,
    sourceActivationKey: V8_BOOTSTRAP_KEY,
    sourceActivationRaw,
    sourceActivationDigest,
    sourceV7Digest: null,
    candidateRaw: document,
    candidateDigest,
    decisions: [],
    createdAt,
  }
  return {
    metadata,
    backupKey,
    entries: [
      [APP_DATA_V8_KEY, sourceV8Raw],
      [V8_BOOTSTRAP_KEY, sourceActivationRaw],
      [APP_DATA_V9_KEY, document],
      [V9_ACTIVATION_KEY, JSON.stringify(metadata)],
      [backupKey, JSON.stringify(backup)],
    ] as [string, string][],
  }
}

describe('formal Runtime boundary', () => {
  it('selects V7 only when all V9 evidence is absent', async () => {
    expect(await inspectFormalRuntime(storage())).toEqual({
      runtime: 'v7',
      v9Status: 'absent',
    })
  })

  it('selects V9 only for complete active evidence', async () => {
    const evidence = await activeEvidence()
    const store = storage(evidence.entries)

    expect(hasActiveFormalV9Structure(store)).toBe(true)
    expect(await inspectFormalRuntime(store)).toEqual({
      runtime: 'v9',
      v9Status: 'active',
    })
  })

  it.each(['preparing', 'interrupted'] as const)(
    'blocks %s V9 metadata',
    async (status) => {
      const evidence = await activeEvidence()
      const metadata: V9ActivationRecord = {
        ...evidence.metadata,
        status,
        activatedAt: null,
      }
      const entries = evidence.entries.map(([key, raw]) =>
        key === V9_ACTIVATION_KEY
          ? ([key, JSON.stringify(metadata)] as [string, string])
          : ([key, raw] as [string, string]),
      )

      expect((await inspectFormalRuntime(storage(entries))).runtime).toBe(
        'blocked-v9',
      )
    },
  )

  it('blocks incomplete or invalid active evidence', async () => {
    const evidence = await activeEvidence()
    const missingBackup = evidence.entries.filter(
      ([key]) => key !== evidence.backupKey,
    )
    expect(await inspectFormalRuntime(storage(missingBackup))).toEqual({
      runtime: 'blocked-v9',
      v9Status: 'invalid-evidence',
    })

    const withoutDocument = evidence.entries.filter(
      ([key]) => key !== APP_DATA_V9_KEY,
    )
    expect((await inspectFormalRuntime(storage(withoutDocument))).runtime).toBe(
      'blocked-v9',
    )

    const changedSource = evidence.entries.map(([key, raw]) =>
      key === APP_DATA_V8_KEY
        ? ([key, `${raw} `] as [string, string])
        : ([key, raw] as [string, string]),
    )
    expect(await inspectFormalRuntime(storage(changedSource))).toEqual({
      runtime: 'blocked-v9',
      v9Status: 'invalid-evidence',
    })

    const unknownBackup = [
      ...evidence.entries,
      [`${V9_BACKUP_PREFIX}unexpected`, '{}'] as [string, string],
    ]
    expect(await inspectFormalRuntime(storage(unknownBackup))).toEqual({
      runtime: 'blocked-v9',
      v9Status: 'invalid-evidence',
    })
  })

  it('blocks corrupt, orphaned and unknown V9 evidence without writing', async () => {
    const corrupt = storage([[APP_DATA_V9_KEY, '{corrupt']])
    expect((await inspectFormalRuntime(corrupt)).runtime).toBe('blocked-v9')

    const orphan = storage([[`${V9_BACKUP_PREFIX}orphan`, '{}']])
    expect(await inspectFormalRuntime(orphan)).toEqual({
      runtime: 'blocked-v9',
      v9Status: 'unknown-evidence',
    })

    const unknown = storage([[`${APP_DATA_V9_KEY}-future`, '{}']])
    expect(await inspectFormalRuntime(unknown)).toEqual({
      runtime: 'blocked-v9',
      v9Status: 'unknown-evidence',
    })
  })

  it('fails closed when V9 evidence cannot be inspected', async () => {
    expect(
      await inspectFormalRuntime({
        getItem: () => {
          throw new Error('denied')
        },
        key: () => null,
        length: 0,
      }),
    ).toEqual({ runtime: 'blocked-v9', v9Status: 'read-error' })
  })

  it('recognizes only V9-related storage events and maps no mutation outside host.update', () => {
    expect(isV9RuntimeStorageKey(APP_DATA_V9_KEY)).toBe(true)
    expect(isV9RuntimeStorageKey(V9_ACTIVATION_KEY)).toBe(true)
    expect(isV9RuntimeStorageKey(`${V9_BACKUP_PREFIX}x`)).toBe(true)
    expect(isV9RuntimeStorageKey('aster-timetable-data-v7')).toBe(false)

    const update = vi.fn() as unknown as V9Host['update']
    const host = {
      data: null,
      status: 'active',
      writable: false,
      pending: false,
      receipt: null,
      revision: 3,
      errorCode: null,
      update,
    } as V9Host
    const port = toFormalV9HostPort(host)

    expect(port).toMatchObject({
      document: null,
      status: 'active',
      writable: false,
      revision: 3,
    })
    expect(port.update).toBe(update)
  })
})

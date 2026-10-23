import {
  APP_DATA_V8_ACTIVATION_KEY, V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY,
  fingerprintV7Raw, isV8BootstrapMetadata, type V8BootstrapMetadata,
} from './activationV8'
import { CUTOVER_BACKUP_V8_PREFIX } from './cutoverBackupV8'
import { V8_ROLLBACK_ARCHIVE_PREFIX } from './rollbackArchiveV8'
import { APP_DATA_V8_KEY, createEmptyAppDataV8, loadAppDataV8Only, TOKI_LEGACY_DATA_KEYS, type V8OnlyLoadStatus } from './storageV8'
import { isCompatibleAppDataV8 } from './validators/v8'
import { withV8StorageLock } from './v8Coordination'

type BootstrapReadStorage = Pick<Storage, 'getItem' | 'key' | 'length'>
type BootstrapStorage = BootstrapReadStorage & Pick<Storage, 'setItem'>
export type V8BootstrapIssue = V8OnlyLoadStatus | 'web-locks-unavailable' | 'invalid-attempt'
  | 'invalid-candidate' | 'digest-failure' | 'source-changed' | 'preparing-write-failure'
  | 'preparing-readback-failure' | 'document-write-failure' | 'document-readback-failure'
  | 'active-write-failure' | 'active-readback-failure' | 'lock-failure' | 'orphaned-cutover-data'
export interface V8BootstrapPreflight {
  canBootstrap: boolean
  issues: V8BootstrapIssue[]
  rawV8: string | null
  rawV7: string | null
  rawBootstrap: string | null
  rawActivationV1: string | null
  rawTransactionV2: string | null
  legacyKeys: string[]
  orphanedCutoverKeys: string[]
}
export type V8BootstrapResult =
  | { ok: true; receipt: { attemptId: string; raw: string; digest: `sha256:${string}`; documentRevision: 0;
      metadata: V8BootstrapMetadata } }
  | { ok: false; code: V8BootstrapIssue; preflight: V8BootstrapPreflight; rawV8: string | null;
      rawBootstrap: string | null }

function orphanedCutoverKeys(storage: BootstrapReadStorage): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key === null) throw new Error('Storage enumeration changed')
    if (key.startsWith(CUTOVER_BACKUP_V8_PREFIX) || key.startsWith(V8_ROLLBACK_ARCHIVE_PREFIX)) keys.push(key)
  }
  return keys
}

/** Read-only assessment; availability is not a substitute for holding a lock. */
export function preflightEmptyV8Bootstrap(storage: BootstrapReadStorage): V8BootstrapPreflight {
  const loaded = loadAppDataV8Only(storage, createEmptyAppDataV8())
  const issues: V8BootstrapIssue[] = []
  let orphaned: string[] = []
  try { orphaned = orphanedCutoverKeys(storage) }
  catch { issues.push('read-error') }
  if (typeof navigator === 'undefined' || !navigator.locks?.request) issues.push('web-locks-unavailable')
  if (loaded.status !== 'fresh') issues.push(loaded.status)
  if (orphaned.length) issues.push('orphaned-cutover-data')
  return { canBootstrap: issues.length === 0, issues, rawV8: loaded.rawV8,
    rawV7: loaded.rawV7, rawBootstrap: loaded.rawBootstrap, rawActivationV1: loaded.rawActivationV1,
    rawTransactionV2: loaded.rawTransactionV2, legacyKeys: loaded.legacyKeys, orphanedCutoverKeys: orphaned }
}

function unchanged(storage: BootstrapReadStorage, bootstrapRaw: string | null, v8Raw: string | null): boolean {
  try {
    return storage.getItem(V8_BOOTSTRAP_KEY) === bootstrapRaw
      && storage.getItem(APP_DATA_V8_KEY) === v8Raw
      && storage.getItem(APP_DATA_V8_ACTIVATION_KEY) === null
      && storage.getItem(V8_TRANSACTION_KEY) === null
      && TOKI_LEGACY_DATA_KEYS.every((key) => storage.getItem(key) === null)
      && orphanedCutoverKeys(storage).length === 0
  } catch { return false }
}

function snapshot(storage: Pick<Storage, 'getItem'>): { rawV8: string | null; rawBootstrap: string | null } {
  try { return { rawV8: storage.getItem(APP_DATA_V8_KEY), rawBootstrap: storage.getItem(V8_BOOTSTRAP_KEY) } }
  catch { return { rawV8: null, rawBootstrap: null } }
}

/** A failed write never deletes or replaces an earlier document or recovery record. */
export async function bootstrapEmptyV8(
  storage: BootstrapStorage,
  input: { attemptId: string; createdAt?: string },
): Promise<V8BootstrapResult> {
  const first = preflightEmptyV8Bootstrap(storage)
  const fail = (code: V8BootstrapIssue, preflight = first): V8BootstrapResult => ({ ok: false, code, preflight, ...snapshot(storage) })
  if (!first.canBootstrap) return fail(first.issues[0])
  try {
    return await withV8StorageLock(async () => {
      const locked = preflightEmptyV8Bootstrap(storage)
      if (!locked.canBootstrap) return fail(locked.issues[0], locked)
      const candidate = createEmptyAppDataV8()
      if (!isCompatibleAppDataV8(candidate)) return fail('invalid-candidate', locked)
      const raw = JSON.stringify(candidate)
      let digest: `sha256:${string}`
      try { digest = await fingerprintV7Raw(raw) } catch { return fail('digest-failure', locked) }
      const createdAt = input.createdAt ?? new Date().toISOString()
      const preparing: V8BootstrapMetadata = {
        schemaVersion: 1, kind: 'empty-bootstrap', attemptId: input.attemptId, status: 'preparing',
        initialDigest: digest, currentDigest: digest, documentRevision: 0,
        createdAt, updatedAt: createdAt, activatedAt: null, errorCode: null,
      }
      if (!isV8BootstrapMetadata(preparing)) return fail('invalid-attempt', locked)
      if (!unchanged(storage, null, null)) return fail('source-changed', locked)
      const preparingRaw = JSON.stringify(preparing)
      try { storage.setItem(V8_BOOTSTRAP_KEY, preparingRaw) }
      catch { return fail('preparing-write-failure', locked) }
      try { if (storage.getItem(V8_BOOTSTRAP_KEY) !== preparingRaw) return fail('preparing-readback-failure', locked) }
      catch { return fail('preparing-readback-failure', locked) }
      const interrupt = (code: V8BootstrapIssue): V8BootstrapResult => {
        try {
          if (storage.getItem(V8_BOOTSTRAP_KEY) === preparingRaw) {
            const interrupted = { ...preparing, status: 'interrupted' as const,
              updatedAt: new Date(Math.max(Date.now(), Date.parse(createdAt))).toISOString(), errorCode: code }
            const interruptedRaw = JSON.stringify(interrupted)
            storage.setItem(V8_BOOTSTRAP_KEY, interruptedRaw)
            if (storage.getItem(V8_BOOTSTRAP_KEY) !== interruptedRaw) return fail(code, locked)
          }
        } catch { /* Preparing is itself a durable, read-only recovery state. */ }
        return fail(code, locked)
      }
      if (!unchanged(storage, preparingRaw, null)) return interrupt('source-changed')
      try { storage.setItem(APP_DATA_V8_KEY, raw) }
      catch { return interrupt('document-write-failure') }
      try { if (storage.getItem(APP_DATA_V8_KEY) !== raw) return interrupt('document-readback-failure') }
      catch { return interrupt('document-readback-failure') }
      if (!unchanged(storage, preparingRaw, raw)) return interrupt('source-changed')
      const activatedAt = new Date(Math.max(Date.now(), Date.parse(createdAt))).toISOString()
      const active: V8BootstrapMetadata = { ...preparing, status: 'active', activatedAt, updatedAt: activatedAt }
      if (!isV8BootstrapMetadata(active)) return interrupt('invalid-attempt')
      const activeRaw = JSON.stringify(active)
      try { storage.setItem(V8_BOOTSTRAP_KEY, activeRaw) }
      catch { return interrupt('active-write-failure') }
      try { if (storage.getItem(V8_BOOTSTRAP_KEY) !== activeRaw) return fail('active-readback-failure', locked) }
      catch { return fail('active-readback-failure', locked) }
      if (!unchanged(storage, activeRaw, raw)) return fail('source-changed', locked)
      return { ok: true, receipt: { attemptId: input.attemptId, raw, digest, documentRevision: 0, metadata: active } }
    })
  } catch (cause) { return fail(cause instanceof Error && cause.message === 'lock-unavailable' ? 'web-locks-unavailable' : 'lock-failure') }
}

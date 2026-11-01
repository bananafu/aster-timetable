import { inspectFormalRuntime } from '../formalRuntime'
import { APP_DATA_V8_ACTIVATION_KEY, fingerprintV7Raw, V8_BOOTSTRAP_KEY,
  V8_TRANSACTION_KEY } from './activationV8'
import { APP_DATA_V8_KEY, TOKI_LEGACY_DATA_KEYS } from './storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_BACKUP_PREFIX,
  checkV9WriteEvidence, createEmptyAppDataV9, isV9ActivationRecord,
  isV9FreshBackupRecord, type V9FreshActivationRecord, type V9FreshBackupRecord } from './storageV9'
import { isCompatibleAppDataV9 } from './validators/v9'
import { withV8StorageLock } from './v8Coordination'

type ReadStorage = Pick<Storage, 'getItem' | 'key' | 'length'>
type StorageAccess = ReadStorage & Pick<Storage, 'setItem'>
export type FreshV9Failure = 'invalid-input' | 'existing-evidence' | 'read-error' | 'lock-unavailable'
  | 'invalid-candidate' | 'digest-failed' | 'source-changed' | 'backup-failed'
  | 'preparing-failed' | 'document-failed' | 'active-failed'
export type FreshV9Result = { ok: true; metadata: V9FreshActivationRecord; rawDocument: string;
  backupKey: string } | { ok: false; code: FreshV9Failure; backupKey: string | null }

const knownKeys = [...TOKI_LEGACY_DATA_KEYS, APP_DATA_V8_KEY, APP_DATA_V8_ACTIVATION_KEY,
  V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY, APP_DATA_V9_KEY, V9_ACTIVATION_KEY]

/** No application evidence may be hidden behind an older or unknown Toki key. */
function matchesEvidence(storage: ReadStorage, allowed: ReadonlySet<string>): boolean {
  if (knownKeys.some((key) => !allowed.has(key) && storage.getItem(key) !== null)) return false
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key === null) throw new Error('storage-enumeration-failed')
    if ((key.startsWith('aster-timetable-') || key.startsWith('toki-v9-')) && !allowed.has(key)) return false
  }
  return true
}

export function preflightFreshV9(storage: ReadStorage):
  { eligible: boolean; issue: 'none' | 'existing-evidence' | 'read-error' } {
  try {
    return matchesEvidence(storage, new Set())
      ? { eligible: true, issue: 'none' } : { eligible: false, issue: 'existing-evidence' }
  } catch { return { eligible: false, issue: 'read-error' } }
}

/** Explicit fresh initialization. No V7/V8 key is ever created or modified. */
export async function initializeFreshV9(storage: StorageAccess,
  input: { attemptId: string; createdAt: string }): Promise<FreshV9Result> {
  const backupKey = `${V9_BACKUP_PREFIX}${input.attemptId}`
  const fail = (code: FreshV9Failure, key: string | null = null): FreshV9Result =>
    ({ ok: false, code, backupKey: key })
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.attemptId)) return fail('invalid-input')
  const initial = preflightFreshV9(storage)
  if (!initial.eligible) return fail(initial.issue === 'read-error' ? 'read-error' : 'existing-evidence')
  try {
    return await withV8StorageLock(async () => {
      const locked = preflightFreshV9(storage)
      if (!locked.eligible) return fail(locked.issue === 'read-error' ? 'read-error' : 'existing-evidence')
      const candidate = createEmptyAppDataV9()
      if (!isCompatibleAppDataV9(candidate)) return fail('invalid-candidate')
      const candidateRaw = JSON.stringify(candidate)
      let candidateDigest: `sha256:${string}`
      try { candidateDigest = await fingerprintV7Raw(candidateRaw) }
      catch { return fail('digest-failed') }
      const backup: V9FreshBackupRecord = { schemaVersion: 1, kind: 'fresh-v9-initialization-backup',
        attemptId: input.attemptId, candidateRaw, candidateDigest, createdAt: input.createdAt }
      const preparing: V9FreshActivationRecord = { schemaVersion: 1, kind: 'fresh-v9-initialization',
        attemptId: input.attemptId, status: 'preparing', backupKey,
        initialDigest: candidateDigest, currentDigest: candidateDigest, documentRevision: 0,
        createdAt: input.createdAt, updatedAt: input.createdAt, activatedAt: null }
      if (!isV9FreshBackupRecord(backup) || !isV9ActivationRecord(preparing)) return fail('invalid-input')
      const backupRaw = JSON.stringify(backup)
      try {
        if (!matchesEvidence(storage, new Set())) return fail('source-changed')
        storage.setItem(backupKey, backupRaw)
        const readback = storage.getItem(backupKey)
        if (readback !== backupRaw || !isV9FreshBackupRecord(JSON.parse(readback))
          || await fingerprintV7Raw(backup.candidateRaw) !== backup.candidateDigest) return fail('backup-failed', backupKey)
      } catch { return fail('backup-failed', backupKey) }
      const preparingRaw = JSON.stringify(preparing)
      try {
        if (!matchesEvidence(storage, new Set([backupKey]))
          || storage.getItem(backupKey) !== backupRaw) return fail('source-changed', backupKey)
        storage.setItem(V9_ACTIVATION_KEY, preparingRaw)
        if (storage.getItem(V9_ACTIVATION_KEY) !== preparingRaw) return fail('preparing-failed', backupKey)
      } catch { return fail('preparing-failed', backupKey) }
      try {
        if (!matchesEvidence(storage, new Set([backupKey, V9_ACTIVATION_KEY]))
          || storage.getItem(backupKey) !== backupRaw
          || storage.getItem(V9_ACTIVATION_KEY) !== preparingRaw) return fail('source-changed', backupKey)
        storage.setItem(APP_DATA_V9_KEY, candidateRaw)
        if (storage.getItem(APP_DATA_V9_KEY) !== candidateRaw) return fail('document-failed', backupKey)
      } catch { return fail('document-failed', backupKey) }
      const active: V9FreshActivationRecord = { ...preparing, status: 'active', activatedAt: input.createdAt }
      try {
        if (!isV9ActivationRecord(active)
          || !matchesEvidence(storage, new Set([backupKey, V9_ACTIVATION_KEY, APP_DATA_V9_KEY]))
          || storage.getItem(backupKey) !== backupRaw
          || storage.getItem(V9_ACTIVATION_KEY) !== preparingRaw
          || storage.getItem(APP_DATA_V9_KEY) !== candidateRaw) return fail('source-changed', backupKey)
        const activeRaw = JSON.stringify(active)
        storage.setItem(V9_ACTIVATION_KEY, activeRaw)
        if (!(await checkV9WriteEvidence(storage, candidateRaw, activeRaw))
          || (await inspectFormalRuntime(storage)).runtime !== 'v9') return fail('active-failed', backupKey)
      } catch { return fail('active-failed', backupKey) }
      return { ok: true, metadata: active, rawDocument: candidateRaw, backupKey }
    })
  } catch { return fail('lock-unavailable') }
}

import { fingerprintV7Raw, loadV8Transaction, type V8ActivationTransaction } from './activationV8'
import type { SourceIdentityV8 } from './cutoverBackupV8'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY, parseAppDataV8Raw } from './storageV8'
import { withV8StorageLock } from './v8Coordination'

export const V8_ROLLBACK_ARCHIVE_PREFIX = 'aster-timetable-v8-rollback-archive:'
export interface V8RollbackArchiveRecord {
  schemaVersion: 2
  archiveId: string
  transactionId: string
  lineage: { source: SourceIdentityV8; backupId: string; candidateDigest: `sha256:${string}` }
  rawV8: string
  digest: `sha256:${string}`
  documentRevision: number
  archivedAt: string
  validationStatus: 'verified'
}
export type V8ArchiveFailure = 'invalid-id' | 'invalid-time' | 'missing-v8' | 'corrupt-v8'
  | 'activation-invalid' | 'digest-mismatch' | 'already-exists' | 'read-failure'
  | 'write-failure' | 'readback-failure' | 'readback-mismatch' | 'source-changed'
  | 'lock-unavailable'
export type V8ArchiveResult = { ok: true; key: string; raw: string; record: V8RollbackArchiveRecord }
  | { ok: false; code: V8ArchiveFailure; key: string; rescueRawV8: string | null }
type ArchiveStorage = Pick<Storage, 'getItem' | 'setItem'>

const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
const validDigest = (value: unknown) => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
const validTime = (value: unknown) => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
const sameSource = (left: SourceIdentityV8, right: SourceIdentityV8) => left.type === right.type
  && (left.type === 'empty' || (right.type === 'v7' && left.key === right.key && left.digest === right.digest))
const failure = (code: V8ArchiveFailure, key: string, rescueRawV8: string | null): V8ArchiveResult =>
  ({ ok: false, code, key, rescueRawV8 })

/** Exact rescue export is independent of archive verification and Web Locks. */
export function readV8RescueRaw(storage: Pick<Storage, 'getItem'>):
  { ok: true; raw: string } | { ok: false; code: 'missing-v8' | 'read-failure' } {
  try {
    const raw = storage.getItem(APP_DATA_V8_KEY)
    return raw === null ? { ok: false, code: 'missing-v8' } : { ok: true, raw }
  } catch { return { ok: false, code: 'read-failure' } }
}

export async function verifyV8RollbackArchive(raw: string): Promise<V8RollbackArchiveRecord | 'invalid-record' | 'digest-mismatch'> {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return 'invalid-record' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid-record'
  const record = value as V8RollbackArchiveRecord
  if (Object.keys(record).length !== 9 || record.schemaVersion !== 2 || !validId(record.archiveId)
    || !validId(record.transactionId) || !record.lineage || typeof record.lineage !== 'object'
    || Object.keys(record.lineage).length !== 3 || !validId(record.lineage.backupId)
    || !validDigest(record.lineage.candidateDigest) || !record.lineage.source
    || (record.lineage.source.type === 'empty' ? Object.keys(record.lineage.source).length !== 1
      : record.lineage.source.type !== 'v7' || record.lineage.source.key !== APP_DATA_V7_KEY
        || !validDigest(record.lineage.source.digest) || Object.keys(record.lineage.source).length !== 3)
    || typeof record.rawV8 !== 'string' || !validDigest(record.digest)
    || !Number.isSafeInteger(record.documentRevision) || record.documentRevision < 0
    || !validTime(record.archivedAt) || record.validationStatus !== 'verified') return 'invalid-record'
  try {
    parseAppDataV8Raw(record.rawV8)
    return await fingerprintV7Raw(record.rawV8) === record.digest ? record : 'digest-mismatch'
  } catch { return 'invalid-record' }
}

export async function createV8RollbackArchive(
  storage: ArchiveStorage, input: { archiveId: string; archivedAt: string },
): Promise<V8ArchiveResult> {
  try { return await withV8StorageLock(() => createV8RollbackArchiveWithinLock(storage, input)) }
  catch { return failure('lock-unavailable', `${V8_ROLLBACK_ARCHIVE_PREFIX}${input.archiveId}`, null) }
}

async function createV8RollbackArchiveWithinLock(
  storage: ArchiveStorage, input: { archiveId: string; archivedAt: string },
): Promise<V8ArchiveResult> {
  const key = `${V8_ROLLBACK_ARCHIVE_PREFIX}${input.archiveId}`
  if (!validId(input.archiveId)) return failure('invalid-id', key, null)
  if (!validTime(input.archivedAt)) return failure('invalid-time', key, null)
  let v8Raw: string | null = null
  let transactionRaw: string | null = null
  try {
    v8Raw = storage.getItem(APP_DATA_V8_KEY)
    transactionRaw = loadV8Transaction(storage).raw
    if (storage.getItem(key) !== null) return failure('already-exists', key, v8Raw)
  } catch { return failure('read-failure', key, v8Raw) }
  if (v8Raw === null) return failure('missing-v8', key, null)
  try { parseAppDataV8Raw(v8Raw) } catch { return failure('corrupt-v8', key, v8Raw) }
  const loaded = loadV8Transaction(storage)
  const transaction = loaded.value
  if (loaded.issue !== 'none' || !transaction || !['active', 'rollback-recovery'].includes(transaction.status)) {
    return failure('activation-invalid', key, v8Raw)
  }
  let digest: `sha256:${string}`
  try { digest = await fingerprintV7Raw(v8Raw) } catch { return failure('read-failure', key, v8Raw) }
  if (digest !== transaction.currentDigest) return failure('digest-mismatch', key, v8Raw)
  try {
    if (storage.getItem(APP_DATA_V8_KEY) !== v8Raw || loadV8Transaction(storage).raw !== transactionRaw
      || storage.getItem(key) !== null) return failure('source-changed', key, v8Raw)
  } catch { return failure('read-failure', key, v8Raw) }
  const record: V8RollbackArchiveRecord = {
    schemaVersion: 2, archiveId: input.archiveId, transactionId: transaction.transactionId,
    lineage: { source: transaction.source, backupId: transaction.backup.id,
      candidateDigest: transaction.candidateDigest },
    rawV8: v8Raw, digest, documentRevision: transaction.documentRevision,
    archivedAt: input.archivedAt, validationStatus: 'verified',
  }
  const raw = JSON.stringify(record)
  try { storage.setItem(key, raw) } catch { return failure('write-failure', key, v8Raw) }
  let readback: string | null
  try { readback = storage.getItem(key) } catch { return failure('readback-failure', key, v8Raw) }
  if (readback !== raw) return failure('readback-mismatch', key, v8Raw)
  if (typeof await verifyV8RollbackArchive(readback) === 'string') return failure('readback-mismatch', key, v8Raw)
  try {
    if (storage.getItem(APP_DATA_V8_KEY) !== v8Raw || loadV8Transaction(storage).raw !== transactionRaw) {
      return failure('source-changed', key, v8Raw)
    }
  } catch { return failure('readback-failure', key, v8Raw) }
  return { ok: true, key, raw, record }
}

export interface V8RollbackPlan {
  readyForManualRecovery: boolean
  archiveVerified: boolean
  archiveRevisionMatches: boolean
  sourceValid: boolean
  v8OnlyChanges: true | false | 'unknown'
  issues: ('missing-archive' | 'archive-invalid' | 'lineage-mismatch' | 'revision-mismatch'
    | 'source-changed' | 'activation-invalid' | 'v8-current-changed')[]
}

/** Planning only: no V7 writes, downgrade, deletion, or metadata transition. */
export async function planV8Rollback(storage: Pick<Storage, 'getItem'>, archiveKey: string): Promise<V8RollbackPlan> {
  const issues: V8RollbackPlan['issues'] = []
  const loaded = loadV8Transaction(storage)
  const transaction: V8ActivationTransaction | null = loaded.value
  if (!transaction || transaction.status !== 'rollback-recovery') issues.push('activation-invalid')
  let archive: V8RollbackArchiveRecord | null = null
  try {
    const raw = storage.getItem(archiveKey)
    if (raw === null) issues.push('missing-archive')
    else {
      const verified = await verifyV8RollbackArchive(raw)
      if (typeof verified === 'string') issues.push('archive-invalid')
      else archive = verified
    }
  } catch { issues.push('archive-invalid') }
  if (archive && transaction) {
    if (archiveKey !== `${V8_ROLLBACK_ARCHIVE_PREFIX}${archive.archiveId}`
      || archive.transactionId !== transaction.transactionId
      || archive.lineage.backupId !== transaction.backup.id
      || archive.lineage.candidateDigest !== transaction.candidateDigest
      || !sameSource(archive.lineage.source, transaction.source)) issues.push('lineage-mismatch')
    if (archive.documentRevision !== transaction.documentRevision || archive.digest !== transaction.currentDigest) issues.push('revision-mismatch')
    try { if (storage.getItem(APP_DATA_V8_KEY) !== archive.rawV8) issues.push('v8-current-changed') }
    catch { issues.push('v8-current-changed') }
  }
  let sourceValid = false
  try {
    const sourceRaw = storage.getItem(APP_DATA_V7_KEY)
    sourceValid = !!transaction && (transaction.source.type === 'empty' ? sourceRaw === null
      : sourceRaw !== null && await fingerprintV7Raw(sourceRaw) === transaction.source.digest)
  } catch { sourceValid = false }
  if (!sourceValid) issues.push('source-changed')
  const v8OnlyChanges = !transaction ? 'unknown' : transaction.documentRevision > 0 ? true
    : archive && archive.digest === transaction.candidateDigest ? false : 'unknown'
  return { readyForManualRecovery: issues.length === 0, archiveVerified: archive !== null,
    archiveRevisionMatches: !!archive && !!transaction && archive.documentRevision === transaction.documentRevision,
    sourceValid, v8OnlyChanges, issues }
}

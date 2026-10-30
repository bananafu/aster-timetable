import type { AppDataV9 } from '../types/v9'
import type { SubjectMigrationDecisionV9 } from './subjectMigrationCandidateV9'
import { fingerprintV7Raw, V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY } from './activationV8'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY } from './storageV8'
import { isCompatibleAppDataV9, isSafeAppDataV9Update } from './validators/v9'
import { withV8StorageLock } from './v8Coordination'

export const APP_DATA_V9_KEY = 'aster-timetable-data-v9'
export const V9_ACTIVATION_KEY = 'aster-timetable-data-v9-activation-v1'
export const V9_BACKUP_PREFIX = 'aster-timetable-v9-subject-backup:'
/** Separate from immutable activation backups and the formal runtime gate's activation evidence. */
export const V9_AUTO_BACKUP_PREFIX = 'toki-v9-auto-backup:'
export const V9_AUTO_BACKUP_LIMIT = 10
export type V9HighRiskOperation = 'delete-recurring-lesson' | 'permanently-update-lesson'
export interface V9PreMutationBackup {
  schemaVersion: 1
  kind: 'v9-pre-mutation-backup'
  mutationAttemptId: string
  operation: V9HighRiskOperation
  revision: number
  digest: `sha256:${string}`
  rawDocument: string
  createdAt: string
}
export interface V9PreMutationBackupEvidence {
  key: string
  mutationAttemptId: string
  operation: V9HighRiskOperation
  revision: number
  digest: `sha256:${string}`
  rawDocument: string
}
export type V9ActivationStatus = 'preparing' | 'active' | 'interrupted'

export interface V9ActivationRecord {
  schemaVersion: 1
  kind: 'timetable-subject-upgrade'
  attemptId: string
  status: V9ActivationStatus
  sourceV8Digest: `sha256:${string}`
  sourceActivationKey: typeof V8_BOOTSTRAP_KEY | typeof V8_TRANSACTION_KEY
  sourceActivationDigest: `sha256:${string}`
  sourceV7Digest: `sha256:${string}` | null
  backupKey: string
  initialDigest: `sha256:${string}`
  currentDigest: `sha256:${string}`
  documentRevision: number
  createdAt: string
  updatedAt: string
  activatedAt: string | null
}

export interface V9BackupRecord {
  schemaVersion: 1
  kind: 'timetable-subject-upgrade-backup'
  attemptId: string
  sourceV8Key: typeof APP_DATA_V8_KEY
  sourceV8Raw: string
  sourceV8Digest: `sha256:${string}`
  sourceActivationKey: typeof V8_BOOTSTRAP_KEY | typeof V8_TRANSACTION_KEY
  sourceActivationRaw: string
  sourceActivationDigest: `sha256:${string}`
  sourceV7Digest: `sha256:${string}` | null
  candidateRaw: string
  candidateDigest: `sha256:${string}`
  decisions: SubjectMigrationDecisionV9[]
  createdAt: string
}

const record = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === 'object' && !Array.isArray(value)
const digest = (value: unknown): value is `sha256:${string}` => typeof value === 'string'
  && /^sha256:[0-9a-f]{64}$/.test(value)
const iso = (value: unknown): value is string => typeof value === 'string'
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value

export function isV9ActivationRecord(value: unknown): value is V9ActivationRecord {
  if (!record(value) || Object.keys(value).length !== 15) return false
  return value.schemaVersion === 1 && value.kind === 'timetable-subject-upgrade'
    && typeof value.attemptId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.attemptId)
    && ['preparing', 'active', 'interrupted'].includes(value.status as string)
    && digest(value.sourceV8Digest)
    && [V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY].includes(value.sourceActivationKey as typeof V8_BOOTSTRAP_KEY)
    && digest(value.sourceActivationDigest)
    && (value.sourceV7Digest === null || digest(value.sourceV7Digest))
    && value.backupKey === `${V9_BACKUP_PREFIX}${value.attemptId}`
    && digest(value.initialDigest) && digest(value.currentDigest)
    && Number.isSafeInteger(value.documentRevision) && Number(value.documentRevision) >= 0
    && iso(value.createdAt) && iso(value.updatedAt) && value.updatedAt >= value.createdAt
    && (value.status === 'active' ? iso(value.activatedAt)
      && value.activatedAt >= value.createdAt && value.activatedAt <= value.updatedAt
      : value.activatedAt === null && value.documentRevision === 0
        && value.currentDigest === value.initialDigest)
}

export function parseAppDataV9Raw(raw: string): AppDataV9 {
  const value: unknown = JSON.parse(raw)
  if (!isCompatibleAppDataV9(value)) throw new Error('invalid-v9-document')
  return value
}

export type V9LoadStatus = 'absent' | 'preparing' | 'active' | 'interrupted'
  | 'corrupt-document' | 'corrupt-metadata' | 'inconsistent' | 'read-error'
export interface V9LoadResult {
  status: V9LoadStatus
  document: AppDataV9 | null
  metadata: V9ActivationRecord | null
  rawDocument: string | null
  rawMetadata: string | null
}

/** Inspection is read-only and never treats a partial transaction as writable. */
export function loadAppDataV9(storage: Pick<Storage, 'getItem'>): V9LoadResult {
  let rawDocument: string | null = null
  let rawMetadata: string | null = null
  const result = (status: V9LoadStatus, document: AppDataV9 | null = null,
    metadata: V9ActivationRecord | null = null): V9LoadResult => ({ status, document,
    metadata, rawDocument, rawMetadata })
  try {
    rawDocument = storage.getItem(APP_DATA_V9_KEY)
    rawMetadata = storage.getItem(V9_ACTIVATION_KEY)
  } catch { return result('read-error') }
  if (rawDocument === null && rawMetadata === null) return result('absent')
  let metadata: V9ActivationRecord
  try {
    const parsed: unknown = JSON.parse(rawMetadata ?? '')
    if (!isV9ActivationRecord(parsed)) return result('corrupt-metadata')
    metadata = parsed
  } catch { return result('corrupt-metadata') }
  if (rawDocument === null) return result(metadata.status === 'active' ? 'inconsistent' : metadata.status, null, metadata)
  let document: AppDataV9
  try { document = parseAppDataV9Raw(rawDocument) }
  catch { return result('corrupt-document', null, metadata) }
  return result(metadata.status, document, metadata)
}

export async function checkV9WriteEvidence(storage: Pick<Storage, 'getItem'>,
  expectedRaw: string, expectedMetadataRaw: string): Promise<boolean> {
  try {
    const loaded = loadAppDataV9(storage)
    if (loaded.status !== 'active' || loaded.rawDocument !== expectedRaw
      || loaded.rawMetadata !== expectedMetadataRaw || !loaded.metadata) return false
    const meta = loaded.metadata
    if (await fingerprintV7Raw(expectedRaw) !== meta.currentDigest) return false
    const backupRaw = storage.getItem(meta.backupKey)
    if (backupRaw === null) return false
    const backup: unknown = JSON.parse(backupRaw)
    if (!record(backup) || backup.schemaVersion !== 1
      || backup.kind !== 'timetable-subject-upgrade-backup'
      || backup.attemptId !== meta.attemptId || backup.sourceV8Key !== APP_DATA_V8_KEY
      || backup.sourceV8Digest !== meta.sourceV8Digest
      || backup.sourceActivationDigest !== meta.sourceActivationDigest
      || backup.sourceActivationKey !== meta.sourceActivationKey
      || backup.sourceV7Digest !== meta.sourceV7Digest
      || backup.createdAt !== meta.createdAt
      || backup.candidateDigest !== meta.initialDigest
      || typeof backup.sourceV8Raw !== 'string' || typeof backup.sourceActivationRaw !== 'string'
      || typeof backup.candidateRaw !== 'string' || !Array.isArray(backup.decisions)
      || await fingerprintV7Raw(backup.sourceV8Raw) !== meta.sourceV8Digest
      || await fingerprintV7Raw(backup.sourceActivationRaw) !== meta.sourceActivationDigest
      || await fingerprintV7Raw(backup.candidateRaw) !== meta.initialDigest) return false
    const v8Raw = storage.getItem(APP_DATA_V8_KEY)
    const activationRaw = storage.getItem(meta.sourceActivationKey)
    const v7Raw = storage.getItem(APP_DATA_V7_KEY)
    if (v8Raw === null || activationRaw === null
      || await fingerprintV7Raw(v8Raw) !== meta.sourceV8Digest
      || await fingerprintV7Raw(activationRaw) !== meta.sourceActivationDigest
      || (v7Raw === null ? null : await fingerprintV7Raw(v7Raw)) !== meta.sourceV7Digest
      || storage.getItem(APP_DATA_V9_KEY) !== expectedRaw
      || storage.getItem(V9_ACTIVATION_KEY) !== expectedMetadataRaw
      || storage.getItem(APP_DATA_V8_KEY) !== v8Raw
      || storage.getItem(meta.sourceActivationKey) !== activationRaw
      || storage.getItem(APP_DATA_V7_KEY) !== v7Raw) return false
    return true
  } catch { return false }
}

export type V9PersistenceErrorCode = 'invalid-current' | 'invalid-next' | 'unsafe-update'
  | 'stale-snapshot' | 'activation-conflict' | 'write-failure' | 'readback-failure'
  | 'lock-unavailable' | 'digest-failure' | 'backup-failure' | 'backup-readback-failure'
  | 'backup-rotation-failure'
export class V9PersistenceError extends Error {
  constructor(readonly code: V9PersistenceErrorCode) { super(code) }
}
export interface V9PersistenceReceipt { raw: string; revision: number; attemptId: string;
  mutationAttemptId?: string
  preMutationBackup?: V9PreMutationBackupEvidence }

type AutoBackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>
function isAutoBackupStorage(storage: Pick<Storage, 'getItem' | 'setItem'>): storage is AutoBackupStorage {
  const candidate = storage as Partial<AutoBackupStorage>
  return typeof candidate.removeItem === 'function' && typeof candidate.key === 'function'
    && Number.isSafeInteger(candidate.length) && Number(candidate.length) >= 0
}
async function verifiedAutoBackup(raw: string, key: string): Promise<V9PreMutationBackup | null> {
  try {
    const value: unknown = JSON.parse(raw)
    if (!record(value) || Object.keys(value).length !== 8 || value.schemaVersion !== 1
      || value.kind !== 'v9-pre-mutation-backup' || typeof value.mutationAttemptId !== 'string'
      || !/^[0-9a-f-]{36}$/.test(value.mutationAttemptId)
      || key !== `${V9_AUTO_BACKUP_PREFIX}${value.mutationAttemptId}`
      || !['delete-recurring-lesson', 'permanently-update-lesson'].includes(String(value.operation))
      || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
      || !digest(value.digest) || typeof value.rawDocument !== 'string' || !iso(value.createdAt)
      || await fingerprintV7Raw(value.rawDocument) !== value.digest) return null
    parseAppDataV9Raw(value.rawDocument)
    return value as unknown as V9PreMutationBackup
  } catch { return null }
}

/** Runs only inside the existing V9 persistence lock, after current-document evidence has passed. */
async function writePreMutationBackup(storage: AutoBackupStorage, expected: {
  raw: string; revision: number; digest: `sha256:${string}` }, operation: V9HighRiskOperation,
  mutationAttemptId: string,
): Promise<V9PreMutationBackupEvidence> {
  const existing: Array<{ key: string; record: V9PreMutationBackup }> = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(V9_AUTO_BACKUP_PREFIX)) continue
    let raw: string | null
    try { raw = storage.getItem(key) }
    catch { throw new V9PersistenceError('backup-readback-failure') }
    const parsed = raw && await verifiedAutoBackup(raw, key)
    if (!parsed) throw new V9PersistenceError('backup-readback-failure')
    existing.push({ key, record: parsed })
  }
  const key = `${V9_AUTO_BACKUP_PREFIX}${mutationAttemptId}`
  try { if (storage.getItem(key) !== null) throw new V9PersistenceError('backup-failure') }
  catch { throw new V9PersistenceError('backup-failure') }
  const backup: V9PreMutationBackup = { schemaVersion: 1, kind: 'v9-pre-mutation-backup',
    mutationAttemptId, operation, revision: expected.revision, digest: expected.digest,
    rawDocument: expected.raw, createdAt: new Date().toISOString() }
  const raw = JSON.stringify(backup)
  try { storage.setItem(key, raw) }
  catch { throw new V9PersistenceError('backup-failure') }
  const discardUncommitted = () => { try { storage.removeItem(key) } catch { /* fail closed below */ } }
  let confirmed = false
  try { confirmed = storage.getItem(key) === raw && !!(await verifiedAutoBackup(raw, key)) }
  catch { confirmed = false }
  if (!confirmed) {
    discardUncommitted()
    throw new V9PersistenceError('backup-readback-failure')
  }
  const oldest = [...existing]
    .sort((left, right) => left.record.createdAt.localeCompare(right.record.createdAt)
      || left.key.localeCompare(right.key))
  for (const item of oldest.slice(0, Math.max(0, oldest.length + 1 - V9_AUTO_BACKUP_LIMIT))) {
    try {
      storage.removeItem(item.key)
      if (storage.getItem(item.key) !== null) throw new Error('backup rotation readback failed')
    } catch {
      discardUncommitted()
      throw new V9PersistenceError('backup-rotation-failure')
    }
  }
  return { key, mutationAttemptId, operation, revision: backup.revision,
    digest: backup.digest, rawDocument: backup.rawDocument }
}
async function hasPreMutationBackupEvidence(storage: Pick<Storage, 'getItem'>,
  evidence: V9PreMutationBackupEvidence): Promise<boolean> {
  const raw = storage.getItem(evidence.key)
  const record = raw && await verifiedAutoBackup(raw, evidence.key)
  return !!record && record.mutationAttemptId === evidence.mutationAttemptId
    && record.operation === evidence.operation && record.revision === evidence.revision
    && record.digest === evidence.digest && record.rawDocument === evidence.rawDocument
}

/** One confirmed write, guarded by both old-source and current-document evidence. */
export async function persistAppDataV9(storage: Pick<Storage, 'getItem' | 'setItem'>,
  current: AppDataV9, next: AppDataV9,
  expected: { raw: string; metadataRaw: string; revision: number },
  highRiskOperation?: V9HighRiskOperation): Promise<V9PersistenceReceipt> {
  if (!isCompatibleAppDataV9(current)) throw new V9PersistenceError('invalid-current')
  if (!isCompatibleAppDataV9(next)) throw new V9PersistenceError('invalid-next')
  if (!isSafeAppDataV9Update(current, next)) throw new V9PersistenceError('unsafe-update')
  if (JSON.stringify(current) !== expected.raw) throw new V9PersistenceError('stale-snapshot')
  try {
    return await withV8StorageLock(async () => {
      if (!(await checkV9WriteEvidence(storage, expected.raw, expected.metadataRaw))) {
        throw new V9PersistenceError('activation-conflict')
      }
      const meta: V9ActivationRecord = JSON.parse(expected.metadataRaw)
      if (meta.documentRevision !== expected.revision) throw new V9PersistenceError('stale-snapshot')
      let preMutationBackup: V9PreMutationBackupEvidence | undefined
      let mutationAttemptId: string | undefined
      if (highRiskOperation) {
        if (!isAutoBackupStorage(storage)) throw new V9PersistenceError('backup-failure')
        try {
          mutationAttemptId = crypto.randomUUID()
          preMutationBackup = await writePreMutationBackup(storage, {
            raw: expected.raw, revision: expected.revision, digest: meta.currentDigest,
          }, highRiskOperation, mutationAttemptId)
        } catch (cause) {
          if (cause instanceof V9PersistenceError) throw cause
          throw new V9PersistenceError('backup-failure')
        }
        if (!(await checkV9WriteEvidence(storage, expected.raw, expected.metadataRaw))) {
          throw new V9PersistenceError('activation-conflict')
        }
      }
      const raw = JSON.stringify(next)
      let digestNext: `sha256:${string}`
      try { digestNext = await fingerprintV7Raw(raw) }
      catch { throw new V9PersistenceError('digest-failure') }
      const updated: V9ActivationRecord = { ...meta, currentDigest: digestNext,
        documentRevision: meta.documentRevision + 1,
        updatedAt: new Date(Math.max(Date.now(), Date.parse(meta.updatedAt))).toISOString() }
      if (!isV9ActivationRecord(updated)) throw new V9PersistenceError('invalid-next')
      if (storage.getItem(APP_DATA_V9_KEY) !== expected.raw
        || storage.getItem(V9_ACTIVATION_KEY) !== expected.metadataRaw) {
        throw new V9PersistenceError('stale-snapshot')
      }
      if (preMutationBackup && !(await hasPreMutationBackupEvidence(storage, preMutationBackup))) {
        throw new V9PersistenceError('backup-readback-failure')
      }
      try { storage.setItem(APP_DATA_V9_KEY, raw) }
      catch { throw new V9PersistenceError('write-failure') }
      if (storage.getItem(APP_DATA_V9_KEY) !== raw) throw new V9PersistenceError('readback-failure')
      if (storage.getItem(V9_ACTIVATION_KEY) !== expected.metadataRaw) {
        throw new V9PersistenceError('activation-conflict')
      }
      try { storage.setItem(V9_ACTIVATION_KEY, JSON.stringify(updated)) }
      catch { throw new V9PersistenceError('write-failure') }
      if (!(await checkV9WriteEvidence(storage, raw, JSON.stringify(updated)))) {
        throw new V9PersistenceError('readback-failure')
      }
      return { raw, revision: updated.documentRevision, attemptId: updated.attemptId,
        ...(preMutationBackup && mutationAttemptId && { mutationAttemptId, preMutationBackup }) }
    })
  } catch (cause) {
    if (cause instanceof V9PersistenceError) throw cause
    throw new V9PersistenceError('lock-unavailable')
  }
}

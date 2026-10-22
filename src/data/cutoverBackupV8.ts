import { fingerprintV7Raw } from './activationV8'
import { APP_DATA_V7_KEY } from './storageV7'
import { isCompatibleAppDataV7 } from './validators/v7'
import { parseAppDataV8Raw } from './storageV8'

export const CUTOVER_BACKUP_V8_PREFIX = 'aster-timetable-v8-cutover-backup:'
export type SourceIdentityV8 = { type: 'v7'; key: typeof APP_DATA_V7_KEY; digest: `sha256:${string}` }
  | { type: 'empty' }

export type CutoverBackupRecordV8 = {
  schemaVersion: 1
  backupId: string
  source: { type: 'v7'; key: typeof APP_DATA_V7_KEY; raw: string; digest: `sha256:${string}`; validationStatus: 'valid' }
    | { type: 'empty'; validationStatus: 'no-v7-key' }
  createdAt: string
}

export type BackupFailureCodeV8 = 'invalid-id' | 'invalid-time' | 'source-changed' | 'invalid-v7'
  | 'digest-failure' | 'read-failure' | 'write-failure' | 'already-exists'
  | 'readback-failure' | 'readback-mismatch' | 'invalid-record' | 'digest-mismatch'

export type BackupResultV8 = { ok: true; record: CutoverBackupRecordV8; key: string; raw: string }
  | { ok: false; code: BackupFailureCodeV8; key: string }

/** Contract only: B2a does not create archives or perform rollback. */
export interface V8RollbackArchiveV8 {
  schemaVersion: 1
  archiveId: string
  activationBackupId: string
  rawV8: string
  digest: `sha256:${string}`
  archivedAt: string
  recoveryStatus: 'read-only'
}

type BackupStorage = Pick<Storage, 'getItem' | 'setItem'>
const validId = (id: string) => /^[A-Za-z0-9_-]{1,100}$/.test(id)
const validTime = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
const fail = (code: BackupFailureCodeV8, key: string): BackupResultV8 => ({ ok: false, code, key })

export async function verifyCutoverBackupV8(raw: string): Promise<CutoverBackupRecordV8 | BackupFailureCodeV8> {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return 'invalid-record' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'invalid-record'
  const record = value as CutoverBackupRecordV8
  if (record.schemaVersion !== 1 || !validId(record.backupId) || !validTime(record.createdAt)
    || !record.source || typeof record.source !== 'object') return 'invalid-record'
  if (record.source.type === 'empty') {
    return Object.keys(record.source).length === 2 && record.source.validationStatus === 'no-v7-key'
      ? record : 'invalid-record'
  }
  if (record.source.type !== 'v7' || Object.keys(record.source).length !== 5
    || record.source.key !== APP_DATA_V7_KEY || record.source.validationStatus !== 'valid'
    || typeof record.source.raw !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(record.source.digest)) return 'invalid-record'
  try {
    const parsed: unknown = JSON.parse(record.source.raw)
    if (!isCompatibleAppDataV7(parsed)) return 'invalid-record'
  } catch { return 'invalid-record' }
  try { return await fingerprintV7Raw(record.source.raw) === record.source.digest ? record : 'digest-mismatch' }
  catch { return 'digest-failure' }
}

export async function isV8RollbackArchiveV8(value: unknown): Promise<boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const archive = value as V8RollbackArchiveV8
  if (archive.schemaVersion !== 1 || !validId(archive.archiveId) || !validId(archive.activationBackupId)
    || !validTime(archive.archivedAt) || archive.recoveryStatus !== 'read-only'
    || typeof archive.rawV8 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(archive.digest)) return false
  try {
    parseAppDataV8Raw(archive.rawV8)
    return await fingerprintV7Raw(archive.rawV8) === archive.digest
  } catch { return false }
}

/** A unique attempt ID is supplied by the caller; this API never overwrites a backup. */
export async function createCutoverBackupV8(
  storage: BackupStorage,
  input: { backupId: string; expectedRaw: string | null; createdAt: string },
): Promise<BackupResultV8> {
  const key = `${CUTOVER_BACKUP_V8_PREFIX}${input.backupId}`
  if (!validId(input.backupId)) return fail('invalid-id', key)
  if (!validTime(input.createdAt)) return fail('invalid-time', key)
  let sourceRaw: string | null
  let existing: string | null
  try {
    sourceRaw = storage.getItem(APP_DATA_V7_KEY)
    existing = storage.getItem(key)
  } catch { return fail('read-failure', key) }
  if (existing !== null) return fail('already-exists', key)
  if (sourceRaw !== input.expectedRaw) return fail('source-changed', key)
  let source: CutoverBackupRecordV8['source']
  if (sourceRaw === null) source = { type: 'empty', validationStatus: 'no-v7-key' }
  else {
    try {
      const parsed: unknown = JSON.parse(sourceRaw)
      if (!isCompatibleAppDataV7(parsed)) return fail('invalid-v7', key)
    } catch { return fail('invalid-v7', key) }
    try {
      source = { type: 'v7', key: APP_DATA_V7_KEY, raw: sourceRaw,
        digest: await fingerprintV7Raw(sourceRaw), validationStatus: 'valid' }
    } catch { return fail('digest-failure', key) }
  }
  // The digest calculation is asynchronous: recheck both keys before writing.
  try {
    if (storage.getItem(APP_DATA_V7_KEY) !== sourceRaw) return fail('source-changed', key)
    if (storage.getItem(key) !== null) return fail('already-exists', key)
  } catch { return fail('read-failure', key) }
  const record: CutoverBackupRecordV8 = { schemaVersion: 1, backupId: input.backupId, source, createdAt: input.createdAt }
  const raw = JSON.stringify(record)
  try { storage.setItem(key, raw) } catch { return fail('write-failure', key) }
  let readback: string | null
  try { readback = storage.getItem(key) } catch { return fail('readback-failure', key) }
  if (readback !== raw) return fail('readback-mismatch', key)
  const verified = await verifyCutoverBackupV8(readback)
  if (typeof verified === 'string') return fail(verified, key)
  try { if (storage.getItem(APP_DATA_V7_KEY) !== sourceRaw) return fail('source-changed', key) }
  catch { return fail('readback-failure', key) }
  return { ok: true, record: verified, key, raw }
}

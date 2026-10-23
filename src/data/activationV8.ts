import { APP_DATA_V7_KEY } from './storageV7'
import { CUTOVER_BACKUP_V8_PREFIX } from './cutoverBackupV8'
import type { SourceIdentityV8 } from './cutoverBackupV8'

export const APP_DATA_V8_ACTIVATION_KEY = 'aster-timetable-data-v8-activation'
export const V8_ACTIVATION_METADATA_VERSION = 1
export const V8_TRANSACTION_KEY = 'aster-timetable-data-v8-transaction-v2'
export const V8_TRANSACTION_VERSION = 2

export type V8TransactionStatus = 'preparing' | 'prepared' | 'active' | 'interrupted' | 'rollback-recovery' | 'rolled-back'
export interface V8ActivationTransaction {
  schemaVersion: typeof V8_TRANSACTION_VERSION
  transactionId: string
  status: V8TransactionStatus
  source: SourceIdentityV8
  backup: { id: string; key: string; digest: `sha256:${string}` | null }
  externalConfirmation: { source: SourceIdentityV8; externalExportPrepared: true; userConfirmedExternalBackup: true }
  candidateDigest: `sha256:${string}`
  /** Digest of the currently confirmed V8 raw; advances with documentRevision. */
  currentDigest: `sha256:${string}`
  expectedV8Raw: null
  documentRevision: number
  createdAt: string
  updatedAt: string
  lastError: string | null
  archive: { id: string; key: string; digest: `sha256:${string}` } | null
}

const digest = (value: unknown): value is `sha256:${string}` => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const sourceIdentity = (value: unknown): value is SourceIdentityV8 => record(value)
  && (value.type === 'empty' ? Object.keys(value).length === 1
    : value.type === 'v7' && Object.keys(value).length === 3 && value.key === APP_DATA_V7_KEY && digest(value.digest))
const sameSource = (left: SourceIdentityV8, right: SourceIdentityV8) => left.type === right.type
  && (left.type === 'empty' || (right.type === 'v7' && left.key === right.key && left.digest === right.digest))
export function isV8ActivationTransaction(value: unknown): value is V8ActivationTransaction {
  if (!record(value)) return false
  const t = value as unknown as V8ActivationTransaction
  if (Object.keys(t).length !== 14 || t.schemaVersion !== 2 || !id(t.transactionId)
    || !['preparing', 'prepared', 'active', 'interrupted', 'rollback-recovery', 'rolled-back'].includes(t.status)
    || !sourceIdentity(t.source)
    || !record(t.backup) || Object.keys(t.backup).length !== 3 || !id(t.backup.id)
    || t.backup.key !== `${CUTOVER_BACKUP_V8_PREFIX}${t.backup.id}`
    || (t.source.type === 'empty' ? t.backup.digest !== null : t.backup.digest !== t.source.digest)
    || !record(t.externalConfirmation) || Object.keys(t.externalConfirmation).length !== 3
    || !sourceIdentity(t.externalConfirmation.source) || !sameSource(t.externalConfirmation.source, t.source)
    || t.externalConfirmation.externalExportPrepared !== true || t.externalConfirmation.userConfirmedExternalBackup !== true
    || !digest(t.candidateDigest) || !digest(t.currentDigest) || t.expectedV8Raw !== null
    || !Number.isSafeInteger(t.documentRevision) || t.documentRevision < 0
    || (t.documentRevision === 0 && t.currentDigest !== t.candidateDigest)
    || (t.status !== 'active' && t.status !== 'rollback-recovery' && t.status !== 'rolled-back' && t.documentRevision !== 0)
    || !canonicalUtcTimestamp(t.createdAt) || !canonicalUtcTimestamp(t.updatedAt) || t.updatedAt < t.createdAt
    || (t.lastError !== null && typeof t.lastError !== 'string')
    || (t.archive !== null && t.status !== 'rollback-recovery' && t.status !== 'rolled-back')
    || (t.archive !== null && (!record(t.archive) || Object.keys(t.archive).length !== 3
      || !id(t.archive.id) || typeof t.archive.key !== 'string' || !digest(t.archive.digest)))) return false
  return t.status !== 'rolled-back' || t.archive !== null
}

export function canTransitionV8(from: V8TransactionStatus | 'absent', to: V8TransactionStatus): boolean {
  return ({ absent: ['preparing'], preparing: ['prepared', 'interrupted'], prepared: ['active', 'interrupted'],
    active: ['rollback-recovery'], 'rollback-recovery': ['rolled-back'], interrupted: [], 'rolled-back': [] } as const)[from].includes(to as never)
}

export function loadV8Transaction(storage: Pick<Storage, 'getItem'>): {
  value: V8ActivationTransaction | null; raw: string | null; issue: 'none' | 'corrupt' | 'read-failure'
} {
  let raw: string | null = null
  try {
    raw = storage.getItem(V8_TRANSACTION_KEY)
    if (raw === null) return { value: null, raw, issue: 'none' }
    const parsed: unknown = JSON.parse(raw)
    return isV8ActivationTransaction(parsed) ? { value: parsed, raw, issue: 'none' } : { value: null, raw, issue: 'corrupt' }
  } catch { return { value: null, raw, issue: raw === null ? 'read-failure' : 'corrupt' } }
}

export type V8ActivationStatus = 'active' | 'rolled-back'

/**
 * Immutable cutover evidence for a future R2-B activation.
 *
 * R2-A only defines and reads this contract. It never creates or updates the
 * record, so a later V7 write cannot silently become a new cutover baseline.
 */
export interface V8ActivationMetadata {
  metadataVersion: typeof V8_ACTIVATION_METADATA_VERSION
  sourceV7Fingerprint: `sha256:${string}`
  sourceV7Key: typeof APP_DATA_V7_KEY
  v8ActivationRevision: number
  activatedAt: string
  status: V8ActivationStatus
}

export interface V8ActivationMetadataLoadResult {
  value: V8ActivationMetadata | null
  raw: string | null
  issue: 'none' | 'corrupt' | 'read-failure'
}

type ReadStorage = Pick<Storage, 'getItem'>

const canonicalUtcTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

export function isV8ActivationMetadata(value: unknown): value is V8ActivationMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return Object.keys(candidate).length === 6
    && candidate.metadataVersion === V8_ACTIVATION_METADATA_VERSION
    && typeof candidate.sourceV7Fingerprint === 'string'
    && /^sha256:[0-9a-f]{64}$/.test(candidate.sourceV7Fingerprint)
    && candidate.sourceV7Key === APP_DATA_V7_KEY
    && Number.isSafeInteger(candidate.v8ActivationRevision)
    && (candidate.v8ActivationRevision as number) >= 1
    && canonicalUtcTimestamp(candidate.activatedAt)
    && (candidate.status === 'active' || candidate.status === 'rolled-back')
}

export function loadV8ActivationMetadata(storage: ReadStorage): V8ActivationMetadataLoadResult {
  let raw: string | null = null
  try {
    raw = storage.getItem(APP_DATA_V8_ACTIVATION_KEY)
    if (raw === null) return { value: null, raw: null, issue: 'none' }
    const parsed: unknown = JSON.parse(raw)
    if (!isV8ActivationMetadata(parsed)) return { value: null, raw, issue: 'corrupt' }
    return { value: parsed, raw, issue: 'none' }
  } catch {
    return { value: null, raw, issue: raw === null ? 'read-failure' : 'corrupt' }
  }
}

export async function fingerprintV7Raw(raw: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

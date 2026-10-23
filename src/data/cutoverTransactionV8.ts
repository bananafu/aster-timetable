import {
  APP_DATA_V8_ACTIVATION_KEY, canTransitionV8, fingerprintV7Raw, isV8ActivationTransaction,
  loadV8Transaction, V8_TRANSACTION_KEY,
  type V8ActivationTransaction,
} from './activationV8'
import {
  verifyCutoverBackupV8, type BackupResultV8, type SourceIdentityV8,
} from './cutoverBackupV8'
import { isExternalBackupConfirmedV8, preflightCutoverV8,
  type CutoverPreflightIssueV8, type ExternalBackupConfirmationV8 } from './cutoverPreflightV8'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY, parseAppDataV8Raw } from './storageV8'
import { withV8StorageLock } from './v8Coordination'
import { inspectCutoverSessionReadiness, type V8SessionIssue } from './v8SessionSafety'

type CutoverStorage = Pick<Storage, 'getItem' | 'setItem'>
type BackupReceipt = Extract<BackupResultV8, { ok: true }>
export type CutoverTransactionFailureCodeV8 = 'lock-unavailable' | 'lock-failure' | 'preflight-blocked'
  | 'backup-invalid' | 'confirmation-invalid' | 'source-changed' | 'v8-changed'
  | 'transaction-changed' | 'write-failure' | 'readback-failure' | 'digest-failure'
  | 'invalid-transaction'
  | 'session-unsafe'
export type CutoverTransactionResultV8 = {
  ok: true; transaction: V8ActivationTransaction; raw: string; reviewIssues: CutoverPreflightIssueV8[];
  replayed: boolean
} | { ok: false; code: CutoverTransactionFailureCodeV8; transactionRaw: string | null;
  preflightIssues?: CutoverPreflightIssueV8[]; sessionIssues?: V8SessionIssue[] }

function sameSource(left: SourceIdentityV8, right: SourceIdentityV8): boolean {
  return left.type === right.type && (left.type === 'empty'
    || (right.type === 'v7' && left.key === right.key && left.digest === right.digest))
}

function fail(
  code: CutoverTransactionFailureCodeV8, storage: Pick<Storage, 'getItem'>,
  preflightIssues?: CutoverPreflightIssueV8[],
): CutoverTransactionResultV8 {
  let transactionRaw: string | null = null
  try { transactionRaw = storage.getItem(V8_TRANSACTION_KEY) } catch { /* The original failure remains authoritative. */ }
  return { ok: false, code, transactionRaw, ...(preflightIssues ? { preflightIssues } : {}) }
}

async function verifyBackup(
  storage: Pick<Storage, 'getItem'>, receipt: BackupReceipt, source: SourceIdentityV8, sourceRaw: string | null,
): Promise<boolean> {
  try {
    if (receipt.key !== `aster-timetable-v8-cutover-backup:${receipt.record.backupId}`) return false
    const raw = storage.getItem(receipt.key)
    if (raw === null || raw !== receipt.raw) return false
    const record = await verifyCutoverBackupV8(raw)
    if (typeof record === 'string' || JSON.stringify(record) !== JSON.stringify(receipt.record)) return false
    if (source.type === 'empty') return record.source.type === 'empty' && sourceRaw === null
    return record.source.type === 'v7' && record.source.key === source.key
      && record.source.digest === source.digest && record.source.raw === sourceRaw
  } catch { return false }
}

function verifySourceRaw(storage: Pick<Storage, 'getItem'>, raw: string | null): boolean {
  try { return storage.getItem(APP_DATA_V7_KEY) === raw } catch { return false }
}

function snapshotIssue(
  storage: Pick<Storage, 'getItem'>, raw: string | null, expectedTransactionRaw: string,
): CutoverTransactionFailureCodeV8 | null {
  try {
    if (storage.getItem(V8_TRANSACTION_KEY) !== expectedTransactionRaw) return 'transaction-changed'
    if (storage.getItem(APP_DATA_V8_KEY) !== raw) return 'v8-changed'
    return null
  } catch { return 'readback-failure' }
}

function persistTransaction(
  storage: CutoverStorage, transaction: V8ActivationTransaction, expectedRaw: string | null,
): { ok: true; raw: string } | { ok: false; code: 'transaction-changed' | 'write-failure' | 'readback-failure' | 'invalid-transaction' } {
  if (!isV8ActivationTransaction(transaction)) return { ok: false, code: 'invalid-transaction' }
  const raw = JSON.stringify(transaction)
  try {
    if (storage.getItem(V8_TRANSACTION_KEY) !== expectedRaw) return { ok: false, code: 'transaction-changed' }
    storage.setItem(V8_TRANSACTION_KEY, raw)
  } catch { return { ok: false, code: 'write-failure' } }
  try { return storage.getItem(V8_TRANSACTION_KEY) === raw ? { ok: true, raw } : { ok: false, code: 'readback-failure' } }
  catch { return { ok: false, code: 'readback-failure' } }
}

function nextTimestamp(createdAt: string): string {
  return new Date(Math.max(Date.now(), Date.parse(createdAt))).toISOString()
}

/** Explicit operation only; no import/mount path invokes this service. */
export async function activateCutoverV8(
  storage: CutoverStorage,
  input: { transactionId: string; backup: BackupReceipt; confirmation: ExternalBackupConfirmationV8; createdAt: string },
): Promise<CutoverTransactionResultV8> {
  const readiness = await inspectCutoverSessionReadiness()
  if (readiness.readiness !== 'verified') {
    const blocked = fail('session-unsafe', storage)
    return { ok: false, code: 'session-unsafe', transactionRaw: blocked.ok ? null : blocked.transactionRaw,
      sessionIssues: readiness.issues }
  }
  return runV8ActivationProtocol(storage, input)
}

/** Private transaction engine. Production readiness remains blocked until legacy-tab safety is verifiable. */
async function runV8ActivationProtocol(
  storage: CutoverStorage,
  input: { transactionId: string; backup: BackupReceipt; confirmation: ExternalBackupConfirmationV8; createdAt: string },
): Promise<CutoverTransactionResultV8> {
  try {
    return await withV8StorageLock(async () => {
      if ((await inspectCutoverSessionReadiness()).readiness !== 'verified') return fail('session-unsafe', storage)
      const existing = loadV8Transaction(storage)
      if (existing.issue === 'none' && existing.value?.status === 'active'
        && existing.value.transactionId === input.transactionId && existing.raw !== null) {
        const transaction = existing.value
        let sourceRaw: string | null
        let v8Raw: string | null
        try {
          sourceRaw = storage.getItem(APP_DATA_V7_KEY)
          v8Raw = storage.getItem(APP_DATA_V8_KEY)
          if (storage.getItem(APP_DATA_V8_ACTIVATION_KEY) !== null) return fail('transaction-changed', storage)
        } catch { return fail('readback-failure', storage) }
        if (!isExternalBackupConfirmedV8(input.confirmation, transaction.source)
          || !sameSource(input.confirmation.source, transaction.source)) return fail('confirmation-invalid', storage)
        if (input.backup.record.backupId !== transaction.backup.id || input.backup.key !== transaction.backup.key
          || (input.backup.record.source.type === 'v7' ? input.backup.record.source.digest : null) !== transaction.backup.digest
          || !await verifyBackup(storage, input.backup, transaction.source, sourceRaw)) return fail('backup-invalid', storage)
        let sourceMatches: boolean
        try {
          sourceMatches = transaction.source.type === 'empty' ? sourceRaw === null
            : sourceRaw !== null && await fingerprintV7Raw(sourceRaw) === transaction.source.digest
        } catch { return fail('digest-failure', storage) }
        if (!sourceMatches || !verifySourceRaw(storage, sourceRaw)) return fail('source-changed', storage)
        try {
          if (v8Raw === null) return fail('v8-changed', storage)
          parseAppDataV8Raw(v8Raw)
          if (await fingerprintV7Raw(v8Raw) !== transaction.currentDigest) return fail('v8-changed', storage)
        } catch { return fail('v8-changed', storage) }
        const replayIssue = snapshotIssue(storage, v8Raw, existing.raw)
        if (replayIssue) return fail(replayIssue, storage)
        return { ok: true, transaction, raw: existing.raw, reviewIssues: [], replayed: true }
      }
      const preflight = await preflightCutoverV8(storage)
      if (!preflight.canProceed || !preflight.source || !preflight.candidateRaw) {
        return fail('preflight-blocked', storage, preflight.issues)
      }
      if (!await verifyBackup(storage, input.backup, preflight.source, preflight.sourceRaw)) return fail('backup-invalid', storage)
      if (!isExternalBackupConfirmedV8(input.confirmation, preflight.source)) return fail('confirmation-invalid', storage)
      if (!verifySourceRaw(storage, preflight.sourceRaw) || storage.getItem(APP_DATA_V8_KEY) !== null
        || loadV8Transaction(storage).raw !== null) return fail('source-changed', storage)
      const candidateDigest = await fingerprintV7Raw(preflight.candidateRaw)
      const backupSource = input.backup.record.source
      const source = preflight.source
      if (!sameSource(input.confirmation.source, source)) return fail('confirmation-invalid', storage)
      const preparing: V8ActivationTransaction = {
        schemaVersion: 2, transactionId: input.transactionId, status: 'preparing', source,
        backup: { id: input.backup.record.backupId, key: input.backup.key,
          digest: backupSource.type === 'v7' ? backupSource.digest : null },
        externalConfirmation: {
          source, externalExportPrepared: true, userConfirmedExternalBackup: true,
        },
        candidateDigest, currentDigest: candidateDigest, expectedV8Raw: null, documentRevision: 0,
        createdAt: input.createdAt, updatedAt: input.createdAt, lastError: null, archive: null,
      }
      if (!isV8ActivationTransaction(preparing)) return fail('invalid-transaction', storage)
      if (!canTransitionV8('absent', 'preparing')) return fail('invalid-transaction', storage)
      const first = persistTransaction(storage, preparing, null)
      if (!first.ok) return fail(first.code, storage)
      const beforeCandidate = snapshotIssue(storage, null, first.raw)
      if (beforeCandidate) return fail(beforeCandidate, storage)
      if (!verifySourceRaw(storage, preflight.sourceRaw)) return fail('source-changed', storage)
      if (!await verifyBackup(storage, input.backup, source, preflight.sourceRaw)) return fail('backup-invalid', storage)
      try { storage.setItem(APP_DATA_V8_KEY, preflight.candidateRaw) } catch { return fail('write-failure', storage) }
      let v8Raw: string | null
      try { v8Raw = storage.getItem(APP_DATA_V8_KEY) } catch { return fail('readback-failure', storage) }
      if (v8Raw !== preflight.candidateRaw) return fail('readback-failure', storage)
      try {
        parseAppDataV8Raw(v8Raw)
        if (await fingerprintV7Raw(v8Raw) !== candidateDigest) return fail('digest-failure', storage)
      } catch { return fail('digest-failure', storage) }
      const beforePrepared = snapshotIssue(storage, v8Raw, first.raw)
      if (beforePrepared) return fail(beforePrepared, storage)
      if (!verifySourceRaw(storage, preflight.sourceRaw)) return fail('source-changed', storage)
      if (!canTransitionV8('preparing', 'prepared')) return fail('invalid-transaction', storage)
      const prepared: V8ActivationTransaction = { ...preparing, status: 'prepared', updatedAt: nextTimestamp(input.createdAt) }
      const second = persistTransaction(storage, prepared, first.raw)
      if (!second.ok) return fail(second.code, storage)
      const beforeActive = snapshotIssue(storage, v8Raw, second.raw)
      if (beforeActive) return fail(beforeActive, storage)
      if (!verifySourceRaw(storage, preflight.sourceRaw)) return fail('source-changed', storage)
      if (!await verifyBackup(storage, input.backup, source, preflight.sourceRaw)) return fail('backup-invalid', storage)
      if ((await inspectCutoverSessionReadiness()).readiness !== 'verified') return fail('session-unsafe', storage)
      if (!canTransitionV8('prepared', 'active')) return fail('invalid-transaction', storage)
      const active: V8ActivationTransaction = { ...prepared, status: 'active', updatedAt: nextTimestamp(input.createdAt) }
      const third = persistTransaction(storage, active, second.raw)
      if (!third.ok) return fail(third.code, storage)
      const afterActive = snapshotIssue(storage, v8Raw, third.raw)
      if (afterActive) return fail(afterActive, storage)
      if (!verifySourceRaw(storage, preflight.sourceRaw)) return fail('source-changed', storage)
      return { ok: true, transaction: active, raw: third.raw,
        reviewIssues: preflight.issues.filter((item) => item.severity === 'review'), replayed: false }
    })
  } catch (error) { return fail(error instanceof Error && error.message === 'lock-unavailable' ? 'lock-unavailable' : 'lock-failure', storage) }
}

export type CutoverInspectionV8 = {
  status: 'absent' | V8ActivationTransaction['status'] | 'unknown'
  transactionRaw: string | null
  rawV7: string | null
  rawV8: string | null
  rawBackup: string | null
  issues: string[]
  manualRetryEligible: boolean
}

/** Read-only interrupted-state inspection; never resumes or rewrites a transaction. */
export async function inspectCutoverV8(storage: Pick<Storage, 'getItem'>): Promise<CutoverInspectionV8> {
  const loaded = loadV8Transaction(storage)
  let sourceRaw: string | null = null
  let v8Raw: string | null = null
  const readIssues: string[] = []
  try { sourceRaw = storage.getItem(APP_DATA_V7_KEY); v8Raw = storage.getItem(APP_DATA_V8_KEY) }
  catch { readIssues.push('read-failure') }
  if (loaded.issue !== 'none') return { status: 'unknown', transactionRaw: loaded.raw,
    rawV7: sourceRaw, rawV8: v8Raw, rawBackup: null, issues: [...readIssues, loaded.issue], manualRetryEligible: false }
  if (!loaded.value) {
    const preflight = await preflightCutoverV8(storage)
    return { status: 'absent', transactionRaw: null, rawV7: sourceRaw, rawV8: v8Raw, rawBackup: null,
      issues: [...readIssues, ...preflight.issues.map((item) => item.code)], manualRetryEligible: false }
  }
  const transaction = loaded.value
  const issues: string[] = [...readIssues]
  try {
    if (transaction.source.type === 'empty' ? sourceRaw !== null
      : sourceRaw === null || await fingerprintV7Raw(sourceRaw) !== transaction.source.digest) issues.push('source-changed')
  } catch { issues.push('digest-failure') }
  let backupRaw: string | null = null
  try { backupRaw = storage.getItem(transaction.backup.key) } catch { issues.push('backup-read-failure') }
  if (backupRaw === null) issues.push('backup-missing')
  else {
    const record = await verifyCutoverBackupV8(backupRaw)
    if (typeof record === 'string' || record.backupId !== transaction.backup.id
      || (record.source.type === 'v7' ? record.source.digest : null) !== transaction.backup.digest) issues.push('backup-invalid')
  }
  if (v8Raw === null) {
    if (transaction.status === 'prepared' || transaction.status === 'active') issues.push('v8-missing')
  } else {
    try {
      parseAppDataV8Raw(v8Raw)
      const digest = await fingerprintV7Raw(v8Raw)
      if (digest !== transaction.currentDigest) issues.push('v8-digest-mismatch')
    } catch { issues.push('v8-corrupt') }
  }
  return { status: transaction.status, transactionRaw: loaded.raw, rawV7: sourceRaw, rawV8: v8Raw,
    rawBackup: backupRaw, issues,
    manualRetryEligible: transaction.status === 'preparing' && v8Raw === null && issues.length === 0 }
}

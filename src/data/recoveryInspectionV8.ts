import { loadV8Transaction, type V8ActivationTransaction } from './activationV8'
import { verifyCutoverBackupV8, type SourceIdentityV8 } from './cutoverBackupV8'
import { inspectCutoverV8 } from './cutoverTransactionV8'
import { verifyV8RollbackArchive, V8_ROLLBACK_ARCHIVE_PREFIX } from './rollbackArchiveV8'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY, parseAppDataV8Raw } from './storageV8'
import { isCompatibleAppDataV7 } from './validators/v7'

export type V8RecoveryStatus = 'healthy-active' | 'preparing-interrupted' | 'prepared-interrupted'
  | 'active-source-conflict' | 'active-v8-conflict' | 'corrupt-v7' | 'corrupt-v8'
  | 'corrupt-activation' | 'missing-backup' | 'backup-mismatch' | 'archive-required'
  | 'rolled-back' | 'unknown-blocking'
export type V8RecoveryIssue = 'storage-read-failure' | 'missing-transaction' | 'corrupt-transaction'
  | 'snapshot-changed'
  | 'corrupt-v7' | 'corrupt-v8' | 'missing-v8' | 'missing-backup' | 'backup-mismatch'
  | 'source-changed' | 'v8-digest-mismatch' | 'archive-missing' | 'archive-mismatch' | 'revision-invalid'
export interface V8RecoveryInspection {
  status: V8RecoveryStatus
  severity: 'none' | 'blocking' | 'recovery'
  blockingIssues: V8RecoveryIssue[]
  source: SourceIdentityV8 | null
  transactionId: string | null
  transaction: V8ActivationTransaction | null
  rawV7: string | null
  rawV8: string | null
  rawBackup: string | null
  canViewReadOnly: true
  canExport: boolean
  canManuallyRetry: boolean
  requiresV8Archive: boolean
  nextStep: 'none' | 'export-and-investigate' | 'review-interruption' | 'create-archive' | 'manual-rollback-review'
}

/** Classification order is fixed; inspection never changes storage or metadata. */
export async function inspectV8Recovery(storage: Pick<Storage, 'getItem'>): Promise<V8RecoveryInspection> {
  const base = await inspectCutoverV8(storage)
  const loaded = loadV8Transaction(storage)
  const transaction = loaded.value
  const issues: V8RecoveryIssue[] = []
  let v7: string | null = base.rawV7
  let v8: string | null = base.rawV8
  try { v7 = storage.getItem(APP_DATA_V7_KEY); v8 = storage.getItem(APP_DATA_V8_KEY) }
  catch { issues.push('storage-read-failure') }
  if (v7 !== base.rawV7 || v8 !== base.rawV8 || loaded.raw !== base.transactionRaw) issues.push('snapshot-changed')
  if (loaded.issue !== 'none') issues.push('corrupt-transaction')
  if (!transaction && loaded.issue === 'none') issues.push('missing-transaction')
  if (v7 !== null) {
    try { if (!isCompatibleAppDataV7(JSON.parse(v7))) issues.push('corrupt-v7') }
    catch { issues.push('corrupt-v7') }
  }
  if (v8 !== null) {
    try { parseAppDataV8Raw(v8) } catch { issues.push('corrupt-v8') }
  } else if (transaction?.status === 'active' || transaction?.status === 'prepared') issues.push('missing-v8')
  if (transaction) {
    if (base.rawBackup === null) issues.push('missing-backup')
    else {
      const record = await verifyCutoverBackupV8(base.rawBackup)
      if (typeof record === 'string' || record.backupId !== transaction.backup.id
        || (record.source.type === 'v7' ? record.source.digest : null) !== transaction.backup.digest) issues.push('backup-mismatch')
    }
    if (base.issues.includes('source-changed')) issues.push('source-changed')
    if (base.issues.includes('v8-digest-mismatch')) issues.push('v8-digest-mismatch')
    if (!Number.isSafeInteger(transaction.documentRevision) || transaction.documentRevision < 0) issues.push('revision-invalid')
    if (transaction.status === 'rolled-back' && transaction.archive === null) issues.push('archive-missing')
    if (transaction.archive) {
      try {
        const archiveRaw = storage.getItem(transaction.archive.key)
        if (archiveRaw === null) issues.push('archive-missing')
        else {
          const archive = await verifyV8RollbackArchive(archiveRaw)
          if (typeof archive === 'string' || transaction.archive.key !== `${V8_ROLLBACK_ARCHIVE_PREFIX}${archive.archiveId}`
            || archive.archiveId !== transaction.archive.id || archive.digest !== transaction.archive.digest
            || archive.transactionId !== transaction.transactionId || archive.documentRevision !== transaction.documentRevision) {
            issues.push('archive-mismatch')
          }
        }
      } catch { issues.push('archive-mismatch') }
    }
  }
  const status: V8RecoveryStatus = issues.includes('storage-read-failure') || issues.includes('corrupt-transaction')
    ? 'corrupt-activation' : issues.includes('missing-transaction') ? 'unknown-blocking'
      : issues.includes('snapshot-changed') ? 'unknown-blocking'
        : issues.includes('corrupt-v7') ? 'corrupt-v7' : issues.includes('corrupt-v8') ? 'corrupt-v8'
        : issues.includes('missing-backup') ? 'missing-backup' : issues.includes('backup-mismatch') ? 'backup-mismatch'
          : issues.includes('archive-missing') || issues.includes('archive-mismatch') ? 'archive-required'
          : issues.includes('source-changed') ? 'active-source-conflict'
            : issues.includes('v8-digest-mismatch') || issues.includes('missing-v8') ? 'active-v8-conflict'
              : transaction?.status === 'preparing' ? 'preparing-interrupted'
                : transaction?.status === 'prepared' || transaction?.status === 'interrupted' ? 'prepared-interrupted'
                  : transaction?.status === 'rollback-recovery' ? 'archive-required'
                    : transaction?.status === 'rolled-back' ? 'rolled-back'
                      : transaction?.status === 'active' ? 'healthy-active' : 'unknown-blocking'
  return {
    status, severity: status === 'healthy-active' ? 'none'
      : status === 'preparing-interrupted' || status === 'prepared-interrupted' || status === 'archive-required' || status === 'rolled-back'
        ? 'recovery' : 'blocking',
    blockingIssues: issues, source: transaction?.source ?? null, transactionId: transaction?.transactionId ?? null,
    transaction, rawV7: v7, rawV8: v8, rawBackup: base.rawBackup, canViewReadOnly: true,
    canExport: v7 !== null || v8 !== null || base.rawBackup !== null || base.transactionRaw !== null,
    canManuallyRetry: status === 'preparing-interrupted' && base.manualRetryEligible,
    requiresV8Archive: status === 'archive-required',
    nextStep: status === 'healthy-active' ? 'none' : status === 'archive-required' ? 'create-archive'
      : status === 'rolled-back' ? 'manual-rollback-review'
        : status === 'preparing-interrupted' || status === 'prepared-interrupted' ? 'review-interruption' : 'export-and-investigate',
  }
}

import type { AppDataV7, AppDataV8 } from '../types'
import { fingerprintV7Raw, loadV8ActivationMetadata, type V8ActivationMetadata } from './activationV8'
import { migrateV7ToV8WithReport, V8MigrationError } from './migrationsV8'
import type { V8MigrationPreflightReport, V8MigrationReconciliationReport } from './migrationPreflightV8'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V6_KEY } from './storageV6'
import { APP_DATA_V5_KEY } from './storageV5'
import { APP_DATA_V1_KEY, APP_DATA_V3_KEY, APP_DATA_V4_KEY } from './storageV4'
import { APP_DATA_V8_KEY, parseAppDataV8Raw } from './storageV8'
import { createInitialAppDataV8 } from '../hooks/useAppDataV8'
import { isCompatibleAppDataV7 } from './validators/v7'
import { isCompatibleAppDataV8 } from './validators/v8'
import type { SourceIdentityV8 } from './cutoverBackupV8'

export type CutoverPreflightIssueCodeV8 = 'read-failure' | 'corrupt-v7' | 'existing-v8'
  | 'corrupt-v8' | 'unknown-activation' | 'existing-activation' | 'fingerprint-mismatch'
  | 'source-changed' | 'blocking-migration' | 'candidate-invalid' | 'reconciliation-failed'
  | 'legacy-source-present' | 'digest-failure'

export interface CutoverPreflightIssueV8 {
  severity: 'blocking' | 'review'
  code: CutoverPreflightIssueCodeV8 | string
  message: string
  entityIds: string[]
}

export interface CutoverPreflightResultV8 {
  canProceed: boolean
  source: SourceIdentityV8 | null
  sourceRaw: string | null
  candidate: AppDataV8 | null
  candidateRaw: string | null
  migration: { preflight: V8MigrationPreflightReport; reconciliation: V8MigrationReconciliationReport | null } | null
  issues: CutoverPreflightIssueV8[]
}

type ReadStorage = Pick<Storage, 'getItem'>
type CandidateFactory = (source: AppDataV7) => ReturnType<typeof migrateV7ToV8WithReport>
const issue = (code: CutoverPreflightIssueCodeV8, message: string): CutoverPreflightIssueV8 => ({
  severity: 'blocking', code, message, entityIds: [],
})

/** Read-only cutover assessment. The returned candidate is never persisted here. */
export async function preflightCutoverV8(
  storage: ReadStorage,
  expectedSource?: SourceIdentityV8,
  candidateFactory: CandidateFactory = migrateV7ToV8WithReport,
): Promise<CutoverPreflightResultV8> {
  const result: CutoverPreflightResultV8 = {
    canProceed: false, source: null, sourceRaw: null, candidate: null, candidateRaw: null,
    migration: null, issues: [],
  }
  let v7Raw: string | null
  let v8Raw: string | null
  let legacySourcePresent: boolean
  try {
    v7Raw = storage.getItem(APP_DATA_V7_KEY)
    v8Raw = storage.getItem(APP_DATA_V8_KEY)
    legacySourcePresent = [APP_DATA_V6_KEY, APP_DATA_V5_KEY, APP_DATA_V4_KEY, APP_DATA_V3_KEY, APP_DATA_V1_KEY]
      .some((key) => storage.getItem(key) !== null)
  } catch { result.issues.push(issue('read-failure', 'Unable to read cutover source keys.')); return result }
  result.sourceRaw = v7Raw
  const activation = loadV8ActivationMetadata(storage)
  if (activation.issue !== 'none') result.issues.push(issue('unknown-activation', 'Activation metadata is unreadable or unknown.'))
  else if (activation.raw !== null) result.issues.push(issue('existing-activation', 'An activation record already exists.'))
  if (v8Raw !== null) {
    try { parseAppDataV8Raw(v8Raw); result.issues.push(issue('existing-v8', 'A V8 document already exists.')) }
    catch { result.issues.push(issue('corrupt-v8', 'The existing V8 document is corrupt.')) }
  }
  if (result.issues.some((item) => item.severity === 'blocking')) return result
  if (v7Raw === null) {
    result.source = { type: 'empty' }
    if (legacySourcePresent) result.issues.push(issue('legacy-source-present', 'An older source exists without a V7 key.'))
    if (expectedSource && expectedSource.type !== 'empty') result.issues.push(issue('fingerprint-mismatch', 'Expected V7 but found an empty source.'))
    const candidate = createInitialAppDataV8()
    if (!isCompatibleAppDataV8(candidate)) result.issues.push(issue('candidate-invalid', 'Empty V8 candidate is invalid.'))
    else { result.candidate = candidate; result.candidateRaw = JSON.stringify(candidate) }
  } else {
    let source: unknown
    try { source = JSON.parse(v7Raw) } catch { result.issues.push(issue('corrupt-v7', 'V7 JSON cannot be parsed.')); return result }
    if (!isCompatibleAppDataV7(source)) { result.issues.push(issue('corrupt-v7', 'V7 schema is invalid.')); return result }
    try { result.source = { type: 'v7', key: APP_DATA_V7_KEY, digest: await fingerprintV7Raw(v7Raw) } }
    catch { result.issues.push(issue('digest-failure', 'Cannot fingerprint V7 source.')); return result }
    if (expectedSource && (expectedSource.type !== 'v7' || expectedSource.key !== APP_DATA_V7_KEY
      || expectedSource.digest !== result.source.digest)) {
      result.issues.push(issue('fingerprint-mismatch', 'V7 fingerprint differs from the expected source.'))
    }
    try {
      const migration = candidateFactory(source)
      result.migration = { preflight: migration.preflight, reconciliation: migration.reconciliation }
      result.issues.push(...migration.preflight.issues.filter((item) => item.severity !== 'informational')
        .map((item) => ({ severity: item.severity as 'blocking' | 'review', code: item.code,
          message: item.message, entityIds: item.entityIds })))
      if (!migration.preflight.canMigrate) result.issues.push(issue('blocking-migration', 'V7 migration preflight failed.'))
      if (!migration.reconciliation.isReconciled) result.issues.push(issue('reconciliation-failed', 'Migration reconciliation failed.'))
      if (!isCompatibleAppDataV8(migration.data)) result.issues.push(issue('candidate-invalid', 'V8 candidate is invalid.'))
      else { result.candidate = migration.data; result.candidateRaw = JSON.stringify(migration.data) }
    } catch (cause) {
      if (cause instanceof V8MigrationError) {
        result.migration = cause.preflight ? { preflight: cause.preflight, reconciliation: cause.reconciliation ?? null } : null
        result.issues.push(...(cause.preflight?.issues.filter((item) => item.severity !== 'informational') ?? [])
          .map((item) => ({ severity: item.severity as 'blocking' | 'review', code: item.code,
            message: item.message, entityIds: item.entityIds })))
        result.issues.push(issue(cause.code === 'reconciliation-failed' ? 'reconciliation-failed' : 'blocking-migration', cause.message))
      } else result.issues.push(issue('candidate-invalid', 'Candidate generation failed.'))
    }
  }
  try {
    if (storage.getItem(APP_DATA_V7_KEY) !== v7Raw || storage.getItem(APP_DATA_V8_KEY) !== v8Raw
      || loadV8ActivationMetadata(storage).raw !== activation.raw) result.issues.push(issue('source-changed', 'Storage changed during preflight.'))
  } catch { result.issues.push(issue('read-failure', 'Unable to confirm source stability.')) }
  result.canProceed = result.candidate !== null && !result.issues.some((item) => item.severity === 'blocking')
  return result
}

export interface ExternalBackupConfirmationV8 {
  source: SourceIdentityV8
  externalExportPrepared: boolean
  userConfirmedExternalBackup: boolean
}

export function isExternalBackupConfirmedV8(
  value: ExternalBackupConfirmationV8,
  source: SourceIdentityV8,
): boolean {
  return value.externalExportPrepared && value.userConfirmedExternalBackup
    && value.source.type === source.type
    && (source.type === 'empty' || (value.source.type === 'v7' && value.source.key === source.key
      && value.source.digest === source.digest))
}

export interface V7ActivationGuardV8 {
  source: SourceIdentityV8
  activationStatus: V8ActivationMetadata['status']
}

export async function checkV7ActivationGuardV8(storage: ReadStorage, guard: V7ActivationGuardV8): Promise<boolean> {
  if (guard.activationStatus !== 'active') return false
  try {
    const raw = storage.getItem(APP_DATA_V7_KEY)
    if (guard.source.type === 'empty') return raw === null
    return raw !== null && await fingerprintV7Raw(raw) === guard.source.digest
  } catch { return false }
}

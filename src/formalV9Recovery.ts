import { APP_DATA_V8_ACTIVATION_KEY, fingerprintV7Raw, V8_BOOTSTRAP_KEY,
  V8_TRANSACTION_KEY } from './data/activationV8'
import { activateTimetableSubjectsV9, resumeOrphanedSubjectUpgradeV9,
  resumeTimetableSubjectsV9 } from './data/activateSubjectV9'
import { buildSubjectMigrationCandidateV9, type SubjectMigrationDecisionV9 } from './data/subjectMigrationCandidateV9'
import { inspectSubjectMigrationV9, type SubjectMigrationPlanV9 } from './data/subjectMigrationPlanV9'
import { APP_DATA_V7_KEY } from './data/storageV7'
import { APP_DATA_V8_KEY, createEmptyAppDataV8, loadAppDataV8Only, parseAppDataV8Raw } from './data/storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_AUTO_BACKUP_PREFIX, V9_BACKUP_PREFIX,
  loadAppDataV9, type V9ActivationRecord, type V9BackupRecord } from './data/storageV9'
import { inspectFormalRuntime, type FormalRuntimeDecision } from './formalRuntime'
import { checkV8HostWriteEligibility } from './hooks/useAppDataV8'

export type FormalV9RecoverySnapshotKind = 'migration-ready' | 'resume-ready' | 'orphan-ready'
  | 'export-only' | 'ambiguous' | 'read-error'

export type FormalV9RecoveryEvidenceRole = 'v7-source' | 'v8-source' | 'v8-activation'
  | 'v9-document' | 'v9-activation' | 'v9-backup' | 'unknown'

export interface FormalV9RecoveryEvidence {
  key: string
  role: FormalV9RecoveryEvidenceRole
  raw: string
}

export interface FormalV9RecoverySnapshot {
  kind: FormalV9RecoverySnapshotKind
  runtimeDecision: FormalRuntimeDecision
  runtimeReason: FormalRuntimeDecision['v9Status']
  evidenceIdentity: `sha256:${string}` | null
  evidence: readonly FormalV9RecoveryEvidence[]
  capabilities: {
    activate: boolean
    resume: boolean
    resumeOrphan: boolean
    export: boolean
  }
  migration: { sourceRaw: string; plan: SubjectMigrationPlanV9 } | null
  recoveryAttemptId: string | null
}

type ReadStorage = Pick<Storage, 'getItem' | 'key' | 'length'>
type RecoveryStorage = ReadStorage & Pick<Storage, 'setItem'>

const tokiKey = (key: string) => key.startsWith('aster-timetable-') || key.startsWith('toki-v9-')

function roleFor(key: string): FormalV9RecoveryEvidenceRole {
  if (key === APP_DATA_V7_KEY) return 'v7-source'
  if (key === APP_DATA_V8_KEY) return 'v8-source'
  if ([APP_DATA_V8_ACTIVATION_KEY, V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY].includes(key)) return 'v8-activation'
  if (key === APP_DATA_V9_KEY) return 'v9-document'
  if (key === V9_ACTIVATION_KEY) return 'v9-activation'
  if (key.startsWith(V9_BACKUP_PREFIX) || key.startsWith(V9_AUTO_BACKUP_PREFIX)) return 'v9-backup'
  return 'unknown'
}

async function captureEvidence(storage: ReadStorage): Promise<{
  identity: `sha256:${string}`
  entries: FormalV9RecoveryEvidence[]
}> {
  const entries: FormalV9RecoveryEvidence[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key === null) throw new Error('storage-enumeration-failed')
    if (!tokiKey(key)) continue
    const raw = storage.getItem(key)
    if (raw === null) throw new Error('storage-snapshot-changed')
    entries.push({ key, role: roleFor(key), raw })
  }
  entries.sort((left, right) => left.key.localeCompare(right.key))
  return { identity: await fingerprintV7Raw(JSON.stringify(entries.map(({ key, raw }) => [key, raw]))), entries }
}

const runtimeReadError = (): FormalRuntimeDecision => ({ runtime: 'blocked-v9', v9Status: 'read-error' })

function snapshot(kind: FormalV9RecoverySnapshotKind, runtimeDecision: FormalRuntimeDecision,
  evidenceIdentity: `sha256:${string}` | null, evidence: FormalV9RecoveryEvidence[], options: {
    migration?: FormalV9RecoverySnapshot['migration']
    recoveryAttemptId?: string | null
  } = {}): FormalV9RecoverySnapshot {
  return {
    kind, runtimeDecision, runtimeReason: runtimeDecision.v9Status, evidenceIdentity, evidence,
    capabilities: {
      activate: kind === 'migration-ready', resume: kind === 'resume-ready',
      resumeOrphan: kind === 'orphan-ready', export: evidence.length > 0,
    },
    migration: options.migration ?? null,
    recoveryAttemptId: options.recoveryAttemptId ?? null,
  }
}

type VerifiedUpgradeBackup = { backup: V9BackupRecord; raw: string }

async function verifiedUpgradeBackup(storage: ReadStorage, key: string,
  metadata?: V9ActivationRecord): Promise<VerifiedUpgradeBackup | null> {
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const backup = JSON.parse(raw) as V9BackupRecord
    if (backup.schemaVersion !== 1 || backup.kind !== 'timetable-subject-upgrade-backup'
      || !/^[A-Za-z0-9_-]{1,100}$/.test(backup.attemptId)
      || key !== `${V9_BACKUP_PREFIX}${backup.attemptId}`
      || Number.isNaN(Date.parse(backup.createdAt)) || new Date(backup.createdAt).toISOString() !== backup.createdAt
      || backup.sourceV8Key !== APP_DATA_V8_KEY || !Array.isArray(backup.decisions)
      || ![V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY].includes(backup.sourceActivationKey)
      || await fingerprintV7Raw(backup.sourceV8Raw) !== backup.sourceV8Digest
      || await fingerprintV7Raw(backup.sourceActivationRaw) !== backup.sourceActivationDigest
      || await fingerprintV7Raw(backup.candidateRaw) !== backup.candidateDigest) return null
    if (metadata && (metadata.kind !== 'timetable-subject-upgrade'
      || backup.attemptId !== metadata.attemptId || key !== metadata.backupKey
      || backup.sourceV8Digest !== metadata.sourceV8Digest
      || backup.sourceActivationKey !== metadata.sourceActivationKey
      || backup.sourceActivationDigest !== metadata.sourceActivationDigest
      || backup.sourceV7Digest !== metadata.sourceV7Digest
      || backup.createdAt !== metadata.createdAt || backup.candidateDigest !== metadata.initialDigest)) return null
    const candidate = buildSubjectMigrationCandidateV9(parseAppDataV8Raw(backup.sourceV8Raw), backup.decisions)
    if (!candidate.ok || JSON.stringify(candidate.candidate) !== backup.candidateRaw) return null
    return { backup, raw }
  } catch { return null }
}

function unexpectedV9Evidence(evidence: readonly FormalV9RecoveryEvidence[], allowed: ReadonlySet<string>) {
  return evidence.some(({ key }) => (key.startsWith(APP_DATA_V9_KEY) || key.startsWith(V9_BACKUP_PREFIX))
    && !allowed.has(key))
}

async function sourceMatches(storage: ReadStorage, backup: V9BackupRecord): Promise<boolean> {
  try {
    const v7Raw = storage.getItem(APP_DATA_V7_KEY)
    return storage.getItem(APP_DATA_V8_KEY) === backup.sourceV8Raw
      && storage.getItem(backup.sourceActivationKey) === backup.sourceActivationRaw
      && storage.getItem(backup.sourceActivationKey === V8_BOOTSTRAP_KEY ? V8_TRANSACTION_KEY : V8_BOOTSTRAP_KEY) === null
      && storage.getItem(APP_DATA_V8_ACTIVATION_KEY) === null
      && (v7Raw === null ? null : await fingerprintV7Raw(v7Raw)) === backup.sourceV7Digest
  } catch { return false }
}

async function inspectUpgradeRecovery(storage: ReadStorage, evidence: readonly FormalV9RecoveryEvidence[]) {
  const loaded = loadAppDataV9(storage)
  if ((loaded.status === 'preparing' || loaded.status === 'interrupted')
    && loaded.metadata?.kind === 'timetable-subject-upgrade' && loaded.rawMetadata) {
    const allowed = new Set([APP_DATA_V9_KEY, V9_ACTIVATION_KEY, loaded.metadata.backupKey])
    const verified = !unexpectedV9Evidence(evidence, allowed)
      && await verifiedUpgradeBackup(storage, loaded.metadata.backupKey, loaded.metadata)
    if (!verified || !(await sourceMatches(storage, verified.backup))
      || storage.getItem(V9_ACTIVATION_KEY) !== loaded.rawMetadata
      || (loaded.rawDocument !== null && loaded.rawDocument !== verified.backup.candidateRaw)) {
      return { kind: 'blocked' as const, mode: 'resume' as const }
    }
    return { kind: 'resume-ready' as const, attemptId: loaded.metadata.attemptId }
  }
  if (loaded.status !== 'absent') return { kind: 'none' as const }
  const orphanKeys = evidence.filter(({ key }) => key.startsWith(V9_BACKUP_PREFIX)).map(({ key }) => key)
  if (orphanKeys.length === 0) return { kind: 'none' as const }
  if (orphanKeys.length !== 1 || unexpectedV9Evidence(evidence, new Set(orphanKeys))) {
    return { kind: 'blocked' as const, mode: 'orphan' as const }
  }
  const verified = await verifiedUpgradeBackup(storage, orphanKeys[0])
  if (!verified || !(await sourceMatches(storage, verified.backup))) {
    return { kind: 'blocked' as const, mode: 'orphan' as const }
  }
  return { kind: 'orphan-ready' as const, attemptId: verified.backup.attemptId }
}

/** Read-only inspection. It never mounts a Host or mutates storage or selection. */
export async function inspectFormalV9Recovery(storage: ReadStorage): Promise<FormalV9RecoverySnapshot> {
  let first: Awaited<ReturnType<typeof captureEvidence>>
  let runtimeDecision: FormalRuntimeDecision
  try {
    first = await captureEvidence(storage)
    runtimeDecision = await inspectFormalRuntime(storage)
  } catch {
    return snapshot('read-error', runtimeReadError(), null, [])
  }
  const finish = async (result: FormalV9RecoverySnapshot) => {
    try {
      const final = await captureEvidence(storage)
      return final.identity === first.identity ? result
        : snapshot('ambiguous', runtimeDecision, final.identity, final.entries)
    } catch { return snapshot('read-error', runtimeReadError(), null, []) }
  }
  const loadedV9 = loadAppDataV9(storage)
  if (first.entries.some(({ role }) => role === 'unknown')
    || (loadedV9.status !== 'active'
      && first.entries.some(({ key }) => key.startsWith(V9_AUTO_BACKUP_PREFIX)))) {
    return finish(snapshot('ambiguous', runtimeDecision, first.identity, first.entries))
  }
  const recovery = await inspectUpgradeRecovery(storage, first.entries)
  if (recovery.kind === 'resume-ready') return finish(snapshot('resume-ready', runtimeDecision,
    first.identity, first.entries, { recoveryAttemptId: recovery.attemptId }))
  if (recovery.kind === 'orphan-ready') return finish(snapshot('orphan-ready', runtimeDecision,
    first.identity, first.entries, { recoveryAttemptId: recovery.attemptId }))
  if (recovery.kind === 'blocked' && recovery.mode === 'orphan'
    && first.entries.filter(({ key }) => key.startsWith(V9_BACKUP_PREFIX)).length > 1) {
    return finish(snapshot('ambiguous', runtimeDecision, first.identity, first.entries))
  }
  if (loadedV9.status !== 'absent') {
    return finish(snapshot('export-only', runtimeDecision, first.identity, first.entries))
  }
  const v8 = loadAppDataV8Only(storage, createEmptyAppDataV8())
  if (v8.rawV8 !== null && (await checkV8HostWriteEligibility(storage, v8.rawV8)).eligible) {
    const plan = inspectSubjectMigrationV9(v8.value)
    return finish(snapshot('migration-ready', runtimeDecision, first.identity, first.entries,
      { migration: { sourceRaw: v8.rawV8, plan } }))
  }
  return finish(snapshot('export-only', runtimeDecision, first.identity, first.entries))
}

export interface FormalV9RecoveryExportPort {
  entries: ReadonlyArray<{ key: string; role: FormalV9RecoveryEvidenceRole }>
  readExact: (key: string) => string | null
}

/** Snapshot-bound raw export. It never rereads or writes active storage. */
export function createFormalV9RecoveryExportPort(value: FormalV9RecoverySnapshot): FormalV9RecoveryExportPort {
  const exact = new Map(value.evidence.map(({ key, raw }) => [key, raw]))
  return {
    entries: value.evidence.map(({ key, role }) => ({ key, role })),
    readExact: (key) => exact.get(key) ?? null,
  }
}

export type FormalV9RecoveryActionResult =
  | { ok: true; runtimeDecision: Extract<FormalRuntimeDecision, { runtime: 'v9' }> }
  | { ok: false; code: 'capability-unavailable' | 'snapshot-stale' | 'confirmation-required'
    | 'export-evidence-mismatch' | 'invalid-decisions' | 'service-failed' | 'runtime-blocked'
    serviceCode?: string; runtimeDecision?: FormalRuntimeDecision }

/** Explicit post-recovery Runtime Gate. Callers may mount V9 only for the successful result. */
export async function reinspectFormalV9RecoveryRuntime(storage: ReadStorage): Promise<FormalV9RecoveryActionResult> {
  const runtimeDecision = await inspectFormalRuntime(storage)
  return runtimeDecision.runtime === 'v9' ? { ok: true, runtimeDecision }
    : { ok: false, code: 'runtime-blocked', runtimeDecision }
}

/** Owns no Host and performs no direct writes; mutations stay inside the existing verified services. */
export function createFormalV9RecoveryCoordinator(storage: RecoveryStorage) {
  const invalidated = new WeakSet<FormalV9RecoverySnapshot>()
  const current = async (expected: FormalV9RecoverySnapshot, kind: FormalV9RecoverySnapshotKind) => {
    if (invalidated.has(expected) || expected.kind !== kind || expected.evidenceIdentity === null) return false
    const live = await inspectFormalV9Recovery(storage)
    return live.kind === kind && live.evidenceIdentity === expected.evidenceIdentity
      && live.recoveryAttemptId === expected.recoveryAttemptId
  }
  return {
    inspect: () => inspectFormalV9Recovery(storage),
    export: (value: FormalV9RecoverySnapshot) => createFormalV9RecoveryExportPort(value),
    invalidate: (value: FormalV9RecoverySnapshot) => { invalidated.add(value) },
    activate: async (value: FormalV9RecoverySnapshot, input: {
      attemptId: string
      createdAt: string
      decisions: readonly SubjectMigrationDecisionV9[]
      externalExportRaw: string
      externalExportDigest: `sha256:${string}`
      userConfirmedExternalBackup: boolean
    }): Promise<FormalV9RecoveryActionResult> => {
      if (!value.capabilities.activate || !value.migration) return { ok: false, code: 'capability-unavailable' }
      if (input.userConfirmedExternalBackup !== true) return { ok: false, code: 'confirmation-required' }
      if (!(await current(value, 'migration-ready'))) return { ok: false, code: 'snapshot-stale' }
      if (input.externalExportRaw !== value.migration.sourceRaw
        || await fingerprintV7Raw(input.externalExportRaw) !== input.externalExportDigest) {
        return { ok: false, code: 'export-evidence-mismatch' }
      }
      if (value.migration.plan.entries.some((entry) => entry.classification === 'invalid-or-ambiguous')) {
        return { ok: false, code: 'invalid-decisions' }
      }
      const candidate = buildSubjectMigrationCandidateV9(parseAppDataV8Raw(value.migration.sourceRaw), input.decisions)
      if (!candidate.ok) return { ok: false, code: 'invalid-decisions' }
      const result = await activateTimetableSubjectsV9(storage, { attemptId: input.attemptId, createdAt: input.createdAt,
        expectedV8Raw: value.migration.sourceRaw, candidate: candidate.candidate, decisions: input.decisions,
        confirmedExternalV8Digest: input.externalExportDigest, userConfirmedExternalBackup: true })
      if (!result.ok) return { ok: false, code: 'service-failed', serviceCode: result.code }
      return reinspectFormalV9RecoveryRuntime(storage)
    },
    resume: async (value: FormalV9RecoverySnapshot,
      input: { userConfirmed: boolean }): Promise<FormalV9RecoveryActionResult> => {
      if (!value.capabilities.resume) return { ok: false, code: 'capability-unavailable' }
      if (input.userConfirmed !== true) return { ok: false, code: 'confirmation-required' }
      if (!(await current(value, 'resume-ready'))) return { ok: false, code: 'snapshot-stale' }
      const result = await resumeTimetableSubjectsV9(storage)
      if (!result.ok) return { ok: false, code: 'service-failed', serviceCode: result.code }
      return reinspectFormalV9RecoveryRuntime(storage)
    },
    resumeOrphan: async (value: FormalV9RecoverySnapshot,
      input: { userConfirmed: boolean }): Promise<FormalV9RecoveryActionResult> => {
      if (!value.capabilities.resumeOrphan || !value.recoveryAttemptId) {
        return { ok: false, code: 'capability-unavailable' }
      }
      if (input.userConfirmed !== true) return { ok: false, code: 'confirmation-required' }
      if (!(await current(value, 'orphan-ready'))) return { ok: false, code: 'snapshot-stale' }
      const result = await resumeOrphanedSubjectUpgradeV9(storage, value.recoveryAttemptId)
      if (!result.ok) return { ok: false, code: 'service-failed', serviceCode: result.code }
      return reinspectFormalV9RecoveryRuntime(storage)
    },
  }
}

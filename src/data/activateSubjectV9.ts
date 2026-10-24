import type { AppDataV9 } from '../types/v9'
import { parseAppDataV8Raw } from './storageV8'
import { buildSubjectMigrationCandidateV9, type SubjectMigrationDecisionV9 } from './subjectMigrationCandidateV9'
import { fingerprintV7Raw, V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY,
  APP_DATA_V8_ACTIVATION_KEY } from './activationV8'
import { withV8StorageLock } from './v8Coordination'
import { checkV8HostWriteEligibility } from '../hooks/useAppDataV8'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY } from './storageV8'
import { isCompatibleAppDataV9 } from './validators/v9'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_BACKUP_PREFIX,
  checkV9WriteEvidence, isV9ActivationRecord, loadAppDataV9, type V9ActivationRecord,
  type V9BackupRecord } from './storageV9'

export type V9ActivationFailure = 'invalid-input' | 'lock-unavailable' | 'source-changed'
  | 'source-inactive' | 'already-started' | 'backup-failed' | 'preparing-failed'
  | 'document-failed' | 'active-failed' | 'read-error' | 'digest-failed'
export type V9ActivationResult =
  | { ok: true; metadata: V9ActivationRecord; rawDocument: string; backupKey: string }
  | { ok: false; code: V9ActivationFailure; backupKey: string | null }

type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>
const validTime = (value: string) => !Number.isNaN(Date.parse(value))
  && new Date(value).toISOString() === value

/** Explicit, non-retrying activation. No existing V7 or V8 key is ever written. */
export async function activateTimetableSubjectsV9(storage: StorageAccess, input: {
  attemptId: string
  createdAt: string
  expectedV8Raw: string
  candidate: AppDataV9
  decisions: readonly SubjectMigrationDecisionV9[]
  confirmedExternalV8Digest: `sha256:${string}`
  userConfirmedExternalBackup: true
}): Promise<V9ActivationResult> {
  const key = `${V9_BACKUP_PREFIX}${input.attemptId}`
  const fail = (code: V9ActivationFailure, backupKey: string | null = null): V9ActivationResult =>
    ({ ok: false, code, backupKey })
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.attemptId) || !validTime(input.createdAt)
    || !isCompatibleAppDataV9(input.candidate)
    || input.userConfirmedExternalBackup !== true
    || !/^sha256:[0-9a-f]{64}$/.test(input.confirmedExternalV8Digest)) {
    return fail('invalid-input')
  }
  try {
    return await withV8StorageLock(async () => {
      let rawV8: string | null
      let rawV7: string | null
      let bootstrapRaw: string | null
      let transactionRaw: string | null
      try {
        rawV8 = storage.getItem(APP_DATA_V8_KEY)
        rawV7 = storage.getItem(APP_DATA_V7_KEY)
        bootstrapRaw = storage.getItem(V8_BOOTSTRAP_KEY)
        transactionRaw = storage.getItem(V8_TRANSACTION_KEY)
        if (storage.getItem(APP_DATA_V9_KEY) !== null || storage.getItem(V9_ACTIVATION_KEY) !== null
          || storage.getItem(key) !== null) return fail('already-started')
        for (let index = 0; index < storage.length; index += 1) {
          if (storage.key(index)?.startsWith(V9_BACKUP_PREFIX)) return fail('already-started')
        }
      } catch { return fail('read-error') }
      if (rawV8 === null || rawV8 !== input.expectedV8Raw) return fail('source-changed')
      if (!(await checkV8HostWriteEligibility(storage, rawV8)).eligible) return fail('source-inactive')
      try {
        const rebuilt = buildSubjectMigrationCandidateV9(parseAppDataV8Raw(rawV8), input.decisions)
        if (!rebuilt.ok || JSON.stringify(rebuilt.candidate) !== JSON.stringify(input.candidate)) {
          return fail('invalid-input')
        }
      } catch { return fail('invalid-input') }
      const sourceActivationKey = bootstrapRaw !== null ? V8_BOOTSTRAP_KEY : V8_TRANSACTION_KEY
      const sourceActivationRaw = bootstrapRaw ?? transactionRaw
      if (sourceActivationRaw === null) return fail('source-inactive')
      let sourceV8Digest: `sha256:${string}`
      let sourceActivationDigest: `sha256:${string}`
      let sourceV7Digest: `sha256:${string}` | null
      let candidateDigest: `sha256:${string}`
      const candidateRaw = JSON.stringify(input.candidate)
      try {
        sourceV8Digest = await fingerprintV7Raw(rawV8)
        sourceActivationDigest = await fingerprintV7Raw(sourceActivationRaw)
        sourceV7Digest = rawV7 === null ? null : await fingerprintV7Raw(rawV7)
        candidateDigest = await fingerprintV7Raw(candidateRaw)
      } catch { return fail('digest-failed') }
      if (sourceV8Digest !== input.confirmedExternalV8Digest) return fail('source-changed')
      const unchanged = () => storage.getItem(APP_DATA_V8_KEY) === rawV8
        && storage.getItem(sourceActivationKey) === sourceActivationRaw
        && storage.getItem(APP_DATA_V7_KEY) === rawV7
        && storage.getItem(APP_DATA_V9_KEY) === null
        && storage.getItem(V9_ACTIVATION_KEY) === null
        && storage.getItem(key) === null
      const backup: V9BackupRecord = { schemaVersion: 1, kind: 'timetable-subject-upgrade-backup',
        attemptId: input.attemptId, sourceV8Key: APP_DATA_V8_KEY, sourceV8Raw: rawV8, sourceV8Digest,
        sourceActivationKey, sourceActivationRaw, sourceActivationDigest, sourceV7Digest,
        candidateRaw, candidateDigest, decisions: input.decisions.map((item) => ({
          sourceSubjectId: item.sourceSubjectId,
          owners: item.owners.map((owner) => ({ ...owner })),
          relations: item.relations.map((relation) => ({ ...relation })),
        })),
        createdAt: input.createdAt }
      const backupRaw = JSON.stringify(backup)
      try {
        if (!unchanged()) return fail('source-changed')
        storage.setItem(key, backupRaw)
        if (storage.getItem(key) !== backupRaw) return fail('backup-failed', key)
        const parsed: V9BackupRecord = JSON.parse(storage.getItem(key)!)
        if (JSON.stringify(parsed) !== backupRaw || parsed.sourceV8Raw !== rawV8
          || parsed.sourceActivationRaw !== sourceActivationRaw
          || await fingerprintV7Raw(parsed.sourceV8Raw) !== sourceV8Digest
          || await fingerprintV7Raw(parsed.sourceActivationRaw) !== sourceActivationDigest) {
          return fail('backup-failed', key)
        }
      } catch { return fail('backup-failed', key) }
      const metadata: V9ActivationRecord = {
        schemaVersion: 1, kind: 'timetable-subject-upgrade', attemptId: input.attemptId,
        status: 'preparing', sourceV8Digest, sourceActivationKey, sourceActivationDigest,
        sourceV7Digest, backupKey: key, initialDigest: candidateDigest,
        currentDigest: candidateDigest, documentRevision: 0, createdAt: input.createdAt,
        updatedAt: input.createdAt, activatedAt: null,
      }
      if (!isV9ActivationRecord(metadata)) return fail('invalid-input', key)
      try {
        if (storage.getItem(APP_DATA_V8_KEY) !== rawV8
          || storage.getItem(sourceActivationKey) !== sourceActivationRaw
          || storage.getItem(APP_DATA_V7_KEY) !== rawV7
          || storage.getItem(V9_ACTIVATION_KEY) !== null) return fail('source-changed', key)
        const preparingRaw = JSON.stringify(metadata)
        storage.setItem(V9_ACTIVATION_KEY, preparingRaw)
        if (storage.getItem(V9_ACTIVATION_KEY) !== preparingRaw) return fail('preparing-failed', key)
      } catch { return fail('preparing-failed', key) }
      try {
        if (storage.getItem(APP_DATA_V9_KEY) !== null) return fail('document-failed', key)
        storage.setItem(APP_DATA_V9_KEY, candidateRaw)
        if (storage.getItem(APP_DATA_V9_KEY) !== candidateRaw) return fail('document-failed', key)
      } catch { return fail('document-failed', key) }
      const active: V9ActivationRecord = { ...metadata, status: 'active', activatedAt: input.createdAt }
      try {
        if (storage.getItem(APP_DATA_V8_KEY) !== rawV8
          || storage.getItem(sourceActivationKey) !== sourceActivationRaw
          || storage.getItem(APP_DATA_V7_KEY) !== rawV7
          || storage.getItem(APP_DATA_V9_KEY) !== candidateRaw
          || storage.getItem(V9_ACTIVATION_KEY) !== JSON.stringify(metadata)) {
          return fail('source-changed', key)
        }
        storage.setItem(V9_ACTIVATION_KEY, JSON.stringify(active))
        if (!(await checkV9WriteEvidence(storage, candidateRaw, JSON.stringify(active)))) {
          return fail('active-failed', key)
        }
      } catch { return fail('active-failed', key) }
      return { ok: true, metadata: active, rawDocument: candidateRaw, backupKey: key }
    })
  } catch { return fail('lock-unavailable') }
}

export type V9ResumeResult = { ok: true; rawDocument: string; metadata: V9ActivationRecord }
  | { ok: false; code: 'not-interrupted' | 'backup-invalid' | 'source-changed'
    | 'candidate-invalid' | 'document-conflict' | 'write-failed' | 'readback-failed' | 'lock-unavailable' }

/** Explicit recovery: resume only the exact candidate and decisions saved before preparing. */
export async function resumeTimetableSubjectsV9(storage: StorageAccess): Promise<V9ResumeResult> {
  const fail = (code: Extract<V9ResumeResult, { ok: false }>['code']): V9ResumeResult => ({ ok: false, code })
  try {
    return await withV8StorageLock(async () => {
      const loaded = loadAppDataV9(storage)
      if ((loaded.status !== 'preparing' && loaded.status !== 'interrupted')
        || !loaded.metadata || !loaded.rawMetadata) return fail('not-interrupted')
      const meta = loaded.metadata
      let backup: V9BackupRecord
      try {
        const raw = storage.getItem(meta.backupKey)
        if (!raw) return fail('backup-invalid')
        backup = JSON.parse(raw)
        if (backup.schemaVersion !== 1 || backup.kind !== 'timetable-subject-upgrade-backup'
          || backup.attemptId !== meta.attemptId || backup.sourceV8Key !== APP_DATA_V8_KEY
          || backup.sourceV8Digest !== meta.sourceV8Digest
          || backup.sourceActivationKey !== meta.sourceActivationKey
          || backup.sourceActivationDigest !== meta.sourceActivationDigest
          || backup.sourceV7Digest !== meta.sourceV7Digest
          || backup.createdAt !== meta.createdAt
          || backup.candidateDigest !== meta.initialDigest || !Array.isArray(backup.decisions)
          || await fingerprintV7Raw(backup.sourceV8Raw) !== meta.sourceV8Digest
          || await fingerprintV7Raw(backup.sourceActivationRaw) !== meta.sourceActivationDigest
          || await fingerprintV7Raw(backup.candidateRaw) !== meta.initialDigest) return fail('backup-invalid')
      } catch { return fail('backup-invalid') }
      try {
        const candidate = buildSubjectMigrationCandidateV9(parseAppDataV8Raw(backup.sourceV8Raw), backup.decisions)
        if (!candidate.ok || JSON.stringify(candidate.candidate) !== backup.candidateRaw) {
          return fail('candidate-invalid')
        }
      } catch { return fail('candidate-invalid') }
      const v7Raw = storage.getItem(APP_DATA_V7_KEY)
      if (storage.getItem(APP_DATA_V8_KEY) !== backup.sourceV8Raw
        || storage.getItem(meta.sourceActivationKey) !== backup.sourceActivationRaw
        || storage.getItem(meta.sourceActivationKey === V8_BOOTSTRAP_KEY ? V8_TRANSACTION_KEY : V8_BOOTSTRAP_KEY) !== null
        || storage.getItem(APP_DATA_V8_ACTIVATION_KEY) !== null
        || (v7Raw === null ? null : await fingerprintV7Raw(v7Raw)) !== meta.sourceV7Digest
        || storage.getItem(V9_ACTIVATION_KEY) !== loaded.rawMetadata) return fail('source-changed')
      if (loaded.rawDocument !== null && loaded.rawDocument !== backup.candidateRaw) return fail('document-conflict')
      if (loaded.rawDocument === null) {
        try { storage.setItem(APP_DATA_V9_KEY, backup.candidateRaw) }
        catch { return fail('write-failed') }
        if (storage.getItem(APP_DATA_V9_KEY) !== backup.candidateRaw) return fail('readback-failed')
      }
      const now = new Date(Math.max(Date.now(), Date.parse(meta.updatedAt))).toISOString()
      const active: V9ActivationRecord = { ...meta, status: 'active', updatedAt: now, activatedAt: now }
      if (!isV9ActivationRecord(active)
        || storage.getItem(APP_DATA_V8_KEY) !== backup.sourceV8Raw
        || storage.getItem(meta.sourceActivationKey) !== backup.sourceActivationRaw
        || storage.getItem(V9_ACTIVATION_KEY) !== loaded.rawMetadata
        || storage.getItem(APP_DATA_V9_KEY) !== backup.candidateRaw) return fail('source-changed')
      try { storage.setItem(V9_ACTIVATION_KEY, JSON.stringify(active)) }
      catch { return fail('write-failed') }
      if (!(await checkV9WriteEvidence(storage, backup.candidateRaw, JSON.stringify(active)))) {
        return fail('readback-failed')
      }
      return { ok: true, rawDocument: backup.candidateRaw, metadata: active }
    })
  } catch { return fail('lock-unavailable') }
}

/** Recovery for a verified backup left behind before preparing metadata was written. */
export async function resumeOrphanedSubjectUpgradeV9(storage: StorageAccess,
  attemptId: string): Promise<V9ResumeResult> {
  const fail = (code: Extract<V9ResumeResult, { ok: false }>['code']): V9ResumeResult => ({ ok: false, code })
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(attemptId)) return fail('backup-invalid')
  const backupKey = `${V9_BACKUP_PREFIX}${attemptId}`
  try {
    const prepared = await withV8StorageLock(async () => {
      if (loadAppDataV9(storage).status !== 'absent') return fail('not-interrupted')
      const orphanKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
        .filter((key): key is string => key !== null && key.startsWith(V9_BACKUP_PREFIX))
      if (orphanKeys.length !== 1 || orphanKeys[0] !== backupKey) return fail('backup-invalid')
      let backup: V9BackupRecord
      try {
        const raw = storage.getItem(backupKey)
        if (!raw) return fail('backup-invalid')
        backup = JSON.parse(raw)
        if (backup.schemaVersion !== 1 || backup.kind !== 'timetable-subject-upgrade-backup'
          || backup.attemptId !== attemptId || backup.sourceV8Key !== APP_DATA_V8_KEY
          || ![V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY].includes(backup.sourceActivationKey)
          || !Array.isArray(backup.decisions)
          || await fingerprintV7Raw(backup.sourceV8Raw) !== backup.sourceV8Digest
          || await fingerprintV7Raw(backup.sourceActivationRaw) !== backup.sourceActivationDigest
          || await fingerprintV7Raw(backup.candidateRaw) !== backup.candidateDigest) return fail('backup-invalid')
        const candidate = buildSubjectMigrationCandidateV9(parseAppDataV8Raw(backup.sourceV8Raw), backup.decisions)
        if (!candidate.ok || JSON.stringify(candidate.candidate) !== backup.candidateRaw) {
          return fail('candidate-invalid')
        }
      } catch { return fail('backup-invalid') }
      const v7 = storage.getItem(APP_DATA_V7_KEY)
      if (storage.getItem(APP_DATA_V8_KEY) !== backup.sourceV8Raw
        || storage.getItem(backup.sourceActivationKey) !== backup.sourceActivationRaw
        || storage.getItem(backup.sourceActivationKey === V8_BOOTSTRAP_KEY ? V8_TRANSACTION_KEY : V8_BOOTSTRAP_KEY) !== null
        || storage.getItem(APP_DATA_V8_ACTIVATION_KEY) !== null
        || (v7 === null ? null : await fingerprintV7Raw(v7)) !== backup.sourceV7Digest) {
        return fail('source-changed')
      }
      const metadata: V9ActivationRecord = { schemaVersion: 1, kind: 'timetable-subject-upgrade',
        attemptId, status: 'preparing', sourceV8Digest: backup.sourceV8Digest,
        sourceActivationKey: backup.sourceActivationKey,
        sourceActivationDigest: backup.sourceActivationDigest, sourceV7Digest: backup.sourceV7Digest,
        backupKey, initialDigest: backup.candidateDigest, currentDigest: backup.candidateDigest,
        documentRevision: 0, createdAt: backup.createdAt, updatedAt: backup.createdAt,
        activatedAt: null }
      if (!isV9ActivationRecord(metadata) || storage.getItem(V9_ACTIVATION_KEY) !== null
        || storage.getItem(APP_DATA_V9_KEY) !== null) return fail('source-changed')
      try { storage.setItem(V9_ACTIVATION_KEY, JSON.stringify(metadata)) }
      catch { return fail('write-failed') }
      if (storage.getItem(V9_ACTIVATION_KEY) !== JSON.stringify(metadata)) return fail('readback-failed')
      return null
    })
    return prepared ?? resumeTimetableSubjectsV9(storage)
  } catch { return fail('lock-unavailable') }
}

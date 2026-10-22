import type { StorageStatus } from '../hooks/useLocalStorage'
import type { AppDataV7, AppDataV8 } from '../types'
import { upgradeLegacyV8EventOwnership } from './eventOwnershipV8'
import type { V8MigrationPreflightReport, V8MigrationReconciliationReport } from './migrationPreflightV8'
import {
  migrateV7ToV8WithReport,
  upgradeLegacyV8TeachingUnitSubjects,
  V8MigrationError,
  type V8MigrationErrorCode,
} from './migrationsV8'
import { APP_DATA_V7_KEY, loadAppDataV7, type AppDataV7LoadResult } from './storageV7'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from './validators/v8'

export const APP_DATA_V8_KEY = 'aster-timetable-data-v8'

export type AppDataV8LoadIssue = 'none' | 'missing' | 'corrupt' | 'read-failure' | 'migration-failure' | 'version-conflict'

export interface AppDataV8LoadResult {
  value: AppDataV8
  status: StorageStatus
  source: 'v8' | AppDataV7LoadResult['source']
  issue: AppDataV8LoadIssue
  /** Exact v8 document read from storage; null while migrating from an older key. */
  raw: string | null
  rawBackup: string | null
  shouldPersist: boolean
  /** Exact v7 snapshot observed before migration, used to reject older-tab writes. */
  legacyGuardRaw: string | null
  /** Structured, read-only evidence for a V7 migration attempt. */
  migration?: {
    preflight: V8MigrationPreflightReport
    reconciliation: V8MigrationReconciliationReport | null
  }
  migrationFailure?: {
    code: V8MigrationErrorCode
    message: string
    entityId?: string
    subjectId?: string
  }
}

export type AppDataV8StorageErrorCode =
  | 'invalid-current'
  | 'invalid-next'
  | 'unsafe-update'
  | 'stale-revision'
  | 'stale-document'
  | 'legacy-conflict'
  | 'read-failure'
  | 'write-failure'
  | 'write-unconfirmed'

export class AppDataV8StorageError extends Error {
  constructor(public readonly code: AppDataV8StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AppDataV8StorageError'
  }
}

export interface AppDataV8WriteExpectation {
  /** Exact v8 raw document on which the update was based. */
  raw: string | null
  /** Exact v7 raw document observed when this v8 session loaded. */
  legacyGuardRaw: string | null
  /** Persistence revision at which the operation began. */
  revision: number
}

export interface AppDataV8WriteConfirmation {
  raw: string
  revision: number
}

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'getItem' | 'setItem'>

const failure = (code: AppDataV8StorageErrorCode, message: string, cause?: unknown) => new AppDataV8StorageError(
  code, message, cause === undefined ? undefined : { cause },
)

export function loadAppDataV8(storage: ReadStorage, initialValue: AppDataV8): AppDataV8LoadResult {
  let raw: string | null = null
  let legacyGuardRaw: string | null = null
  try {
    raw = storage.getItem(APP_DATA_V8_KEY)
    legacyGuardRaw = storage.getItem(APP_DATA_V7_KEY)
  } catch {
    return {
      value: initialValue, status: 'read-error', source: 'v8', issue: 'read-failure', raw,
      rawBackup: raw, shouldPersist: false, legacyGuardRaw,
    }
  }

  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      const upgraded = upgradeLegacyV8TeachingUnitSubjects(upgradeLegacyV8EventOwnership(parsed))
      if (!isCompatibleAppDataV8(upgraded)) throw new Error('Invalid AppData v8')
      return {
        value: upgraded, status: 'saved', source: 'v8', issue: 'none', raw,
        rawBackup: raw, shouldPersist: JSON.stringify(upgraded) !== JSON.stringify(parsed), legacyGuardRaw,
      }
    } catch {
      return {
        value: initialValue, status: 'read-error', source: 'v8', issue: 'corrupt', raw,
        rawBackup: raw, shouldPersist: false, legacyGuardRaw,
      }
    }
  }

  const { teachingProgress: _unusedProgress, teachingUnitSubjects: _unusedRelations, ...initialFields } = initialValue
  void _unusedProgress
  void _unusedRelations
  const legacy = loadAppDataV7(storage, { ...initialFields, schemaVersion: 7 } as AppDataV7)
  if (legacy.status !== 'saved') return {
    value: initialValue,
    status: legacy.status,
    source: legacy.source,
    issue: legacy.rawBackup === null ? 'read-failure' : 'corrupt',
    raw: null,
    rawBackup: legacy.rawBackup,
    shouldPersist: false,
    legacyGuardRaw,
  }

  if (legacy.source === 'initial') return {
    value: initialValue,
    status: 'saved',
    source: 'initial',
    issue: 'missing',
    raw: null,
    rawBackup: legacy.rawBackup,
    shouldPersist: true,
    legacyGuardRaw,
  }

  let migration: ReturnType<typeof migrateV7ToV8WithReport>
  try {
    migration = migrateV7ToV8WithReport(legacy.value)
  } catch (cause) {
    return {
      value: initialValue, status: 'read-error', source: legacy.source, issue: 'migration-failure', raw: null,
      rawBackup: legacy.rawBackup, shouldPersist: false, legacyGuardRaw,
      ...(cause instanceof V8MigrationError && cause.preflight
        ? { migration: { preflight: cause.preflight, reconciliation: cause.reconciliation ?? null } }
        : {}),
      ...(cause instanceof V8MigrationError ? { migrationFailure: {
        code: cause.code,
        message: cause.message,
        ...(cause.entityId ? { entityId: cause.entityId } : {}),
        ...(cause.subjectId ? { subjectId: cause.subjectId } : {}),
      } } : {}),
    }
  }

  try {
    const latestV8Raw = storage.getItem(APP_DATA_V8_KEY)
    const latestV7Raw = storage.getItem(APP_DATA_V7_KEY)
    if (latestV8Raw !== null || latestV7Raw !== legacyGuardRaw) return {
      value: initialValue, status: 'conflict', source: latestV8Raw === null ? 'v7' : 'v8',
      issue: 'version-conflict', raw: latestV8Raw, rawBackup: latestV8Raw ?? latestV7Raw,
      shouldPersist: false, legacyGuardRaw,
    }
  } catch {
    return {
      value: initialValue, status: 'read-error', source: legacy.source, issue: 'read-failure', raw: null,
      rawBackup: legacy.rawBackup, shouldPersist: false, legacyGuardRaw,
    }
  }

  return {
    value: migration.data,
    status: 'saved',
    source: legacy.source,
    issue: 'none',
    raw: null,
    rawBackup: legacy.rawBackup,
    shouldPersist: true,
    legacyGuardRaw,
    migration: { preflight: migration.preflight, reconciliation: migration.reconciliation },
  }
}

export function persistAppDataV8(
  storage: WriteStorage,
  current: AppDataV8,
  next: AppDataV8,
  expectation: AppDataV8WriteExpectation,
  confirmedRevision: number,
): AppDataV8WriteConfirmation {
  if (!isCompatibleAppDataV8(current)) throw failure('invalid-current', 'Refusing to update from invalid AppData v8')
  if (!isCompatibleAppDataV8(next)) throw failure('invalid-next', 'Refusing to persist invalid AppData v8')
  if (!isSafeAppDataV8Update(current, next)) throw failure('unsafe-update', 'Refusing an unsafe AppData v8 update')
  if (!Number.isSafeInteger(expectation.revision) || expectation.revision < 0
    || expectation.revision !== confirmedRevision) throw failure('stale-revision', 'AppData v8 persistence revision is stale')

  if (expectation.raw !== null) {
    try {
      const expected: unknown = JSON.parse(expectation.raw)
      const upgradedExpected = upgradeLegacyV8TeachingUnitSubjects(upgradeLegacyV8EventOwnership(expected))
      if (!isCompatibleAppDataV8(upgradedExpected) || JSON.stringify(upgradedExpected) !== JSON.stringify(current)) {
        throw failure('stale-document', 'Expected AppData v8 document does not match the current update base')
      }
    } catch (cause) {
      if (cause instanceof AppDataV8StorageError) throw cause
      throw failure('stale-document', 'Expected AppData v8 document is invalid', cause)
    }
  }

  let storedRaw: string | null
  let storedLegacyRaw: string | null
  try {
    storedRaw = storage.getItem(APP_DATA_V8_KEY)
    storedLegacyRaw = storage.getItem(APP_DATA_V7_KEY)
  } catch (cause) {
    throw failure('read-failure', 'Unable to verify AppData v8 before writing', cause)
  }
  if (storedRaw !== expectation.raw) throw failure('stale-document', 'Stored AppData v8 changed before writing')
  if (storedLegacyRaw !== expectation.legacyGuardRaw) throw failure('legacy-conflict', 'Stored AppData v7 changed before writing')

  const raw = JSON.stringify(next)
  try {
    storage.setItem(APP_DATA_V8_KEY, raw)
  } catch (cause) {
    throw failure('write-failure', 'Unable to persist AppData v8', cause)
  }
  try {
    if (storage.getItem(APP_DATA_V8_KEY) !== raw) throw failure('write-unconfirmed', 'AppData v8 write could not be confirmed')
  } catch (cause) {
    if (cause instanceof AppDataV8StorageError) throw cause
    throw failure('write-unconfirmed', 'AppData v8 write could not be confirmed', cause)
  }
  return { raw, revision: confirmedRevision + 1 }
}

export function persistLoadedAppDataV8(
  storage: WriteStorage,
  result: AppDataV8LoadResult,
  revision = 0,
): AppDataV8WriteConfirmation | null {
  if (result.status !== 'saved' || !result.shouldPersist) return null
  return persistAppDataV8(storage, result.value, result.value, {
    raw: result.raw,
    legacyGuardRaw: result.legacyGuardRaw,
    revision,
  }, revision)
}

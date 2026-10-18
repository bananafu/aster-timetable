import type { AppDataV6, AppDataV7 } from '../types'
import type { StorageStatus } from '../hooks/useLocalStorage'
import { migrateV6ToV7 } from './migrationsV7'
import { APP_DATA_V6_KEY, loadAppDataV6, type AppDataV6LoadResult } from './storageV6'
import { isCompatibleAppDataV7 } from './validators/v7'

export const APP_DATA_V7_KEY = 'aster-timetable-data-v7'

export interface AppDataV7LoadResult {
  value: AppDataV7
  status: StorageStatus
  source: 'v7' | AppDataV6LoadResult['source']
  rawBackup: string | null
  shouldPersist: boolean
  /** Exact v6 snapshot read before migration, used to detect an older tab's writes. */
  legacyGuardRaw: string | null
}

export function loadAppDataV7(storage: Pick<Storage, 'getItem'>, initialValue: AppDataV7): AppDataV7LoadResult {
  let raw: string | null = null
  let legacyGuardRaw: string | null = null
  try {
    raw = storage.getItem(APP_DATA_V7_KEY)
    legacyGuardRaw = storage.getItem(APP_DATA_V6_KEY)
  } catch {
    return { value: initialValue, status: 'read-error', source: 'v7', rawBackup: raw, shouldPersist: false, legacyGuardRaw }
  }
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isCompatibleAppDataV7(parsed)) throw new Error('Invalid AppData v7')
      return { value: parsed, status: 'saved', source: 'v7', rawBackup: raw, shouldPersist: false, legacyGuardRaw }
    } catch {
      return { value: initialValue, status: 'read-error', source: 'v7', rawBackup: raw, shouldPersist: false, legacyGuardRaw }
    }
  }
  const { oneOffLessons: _unused, ...initialFields } = initialValue
  void _unused
  const legacy = loadAppDataV6(storage, { ...initialFields, schemaVersion: 6 } as AppDataV6)
  if (legacy.status !== 'saved') return {
    value: initialValue, status: 'read-error', source: legacy.source, rawBackup: legacy.rawBackup,
    shouldPersist: false, legacyGuardRaw,
  }
  // A v6 tab writing between the guard read and the migration must not be silently lost.
  try {
    const latestV6Raw = storage.getItem(APP_DATA_V6_KEY)
    if (latestV6Raw !== legacyGuardRaw) return {
      value: initialValue, status: 'read-error', source: 'v6', rawBackup: latestV6Raw,
      shouldPersist: false, legacyGuardRaw,
    }
    return {
      value: migrateV6ToV7(legacy.value), status: 'saved', source: legacy.source,
      rawBackup: legacy.rawBackup, shouldPersist: true, legacyGuardRaw,
    }
  } catch {
    return { value: initialValue, status: 'read-error', source: legacy.source, rawBackup: legacy.rawBackup, shouldPersist: false, legacyGuardRaw }
  }
}

export function persistAppDataV7(storage: Pick<Storage, 'setItem'>, value: AppDataV7): void {
  if (!isCompatibleAppDataV7(value)) throw new Error('Refusing to persist invalid AppData v7')
  storage.setItem(APP_DATA_V7_KEY, JSON.stringify(value))
}

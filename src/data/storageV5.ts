import type { AppDataV4, AppDataV5 } from '../types'
import type { StorageStatus } from '../hooks/useLocalStorage'
import { migrateV4ToV5 } from './migrationsV5'
import { loadAppDataV4, type AppDataSource } from './storageV4'
import { isCompatibleAppDataV5, isAppDataV5 } from './validators/v5'

export const APP_DATA_V5_KEY = 'aster-timetable-data-v5'

export interface AppDataV5LoadResult {
  value: AppDataV5
  status: StorageStatus
  source: 'v5' | AppDataSource
  rawBackup: string | null
  shouldPersist: boolean
}

export function loadAppDataV5(storage: Pick<Storage, 'getItem'>, initialValue: AppDataV5): AppDataV5LoadResult {
  let raw: string | null
  try {
    raw = storage.getItem(APP_DATA_V5_KEY)
  } catch {
    return { value: initialValue, status: 'read-error', source: 'v5', rawBackup: null, shouldPersist: false }
  }
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isCompatibleAppDataV5(parsed)) throw new Error('Invalid AppData v5')
      return { value: parsed, status: 'saved', source: 'v5', rawBackup: raw, shouldPersist: false }
    } catch {
      return { value: initialValue, status: 'read-error', source: 'v5', rawBackup: raw, shouldPersist: false }
    }
  }

  const legacy = loadAppDataV4(storage, { ...initialValue, schemaVersion: 4 })
  if (legacy.status !== 'saved') return { ...legacy, value: initialValue }
  try {
    return {
      value: migrateV4ToV5(legacy.value), status: 'saved', source: legacy.source,
      rawBackup: legacy.rawBackup, shouldPersist: true,
    }
  } catch {
    return { value: initialValue, status: 'read-error', source: legacy.source, rawBackup: legacy.rawBackup, shouldPersist: false }
  }
}

export function persistAppDataV5(storage: Pick<Storage, 'setItem'>, value: AppDataV4): void {
  if (!isAppDataV5(value)) throw new Error('Refusing to persist invalid AppData v5')
  storage.setItem(APP_DATA_V5_KEY, JSON.stringify(value))
}

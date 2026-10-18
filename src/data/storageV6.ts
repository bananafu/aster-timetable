import type { AppDataV5, AppDataV6 } from '../types'
import type { StorageStatus } from '../hooks/useLocalStorage'
import { migrateV5ToV6 } from './migrationsV6'
import { loadAppDataV5, type AppDataV5LoadResult } from './storageV5'
import { isCompatibleAppDataV6 } from './validators/v6'

export const APP_DATA_V6_KEY = 'aster-timetable-data-v6'

export interface AppDataV6LoadResult {
  value: AppDataV6
  status: StorageStatus
  source: 'v6' | AppDataV5LoadResult['source']
  rawBackup: string | null
  shouldPersist: boolean
}

export function loadAppDataV6(storage: Pick<Storage, 'getItem'>, initialValue: AppDataV6): AppDataV6LoadResult {
  let raw: string | null
  try {
    raw = storage.getItem(APP_DATA_V6_KEY)
  } catch {
    return { value: initialValue, status: 'read-error', source: 'v6', rawBackup: null, shouldPersist: false }
  }
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!isCompatibleAppDataV6(parsed)) throw new Error('Invalid AppData v6')
      return { value: parsed, status: 'saved', source: 'v6', rawBackup: raw, shouldPersist: false }
    } catch {
      return { value: initialValue, status: 'read-error', source: 'v6', rawBackup: raw, shouldPersist: false }
    }
  }
  const legacy = loadAppDataV5(storage, { ...initialValue, schemaVersion: 5 } as AppDataV5)
  if (legacy.status !== 'saved') return { value: initialValue, status: 'read-error', source: legacy.source, rawBackup: legacy.rawBackup, shouldPersist: false }
  try {
    return { value: migrateV5ToV6(legacy.value), status: 'saved', source: legacy.source,
      rawBackup: legacy.rawBackup, shouldPersist: true }
  } catch {
    return { value: initialValue, status: 'read-error', source: legacy.source, rawBackup: legacy.rawBackup, shouldPersist: false }
  }
}

export function persistAppDataV6(storage: Pick<Storage, 'setItem'>, value: AppDataV6): void {
  if (!isCompatibleAppDataV6(value)) throw new Error('Refusing to persist invalid AppData v6')
  storage.setItem(APP_DATA_V6_KEY, JSON.stringify(value))
}

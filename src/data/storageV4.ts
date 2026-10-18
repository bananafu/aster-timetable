import type { AppDataV4 } from '../types'
import type { StorageStatus } from '../hooks/useLocalStorage'
import { isAppData, isLegacyAppDataV1, type LegacyAppDataV1 } from './migrations'
import { migrateV1ToV4, migrateV3ToV4 } from './migrationsV4'
import { isAppDataV4, isCompatibleAppDataV4 } from './validators/v4'

export const APP_DATA_V4_KEY = 'aster-timetable-data-v4'
export const APP_DATA_V3_KEY = 'aster-timetable-data-v3'
export const APP_DATA_V1_KEY = 'aster-timetable-data-v1'

export type AppDataSource = 'v4' | 'v3' | 'v1' | 'initial'

export interface AppDataV4LoadResult {
  value: AppDataV4
  status: StorageStatus
  source: AppDataSource
  rawBackup: string | null
  shouldPersist: boolean
}

function parse(raw: string): unknown {
  return JSON.parse(raw) as unknown
}

export function loadAppDataV4(storage: Pick<Storage, 'getItem'>, initialValue: AppDataV4): AppDataV4LoadResult {
  let v4Raw: string | null
  try {
    v4Raw = storage.getItem(APP_DATA_V4_KEY)
  } catch {
    return { value: initialValue, status: 'read-error', source: 'v4', rawBackup: null, shouldPersist: false }
  }
  if (v4Raw !== null) {
    try {
      const value = parse(v4Raw)
      if (!isCompatibleAppDataV4(value)) throw new Error('Invalid AppData v4')
      return { value, status: 'saved', source: 'v4', rawBackup: v4Raw, shouldPersist: false }
    } catch {
      return { value: initialValue, status: 'read-error', source: 'v4', rawBackup: v4Raw, shouldPersist: false }
    }
  }

  let v3Raw: string | null
  try {
    v3Raw = storage.getItem(APP_DATA_V3_KEY)
  } catch {
    return { value: initialValue, status: 'read-error', source: 'v3', rawBackup: null, shouldPersist: false }
  }
  if (v3Raw !== null) {
    try {
      const value = parse(v3Raw)
      if (!isAppData(value)) throw new Error('Invalid AppData v3')
      return { value: migrateV3ToV4(value), status: 'saved', source: 'v3', rawBackup: v3Raw, shouldPersist: true }
    } catch {
      return { value: initialValue, status: 'read-error', source: 'v3', rawBackup: v3Raw, shouldPersist: false }
    }
  }

  let v1Raw: string | null
  try {
    v1Raw = storage.getItem(APP_DATA_V1_KEY)
  } catch {
    return { value: initialValue, status: 'read-error', source: 'v1', rawBackup: null, shouldPersist: false }
  }
  if (v1Raw !== null) {
    try {
      const value = parse(v1Raw)
      if (!isLegacyAppDataV1(value)) throw new Error('Invalid AppData v1')
      return { value: migrateV1ToV4(value as LegacyAppDataV1), status: 'saved', source: 'v1', rawBackup: v1Raw, shouldPersist: true }
    } catch {
      return { value: initialValue, status: 'read-error', source: 'v1', rawBackup: v1Raw, shouldPersist: false }
    }
  }

  return { value: initialValue, status: 'saved', source: 'initial', rawBackup: null, shouldPersist: true }
}

export function persistAppDataV4(storage: Pick<Storage, 'setItem'>, value: AppDataV4): void {
  if (!isAppDataV4(value)) throw new Error('Refusing to persist invalid AppData v4')
  storage.setItem(APP_DATA_V4_KEY, JSON.stringify(value))
}

export function persistLoadedAppDataV4(storage: Pick<Storage, 'setItem'>, result: AppDataV4LoadResult): boolean {
  if (result.status !== 'saved' || !result.shouldPersist) return false
  persistAppDataV4(storage, result.value)
  return true
}

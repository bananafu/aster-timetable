import { useMemo } from 'react'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { APP_DATA_V6_KEY, loadAppDataV6 } from '../data/storageV6'
import { isCompatibleAppDataV6, isSafeAppDataV6Update } from '../data/validators/v6'
import type { AppDataV4, AppDataV5, AppDataV6 } from '../types'
import { useLocalStorage, type StorageLoadResult } from './useLocalStorage'

export function createInitialAppDataV4(): AppDataV5 {
  return {
    schemaVersion: 5,
    activeProjectId: null,
    projects: [],
    schools: [],
    teachingUnits: [],
    subjects: [],
    classes: [],
    recurringLessons: [],
    events: [],
    overrides: [],
    migrationWarnings: [],
  }
}

export function createExampleAppDataV4(): AppDataV5 {
  return migrateV4ToV5(migrateV3ToV4(initialData))
}

export function createInitialAppDataV6(): AppDataV6 {
  return { ...createInitialAppDataV4(), schemaVersion: 6, timetables: [], recurringLessons: [], overrides: [] }
}

export function useAppDataV4() {
  const initialValue = useMemo(createInitialAppDataV6, [])
  return useLocalStorage<AppDataV4>(APP_DATA_V6_KEY, initialValue, {
    validate: isCompatibleAppDataV6,
    validateUpdate: isSafeAppDataV6Update,
    loader: (storage) => {
      const result = loadAppDataV6(storage, initialValue)
      return {
        value: result.value,
        status: result.status,
        raw: result.source === 'v6' || result.status === 'read-error' ? result.rawBackup : null,
        rawBackup: result.source !== 'v6' ? result.rawBackup : undefined,
        shouldPersist: result.shouldPersist,
      } satisfies StorageLoadResult<AppDataV4>
    },
  })
}

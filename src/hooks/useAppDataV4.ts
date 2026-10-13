import { useMemo } from 'react'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { APP_DATA_V4_KEY, loadAppDataV4 } from '../data/storageV4'
import { isCompatibleAppDataV4, isSafeAppDataV4Update } from '../data/validators/v4'
import type { AppDataV4 } from '../types'
import { useLocalStorage, type StorageLoadResult } from './useLocalStorage'

export function createInitialAppDataV4(): AppDataV4 {
  return {
    schemaVersion: 4,
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

export function createExampleAppDataV4(): AppDataV4 {
  return migrateV3ToV4(initialData)
}

export function useAppDataV4() {
  const initialValue = useMemo(createInitialAppDataV4, [])
  return useLocalStorage<AppDataV4>(APP_DATA_V4_KEY, initialValue, {
    validate: isCompatibleAppDataV4,
    validateUpdate: isSafeAppDataV4Update,
    loader: (storage) => {
      const result = loadAppDataV4(storage, initialValue)
      return {
        value: result.value,
        status: result.status,
        raw: result.source === 'v4' || result.status === 'read-error' ? result.rawBackup : null,
        rawBackup: result.source === 'v3' || result.source === 'v1' ? result.rawBackup : undefined,
        shouldPersist: result.shouldPersist,
      } satisfies StorageLoadResult<AppDataV4>
    },
  })
}

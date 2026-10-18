import { useMemo } from 'react'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { APP_DATA_V6_KEY } from '../data/storageV6'
import { APP_DATA_V7_KEY, loadAppDataV7 } from '../data/storageV7'
import { isCompatibleAppDataV7, isSafeAppDataV7Update } from '../data/validators/v7'
import type { AppDataV4, AppDataV5, AppDataV6, AppDataV7 } from '../types'
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

export function createInitialAppDataV7(): AppDataV7 {
  return { ...createInitialAppDataV6(), schemaVersion: 7, oneOffLessons: [] }
}

export function useAppDataV4() {
  const initialValue = useMemo(createInitialAppDataV7, [])
  return useLocalStorage<AppDataV4>(APP_DATA_V7_KEY, initialValue, {
    validate: isCompatibleAppDataV7,
    validateUpdate: isSafeAppDataV7Update,
    legacyGuardKey: APP_DATA_V6_KEY,
    loader: (storage) => {
      const result = loadAppDataV7(storage, initialValue)
      return {
        value: result.value,
        status: result.status,
        raw: result.source === 'v7' || result.status === 'read-error' ? result.rawBackup : null,
        rawBackup: result.source !== 'v7' ? result.rawBackup : undefined,
        shouldPersist: result.shouldPersist,
        legacyGuardRaw: result.legacyGuardRaw,
      } satisfies StorageLoadResult<AppDataV4>
    },
  })
}

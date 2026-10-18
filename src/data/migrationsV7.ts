import type { AppDataV4, AppDataV7 } from '../types'
import { isCompatibleAppDataV6 } from './validators/v6'
import { isCompatibleAppDataV7 } from './validators/v7'

/** Retains every v6 entity and ID; legacy overrides are not reinterpreted. */
export function migrateV6ToV7(source: AppDataV4): AppDataV7 {
  if (!isCompatibleAppDataV6(source)) throw new Error('Invalid AppData v6')
  if (Object.prototype.hasOwnProperty.call(source, 'oneOffLessons')) throw new Error('Unexpected one-off data in AppData v6')
  const migrated: AppDataV7 = { ...source, schemaVersion: 7, oneOffLessons: [] }
  if (!isCompatibleAppDataV7(migrated)) throw new Error('Invalid AppData v7 migration')
  return migrated
}

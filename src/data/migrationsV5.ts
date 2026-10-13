import { SCHOOL_LEVELS, type AppDataV4, type AppDataV5 } from '../types'
import { isCompatibleAppDataV4 } from './validators/v4'
import { isCompatibleAppDataV5 } from './validators/v5'

export function migrateV4ToV5(source: AppDataV4): AppDataV5 {
  if (!isCompatibleAppDataV4(source)) throw new Error('Invalid AppData v4')
  const migrated: AppDataV5 = {
    ...source,
    schemaVersion: 5,
    subjects: source.subjects.map((subject) => ({
      ...subject,
      applicableSchoolLevels: subject.applicableSchoolLevels ?? [...SCHOOL_LEVELS],
    })),
  }
  if (!isCompatibleAppDataV5(migrated)) throw new Error('Invalid AppData v5 migration')
  return migrated
}

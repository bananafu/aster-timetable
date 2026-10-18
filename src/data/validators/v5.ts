import { SCHOOL_LEVELS, type AppDataV4, type AppDataV5 } from '../../types'
import { isAppDataV4, isCompatibleAppDataV4 } from './v4'

function validate(value: unknown, compatible: boolean): value is AppDataV5 {
  if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 5) return false
  const data = value as AppDataV4
  const legacyShape = { ...data, schemaVersion: 4 }
  if (!(compatible ? isCompatibleAppDataV4(legacyShape) : isAppDataV4(legacyShape))) return false
  return data.subjects.every((subject) => {
    const levels = subject.applicableSchoolLevels
    return Array.isArray(levels) && levels.length > 0
      && new Set(levels).size === levels.length
      && levels.every((level) => SCHOOL_LEVELS.includes(level))
  })
}

export const isAppDataV5 = (value: unknown): value is AppDataV5 => validate(value, false)
export const isCompatibleAppDataV5 = (value: unknown): value is AppDataV5 => validate(value, true)

export function isSafeAppDataV5Update(current: AppDataV4, next: AppDataV4): boolean {
  if (!isCompatibleAppDataV5(next)) return false
  return next.teachingUnits.every((unit) => unit.periods.every((period) => {
    const valid = (time: string) => Number(time.slice(3)) % 5 === 0
    if (valid(period.startTime) && valid(period.endTime)) return true
    const original = current.teachingUnits.find((item) => item.id === unit.id && item.projectId === unit.projectId)
      ?.periods.find((item) => item.id === period.id)
    return original !== undefined && original.startTime === period.startTime && original.endTime === period.endTime
  }))
}

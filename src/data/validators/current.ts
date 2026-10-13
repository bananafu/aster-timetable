import type { AppDataV4 } from '../../types'
import { isAppDataV4 } from './v4'
import { isAppDataV5 } from './v5'
import { isCompatibleAppDataV6 } from './v6'

export function isCurrentAppData(value: unknown): value is AppDataV4 {
  return isAppDataV4(value) || isAppDataV5(value) || isCompatibleAppDataV6(value)
}

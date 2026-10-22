import type { AppDataV8 } from '../types'
import {
  EventRepairV8Error,
  listEventRepairCases,
  resolveEventOwnershipV8,
  type EventRepairCaseV8,
  type ResolveEventOwnershipV8Input,
} from './eventRepairV8'

export interface EventRepairViewV8 {
  pendingCount: number
  cases: EventRepairCaseV8[]
}

export function getEventRepairViewV8(data: AppDataV8): EventRepairViewV8 {
  const cases = listEventRepairCases(data)
  return { pendingCount: cases.length, cases }
}

export function confirmEventOwnershipV8(
  data: AppDataV8,
  input: ResolveEventOwnershipV8Input,
): AppDataV8 {
  return resolveEventOwnershipV8(data, input)
}

export function eventRepairErrorMessage(cause: unknown): string {
  if (!(cause instanceof EventRepairV8Error)) {
    return cause instanceof Error ? cause.message : '事件歸屬未通過驗證，原有資料未變更。'
  }
  switch (cause.code) {
    case 'cross-project':
      return '這筆事件已屬於既有專案，不能改派到其他專案。'
    case 'archived-project':
      return '封存專案為唯讀，無法確認事件歸屬。'
    case 'teaching-unit-not-found':
    case 'teaching-unit-changed':
      return '選擇的學校與學制已不存在或已變更，請重新確認。'
    case 'timetable-not-found':
      return '選擇的教師課表已不存在，請重新選擇。'
    case 'event-not-found':
    case 'already-resolved':
      return '這筆事件的待確認狀態已變更，請重新載入最新資料。'
    default:
      return '事件資料已變更或無法安全更新，請重新確認後再試。'
  }
}

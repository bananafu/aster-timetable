import type { AppDataV8RuntimeStatus } from './hooks/useAppDataV8'

/** User-facing explanation only; Host eligibility remains the sole write authority. */
export function previewReadOnlyMessage(status: AppDataV8RuntimeStatus, legacyPresent = false): string {
  if (legacyPresent) return '偵測到舊版 Toki 資料，為保護來源已暫停 V8 寫入。請先匯出原始資料並返回舊版檢查。'
  if (status === 'conflict') return '資料已在其他分頁或操作中變更。請匯出本頁資料，再檢查外部版本。'
  if (status === 'write-error') return '上次寫入未確認，草稿仍保留。請先匯出並檢查儲存狀態。'
  if (status === 'read-error') return '既有資料無法安全讀取或驗證；目前禁止寫入，請先匯出原始資料。'
  return '資料或啟用紀錄尚未通過寫入驗證；目前禁止寫入。'
}

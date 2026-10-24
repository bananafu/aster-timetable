import { describe, expect, it } from 'vitest'
import { previewReadOnlyMessage } from './previewReadOnlyV8'

describe('V8 preview read-only explanation', () => {
  it('explains the V7 guard without exposing the internal status code', () => {
    const message = previewReadOnlyMessage('read-error', true)
    expect(message).toContain('舊版 Toki 資料')
    expect(message).not.toContain('read-error')
  })

  it('distinguishes conflict, failed write, corrupt read and pending eligibility', () => {
    expect(previewReadOnlyMessage('conflict')).toContain('其他分頁')
    expect(previewReadOnlyMessage('write-error')).toContain('寫入未確認')
    expect(previewReadOnlyMessage('read-error')).toContain('無法安全讀取')
    expect(previewReadOnlyMessage('saved')).toContain('啟用紀錄')
  })
})

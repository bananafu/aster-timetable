import { useRef, useState, type ChangeEvent } from 'react'
import { createVerifiedV9JsonDownload, type PreparedV9JsonImport } from '../formalV9JsonTransfer'

type JsonTransfer = {
  exportVerified: () => Promise<Parameters<typeof createVerifiedV9JsonDownload>[0]>
  prepareImport: (fileName: string, raw: string) => Promise<PreparedV9JsonImport>
  confirmImport: (prepared: PreparedV9JsonImport, candidateIdentity: string,
    acknowledged: boolean) => Promise<unknown>
}

type Props = {
  transfer: JsonTransfer
  disabled: boolean
  onImported: () => void
}

const summaryRows = [
  ['Project', 'projects'], ['Timetable', 'timetables'], ['RecurringLesson', 'recurringLessons'],
  ['OneOffLesson', 'oneOffLessons'], ['Event', 'events'],
] as const

export function FormalV9DataManagement({ transfer, disabled, onImported }: Props) {
  const [prepared, setPrepared] = useState<PreparedV9JsonImport | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const exportJson = async () => {
    if (disabled || busy) return
    setBusy(true)
    try {
      const snapshot = await transfer.exportVerified()
      const download = createVerifiedV9JsonDownload(snapshot)
      const url = URL.createObjectURL(download.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = download.fileName
      anchor.click()
      URL.revokeObjectURL(url)
      setError('')
      setNotice('已建立通過驗證的下載檔案。請依瀏覽器下載狀態確認是否已儲存。')
    } catch {
      setNotice('')
      setError('目前無法建立通過驗證的 V9 匯出。')
    } finally { setBusy(false) }
  }

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setPrepared(null)
    setAcknowledged(false)
    setNotice('')
    setError('')
    if (!file) return
    setBusy(true)
    try { setPrepared(await transfer.prepareImport(file.name, await file.text())) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '無法驗證選取的 JSON。') }
    finally { setBusy(false) }
  }

  const cancelPreview = () => {
    if (busy) return
    setPrepared(null)
    setAcknowledged(false)
    setError('')
    setNotice('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const confirmImport = async () => {
    if (!prepared || !acknowledged || disabled || busy) return
    setBusy(true)
    try {
      await transfer.confirmImport(prepared, prepared.candidate.identity, acknowledged)
      setError('')
      onImported()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '匯入未完成；預覽資料已保留。')
    } finally { setBusy(false) }
  }

  return <section className="form-grid compact-form" aria-label="資料管理">
    <div className="full"><strong>手動 JSON 匯出</strong><p>下載整份已確認的 Formal V9 資料；不包含 activation metadata 或自動備份。</p></div>
    <div className="form-actions full"><button type="button" disabled={disabled || busy}
      onClick={() => void exportJson()}>匯出 JSON</button></div>
    <div className="full"><strong>整份 JSON 匯入</strong><p>選檔只會驗證與預覽，不會立即寫入。匯入會整份替換目前資料，不是合併或附加。</p></div>
    <label className="full">選擇 JSON 檔案<input ref={inputRef} type="file" accept="application/json,.json"
      disabled={disabled || busy} onChange={(event) => void selectFile(event)} /></label>
    {prepared && <>
      <div className="full"><strong>匯入檔案</strong><p>{prepared.candidate.fileName}</p><p>JSON schema version：{prepared.candidate.schemaVersion}</p></div>
      <div className="full"><strong>資料摘要</strong><table><thead><tr><th>資料</th><th>目前 confirmed</th><th>匯入檔案</th></tr></thead><tbody>
        {summaryRows.map(([label, key]) => <tr key={key}><th>{label}</th><td>{prepared.current[key]}</td><td>{prepared.candidate.summary[key]}</td></tr>)}
      </tbody></table></div>
      <label className="full"><input type="checkbox" checked={acknowledged} disabled={busy}
        onChange={(event) => setAcknowledged(event.target.checked)} />我了解目前資料將被替換</label>
      <div className="form-actions full"><button type="button" disabled={busy} onClick={cancelPreview}>取消</button>
        <button type="button" className="primary-button" disabled={disabled || busy || !acknowledged}
          onClick={() => void confirmImport()}>確認匯入</button></div>
    </>}
    {notice && <p className="form-success full" role="status">{notice}</p>}
    {error && <p className="form-error full" role="alert">{error}</p>}
  </section>
}

import { useCallback, useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type { AppDataV8 } from '../types'
import type { AppDataV8Persistence, AppDataV8RuntimeStatus } from '../hooks/useAppDataV8'
import { createTeacherTimetableV8, deleteTeacherTimetableV8, duplicateTeacherTimetableV8,
  getTimetableV8Impact, updateTeacherTimetableV8 } from '../data/timetablesV8'
import { reconcileTimetableSelectionV8, visibleTimetableContentV8 } from '../data/timetableSelectionV8'
import { Modal } from './Modal'
import { ChevronRight } from 'lucide-react'
import { previewReadOnlyMessage } from '../previewReadOnlyV8'

type Mode = 'create' | 'edit' | 'duplicate' | null
type Props = { data: AppDataV8; setData: Dispatch<SetStateAction<AppDataV8>>; status: AppDataV8RuntimeStatus;
  persistence: AppDataV8Persistence; writable: boolean; onClose: () => void;
  onExport?: (raw: string) => void; exportLocalJson: () => string; onRecover?: () => void;
  selectedTimetableId?: string | null; onSelectTimetable?: (id: string | null) => void }
const blank = () => ({ name: '', teacherName: '' })

/** Selection is local UI state; all document writes flow through the supplied V8 Host setter. */
export function TimetableManagerV8({ data, setData, status, persistence, writable, onClose, onExport,
  exportLocalJson, onRecover, selectedTimetableId, onSelectTimetable }: Props) {
  const projectId = data.activeProjectId
  const timetables = data.timetables.filter((item) => item.projectId === projectId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = reconcileTimetableSelectionV8(data, projectId, selectedTimetableId === undefined ? selectedId : selectedTimetableId)
  const choose = useCallback((id: string | null) => { setSelectedId(id); onSelectTimetable?.(id) }, [onSelectTimetable])
  const [mode, setMode] = useState<Mode>(null)
  const [draft, setDraft] = useState(blank)
  const [formProjectId, setFormProjectId] = useState<string | null>(null)
  const [formTimetableId, setFormTimetableId] = useState<string | null>(null)
  const [formSelectedId, setFormSelectedId] = useState<string | null>(null)
  const [formBaselineRaw, setFormBaselineRaw] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [expectedRaw, setExpectedRaw] = useState<string | null>(null)
  const [startedRevision, setStartedRevision] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [nextSelectedId, setNextSelectedId] = useState<string | null>(null)
  const canWrite = writable && status === 'saved' && !persistence.pending && expectedRaw === null
  const dirty = !!draft.name.trim() || !!draft.teacherName.trim()
  const project = data.projects.find((item) => item.id === projectId)

  useEffect(() => {
    if (!expectedRaw) return
    if (status === 'saved' && !persistence.pending && persistence.receipt && persistence.revision > startedRevision
      && persistence.receipt.revision === persistence.revision
      && persistence.receipt.raw === expectedRaw && JSON.stringify(data) === expectedRaw) {
      setExpectedRaw(null)
      if (nextSelectedId) choose(nextSelectedId)
      setNextSelectedId(null)
      setMode(null)
      setDraft(blank())
      setSuccess('V8 教師課表已確認儲存。')
    } else if (status !== 'saved') {
      setExpectedRaw(null)
      setError('寫入未確認；草稿已保留。請匯出本頁資料並處理衝突。')
    }
  }, [data, expectedRaw, persistence.pending, persistence.receipt, persistence.revision, startedRevision, status, nextSelectedId, choose])

  const submit = (next: AppDataV8, desiredSelection: string | null = selected) => {
    if (!canWrite) { setError('目前唯讀或有未確認寫入。'); return }
    setError('')
    setSuccess('')
    setStartedRevision(persistence.revision)
    setExpectedRaw(JSON.stringify(next))
    setNextSelectedId(desiredSelection)
    setData(next)
  }
  const begin = (next: Mode) => {
    if (!canWrite) return
    if (dirty && !window.confirm('捨棄尚未儲存的教師課表草稿？')) return
    setMode(next)
    setFormProjectId(projectId)
    setFormTimetableId(next === 'edit' ? selected : null)
    setFormSelectedId(selected)
    setFormBaselineRaw(JSON.stringify(data))
    setError('')
    setDraft(next === 'edit' && selected
      ? { name: timetables.find((item) => item.id === selected)?.name ?? '',
        teacherName: timetables.find((item) => item.id === selected)?.teacherName ?? '' } : blank())
    setSourceId('')
    setDestinationId('')
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!projectId) return
    if (projectId !== formProjectId || selected !== formSelectedId || JSON.stringify(data) !== formBaselineRaw) {
      setError('專案、教師課表選取或 V8 文件已變更；草稿已保留。請重新確認目標後再操作。')
      return
    }
    try {
      if (mode === 'create') {
        const id = crypto.randomUUID()
        submit(createTeacherTimetableV8(data, projectId, draft, id), id)
      } else if (mode === 'edit' && formTimetableId) {
        submit(updateTeacherTimetableV8(data, projectId, formTimetableId, draft))
      } else if (mode === 'duplicate') {
        const id = crypto.randomUUID()
        submit(duplicateTeacherTimetableV8(data, projectId, sourceId, destinationId, id, draft),
          destinationId === projectId ? id : selected)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '課表資料無效。') }
  }
  const remove = (id: string) => {
    if (!projectId || !canWrite) return
    try {
      const impact = getTimetableV8Impact(data, projectId, id)
      const message = `「${impact.timetable.name}」引用：固定課程 ${impact.recurringLessons}、單日課程 ${impact.oneOffLessons}、異動 ${impact.changes}、事件 ${impact.events}、進度 ${impact.progress}。`
      if (impact.recurringLessons || impact.oneOffLessons || impact.changes || impact.events || impact.progress) {
        setError(`${message}請先處理引用，無法刪除。`)
        return
      }
      if (!window.confirm(`永久刪除教師課表？${message} 正式備份流程尚未接線，請先自行匯出 JSON。`)) return
      submit(deleteTeacherTimetableV8(data, projectId, id, true), selected === id ? null : selected)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法刪除課表。') }
  }
  const close = () => { if (!dirty || window.confirm('捨棄尚未儲存的教師課表草稿？')) onClose() }
  const requestSelection = (id: string | null) => {
    if (id === selected) return
    if (expectedRaw) { setError('課表寫入尚未確認，暫時不能切換教師課表。'); return }
    if (mode && dirty && !window.confirm('切換教師課表會捨棄尚未儲存的草稿，確定切換？')) return
    setMode(null)
    setDraft(blank())
    setSourceId('')
    setDestinationId('')
    setError('')
    setSuccess('')
    choose(id)
  }
  const visible = selected && projectId ? visibleTimetableContentV8(data, projectId, selected) : null

  return <Modal title="V8 教師課表管理" subtitle={`目前專案：${project?.name ?? '無'}`} onClose={close}><div className="project-settings">
    <p>科目庫由目前專案共用；新增空白教師課表不會預選科目或複製其他教師的課程。</p>
    {!canWrite && <div role="status" className="preview-readonly-notice">{previewReadOnlyMessage(status)}
      <button type="button" disabled={!onExport} onClick={() => onExport?.(exportLocalJson())}>匯出本頁 JSON</button>
      <button type="button" onClick={onRecover}>查看恢復選項</button><details><summary>診斷資訊</summary><code>{status}</code></details></div>}
    {timetables.length === 0 && <p className="resource-list-empty">目前專案尚無教師課表。</p>}
    <div className="project-history-row"><label>目前選取的教師課表<select value={selected ?? ''}
      onChange={(event) => requestSelection(event.target.value)}>
      <option value="" disabled>選擇教師課表</option>
      {timetables.map((item) => <option key={item.id} value={item.id}>{item.name}・{item.teacherName}</option>)}</select></label></div>
    {visible && <p>目前教師內容：固定課程 {visible.recurringLessons.length}、單日課程 {visible.oneOffLessons.length}、異動 {visible.changes.length}、事件 {visible.events.length}、進度 {visible.progress.length}。</p>}
    {mode && (formProjectId !== projectId || formSelectedId !== selected) && !error &&
      <p role="alert" className="form-error">專案或教師課表選取已變更；舊草稿已保留，但不能寫入目前目標。</p>}
    <nav className="settings-menu" aria-label="教師課表操作">
      <button type="button" className="settings-menu-item" disabled={!canWrite || !projectId} onClick={() => begin('create')}><span><strong>新增教師課表</strong><small>建立不含科目或課程的空白教師課表。</small></span><ChevronRight size={17} /></button>
      <button type="button" className="settings-menu-item" disabled={!canWrite || !selected} onClick={() => begin('edit')}><span><strong>編輯教師課表</strong><small>修改目前選取教師的名稱與設定。</small></span><ChevronRight size={17} /></button>
      <button type="button" className="settings-menu-item" disabled={!canWrite || !timetables.length} onClick={() => begin('duplicate')}><span><strong>複製課表設定</strong><small>只複製設定，不複製科目、課程或事件。</small></span><ChevronRight size={17} /></button>
    </nav><section className="preview-danger-section"><h3>危險操作</h3><p>有關聯資料時禁止刪除，不會級聯清除。</p>
      <button type="button" className="danger-button" disabled={!canWrite || !selected} onClick={() => selected && remove(selected)}>刪除教師課表</button></section>
    {mode && <form className="form-grid" aria-label="教師課表表單" onSubmit={save}>
      {mode === 'duplicate' && <><p className="full">僅複製課表名稱與教師名稱，不包含課程、單日課程、異動、事件或進度。</p>
        <label>來源課表<select required value={sourceId} onChange={(event) => {
          const id = event.target.value
          const item = timetables.find((candidate) => candidate.id === id)
          setSourceId(id); setDraft(item ? { name: `${item.name}（副本）`, teacherName: item.teacherName ?? '' } : blank())
        }}><option value="" disabled>請選擇來源</option>{timetables.map((item) =>
          <option key={item.id} value={item.id}>{item.name}・{item.teacherName}</option>)}</select></label>
        <label>目的專案<select required value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
          <option value="" disabled>請選擇目的專案</option>{data.projects.filter((item) => !item.archivedAt).map((item) =>
            <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}
      <label>課表名稱<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>教師名稱<input required value={draft.teacherName} onChange={(event) => setDraft({ ...draft, teacherName: event.target.value })} /></label>
      <div className="form-actions full"><button type="button" onClick={() => { if (!dirty || window.confirm('捨棄尚未儲存的教師課表草稿？')) { setMode(null); setDraft(blank()) } }}>取消</button>
        <button className="primary-button" type="submit" disabled={!canWrite}>{mode === 'create' ? '建立課表' : mode === 'edit' ? '儲存課表' : '複製設定'}</button></div>
    </form>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {success && <p role="status" className="form-success">{success}</p>}
  </div></Modal>
}

import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type { AppDataV8 } from '../types'
import type { AppDataV8Persistence, AppDataV8RuntimeStatus } from '../hooks/useAppDataV8'
import { createClassV8, deleteClassV8, getClassV8Impact, updateClassV8, type ClassV8Draft } from '../data/classesV8'

type Props = { data: AppDataV8; setData: Dispatch<SetStateAction<AppDataV8>>; status: AppDataV8RuntimeStatus;
  persistence: AppDataV8Persistence; writable: boolean; onExport?: (raw: string) => void;
  exportLocalJson: () => string; onRecover?: () => void; onClose?: () => void }
const empty = (teachingUnitId = ''): ClassV8Draft => ({ teachingUnitId, name: '', room: '' })

/** Independent V8 Class editor; never invokes V4/V7 data operations. */
export function ClassManagerV8({ data, setData, status, persistence, writable, onExport, exportLocalJson, onRecover, onClose }: Props) {
  const projectId = data.activeProjectId
  const units = data.teachingUnits.filter((item) => item.projectId === projectId)
  const classes = data.classes.filter((item) => item.projectId === projectId)
  const [draft, setDraft] = useState<ClassV8Draft>(() => empty(units[0]?.id))
  const [draftProjectId, setDraftProjectId] = useState(projectId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expectedRaw, setExpectedRaw] = useState<string | null>(null)
  const [startedRevision, setStartedRevision] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const canWrite = writable && status === 'saved' && !persistence.pending && expectedRaw === null
  const dirty = !!draft.name?.trim() || draft.grade !== undefined || draft.classNumber !== undefined || !!draft.room?.trim()

  useEffect(() => {
    if (draftProjectId === projectId || dirty || expectedRaw) return
    setDraft(empty(units[0]?.id))
    setEditingId(null)
    setDraftProjectId(projectId)
  }, [draftProjectId, projectId, dirty, expectedRaw, units])

  useEffect(() => {
    if (!expectedRaw) return
    if (status === 'saved' && !persistence.pending && persistence.receipt && persistence.revision > startedRevision
      && persistence.receipt.revision === persistence.revision
      && persistence.receipt.raw === expectedRaw && JSON.stringify(data) === expectedRaw) {
      setExpectedRaw(null)
      setEditingId(null)
      setDraft(empty(units[0]?.id))
      setSuccess('V8 班級資料已確認儲存。')
    } else if (status !== 'saved') {
      setExpectedRaw(null)
      setError('寫入未確認；草稿仍保留。請匯出本頁資料並處理衝突。')
    }
  }, [data, expectedRaw, persistence.pending, persistence.receipt, persistence.revision, startedRevision, status, units])

  const submit = (next: AppDataV8) => {
    if (!canWrite) { setError('目前唯讀或有未確認寫入。'); return }
    setSuccess('')
    setError('')
    setStartedRevision(persistence.revision)
    setExpectedRaw(JSON.stringify(next))
    setData(next)
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!projectId) return
    if (projectId !== draftProjectId) { setError('專案已變更；班級草稿已保留，請重新確認後再操作。'); return }
    try { submit(editingId ? updateClassV8(data, projectId, editingId, draft)
      : createClassV8(data, projectId, draft, crypto.randomUUID())) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '班級資料無效。') }
  }
  const remove = (id: string) => {
    if (!projectId || !canWrite) return
    try {
      const impact = getClassV8Impact(data, projectId, id)
      if (impact.recurringLessons || impact.oneOffLessons || impact.overrides || impact.teachingProgress) {
        setError('班級仍被課程、異動或進度引用，不能刪除。')
        return
      }
      if (!window.confirm(`永久刪除班級「${impact.schoolClass.name}」？相關引用：課程 ${impact.recurringLessons}、單日課程 ${impact.oneOffLessons}、異動 ${impact.overrides}、進度 ${impact.teachingProgress}。`)) return
      submit(deleteClassV8(data, projectId, id, true))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法刪除班級。') }
  }
  const beginEdit = (id: string) => {
    if (!canWrite) return
    if (dirty && !window.confirm('捨棄尚未儲存的班級草稿？')) return
    const item = classes.find((candidate) => candidate.id === id)
    if (!item) return
    setEditingId(id)
    setDraftProjectId(projectId)
    setDraft({ teachingUnitId: item.teachingUnitId, name: item.name, grade: item.grade,
      classNumber: item.classNumber, room: item.room ?? '' })
  }
  const close = () => { if (!dirty || window.confirm('捨棄尚未儲存的班級草稿？')) onClose?.() }

  return <section aria-label="V8 班級管理" className="resource-manager-dialog">
    {!canWrite && <div role="status">目前唯讀或有未確認寫入：{status}。
      <button type="button" disabled={!onExport} onClick={() => onExport?.(exportLocalJson())}>匯出本頁 JSON</button>
      <button type="button" onClick={onRecover}>查看恢復選項</button></div>}
    <h3>目前專案班級</h3>
    {classes.length === 0 && <p className="resource-list-empty">目前專案尚無班級。</p>}
    {classes.map((item) => <div className="project-history-row" key={item.id}><strong>{item.name}</strong>
      <span>{units.find((unit) => unit.id === item.teachingUnitId)?.name}</span>
      <button type="button" disabled={!canWrite} onClick={() => beginEdit(item.id)}>編輯</button>
      <button type="button" disabled={!canWrite} onClick={() => remove(item.id)}>刪除</button></div>)}
    {units.length === 0 ? <p className="resource-list-empty">請先建立任教單位，再新增班級。</p>
      : <form className="form-grid" onSubmit={save} aria-label="班級表單">
        <label>任教單位<select value={draft.teachingUnitId} disabled={!canWrite} onChange={(event) => setDraft({ ...draft, teachingUnitId: event.target.value })}>
          {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
        <label>班級名稱<input value={draft.name ?? ''} disabled={!canWrite} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>年級<input type="number" value={draft.grade ?? ''} disabled={!canWrite} onChange={(event) => setDraft({ ...draft, grade: event.target.value ? Number(event.target.value) : undefined })} /></label>
        <label>班號<input type="number" value={draft.classNumber ?? ''} disabled={!canWrite} onChange={(event) => setDraft({ ...draft, classNumber: event.target.value ? Number(event.target.value) : undefined })} /></label>
        <label>預設教室<input value={draft.room ?? ''} disabled={!canWrite} onChange={(event) => setDraft({ ...draft, room: event.target.value })} /></label>
        <button type="submit" disabled={!canWrite}>{editingId ? '儲存班級' : '新增班級'}</button>
      </form>}
    {onClose && <button type="button" onClick={close}>完成</button>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {success && <p role="status" className="form-success">{success}</p>}
  </section>
}

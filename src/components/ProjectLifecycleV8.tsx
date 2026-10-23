import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type { AppDataV8, SemesterKind } from '../types'
import type { AppDataV8Persistence, AppDataV8RuntimeControls, AppDataV8RuntimeInfo, AppDataV8RuntimeStatus } from '../hooks/useAppDataV8'
import { copyProject, createBlankProject, deleteProject, getProjectDeletionImpact, switchActiveProject,
  type CopyProjectUnitV8Input } from '../data/projectRuntimeV8'
import { Modal } from './Modal'

type Props = {
  data: AppDataV8
  setData: Dispatch<SetStateAction<AppDataV8>>
  status: AppDataV8RuntimeStatus
  persistence: AppDataV8Persistence
  info: Pick<AppDataV8RuntimeInfo, 'writable'>
  controls: Pick<AppDataV8RuntimeControls, 'exportLocalJson' | 'exportStoredV8Json' | 'adoptExternalV8'>
  onClose: () => void
  onExport?: (raw: string) => void
  onPersisted?: () => void
}
type Page = 'root' | 'blank' | 'copy' | 'delete'
const newDraft = () => ({ name: '', teacherName: '', academicYear: Math.max(1, new Date().getFullYear() - 1911),
  semester: 'first' as SemesterKind, customLabel: '', startDate: '', endDate: '' })
const newUnitDraft = (sourceUnitId: string): CopyProjectUnitV8Input => ({ sourceUnitId,
  sourceEffectiveDate: '', startDate: '', endDate: '', anchorDate: '', anchorPattern: 'A' })
const issueText = (reason: unknown) => reason instanceof Error ? reason.message : '資料無法通過 V8 驗證。'

/** Standalone V8 adapter; the formal App and V7 lifecycle remain untouched. */
export function ProjectLifecycleV8({ data, setData, status, persistence, info, controls, onClose, onExport, onPersisted }: Props) {
  const [page, setPage] = useState<Page>('root')
  const [draft, setDraft] = useState(newDraft)
  const [sourceId, setSourceId] = useState('')
  const [units, setUnits] = useState<Record<string, CopyProjectUnitV8Input>>({})
  const [deleteId, setDeleteId] = useState('')
  const [backupAcknowledged, setBackupAcknowledged] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [waitingRaw, setWaitingRaw] = useState<string | null>(null)
  const [baseRevision, setBaseRevision] = useState(0)
  const sourceUnits = data.teachingUnits.filter((item) => item.projectId === sourceId)
  const impact = deleteId ? getProjectDeletionImpact(data, deleteId) : null
  const canWrite = info.writable && status === 'saved' && !persistence.pending && waitingRaw === null
  const dirty = page === 'blank' ? JSON.stringify(draft) !== JSON.stringify(newDraft())
    : page === 'copy' ? !!draft.name || Object.values(units).some((item) => !!item.sourceEffectiveDate || !!item.startDate || !!item.endDate || !!item.anchorDate)
      : false

  useEffect(() => {
    if (!waitingRaw) return
    if (status === 'saved' && !persistence.pending && persistence.receipt
      && persistence.revision > baseRevision && persistence.receipt.revision === persistence.revision
      && persistence.receipt.raw === waitingRaw && JSON.stringify(data) === waitingRaw) {
      setWaitingRaw(null)
      setSuccess('V8 寫入已確認。')
      setPage('root')
      onPersisted?.()
    } else if (status === 'write-error' || status === 'conflict' || status === 'read-error') {
      setWaitingRaw(null)
      setError('寫入未確認；本頁資料可匯出，請處理衝突或恢復後重試。')
    }
  }, [data, waitingRaw, persistence.pending, persistence.receipt, persistence.revision, baseRevision, status, onPersisted, onClose])

  const close = () => { if (!dirty || window.confirm('捨棄尚未提交的專案草稿？')) onClose() }
  const submit = (next: AppDataV8) => {
    if (!canWrite) { setError('目前為唯讀或仍有未確認寫入。'); return }
    setError('')
    setSuccess('')
    setBaseRevision(persistence.revision)
    setWaitingRaw(JSON.stringify(next))
    setData(next)
  }
  const beginCopy = () => {
    setSourceId('')
    setUnits({})
    setDraft(newDraft())
    setError('')
    setPage('copy')
  }
  const chooseSource = (projectId: string) => {
    setSourceId(projectId)
    setUnits(Object.fromEntries(data.teachingUnits.filter((unit) => unit.projectId === projectId)
      .map((unit) => [unit.id, newUnitDraft(unit.id)])))
  }
  const submitBlank = (event: FormEvent) => {
    event.preventDefault()
    try { submit(createBlankProject(data, draft, () => crypto.randomUUID())) }
    catch (reason) { setError(issueText(reason)) }
  }
  const submitCopy = (event: FormEvent) => {
    event.preventDefault()
    try {
      submit(copyProject(data, { sourceProjectId: sourceId, name: draft.name, academicYear: draft.academicYear,
        semester: draft.semester, customLabel: draft.customLabel,
        units: sourceUnits.map((unit) => units[unit.id] ?? newUnitDraft(unit.id)) }, () => crypto.randomUUID()))
    } catch (reason) { setError(issueText(reason)) }
  }
  const submitDelete = () => {
    const project = data.projects.find((item) => item.id === deleteId)
    if (!project || !impact || !backupAcknowledged) { setError('請確認刪除對象及備份提醒。'); return }
    if (!window.confirm(`永久刪除「${project.name}」及其 ${impact.subjects} 科目、${impact.classes} 班級、${impact.timetables} 教師課表、${impact.recurringLessons} 課程、${impact.events} 事件、${impact.teachingProgress} 進度？此操作無法復原。`)) return
    try { submit(deleteProject(data, deleteId, true)) }
    catch (reason) { setError(issueText(reason)) }
  }
  const exportData = () => onExport?.(controls.exportLocalJson())

  return <Modal title="V8 專案管理" onClose={close}><div className="project-settings">
    {!canWrite && <div role="status" className="form-error">目前無法寫入：{status}。請先匯出本頁資料並處理唯讀或衝突狀態。
      <button type="button" onClick={exportData} disabled={!onExport}>匯出本頁 JSON</button>
      <button type="button" onClick={controls.adoptExternalV8}>採用外部 V8</button>
    </div>}
    {waitingRaw && <p role="status">等待 V8 寫入確認…</p>}
    {page !== 'root' && <button type="button" onClick={() => { if (!dirty || window.confirm('捨棄尚未提交的專案草稿？')) setPage('root') }}>返回專案管理</button>}
    {page === 'root' && <><nav className="settings-menu" aria-label="V8 專案管理">
      <button type="button" onClick={() => { setDraft(newDraft()); setPage('blank') }}>新增空白專案</button>
      <button type="button" onClick={beginCopy} disabled={!data.projects.length}>複製為新學期</button>
      <button type="button" onClick={() => setPage('delete')} disabled={!data.projects.length}>刪除專案</button>
    </nav><label>切換專案<select value={data.activeProjectId ?? ''} disabled={!canWrite}
      onChange={(event) => { try { submit(switchActiveProject(data, event.target.value)) } catch (reason) { setError(issueText(reason)) } }}>
      <option value="" disabled>選擇專案</option>{data.projects.filter((item) => !item.archivedAt).map((project) =>
        <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></>}
    {(page === 'blank' || page === 'copy') && <form className="form-grid project-create-form" onSubmit={page === 'blank' ? submitBlank : submitCopy}>
      <p className="full">{page === 'blank' ? '只建立新專案及預設學校、任教單位；教師課表與科目等資源均不自動建立。'
        : '複製學校、任教單位、教師課表、科目、班級及指定日期有效的固定課程；不複製事件、異動、單日課程或進度。所有實體 ID 重新建立。'}</p>
      {page === 'copy' && <label className="full">來源專案<select required value={sourceId} onChange={(event) => chooseSource(event.target.value)}>
        <option value="" disabled>請選擇來源專案</option>
        {data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
      <label>專案名稱<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>學年度<input required type="number" min="1" value={draft.academicYear} onChange={(event) => setDraft({ ...draft, academicYear: Number(event.target.value) })} /></label>
      <label>學期<select value={draft.semester} onChange={(event) => setDraft({ ...draft, semester: event.target.value as SemesterKind })}>
        <option value="first">第一學期</option><option value="second">第二學期</option><option value="summer">暑期</option><option value="custom">自訂</option></select></label>
      {draft.semester === 'custom' && <label>自訂學期名稱<input required value={draft.customLabel} onChange={(event) => setDraft({ ...draft, customLabel: event.target.value })} /></label>}
      {page === 'blank' ? <><label>起始日<input required type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
        <label>結束日<input required type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label></>
        : sourceUnits.map((unit) => { const value = units[unit.id] ?? newUnitDraft(unit.id)
          const update = (patch: Partial<CopyProjectUnitV8Input>) => setUnits({ ...units, [unit.id]: { ...value, ...patch } })
          return <fieldset className="copy-unit-dates full" key={unit.id}><legend>{unit.name}</legend>
            <label>來源有效日期<input required type="date" value={value.sourceEffectiveDate} onChange={(event) => update({ sourceEffectiveDate: event.target.value })} /></label>
            <label>新起始日<input required type="date" value={value.startDate} onChange={(event) => update({ startDate: event.target.value })} /></label>
            <label>新結束日<input required type="date" value={value.endDate} onChange={(event) => update({ endDate: event.target.value })} /></label>
            <label>A/B anchor<input required type="date" value={value.anchorDate} onChange={(event) => update({ anchorDate: event.target.value })} /></label>
            <label>anchor 週型<select value={value.anchorPattern} onChange={(event) => update({ anchorPattern: event.target.value as 'A' | 'B' })}>
              <option value="A">A 週</option><option value="B">B 週</option></select></label></fieldset> })}
      <button className="primary-button" type="submit" disabled={!canWrite}>{page === 'blank' ? '新增並切換' : '複製並切換'}</button>
    </form>}
    {page === 'delete' && <section><label>刪除對象<select value={deleteId} onChange={(event) => { setDeleteId(event.target.value); setBackupAcknowledged(false) }}>
      <option value="">選擇專案</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      {impact && <><p>將刪除：{impact.subjects} 科目、{impact.classes} 班級、{impact.timetables} 教師課表、{impact.recurringLessons} 固定課程、{impact.oneOffLessons} 單日課程、{impact.overrides} 異動、{impact.events} 事件、{impact.teachingProgress} 進度；其他專案保留。</p>
        <button type="button" onClick={exportData} disabled={!onExport}>匯出刪除前 JSON</button>
        <label><input type="checkbox" checked={backupAcknowledged} onChange={(event) => setBackupAcknowledged(event.target.checked)} />我已了解應先保存額外備份</label>
        <button type="button" className="danger-button" disabled={!canWrite || !backupAcknowledged} onClick={submitDelete}>永久刪除</button></>}
    </section>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {success && <p role="status">{success}</p>}
  </div></Modal>
}

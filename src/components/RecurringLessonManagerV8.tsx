import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type { AppDataV8, DayOfWeek, WeekPattern } from '../types'
import type { AppDataV8Persistence, AppDataV8RuntimeStatus } from '../hooks/useAppDataV8'
import { createRecurringLessonV8, deleteRecurringLessonV8, getRecurringLessonV8Impact,
  listRecurringLessonsV8, updateRecurringLessonV8, type RecurringLessonV8Draft } from '../data/recurringLessonsV8'
import { reconcileTimetableSelectionV8 } from '../data/timetableSelectionV8'

type Props = { data: AppDataV8; setData: Dispatch<SetStateAction<AppDataV8>>; status: AppDataV8RuntimeStatus;
  persistence: AppDataV8Persistence; writable: boolean; exportLocalJson: () => string;
  onExport?: (raw: string) => void; onRecover?: () => void; onClose: () => void }
type Fields = { teachingUnitId: string; classId: string; subjectId: string; day: DayOfWeek;
  periodId: number; weekPattern: WeekPattern; room: string }
const blank = (): Fields => ({ teachingUnitId: '', classId: '', subjectId: '', day: 1,
  periodId: 0, weekPattern: 'every', room: '' })

export function RecurringLessonManagerV8({ data, setData, status, persistence, writable,
  exportLocalJson, onExport, onRecover, onClose }: Props) {
  const projectId = data.activeProjectId
  const [requestedTimetableId, setRequestedTimetableId] = useState<string | null>(null)
  const timetableId = reconcileTimetableSelectionV8(data, projectId, requestedTimetableId)
  const timetables = data.timetables.filter((item) => item.projectId === projectId)
  const lessons = projectId && timetableId ? listRecurringLessonsV8(data, projectId, timetableId) : []
  const [mode, setMode] = useState<'create' | 'edit' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [fields, setFields] = useState<Fields>(blank)
  const [formProjectId, setFormProjectId] = useState<string | null>(null)
  const [formTimetableId, setFormTimetableId] = useState<string | null>(null)
  const [formRaw, setFormRaw] = useState<string | null>(null)
  const [expectedRaw, setExpectedRaw] = useState<string | null>(null)
  const [startedRevision, setStartedRevision] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const canWrite = writable && status === 'saved' && !persistence.pending && expectedRaw === null
  const dirty = mode !== null && (mode === 'edit' || fields.teachingUnitId !== '' || fields.classId !== ''
    || fields.subjectId !== '' || fields.room !== '')
  const units = data.teachingUnits.filter((item) => item.projectId === projectId)
  const classes = data.classes.filter((item) => item.projectId === projectId && item.teachingUnitId === fields.teachingUnitId)
  const subjects = data.subjects.filter((item) => item.projectId === projectId
    && data.teachingUnitSubjects.some((relation) => relation.projectId === projectId
      && relation.teachingUnitId === fields.teachingUnitId && relation.subjectId === item.id))
  const periods = units.find((item) => item.id === fields.teachingUnitId)?.periods ?? []

  useEffect(() => {
    if (!expectedRaw) return
    if (status === 'saved' && !persistence.pending && persistence.receipt
      && persistence.revision > startedRevision && persistence.receipt.revision === persistence.revision
      && persistence.receipt.raw === expectedRaw && JSON.stringify(data) === expectedRaw) {
      setExpectedRaw(null)
      setMode(null)
      setFields(blank())
      setSuccess('V8 固定課程已確認儲存。')
    } else if (status !== 'saved') {
      setExpectedRaw(null)
      setError('寫入未確認；課程草稿已保留。請匯出本頁資料並處理衝突。')
    }
  }, [data, expectedRaw, persistence.pending, persistence.receipt, persistence.revision, startedRevision, status])

  const discard = () => !dirty || window.confirm('捨棄尚未儲存的固定課程草稿？')
  const begin = (next: 'create' | 'edit', id?: string) => {
    if (!canWrite || !projectId || !timetableId || !discard()) return
    const current = id ? lessons.find((item) => item.id === id) : null
    setMode(next)
    setEditingId(current?.id ?? null)
    setFields(current ? { teachingUnitId: current.teachingUnitId, classId: current.classId,
      subjectId: current.subjectId, day: current.day, periodId: current.periodId,
      weekPattern: current.weekPattern, room: current.room ?? '' } : blank())
    setFormProjectId(projectId)
    setFormTimetableId(timetableId)
    setFormRaw(JSON.stringify(data))
    setError('')
  }
  const submit = (next: AppDataV8) => {
    if (!canWrite) { setError('目前唯讀或有未確認寫入。'); return }
    setError('')
    setSuccess('')
    setStartedRevision(persistence.revision)
    setExpectedRaw(JSON.stringify(next))
    setData(next)
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!projectId || !timetableId) { setError('專案或教師課表已變更；草稿已保留。'); return }
    if (formProjectId !== projectId || formTimetableId !== timetableId || formRaw !== JSON.stringify(data)) {
      setError('專案、教師課表或 V8 文件已變更；草稿已保留。')
      return
    }
    const draft: RecurringLessonV8Draft = { ...fields, projectId, timetableId }
    try { submit(editingId ? updateRecurringLessonV8(data, projectId, timetableId, editingId, draft)
      : createRecurringLessonV8(data, draft, crypto.randomUUID())) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '固定課程資料無效。') }
  }
  const remove = (id: string) => {
    if (!canWrite || !projectId || !timetableId) return
    try {
      const impact = getRecurringLessonV8Impact(data, projectId, timetableId, id)
      const summary = `異動 ${impact.changes}、相關單日課程 ${impact.oneOff}、進度 ${impact.progress}、歷史版本 ${impact.versions}。`
      if (impact.changes || impact.oneOff || impact.progress || impact.versions > 1) {
        setError(`課程仍有引用：${summary}`); return
      }
      if (!window.confirm(`永久刪除固定課程？${summary}正式備份 UI 尚未接線，請先匯出 JSON。`)) return
      submit(deleteRecurringLessonV8(data, projectId, timetableId, id, true))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法刪除固定課程。') }
  }

  return <section aria-label="V8 固定課程管理" className="resource-manager-dialog">
    <h3>固定課程</h3>
    <p>目前專案：{data.projects.find((item) => item.id === projectId)?.name ?? '無'}</p>
    {!canWrite && <div role="status">目前唯讀或有未確認寫入：{status}。
      <button type="button" disabled={!onExport} onClick={() => onExport?.(exportLocalJson())}>匯出本頁 JSON</button>
      <button type="button" onClick={onRecover}>查看恢復選項</button></div>}
    {timetables.length === 0 ? <p>請先建立教師課表。</p> : <label>教師課表<select value={timetableId ?? ''}
      onChange={(event) => setRequestedTimetableId(event.target.value)}>
      {timetables.map((item) => <option key={item.id} value={item.id}>{item.name}・{item.teacherName}</option>)}</select></label>}
    {lessons.length === 0 && <p>目前教師課表尚無固定課程。</p>}
    {lessons.map((item) => <div key={item.id} className="project-history-row"><span>
      {units.find((unit) => unit.id === item.teachingUnitId)?.name}・
      {data.classes.find((schoolClass) => schoolClass.id === item.classId)?.name}・
      {data.subjects.find((subject) => subject.id === item.subjectId)?.name}／週{item.day}・
      {item.weekPattern === 'every' ? '每週' : `${item.weekPattern} 週`}</span>
      <button type="button" disabled={!canWrite} onClick={() => begin('edit', item.id)}>編輯</button>
      <button type="button" disabled={!canWrite} onClick={() => remove(item.id)}>刪除</button></div>)}
    {(!units.length || !data.classes.some((item) => item.projectId === projectId)
      || !data.subjects.some((item) => item.projectId === projectId)) && <p>請先建立任教單位、班級及科目配置。</p>}
    <button type="button" disabled={!canWrite || !timetableId || !units.length
      || !data.classes.some((item) => item.projectId === projectId)
      || !data.teachingUnitSubjects.some((item) => item.projectId === projectId)}
      onClick={() => begin('create')}>新增固定課程</button>
    {mode && <form className="form-grid" aria-label="固定課程表單" onSubmit={save}>
      <label>任教單位<select required value={fields.teachingUnitId} onChange={(event) => setFields({ ...fields,
        teachingUnitId: event.target.value, classId: '', subjectId: '', periodId: 0 })}>
        <option value="" disabled>選擇任教單位</option>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>班級<select required value={fields.classId} onChange={(event) => setFields({ ...fields, classId: event.target.value })}>
        <option value="" disabled>選擇班級</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>科目<select required value={fields.subjectId} onChange={(event) => setFields({ ...fields, subjectId: event.target.value })}>
        <option value="" disabled>選擇科目</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>星期<select value={fields.day} onChange={(event) => setFields({ ...fields, day: Number(event.target.value) as DayOfWeek })}>
        {[1, 2, 3, 4, 5].map((day) => <option key={day} value={day}>週{day}</option>)}</select></label>
      <label>節次<select required value={fields.periodId} onChange={(event) => setFields({ ...fields, periodId: Number(event.target.value) })}>
        <option value={0} disabled>選擇節次</option>{periods.map((item) => <option key={item.id} value={item.id}>{item.label}（{item.startTime}–{item.endTime}）</option>)}</select></label>
      <label>週別<select value={fields.weekPattern} onChange={(event) => setFields({ ...fields, weekPattern: event.target.value as WeekPattern })}>
        <option value="every">每週</option>{units.find((item) => item.id === fields.teachingUnitId)?.weekCycle.enabled
          && <><option value="A">A 週</option><option value="B">B 週</option></>}</select></label>
      <label>教室<input value={fields.room} onChange={(event) => setFields({ ...fields, room: event.target.value })} /></label>
      <button type="submit" disabled={!canWrite}>{mode === 'create' ? '建立固定課程' : '儲存固定課程'}</button>
    </form>}
    <button type="button" onClick={() => { if (discard()) onClose() }}>完成</button>
    {error && <p role="alert" className="form-error">{error}</p>}
    {success && <p role="status" className="form-success">{success}</p>}
  </section>
}

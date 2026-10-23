import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type { AppDataV8 } from '../types'
import type { AppDataV8Persistence, AppDataV8RuntimeStatus } from '../hooks/useAppDataV8'
import { cancelLessonOnceV8, createExtraLessonV8, deleteExtraLessonV8, listOneTimeLessonsV8,
  moveLessonOnceV8, resolveEffectiveLessonsV8, revokeOneTimeChangeV8 } from '../data/oneTimeLessonsV8'
import { listRecurringLessonsV8 } from '../data/recurringLessonsV8'
import { reconcileTimetableSelectionV8 } from '../data/timetableSelectionV8'

type Props = { data: AppDataV8; setData: Dispatch<SetStateAction<AppDataV8>>; status: AppDataV8RuntimeStatus;
  persistence: AppDataV8Persistence; writable: boolean; exportLocalJson: () => string;
  onExport?: (raw: string) => void; onRecover?: () => void; onClose: () => void }
type Mode = 'move' | 'cancel' | 'extra'
type Fields = { lessonId: string; sourceDate: string; targetDate: string; targetPeriodId: number;
  teachingUnitId: string; classId: string; subjectId: string; date: string; periodId: number; room: string }
const blank = (): Fields => ({ lessonId: '', sourceDate: '', targetDate: '', targetPeriodId: 0,
  teachingUnitId: '', classId: '', subjectId: '', date: '', periodId: 0, room: '' })

export function OneTimeLessonManagerV8({ data, setData, status, persistence, writable, exportLocalJson,
  onExport, onRecover, onClose }: Props) {
  const projectId = data.activeProjectId
  const [requestedTimetableId, setRequestedTimetableId] = useState<string | null>(null)
  const timetableId = reconcileTimetableSelectionV8(data, projectId, requestedTimetableId)
  const timetables = data.timetables.filter((item) => item.projectId === projectId)
  const lessons = projectId && timetableId ? listRecurringLessonsV8(data, projectId, timetableId) : []
  const records = projectId && timetableId ? listOneTimeLessonsV8(data, projectId, timetableId)
    : { changes: [], extras: [] }
  const [viewDate, setViewDate] = useState('')
  const [mode, setMode] = useState<Mode | null>(null)
  const [fields, setFields] = useState<Fields>(blank)
  const [formProjectId, setFormProjectId] = useState<string | null>(null)
  const [formTimetableId, setFormTimetableId] = useState<string | null>(null)
  const [formRaw, setFormRaw] = useState<string | null>(null)
  const [expectedRaw, setExpectedRaw] = useState<string | null>(null)
  const [startedRevision, setStartedRevision] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const canWrite = writable && status === 'saved' && !persistence.pending && expectedRaw === null
  const dirty = mode !== null && Object.values(fields).some((value) => value !== '' && value !== 0)
  const units = data.teachingUnits.filter((item) => item.projectId === projectId)
  const classes = data.classes.filter((item) => item.projectId === projectId
    && item.teachingUnitId === fields.teachingUnitId)
  const subjects = data.subjects.filter((item) => item.projectId === projectId
    && data.teachingUnitSubjects.some((relation) => relation.projectId === projectId
      && relation.teachingUnitId === fields.teachingUnitId && relation.subjectId === item.id))
  const extraPeriods = units.find((item) => item.id === fields.teachingUnitId)?.periods ?? []
  const sourceLesson = lessons.find((item) => item.id === fields.lessonId)
  const targetPeriods = units.find((item) => item.id === sourceLesson?.teachingUnitId)?.periods ?? []
  let daily: ReturnType<typeof resolveEffectiveLessonsV8> = []
  if (projectId && timetableId && viewDate) {
    try { daily = resolveEffectiveLessonsV8(data, projectId, timetableId, viewDate) } catch { /* incomplete date */ }
  }

  useEffect(() => {
    if (!expectedRaw) return
    if (status === 'saved' && !persistence.pending && persistence.receipt
      && persistence.revision > startedRevision && persistence.receipt.revision === persistence.revision
      && persistence.receipt.raw === expectedRaw && JSON.stringify(data) === expectedRaw) {
      setExpectedRaw(null)
      setMode(null)
      setFields(blank())
      setSuccess('V8 單次課程操作已確認儲存。')
    } else if (status !== 'saved') {
      setExpectedRaw(null)
      setError('寫入未確認；草稿已保留。請匯出本頁資料並處理衝突。')
    }
  }, [data, expectedRaw, persistence.pending, persistence.receipt, persistence.revision, startedRevision, status])

  const discard = () => !dirty || window.confirm('捨棄尚未儲存的單次課程草稿？')
  const begin = (next: Mode) => {
    if (!canWrite || !projectId || !timetableId || !discard()) return
    setMode(next)
    setFields(blank())
    setFormProjectId(projectId)
    setFormTimetableId(timetableId)
    setFormRaw(JSON.stringify(data))
    setError('')
    setSuccess('')
  }
  const submit = (next: AppDataV8) => {
    setError('')
    setSuccess('')
    setStartedRevision(persistence.revision)
    setExpectedRaw(JSON.stringify(next))
    setData(next)
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!canWrite) { setError('目前唯讀或有未確認寫入；草稿已保留。'); return }
    if (!projectId || !timetableId || projectId !== formProjectId || timetableId !== formTimetableId
      || JSON.stringify(data) !== formRaw) {
      setError('專案、教師課表或 V8 文件已變更；草稿已保留。')
      return
    }
    try {
      const id = crypto.randomUUID()
      if (mode === 'move') submit(moveLessonOnceV8(data, projectId, timetableId, fields.lessonId,
        fields.sourceDate, { date: fields.targetDate, periodId: fields.targetPeriodId }, id))
      if (mode === 'cancel') submit(cancelLessonOnceV8(data, projectId, timetableId, fields.lessonId,
        fields.sourceDate, id))
      if (mode === 'extra') submit(createExtraLessonV8(data, { projectId, timetableId,
        teachingUnitId: fields.teachingUnitId, classId: fields.classId, subjectId: fields.subjectId,
        date: fields.date, time: { mode: 'period', periodId: fields.periodId }, room: fields.room }, id))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '單次課程資料無效。') }
  }
  const remove = (kind: 'change' | 'extra', id: string) => {
    if (!canWrite || !projectId || !timetableId) return
    if (mode && (projectId !== formProjectId || timetableId !== formTimetableId || JSON.stringify(data) !== formRaw)) {
      setError('舊草稿的目標已變更；請先處理或捨棄草稿。')
      return
    }
    if (!discard() || !window.confirm(kind === 'change'
      ? '撤銷此單次異動？若屬於一組異動，將一併撤銷整組。'
      : '刪除此額外課程？固定課程不受影響。')) return
    try { submit(kind === 'change' ? revokeOneTimeChangeV8(data, projectId, timetableId, id)
      : deleteExtraLessonV8(data, projectId, timetableId, id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '無法撤銷異動。') }
  }

  return <section aria-label="V8 單次課程管理" className="resource-manager-dialog">
    <h3>單次課程異動</h3>
    <p>目前專案：{data.projects.find((item) => item.id === projectId)?.name ?? '無'}</p>
    {!canWrite && <div role="status">目前唯讀或有未確認寫入：{status}。
      <button type="button" disabled={!onExport} onClick={() => onExport?.(exportLocalJson())}>匯出本頁 JSON</button>
      <button type="button" onClick={onRecover}>查看恢復選項</button></div>}
    {timetables.length === 0 ? <p>請先建立教師課表。</p> : <label>教師課表<select value={timetableId ?? ''}
      onChange={(event) => setRequestedTimetableId(event.target.value)}>
      {timetables.map((item) => <option key={item.id} value={item.id}>{item.name}・{item.teacherName}</option>)}</select></label>}
    <label>檢視日期<input type="date" value={viewDate} onChange={(event) => setViewDate(event.target.value)} /></label>
    {viewDate && <div aria-label="當日有效課程">{daily.length === 0 ? <p>當日沒有有效課程。</p>
      : daily.map((item) => <p key={item.occurrenceKey}>{item.startTime}–{item.endTime}・
        {item.className}・{item.subjectName}・{item.kind === 'one-off' ? '額外課程' : item.status === 'moved' ? '調入' : '固定課程'}
        {item.kind === 'recurring' && item.status === 'moved' ? `（原日期 ${item.sourceDate}）` : ''}</p>)}</div>}
    {lessons.length === 0 && <p>目前教師課表尚無可調整的固定課程。</p>}
    <div><button type="button" disabled={!canWrite || !lessons.length} onClick={() => begin('move')}>僅此次調課</button>
      <button type="button" disabled={!canWrite || !lessons.length} onClick={() => begin('cancel')}>僅此次停課</button>
      <button type="button" disabled={!canWrite || !timetableId || !units.length} onClick={() => begin('extra')}>額外新增課程</button></div>
    {mode && <form className="form-grid" aria-label="單次課程表單" onSubmit={save}>
      {mode !== 'extra' ? <>
        <label>原固定課程<select required value={fields.lessonId} onChange={(event) => setFields({ ...fields,
          lessonId: event.target.value, targetPeriodId: 0 })}><option value="" disabled>選擇固定課程</option>
          {lessons.map((item) => <option key={item.id} value={item.id}>
            {data.classes.find((schoolClass) => schoolClass.id === item.classId)?.name}・
            {data.subjects.find((subject) => subject.id === item.subjectId)?.name}・週{item.day}・
            {item.weekPattern === 'every' ? '每週' : `${item.weekPattern} 週`}</option>)}</select></label>
        <label>原始上課日期<input required type="date" value={fields.sourceDate}
          onChange={(event) => setFields({ ...fields, sourceDate: event.target.value })} /></label>
        {mode === 'move' && <><label>目標日期<input required type="date" value={fields.targetDate}
          onChange={(event) => setFields({ ...fields, targetDate: event.target.value })} /></label>
          <label>目標節次<select required value={fields.targetPeriodId}
            onChange={(event) => setFields({ ...fields, targetPeriodId: Number(event.target.value) })}>
            <option value={0} disabled>選擇節次</option>{targetPeriods.map((item) => <option key={item.id} value={item.id}>
              {item.label}（{item.startTime}–{item.endTime}）</option>)}</select></label></>}
      </> : <>
        <label>任教單位<select required value={fields.teachingUnitId} onChange={(event) => setFields({ ...fields,
          teachingUnitId: event.target.value, classId: '', subjectId: '', periodId: 0 })}>
          <option value="" disabled>選擇任教單位</option>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>班級<select required value={fields.classId} onChange={(event) => setFields({ ...fields, classId: event.target.value })}>
          <option value="" disabled>選擇班級</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>科目<select required value={fields.subjectId} onChange={(event) => setFields({ ...fields, subjectId: event.target.value })}>
          <option value="" disabled>選擇科目</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>日期<input required type="date" value={fields.date}
          onChange={(event) => setFields({ ...fields, date: event.target.value })} /></label>
        <label>節次<select required value={fields.periodId} onChange={(event) => setFields({ ...fields, periodId: Number(event.target.value) })}>
          <option value={0} disabled>選擇節次</option>{extraPeriods.map((item) => <option key={item.id} value={item.id}>
            {item.label}（{item.startTime}–{item.endTime}）</option>)}</select></label>
        <label>教室<input value={fields.room} onChange={(event) => setFields({ ...fields, room: event.target.value })} /></label>
      </>}
      <button type="submit" disabled={!canWrite}>儲存單次操作</button>
    </form>}
    <h4>單次異動紀錄</h4>
    {records.changes.length === 0 && records.extras.length === 0 && <p>尚無單次異動或額外課程。</p>}
    {records.changes.map((item) => <div key={item.id} className="project-history-row">
      <span>{item.date}・{item.action === 'move' ? `調課至 ${item.target?.date}` : item.action === 'cancel' ? '停課' : '既有異動'}
        {item.originalLessonId ? `・${item.originalLessonId}` : ''}</span>
      <button type="button" disabled={!canWrite} onClick={() => remove('change', item.id)}>撤銷</button></div>)}
    {records.extras.map((item) => <div key={item.id} className="project-history-row">
      <span>{item.date}・{item.purpose === 'extra' ? '額外課程' : '既有單日課程'}・
        {data.classes.find((schoolClass) => schoolClass.id === item.classId)?.name}</span>
      {item.purpose === 'extra' && <button type="button" disabled={!canWrite}
        onClick={() => remove('extra', item.id)}>刪除</button>}</div>)}
    <button type="button" onClick={() => { if (discard()) onClose() }}>完成</button>
    {error && <p role="alert" className="form-error">{error}</p>}
    {success && <p role="status" className="form-success">{success}</p>}
  </section>
}

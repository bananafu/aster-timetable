import { useState, type FormEvent } from 'react'
import { getOneOffLessonConflicts, OneOffConflictError, type OneOffLessonDraft } from '../data/oneOffLessonsV7'
import { classDisplayName } from '../lib/classes'
import { subjectsForLevel } from '../lib/subjects'
import type { AppDataV7 } from '../types'
import type { ResolvedScheduleOccurrence } from '../lib/scheduleV4'
import { Modal } from './Modal'

const hours = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0'))
const minutes = Array.from({ length: 12 }, (_, value) => String(value * 5).padStart(2, '0'))
const purposeLabels = { extra: '單日新增', 'make-up': '補課', substitute: '代課' } as const

export interface OneOffSaveRequest {
  draft: OneOffLessonDraft
  /** Present only for editing. The caller must retain this ID. */
  id?: string
  allowConflict: boolean
}

interface Props {
  data: AppDataV7
  projectId: string
  timetableId: string
  oneOffLessonId?: string
  initialDate?: string
  initialTeachingUnitId?: string
  /** Re-run the v7 CRUD operation against the latest AppData in the parent. */
  onSave: (request: OneOffSaveRequest) => void | Promise<void>
  /** Called only after an explicit confirmation; the parent uses deleteOneOffLesson. */
  onDelete?: (id: string) => void | Promise<void>
  onClose: () => void
}

function conflictDescription(item: ResolvedScheduleOccurrence) {
  return `${item.schoolName}・${item.teachingUnitName}・${item.className}・${item.subjectName}（${item.startTime}–${item.endTime}）`
}

export function OneOffLessonEditor({ data, projectId, timetableId, oneOffLessonId, initialDate, initialTeachingUnitId, onSave, onDelete, onClose }: Props) {
  const existing = oneOffLessonId ? data.oneOffLessons.find((item) => item.id === oneOffLessonId) : undefined
  const initialUnit = data.teachingUnits.find((item) => item.id === (existing?.teachingUnitId ?? initialTeachingUnitId) && item.projectId === projectId)
  const [schoolId, setSchoolId] = useState(initialUnit?.schoolId ?? '')
  const [teachingUnitId, setTeachingUnitId] = useState(initialUnit?.id ?? '')
  const [classId, setClassId] = useState(existing?.classId ?? '')
  const [subjectId, setSubjectId] = useState(existing?.subjectId ?? '')
  const [date, setDate] = useState(existing?.date ?? initialDate ?? '')
  const [purpose, setPurpose] = useState<OneOffLessonDraft['purpose']>(existing?.purpose ?? 'extra')
  const [sourceId, setSourceId] = useState(existing?.relatedRecurringLessonId ?? '')
  const [room, setRoom] = useState(existing?.room ?? '')
  const [timeMode, setTimeMode] = useState<OneOffLessonDraft['time']['mode']>(existing?.time.mode ?? 'period')
  const [periodId, setPeriodId] = useState(existing?.time.mode === 'period' ? String(existing.time.periodId) : '')
  const [startHour, setStartHour] = useState(existing?.time.mode === 'custom' ? existing.time.startTime.slice(0, 2) : '09')
  const [startMinute, setStartMinute] = useState(existing?.time.mode === 'custom' ? existing.time.startTime.slice(3) : '00')
  const [endHour, setEndHour] = useState(existing?.time.mode === 'custom' ? existing.time.endTime.slice(0, 2) : '10')
  const [endMinute, setEndMinute] = useState(existing?.time.mode === 'custom' ? existing.time.endTime.slice(3) : '00')
  const [allowConflict, setAllowConflict] = useState(false)
  const [reportedConflicts, setReportedConflicts] = useState<ResolvedScheduleOccurrence[] | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const project = data.projects.find((item) => item.id === projectId)
  const timetable = data.timetables.find((item) => item.id === timetableId && item.projectId === projectId)
  const contextError = !project ? '找不到所選專案。' : !timetable ? '教師課表不屬於所選專案。'
    : oneOffLessonId && !existing ? '找不到要編輯的單日課程。'
      : existing && (existing.projectId !== projectId || existing.timetableId !== timetableId) ? '單日課程不屬於目前專案與教師課表。' : ''
  const readOnly = Boolean(project?.archivedAt || contextError)
  const locked = readOnly || pending
  const schools = data.schools.filter((item) => item.projectId === projectId)
  const units = data.teachingUnits.filter((item) => item.projectId === projectId && item.schoolId === schoolId)
  const unit = units.find((item) => item.id === teachingUnitId)
  const classes = data.classes.filter((item) => item.projectId === projectId && item.teachingUnitId === teachingUnitId)
  const subjects = subjectsForLevel(data.subjects, unit?.schoolLevel)
  const periods = [...(unit?.periods ?? [])].sort((left, right) => left.order - right.order)
  const sources = data.recurringLessons.filter((item) => item.projectId === projectId && item.timetableId === timetableId)
  const startTime = `${startHour}:${startMinute}`
  const endTime = `${endHour}:${endMinute}`
  const timeValid = timeMode === 'period' ? periods.some((item) => String(item.id) === periodId) : endTime > startTime
  const complete = Boolean(unit && classes.some((item) => item.id === classId) && subjects.some((item) => item.id === subjectId)
    && date && date >= unit.startDate && date <= unit.endDate && timeValid)

  const draft: OneOffLessonDraft = {
    projectId, timetableId, teachingUnitId, classId, subjectId, date, purpose,
    ...(purpose === 'make-up' && sourceId ? { relatedRecurringLessonId: sourceId } : {}),
    ...(room.trim() ? { room: room.trim() } : {}),
    time: timeMode === 'period' ? { mode: 'period', periodId: Number(periodId) }
      : { mode: 'custom', startTime, endTime },
  }
  let previewConflicts: ResolvedScheduleOccurrence[] = []
  let previewError = ''
  if (complete && !readOnly) {
    try { previewConflicts = getOneOffLessonConflicts(data, draft, existing?.id) }
    catch (cause) { previewError = cause instanceof Error ? cause.message : '無法驗證單日課程。' }
  }
  const conflicts = reportedConflicts ?? previewConflicts
  const change = (action: () => void) => { action(); setError(''); setAllowConflict(false); setReportedConflicts(null) }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (locked) return
    if (!complete) {
      setError(timeMode === 'custom' && !timeValid ? '結束時間必須晚於開始時間，不支援跨午夜。'
        : '請選擇有效的日期、學校、學制、班級、科目與節次。')
      return
    }
    if (previewError) { setError(previewError); return }
    if (conflicts.length && !allowConflict) { setError('此時段已有課程；請調整時間，或明確勾選允許衝堂。'); return }
    setPending(true)
    setError('')
    try { await onSave({ draft, ...(existing ? { id: existing.id } : {}), allowConflict }) }
    catch (cause) {
      if (cause instanceof OneOffConflictError) { setReportedConflicts(cause.conflicts); setAllowConflict(false) }
      setError(cause instanceof Error ? cause.message : '儲存失敗，請再試一次。')
    } finally { setPending(false) }
  }

  const remove = async () => {
    if (!existing || !onDelete || locked || !window.confirm('確定刪除這堂單日課程？此操作不影響固定課程。')) return
    setPending(true)
    setError('')
    try { await onDelete(existing.id) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '刪除失敗，請再試一次。') }
    finally { setPending(false) }
  }

  return <Modal title={oneOffLessonId ? '編輯單日課程' : '新增單日課程'} subtitle={`僅此日期・${timetable?.name ?? '未選擇教師課表'}`} onClose={() => { if (!pending) onClose() }}>
    <form className="form-grid one-off-editor" onSubmit={(event) => { void submit(event) }}>
      {project?.archivedAt && <p className="full one-off-notice" role="status">封存專案為唯讀，無法修改單日課程。</p>}
      {contextError && <p className="full one-off-error" role="alert">{contextError}</p>}
      <label>用途<select value={purpose} disabled={locked} onChange={(event) => change(() => setPurpose(event.target.value as OneOffLessonDraft['purpose']))}>
        {Object.entries(purposeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>指定日期<input type="date" value={date} disabled={locked} onChange={(event) => change(() => setDate(event.target.value))} /></label>
      <label>學校<select value={schoolId} disabled={locked} onChange={(event) => change(() => { setSchoolId(event.target.value); setTeachingUnitId(''); setClassId(''); setSubjectId(''); setPeriodId('') })}>
        <option value="">請選擇學校</option>{schools.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>學制<select value={teachingUnitId} disabled={locked || !schoolId} onChange={(event) => change(() => { setTeachingUnitId(event.target.value); setClassId(''); setSubjectId(''); setPeriodId('') })}>
        <option value="">請選擇學制</option>{units.map((item) => <option key={item.id} value={item.id}>{item.schoolLevel === 'other' ? item.name : item.schoolLevel === 'junior-high' ? '國中部' : '高中部'}・{item.name}</option>)}
      </select></label>
      <label>班級<select value={classId} disabled={locked || !unit} onChange={(event) => change(() => setClassId(event.target.value))}>
        <option value="">請選擇班級</option>{classes.map((item) => <option key={item.id} value={item.id}>{classDisplayName(item)}</option>)}
      </select></label>
      <label>科目<select value={subjectId} disabled={locked || !unit} onChange={(event) => change(() => setSubjectId(event.target.value))}>
        <option value="">請選擇科目</option>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      {purpose === 'make-up' && <label className="full">補課來源（選填）<select value={sourceId} disabled={locked} onChange={(event) => change(() => setSourceId(event.target.value))}>
        <option value="">不指定來源</option>
        {sourceId && !sources.some((item) => item.id === sourceId) && <option value={sourceId}>原課已刪除・{sourceId}</option>}
        {sources.map((item) => <option key={item.id} value={item.id}>{data.subjects.find((subject) => subject.id === item.subjectId)?.name ?? item.subjectId}・{data.classes.find((schoolClass) => schoolClass.id === item.classId)?.name ?? item.classId}（{item.id}）</option>)}
      </select></label>}
      <label>時間模式<select value={timeMode} disabled={locked} onChange={(event) => change(() => setTimeMode(event.target.value as OneOffLessonDraft['time']['mode']))}>
        <option value="period">學制節次</option><option value="custom">自訂時間</option>
      </select></label>
      {timeMode === 'period' ? <label>節次<select value={periodId} disabled={locked || !unit} onChange={(event) => change(() => setPeriodId(event.target.value))}>
        <option value="">請選擇節次</option>{periods.map((item) => <option key={item.id} value={item.id}>{item.label}・{item.startTime}–{item.endTime}</option>)}
      </select></label> : <div className="full one-off-time-grid">
        <fieldset disabled={locked}><legend>開始時間</legend><label>開始小時<select value={startHour} onChange={(event) => change(() => setStartHour(event.target.value))}>{hours.map((value) => <option key={value}>{value}</option>)}</select></label><label>開始分鐘<select value={startMinute} onChange={(event) => change(() => setStartMinute(event.target.value))}>{minutes.map((value) => <option key={value}>{value}</option>)}</select></label></fieldset>
        <fieldset disabled={locked}><legend>結束時間</legend><label>結束小時<select value={endHour} onChange={(event) => change(() => setEndHour(event.target.value))}>{hours.map((value) => <option key={value}>{value}</option>)}</select></label><label>結束分鐘<select value={endMinute} onChange={(event) => change(() => setEndMinute(event.target.value))}>{minutes.map((value) => <option key={value}>{value}</option>)}</select></label></fieldset>
      </div>}
      <label className="full">教室（選填）<input value={room} disabled={locked} onChange={(event) => change(() => setRoom(event.target.value))} /></label>
      {unit && date && (date < unit.startDate || date > unit.endDate) && <p className="full one-off-error" role="alert">日期須位於此學制的學期範圍：{unit.startDate}–{unit.endDate}。</p>}
      {timeMode === 'custom' && !timeValid && <p className="full one-off-error" role="alert">結束時間必須晚於開始時間，不支援跨午夜。</p>}
      {previewError && <p className="full one-off-error" role="alert">{previewError}</p>}
      {conflicts.length > 0 && <div className="full one-off-conflicts" role="status"><strong>此時段已有 {conflicts.length} 堂課</strong><ul>{conflicts.map((item) => <li key={item.occurrenceKey}>{conflictDescription(item)}</li>)}</ul><label><input type="checkbox" checked={allowConflict} disabled={locked} onChange={(event) => { setAllowConflict(event.target.checked); setError('') }} />明確允許衝堂，保留兩堂課</label></div>}
      {error && <p className="full one-off-error" role="alert">{error}</p>}
      <div className="full form-actions">
        {existing && onDelete && <button type="button" className="danger-button one-off-delete" disabled={locked} onClick={() => { void remove() }}>刪除單日課程</button>}
        <button type="button" disabled={pending} onClick={onClose}>關閉</button>
        {!readOnly && <button type="submit" className="primary-button" disabled={pending || !complete || Boolean(previewError) || (conflicts.length > 0 && !allowConflict)}>{pending ? '處理中…' : existing ? '送出修改' : '送出新增'}</button>}
      </div>
    </form>
  </Modal>
}

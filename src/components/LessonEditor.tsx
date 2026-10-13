import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { cancelLessonOnDate, endLessonFromDate, moveLessonOnDate, permanentlySwapLessons, permanentlyUpdateLesson, replaceLessonOnDate, swapLessonsOnDate } from '../data/lessonChangesV4'
import { addLessonV4, deleteLessonV4, updateLessonV4, type LessonDraftV4 } from '../data/lessonsV4'
import { fromDateKey, toDateKey } from '../lib/date'
import { resolveProjectDay } from '../lib/scheduleV4'
import type { AppDataV4, DayOfWeek, WeekPattern } from '../types'
import { Modal } from './Modal'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
type ChangeMode = 'basic' | 'cancel' | 'move' | 'replace' | 'swap' | 'permanent' | 'permanent-swap' | 'end'

export interface LessonEditorContext { projectId?: string; teachingUnitId?: string; day?: DayOfWeek; periodId?: number }
interface Props {
  data: AppDataV4
  setData: Dispatch<SetStateAction<AppDataV4>>
  lessonId?: string | null
  occurrenceDate?: string | null
  context?: LessonEditorContext
  onClose: () => void
  onSaved: (projectId: string) => void
}

function messageFor(error: unknown) {
  if (!(error instanceof Error)) return '無法儲存課程，請確認欄位內容。'
  if (error.message.includes('occupied')) return '目標時間已有課程。請改用交換、勾選保留衝堂，或取消操作。'
  if (error.message.includes('matching real-time')) return '跨校交換需要雙方任教單位都有完全相同起訖時間的節次。'
  if (error.message.includes('already has an override')) return '這堂課在指定日期已有異動，請先處理既有異動。'
  if (error.message.includes('does not occur') || error.message.includes('outside')) return '指定日期沒有這堂課，請選擇實際上課日期。'
  if (error.message.includes('conflict')) return '異動會造成課程版本衝突，請調整日期、節次或輪週。'
  if (error.message.includes('overrides') || error.message.includes('Future')) return '此課程仍有相關單日異動，為保護歷史資料，目前不能刪除或結束。'
  if (error.message.includes('read-only')) return '封存專案為唯讀，請先重新啟用後再修改。'
  return '課程資料未通過驗證，請確認日期、歸屬、班級與節次。'
}

export function LessonEditor({ data, setData, lessonId, occurrenceDate, context, onClose, onSaved }: Props) {
  const lesson = lessonId ? data.recurringLessons.find((item) => item.id === lessonId) : undefined
  const initialProjectId = lesson?.projectId ?? context?.projectId ?? data.activeProjectId ?? data.projects.find((item) => !item.archivedAt)?.id ?? ''
  const initialUnit = data.teachingUnits.find((item) => item.id === (lesson?.teachingUnitId ?? context?.teachingUnitId)) ?? data.teachingUnits.find((item) => item.projectId === initialProjectId)
  const initialSchoolId = initialUnit?.schoolId ?? data.schools.find((item) => item.projectId === initialProjectId)?.id ?? ''
  const [projectId, setProjectId] = useState(initialProjectId)
  const [schoolId, setSchoolId] = useState(initialSchoolId)
  const [teachingUnitId, setTeachingUnitId] = useState(initialUnit?.id ?? '')
  const [subjectId, setSubjectId] = useState(lesson?.subjectId ?? data.subjects[0]?.id ?? '')
  const [classId, setClassId] = useState(lesson?.classId ?? data.classes.find((item) => item.teachingUnitId === initialUnit?.id)?.id ?? '')
  const [day, setDay] = useState<DayOfWeek>(lesson?.day ?? context?.day ?? 1)
  const [periodId, setPeriodId] = useState(lesson?.periodId ?? context?.periodId ?? initialUnit?.periods[0]?.id ?? 0)
  const [weekPattern, setWeekPattern] = useState<WeekPattern>(lesson?.weekPattern ?? 'every')
  const [room, setRoom] = useState(lesson?.room ?? '')
  const [mode, setMode] = useState<ChangeMode>('basic')
  const [changeDate, setChangeDate] = useState(occurrenceDate ?? lesson?.effectiveStart ?? toDateKey(new Date()))
  const [targetDate, setTargetDate] = useState(occurrenceDate ?? lesson?.effectiveStart ?? toDateKey(new Date()))
  const [targetPeriodId, setTargetPeriodId] = useState(lesson?.periodId ?? initialUnit?.periods[0]?.id ?? 0)
  const [swapLessonId, setSwapLessonId] = useState('')
  const [allowConflict, setAllowConflict] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ data: AppDataV4; summary: string } | null>(null)

  const projects = data.projects.filter((item) => !item.archivedAt)
  const schools = useMemo(() => data.schools.filter((item) => item.projectId === projectId), [data.schools, projectId])
  const units = useMemo(() => data.teachingUnits.filter((item) => item.projectId === projectId && item.schoolId === schoolId), [data.teachingUnits, projectId, schoolId])
  const unit = data.teachingUnits.find((item) => item.id === teachingUnitId)
  const classes = data.classes.filter((item) => item.projectId === projectId && item.teachingUnitId === teachingUnitId)
  const periods = [...(unit?.periods ?? [])].sort((left, right) => left.order - right.order)
  const candidates = lesson ? resolveProjectDay(data, lesson.projectId, fromDateKey(changeDate)).filter((item) => item.id !== lesson.id && item.status !== 'cancelled') : []
  const draft: LessonDraftV4 = { projectId, schoolId, teachingUnitId, subjectId, classId, day, periodId, weekPattern, room }
  const resetPreview = () => { setPreview(null); setError('') }

  const selectProject = (nextProjectId: string) => {
    const nextSchool = data.schools.find((item) => item.projectId === nextProjectId)
    const nextUnit = data.teachingUnits.find((item) => item.projectId === nextProjectId && item.schoolId === nextSchool?.id)
    setProjectId(nextProjectId); setSchoolId(nextSchool?.id ?? ''); setTeachingUnitId(nextUnit?.id ?? '')
    setClassId(data.classes.find((item) => item.projectId === nextProjectId && item.teachingUnitId === nextUnit?.id)?.id ?? '')
    setPeriodId(nextUnit?.periods[0]?.id ?? 0); setTargetPeriodId(nextUnit?.periods[0]?.id ?? 0); setWeekPattern('every'); resetPreview()
  }
  const selectSchool = (nextSchoolId: string) => {
    const nextUnit = data.teachingUnits.find((item) => item.projectId === projectId && item.schoolId === nextSchoolId)
    setSchoolId(nextSchoolId); setTeachingUnitId(nextUnit?.id ?? ''); setClassId(data.classes.find((item) => item.teachingUnitId === nextUnit?.id)?.id ?? '')
    setPeriodId(nextUnit?.periods[0]?.id ?? 0); setTargetPeriodId(nextUnit?.periods[0]?.id ?? 0); setWeekPattern('every'); resetPreview()
  }
  const selectUnit = (nextUnitId: string) => {
    const nextUnit = data.teachingUnits.find((item) => item.id === nextUnitId)
    setTeachingUnitId(nextUnitId); setClassId(data.classes.find((item) => item.teachingUnitId === nextUnitId)?.id ?? '')
    setPeriodId(nextUnit?.periods[0]?.id ?? 0); setTargetPeriodId(nextUnit?.periods[0]?.id ?? 0); setWeekPattern('every'); resetPreview()
  }

  const buildChange = () => {
    if (!lesson) throw new Error('Lesson does not exist')
    if (mode === 'cancel') return { data: cancelLessonOnDate(data, lesson.id, changeDate, uid), summary: `${changeDate} 僅取消此堂課；固定課表與其他日期不變。` }
    if (mode === 'move') return { data: moveLessonOnDate(data, lesson.id, changeDate, { date: targetDate, periodId: targetPeriodId }, allowConflict, uid), summary: `${changeDate} 的課程移至 ${targetDate} 指定節次；原位置留白且只顯示一次。` }
    if (mode === 'replace') return { data: replaceLessonOnDate(data, lesson.id, changeDate, { subjectId, classId, room }, uid), summary: `${changeDate} 僅替換科目、班級或教室；課程歸屬與固定版本不變。` }
    if (mode === 'swap') return { data: swapLessonsOnDate(data, lesson.id, swapLessonId, changeDate, uid), summary: `${changeDate} 交換兩堂課的實際時段；其他日期不變。` }
    if (mode === 'permanent') return { data: permanentlyUpdateLesson(data, lesson.id, changeDate, draft, uid), summary: `從 ${changeDate} 起建立新課程版本；日期前的歷史版本保留。` }
    if (mode === 'permanent-swap') return { data: permanentlySwapLessons(data, lesson.id, swapLessonId, changeDate, uid), summary: `從 ${changeDate} 起永久交換兩堂課並保留雙方歷史版本。` }
    if (mode === 'end') return { data: endLessonFromDate(data, lesson.id, changeDate), summary: `從 ${changeDate} 起結束此課程；先前歷史仍保留。` }
    throw new Error('Unsupported change')
  }
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      if (!lesson || mode === 'basic') {
        const next = lesson ? updateLessonV4(data, lesson.id, draft) : addLessonV4(data, draft, uid)
        setData(next); onSaved(projectId); onClose(); return
      }
      setPreview(buildChange())
    } catch (reason) { setError(messageFor(reason)); setPreview(null) }
  }
  const confirmChange = () => {
    if (!preview) return
    setData(preview.data); onSaved(projectId); onClose()
  }
  const remove = () => {
    if (!lesson || !window.confirm(`確定刪除這筆固定課程？\n${lesson.id}\n若要保留歷史，請改用「從此日期起結束」。`)) return
    try { setData(deleteLessonV4(data, lesson.id)); onClose() } catch (reason) { setError(messageFor(reason)) }
  }
  const addSubject = () => {
    const name = newSubjectName.trim(); if (!name) { setError('請輸入科目名稱。'); return }
    const id = uid(); setData((current) => ({ ...current, subjects: [...current.subjects, { id, name, shortName: name.slice(0, 2), color: '#A66D52', origin: 'user' }] }))
    setSubjectId(id); setNewSubjectName(''); setError('')
  }
  const needsContent = mode === 'basic' || mode === 'replace' || mode === 'permanent'
  const needsSwap = mode === 'swap' || mode === 'permanent-swap'

  return <Modal title={lesson ? '編輯課程' : '新增固定課程'} subtitle={lesson ? '清楚區分僅此日期與永久版本；異動須預覽確認後才寫入。' : '直接寫入 AppData v4。'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {lesson && <label className="full">操作範圍<select aria-label="課程異動類型" value={mode} onChange={(event) => { setMode(event.target.value as ChangeMode); resetPreview() }}><option value="basic">修改目前固定版本</option><optgroup label="僅此日期"><option value="cancel">取消課程</option><option value="move">移動課程</option><option value="replace">替換內容</option><option value="swap">交換兩堂課</option></optgroup><optgroup label="從此日期起"><option value="permanent">永久修改</option><option value="permanent-swap">永久交換</option><option value="end">結束課程</option></optgroup></select></label>}
    {lesson && mode !== 'basic' && <label className="full">指定／生效日期<input aria-label="異動日期" type="date" value={changeDate} onChange={(event) => { setChangeDate(event.target.value); setTargetDate(event.target.value); setSwapLessonId(''); resetPreview() }} required /></label>}
    {mode === 'move' && <><label>移至日期<input aria-label="移至日期" type="date" value={targetDate} onChange={(event) => { setTargetDate(event.target.value); resetPreview() }} required /></label><label>移至節次<select aria-label="移至節次" value={targetPeriodId} onChange={(event) => { setTargetPeriodId(Number(event.target.value)); resetPreview() }}>{periods.map((period) => <option key={period.id} value={period.id}>{period.label}（{period.startTime}–{period.endTime}）</option>)}</select></label><label className="full checkbox-row"><input type="checkbox" checked={allowConflict} onChange={(event) => { setAllowConflict(event.target.checked); resetPreview() }} />目標已有課程時仍保留雙方並顯示衝堂警告</label></>}
    {needsSwap && <label className="full">交換對象<select aria-label="交換課程" value={swapLessonId} onChange={(event) => { setSwapLessonId(event.target.value); resetPreview() }} required><option value="">請選擇同日課程</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.startTime} {item.subjectName}・{item.className}（{item.schoolName}）</option>)}</select></label>}
    {needsContent && <>
      <label className="full">課表專案<select aria-label="課程專案" value={projectId} onChange={(event) => selectProject(event.target.value)} disabled={Boolean(lesson)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>學校<select aria-label="課程學校" value={schoolId} onChange={(event) => selectSchool(event.target.value)} disabled={mode === 'replace'}>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
      <label>任教單位<select aria-label="課程任教單位" value={teachingUnitId} onChange={(event) => selectUnit(event.target.value)} disabled={mode === 'replace'}>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {data.subjects.length > 0 ? <label>科目<select aria-label="課程科目" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); resetPreview() }}>{data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label> : <div className="lesson-subject-create"><label>新科目<input aria-label="新科目名稱" value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} /></label><button type="button" onClick={addSubject}>建立科目</button></div>}
      <label>班級<select aria-label="課程班級" value={classId} onChange={(event) => { setClassId(event.target.value); resetPreview() }}>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {mode !== 'replace' && <><label>星期<select aria-label="課程星期" value={day} onChange={(event) => { setDay(Number(event.target.value) as DayOfWeek); resetPreview() }}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>週{'一二三四五'[value - 1]}</option>)}</select></label><label>節次<select aria-label="課程節次" value={periodId} onChange={(event) => { setPeriodId(Number(event.target.value)); resetPreview() }}>{periods.map((period) => <option key={period.id} value={period.id}>{period.label}（{period.startTime}–{period.endTime}）</option>)}</select></label><label>輪週<select aria-label="課程輪週" value={weekPattern} onChange={(event) => { setWeekPattern(event.target.value as WeekPattern); resetPreview() }}><option value="every">每週</option>{unit?.weekCycle.enabled && <><option value="A">A 週</option><option value="B">B 週</option></>}</select></label></>}
      <label>教室<input value={room} onChange={(event) => { setRoom(event.target.value); resetPreview() }} placeholder="依班級預設" /></label>
    </>}
    {preview && <div className="migration-summary full" role="status"><strong>異動預覽</strong><span>{preview.summary}</span><span>尚未寫入；請再次確認。</span></div>}
    {error && <p className="form-error full" role="alert">{error}</p>}
    <div className="form-actions full">{lesson && mode === 'basic' && <button type="button" className="danger-button" onClick={remove}>刪除固定課程</button>}<button type="button" onClick={onClose}>取消</button>{preview ? <button type="button" className="primary-button" onClick={confirmChange}>確認套用</button> : <button type="submit" className="primary-button" disabled={needsSwap && !swapLessonId}>{lesson && mode !== 'basic' ? '預覽異動' : '儲存'}</button>}</div>
  </form></Modal>
}

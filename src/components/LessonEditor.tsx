import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { addLessonV4, deleteLessonV4, updateLessonV4, type LessonDraftV4 } from '../data/lessonsV4'
import type { AppDataV4, DayOfWeek, WeekPattern } from '../types'
import { Modal } from './Modal'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

export interface LessonEditorContext {
  projectId?: string
  teachingUnitId?: string
  day?: DayOfWeek
  periodId?: number
}

interface Props {
  data: AppDataV4
  setData: Dispatch<SetStateAction<AppDataV4>>
  lessonId?: string | null
  context?: LessonEditorContext
  onClose: () => void
  onSaved: (projectId: string) => void
}

function messageFor(error: unknown) {
  if (!(error instanceof Error)) return '無法儲存課程，請確認欄位內容。'
  if (error.message.includes('conflicting')) return '相同任教單位、星期、節次與輪週已有重疊的固定課程。'
  if (error.message.includes('overrides')) return '此課程已有單日異動，為避免資料遺失，目前不能刪除。'
  if (error.message.includes('moved safely')) return '此課程已有單日異動，不能直接變更星期、節次、輪週或歸屬。'
  if (error.message.includes('read-only')) return '封存專案為唯讀，請先重新啟用後再修改。'
  return '課程資料未通過驗證，請確認專案、學校、任教單位、班級與節次的歸屬。'
}

export function LessonEditor({ data, setData, lessonId, context, onClose, onSaved }: Props) {
  const lesson = lessonId ? data.recurringLessons.find((item) => item.id === lessonId) : undefined
  const initialProjectId = lesson?.projectId ?? context?.projectId ?? data.activeProjectId ?? data.projects.find((item) => !item.archivedAt)?.id ?? ''
  const initialUnit = data.teachingUnits.find((item) => item.id === (lesson?.teachingUnitId ?? context?.teachingUnitId))
    ?? data.teachingUnits.find((item) => item.projectId === initialProjectId)
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
  const [newSubjectName, setNewSubjectName] = useState('')
  const [error, setError] = useState('')

  const projects = data.projects.filter((item) => !item.archivedAt)
  const schools = useMemo(() => data.schools.filter((item) => item.projectId === projectId), [data.schools, projectId])
  const units = useMemo(() => data.teachingUnits.filter((item) => item.projectId === projectId && item.schoolId === schoolId), [data.teachingUnits, projectId, schoolId])
  const unit = data.teachingUnits.find((item) => item.id === teachingUnitId)
  const classes = data.classes.filter((item) => item.projectId === projectId && item.teachingUnitId === teachingUnitId)
  const periods = [...(unit?.periods ?? [])].sort((left, right) => left.order - right.order)

  const selectProject = (nextProjectId: string) => {
    const nextSchool = data.schools.find((item) => item.projectId === nextProjectId)
    const nextUnit = data.teachingUnits.find((item) => item.projectId === nextProjectId && item.schoolId === nextSchool?.id)
    setProjectId(nextProjectId); setSchoolId(nextSchool?.id ?? ''); setTeachingUnitId(nextUnit?.id ?? '')
    setClassId(data.classes.find((item) => item.projectId === nextProjectId && item.teachingUnitId === nextUnit?.id)?.id ?? '')
    setPeriodId(nextUnit?.periods[0]?.id ?? 0); setWeekPattern('every')
  }
  const selectSchool = (nextSchoolId: string) => {
    const nextUnit = data.teachingUnits.find((item) => item.projectId === projectId && item.schoolId === nextSchoolId)
    setSchoolId(nextSchoolId); setTeachingUnitId(nextUnit?.id ?? '')
    setClassId(data.classes.find((item) => item.teachingUnitId === nextUnit?.id)?.id ?? '')
    setPeriodId(nextUnit?.periods[0]?.id ?? 0); setWeekPattern('every')
  }
  const selectUnit = (nextUnitId: string) => {
    const nextUnit = data.teachingUnits.find((item) => item.id === nextUnitId)
    setTeachingUnitId(nextUnitId); setClassId(data.classes.find((item) => item.teachingUnitId === nextUnitId)?.id ?? '')
    setPeriodId(nextUnit?.periods[0]?.id ?? 0); setWeekPattern('every')
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const draft: LessonDraftV4 = { projectId, schoolId, teachingUnitId, subjectId, classId, day, periodId, weekPattern, room }
    try {
      const next = lesson ? updateLessonV4(data, lesson.id, draft) : addLessonV4(data, draft, uid)
      setData(next); onSaved(projectId); onClose()
    } catch (reason) { setError(messageFor(reason)) }
  }
  const remove = () => {
    if (!lesson || !window.confirm(`確定刪除這筆固定課程？\n${lesson.id}\n此操作不會刪除科目或班級。`)) return
    try { setData(deleteLessonV4(data, lesson.id)); onClose() } catch (reason) { setError(messageFor(reason)) }
  }
  const addSubject = () => {
    const name = newSubjectName.trim()
    if (!name) { setError('請輸入科目名稱。'); return }
    const id = uid()
    setData((current) => ({ ...current, subjects: [...current.subjects, { id, name, shortName: name.slice(0, 2), color: '#A66D52', origin: 'user' }] }))
    setSubjectId(id); setNewSubjectName(''); setError('')
  }

  return <Modal title={lesson ? '編輯固定課程' : '新增固定課程'} subtitle="直接寫入 AppData v4；單日異動與永久版本切分留待 Phase 3B。" onClose={onClose}><form className="form-grid" onSubmit={submit}>
    <label className="full">課表專案<select aria-label="課程專案" value={projectId} onChange={(event) => selectProject(event.target.value)} disabled={Boolean(lesson)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
    <label>學校<select aria-label="課程學校" value={schoolId} onChange={(event) => selectSchool(event.target.value)}>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
    <label>任教單位<select aria-label="課程任教單位" value={teachingUnitId} onChange={(event) => selectUnit(event.target.value)}>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    {data.subjects.length > 0 ? <label>科目<select aria-label="課程科目" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label> : <div className="lesson-subject-create"><label>新科目<input aria-label="新科目名稱" value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} placeholder="例如：國文" /></label><button type="button" onClick={addSubject}>建立科目</button></div>}
    <label>班級<select aria-label="課程班級" value={classId} onChange={(event) => setClassId(event.target.value)}>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>星期<select aria-label="課程星期" value={day} onChange={(event) => setDay(Number(event.target.value) as DayOfWeek)}>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>週{'一二三四五'[value - 1]}</option>)}</select></label>
    <label>節次<select aria-label="課程節次" value={periodId} onChange={(event) => setPeriodId(Number(event.target.value))}>{periods.map((period) => <option key={period.id} value={period.id}>{period.label}（{period.startTime}–{period.endTime}）</option>)}</select></label>
    <label>輪週<select aria-label="課程輪週" value={weekPattern} onChange={(event) => setWeekPattern(event.target.value as WeekPattern)}><option value="every">每週</option>{unit?.weekCycle.enabled && <><option value="A">A 週</option><option value="B">B 週</option></>}</select></label>
    <label>教室<input value={room} onChange={(event) => setRoom(event.target.value)} placeholder="依班級預設" /></label>
    {(!classes.length || !periods.length) && <p className="form-error full">請先在專案設定完成班級與節次資料。</p>}
    {error && <p className="form-error full" role="alert">{error}</p>}
    <div className="form-actions full">{lesson && <button type="button" className="danger-button" onClick={remove}>刪除固定課程</button>}<button type="button" onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={!projectId || !schoolId || !teachingUnitId || !subjectId || !classId || !periodId}>儲存</button></div>
  </form></Modal>
}

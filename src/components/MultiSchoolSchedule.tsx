import { useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react'
import { AlertTriangle, MapPin } from 'lucide-react'
import { addDays, dayNames, formatShortDate, toDateKey } from '../lib/date'
import { createLessonDragIntent, type LessonDragIntent } from '../lib/lessonDrag'
import { resolveProjectWeek, type ResolvedLessonV4, type ResolvedScheduleOccurrence } from '../lib/scheduleV4'
import type { AppDataV4, TeachingUnit } from '../types'

type ScheduleScope = 'all' | 'school'
const weekDayLabels = ['週日', ...dayNames, '週六']
const unitLabel = (unit: TeachingUnit, units: TeachingUnit[]) => {
  const peers = units.filter((item) => item.schoolId === unit.schoolId && item.schoolLevel === unit.schoolLevel)
  const base = unit.schoolLevel === 'junior-high' ? '國中部' : unit.schoolLevel === 'senior-high' ? '高中部' : unit.name
  return peers.length > 1 ? `${base}（${unit.name}）` : base
}

interface Props {
  data: AppDataV4
  weekDays: Date[]
  projectId?: string | null
  timetableId?: string
  onLessonClick?: (lessonId: string, date: string, overrideId?: string) => void
  onLessonDrop?: (intent: LessonDragIntent) => void
  onOneOffClick?: (oneOffId: string) => void
}

function minutes(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function isShortBreak(previous: ResolvedScheduleOccurrence | undefined, current: ResolvedScheduleOccurrence) {
  if (!previous || (previous.kind === 'recurring' && previous.status === 'cancelled') || (current.kind === 'recurring' && current.status === 'cancelled')) return false
  const gap = minutes(current.startTime) - minutes(previous.endTime)
  return gap >= 5 && gap <= 20
}

function LessonCard({ lesson, previous, onClick, draggable, onDragStart, onDragEnd, onDragOver, onDrop }: { lesson: ResolvedScheduleOccurrence; previous?: ResolvedScheduleOccurrence; onClick?: () => void; draggable?: boolean; onDragStart?: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd?: () => void; onDragOver?: (event: DragEvent<HTMLButtonElement>) => void; onDrop?: (event: DragEvent<HTMLButtonElement>) => void }) {
  const style = { '--subject-color': lesson.subjectColor, '--school-color': lesson.schoolColor } as CSSProperties
  const statusLabel = lesson.kind === 'one-off' ? lesson.purpose === 'make-up' ? '補課' : lesson.purpose === 'substitute' ? '代課' : '單日新增'
    : lesson.status === 'cancelled' ? '單日取消' : lesson.status === 'replaced' ? '單日替換' : lesson.status === 'moved' ? '單日移動' : null
  return <button type="button"
    className={`multi-lesson-card ${lesson.kind === 'recurring' ? lesson.status : 'one-off'} ${lesson.hasConflict ? 'conflict' : ''} ${isShortBreak(previous, lesson) ? 'short-break' : ''}`}
    style={style}
    onClick={onClick}
    disabled={!onClick}
    aria-label={`${lesson.kind === 'one-off' ? '編輯單日課程' : '編輯'} ${lesson.subjectName}・${lesson.className}`}
    draggable={draggable}
    onDragStart={onDragStart}
    onDragEnd={onDragEnd}
    onDragOver={onDragOver}
    onDrop={onDrop}
  >
    <div className="multi-lesson-time"><strong>{lesson.kind === 'one-off' && lesson.timeMode === 'custom' ? '自訂時間' : lesson.periodLabel}</strong><span>{lesson.startTime}–{lesson.endTime}</span></div>
    <div className="multi-lesson-body">
      <div className="multi-lesson-title"><strong>{lesson.subjectName}</strong>{statusLabel && <em>{statusLabel}</em>}{lesson.hasConflict && <em className="conflict-label"><AlertTriangle size={12} />衝堂</em>}</div>
      <span>{lesson.className}</span>
      <small>{lesson.schoolName}・{lesson.teachingUnitName}</small>
      {lesson.room && <small><MapPin size={11} />{lesson.room}</small>}
    </div>
  </button>
}

export function MultiSchoolSchedule({ data, weekDays, projectId: requestedProjectId, timetableId, onLessonClick, onLessonDrop, onOneOffClick }: Props) {
  const [scope, setScope] = useState<ScheduleScope>('all')
  const [showWeekend, setShowWeekend] = useState(false)
  const projectId = requestedProjectId === undefined ? data.activeProjectId : requestedProjectId
  const schools = useMemo(() => data.schools.filter((item) => item.projectId === projectId), [data.schools, projectId])
  const units = useMemo(() => data.teachingUnits.filter((item) => item.projectId === projectId), [data.teachingUnits, projectId])
  const [schoolId, setSchoolId] = useState(() => schools[0]?.id ?? '')
  const [unitId, setUnitId] = useState('all')
  const [draggedLesson, setDraggedLesson] = useState<ResolvedLessonV4 | null>(null)
  const [dragFeedback, setDragFeedback] = useState('')

  useEffect(() => {
    setSchoolId(schools[0]?.id ?? '')
    setUnitId('all')
  }, [projectId, schools])
  useEffect(() => { setDraggedLesson(null); setDragFeedback('') }, [timetableId])
  useEffect(() => {
    const cancelDrag = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && draggedLesson) { setDraggedLesson(null); setDragFeedback('已取消拖曳，沒有修改任何資料。') }
    }
    window.addEventListener('keydown', cancelDrag)
    return () => window.removeEventListener('keydown', cancelDrag)
  }, [draggedLesson])

  const schoolUnits = units.filter((item) => item.schoolId === schoolId)
  const fullWeekDays = useMemo(() => weekDays[0]
    ? Array.from({ length: 7 }, (_, index) => addDays(weekDays[0], index - 1)) : [], [weekDays])
  const fullSchedule = useMemo(
    () => projectId && (data.schemaVersion < 6 || timetableId)
      ? resolveProjectWeek(data, projectId, fullWeekDays, scope === 'school'
        ? { timetableId, schoolId, teachingUnitId: unitId === 'all' ? undefined : unitId }
        : { timetableId }) : [],
    [data, projectId, timetableId, fullWeekDays, scope, schoolId, unitId],
  )
  const weekendLessonCount = [fullSchedule[0], fullSchedule[6]].flatMap((day) => day?.lessons ?? []).filter((lesson) => lesson.kind === 'one-off' || lesson.status !== 'cancelled').length
  const schedule = showWeekend ? fullSchedule : fullSchedule.slice(1, 6)
  const conflictCount = schedule.flatMap((day) => day.lessons).filter((lesson) => lesson.hasConflict).length
  const draggedUnit = draggedLesson ? data.teachingUnits.find((item) => item.id === draggedLesson.teachingUnitId) : undefined
  const dropLesson = (date: string, startTime: string, endTime: string) => {
    if (!draggedLesson || !onLessonDrop) return
    const result = createLessonDragIntent(data, draggedLesson, { date, startTime, endTime, timetableId })
    setDraggedLesson(null)
    if (!result.valid) { setDragFeedback(result.reason); return }
    setDragFeedback(result.intent.conflictLessonIds.length > 0 ? '目標已有課程，請在預覽中選擇交換、保留衝堂或取消。' : '')
    onLessonDrop(result.intent)
  }

  if (!projectId) return <div className="cross-school-empty">目前沒有可顯示的課表專案。</div>
  if (data.schemaVersion >= 6 && !timetableId) return <div className="cross-school-empty">請先選擇教師課表。</div>

  return <div className="multi-schedule">
    <div className="multi-schedule-toolbar">
      <div className="view-switch" role="tablist" aria-label="課表範圍">
        <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>總課表</button>
        <button role="tab" aria-selected={scope === 'school'} className={scope === 'school' ? 'active' : ''} onClick={() => setScope('school')}>各校課表</button>
      </div>
      <div className="view-switch schedule-days-switch" role="group" aria-label="課表顯示天數">
        <button type="button" className={!showWeekend ? 'active' : ''} aria-pressed={!showWeekend} onClick={() => setShowWeekend(false)}>五天</button>
        <button type="button" className={showWeekend ? 'active' : ''} aria-pressed={showWeekend} onClick={() => setShowWeekend(true)}>七天</button>
      </div>
      {scope === 'school' && <div className="school-schedule-filters">
        <label>學校<select aria-label="選擇學校" value={schoolId} onChange={(event) => { setSchoolId(event.target.value); setUnitId('all') }}>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
        <label>學制<select aria-label="篩選學制" value={unitId} onChange={(event) => setUnitId(event.target.value)}><option value="all">全部學制</option>{schoolUnits.map((unit) => <option key={unit.id} value={unit.id}>{unitLabel(unit, units)}</option>)}</select></label>
      </div>}
      {conflictCount > 0 && <p className="schedule-conflict-summary" role="status"><AlertTriangle size={14} />本週有 {conflictCount} 堂課涉及時間衝突</p>}
    </div>
    {!showWeekend && weekendLessonCount > 0 && <div className="weekend-lesson-notice" role="status"><span>本週週末有 {weekendLessonCount} 堂課</span><button type="button" onClick={() => setShowWeekend(true)}>顯示週末</button></div>}
    {(draggedLesson || dragFeedback) && <div className={`drag-status ${dragFeedback ? 'warning' : ''}`} role="status">{draggedLesson ? `正在拖曳：${draggedLesson.subjectName}・${draggedLesson.className}；按 Escape 取消。` : dragFeedback}<button type="button" onClick={() => setDragFeedback('')}>關閉</button></div>}

    <div className="multi-schedule-scroll">
      <div className={`multi-week-grid ${showWeekend ? 'seven-days' : ''}`}>
        {schedule.map(({ date, lessons }, dayIndex) => <section className="multi-day-column" key={date.toISOString()} aria-label={`${toDateKey(date)} 課表`}>
          <header><span>{showWeekend ? weekDayLabels[dayIndex] : dayNames[dayIndex]}</span><strong>{formatShortDate(date)}</strong></header>
          <div className="multi-day-lessons">
            {draggedLesson && draggedUnit && <div className="lesson-drop-targets" aria-label={`${toDateKey(date)} 可放置節次`}>{[...draggedUnit.periods].sort((left, right) => left.order - right.order).map((period) => { const result = createLessonDragIntent(data, draggedLesson, { date: toDateKey(date), startTime: period.startTime, endTime: period.endTime, timetableId }); return <div key={period.id} className={`lesson-drop-target ${result.valid ? 'valid' : 'invalid'} ${result.valid && result.intent.conflictLessonIds.length ? 'occupied' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); dropLesson(toDateKey(date), period.startTime, period.endTime) }}><strong>{period.label}</strong><span>{period.startTime}–{period.endTime}</span><em>{result.valid ? result.intent.conflictLessonIds.length ? '已有課程' : '放置於此' : '不可放置'}</em></div> })}</div>}
            {lessons.length === 0
              ? <p className="cross-school-empty">無有效課程</p>
              : lessons.map((lesson, index) => <LessonCard key={lesson.occurrenceKey} lesson={lesson} previous={lessons[index - 1]}
                onClick={lesson.kind === 'one-off' ? onOneOffClick ? () => onOneOffClick(lesson.id) : undefined
                  : onLessonClick ? () => onLessonClick(lesson.id, lesson.date, lesson.overrideId) : undefined}
                draggable={lesson.kind === 'recurring' && Boolean(onLessonDrop)}
                onDragStart={lesson.kind === 'recurring' ? (event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', lesson.id); setDraggedLesson(lesson); setDragFeedback('') } : undefined}
                onDragEnd={lesson.kind === 'recurring' ? () => setDraggedLesson(null) : undefined}
                onDragOver={lesson.kind === 'recurring' && draggedLesson ? (event) => event.preventDefault() : undefined}
                onDrop={lesson.kind === 'recurring' ? (event) => { event.preventDefault(); dropLesson(lesson.date, lesson.startTime, lesson.endTime) } : undefined} />)}
          </div>
        </section>)}
      </div>
    </div>
    <div className="multi-schedule-legend"><span><i className="subject-swatch" />科目色</span><span><i className="school-swatch" />學校識別色</span><span><AlertTriangle size={12} />實際時間重疊</span><span>5–20 分鐘休息以緊湊間距呈現，時間資料不變</span></div>
  </div>
}

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AlertTriangle, MapPin } from 'lucide-react'
import { dayNames, formatShortDate } from '../lib/date'
import { resolveProjectWeek, type ResolvedLessonV4 } from '../lib/scheduleV4'
import type { AppDataV4 } from '../types'

type ScheduleScope = 'all' | 'school'

interface Props {
  data: AppDataV4
  weekDays: Date[]
  projectId?: string | null
  onLessonClick?: (lessonId: string, date: string) => void
}

function minutes(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return hour * 60 + minute
}

function isShortBreak(previous: ResolvedLessonV4 | undefined, current: ResolvedLessonV4) {
  if (!previous || previous.status === 'cancelled' || current.status === 'cancelled') return false
  const gap = minutes(current.startTime) - minutes(previous.endTime)
  return gap >= 5 && gap <= 20
}

function LessonCard({ lesson, previous, onClick }: { lesson: ResolvedLessonV4; previous?: ResolvedLessonV4; onClick?: () => void }) {
  const style = { '--subject-color': lesson.subjectColor, '--school-color': lesson.schoolColor } as CSSProperties
  const statusLabel = lesson.status === 'cancelled' ? '單日取消' : lesson.status === 'replaced' ? '單日替換' : lesson.status === 'moved' ? '單日移動' : null
  return <button type="button"
    className={`multi-lesson-card ${lesson.status} ${lesson.hasConflict ? 'conflict' : ''} ${isShortBreak(previous, lesson) ? 'short-break' : ''}`}
    style={style}
    onClick={onClick}
    disabled={!onClick}
    aria-label={`編輯 ${lesson.subjectName}・${lesson.className}`}
  >
    <div className="multi-lesson-time"><strong>{lesson.periodLabel}</strong><span>{lesson.startTime}–{lesson.endTime}</span></div>
    <div className="multi-lesson-body">
      <div className="multi-lesson-title"><strong>{lesson.subjectName}</strong>{statusLabel && <em>{statusLabel}</em>}{lesson.hasConflict && <em className="conflict-label"><AlertTriangle size={12} />衝堂</em>}</div>
      <span>{lesson.className}</span>
      <small>{lesson.schoolName}・{lesson.teachingUnitName}</small>
      {lesson.room && <small><MapPin size={11} />{lesson.room}</small>}
    </div>
  </button>
}

export function MultiSchoolSchedule({ data, weekDays, projectId: requestedProjectId, onLessonClick }: Props) {
  const [scope, setScope] = useState<ScheduleScope>('all')
  const projectId = requestedProjectId === undefined ? data.activeProjectId : requestedProjectId
  const schools = useMemo(() => data.schools.filter((item) => item.projectId === projectId), [data.schools, projectId])
  const units = useMemo(() => data.teachingUnits.filter((item) => item.projectId === projectId), [data.teachingUnits, projectId])
  const [schoolId, setSchoolId] = useState(() => schools[0]?.id ?? '')
  const [unitId, setUnitId] = useState('all')

  useEffect(() => {
    setSchoolId(schools[0]?.id ?? '')
    setUnitId('all')
  }, [projectId, schools])

  const schoolUnits = units.filter((item) => item.schoolId === schoolId)
  const schedule = useMemo(
    () => projectId ? resolveProjectWeek(data, projectId, weekDays, scope === 'school'
      ? { schoolId, teachingUnitId: unitId === 'all' ? undefined : unitId }
      : {}) : [],
    [data, projectId, weekDays, scope, schoolId, unitId],
  )
  const conflictCount = schedule.flatMap((day) => day.lessons).filter((lesson) => lesson.hasConflict).length

  if (!projectId) return <div className="cross-school-empty">目前沒有可顯示的課表專案。</div>

  return <div className="multi-schedule">
    <div className="multi-schedule-toolbar">
      <div className="view-switch" role="tablist" aria-label="課表範圍">
        <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>總課表</button>
        <button role="tab" aria-selected={scope === 'school'} className={scope === 'school' ? 'active' : ''} onClick={() => setScope('school')}>各校課表</button>
      </div>
      {scope === 'school' && <div className="school-schedule-filters">
        <label>學校<select aria-label="選擇學校" value={schoolId} onChange={(event) => { setSchoolId(event.target.value); setUnitId('all') }}>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
        <label>任教單位<select aria-label="篩選任教單位" value={unitId} onChange={(event) => setUnitId(event.target.value)}><option value="all">全部單位</option>{schoolUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>
      </div>}
      {conflictCount > 0 && <p className="schedule-conflict-summary" role="status"><AlertTriangle size={14} />本週有 {conflictCount} 堂課涉及時間衝突</p>}
    </div>

    <div className="multi-schedule-scroll">
      <div className="multi-week-grid">
        {schedule.map(({ date, lessons }, dayIndex) => <section className="multi-day-column" key={date.toISOString()}>
          <header><span>{dayNames[dayIndex]}</span><strong>{formatShortDate(date)}</strong></header>
          <div className="multi-day-lessons">
            {lessons.length === 0
              ? <p className="cross-school-empty">無有效課程</p>
              : lessons.map((lesson, index) => <LessonCard key={`${lesson.id}-${lesson.overrideId ?? 'fixed'}`} lesson={lesson} previous={lessons[index - 1]} onClick={onLessonClick ? () => onLessonClick(lesson.id, lesson.date) : undefined} />)}
          </div>
        </section>)}
      </div>
    </div>
    <div className="multi-schedule-legend"><span><i className="subject-swatch" />科目色</span><span><i className="school-swatch" />學校識別色</span><span><AlertTriangle size={12} />實際時間重疊</span><span>5–20 分鐘休息以緊湊間距呈現，時間資料不變</span></div>
  </div>
}

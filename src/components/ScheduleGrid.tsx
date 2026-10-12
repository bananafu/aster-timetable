import { ArrowRightLeft, CalendarPlus } from 'lucide-react'
import type { CSSProperties } from 'react'
import { getTermForDate } from '../lib/academic'
import { dayNames, formatShortDate, toDateKey } from '../lib/date'
import { resolveSlot } from '../lib/schedule'
import { getDayPeriods, hasUniformWeekStructure } from '../lib/weekLayout'
import type { AppData, ScheduleDensity, SchoolPeriod, ViewMode } from '../types'

interface ScheduleGridProps {
  data: AppData
  weekDays: Date[]
  mode: ViewMode
  onEmptyClick: (date: Date, periodId: number) => void
  onCourseClick: (date: Date, periodId: number) => void
  density: ScheduleDensity
}

function Slot({ data, date, period, onEmptyClick, onCourseClick }: Pick<ScheduleGridProps, 'data'|'onEmptyClick'|'onCourseClick'> & { date: Date; period: SchoolPeriod }) {
  const slot = resolveSlot(data, date, period.id)
  const subject = data.subjects.find((item) => item.id === slot.subjectId)
  const schoolClass = data.classes.find((item) => item.id === slot.classId)
  const event = data.events.find((item) => item.date === toDateKey(date) && item.startTime >= period.startTime && item.startTime < period.endTime)
  if (slot.status === 'cancelled') return <button className="course-card cancelled" onClick={() => onCourseClick(date, period.id)}><span>本節停課</span><small>{slot.override?.note || '臨時異動'}</small></button>
  if (subject && schoolClass) return <button className="course-card" style={{ '--course': subject.color } as CSSProperties} onClick={() => onCourseClick(date, period.id)}><span className="course-dot" /><strong>{subject.name}</strong><span>{schoolClass.name}</span><small>{slot.room || schoolClass.room}{slot.status === 'replaced' && <em><ArrowRightLeft size={11} />調課</em>}</small></button>
  if (event) return <button className="event-card" style={{ '--course': event.color } as CSSProperties} onClick={() => onEmptyClick(date, period.id)}><CalendarPlus size={13} /><strong>{event.title}</strong><span>{event.startTime}</span></button>
  return <button className="empty-slot" aria-label={`${toDateKey(date)} ${period.label} 新增課程`} onClick={() => onEmptyClick(date, period.id)}><span>＋</span></button>
}

export function ScheduleGrid({ data, weekDays, mode, onEmptyClick, onCourseClick, density }: ScheduleGridProps) {
  const todayKey = toDateKey(new Date())
  if (!hasUniformWeekStructure(data, weekDays)) {
    return <div className={`schedule-scroll density-${density}`}><div className="mixed-week-grid">
      {weekDays.map((date, index) => {
        const term = getTermForDate(data, date)
        const periods = getDayPeriods(data, date)
        return <section className="mixed-day" key={toDateKey(date)}>
          <div className={`day-heading ${toDateKey(date) === todayKey ? 'is-today' : ''}`}><span>{dayNames[index]}</span><strong>{formatShortDate(date)}</strong></div>
          <p className="mixed-term-name">{term?.name ?? '學期外'}</p>
          {periods.length ? periods.map((period) => <div className="mixed-slot" key={period.id}><div className="period-label"><strong>{period.label}</strong><span>{period.startTime}<br />{period.endTime}</span></div><div className="schedule-cell"><Slot data={data} date={date} period={period} onEmptyClick={onEmptyClick} onCourseClick={onCourseClick} /></div></div>) : <div className="outside-term-empty">此日不在任何學期內</div>}
        </section>
      })}
    </div></div>
  }
  const periods = getDayPeriods(data, weekDays[0])
  return <div className={`schedule-scroll density-${density} ${mode === 'time' ? 'time-mode' : ''}`}><div className="schedule-grid">
    <div className="grid-corner"><span>{mode === 'period' ? '節次' : '時間'}</span></div>
    {weekDays.map((date, index) => <div className={`day-heading ${toDateKey(date) === todayKey ? 'is-today' : ''}`} key={date.toISOString()}><span>{dayNames[index]}</span><strong>{formatShortDate(date)}</strong></div>)}
    {periods.map((period) => <div className="schedule-row" key={period.id}><div className="period-label"><strong>{period.label.replace('第 ', '').replace(' 節', '')}</strong><span>{period.startTime}<br />{period.endTime}</span></div>{weekDays.map((date) => <div className="schedule-cell" key={`${toDateKey(date)}-${period.id}`}><Slot data={data} date={date} period={period} onEmptyClick={onEmptyClick} onCourseClick={onCourseClick} /></div>)}</div>)}
  </div></div>
}

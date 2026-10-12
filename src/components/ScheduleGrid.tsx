import { ArrowRightLeft, CalendarPlus } from 'lucide-react'
import type { CSSProperties } from 'react'
import { dayNames, formatShortDate, toDateKey } from '../lib/date'
import { resolveSlot } from '../lib/schedule'
import type { AppData, ScheduleDensity, ViewMode } from '../types'

interface ScheduleGridProps {
  data: AppData
  weekDays: Date[]
  mode: ViewMode
  onEmptyClick: (date: Date, periodId: number) => void
  onCourseClick: (date: Date, periodId: number) => void
  density: ScheduleDensity
}

export function ScheduleGrid({ data, weekDays, mode, onEmptyClick, onCourseClick, density }: ScheduleGridProps) {
  const todayKey = toDateKey(new Date())
  return (
    <div className={`schedule-scroll density-${density} ${mode === 'time' ? 'time-mode' : ''}`}>
      <div className="schedule-grid">
        <div className="grid-corner"><span>{mode === 'period' ? '節次' : '時間'}</span></div>
        {weekDays.map((date, index) => (
          <div className={`day-heading ${toDateKey(date) === todayKey ? 'is-today' : ''}`} key={date.toISOString()}>
            <span>{dayNames[index]}</span><strong>{formatShortDate(date)}</strong>
          </div>
        ))}
        {data.periods.map((period) => (
          <div className="schedule-row" key={period.id}>
            <div className="period-label"><strong>{period.label.replace('第 ', '').replace(' 節', '')}</strong><span>{period.startTime}<br />{period.endTime}</span></div>
            {weekDays.map((date) => {
              const slot = resolveSlot(data, date, period.id)
              const subject = data.subjects.find((item) => item.id === slot.subjectId)
              const schoolClass = data.classes.find((item) => item.id === slot.classId)
              const event = data.events.find((item) => item.date === toDateKey(date) && item.startTime >= period.startTime && item.startTime < period.endTime)
              return (
                <div className="schedule-cell" key={`${date.toISOString()}-${period.id}`}>
                  {slot.status === 'cancelled' ? (
                    <button className="course-card cancelled" onClick={() => onCourseClick(date, period.id)}>
                      <span>本節停課</span><small>{slot.override?.note || '臨時異動'}</small>
                    </button>
                  ) : subject && schoolClass ? (
                    <button className="course-card" style={{ '--course': subject.color } as CSSProperties} onClick={() => onCourseClick(date, period.id)}>
                      <span className="course-dot" /><strong>{subject.name}</strong><span>{schoolClass.name}</span>
                      <small>{slot.room || schoolClass.room}{slot.status === 'replaced' && <em><ArrowRightLeft size={11} />調課</em>}</small>
                    </button>
                  ) : event ? (
                    <button className="event-card" style={{ '--course': event.color } as CSSProperties} onClick={() => onEmptyClick(date, period.id)}>
                      <CalendarPlus size={13} /><strong>{event.title}</strong><span>{event.startTime}</span>
                    </button>
                  ) : (
                    <button className="empty-slot" aria-label={`${toDateKey(date)} ${period.label} 新增調課`} onClick={() => onEmptyClick(date, period.id)}><span>＋</span></button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

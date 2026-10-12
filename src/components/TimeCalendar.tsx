import type { CSSProperties } from 'react'
import { dayNames, formatShortDate, toDateKey } from '../lib/date'
import { resolveSlot } from '../lib/schedule'
import type { AppData } from '../types'

const START_HOUR = 8
const END_HOUR = 18
const HOUR_HEIGHT = 64
const minutesFromStart = (time: string) => {
  const [hour, minute] = time.split(':').map(Number)
  return (hour - START_HOUR) * 60 + minute
}

export function TimeCalendar({ data, weekDays, onCourseClick }: { data: AppData; weekDays: Date[]; onCourseClick: (date: Date, periodId: number) => void }) {
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, index) => START_HOUR + index)
  return <div className="time-calendar-scroll"><div className="time-calendar">
    <div className="time-header-spacer" />
    {weekDays.map((date, index) => <div className="time-day-heading" key={toDateKey(date)}><span>{dayNames[index]}</span><strong>{formatShortDate(date)}</strong></div>)}
    <div className="time-labels">{hours.map((hour) => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div>
    {weekDays.map((date) => <div className="time-column" key={toDateKey(date)} style={{ height: hours.length * HOUR_HEIGHT }}>
      {hours.map((hour) => <i key={hour} style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }} />)}
      {data.periods.map((period) => {
        const slot = resolveSlot(data, date, period.id)
        if (!slot.subjectId || !slot.classId || slot.status === 'cancelled') return null
        const subject = data.subjects.find((item) => item.id === slot.subjectId)
        const schoolClass = data.classes.find((item) => item.id === slot.classId)
        const top = minutesFromStart(period.startTime) / 60 * HOUR_HEIGHT
        const height = Math.max(34, (minutesFromStart(period.endTime) - minutesFromStart(period.startTime)) / 60 * HOUR_HEIGHT)
        return <button key={period.id} className="time-item course-time-item" style={{ '--course': subject?.color, top, height } as CSSProperties} onClick={() => onCourseClick(date, period.id)}><strong>{subject?.name}</strong><span>{schoolClass?.name}・{period.startTime}</span></button>
      })}
      {data.events.filter((event) => event.date === toDateKey(date)).map((event) => {
        const top = minutesFromStart(event.startTime) / 60 * HOUR_HEIGHT
        const height = Math.max(34, (minutesFromStart(event.endTime) - minutesFromStart(event.startTime)) / 60 * HOUR_HEIGHT)
        return <div key={event.id} className="time-item event-time-item" style={{ '--course': event.color, top, height } as CSSProperties}><strong>{event.title}</strong><span>{event.startTime}・{event.location}</span></div>
      })}
    </div>)}
  </div></div>
}

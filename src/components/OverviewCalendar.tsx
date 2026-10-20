import type { CSSProperties } from 'react'
import { CalendarDays, CheckCircle2, ListTodo, Sparkles } from 'lucide-react'
import { addDays, formatShortDate, toDateKey } from '../lib/date'
import { resolveProjectWeek, type ResolvedScheduleOccurrence } from '../lib/scheduleV4'
import type { AppDataV4, CalendarEventV4 } from '../types'

interface Props {
  data: AppDataV4
  weekStart: Date
  projectId: string
  timetableId?: string
  onLessonClick?: (lessonId: string, date: string, overrideId?: string) => void
  onOneOffClick?: (oneOffId: string) => void
}

type CalendarItem = { kind: 'course'; lesson: ResolvedScheduleOccurrence; startTime: string; endTime: string }
  | { kind: 'event'; event: CalendarEventV4; startTime: string; endTime: string }

const weekLabels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']

function eventLabel(event: CalendarEventV4) {
  return event.type === 'meeting' ? '會議' : event.type === 'activity' ? '活動' : '待辦'
}

function CourseItem({ lesson, onLessonClick, onOneOffClick }: { lesson: ResolvedScheduleOccurrence; onLessonClick?: Props['onLessonClick']; onOneOffClick?: Props['onOneOffClick'] }) {
  const cancelled = lesson.kind === 'recurring' && lesson.status === 'cancelled'
  const status = cancelled ? '已取消' : lesson.kind === 'one-off' ? '單日課程' : lesson.status === 'replaced' ? '已替換' : lesson.status === 'moved' ? '已移動' : null
  const onClick = lesson.kind === 'one-off'
    ? onOneOffClick && (() => onOneOffClick(lesson.id))
    : onLessonClick && (() => onLessonClick(lesson.id, lesson.date, lesson.overrideId))
  const label = `${lesson.kind === 'one-off' ? '編輯單日課程' : '編輯'} ${lesson.subjectName}・${lesson.className}${cancelled ? '・已取消' : ''}`
  return <button type="button" className={`overview-course ${cancelled ? 'is-cancelled' : ''}`} style={{ '--subject-color': lesson.subjectColor } as CSSProperties} aria-label={label} onClick={onClick} disabled={!onClick}>
    <span className="overview-time">{lesson.startTime}–{lesson.endTime}</span>
    <strong>{lesson.subjectName}</strong>
    <span>{lesson.className}</span>
    {status && <em>{cancelled && <CheckCircle2 size={12} aria-hidden="true" />}{status}</em>}
  </button>
}

function EventItem({ event }: { event: CalendarEventV4 }) {
  const label = eventLabel(event)
  const Icon = event.type === 'meeting' ? CalendarDays : event.type === 'activity' ? Sparkles : ListTodo
  return <article className={`overview-event overview-event-${event.type}`} role="group" aria-label={`${label} ${event.startTime} 至 ${event.endTime} ${event.title}`}>
    <Icon size={15} aria-hidden="true" />
    <div><span className="overview-time">{event.startTime}–{event.endTime}</span><strong>{event.title}</strong><span className="overview-event-kind">{label}</span></div>
  </article>
}

export function OverviewCalendar({ data, weekStart, projectId, timetableId, onLessonClick, onOneOffClick }: Props) {
  const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index - 1))
  // v6+ requires an explicit timetable when a project has none or several.
  const canResolveLessons = data.schemaVersion < 6 || Boolean(timetableId)
  const resolvedDays = canResolveLessons ? resolveProjectWeek(data, projectId, dates, { timetableId }) : dates.map((date) => ({ date, lessons: [] as ResolvedScheduleOccurrence[] }))
  return <div className="overview-calendar-scroll"><div className="overview-calendar" aria-label="本週行事曆">
    {resolvedDays.map(({ date, lessons }) => {
      const dateKey = toDateKey(date)
      const items: CalendarItem[] = [
        ...lessons.map((lesson) => ({ kind: 'course' as const, lesson, startTime: lesson.startTime, endTime: lesson.endTime })),
        ...data.events.filter((event) => (event.projectId === projectId || event.projectId === null) && event.date === dateKey)
          .map((event) => ({ kind: 'event' as const, event, startTime: event.startTime, endTime: event.endTime })),
      ].sort((left, right) => left.startTime.localeCompare(right.startTime) || left.endTime.localeCompare(right.endTime))
      return <section key={dateKey} className="overview-day" aria-label={`${dateKey} ${weekLabels[date.getDay()]}`}>
        <h3><span>{weekLabels[date.getDay()]}</span><strong>{formatShortDate(date)}</strong></h3>
        <div className="overview-day-items">{items.length ? items.map((item) => item.kind === 'course'
          ? <CourseItem key={item.lesson.occurrenceKey} lesson={item.lesson} onLessonClick={onLessonClick} onOneOffClick={onOneOffClick} />
          : <EventItem key={item.event.id} event={item.event} />) : <p className="overview-day-empty">無行程</p>}</div>
      </section>
    })}
  </div></div>
}

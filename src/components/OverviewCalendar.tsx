import type { CSSProperties } from 'react'
import { CalendarDays, CheckCircle2, ListTodo, Sparkles } from 'lucide-react'
import { addDays, formatShortDate, toDateKey } from '../lib/date'
import { resolveProjectWeek, type ResolvedScheduleOccurrence } from '../lib/scheduleV4'
import { scheduleReadStatusMessage, type ScheduleDisplayDay, type ScheduleDisplayEvent,
  type ScheduleDisplayOccurrence } from '../lib/scheduleDisplay'
import type { V9ReadStatus } from '../lib/scheduleV9'
import type { AppDataV4, CalendarEventV4 } from '../types'

interface LegacyProps {
  mode?: 'legacy'
  data: AppDataV4
  weekStart: Date
  projectId: string
  timetableId?: string
  onLessonClick?: (lessonId: string, date: string, overrideId?: string) => void
  onOneOffClick?: (oneOffId: string) => void
}

interface ResolvedProps {
  mode: 'resolved'
  weekStart: Date
  readStatus: V9ReadStatus
  days: readonly ScheduleDisplayDay[]
  events: readonly ScheduleDisplayEvent[]
}

type Props = LegacyProps | ResolvedProps

type CalendarItem = { kind: 'course'; lesson: ScheduleDisplayOccurrence; startTime: string; endTime: string }
  | { kind: 'event'; event: ScheduleDisplayEvent; startTime: string; endTime: string }

const weekLabels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六']

function eventLabel(event: ScheduleDisplayEvent) {
  return event.type === 'meeting' ? '會議' : event.type === 'activity' ? '活動' : '待辦'
}

function CourseItem({ lesson, onLessonClick, onOneOffClick, readOnly }: { lesson: ScheduleDisplayOccurrence;
  onLessonClick?: LegacyProps['onLessonClick']; onOneOffClick?: LegacyProps['onOneOffClick']; readOnly: boolean }) {
  const cancelled = lesson.kind === 'recurring' && lesson.status === 'cancelled'
  const status = cancelled ? '已取消' : lesson.kind === 'one-off'
    ? { extra: '單日新增', 'make-up': '補課', substitute: '代課' }[lesson.purpose!]
    : lesson.status === 'replaced' ? '已替換' : lesson.status === 'moved'
      ? lesson.movementRole === 'source' ? '已調離' : lesson.movementRole === 'target' ? '調入' : '已移動' : null
  const onClick = lesson.kind === 'one-off'
    ? onOneOffClick && (() => onOneOffClick(lesson.id))
    : onLessonClick && (() => onLessonClick(lesson.id, lesson.date, lesson.overrideId))
  const label = readOnly
    ? `課程 ${lesson.subjectName}・${lesson.className}${status ? `・${status}` : ''}`
    : `${lesson.kind === 'one-off' ? '編輯單日課程' : '編輯'} ${lesson.subjectName}・${lesson.className}${cancelled ? '・已取消' : ''}`
  return <button type="button" className={`overview-course ${cancelled ? 'is-cancelled' : ''}`} style={{ '--subject-color': lesson.subjectColor } as CSSProperties} aria-label={label} onClick={onClick} disabled={!onClick}>
    <span className="overview-time">{lesson.startTime}–{lesson.endTime}</span>
    <strong>{lesson.subjectName}</strong>
    <span>{lesson.className}</span>
    {status && <em>{cancelled && <CheckCircle2 size={12} aria-hidden="true" />}{status}</em>}
  </button>
}

function EventItem({ event }: { event: ScheduleDisplayEvent }) {
  const label = eventLabel(event)
  const Icon = event.type === 'meeting' ? CalendarDays : event.type === 'activity' ? Sparkles : ListTodo
  return <article className={`overview-event overview-event-${event.type}`} role="group" aria-label={`${label} ${event.startTime} 至 ${event.endTime} ${event.title}`}>
    <Icon size={15} aria-hidden="true" />
    <div><span className="overview-time">{event.startTime}–{event.endTime}</span><strong>{event.title}</strong><span className="overview-event-kind">{label}</span></div>
  </article>
}

function legacyOccurrence(lesson: ResolvedScheduleOccurrence): ScheduleDisplayOccurrence {
  return { key: lesson.occurrenceKey, id: lesson.id, kind: lesson.kind, date: lesson.date,
    startTime: lesson.startTime, endTime: lesson.endTime, teachingUnitId: lesson.teachingUnitId,
    schoolId: lesson.schoolId, schoolName: lesson.schoolName, schoolColor: lesson.schoolColor,
    teachingUnitName: lesson.teachingUnitName, subjectName: lesson.subjectName,
    subjectColor: lesson.subjectColor, className: lesson.className, room: lesson.room,
    hasConflict: lesson.hasConflict, status: lesson.kind === 'recurring' ? lesson.status : undefined,
    overrideId: lesson.kind === 'recurring' ? lesson.overrideId : undefined,
    periodLabel: 'periodLabel' in lesson ? lesson.periodLabel : undefined,
    purpose: lesson.kind === 'one-off' ? lesson.purpose : undefined,
    timeMode: lesson.kind === 'one-off' ? lesson.timeMode : undefined }
}

function legacyEvent(event: CalendarEventV4): ScheduleDisplayEvent | null {
  return { id: event.id, type: event.type, date: event.date, startTime: event.startTime,
    endTime: event.endTime, title: event.title }
}

export function OverviewCalendar(props: Props) {
  const { weekStart } = props
  const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index - 1))
  const resolved = props.mode === 'resolved'
  const message = resolved ? scheduleReadStatusMessage(props.readStatus) : null
  if (message) return <div className="cross-school-empty">{message}</div>
  const resolvedDays: readonly ScheduleDisplayDay[] = resolved ? props.days : (() => {
    // v6+ requires an explicit timetable when a project has none or several.
    const canResolveLessons = props.data.schemaVersion < 6 || Boolean(props.timetableId)
    const days = canResolveLessons ? resolveProjectWeek(props.data, props.projectId, dates,
      { timetableId: props.timetableId }) : dates.map((date) => ({ date, lessons: [] as ResolvedScheduleOccurrence[] }))
    return days.map((day) => ({ date: day.date, lessons: day.lessons.map(legacyOccurrence) }))
  })()
  const events = resolved ? props.events : props.data.events
    .filter((event) => event.projectId === props.projectId || event.projectId === null)
    .map(legacyEvent).filter((event): event is ScheduleDisplayEvent => event !== null)
  return <div className="overview-calendar-scroll"><div className="overview-calendar" aria-label="本週行事曆">
    {resolvedDays.map(({ date, lessons }) => {
      const dateKey = toDateKey(date)
      const items: CalendarItem[] = [
        ...lessons.map((lesson) => ({ kind: 'course' as const, lesson, startTime: lesson.startTime, endTime: lesson.endTime })),
        ...events.filter((event) => event.date === dateKey)
          .map((event) => ({ kind: 'event' as const, event, startTime: event.startTime, endTime: event.endTime })),
      ].sort((left, right) => left.startTime.localeCompare(right.startTime) || left.endTime.localeCompare(right.endTime))
      return <section key={dateKey} className="overview-day" aria-label={`${dateKey} ${weekLabels[date.getDay()]}`}>
        <h3><span>{weekLabels[date.getDay()]}</span><strong>{formatShortDate(date)}</strong></h3>
        <div className="overview-day-items">{items.length ? items.map((item) => item.kind === 'course'
          ? <CourseItem key={item.lesson.key} lesson={item.lesson}
            onLessonClick={resolved ? undefined : props.onLessonClick}
            onOneOffClick={resolved ? undefined : props.onOneOffClick} readOnly={resolved} />
          : <EventItem key={item.event.id} event={item.event} />) : <p className="overview-day-empty">無行程</p>}</div>
      </section>
    })}
  </div></div>
}

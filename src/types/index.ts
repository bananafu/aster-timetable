export type DayOfWeek = 1 | 2 | 3 | 4 | 5
export type WeekPattern = 'every' | 'A' | 'B'
export type DataOrigin = 'demo' | 'user'
export type ScheduleDensity = 'comfortable' | 'compact'

export interface Subject {
  id: string
  name: string
  shortName: string
  color: string
  origin?: DataOrigin
}

export interface SchoolClass {
  id: string
  name: string
  room?: string
  origin?: DataOrigin
}

export interface Period {
  id: number
  label: string
  startTime: string
  endTime: string
}

export interface Course {
  id: string
  subjectId: string
  classId: string
  day: DayOfWeek
  periodId: number
  weekPattern: WeekPattern
  room?: string
  origin?: DataOrigin
}

export type EventType = 'meeting' | 'activity' | 'task'

export interface CalendarEvent {
  id: string
  title: string
  type: EventType
  date: string
  startTime: string
  endTime: string
  location?: string
  notes?: string
  color: string
  origin?: DataOrigin
}

export interface ScheduleOverride {
  id: string
  date: string
  periodId: number
  action: 'cancel' | 'replace'
  originalCourseId?: string
  replacement?: {
    subjectId: string
    classId: string
    room?: string
  }
  note?: string
  origin?: DataOrigin
}

export interface SemesterSettings {
  name: string
  startDate: string
  endDate: string
  firstWeekPattern: 'A' | 'B'
}

export interface AppData {
  subjects: Subject[]
  classes: SchoolClass[]
  periods: Period[]
  courses: Course[]
  events: CalendarEvent[]
  overrides: ScheduleOverride[]
  semester: SemesterSettings
}

export type ViewMode = 'period' | 'time'
export type ModalKind = 'event' | 'course' | 'editCourse' | 'settings' | null

export type DayOfWeek = 1 | 2 | 3 | 4 | 5
export type WeekPattern = 'every' | 'A' | 'B'
export type AlternatingWeekPattern = 'A' | 'B'
export type DataOrigin = 'demo' | 'user'
export type ScheduleDensity = 'comfortable' | 'compact'

export interface Subject { id: string; name: string; shortName: string; color: string; origin?: DataOrigin }
export interface SchoolClass { id: string; name: string; room?: string; origin?: DataOrigin }

export interface SchoolPeriod {
  id: number
  order: number
  label: string
  startTime: string
  endTime: string
}

export interface SchoolSettings {
  id: 'primary-school'
  name: string
  timezone: 'Asia/Taipei'
  defaultPeriods: SchoolPeriod[]
}

export interface AcademicTerm {
  id: string
  name: string
  startDate: string
  endDate: string
  archivedAt?: string
  weekCycle: { enabled: boolean; anchorDate: string; anchorPattern: AlternatingWeekPattern }
  periods: SchoolPeriod[]
  createdAt: string
}

export interface Course {
  id: string
  termId: string
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
  termId: string | null
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
  termId: string | null
  date: string
  periodId: number
  action: 'cancel' | 'replace'
  originalCourseId?: string
  replacement?: { subjectId: string; classId: string; room?: string }
  note?: string
  origin?: DataOrigin
}

export interface MigrationWarning {
  id: string
  entityType: 'event' | 'override'
  entityId: string
  message: string
}

export interface AppData {
  schemaVersion: 3
  school: SchoolSettings
  academicTerms: AcademicTerm[]
  activeTermId: string
  subjects: Subject[]
  classes: SchoolClass[]
  courses: Course[]
  events: CalendarEvent[]
  overrides: ScheduleOverride[]
  migrationWarnings: MigrationWarning[]
}

export type ViewMode = 'period' | 'time'
export type ModalKind = 'event' | 'course' | 'editCourse' | 'settings' | null

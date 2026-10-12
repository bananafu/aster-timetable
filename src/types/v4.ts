import type { AlternatingWeekPattern, DataOrigin, DayOfWeek, EventType, SchoolPeriod, Subject, WeekPattern } from './index'

export type SemesterKind = 'first' | 'second' | 'summer' | 'custom'
export type SchoolLevel = 'junior-high' | 'senior-high' | 'other'

export interface AcademicTermDescriptor {
  academicYear: number
  semester: SemesterKind
  customLabel?: string
}

export interface TimetableProject {
  id: string
  name: string
  term: AcademicTermDescriptor
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface School {
  id: string
  projectId: string
  name: string
  color: string
}

export interface TeachingUnit {
  id: string
  projectId: string
  schoolId: string
  name: string
  schoolLevel: SchoolLevel
  startDate: string
  endDate: string
  timezone: 'Asia/Taipei'
  periods: SchoolPeriod[]
  weekCycle: {
    enabled: boolean
    anchorDate: string
    anchorPattern: AlternatingWeekPattern
  }
}

export interface ProjectClass {
  id: string
  projectId: string
  teachingUnitId: string
  name: string
  room?: string
  origin?: DataOrigin
}

export interface RecurringLesson {
  id: string
  seriesId: string
  projectId: string
  teachingUnitId: string
  subjectId: string
  classId: string
  day: DayOfWeek
  periodId: number
  weekPattern: WeekPattern
  effectiveStart: string
  effectiveEnd?: string
  room?: string
  origin?: DataOrigin
}

export interface CalendarEventV4 {
  id: string
  projectId: string | null
  teachingUnitId?: string | null
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

export interface ScheduleOverrideV4 {
  id: string
  projectId: string | null
  teachingUnitId: string | null
  date: string
  periodId: number
  action: 'cancel' | 'replace'
  originalLessonId?: string
  replacement?: { subjectId: string; classId: string; room?: string }
  note?: string
  origin?: DataOrigin
}

export interface MigrationWarningV4 {
  id: string
  entityType: 'class' | 'event' | 'override' | 'lesson'
  entityId: string
  message: string
}

export interface AppDataV4 {
  schemaVersion: 4
  activeProjectId: string | null
  projects: TimetableProject[]
  schools: School[]
  teachingUnits: TeachingUnit[]
  subjects: Subject[]
  classes: ProjectClass[]
  recurringLessons: RecurringLesson[]
  events: CalendarEventV4[]
  overrides: ScheduleOverrideV4[]
  migrationWarnings: MigrationWarningV4[]
}

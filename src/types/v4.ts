import type { AlternatingWeekPattern, DataOrigin, DayOfWeek, EventType, SchoolPeriod, Subject, WeekPattern } from './index'

export type SemesterKind = 'first' | 'second' | 'summer' | 'custom'
export type SchoolLevel = 'junior-high' | 'senior-high' | 'other'
export const SCHOOL_LEVELS: readonly SchoolLevel[] = ['junior-high', 'senior-high', 'other']

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

export interface Timetable {
  id: string
  projectId: string
  name: string
  teacherName: string | null
  /** Only a timetable created from pre-v6 data may await a real teacher name. */
  teacherNamePending?: true
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
  grade?: number
  classNumber?: number
  room?: string
  origin?: DataOrigin
}

export interface RecurringLesson {
  id: string
  seriesId: string
  projectId: string
  /** Required in v6; optional here for the retained v4/v5 readers. */
  timetableId?: string
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
  /** Null is reserved for unassigned legacy overrides in v6. */
  timetableId?: string | null
  teachingUnitId: string | null
  date: string
  periodId: number
  action: 'cancel' | 'replace' | 'move'
  originalLessonId?: string
  replacement?: { subjectId: string; classId: string; room?: string }
  target?: { date: string; periodId: number }
  groupId?: string
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
  // Existing runtime operations accept both persisted generations during v5 cutover.
  schemaVersion: 4 | 5 | 6
  activeProjectId: string | null
  projects: TimetableProject[]
  /** Required in v6; absent from the retained v4/v5 formats. */
  timetables?: Timetable[]
  schools: School[]
  teachingUnits: TeachingUnit[]
  subjects: Subject[]
  classes: ProjectClass[]
  recurringLessons: RecurringLesson[]
  events: CalendarEventV4[]
  overrides: ScheduleOverrideV4[]
  migrationWarnings: MigrationWarningV4[]
}

export type SubjectV5 = Subject & { applicableSchoolLevels: SchoolLevel[] }
export type AppDataV5 = Omit<AppDataV4, 'schemaVersion' | 'subjects'> & {
  schemaVersion: 5
  subjects: SubjectV5[]
}

export type AppDataV6 = Omit<AppDataV5, 'schemaVersion' | 'timetables' | 'recurringLessons' | 'overrides'> & {
  schemaVersion: 6
  timetables: Timetable[]
  recurringLessons: (RecurringLesson & { timetableId: string })[]
  overrides: (ScheduleOverrideV4 & { timetableId: string | null })[]
}

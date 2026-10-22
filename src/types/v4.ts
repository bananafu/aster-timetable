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

export type EventOwnershipIssueReasonV8 =
  | 'unassigned-project'
  | 'missing-teaching-unit'
  | 'missing-timetable'
  | 'ambiguous-timetable'
  | 'requires-confirmation'

export interface EventOwnershipIssueV8 {
  reason: EventOwnershipIssueReasonV8
  candidateTimetableIds: string[]
}

export type ResolvedCalendarEventV8 = Omit<CalendarEventV4, 'projectId'> & {
  projectId: string
  ownershipStatus: 'resolved'
  timetableId: string
  ownershipIssue?: never
}

export type UnresolvedCalendarEventV8 = CalendarEventV4 & {
  ownershipStatus: 'unresolved'
  timetableId?: never
  ownershipIssue: EventOwnershipIssueV8
}

export type CalendarEventV8 = ResolvedCalendarEventV8 | UnresolvedCalendarEventV8

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

export type OneOffLessonTime =
  | { mode: 'period'; periodId: number; startTime?: never; endTime?: never }
  | { mode: 'custom'; startTime: string; endTime: string; periodId?: never }

/** A dated lesson independent of recurring series and schedule overrides. */
export interface OneOffLesson {
  id: string
  projectId: string
  timetableId: string
  teachingUnitId: string
  classId: string
  subjectId: string
  date: string
  purpose: 'extra' | 'make-up' | 'substitute'
  /** Informational only: the original may later be deleted. */
  relatedRecurringLessonId?: string
  room?: string
  time: OneOffLessonTime
}

export interface MigrationWarningV4 {
  id: string
  entityType: 'class' | 'event' | 'override' | 'lesson'
  entityId: string
  message: string
}

export interface TeachingProgressContent {
  chapter: string
  unit: string
  note: string
}

export interface PreviousProgressSnapshot {
  content: TeachingProgressContent
  updatedAt: string
}

export interface TeachingProgressScope {
  projectId: string
  timetableId: string
  teachingUnitId: string
  classId: string
  subjectId: string
}

/** Exactly one record may exist for each complete TeachingProgressScope. */
export interface TeachingProgress extends TeachingProgressScope {
  id: string
  content: TeachingProgressContent
  previousProgress: PreviousProgressSnapshot | null
  createdAt: string
  updatedAt: string
}

export interface AppDataV4 {
  // Legacy data operations retain a common shape across persisted generations.
  schemaVersion: 4 | 5 | 6 | 7 | 8
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
  /** Required in v7; absent from retained v4–v6 formats. */
  oneOffLessons?: OneOffLesson[]
  migrationWarnings: MigrationWarningV4[]
}

export type SubjectV5 = Subject & { applicableSchoolLevels: SchoolLevel[] }
export type SubjectV8 = SubjectV5 & { projectId: string }
export interface TeachingUnitSubject {
  id: string
  projectId: string
  teachingUnitId: string
  subjectId: string
}
export type AppDataV5 = Omit<AppDataV4, 'schemaVersion' | 'subjects' | 'oneOffLessons'> & {
  schemaVersion: 5
  subjects: SubjectV5[]
}

export type AppDataV6 = Omit<AppDataV5, 'schemaVersion' | 'timetables' | 'recurringLessons' | 'overrides'> & {
  schemaVersion: 6
  timetables: Timetable[]
  recurringLessons: (RecurringLesson & { timetableId: string })[]
  overrides: (ScheduleOverrideV4 & { timetableId: string | null })[]
}

export type AppDataV7 = Omit<AppDataV6, 'schemaVersion' | 'oneOffLessons'> & {
  schemaVersion: 7
  oneOffLessons: OneOffLesson[]
}

export type AppDataV8 = Omit<AppDataV7, 'schemaVersion' | 'subjects' | 'events'> & {
  schemaVersion: 8
  subjects: SubjectV8[]
  teachingUnitSubjects: TeachingUnitSubject[]
  events: CalendarEventV8[]
  teachingProgress: TeachingProgress[]
}

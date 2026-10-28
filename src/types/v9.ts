import type { AppDataV8, SubjectV8, TimetableProject } from './v4'

/** null means that the user has not configured a term; never infer one. */
export type ProjectV9 = Omit<TimetableProject, 'term'> & { term: TimetableProject['term'] | null }

/** Internal persisted contract for Toki V8's teacher-owned Subject library. */
export type SubjectV9 = SubjectV8 & { timetableId: string }

export type AppDataV9 = Omit<AppDataV8, 'schemaVersion' | 'subjects' | 'projects'> & {
  schemaVersion: 9
  projects: ProjectV9[]
  subjects: SubjectV9[]
}

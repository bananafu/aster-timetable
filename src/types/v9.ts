import type { AppDataV8, SubjectV8 } from './v4'

/** Internal persisted contract for Toki V8's teacher-owned Subject library. */
export type SubjectV9 = SubjectV8 & { timetableId: string }

export type AppDataV9 = Omit<AppDataV8, 'schemaVersion' | 'subjects'> & {
  schemaVersion: 9
  subjects: SubjectV9[]
}

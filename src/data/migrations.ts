import { defaultPeriods, initialData } from './seed'
import type { AppData, CalendarEvent, Course, DataOrigin, ScheduleOverride, SchoolClass, Subject } from '../types'

interface LegacyPeriod { id: number; label: string; startTime: string; endTime: string }
interface LegacySemester { name: string; startDate: string; endDate: string; firstWeekPattern: 'A' | 'B' }
type LegacyCourse = Omit<Course, 'termId'>
type LegacyEvent = Omit<CalendarEvent, 'termId'>
type LegacyOverride = Omit<ScheduleOverride, 'termId'>
export interface LegacyAppDataV1 {
  subjects: Subject[]; classes: SchoolClass[]; periods: LegacyPeriod[]; courses: LegacyCourse[]
  events: LegacyEvent[]; overrides: LegacyOverride[]; semester: LegacySemester
}

type DemoRecord = Subject | SchoolClass | Course | CalendarEvent | ScheduleOverride
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const string = (value: unknown): value is string => typeof value === 'string'
const date = (value: unknown): value is string => string(value) && /^\d{4}-\d{2}-\d{2}$/.test(value)
const time = (value: unknown): value is string => string(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const origin = (value: unknown): value is DataOrigin | undefined => value === undefined || value === 'demo' || value === 'user'
const period = (value: unknown, ordered = true) => record(value) && typeof value.id === 'number' && (!ordered || typeof value.order === 'number') && string(value.label) && time(value.startTime) && time(value.endTime)
const subject = (value: unknown) => record(value) && string(value.id) && string(value.name) && string(value.shortName) && string(value.color) && origin(value.origin)
const schoolClass = (value: unknown) => record(value) && string(value.id) && string(value.name) && (value.room === undefined || string(value.room)) && origin(value.origin)
const legacyCourse = (value: unknown) => record(value) && string(value.id) && string(value.subjectId) && string(value.classId) && [1,2,3,4,5].includes(value.day as number) && typeof value.periodId === 'number' && ['every','A','B'].includes(value.weekPattern as string) && origin(value.origin)
const legacyEvent = (value: unknown) => record(value) && string(value.id) && string(value.title) && ['meeting','activity','task'].includes(value.type as string) && string(value.date) && time(value.startTime) && time(value.endTime) && string(value.color) && origin(value.origin)
const legacyOverride = (value: unknown) => record(value) && string(value.id) && string(value.date) && typeof value.periodId === 'number' && ['cancel','replace'].includes(value.action as string) && origin(value.origin)

export function isLegacyAppDataV1(value: unknown): value is LegacyAppDataV1 {
  if (!record(value) || !record(value.semester)) return false
  return Array.isArray(value.subjects) && value.subjects.every(subject)
    && Array.isArray(value.classes) && value.classes.every(schoolClass)
    && Array.isArray(value.periods) && value.periods.every((item) => period(item, false))
    && Array.isArray(value.courses) && value.courses.every(legacyCourse)
    && Array.isArray(value.events) && value.events.every(legacyEvent)
    && Array.isArray(value.overrides) && value.overrides.every(legacyOverride)
    && string(value.semester.name) && date(value.semester.startDate) && date(value.semester.endDate)
    && ['A','B'].includes(value.semester.firstWeekPattern as string)
}

export function isAppData(value: unknown): value is AppData {
  if (!record(value) || value.schemaVersion !== 3 || !record(value.school)) return false
  if (value.school.id !== 'primary-school' || !string(value.school.name) || value.school.timezone !== 'Asia/Taipei' || !Array.isArray(value.school.defaultPeriods) || !value.school.defaultPeriods.every((item) => period(item))) return false
  const defaults = value.school.defaultPeriods as unknown as AppData['school']['defaultPeriods']
  if (new Set(defaults.map((item)=>item.id)).size!==defaults.length || new Set(defaults.map((item)=>item.order)).size!==defaults.length) return false
  if (!Array.isArray(value.academicTerms) || !string(value.activeTermId) || !value.academicTerms.some((term) => record(term) && term.id === value.activeTermId && term.archivedAt === undefined)) return false
  const termsValid = value.academicTerms.every((term) => record(term) && string(term.id) && string(term.name) && date(term.startDate) && date(term.endDate)
    && (term.archivedAt === undefined || string(term.archivedAt)) && string(term.createdAt) && record(term.weekCycle)
    && typeof term.weekCycle.enabled === 'boolean' && date(term.weekCycle.anchorDate) && ['A','B'].includes(term.weekCycle.anchorPattern as string)
    && Array.isArray(term.periods) && term.periods.every((item) => period(item)) && new Set(term.periods.map((item) => (item as {id:number}).id)).size === term.periods.length)
  if (!termsValid || new Set(value.academicTerms.map((term) => (term as {id:string}).id)).size !== value.academicTerms.length) return false
  const terms = value.academicTerms as unknown as AppData['academicTerms']
  if (terms.some((term) => term.startDate > term.endDate || new Set(term.periods.map((item)=>item.order)).size !== term.periods.length)) return false
  if (terms.some((term,index) => terms.some((other,otherIndex)=>index!==otherIndex && term.startDate<=other.endDate && other.startDate<=term.endDate))) return false
  const termIds = new Set(terms.map((term) => term.id))
  if (!(Array.isArray(value.subjects) && value.subjects.every(subject)
    && Array.isArray(value.classes) && value.classes.every(schoolClass)
    && Array.isArray(value.courses) && value.courses.every((item) => legacyCourse(item) && record(item) && string(item.termId) && termIds.has(item.termId))
    && Array.isArray(value.events) && value.events.every((item) => legacyEvent(item) && record(item) && (item.termId === null || string(item.termId)))
    && Array.isArray(value.overrides) && value.overrides.every((item) => legacyOverride(item) && record(item) && (item.termId === null || string(item.termId)))
    && Array.isArray(value.migrationWarnings))) return false
  const data = value as unknown as AppData
  const subjects = new Set(data.subjects.map((item)=>item.id)); const classes = new Set(data.classes.map((item)=>item.id))
  if (data.courses.some((course)=>{ const term=terms.find((item)=>item.id===course.termId); return !subjects.has(course.subjectId)||!classes.has(course.classId)||!term?.periods.some((item)=>item.id===course.periodId)||(!term.weekCycle.enabled&&course.weekPattern!=='every') })) return false
  if (data.events.some((event)=>event.termId!==null && !terms.some((term)=>term.id===event.termId&&event.date>=term.startDate&&event.date<=term.endDate))) return false
  if (data.overrides.some((item)=>item.termId!==null && (!terms.some((term)=>term.id===item.termId&&item.date>=term.startDate&&item.date<=term.endDate) || (item.originalCourseId && !data.courses.some((course)=>course.id===item.originalCourseId&&course.termId===item.termId))))) return false
  return true
}

function inRange(value: string, start: string, end: string) { return value >= start && value <= end }

export function migrateV1ToV3(value: LegacyAppDataV1): AppData {
  if (!isLegacyAppDataV1(value)) throw new Error('Legacy data failed validation')
  const termId = `term-${value.semester.startDate}-${value.semester.endDate}`
  const periods = value.periods.map((item, index) => ({ ...item, order: index + 1 }))
  const courseIds = new Set(value.courses.map((course) => course.id))
  const warnings: AppData['migrationWarnings'] = []
  const events = value.events.map((event) => {
    const assigned = inRange(event.date, value.semester.startDate, value.semester.endDate) ? termId : null
    if (!assigned) warnings.push({ id: `event-${event.id}`, entityType: 'event', entityId: event.id, message: '事件日期不在舊學期範圍內，已保留且未分類。' })
    return { ...event, termId: assigned }
  })
  const overrides = value.overrides.map((item) => {
    const safe = inRange(item.date, value.semester.startDate, value.semester.endDate) && (!item.originalCourseId || courseIds.has(item.originalCourseId))
    if (!safe) warnings.push({ id: `override-${item.id}`, entityType: 'override', entityId: item.id, message: '單日異動無法安全歸屬，已保留且停用學期分類。' })
    return { ...item, termId: safe ? termId : null }
  })
  const migrated: AppData = {
    schemaVersion: 3,
    school: { id: 'primary-school', name: '我的學校', timezone: 'Asia/Taipei', defaultPeriods: periods.length ? periods.map((item) => ({ ...item })) : defaultPeriods.map((item) => ({ ...item })) },
    academicTerms: [{ id: termId, name: value.semester.name, startDate: value.semester.startDate, endDate: value.semester.endDate, weekCycle: { enabled: true, anchorDate: value.semester.startDate, anchorPattern: value.semester.firstWeekPattern }, periods, createdAt: `${value.semester.startDate}T00:00:00.000Z` }],
    activeTermId: termId,
    subjects: value.subjects.map((item) => ({ ...item })), classes: value.classes.map((item) => ({ ...item })),
    courses: value.courses.map((item) => ({ ...item, termId })), events, overrides, migrationWarnings: warnings,
  }
  if (!isAppData(migrated)) throw new Error('Migrated data failed validation')
  return migrated
}

function withoutOrigin<T extends DemoRecord>(item: T) { const copy = { ...item } as Partial<T>; delete copy.origin; return copy }
function matchesSeed<T extends DemoRecord>(item: T, seeds: T[]) { const seed = seeds.find((candidate) => candidate.id === item.id); return Boolean(seed && JSON.stringify(withoutOrigin(item)) === JSON.stringify(withoutOrigin(seed))) }
export function migrateAppData(value: AppData): AppData { return value }

export function countDemoRecords(data: AppData): number { return [...data.subjects, ...data.classes, ...data.courses, ...data.events, ...data.overrides].filter((item) => item.origin === 'demo').length }
export function clearDemoRecords(data: AppData): AppData {
  const courses = data.courses.filter((item) => item.origin !== 'demo'); const events = data.events.filter((item) => item.origin !== 'demo'); const overrides = data.overrides.filter((item) => item.origin !== 'demo')
  const usedSubjects = new Set([...courses.map((item) => item.subjectId), ...overrides.flatMap((item) => item.replacement ? [item.replacement.subjectId] : [])])
  const usedClasses = new Set([...courses.map((item) => item.classId), ...overrides.flatMap((item) => item.replacement ? [item.replacement.classId] : [])])
  return { ...data, courses, events, overrides, subjects: data.subjects.filter((item) => item.origin !== 'demo' || usedSubjects.has(item.id)), classes: data.classes.filter((item) => item.origin !== 'demo' || usedClasses.has(item.id)) }
}

// Used only when recognizing untagged records from the exact bundled v3 seed.
export function tagExactSeedMatches(data: AppData): AppData {
  return { ...data,
    subjects: data.subjects.map((item) => item.origin || !matchesSeed(item, initialData.subjects) ? item : { ...item, origin: 'demo' }),
    classes: data.classes.map((item) => item.origin || !matchesSeed(item, initialData.classes) ? item : { ...item, origin: 'demo' }),
    courses: data.courses.map((item) => item.origin || !matchesSeed(item, initialData.courses) ? item : { ...item, origin: 'demo' }),
  }
}

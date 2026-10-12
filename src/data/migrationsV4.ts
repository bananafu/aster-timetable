import type {
  AcademicTerm,
  AppData,
  AppDataV4,
  CalendarEventV4,
  MigrationWarningV4,
  ProjectClass,
  ScheduleOverrideV4,
} from '../types'
import { isAppData, isLegacyAppDataV1, migrateV1ToV3, type LegacyAppDataV1 } from './migrations'
import { isAppDataV4 } from './validators/v4'

const SCHOOL_COLOR = '#A5A051'

function mappedId(kind: string, ...parts: string[]) {
  const encoded = parts.map((part) => encodeURIComponent(part))
  return `v3-${kind}-${encoded.map((part) => `${part.length}:${part}`).join('|')}`
}

function projectId(termId: string) { return mappedId('project', termId) }
function schoolId(termId: string) { return mappedId('school', termId) }
function unitId(termId: string) { return mappedId('unit', termId) }
function classId(termId: string, originalId: string) { return mappedId('class', termId, originalId) }

function parseTermDescriptor(term: AcademicTerm) {
  const namedYear = term.name.match(/(\d{2,3})\s*學年度/)?.[1]
  const academicYear = namedYear ? Number(namedYear) : Number(term.startDate.slice(0, 4)) - 1911
  if (/(第一|第\s*1|上)\s*學期/.test(term.name)) return { academicYear, semester: 'first' as const }
  if (/(第二|第\s*2|下)\s*學期/.test(term.name)) return { academicYear, semester: 'second' as const }
  if (/暑/.test(term.name)) return { academicYear, semester: 'summer' as const }
  return { academicYear, semester: 'custom' as const, customLabel: term.name }
}

function storedProjectName(source: AppData, term: AcademicTerm) {
  const raw = source as AppData & { projectName?: unknown; projectNamesByTermId?: Record<string, unknown> }
  const termWithName = term as AcademicTerm & { projectName?: unknown }
  const candidate = termWithName.projectName ?? raw.projectNamesByTermId?.[term.id]
    ?? (source.academicTerms.length === 1 ? raw.projectName : undefined)
  return typeof candidate === 'string' && candidate.trim() ? candidate : `原有課表・${term.name}`
}

function warningId(existing: Set<string>, base: string) {
  let result = base
  let suffix = 2
  while (existing.has(result)) result = `${base}-${suffix++}`
  existing.add(result)
  return result
}

export function migrateV3ToV4(source: AppData): AppDataV4 {
  if (!isAppData(source)) throw new Error('AppData v3 failed validation')

  const termById = new Map(source.academicTerms.map((term) => [term.id, term]))
  const projects: AppDataV4['projects'] = source.academicTerms.map((term) => ({
    id: projectId(term.id),
    name: storedProjectName(source, term),
    term: parseTermDescriptor(term),
    archivedAt: term.archivedAt,
    createdAt: term.createdAt,
    updatedAt: term.archivedAt ?? term.createdAt,
  }))
  const schools: AppDataV4['schools'] = source.academicTerms.map((term) => ({
    id: schoolId(term.id), projectId: projectId(term.id), name: source.school.name, color: SCHOOL_COLOR,
  }))
  const teachingUnits: AppDataV4['teachingUnits'] = source.academicTerms.map((term) => ({
    id: unitId(term.id), projectId: projectId(term.id), schoolId: schoolId(term.id), name: term.name,
    schoolLevel: 'other', startDate: term.startDate, endDate: term.endDate, timezone: source.school.timezone,
    periods: term.periods.map((period) => ({ ...period })), weekCycle: { ...term.weekCycle },
  }))

  const classes: ProjectClass[] = source.academicTerms.flatMap((term) => source.classes.map((item) => ({
    ...item, id: classId(term.id, item.id), projectId: projectId(term.id), teachingUnitId: unitId(term.id),
  })))
  const recurringLessons: AppDataV4['recurringLessons'] = source.courses.map((course) => {
    const term = termById.get(course.termId)
    if (!term) throw new Error(`Course ${course.id} references an unknown term`)
    return {
      id: course.id, seriesId: course.id, projectId: projectId(term.id), teachingUnitId: unitId(term.id),
      subjectId: course.subjectId, classId: classId(term.id, course.classId), day: course.day,
      periodId: course.periodId, weekPattern: course.weekPattern, effectiveStart: term.startDate,
      effectiveEnd: term.endDate, room: course.room, origin: course.origin,
    }
  })

  const usedWarningIds = new Set<string>()
  const migrationWarnings: MigrationWarningV4[] = source.migrationWarnings.map((item) => ({
    ...item, id: warningId(usedWarningIds, mappedId('warning', item.id)),
  }))
  const events: CalendarEventV4[] = source.events.map(({ termId, ...event }) => {
    if (termId === null) {
      migrationWarnings.push({ id: warningId(usedWarningIds, mappedId('warning', 'event', event.id)), entityType: 'event', entityId: event.id, message: '事件無法安全歸屬至既有學期，已保留為未分類資料。' })
      return { ...event, projectId: null, teachingUnitId: null }
    }
    return { ...event, projectId: projectId(termId), teachingUnitId: unitId(termId) }
  })
  const overrides: ScheduleOverrideV4[] = source.overrides.map(({ termId, originalCourseId, replacement, ...override }) => {
    if (termId === null) {
      migrationWarnings.push({ id: warningId(usedWarningIds, mappedId('warning', 'override', override.id)), entityType: 'override', entityId: override.id, message: '單日異動無法安全歸屬至既有學期，已保留且不參與排課。' })
      return { ...override, projectId: null, teachingUnitId: null, originalLessonId: originalCourseId, replacement }
    }
    const term = termById.get(termId)
    const safe = Boolean(term?.periods.some((period) => period.id === override.periodId)
      && (!replacement || (source.subjects.some((subject) => subject.id === replacement.subjectId)
        && source.classes.some((schoolClass) => schoolClass.id === replacement.classId))))
    if (!safe) {
      migrationWarnings.push({ id: warningId(usedWarningIds, mappedId('warning', 'override', override.id)), entityType: 'override', entityId: override.id, message: '單日異動含有無法驗證的節次或替代課程引用，已保留且不參與排課。' })
      return { ...override, projectId: null, teachingUnitId: null, originalLessonId: originalCourseId, replacement }
    }
    return {
      ...override, projectId: projectId(termId), teachingUnitId: unitId(termId), originalLessonId: originalCourseId,
      replacement: replacement ? { ...replacement, classId: classId(termId, replacement.classId) } : undefined,
    }
  })

  const migrated: AppDataV4 = {
    schemaVersion: 4,
    activeProjectId: projectId(source.activeTermId),
    projects,
    schools,
    teachingUnits,
    subjects: source.subjects.map((subject) => ({ ...subject })),
    classes,
    recurringLessons,
    events,
    overrides,
    migrationWarnings,
  }
  if (!isAppDataV4(migrated)) throw new Error('Migrated AppData v4 failed validation')
  return migrated
}

export function migrateV1ToV4(source: LegacyAppDataV1): AppDataV4 {
  if (!isLegacyAppDataV1(source)) throw new Error('AppData v1 failed validation')
  return migrateV3ToV4(migrateV1ToV3(source))
}

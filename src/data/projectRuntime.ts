import type {
  AcademicTerm,
  AppData,
  AppDataV4,
  CalendarEvent,
  Course,
  ScheduleOverride,
  SchoolClass,
  SchoolPeriod,
  SemesterKind,
} from '../types'

export interface NewProjectInput {
  name: string
  academicYear: number
  semester: SemesterKind
  customLabel?: string
  startDate: string
  endDate: string
}

export interface CopyProjectUnitInput {
  sourceUnitId: string
  startDate: string
  endDate: string
  anchorDate: string
  anchorPattern: 'A' | 'B'
}

export interface CopyProjectInput extends Omit<NewProjectInput, 'startDate' | 'endDate'> {
  sourceProjectId: string
  units: CopyProjectUnitInput[]
}

export const BLANK_PROJECT_PERIODS: SchoolPeriod[] = [
  { id: 1, order: 1, label: '第 1 節', startTime: '08:10', endTime: '09:00' },
  { id: 2, order: 2, label: '第 2 節', startTime: '09:10', endTime: '10:00' },
  { id: 3, order: 3, label: '第 3 節', startTime: '10:10', endTime: '11:00' },
  { id: 4, order: 4, label: '第 4 節', startTime: '11:10', endTime: '12:00' },
  { id: 5, order: 5, label: '第 5 節', startTime: '13:10', endTime: '14:00' },
  { id: 6, order: 6, label: '第 6 節', startTime: '14:10', endTime: '15:00' },
  { id: 7, order: 7, label: '第 7 節', startTime: '15:10', endTime: '16:00' },
]

export function switchActiveProject(data: AppDataV4, projectId: string): AppDataV4 {
  const project = data.projects.find((item) => item.id === projectId)
  if (!project || project.archivedAt) throw new Error('Project is not available')
  return { ...data, activeProjectId: projectId }
}

export function renameProject(data: AppDataV4, projectId: string, name: string, updatedAt = new Date().toISOString()): AppDataV4 {
  const normalized = name.trim()
  if (!normalized || !data.projects.some((item) => item.id === projectId)) throw new Error('Project name is invalid')
  return { ...data, projects: data.projects.map((item) => item.id === projectId ? { ...item, name: normalized, updatedAt } : item) }
}

export function createBlankProject(data: AppDataV4, input: NewProjectInput, createId: () => string, now = new Date().toISOString()): AppDataV4 {
  const name = input.name.trim()
  if (!name || !Number.isInteger(input.academicYear) || input.academicYear <= 0 || !input.startDate || !input.endDate || input.startDate > input.endDate
    || (input.semester === 'custom' && !input.customLabel?.trim())) throw new Error('New project data is invalid')
  const projectId = createId(); const schoolId = createId(); const unitId = createId()
  return {
    ...data,
    activeProjectId: projectId,
    projects: [...data.projects, { id: projectId, name, term: { academicYear: input.academicYear, semester: input.semester, customLabel: input.semester === 'custom' ? input.customLabel?.trim() : undefined }, createdAt: now, updatedAt: now }],
    schools: [...data.schools, { id: schoolId, projectId, name: '我的學校', color: '#A5A051' }],
    teachingUnits: [...data.teachingUnits, { id: unitId, projectId, schoolId, name: '主要任教單位', schoolLevel: 'senior-high', startDate: input.startDate, endDate: input.endDate, timezone: 'Asia/Taipei', periods: BLANK_PROJECT_PERIODS.map((item) => ({ ...item })), weekCycle: { enabled: true, anchorDate: input.startDate, anchorPattern: 'A' } }],
  }
}

export const createProject = createBlankProject

export function copyProject(data: AppDataV4, input: CopyProjectInput, createId: () => string, now = new Date().toISOString()): AppDataV4 {
  const source = data.projects.find((item) => item.id === input.sourceProjectId)
  const sourceSchools = data.schools.filter((item) => item.projectId === input.sourceProjectId)
  const sourceUnits = data.teachingUnits.filter((item) => item.projectId === input.sourceProjectId)
  const name = input.name.trim()
  if (!source || !name || sourceSchools.length === 0 || sourceUnits.length === 0 || input.units.length !== sourceUnits.length
    || !Number.isInteger(input.academicYear) || input.academicYear <= 0
    || (input.semester === 'custom' && !input.customLabel?.trim())) throw new Error('Project copy input is invalid')
  const configs = new Map(input.units.map((item) => [item.sourceUnitId, item]))
  if (configs.size !== sourceUnits.length || sourceUnits.some((unit) => {
    const config = configs.get(unit.id)
    return !config || !config.startDate || !config.endDate || !config.anchorDate
      || config.startDate > config.endDate || config.anchorDate < config.startDate || config.anchorDate > config.endDate
  })) throw new Error('Every teaching unit requires new dates and an anchor')

  const sourceLessons = data.recurringLessons.filter((item) => item.projectId === source.id)
  const versions = new Map<string, number>()
  sourceLessons.forEach((lesson) => versions.set(lesson.seriesId, (versions.get(lesson.seriesId) ?? 0) + 1))
  if ([...versions.values()].some((count) => count > 1)) throw new Error('Versioned lessons require manual review before copying')

  const projectId = createId()
  const schoolIds = new Map(sourceSchools.map((school) => [school.id, createId()]))
  const unitIds = new Map(sourceUnits.map((unit) => [unit.id, createId()]))
  const sourceClasses = data.classes.filter((item) => item.projectId === source.id)
  const classIds = new Map(sourceClasses.map((item) => [item.id, createId()]))
  const lessonIds = new Map(sourceLessons.map((item) => [item.id, createId()]))

  return {
    ...data,
    activeProjectId: projectId,
    projects: [...data.projects, { id: projectId, name, term: { academicYear: input.academicYear, semester: input.semester, customLabel: input.semester === 'custom' ? input.customLabel?.trim() : undefined }, createdAt: now, updatedAt: now }],
    schools: [...data.schools, ...sourceSchools.map((school) => ({ ...school, id: schoolIds.get(school.id)!, projectId }))],
    teachingUnits: [...data.teachingUnits, ...sourceUnits.map((unit) => {
      const config = configs.get(unit.id)!
      return { ...unit, id: unitIds.get(unit.id)!, projectId, schoolId: schoolIds.get(unit.schoolId)!, startDate: config.startDate, endDate: config.endDate, periods: unit.periods.map((item) => ({ ...item })), weekCycle: { ...unit.weekCycle, anchorDate: config.anchorDate, anchorPattern: config.anchorPattern } }
    })],
    classes: [...data.classes, ...sourceClasses.map((item) => ({ ...item, id: classIds.get(item.id)!, projectId, teachingUnitId: unitIds.get(item.teachingUnitId)! }))],
    recurringLessons: [...data.recurringLessons, ...sourceLessons.map((item) => {
      const config = configs.get(item.teachingUnitId)!
      const id = lessonIds.get(item.id)!
      return { ...item, id, seriesId: id, projectId, teachingUnitId: unitIds.get(item.teachingUnitId)!, classId: classIds.get(item.classId)!, effectiveStart: config.startDate, effectiveEnd: config.endDate }
    })],
  }
}

export function archiveProject(data: AppDataV4, projectId: string, archivedAt = new Date().toISOString()): AppDataV4 {
  if (!data.projects.some((item) => item.id === projectId)) throw new Error('Project does not exist')
  const nextActive = data.activeProjectId === projectId
    ? data.projects.find((item) => item.id !== projectId && !item.archivedAt)?.id ?? null
    : data.activeProjectId
  return { ...data, activeProjectId: nextActive, projects: data.projects.map((item) => item.id === projectId ? { ...item, archivedAt, updatedAt: archivedAt } : item) }
}

export function reactivateProject(data: AppDataV4, projectId: string, updatedAt = new Date().toISOString()): AppDataV4 {
  const project = data.projects.find((item) => item.id === projectId)
  if (!project?.archivedAt) throw new Error('Archived project does not exist')
  return { ...data, activeProjectId: projectId, projects: data.projects.map((item) => item.id === projectId ? { ...item, archivedAt: undefined, updatedAt } : item) }
}

export function deleteProject(data: AppDataV4, projectId: string): AppDataV4 {
  if (!data.projects.some((item) => item.id === projectId)) throw new Error('Project does not exist')
  const entityIds = new Set([
    ...data.classes.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.recurringLessons.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.events.filter((item) => item.projectId === projectId).map((item) => item.id),
    ...data.overrides.filter((item) => item.projectId === projectId).map((item) => item.id),
  ])
  const remainingProjects = data.projects.filter((item) => item.id !== projectId)
  const nextActive = data.activeProjectId === projectId
    ? remainingProjects.find((item) => !item.archivedAt)?.id ?? null
    : data.activeProjectId
  return {
    ...data,
    activeProjectId: nextActive,
    projects: remainingProjects,
    schools: data.schools.filter((item) => item.projectId !== projectId),
    teachingUnits: data.teachingUnits.filter((item) => item.projectId !== projectId),
    classes: data.classes.filter((item) => item.projectId !== projectId),
    recurringLessons: data.recurringLessons.filter((item) => item.projectId !== projectId),
    events: data.events.filter((item) => item.projectId !== projectId),
    overrides: data.overrides.filter((item) => item.projectId !== projectId),
    migrationWarnings: data.migrationWarnings.filter((item) => !entityIds.has(item.entityId)),
  }
}

export function getActiveProject(data: AppDataV4) {
  return data.projects.find((project) => project.id === data.activeProjectId)
}

export function projectToLegacyView(data: AppDataV4, requestedProjectId = data.activeProjectId): AppData {
  const project = data.projects.find((item) => item.id === requestedProjectId)
  if (!project) throw new Error('Active project does not exist')
  const schools = data.schools.filter((item) => item.projectId === project.id)
  const units = data.teachingUnits.filter((item) => item.projectId === project.id)
  const firstUnit = units[0]
  const firstSchool = schools[0]
  if (!firstUnit || !firstSchool) throw new Error('Project does not have a school and teaching unit')

  const academicTerms: AcademicTerm[] = units.map((unit) => ({
    id: unit.id,
    name: unit.name,
    startDate: unit.startDate,
    endDate: unit.endDate,
    archivedAt: project.archivedAt,
    weekCycle: { ...unit.weekCycle },
    periods: unit.periods.map((period) => ({ ...period })),
    createdAt: project.createdAt,
  }))
  const classes: SchoolClass[] = data.classes.filter((item) => item.projectId === project.id)
    .map(({ id, name, grade, classNumber, room, origin }) => ({ id, name, grade, classNumber, room, origin }))
  const courses: Course[] = data.recurringLessons.filter((item) => item.projectId === project.id)
    .map(({ id, teachingUnitId, subjectId, classId, day, periodId, weekPattern, room, origin }) => ({
      id, termId: teachingUnitId, subjectId, classId, day, periodId, weekPattern, room, origin,
    }))
  const events: CalendarEvent[] = data.events.filter((item) => item.projectId === project.id || item.projectId === null)
    .map((item) => ({ id: item.id, termId: item.teachingUnitId ?? null, title: item.title, type: item.type, date: item.date, startTime: item.startTime, endTime: item.endTime, location: item.location, notes: item.notes, color: item.color, origin: item.origin }))
  const overrides: ScheduleOverride[] = data.overrides.filter((item): item is typeof item & { action: 'cancel' | 'replace' } => item.projectId === project.id && item.action !== 'move')
    .map((item) => ({ id: item.id, termId: item.teachingUnitId, date: item.date, periodId: item.periodId, action: item.action, originalCourseId: item.originalLessonId, replacement: item.replacement, note: item.note, origin: item.origin }))

  return {
    schemaVersion: 3,
    school: {
      id: 'primary-school',
      name: firstSchool.name,
      timezone: firstUnit.timezone,
      defaultPeriods: firstUnit.periods.map((period) => ({ ...period })),
    },
    academicTerms,
    activeTermId: firstUnit.id,
    subjects: data.subjects.map((subject) => ({ ...subject })),
    classes,
    courses,
    events,
    overrides,
    migrationWarnings: data.migrationWarnings.flatMap((warning) => warning.entityType === 'event' || warning.entityType === 'override'
      ? [{ id: warning.id, entityType: warning.entityType, entityId: warning.entityId, message: warning.message }]
      : []),
  }
}

export function mergeProjectView(data: AppDataV4, projectId: string, view: AppData): AppDataV4 {
  const project = data.projects.find((item) => item.id === projectId)
  if (!project) throw new Error('Project does not exist')
  const existingUnits = new Map(data.teachingUnits.filter((item) => item.projectId === projectId).map((item) => [item.id, item]))
  const firstSchool = data.schools.find((item) => item.projectId === projectId)
  if (!firstSchool) throw new Error('Project does not have a school')

  const teachingUnits = view.academicTerms.map((term) => {
    const existing = existingUnits.get(term.id)
    if (!existing) throw new Error('Legacy view cannot create teaching units')
    return { ...existing, name: term.name, startDate: term.startDate, endDate: term.endDate, periods: term.periods.map((period) => ({ ...period })), weekCycle: { ...term.weekCycle } }
  })
  const unitIds = new Set(teachingUnits.map((item) => item.id))
  const existingClasses = new Map(data.classes.filter((item) => item.projectId === projectId).map((item) => [item.id, item]))
  const classes = view.classes.map((item) => {
    const existing = existingClasses.get(item.id)
    const teachingUnitId = existing?.teachingUnitId ?? teachingUnits[0]?.id
    if (!teachingUnitId || !unitIds.has(teachingUnitId)) throw new Error('Class does not have a valid teaching unit')
    return { ...item, grade: item.grade ?? existing?.grade, classNumber: item.classNumber ?? existing?.classNumber, projectId, teachingUnitId }
  })
  const existingLessons = new Map(data.recurringLessons.filter((item) => item.projectId === projectId).map((item) => [item.id, item]))
  const recurringLessons = view.courses.map((course) => {
    const unit = teachingUnits.find((item) => item.id === course.termId)
    if (!unit) throw new Error('Course does not have a valid teaching unit')
    const existing = existingLessons.get(course.id)
    return {
      id: course.id,
      seriesId: existing?.seriesId ?? course.id,
      projectId,
      teachingUnitId: unit.id,
      subjectId: course.subjectId,
      classId: course.classId,
      day: course.day,
      periodId: course.periodId,
      weekPattern: course.weekPattern,
      effectiveStart: existing?.effectiveStart ?? unit.startDate,
      effectiveEnd: existing?.effectiveEnd ?? unit.endDate,
      room: course.room,
      origin: course.origin,
    }
  })
  const events = view.events.map(({ termId, ...event }) => ({
    ...event,
    projectId: termId === null ? null : projectId,
    teachingUnitId: termId,
  }))
  const overrides = view.overrides.map(({ termId, originalCourseId, ...override }) => ({
    ...override,
    projectId,
    teachingUnitId: termId,
    originalLessonId: originalCourseId,
  }))
  const nativeOverrides = data.overrides.filter((item) => item.projectId === projectId && item.action === 'move')

  return {
    ...data,
    projects: data.projects.map((item) => item.id === projectId ? { ...item, updatedAt: new Date().toISOString() } : item),
    schools: data.schools.map((item) => item.id === firstSchool.id ? { ...item, name: view.school.name } : item),
    teachingUnits: [...data.teachingUnits.filter((item) => item.projectId !== projectId), ...teachingUnits],
    subjects: view.subjects.map((subject) => ({ ...subject })),
    classes: [...data.classes.filter((item) => item.projectId !== projectId), ...classes],
    recurringLessons: [...data.recurringLessons.filter((item) => item.projectId !== projectId), ...recurringLessons],
    events: [...data.events.filter((item) => item.projectId !== projectId && item.projectId !== null), ...events],
    overrides: [...data.overrides.filter((item) => item.projectId !== projectId), ...nativeOverrides, ...overrides],
  }
}

import type {
  AcademicTerm,
  AppData,
  AppDataV4,
  CalendarEvent,
  Course,
  ScheduleOverride,
  SchoolClass,
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

export function createProject(data: AppDataV4, input: NewProjectInput, createId: () => string, now = new Date().toISOString()): AppDataV4 {
  const active = getActiveProject(data)
  const sourceUnit = data.teachingUnits.find((item) => item.projectId === active?.id)
  const sourceSchool = data.schools.find((item) => item.projectId === active?.id)
  const name = input.name.trim()
  if (!sourceUnit || !sourceSchool || !name || !Number.isInteger(input.academicYear) || input.academicYear <= 0 || input.startDate > input.endDate
    || (input.semester === 'custom' && !input.customLabel?.trim())) throw new Error('New project data is invalid')
  const projectId = createId(); const schoolId = createId(); const unitId = createId()
  return {
    ...data,
    activeProjectId: projectId,
    projects: [...data.projects, { id: projectId, name, term: { academicYear: input.academicYear, semester: input.semester, customLabel: input.semester === 'custom' ? input.customLabel?.trim() : undefined }, createdAt: now, updatedAt: now }],
    schools: [...data.schools, { id: schoolId, projectId, name: sourceSchool.name, color: sourceSchool.color }],
    teachingUnits: [...data.teachingUnits, { id: unitId, projectId, schoolId, name: '主要任教單位', schoolLevel: sourceUnit.schoolLevel, startDate: input.startDate, endDate: input.endDate, timezone: sourceUnit.timezone, periods: sourceUnit.periods.map((item) => ({ ...item })), weekCycle: { enabled: true, anchorDate: input.startDate, anchorPattern: 'A' } }],
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
    .map(({ id, name, room, origin }) => ({ id, name, room, origin }))
  const courses: Course[] = data.recurringLessons.filter((item) => item.projectId === project.id)
    .map(({ id, teachingUnitId, subjectId, classId, day, periodId, weekPattern, room, origin }) => ({
      id, termId: teachingUnitId, subjectId, classId, day, periodId, weekPattern, room, origin,
    }))
  const events: CalendarEvent[] = data.events.filter((item) => item.projectId === project.id || item.projectId === null)
    .map((item) => ({ id: item.id, termId: item.teachingUnitId ?? null, title: item.title, type: item.type, date: item.date, startTime: item.startTime, endTime: item.endTime, location: item.location, notes: item.notes, color: item.color, origin: item.origin }))
  const overrides: ScheduleOverride[] = data.overrides.filter((item) => item.projectId === project.id)
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
    return { ...item, projectId, teachingUnitId }
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

  return {
    ...data,
    projects: data.projects.map((item) => item.id === projectId ? { ...item, updatedAt: new Date().toISOString() } : item),
    schools: data.schools.map((item) => item.id === firstSchool.id ? { ...item, name: view.school.name } : item),
    teachingUnits: [...data.teachingUnits.filter((item) => item.projectId !== projectId), ...teachingUnits],
    subjects: view.subjects.map((subject) => ({ ...subject })),
    classes: [...data.classes.filter((item) => item.projectId !== projectId), ...classes],
    recurringLessons: [...data.recurringLessons.filter((item) => item.projectId !== projectId), ...recurringLessons],
    events: [...data.events.filter((item) => item.projectId !== projectId && item.projectId !== null), ...events],
    overrides: [...data.overrides.filter((item) => item.projectId !== projectId), ...overrides],
  }
}

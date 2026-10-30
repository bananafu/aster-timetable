import { createEmptyAppDataV8 } from './storageV8'
import { createClassV9, createEmptyProjectV9, createSchoolV9 } from './managementV9'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9,
  createTeacherTimetableV9, createTeachingUnitV9, switchActiveProjectV9 } from './teacherSubjectsV9'
import { isCompatibleAppDataV9 } from './validators/v9'
import type { AppDataV9 } from '../types/v9'

export const V9_LOCAL_PREVIEW_WEEK = '2026-03-02'

const empty = (): AppDataV9 => ({ ...createEmptyAppDataV8(), schemaVersion: 9, subjects: [] })

/** Fixed, validator-backed data used only by the localhost Vite preview. */
export function createV9LocalPreviewFixture(): AppDataV9 {
  let serial = 0
  const id = () => `v9-local-${++serial}`
  let data = createBlankProjectV9(empty(), {
    name: '跨校教學專案', academicYear: 115, semester: 'first',
    startDate: '2026-03-01', endDate: '2026-06-30',
  }, id)
  const projectId = data.activeProjectId!
  const firstUnit = data.teachingUnits[0]
  data = createSchoolV9(data, projectId, { name: '城南高中', color: '#718B6C' }, 'preview-school-b')
  data = createTeachingUnitV9(data, projectId, {
    schoolId: 'preview-school-b', name: '高中部', schoolLevel: 'senior-high',
    startDate: '2026-03-01', endDate: '2026-06-30', periods: firstUnit.periods,
    weekCycle: { enabled: true, anchorDate: V9_LOCAL_PREVIEW_WEEK, anchorPattern: 'B' },
  }, 'preview-unit-b')
  data = { ...data, teachingUnits: data.teachingUnits.map((unit) => unit.id === firstUnit.id
    ? { ...unit, weekCycle: { enabled: true, anchorDate: V9_LOCAL_PREVIEW_WEEK, anchorPattern: 'A' as const } }
    : unit) }
  data = createTeacherTimetableV9(data, projectId,
    { name: '林老師課表', teacherName: '林老師' }, 'preview-timetable-a')
  data = createTeacherTimetableV9(data, projectId,
    { name: '陳老師課表', teacherName: '陳老師' }, 'preview-timetable-b')

  data = createTeacherSubjectV9(data, projectId, 'preview-timetable-a', {
    name: '國文', shortName: '國', color: '#A66D52', applicableSchoolLevels: ['junior-high', 'senior-high'],
  }, 'preview-subject-a')
  data = configureTeacherSubjectV9(data, projectId, 'preview-timetable-a', firstUnit.id,
    'preview-subject-a', 'preview-subject-a-unit-a')
  data = configureTeacherSubjectV9(data, projectId, 'preview-timetable-a', 'preview-unit-b',
    'preview-subject-a', 'preview-subject-a-unit-b')
  data = createTeacherSubjectV9(data, projectId, 'preview-timetable-b', {
    name: '數學', shortName: '數', color: '#647C88', applicableSchoolLevels: [firstUnit.schoolLevel],
  }, 'preview-subject-b')
  data = configureTeacherSubjectV9(data, projectId, 'preview-timetable-b', firstUnit.id,
    'preview-subject-b', 'preview-subject-b-unit-a')

  data = createClassV9(data, projectId, { teachingUnitId: firstUnit.id, name: '七年一班', room: '101' },
    'preview-class-a')
  data = createClassV9(data, projectId, { teachingUnitId: 'preview-unit-b', name: '高一甲班', room: '201' },
    'preview-class-b')
  const firstPeriod = firstUnit.periods[0].id
  const secondPeriod = firstUnit.periods[1]?.id ?? firstPeriod
  data = { ...data,
    recurringLessons: [
      { id: 'preview-lesson-moved', seriesId: 'preview-series-moved', projectId,
        timetableId: 'preview-timetable-a', teachingUnitId: firstUnit.id,
        subjectId: 'preview-subject-a', classId: 'preview-class-a', day: 1, periodId: firstPeriod,
        weekPattern: 'A', effectiveStart: '2026-03-01' },
      { id: 'preview-lesson-b', seriesId: 'preview-series-b', projectId,
        timetableId: 'preview-timetable-a', teachingUnitId: 'preview-unit-b',
        subjectId: 'preview-subject-a', classId: 'preview-class-b', day: 2, periodId: firstPeriod,
        weekPattern: 'B', effectiveStart: '2026-03-01' },
      { id: 'preview-lesson-cancelled', seriesId: 'preview-series-cancelled', projectId,
        timetableId: 'preview-timetable-a', teachingUnitId: firstUnit.id,
        subjectId: 'preview-subject-a', classId: 'preview-class-a', day: 3, periodId: secondPeriod,
        weekPattern: 'A', effectiveStart: '2026-03-01' },
      { id: 'preview-other-teacher', seriesId: 'preview-other-teacher-series', projectId,
        timetableId: 'preview-timetable-b', teachingUnitId: firstUnit.id,
        subjectId: 'preview-subject-b', classId: 'preview-class-a', day: 4, periodId: firstPeriod,
        weekPattern: 'A', effectiveStart: '2026-03-01' },
    ],
    oneOffLessons: [{ id: 'preview-one-off', projectId, timetableId: 'preview-timetable-a',
      teachingUnitId: 'preview-unit-b', classId: 'preview-class-b', subjectId: 'preview-subject-a',
      date: '2026-03-05', purpose: 'extra', time: { mode: 'period', periodId: secondPeriod } }],
    overrides: [
      { id: 'preview-move', projectId, timetableId: 'preview-timetable-a', teachingUnitId: firstUnit.id,
        date: '2026-03-02', periodId: firstPeriod, action: 'move', originalLessonId: 'preview-lesson-moved',
        target: { date: '2026-03-03', periodId: secondPeriod } },
      { id: 'preview-cancel', projectId, timetableId: 'preview-timetable-a', teachingUnitId: firstUnit.id,
        date: '2026-03-04', periodId: secondPeriod, action: 'cancel',
        originalLessonId: 'preview-lesson-cancelled' },
    ],
    events: [
      { id: 'preview-meeting', projectId, timetableId: 'preview-timetable-a', teachingUnitId: firstUnit.id,
        ownershipStatus: 'resolved', title: '教學研究會議', type: 'meeting', date: '2026-03-02',
        startTime: '12:10', endTime: '13:00', color: '#A66D52' },
      { id: 'preview-activity', projectId, timetableId: 'preview-timetable-a', teachingUnitId: 'preview-unit-b',
        ownershipStatus: 'resolved', title: '校慶活動', type: 'activity', date: '2026-03-07',
        startTime: '09:00', endTime: '11:00', color: '#718B6C' },
    ],
  }
  data = createEmptyProjectV9(data, { name: '空白專案' }, 'preview-empty-project', '2026-02-01T00:00:00.000Z')
  data = switchActiveProjectV9(data, projectId)
  if (!isCompatibleAppDataV9(data)) throw new Error('Invalid V9 local preview fixture.')
  return data
}

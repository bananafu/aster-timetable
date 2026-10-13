import { describe, expect, it } from 'vitest'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { addLessonV4, deleteLessonV4, updateLessonV4 } from './lessonsV4'
import { cancelLessonOnDate, moveLessonOnDate, permanentlySwapLessons, permanentlyUpdateLesson, replaceLessonOnDate, revokeLessonOverride, swapLessonOccurrences } from './lessonChangesV4'
import { copyProject, mergeProjectView, projectToLegacyView } from './projectRuntime'
import { createLessonDragIntent } from '../lib/lessonDrag'
import { getTodayTeachingSummaryV4, resolveProjectDay } from '../lib/scheduleV4'
import { isCompatibleAppDataV6 } from './validators/v6'
import type { AppDataV4 } from '../types'

const monday = new Date(2026, 8, 7)
const day = (data: AppDataV4, timetableId: string) => resolveProjectDay(data, data.projects[0].id, monday, { timetableId })

function fixture() {
  const data = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))
  const first = data.recurringLessons.find((item) => item.id === 'c1')!
  const otherId = 'teacher-b'
  data.timetables.push({ id: otherId, projectId: first.projectId, name: 'B 課表', teacherName: '林老師' })
  data.recurringLessons.push({ ...first, id: 'b1', seriesId: 'b1', timetableId: otherId })
  return data
}

describe('v6 timetable isolation', () => {
  it('resolves the same slot independently, including conflicts, Dashboard, and archived history', () => {
    const data = fixture()
    const a = data.timetables[0].id
    expect(day(data, a).some((item) => item.id === 'b1')).toBe(false)
    expect(day(data, 'teacher-b')).toMatchObject([{ id: 'b1', timetableId: 'teacher-b', hasConflict: false }])
    expect(day(data, a).find((item) => item.id === 'c1')?.hasConflict).toBe(false)
    expect(getTodayTeachingSummaryV4(data, data.projects[0].id, new Date(2026, 8, 7, 8, 20), 'teacher-b')).toMatchObject({ count: 1, lesson: { id: 'b1' } })
    expect(() => resolveProjectDay(data, data.projects[0].id, monday)).toThrow('Multiple or missing timetables')
    const archived = { ...data, projects: data.projects.map((item) => ({ ...item, archivedAt: '2027-02-01T00:00:00.000Z' })) }
    expect(day(archived, 'teacher-b').map((item) => item.id)).toEqual(['b1'])
  })

  it('applies cancel, replacement, and unassigned overrides only to the selected timetable', () => {
    const data = fixture()
    const cancelled = cancelLessonOnDate(data, 'b1', '2026-09-07', () => 'b-cancel', 'teacher-b')
    expect(day(cancelled, 'teacher-b')[0].status).toBe('cancelled')
    expect(day(cancelled, data.timetables[0].id).find((item) => item.id === 'c1')?.status).toBe('regular')
    const replaced = replaceLessonOnDate(data, 'b1', '2026-09-07', { subjectId: 'history', classId: data.recurringLessons.find((item) => item.id === 'b1')!.classId }, () => 'b-replace', undefined, 'teacher-b')
    expect(day(replaced, 'teacher-b')[0]).toMatchObject({ status: 'replaced', subjectId: 'history' })
    expect(day(replaced, data.timetables[0].id).find((item) => item.id === 'c1')?.subjectId).toBe('chinese')
    replaced.overrides.push({ id: 'orphan', projectId: null, timetableId: null, teachingUnitId: null, date: '2026-09-07', periodId: 1, action: 'cancel' })
    expect(day(replaced, 'teacher-b')[0].status).toBe('replaced')
    expect(isCompatibleAppDataV6(replaced)).toBe(true)
  })

  it('limits fallback slot matching and drag collision detection to one timetable', () => {
    const data = fixture()
    data.overrides.push({ id: 'fallback-b', projectId: data.projects[0].id, timetableId: 'teacher-b', teachingUnitId: data.recurringLessons.find((item) => item.id === 'b1')!.teachingUnitId,
      date: '2026-09-07', periodId: 1, action: 'cancel' })
    expect(day(data, 'teacher-b')[0].status).toBe('cancelled')
    expect(day(data, data.timetables[0].id).find((item) => item.id === 'c1')?.status).toBe('regular')
    data.overrides = []
    const source = day(data, 'teacher-b')[0]
    const target = { date: '2026-09-08', startTime: '09:10', endTime: '10:00', timetableId: 'teacher-b' }
    const intent = createLessonDragIntent(data, source, target)
    expect(intent.valid && intent.intent).toMatchObject({ timetableId: 'teacher-b', conflictLessonIds: [] })
    expect(createLessonDragIntent(data, source, { ...target, timetableId: data.timetables[0].id })).toMatchObject({ valid: false })
    expect(moveLessonOnDate(data, 'b1', '2026-09-07', { date: target.date, periodId: 2 }, false, () => 'b-move', 'teacher-b').overrides[0].timetableId).toBe('teacher-b')
  })

  it('rejects cross-timetable changes, original IDs, swaps, and grouped revocation', () => {
    const data = fixture()
    const a = data.timetables[0].id
    expect(() => cancelLessonOnDate(data, 'c1', '2026-09-07', () => 'bad', 'teacher-b')).toThrow('selected timetable')
    expect(() => swapLessonOccurrences(data, 'c1', '2026-09-07', 'b1', '2026-09-07', () => 'bad', a)).toThrow('selected timetable')
    expect(() => permanentlySwapLessons(data, 'c1', 'b1', '2026-09-07', () => 'bad', a)).toThrow('selected timetable')
    const cross = { ...data, overrides: [{ id: 'bad', projectId: data.projects[0].id, timetableId: 'teacher-b', teachingUnitId: data.recurringLessons[0].teachingUnitId,
      date: '2026-09-07', periodId: 1, action: 'cancel' as const, originalLessonId: 'c1' }] }
    expect(isCompatibleAppDataV6(cross)).toBe(false)
    const grouped = { ...data, overrides: [
      { id: 'a', groupId: 'swap', projectId: data.projects[0].id, timetableId: a, teachingUnitId: data.recurringLessons[0].teachingUnitId, date: '2026-09-07', periodId: 1, action: 'cancel' as const, originalLessonId: 'c1' },
      { id: 'b', groupId: 'swap', projectId: data.projects[0].id, timetableId: 'teacher-b', teachingUnitId: data.recurringLessons[0].teachingUnitId, date: '2026-09-07', periodId: 1, action: 'cancel' as const, originalLessonId: 'b1' },
    ] }
    expect(() => revokeLessonOverride(grouped, 'a', a)).toThrow('timetable boundaries')
  })

  it('writes fixed lessons and permanent versions only in the selected timetable', () => {
    const data = fixture()
    const b = data.recurringLessons.find((item) => item.id === 'b1')!
    const schoolId = data.teachingUnits.find((item) => item.id === b.teachingUnitId)!.schoolId
    const draft = { projectId: b.projectId, timetableId: 'teacher-b', schoolId, teachingUnitId: b.teachingUnitId,
      subjectId: b.subjectId, classId: b.classId, day: 5 as const, periodId: 8, weekPattern: 'every' as const }
    expect(() => addLessonV4(data, { ...draft, timetableId: undefined }, () => 'bad')).toThrow('Multiple or missing timetables')
    const added = addLessonV4(data, draft, () => 'b-new')
    expect(added.recurringLessons.find((item) => item.id === 'b-new')?.timetableId).toBe('teacher-b')
    expect(() => updateLessonV4(added, 'b-new', { ...draft, timetableId: data.timetables[0].id })).toThrow('selected timetable')
    expect(updateLessonV4(added, 'b-new', { ...draft, room: 'B 室' }).recurringLessons.find((item) => item.id === 'b-new')?.room).toBe('B 室')
    expect(deleteLessonV4(added, 'b-new', 'teacher-b').recurringLessons.some((item) => item.id === 'b-new')).toBe(false)
    const permanent = permanentlyUpdateLesson(data, 'b1', '2026-09-14', { ...draft, day: 1, periodId: 1 }, () => 'b-version')
    expect(permanent.recurringLessons.find((item) => item.id === 'b-version')).toMatchObject({ timetableId: 'teacher-b', seriesId: 'b1' })
    expect(permanent.recurringLessons.find((item) => item.id === 'c1')?.effectiveEnd).toBe(data.recurringLessons.find((item) => item.id === 'c1')?.effectiveEnd)
  })

  it('allows a new lesson at another teacher’s occupied time and reads each version in its own history', () => {
    const data = fixture()
    const a = data.timetables[0].id
    const c2 = data.recurringLessons.find((item) => item.id === 'c2')!
    const schoolId = data.teachingUnits.find((item) => item.id === c2.teachingUnitId)!.schoolId
    const draft = { projectId: c2.projectId, timetableId: 'teacher-b', schoolId, teachingUnitId: c2.teachingUnitId,
      subjectId: c2.subjectId, classId: c2.classId, day: c2.day, periodId: c2.periodId, weekPattern: c2.weekPattern }
    const added = addLessonV4(data, draft, () => 'b2')
    expect(day(added, 'teacher-b').map((item) => item.id)).toContain('b2')
    expect(day(added, a).map((item) => item.id)).toContain('c2')
    const changed = permanentlyUpdateLesson(added, 'b1', '2026-09-14', { ...draft, day: 1, periodId: 1, subjectId: 'history' }, () => 'b1-v2')
    expect(resolveProjectDay(changed, c2.projectId, new Date(2026, 8, 7), { timetableId: 'teacher-b' }).some((item) => item.id === 'b1')).toBe(true)
    expect(resolveProjectDay(changed, c2.projectId, new Date(2026, 8, 14), { timetableId: 'teacher-b' }).some((item) => item.id === 'b1-v2')).toBe(true)
    expect(resolveProjectDay(changed, c2.projectId, new Date(2026, 8, 14), { timetableId: a }).some((item) => item.id === 'b1-v2')).toBe(false)
  })

  it('keeps shared events visible while legacy writes and copies reject a multi-timetable project', () => {
    const data = fixture()
    data.events.push({ id: 'event-1', projectId: data.projects[0].id, teachingUnitId: null, title: '共同會議', type: 'meeting', date: '2026-09-07', startTime: '12:00', endTime: '13:00', color: '#A66D52', origin: 'user' })
    const viewA = projectToLegacyView(data, data.projects[0].id, data.timetables[0].id)
    const viewB = projectToLegacyView(data, data.projects[0].id, 'teacher-b')
    expect(viewA.events.map((item) => item.id)).toEqual(['event-1'])
    expect(viewB.events.map((item) => item.id)).toEqual(['event-1'])
    expect(viewA.courses.some((item) => item.id === 'b1')).toBe(false)
    expect(viewB.courses.map((item) => item.id)).toEqual(['b1'])
    expect(() => projectToLegacyView(data, data.projects[0].id, 'missing')).toThrow('Timetable does not belong')
    expect(() => mergeProjectView(data, data.projects[0].id, viewA)).toThrow('Multiple or missing timetables')
    const unit = data.teachingUnits[0]
    expect(() => copyProject(data, { sourceProjectId: data.projects[0].id, name: '下一學期', academicYear: 116, semester: 'first',
      units: [{ sourceUnitId: unit.id, startDate: '2027-08-30', endDate: '2028-01-19', anchorDate: '2027-08-30', anchorPattern: 'A' }] }, () => 'bad')).toThrow('Multiple or missing timetables')
  })
})

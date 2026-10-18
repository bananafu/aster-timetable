import { describe, expect, it } from 'vitest'
import { initialData } from '../seed'
import { migrateV3ToV4 } from '../migrationsV4'
import { migrateV4ToV5 } from '../migrationsV5'
import { migrateV5ToV6 } from '../migrationsV6'
import { migrateV6ToV7 } from '../migrationsV7'
import type { AppDataV7, OneOffLesson } from '../../types'
import { isCompatibleAppDataV7, isSafeAppDataV7Update } from './v7'

const base = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
const oneOff = (data: AppDataV7): OneOffLesson => ({
  id: 'one-off-1', projectId: data.projects[0].id, timetableId: data.timetables[0].id,
  teachingUnitId: data.teachingUnits[0].id, classId: data.classes[0].id,
  subjectId: data.subjects[0].id, date: '2026-09-06', purpose: 'extra',
  time: { mode: 'custom', startTime: '09:30', endTime: '11:00' },
})
const withOneOff = () => { const data = base(); data.oneOffLessons.push(oneOff(data)); return data }

describe('AppData v7 one-off validation', () => {
  it('allows a v7 project with no timetable and still rejects each orphaned lesson type', () => {
    const data = base()
    const empty = { ...data, timetables: [], recurringLessons: [], overrides: [], oneOffLessons: [] }
    expect(isCompatibleAppDataV7(empty)).toBe(true)
    expect(isSafeAppDataV7Update(data, empty)).toBe(true)
    expect(isCompatibleAppDataV7({ ...empty, recurringLessons: data.recurringLessons })).toBe(false)
    const lesson = data.recurringLessons[0]
    const override = { id: 'orphan-override', projectId: lesson.projectId, timetableId: lesson.timetableId,
      teachingUnitId: lesson.teachingUnitId, date: '2026-09-07', periodId: lesson.periodId,
      action: 'cancel' as const, originalLessonId: lesson.id }
    expect(isCompatibleAppDataV7({ ...empty, overrides: [override] })).toBe(false)
    expect(isCompatibleAppDataV7({ ...empty, oneOffLessons: [oneOff(data)] })).toBe(false)
  })

  it('permits an empty project beside a normal project without weakening timetable scope', () => {
    const data = base()
    const secondProject = { ...data.projects[0], id: 'empty-project', name: '空專案' }
    const mixed = { ...data, projects: [...data.projects, secondProject] }
    expect(isCompatibleAppDataV7(mixed)).toBe(true)
    expect(isCompatibleAppDataV7({ ...mixed, recurringLessons: [
      ...mixed.recurringLessons, { ...mixed.recurringLessons[0], id: 'cross-project-lesson', seriesId: 'cross-project-lesson', projectId: secondProject.id },
    ] })).toBe(false)
    expect(isCompatibleAppDataV7({ ...mixed, timetables: [
      ...mixed.timetables, { ...mixed.timetables[0], id: 'invalid-owner', projectId: 'missing-project' },
    ] })).toBe(false)
  })

  it('requires the v7 collection even when no one-off lessons exist', () => {
    const data = base()
    expect(isCompatibleAppDataV7(data)).toBe(true)
    expect(isCompatibleAppDataV7({ ...data, oneOffLessons: undefined })).toBe(false)
    expect(isCompatibleAppDataV7({ ...data, schemaVersion: 6 })).toBe(false)
  })

  it('accepts a Sunday custom lesson and a period-based make-up lesson', () => {
    const data = withOneOff()
    data.oneOffLessons.push({ ...oneOff(data), id: 'one-off-2', purpose: 'make-up',
      relatedRecurringLessonId: data.recurringLessons[0].id, time: { mode: 'period', periodId: data.teachingUnits[0].periods[0].id } })
    expect(isCompatibleAppDataV7(data)).toBe(true)
    data.recurringLessons = data.recurringLessons.filter((item) => item.id !== data.oneOffLessons[1].relatedRecurringLessonId)
    // The source link is informational and survives deletion of the original lesson.
    expect(isCompatibleAppDataV7(data)).toBe(true)
  })

  it.each([
    ['09:32', '11:00'], ['24:00', '11:00'], ['11:00', '09:30'], ['09:30', '09:30'], ['09:30', '24:00'],
  ])('rejects invalid custom time %s–%s', (startTime, endTime) => {
    const data = withOneOff()
    data.oneOffLessons[0].time = { mode: 'custom', startTime, endTime }
    expect(isCompatibleAppDataV7(data)).toBe(false)
  })

  it('rejects mixed or incomplete time discriminants and unknown one-off fields', () => {
    const data = withOneOff()
    const mutate = (time: unknown) => ({ ...data, oneOffLessons: [{ ...data.oneOffLessons[0], time }] })
    expect(isCompatibleAppDataV7(mutate({ mode: 'period', periodId: 1, startTime: '09:30' }))).toBe(false)
    expect(isCompatibleAppDataV7(mutate({ mode: 'custom', startTime: '09:30', endTime: '11:00', periodId: 1 }))).toBe(false)
    expect(isCompatibleAppDataV7(mutate({ mode: 'custom', startTime: '09:30' }))).toBe(false)
    expect(isCompatibleAppDataV7({ ...data, oneOffLessons: [{ ...data.oneOffLessons[0], recurring: true }] })).toBe(false)
    expect(isCompatibleAppDataV7(mutate({ mode: 'period', periodId: 999 }))).toBe(false)
  })

  it('rejects invalid dates, out-of-term dates, duplicate and reused IDs', () => {
    const data = withOneOff()
    for (const date of ['2026-02-30', '2026-08-30', '2027-01-21', '2026-09-06T00:00:00Z']) {
      expect(isCompatibleAppDataV7({ ...data, oneOffLessons: [{ ...data.oneOffLessons[0], date }] })).toBe(false)
    }
    expect(isCompatibleAppDataV7({ ...data, oneOffLessons: [data.oneOffLessons[0], { ...data.oneOffLessons[0] }] })).toBe(false)
    expect(isCompatibleAppDataV7({ ...data, oneOffLessons: [{ ...data.oneOffLessons[0], id: data.recurringLessons[0].id }] })).toBe(false)
    expect(isCompatibleAppDataV7({ ...data, oneOffLessons: [{ ...data.oneOffLessons[0], id: data.recurringLessons[0].seriesId }] })).toBe(false)
  })

  it('enforces project, timetable, unit, class, subject and purpose scope', () => {
    const data = withOneOff()
    const lesson = data.oneOffLessons[0]
    for (const field of ['projectId', 'timetableId', 'teachingUnitId', 'classId', 'subjectId'] as const) {
      expect(isCompatibleAppDataV7({ ...data, oneOffLessons: [{ ...lesson, [field]: 'missing' }] })).toBe(false)
    }
    expect(isCompatibleAppDataV7({ ...data, oneOffLessons: [{ ...lesson, purpose: 'replacement' }] })).toBe(false)
    expect(isCompatibleAppDataV7({ ...data, oneOffLessons: [{ ...lesson, relatedRecurringLessonId: 'x' }] })).toBe(false)
    expect(isCompatibleAppDataV7({ ...data, oneOffLessons: [{ ...lesson, purpose: 'make-up', relatedRecurringLessonId: '' }] })).toBe(false)
    expect(isCompatibleAppDataV7({ ...data, oneOffLessons: [{ ...lesson, purpose: 'make-up', relatedRecurringLessonId: 'deleted-original' }] })).toBe(true)
    const otherLevel = { ...data.subjects[0], applicableSchoolLevels: ['junior-high' as const] }
    expect(isCompatibleAppDataV7({ ...data, subjects: [otherLevel, ...data.subjects.slice(1)] })).toBe(false)
    const secondProjectId = 'project-2'
    const crossProject = {
      ...data,
      projects: [...data.projects, { ...data.projects[0], id: secondProjectId, name: '第二專案' }],
      timetables: [...data.timetables, { ...data.timetables[0], id: 'timetable-2', projectId: secondProjectId }],
      oneOffLessons: [{ ...lesson, timetableId: 'timetable-2' }],
    }
    expect(isCompatibleAppDataV7(crossProject)).toBe(false)
  })

  it('does not allow edits to an archived project’s one-offs through safe-update', () => {
    const data = withOneOff()
    const archived = { ...data, projects: data.projects.map((project) => ({ ...project, archivedAt: '2026-10-01T00:00:00.000Z' })), activeProjectId: null }
    expect(isCompatibleAppDataV7(archived)).toBe(true)
    expect(isSafeAppDataV7Update(archived, { ...archived, oneOffLessons: [] })).toBe(false)
    expect(isSafeAppDataV7Update(archived, archived)).toBe(true)
  })
})

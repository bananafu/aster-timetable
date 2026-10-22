import { describe, expect, it } from 'vitest'
import type { AppDataV7 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8, migrateV7ToV8WithReport, V8MigrationError } from './migrationsV8'
import { preflightV7ToV8, reconcileV7ToV8 } from './migrationPreflightV8'
import { createBlankProject } from './projectRuntime'

const source = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))

function withoutProjects(keepSubjects: boolean): AppDataV7 {
  const data = source()
  return {
    ...data,
    activeProjectId: null,
    projects: [],
    timetables: [],
    schools: [],
    teachingUnits: [],
    subjects: keepSubjects ? data.subjects : [],
    classes: [],
    recurringLessons: [],
    events: [],
    overrides: [],
    oneOffLessons: [],
    migrationWarnings: [],
  }
}

function withSecondProject(data: AppDataV7): AppDataV7 {
  const ids = ['project-2', 'school-2', 'unit-2', 'timetable-2']
  return createBlankProject(data, {
    name: 'Second', teacherName: 'Teacher', academicYear: 116, semester: 'first',
    startDate: '2027-08-30', endDate: '2028-01-19',
  }, () => ids.shift()!, '2027-08-01T00:00:00.000Z') as AppDataV7
}

describe('V7 to V8 migration preflight and reconciliation', () => {
  it('allows an empty document with zero Projects and zero Subjects', () => {
    const data = withoutProjects(false)
    const report = preflightV7ToV8(data)

    expect(report.canMigrate).toBe(true)
    expect(report.counts).toMatchObject({ projects: 0, subjects: 0, expectedV8Subjects: 0 })
    expect(migrateV7ToV8(data).subjects).toEqual([])
  })

  it('blocks legacy Subjects without a Project and leaves the source unchanged', () => {
    const data = withoutProjects(true)
    const snapshot = JSON.stringify(data)
    const report = preflightV7ToV8(data)

    expect(report.canMigrate).toBe(false)
    expect(report.issues).toContainEqual(expect.objectContaining({
      severity: 'blocking', code: 'zero-project-subjects', entityIds: data.subjects.map((subject) => subject.id),
    }))
    expect(() => migrateV7ToV8(data)).toThrow(V8MigrationError)
    expect(JSON.stringify(data)).toBe(snapshot)
  })

  it('reports one- and multi-Project Subject mapping counts without one-to-one assumptions', () => {
    const one = source()
    const two = withSecondProject(one)

    expect(preflightV7ToV8(one).counts.expectedV8Subjects).toBe(one.subjects.length)
    expect(preflightV7ToV8(two).counts.expectedV8Subjects).toBe(two.subjects.length * 2)
    expect(migrateV7ToV8WithReport(two).reconciliation.isReconciled).toBe(true)
  })

  it('does not treat one cross-school-level Subject definition as a normalized-name conflict', () => {
    const data = source()
    data.subjects[0] = { ...data.subjects[0], applicableSchoolLevels: ['junior-high', 'senior-high'] }

    expect(preflightV7ToV8(data).issues.some((item) => item.code === 'subject-name-conflict')).toBe(false)
  })

  it('reports distinct normalized Subject IDs as blocking', () => {
    const data = source()
    const original = data.subjects[0]
    data.subjects.push({ ...original, id: 'duplicate-subject' })

    const report = preflightV7ToV8(data)
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'blocking', code: 'subject-name-conflict' }))
  })

  it('blocks replacement Overrides whose Project or TeachingUnit ownership is unknown', () => {
    const data = source()
    const lesson = data.recurringLessons[0]
    data.overrides.push({
      id: 'unassigned-project', projectId: null, timetableId: null, teachingUnitId: null,
      date: lesson.effectiveStart, periodId: lesson.periodId, action: 'replace',
      replacement: { subjectId: lesson.subjectId, classId: lesson.classId },
    })
    data.overrides.push({
      id: 'unassigned-unit', projectId: lesson.projectId, timetableId: lesson.timetableId,
      teachingUnitId: null, date: lesson.effectiveStart, periodId: lesson.periodId, action: 'replace',
      replacement: { subjectId: lesson.subjectId, classId: lesson.classId },
    })

    const report = preflightV7ToV8(data)
    expect(report.issues.map((item) => item.code)).toEqual(expect.arrayContaining([
      'unassigned-subject-reference', 'unassigned-teaching-unit-subject-reference',
    ]))
  })

  it('classifies unresolved Events as review and preserves their IDs and content', () => {
    const data = source()
    data.events = [{
      id: 'event-needs-repair', projectId: null, teachingUnitId: null, title: 'Needs repair',
      type: 'meeting', date: '2026-01-01', startTime: '09:00', endTime: '10:00',
      notes: 'Keep this content', color: '#123456',
    }]

    const report = preflightV7ToV8(data)
    expect(report.canMigrate).toBe(true)
    expect(report.counts.unresolvedEvents).toBe(1)
    expect(report.issues).toContainEqual(expect.objectContaining({ severity: 'review', code: 'unresolved-events' }))
    const migrated = migrateV7ToV8(data)
    expect(migrated.events[0]).toMatchObject({
      id: 'event-needs-repair', title: 'Needs repair', notes: 'Keep this content', ownershipStatus: 'unresolved',
    })
    expect(reconcileV7ToV8(data, migrated).isReconciled).toBe(true)
  })

  it('reconciles lesson references and blocks an unexplained post-migration loss', () => {
    const data = source()
    const migrated = migrateV7ToV8(data)
    expect(reconcileV7ToV8(data, migrated)).toEqual({ isReconciled: true, issues: [] })

    const damaged = { ...migrated, recurringLessons: migrated.recurringLessons.slice(1) }
    const report = reconcileV7ToV8(data, damaged)
    expect(report.isReconciled).toBe(false)
    expect(report.issues.some((item) => item.severity === 'blocking')).toBe(true)
  })

  it('has no side effects when preflight is repeated', () => {
    const data = source()
    const snapshot = structuredClone(data)

    expect(preflightV7ToV8(data)).toEqual(preflightV7ToV8(data))
    expect(data).toEqual(snapshot)
  })
})

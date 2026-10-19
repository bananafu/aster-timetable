import { describe, expect, it } from 'vitest'
import type { AppDataV7, SchoolLevel } from '../../types'
import { initialData } from '../seed'
import { migrateV3ToV4 } from '../migrationsV4'
import { migrateV4ToV5 } from '../migrationsV5'
import { migrateV5ToV6 } from '../migrationsV6'
import { migrateV6ToV7 } from '../migrationsV7'
import { analyzeSubjectReferences, deleteSubject, updateSubject } from '../subjectsV5'
import { isCompatibleAppDataV7, isSafeAppDataV7Update } from './v7'

function base(): AppDataV7 {
  const data = migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
  data.recurringLessons = [data.recurringLessons[0]]
  data.teachingUnits[0].schoolLevel = 'junior-high'
  return data
}

function withReference(kind: 'recurring' | 'replacement' | 'unassigned' | 'one-off'): AppDataV7 {
  const data = base()
  const lesson = data.recurringLessons[0]
  if (kind !== 'recurring') data.recurringLessons = []
  if (kind === 'replacement' || kind === 'unassigned') data.overrides.push({
    id: 'replacement', projectId: kind === 'unassigned' ? null : lesson.projectId,
    timetableId: kind === 'unassigned' ? null : lesson.timetableId,
    teachingUnitId: kind === 'unassigned' ? null : lesson.teachingUnitId,
    date: '2026-09-07', periodId: lesson.periodId, action: 'replace',
    replacement: { subjectId: lesson.subjectId, classId: lesson.classId },
  })
  if (kind === 'one-off') data.oneOffLessons.push({
    id: 'one-off', projectId: lesson.projectId, timetableId: lesson.timetableId,
    teachingUnitId: lesson.teachingUnitId, classId: lesson.classId, subjectId: lesson.subjectId,
    date: '2026-09-06', purpose: 'extra', time: { mode: 'custom', startTime: '09:30', endTime: '10:00' },
  })
  expect(isCompatibleAppDataV7(data)).toBe(true)
  return data
}

function shrink(data: AppDataV7, levels: SchoolLevel[] = ['senior-high', 'other']): AppDataV7 {
  return { ...data, subjects: data.subjects.map((subject, index) => index === 0
    ? { ...subject, applicableSchoolLevels: levels } : subject) }
}

describe('v7 subject reference update safety', () => {
  it.each(['recurring', 'replacement', 'unassigned', 'one-off'] as const)(
    'blocks shrinking and deleting a subject referenced by %s, just like the API', (kind) => {
      const data = withReference(kind)
      const next = shrink(data)
      const subject = data.subjects[0]
      expect(() => updateSubject(data, subject.id, next.subjects[0], true)).toThrow()
      expect(() => deleteSubject(data, subject.id, true)).toThrow()
      expect(isSafeAppDataV7Update(data, next)).toBe(false)
      const deleted = { ...data, subjects: data.subjects.slice(1) }
      expect(isSafeAppDataV7Update(data, deleted)).toBe(false)
      // These were compatible documents that the old write validator accepted.
      if (kind !== 'one-off') expect(isCompatibleAppDataV7(next)).toBe(true)
      if (kind === 'unassigned') expect(isCompatibleAppDataV7(deleted)).toBe(true)
    },
  )

  it.each(['historical', 'future', 'archived', 'other-project', 'other-timetable'] as const)(
    'protects references outside the current visible schedule: %s', (scope) => {
      const data = base()
      const lesson = data.recurringLessons[0]
      if (scope === 'historical') {
        lesson.effectiveEnd = '2026-09-13'
        data.recurringLessons.push({ ...lesson, id: 'later-version', subjectId: data.subjects[1].id,
          effectiveStart: '2026-09-14', effectiveEnd: '2027-01-20' })
        expect(analyzeSubjectReferences(data, lesson.subjectId)[0].historical).toBe(true)
      }
      if (scope === 'future') lesson.effectiveStart = '2027-01-04'
      if (scope === 'archived') {
        data.projects[0].archivedAt = '2027-02-01T00:00:00.000Z'
        data.activeProjectId = null
      }
      if (scope === 'other-project') {
        const projectId = 'other-project'
        data.projects.push({ ...data.projects[0], id: projectId })
        data.schools[0].projectId = projectId
        data.teachingUnits[0].projectId = projectId
        data.classes.forEach((schoolClass) => { schoolClass.projectId = projectId })
        data.timetables[0].projectId = projectId
        lesson.projectId = projectId
      }
      if (scope === 'other-timetable') {
        data.timetables.push({ ...data.timetables[0], id: 'other-timetable' })
        lesson.timetableId = 'other-timetable'
      }
      expect(isCompatibleAppDataV7(data)).toBe(true)
      expect(isCompatibleAppDataV7(shrink(data))).toBe(true)
      expect(isSafeAppDataV7Update(data, shrink(data))).toBe(false)
    },
  )

  it.each(['recurring', 'replacement', 'one-off'] as const)(
    'allows removing an unused level when the %s reference belongs to a retained level', (kind) => {
      const data = withReference(kind)
      expect(isSafeAppDataV7Update(data, shrink(data, ['junior-high']))).toBe(true)
    },
  )

  it.each(['replacement', 'one-off'] as const)('protects %s references in another archived project and timetable', (kind) => {
    const data = withReference(kind)
    data.projects[0].archivedAt = '2027-02-01T00:00:00.000Z'
    data.projects.push({ ...data.projects[0], id: 'active-project', archivedAt: undefined })
    data.timetables.push({ ...data.timetables[0], id: 'active-timetable', projectId: 'active-project' })
    data.activeProjectId = 'active-project'
    expect(isCompatibleAppDataV7(data)).toBe(true)
    expect(analyzeSubjectReferences(data, data.subjects[0].id)).toMatchObject([{ archived: true }])
    expect(isSafeAppDataV7Update(data, shrink(data))).toBe(false)
    expect(isSafeAppDataV7Update(data, { ...data, subjects: data.subjects.slice(1) })).toBe(false)
  })

  it('blocks any level removal for an unknown reference, but allows expansion', () => {
    const data = withReference('unassigned')
    expect(isSafeAppDataV7Update(data, shrink(data, ['junior-high', 'other']))).toBe(false)
    const limited = shrink(data, ['junior-high'])
    expect(isCompatibleAppDataV7(limited)).toBe(true)
    expect(isSafeAppDataV7Update(limited, data)).toBe(true)
  })

  it('does not erase existing legacy applicability anomalies on unrelated writes', () => {
    const data = shrink(withReference('recurring'))
    expect(isCompatibleAppDataV7(data)).toBe(true)
    const next = structuredClone(data)
    next.recurringLessons[0].room = 'New room'
    expect(isSafeAppDataV7Update(data, next)).toBe(true)
  })

  it('checks both snapshots so batch reference edits cannot bypass removal protection', () => {
    const data = withReference('unassigned')
    expect(isSafeAppDataV7Update(data, { ...shrink(data), overrides: [] })).toBe(false)
    expect(isSafeAppDataV7Update(data, { ...data, subjects: data.subjects.slice(1), overrides: [] })).toBe(false)
    const unreferenced = { ...data, overrides: [] }
    expect(isSafeAppDataV7Update(unreferenced, shrink(data))).toBe(false)
    expect(isSafeAppDataV7Update(unreferenced, { ...data, subjects: data.subjects.slice(1) })).toBe(false)
    // Removing references first is safe; subsequent deletion has no references.
    expect(isSafeAppDataV7Update(data, unreferenced)).toBe(true)
    expect(isSafeAppDataV7Update(unreferenced, { ...unreferenced, subjects: data.subjects.slice(1) })).toBe(true)
  })

  it('does not hide a used level by changing the teaching unit in the same update', () => {
    const data = base()
    const next = structuredClone(shrink(data))
    next.teachingUnits[0].schoolLevel = 'senior-high'
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(data, next)).toBe(false)
  })

  it('preserves the existing nonempty-level rule and permits unreferenced changes', () => {
    const data = { ...base(), recurringLessons: [] }
    expect(isSafeAppDataV7Update(data, shrink(data))).toBe(true)
    expect(isSafeAppDataV7Update(data, { ...data, subjects: data.subjects.slice(1) })).toBe(true)
    expect(isCompatibleAppDataV7(shrink(data, []))).toBe(false)
  })
})

describe('v7 subject uniqueness update safety', () => {
  it.each(['name', 'shortName'] as const)('rejects new and renamed %s collisions using API normalization', (field) => {
    const data = base()
    data.subjects[0][field] = 'Café'
    const duplicate = { ...data.subjects[1], id: 'new-subject', name: 'New subject', shortName: 'NS', [field]: ' CAFE\u0301 ' }
    const added = { ...data, subjects: [...data.subjects, duplicate] }
    expect(isCompatibleAppDataV7(added)).toBe(true)
    expect(isSafeAppDataV7Update(data, added)).toBe(false)
    const renamed = structuredClone(data)
    renamed.subjects[1][field] = duplicate[field]
    expect(isCompatibleAppDataV7(renamed)).toBe(true)
    expect(isSafeAppDataV7Update(data, renamed)).toBe(false)
  })

  it.each(['name', 'shortName'] as const)('rejects collisions between multiple new or changed %s values', (field) => {
    const data = base()
    const next = structuredClone(data)
    next.subjects[0][field] = 'Shared'
    next.subjects[1][field] = ' shared '
    expect(isSafeAppDataV7Update(data, next)).toBe(false)
    const added = [
      { ...next.subjects[0], id: 'new-a', name: 'A name', shortName: 'A', [field]: 'Shared' },
      { ...next.subjects[1], id: 'new-b', name: 'B name', shortName: 'B', [field]: ' shared ' },
    ]
    expect(isSafeAppDataV7Update(data, { ...data, subjects: [...data.subjects, ...added] })).toBe(false)
  })

  it.each(['name', 'shortName'] as const)('validates final %s values, allowing atomic swaps and conflict resolution', (field) => {
    const data = base()
    const swapped = structuredClone(data)
    swapped.subjects[0][field] = data.subjects[1][field]
    swapped.subjects[1][field] = data.subjects[0][field]
    expect(isSafeAppDataV7Update(data, swapped)).toBe(true)
    data.subjects[1][field] = data.subjects[0][field]
    const fixed = structuredClone(data)
    fixed.subjects[1][field] = 'Resolved'
    expect(isSafeAppDataV7Update(data, fixed)).toBe(true)
    const expandedConflict = structuredClone(data)
    expandedConflict.subjects[2][field] = data.subjects[0][field]
    expect(isSafeAppDataV7Update(data, expandedConflict)).toBe(false)
    const movedConflict = structuredClone(data)
    movedConflict.subjects[0][field] = 'New collision'
    movedConflict.subjects[1][field] = 'New collision'
    expect(isSafeAppDataV7Update(data, movedConflict)).toBe(false)
    // Replacing one legacy duplicate with a new ID is a new conflict, even when
    // the count of duplicates stays the same.
    const replacedDuplicate = structuredClone(data)
    replacedDuplicate.subjects[1].id = 'replacement-subject'
    expect(isSafeAppDataV7Update(data, replacedDuplicate)).toBe(false)
  })

  it('keeps legacy duplicates and colors readable and unchanged during unrelated updates', () => {
    const data = base()
    data.subjects[0].name = 'Café'
    data.subjects[0].shortName = 'CF'
    data.subjects[0].color = 'rgb(12, 34, 56)'
    data.subjects[1].name = ' CAFE\u0301 '
    data.subjects[1].shortName = ' cf '
    expect(isCompatibleAppDataV7(data)).toBe(true)
    const raw = JSON.stringify(data)
    const next = structuredClone(data)
    next.projects[0].name = 'Renamed project'
    expect(isSafeAppDataV7Update(data, next)).toBe(true)
    expect(next.subjects).toEqual(data.subjects)
    expect(JSON.stringify(data)).toBe(raw)
    // A formatting-only edit has the same normalized identity, as in the API.
    next.subjects[1].name = 'CAFÉ'
    expect(isSafeAppDataV7Update(data, next)).toBe(true)
    // Changing the other field must not be blocked by an unchanged old collision.
    next.subjects[1].shortName = 'Unique'
    expect(isSafeAppDataV7Update(data, next)).toBe(true)
  })
})

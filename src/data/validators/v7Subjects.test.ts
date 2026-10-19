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

type ScopedReferenceKind = 'recurring' | 'replacement'
const referenceFor = (data: AppDataV7, kind: ScopedReferenceKind) => kind === 'recurring'
  ? data.recurringLessons[0] : data.overrides[0]
const contentFor = (data: AppDataV7, kind: ScopedReferenceKind) => kind === 'recurring'
  ? data.recurringLessons[0] : data.overrides[0].replacement!

function applicabilityData(kind: ScopedReferenceKind) {
  const data = withReference(kind)
  data.subjects[0].applicableSchoolLevels = ['junior-high']
  data.subjects[1].applicableSchoolLevels = ['senior-high']
  return data
}

describe.each(['recurring', 'replacement'] as const)('v7 %s subject applicability updates', (kind) => {
  it('rejects a new inapplicable reference, even when all structural references are valid', () => {
    const current = applicabilityData(kind)
    const next = structuredClone(current)
    contentFor(next, kind).subjectId = next.subjects[1].id
    referenceFor(next, kind).id = 'new-reference'
    if (kind === 'recurring') next.recurringLessons[0].seriesId = 'new-reference'
    current.recurringLessons = []
    current.overrides = []
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
  })

  it('rejects changing an existing reference to an inapplicable subject', () => {
    const current = applicabilityData(kind)
    const next = structuredClone(current)
    contentFor(next, kind).subjectId = next.subjects[1].id
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
  })

  it('rejects a TeachingUnit level change that makes the retained reference inapplicable', () => {
    const current = applicabilityData(kind)
    const next = structuredClone(current)
    next.teachingUnits[0].schoolLevel = 'senior-high'
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
    next.subjects[0].applicableSchoolLevels.push('senior-high')
    expect(isSafeAppDataV7Update(current, next)).toBe(true)
  })

  it.each(['new', 'retained'] as const)('allows a %s reference repaired by subject expansion in the same batch', (mode) => {
    const current = applicabilityData(kind)
    const next = structuredClone(current)
    contentFor(next, kind).subjectId = next.subjects[1].id
    next.subjects[1].applicableSchoolLevels.push('junior-high')
    if (mode === 'new') { current.recurringLessons = []; current.overrides = [] }
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(true)
  })

  it('keeps a legacy anomaly readable and permits unrelated document and room/note edits', () => {
    const current = applicabilityData(kind)
    contentFor(current, kind).subjectId = current.subjects[1].id
    const before = structuredClone(current)
    const next = structuredClone(current)
    next.projects[0].name = 'Renamed project'
    contentFor(next, kind).room = 'New room'
    if (kind === 'replacement') next.overrides[0].note = 'Updated note'
    expect(isCompatibleAppDataV7(current)).toBe(true)
    expect(isSafeAppDataV7Update(current, current)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(true)
    expect(current).toEqual(before)
  })

  it.each(['copy', 'replace-id'] as const)('rejects a legacy anomaly with a new ID: %s', (mode) => {
    const current = applicabilityData(kind)
    contentFor(current, kind).subjectId = current.subjects[1].id
    const next = structuredClone(current)
    if (kind === 'recurring') {
      const copy = { ...next.recurringLessons[0], id: 'copied', seriesId: 'copied' }
      next.recurringLessons = mode === 'copy' ? [...next.recurringLessons, copy] : [copy]
    } else {
      const copy = { ...next.overrides[0], id: 'copied' }
      next.overrides = mode === 'copy' ? [...next.overrides, copy] : [copy]
    }
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
  })

  it('rejects swapping valid and invalid subjects between stable IDs with the same anomaly count', () => {
    const current = applicabilityData(kind)
    if (kind === 'recurring') current.recurringLessons.push({ ...current.recurringLessons[0], id: 'second', seriesId: 'second', subjectId: current.subjects[1].id })
    else current.overrides.push({ ...current.overrides[0], id: 'second', replacement: { ...current.overrides[0].replacement!, subjectId: current.subjects[1].id } })
    const next = structuredClone(current)
    contentFor(next, kind).subjectId = next.subjects[1].id
    if (kind === 'recurring') next.recurringLessons[1].subjectId = next.subjects[0].id
    else next.overrides[1].replacement!.subjectId = next.subjects[0].id
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
  })

  it.each(['unit', 'project', 'timetable', 'level'] as const)('does not grandfather a legacy anomaly after changing its %s scope', (scope) => {
    const current = applicabilityData(kind)
    contentFor(current, kind).subjectId = current.subjects[1].id
    current.timetables.push({ ...current.timetables[0], id: 'other-timetable' })
    current.schools.push({ ...current.schools[0], id: 'other-school' })
    current.teachingUnits.push({ ...current.teachingUnits[0], id: 'other-unit', schoolId: 'other-school' })
    current.classes.push({ ...current.classes[0], id: 'other-class', teachingUnitId: 'other-unit' })
    const next = structuredClone(current)
    const reference = referenceFor(next, kind)
    if (scope === 'unit') {
      reference.teachingUnitId = 'other-unit'
      contentFor(next, kind).classId = 'other-class'
    }
    if (scope === 'timetable') reference.timetableId = 'other-timetable'
    if (scope === 'project') {
      next.projects.push({ ...next.projects[0], id: 'other-project' })
      next.schools[0].projectId = 'other-project'
      next.teachingUnits[0].projectId = 'other-project'
      next.classes.filter((item) => item.teachingUnitId === next.teachingUnits[0].id).forEach((item) => { item.projectId = 'other-project' })
      next.timetables[0].projectId = 'other-project'
      reference.projectId = 'other-project'
    }
    if (scope === 'level') next.teachingUnits[0].schoolLevel = 'other'
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
    next.subjects[1].applicableSchoolLevels.push(scope === 'level' ? 'other' : 'junior-high')
    expect(isSafeAppDataV7Update(current, next)).toBe(true)
  })

  it('allows valid shared-subject references across schools, projects, timetables and archives', () => {
    const current = applicabilityData(kind)
    const next = structuredClone(current)
    const projectId = 'archived-project'
    next.projects.push({ ...next.projects[0], id: projectId, archivedAt: '2027-02-01T00:00:00.000Z' })
    next.schools.push({ ...next.schools[0], id: 'other-school', projectId })
    next.teachingUnits.push({ ...next.teachingUnits[0], id: 'other-unit', schoolId: 'other-school', projectId })
    next.classes.push({ ...next.classes[0], id: 'other-class', teachingUnitId: 'other-unit', projectId })
    next.timetables.push({ ...next.timetables[0], id: 'other-timetable', projectId })
    const scope = { id: 'other-reference', projectId, timetableId: 'other-timetable', teachingUnitId: 'other-unit' }
    if (kind === 'recurring') next.recurringLessons.push({ ...next.recurringLessons[0], ...scope, seriesId: 'other-series', classId: 'other-class' })
    else next.overrides.push({ ...next.overrides[0], ...scope, replacement: { ...next.overrides[0].replacement!, classId: 'other-class' } })
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(true)
    if (kind === 'recurring') next.recurringLessons.at(-1)!.subjectId = next.subjects[1].id
    else next.overrides.at(-1)!.replacement!.subjectId = next.subjects[1].id
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
  })
})

describe('v7 replacement ownership and legacy boundaries', () => {
  it('uses the replacement subject and the override unit, even for a historical original lesson', () => {
    const current = applicabilityData('recurring')
    const original = current.recurringLessons[0]
    original.effectiveEnd = '2026-09-13'
    current.recurringLessons.push({ ...original, id: 'later-version', effectiveStart: '2026-09-14', effectiveEnd: '2027-01-20' })
    const next = structuredClone(current)
    next.overrides.push({ id: 'historical-replacement', projectId: original.projectId, timetableId: original.timetableId,
      teachingUnitId: original.teachingUnitId, originalLessonId: original.id, date: '2026-09-07', periodId: original.periodId,
      action: 'replace', replacement: { subjectId: next.subjects[1].id, classId: original.classId } })
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
    next.subjects[1].applicableSchoolLevels.push('junior-high')
    expect(isSafeAppDataV7Update(current, next)).toBe(true)
  })

  it('checks an inapplicable historical version even when the latest version is valid', () => {
    const current = applicabilityData('recurring')
    const original = current.recurringLessons[0]
    original.effectiveEnd = '2026-09-13'
    current.recurringLessons.push({ ...original, id: 'later-version', effectiveStart: '2026-09-14', effectiveEnd: '2027-01-20' })
    const next = structuredClone(current)
    next.recurringLessons[0].subjectId = next.subjects[1].id
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
  })

  it('preserves an unassigned legacy replacement without inferring a unit from its original lesson', () => {
    const current = withReference('unassigned')
    const lesson = base().recurringLessons[0]
    current.recurringLessons = [lesson]
    current.overrides[0].originalLessonId = lesson.id
    const next = structuredClone(current)
    next.projects[0].name = 'Renamed'
    next.overrides[0].note = 'Legacy note'
    next.overrides[0].replacement!.room = 'New room'
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(true)
    current.overrides = []
    // Even an applicable subject and a resolvable original cannot authorize a new unassigned reference.
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
  })

  it.each(['copy', 'subject', 'class', 'original', 'action'] as const)('rejects changes to an unresolved legacy replacement: %s', (change) => {
    const current = withReference('unassigned')
    const next = structuredClone(current)
    if (change === 'copy') next.overrides[0].id = 'copied-unassigned'
    if (change === 'subject') next.overrides[0].replacement!.subjectId = next.subjects[1].id
    if (change === 'class') next.overrides[0].replacement!.classId = 'another-unknown-class'
    if (change === 'original') next.overrides[0].originalLessonId = 'another-unknown-original'
    if (change === 'action') next.overrides[0].action = 'cancel'
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
  })

  it('allows explicitly assigning a legacy replacement only when the final subject is applicable', () => {
    const current = withReference('unassigned')
    current.subjects[0].applicableSchoolLevels = ['senior-high']
    const next = structuredClone(current)
    Object.assign(next.overrides[0], { projectId: next.projects[0].id, timetableId: next.timetables[0].id, teachingUnitId: next.teachingUnits[0].id })
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
    next.subjects[0].applicableSchoolLevels.push('junior-high')
    expect(isSafeAppDataV7Update(current, next)).toBe(true)
  })

  it('does not borrow grandfather status from a recurring reference with the same ID', () => {
    const current = applicabilityData('recurring')
    const lesson = current.recurringLessons[0]
    lesson.subjectId = current.subjects[1].id
    const next = structuredClone(current)
    next.recurringLessons = []
    next.overrides.push({ id: lesson.id, projectId: lesson.projectId, timetableId: lesson.timetableId,
      teachingUnitId: lesson.teachingUnitId, date: '2026-09-07', periodId: lesson.periodId,
      action: 'replace', replacement: { subjectId: lesson.subjectId, classId: lesson.classId } })
    expect(isCompatibleAppDataV7(next)).toBe(true)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
  })
})

describe('v7 one-off applicability stays strict', () => {
  it('rejects an existing inapplicable one-off even on unrelated writes', () => {
    const current = withReference('one-off')
    current.subjects[0].applicableSchoolLevels = ['senior-high']
    const next = structuredClone(current)
    next.projects[0].name = 'Renamed'
    expect(isCompatibleAppDataV7(current)).toBe(false)
    expect(isSafeAppDataV7Update(current, next)).toBe(false)
  })

  it('rejects invalid one-off subject and unit changes, allowing a same-batch applicability repair', () => {
    const current = withReference('one-off')
    current.subjects[0].applicableSchoolLevels = ['junior-high']
    current.subjects[1].applicableSchoolLevels = ['senior-high']
    const changedSubject = structuredClone(current)
    changedSubject.oneOffLessons[0].subjectId = changedSubject.subjects[1].id
    expect(isSafeAppDataV7Update(current, changedSubject)).toBe(false)
    changedSubject.subjects[1].applicableSchoolLevels.push('junior-high')
    expect(isSafeAppDataV7Update(current, changedSubject)).toBe(true)
    const changedUnit = structuredClone(current)
    changedUnit.teachingUnits[0].schoolLevel = 'senior-high'
    expect(isSafeAppDataV7Update(current, changedUnit)).toBe(false)
    changedUnit.subjects[0].applicableSchoolLevels.push('senior-high')
    expect(isSafeAppDataV7Update(current, changedUnit)).toBe(true)
  })
})

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

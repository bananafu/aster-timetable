import { describe, expect, it } from 'vitest'
import { createEmptyAppDataV8 } from './storageV8'
import { createBlankProject } from './projectRuntimeV8'
import { createClassV8, deleteClassV8, getClassV8Impact, updateClassV8, ClassV8Error } from './classesV8'
import { createSubjectForTeachingUnit } from './subjectsV8'
import { isCompatibleAppDataV8 } from './validators/v8'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'

function fixture() {
  let id = 0
  const first = createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115, semester: 'first',
    startDate: '2026-08-01', endDate: '2027-01-31' }, () => `a-${++id}`)
  return createBlankProject(first, { name: 'B', academicYear: 116, semester: 'first',
    startDate: '2027-08-01', endDate: '2028-01-31' }, () => `b-${++id}`)
}
function code(action: () => unknown) {
  try { action(); return null } catch (cause) { return cause instanceof ClassV8Error ? cause.code : 'unexpected' }
}

describe('V8 Project-scoped Class operations', () => {
  it('creates, edits and deletes without a Timetable or Lesson and without touching another Project', () => {
    const base = fixture()
    const [a, b] = base.projects
    const unitA = base.teachingUnits.find((item) => item.projectId === a.id)!
    const unitB = base.teachingUnits.find((item) => item.projectId === b.id)!
    expect(base.classes).toEqual([])
    expect(base.timetables).toEqual([])
    const bClass = createClassV8(base, b.id, { teachingUnitId: unitB.id, name: '同名班級' }, 'class-b')
    const added = createClassV8(bClass, a.id, { teachingUnitId: unitA.id, name: '同名班級' }, 'class-a')
    expect(added.classes).toHaveLength(2)
    expect(added.timetables).toEqual([])
    expect(added.recurringLessons).toEqual([])
    const edited = updateClassV8(added, a.id, 'class-a', { teachingUnitId: unitA.id, name: '新班級', room: '301' })
    expect(edited.classes.find((item) => item.id === 'class-b')).toEqual(bClass.classes[0])
    expect(edited.classes.find((item) => item.id === 'class-a')?.name).toBe('新班級')
    expect(getClassV8Impact(edited, a.id, 'class-a').teachingProgress).toBe(0)
    expect(code(() => deleteClassV8(edited, a.id, 'class-a'))).toBe('confirmation-required')
    const deleted = deleteClassV8(edited, a.id, 'class-a', true)
    expect(deleted.classes).toEqual([bClass.classes[0]])
    expect(isCompatibleAppDataV8(deleted)).toBe(true)
  })

  it('rejects invalid scope, duplicate structured class, referenced class and dangling references', () => {
    const base = fixture()
    const [a, b] = base.projects
    const unitA = base.teachingUnits.find((item) => item.projectId === a.id)!
    const unitB = base.teachingUnits.find((item) => item.projectId === b.id)!
    expect(code(() => createClassV8(base, a.id, { teachingUnitId: unitB.id, name: 'wrong' }, 'wrong'))).toBe('invalid-unit')
    const first = createClassV8(base, a.id, { teachingUnitId: unitA.id, grade: 1, classNumber: 1 }, 'class-a')
    expect(code(() => createClassV8(first, a.id, { teachingUnitId: unitA.id, grade: 1, classNumber: 1 }, 'other'))).toBe('duplicate')
    expect(code(() => updateClassV8(first, b.id, 'class-a', { teachingUnitId: unitB.id, name: 'wrong' }))).toBe('invalid-class')
    const subject = createSubjectForTeachingUnit(first, a.id, unitA.id, { name: '數學', shortName: '數', color: '#123456',
      applicableSchoolLevels: ['senior-high'] }, 'subject-a', 'relation-a')
    const referenced = { ...subject, teachingProgress: [{ id: 'progress-a', projectId: a.id,
      timetableId: 'missing', teachingUnitId: unitA.id, classId: 'class-a', subjectId: 'subject-a',
      content: { chapter: '一', unit: '', note: '' }, previousProgress: null,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }] }
    expect(code(() => deleteClassV8(referenced, a.id, 'class-a', true))).toBe('invalid-data')
    expect(code(() => deleteClassV8(subject, a.id, 'class-a', true))).toBe(null)
    const scheduled = migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))
    const used = scheduled.classes.find((item) => scheduled.recurringLessons.some((lesson) => lesson.classId === item.id))!
    expect(code(() => deleteClassV8(scheduled, used.projectId, used.id, true))).toBe('referenced')
  })
})

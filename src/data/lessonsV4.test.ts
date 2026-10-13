import { describe, expect, it } from 'vitest'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { initialData } from './seed'
import { addLessonV4, deleteLessonV4, updateLessonV4, type LessonDraftV4 } from './lessonsV4'
import { isAppDataV4 } from './validators/v4'

function setup() {
  const data = migrateV3ToV4(structuredClone(initialData))
  const projectId = data.activeProjectId!
  const unit = data.teachingUnits.find((item) => item.projectId === projectId)!
  const school = data.schools.find((item) => item.id === unit.schoolId)!
  const schoolClass = data.classes.find((item) => item.teachingUnitId === unit.id)!
  const draft: LessonDraftV4 = {
    projectId, schoolId: school.id, teachingUnitId: unit.id, subjectId: data.subjects[0].id,
    classId: schoolClass.id, day: 2, periodId: unit.periods[7].id, weekPattern: 'A', room: '專科教室',
  }
  return { data, draft, unit }
}

describe('v4 lesson CRUD', () => {
  it('v5 data layer rejects a subject outside the teaching unit school level', () => {
    const { data: old, draft } = setup()
    const data = migrateV4ToV5(old)
    data.subjects[0].applicableSchoolLevels = ['senior-high']
    expect(() => addLessonV4(data, draft, () => 'bad-level')).toThrow('Subject does not apply')
    data.subjects[0].applicableSchoolLevels = ['other']
    expect(() => addLessonV4(data, draft, () => 'good-level')).not.toThrow()
  })

  it('keeps an existing inapplicable subject when only other lesson fields change', () => {
    const data = migrateV4ToV5(setup().data)
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    const unit = data.teachingUnits.find((item) => item.id === lesson.teachingUnitId)!
    const subject = data.subjects.find((item) => item.id === lesson.subjectId)!
    subject.applicableSchoolLevels = ['junior-high']
    const unchangedChoice = { projectId: lesson.projectId, schoolId: unit.schoolId, teachingUnitId: unit.id,
      subjectId: lesson.subjectId, classId: lesson.classId, day: lesson.day, periodId: lesson.periodId,
      weekPattern: lesson.weekPattern, room: '新教室' }
    expect(updateLessonV4(data, lesson.id, unchangedChoice).recurringLessons.find((item) => item.id === lesson.id)).toMatchObject({ subjectId: subject.id, room: '新教室' })
    const other = data.subjects.find((item) => item.id === 'history')!
    other.applicableSchoolLevels = ['senior-high']
    expect(() => updateLessonV4(data, lesson.id, { ...unchangedChoice, subjectId: other.id })).toThrow('Subject does not apply')
  })
  it('新增課程使用所屬 TeachingUnit 的期間與新 ID', () => {
    const { data, draft, unit } = setup()
    const result = addLessonV4(data, draft, () => 'new-lesson')
    expect(result.recurringLessons.find((item) => item.id === 'new-lesson')).toMatchObject({
      seriesId: 'new-lesson', projectId: draft.projectId, teachingUnitId: draft.teachingUnitId,
      effectiveStart: unit.startDate, effectiveEnd: unit.endDate, origin: 'user',
    })
    expect(isAppDataV4(result)).toBe(true)
  })

  it('拒絕跨校 period、class 與 project 引用', () => {
    const { data, draft, unit } = setup()
    data.schools.push({ id: 'school-2', projectId: draft.projectId, name: '第二校', color: '#563F2E' })
    data.teachingUnits.push({ ...unit, id: 'unit-2', schoolId: 'school-2', periods: [{ id: 99, order: 1, label: '第一節', startTime: '08:00', endTime: '08:50' }] })
    data.classes.push({ id: 'class-2', projectId: draft.projectId, teachingUnitId: 'unit-2', name: '跨校班級' })
    expect(() => addLessonV4(data, { ...draft, periodId: 99 }, () => 'bad-period')).toThrow('Period')
    expect(() => addLessonV4(data, { ...draft, classId: 'class-2' }, () => 'bad-class')).toThrow('Class')
    expect(() => addLessonV4(data, { ...draft, schoolId: 'school-2' }, () => 'bad-school')).toThrow('School')
  })

  it('A 與 B 可共用時段，但 every 或相同週型會衝突', () => {
    const { data, draft } = setup()
    const withA = addLessonV4(data, draft, () => 'lesson-a')
    expect(() => addLessonV4(withA, { ...draft, weekPattern: 'B' }, () => 'lesson-b')).not.toThrow()
    expect(() => addLessonV4(withA, { ...draft, weekPattern: 'A' }, () => 'lesson-a2')).toThrow('conflicting')
    expect(() => addLessonV4(withA, { ...draft, weekPattern: 'every' }, () => 'lesson-every')).toThrow('conflicting')
  })

  it('基本編輯保留 series 與 effective range 並同步科目、班級及教室', () => {
    const { data, draft } = setup()
    const added = addLessonV4(data, draft, () => 'editable')
    const before = added.recurringLessons.find((item) => item.id === 'editable')!
    const updated = updateLessonV4(added, 'editable', { ...draft, subjectId: data.subjects[1].id, room: '更新教室', weekPattern: 'B' })
    expect(updated.recurringLessons.find((item) => item.id === 'editable')).toMatchObject({
      seriesId: before.seriesId, effectiveStart: before.effectiveStart, effectiveEnd: before.effectiveEnd,
      subjectId: data.subjects[1].id, room: '更新教室', weekPattern: 'B',
    })
  })

  it('封存專案不可新增、修改或刪除課程', () => {
    const { data, draft } = setup()
    data.projects = data.projects.map((item) => item.id === draft.projectId ? { ...item, archivedAt: '2027-02-01T00:00:00.000Z' } : item)
    data.activeProjectId = null
    expect(() => addLessonV4(data, draft, () => 'blocked')).toThrow('read-only')
    expect(() => updateLessonV4(data, data.recurringLessons[0].id, { ...draft, day: data.recurringLessons[0].day, periodId: data.recurringLessons[0].periodId })).toThrow('read-only')
    expect(() => deleteLessonV4(data, data.recurringLessons[0].id)).toThrow('read-only')
  })

  it('刪除只移除指定固定課程，且有 override 時阻止刪除', () => {
    const { data, draft } = setup()
    const added = addLessonV4(data, draft, () => 'deletable')
    const deleted = deleteLessonV4(added, 'deletable')
    expect(deleted.recurringLessons.some((item) => item.id === 'deletable')).toBe(false)
    const referenced = { ...added, overrides: [...added.overrides, { id: 'override-new', projectId: draft.projectId, teachingUnitId: draft.teachingUnitId, date: '2026-09-01', periodId: draft.periodId, action: 'cancel' as const, originalLessonId: 'deletable' }] }
    expect(() => deleteLessonV4(referenced, 'deletable')).toThrow('overrides')
  })

  it('已結束的歷史版本不可直接覆寫', () => {
    const { data } = setup()
    const historical = data.recurringLessons.find((item) => item.id === 'c1')!
    historical.effectiveEnd = '2026-09-13'
    data.recurringLessons.push({ ...historical, id: 'c1-v2', effectiveStart: '2026-09-14', effectiveEnd: '2027-01-20' })
    const unit = data.teachingUnits.find((item) => item.id === historical.teachingUnitId)!
    expect(() => updateLessonV4(data, historical.id, {
      projectId: historical.projectId, schoolId: unit.schoolId, teachingUnitId: unit.id,
      subjectId: historical.subjectId, classId: historical.classId, day: historical.day,
      periodId: historical.periodId, weekPattern: historical.weekPattern, room: '不應寫入',
    })).toThrow('Historical')
  })
})

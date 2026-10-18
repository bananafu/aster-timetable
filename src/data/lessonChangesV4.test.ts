import { describe, expect, it } from 'vitest'
import { resolveProjectDay } from '../lib/scheduleV4'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { cancelLessonOnDate, endLessonFromDate, moveLessonOnDate, permanentlySwapLessons, permanentlyUpdateLesson, replaceLessonOnDate, revokeLessonOverride, swapLessonOccurrences, swapLessonsOnDate } from './lessonChangesV4'

const ids = (...values: string[]) => {
  let index = 0
  return () => values[index++] ?? `generated-${index}`
}
const setup = () => migrateV3ToV4(structuredClone(initialData))
const day = (data: ReturnType<typeof setup>, date: string) => resolveProjectDay(data, data.activeProjectId!, new Date(`${date}T12:00:00`))

describe('v4 lesson changes', () => {
  it('v5 replacement and permanent change reject an inapplicable subject without altering existing lessons', () => {
    const data = migrateV4ToV5(setup())
    data.subjects.find((item) => item.id === 'history')!.applicableSchoolLevels = ['senior-high']
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    const unit = data.teachingUnits.find((item) => item.id === lesson.teachingUnitId)!
    const oldSubjectId = lesson.subjectId
    expect(() => replaceLessonOnDate(data, lesson.id, '2026-09-07', { subjectId: 'history', classId: lesson.classId }, ids('bad-replacement'))).toThrow()
    expect(() => permanentlyUpdateLesson(data, lesson.id, '2026-09-14', { projectId: lesson.projectId, schoolId: unit.schoolId, teachingUnitId: unit.id, subjectId: 'history', classId: lesson.classId, day: lesson.day, periodId: lesson.periodId, weekPattern: lesson.weekPattern }, ids('bad-permanent'))).toThrow()
    expect(data.recurringLessons.find((item) => item.id === 'c1')?.subjectId).toBe(oldSubjectId)
  })

  it('allows unchanged legacy subject references when editing other fields, including a replacement override', () => {
    let data = migrateV4ToV5(setup())
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    const unit = data.teachingUnits.find((item) => item.id === lesson.teachingUnitId)!
    data = replaceLessonOnDate(data, lesson.id, '2026-09-07', { subjectId: 'history', classId: lesson.classId }, ids('old-replace')) as typeof data
    data.subjects.find((item) => item.id === 'history')!.applicableSchoolLevels = ['senior-high']
    data.subjects.find((item) => item.id === lesson.subjectId)!.applicableSchoolLevels = ['junior-high']
    const edited = replaceLessonOnDate(data, lesson.id, '2026-09-07', { subjectId: 'history', classId: lesson.classId, room: '新教室' }, ids('new-replace'), 'old-replace')
    expect(edited.overrides).toHaveLength(1)
    expect(edited.overrides[0]).toMatchObject({ id: 'new-replace', replacement: { subjectId: 'history', room: '新教室' } })
    const permanent = permanentlyUpdateLesson(data, lesson.id, '2026-09-14', {
      projectId: lesson.projectId, schoolId: unit.schoolId, teachingUnitId: unit.id,
      subjectId: lesson.subjectId, classId: lesson.classId, day: lesson.day, periodId: lesson.periodId,
      weekPattern: lesson.weekPattern, room: '另一教室',
    }, ids('new-version'))
    expect(permanent.recurringLessons.find((item) => item.id === 'new-version')?.subjectId).toBe(lesson.subjectId)
  })
  it('單日取消只影響指定日期', () => {
    const result = cancelLessonOnDate(setup(), 'c1', '2026-09-07', ids('cancel'))
    expect(day(result, '2026-09-07').find((item) => item.id === 'c1')?.status).toBe('cancelled')
    expect(day(result, '2026-09-14').find((item) => item.id === 'c1')?.status).toBe('regular')
  })

  it('單日移動使原位置留白、目標只顯示一次且重新載入結果一致', () => {
    const result = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-07', periodId: 8 }, false, ids('move'))
    const lessons = day(JSON.parse(JSON.stringify(result)), '2026-09-07').filter((item) => item.id === 'c1')
    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toMatchObject({ status: 'moved', periodId: 8 })
    expect(day(result, '2026-09-14').find((item) => item.id === 'c1')?.periodId).toBe(1)
  })

  it('目標已有課程時阻止覆寫，明確允許後保留雙方及衝堂警告', () => {
    const data = setup()
    expect(() => moveLessonOnDate(data, 'c1', '2026-09-07', { date: '2026-09-07', periodId: 3 }, false, ids('blocked'))).toThrow('occupied')
    const result = moveLessonOnDate(data, 'c1', '2026-09-07', { date: '2026-09-07', periodId: 3 }, true, ids('kept'))
    const lessons = day(result, '2026-09-07').filter((item) => ['c1', 'c2'].includes(item.id))
    expect(lessons).toHaveLength(2)
    expect(lessons.every((item) => item.hasConflict)).toBe(true)
  })

  it('單日替換保留原 School 與 TeachingUnit 身分', () => {
    const data = setup()
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    const replacementClass = data.classes.find((item) => item.name === '二年 3 班')!
    const result = replaceLessonOnDate(data, 'c1', '2026-09-07', { subjectId: 'history', classId: replacementClass.id, room: '專科教室' }, ids('replace'))
    expect(day(result, '2026-09-07').find((item) => item.id === 'c1')).toMatchObject({
      status: 'replaced', teachingUnitId: lesson.teachingUnitId, subjectId: 'history', classId: replacementClass.id, room: '專科教室',
    })
  })

  it('單日交換只交換指定日期', () => {
    const result = swapLessonsOnDate(setup(), 'c1', 'c2', '2026-09-07', ids('group', 'swap-a', 'swap-b'))
    expect(day(result, '2026-09-07').filter((item) => ['c1', 'c2'].includes(item.id)).map((item) => [item.id, item.periodId])).toEqual([['c2', 1], ['c1', 3]])
    expect(day(result, '2026-09-14').filter((item) => ['c1', 'c2'].includes(item.id)).map((item) => [item.id, item.periodId])).toEqual([['c1', 1], ['c2', 3]])
  })

  it('跨日期交換原子移動雙方並可完整撤銷', () => {
    const swapped = swapLessonOccurrences(setup(), 'c1', '2026-09-07', 'c5', '2026-09-08', ids('cross-day', 'swap-a', 'swap-b'))
    expect(day(swapped, '2026-09-07').filter((item) => ['c1', 'c5'].includes(item.id)).map((item) => [item.id, item.periodId, item.status])).toEqual([['c5', 1, 'moved']])
    expect(day(swapped, '2026-09-08').filter((item) => ['c1', 'c5'].includes(item.id)).map((item) => [item.id, item.periodId, item.status])).toEqual([['c1', 2, 'moved']])
    expect(swapped.overrides.filter((item) => item.groupId === 'cross-day')).toHaveLength(2)
    expect(day(swapped, '2026-09-14').find((item) => item.id === 'c1')?.periodId).toBe(1)
    expect(day(swapped, '2026-09-15').find((item) => item.id === 'c5')?.periodId).toBe(2)

    const restored = revokeLessonOverride(swapped, 'swap-a')
    expect(restored.overrides.filter((item) => item.groupId === 'cross-day')).toHaveLength(0)
    expect(day(restored, '2026-09-07').find((item) => item.id === 'c1')).toMatchObject({ periodId: 1, status: 'regular' })
    expect(day(restored, '2026-09-08').find((item) => item.id === 'c5')).toMatchObject({ periodId: 2, status: 'regular' })
  })

  it('永久修改切分版本並將生效日後 override 改指向新版本', () => {
    let data = cancelLessonOnDate(setup(), 'c1', '2026-09-21', ids('future-cancel'))
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    const unit = data.teachingUnits.find((item) => item.id === lesson.teachingUnitId)!
    const school = data.schools.find((item) => item.id === unit.schoolId)!
    data = permanentlyUpdateLesson(data, 'c1', '2026-09-14', {
      projectId: lesson.projectId, schoolId: school.id, teachingUnitId: unit.id, subjectId: 'history',
      classId: lesson.classId, day: lesson.day, periodId: 2, weekPattern: lesson.weekPattern, room: '新版教室',
    }, ids('c1-v2'))
    expect(data.recurringLessons.find((item) => item.id === 'c1')?.effectiveEnd).toBe('2026-09-13')
    expect(data.recurringLessons.find((item) => item.id === 'c1-v2')).toMatchObject({ seriesId: 'c1', effectiveStart: '2026-09-14', periodId: 2 })
    expect(data.overrides.find((item) => item.id === 'future-cancel')?.originalLessonId).toBe('c1-v2')
    expect(day(data, '2026-09-07').find((item) => item.seriesId === 'c1')?.periodId).toBe(1)
    expect(day(data, '2026-09-14').find((item) => item.seriesId === 'c1')?.periodId).toBe(2)
  })

  it('永久交換切分雙方版本且不改寫歷史', () => {
    const result = permanentlySwapLessons(setup(), 'c1', 'c2', '2026-09-14', ids('c1-v2', 'c2-v2'))
    expect(day(result, '2026-09-07').filter((item) => ['c1', 'c2'].includes(item.id)).map((item) => item.periodId)).toEqual([1, 3])
    expect(day(result, '2026-09-14').filter((item) => ['c1-v2', 'c2-v2'].includes(item.id)).map((item) => [item.id, item.periodId])).toEqual([['c2-v2', 1], ['c1-v2', 3]])
  })

  it('安全結束保留歷史，封存專案拒絕異動', () => {
    const ended = endLessonFromDate(setup(), 'c1', '2026-09-14')
    expect(day(ended, '2026-09-07').some((item) => item.id === 'c1')).toBe(true)
    expect(day(ended, '2026-09-14').some((item) => item.id === 'c1')).toBe(false)
    const archived = setup()
    archived.projects[0].archivedAt = '2026-10-01T00:00:00.000Z'
    archived.activeProjectId = null
    expect(() => cancelLessonOnDate(archived, 'c1', '2026-09-07', ids('blocked'))).toThrow('read-only')
  })

  it('撤銷取消與內容替換後恢復該日固定課程', () => {
    const cancelled = cancelLessonOnDate(setup(), 'c1', '2026-09-07', ids('cancel'))
    const restored = revokeLessonOverride(cancelled, 'cancel')
    expect(restored.overrides).toHaveLength(0)
    expect(day(restored, '2026-09-07').find((item) => item.id === 'c1')?.status).toBe('regular')
    const schoolClass = restored.classes.find((item) => item.name === '二年 3 班')!
    const replaced = replaceLessonOnDate(restored, 'c1', '2026-09-07', { subjectId: 'history', classId: schoolClass.id }, ids('replace'))
    expect(day(replaced, '2026-09-07').find((item) => item.id === 'c1')?.status).toBe('replaced')
    expect(day(revokeLessonOverride(replaced, 'replace'), '2026-09-07').find((item) => item.id === 'c1')).toMatchObject({ status: 'regular', subjectId: 'chinese' })
  })

  it('撤銷移動後原位置恢復且目標位置消失，重新載入結果一致', () => {
    const moved = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-07', periodId: 8 }, false, ids('move'))
    const restored = revokeLessonOverride(JSON.parse(JSON.stringify(moved)), 'move')
    expect(day(restored, '2026-09-07').filter((item) => item.id === 'c1')).toEqual([expect.objectContaining({ status: 'regular', periodId: 1 })])
  })

  it('撤銷交換會以 groupId 原子移除雙方異動', () => {
    const swapped = swapLessonsOnDate(setup(), 'c1', 'c2', '2026-09-07', ids('group', 'swap-a', 'swap-b'))
    const restored = revokeLessonOverride(swapped, 'swap-a')
    expect(restored.overrides.filter((item) => item.groupId === 'group')).toHaveLength(0)
    expect(day(restored, '2026-09-07').filter((item) => ['c1', 'c2'].includes(item.id)).map((item) => [item.id, item.periodId])).toEqual([['c1', 1], ['c2', 3]])
  })

  it('改寫既有單日異動時不留下重複 override', () => {
    const cancelled = cancelLessonOnDate(setup(), 'c1', '2026-09-07', ids('old-cancel'))
    const clean = revokeLessonOverride(cancelled, 'old-cancel')
    const rewritten = moveLessonOnDate(clean, 'c1', '2026-09-07', { date: '2026-09-07', periodId: 8 }, false, ids('new-move'))
    expect(rewritten.overrides.filter((item) => item.originalLessonId === 'c1' && item.date === '2026-09-07').map((item) => item.id)).toEqual(['new-move'])
  })

  it('版本切分重新指向 override 後仍可安全撤銷', () => {
    let data = cancelLessonOnDate(setup(), 'c1', '2026-09-21', ids('future-cancel'))
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    const unit = data.teachingUnits.find((item) => item.id === lesson.teachingUnitId)!
    data = permanentlyUpdateLesson(data, 'c1', '2026-09-14', { projectId: lesson.projectId, schoolId: unit.schoolId, teachingUnitId: unit.id, subjectId: lesson.subjectId, classId: lesson.classId, day: lesson.day, periodId: lesson.periodId, weekPattern: lesson.weekPattern }, ids('c1-v2'))
    expect(data.overrides[0].originalLessonId).toBe('c1-v2')
    expect(revokeLessonOverride(data, 'future-cancel').overrides).toHaveLength(0)
  })

  it('封存專案與不完整交換群組不得撤銷', () => {
    const data = cancelLessonOnDate(setup(), 'c1', '2026-09-07', ids('cancel'))
    data.projects[0].archivedAt = '2026-10-01T00:00:00.000Z'; data.activeProjectId = null
    expect(() => revokeLessonOverride(data, 'cancel')).toThrow('read-only')
    const incomplete = setup()
    incomplete.overrides.push({ id: 'half-swap', groupId: 'broken', projectId: incomplete.activeProjectId, teachingUnitId: incomplete.recurringLessons[0].teachingUnitId, date: '2026-09-07', periodId: 1, action: 'move', originalLessonId: 'c1', target: { date: '2026-09-07', periodId: 3 } })
    expect(() => revokeLessonOverride(incomplete, 'half-swap')).toThrow('incomplete')
  })
})

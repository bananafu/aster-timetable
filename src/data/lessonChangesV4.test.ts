import { describe, expect, it } from 'vitest'
import { resolveProjectDay } from '../lib/scheduleV4'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { cancelLessonOnDate, endLessonFromDate, moveLessonOnDate, permanentlySwapLessons, permanentlyUpdateLesson, replaceLessonOnDate, swapLessonsOnDate } from './lessonChangesV4'

const ids = (...values: string[]) => {
  let index = 0
  return () => values[index++] ?? `generated-${index}`
}
const setup = () => migrateV3ToV4(structuredClone(initialData))
const day = (data: ReturnType<typeof setup>, date: string) => resolveProjectDay(data, data.activeProjectId!, new Date(`${date}T12:00:00`))

describe('v4 lesson changes', () => {
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
})

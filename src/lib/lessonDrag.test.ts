import { describe, expect, it } from 'vitest'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { initialData } from '../data/seed'
import { resolveProjectDay } from './scheduleV4'
import { createLessonDragIntent } from './lessonDrag'

const setup = () => migrateV3ToV4(structuredClone(initialData))
const source = (data: ReturnType<typeof setup>) => resolveProjectDay(data, data.activeProjectId!, new Date('2026-09-07T12:00:00')).find((item) => item.id === 'c1')!

describe('desktop lesson drag intent', () => {
  it('只產生原 TeachingUnit period 的操作意圖，不修改資料', () => {
    const data = setup(); const before = JSON.stringify(data)
    const result = createLessonDragIntent(data, source(data), { date: '2026-09-08', startTime: '16:10', endTime: '17:00' })
    expect(result).toEqual({ valid: true, intent: expect.objectContaining({ lessonId: 'c1', sourceDate: '2026-09-07', targetDate: '2026-09-08', targetPeriodId: 8 }) })
    expect(JSON.stringify(data)).toBe(before)
  })

  it('回報目標衝堂但不覆寫既有課程', () => {
    const data = setup()
    const result = createLessonDragIntent(data, source(data), { date: '2026-09-07', startTime: '10:10', endTime: '11:00' })
    expect(result).toMatchObject({ valid: true, intent: { conflictLessonIds: ['c2'] } })
    expect(data.overrides).toHaveLength(0)
  })

  it('阻止無法映射、相同位置、已有 override 及封存專案', () => {
    const data = setup(); const lesson = source(data)
    expect(createLessonDragIntent(data, lesson, { date: '2026-09-08', startTime: '08:00', endTime: '08:45' })).toMatchObject({ valid: false, reason: expect.stringContaining('無法安全跨校映射') })
    expect(createLessonDragIntent(data, lesson, { date: lesson.date, startTime: lesson.startTime, endTime: lesson.endTime })).toMatchObject({ valid: false })
    expect(createLessonDragIntent(data, { ...lesson, status: 'moved', overrideId: 'move' }, { date: '2026-09-08', startTime: '09:10', endTime: '10:00' })).toMatchObject({ valid: false, reason: expect.stringContaining('已有單日異動') })
    data.projects[0].archivedAt = '2026-10-01T00:00:00.000Z'; data.activeProjectId = null
    expect(createLessonDragIntent(data, lesson, { date: '2026-09-08', startTime: '09:10', endTime: '10:00' })).toMatchObject({ valid: false, reason: expect.stringContaining('封存') })
  })

  it('阻止學期範圍外的目標日期', () => {
    const data = setup()
    expect(createLessonDragIntent(data, source(data), { date: '2027-02-01', startTime: '09:10', endTime: '10:00' })).toMatchObject({ valid: false, reason: expect.stringContaining('學期範圍') })
  })
})

import { describe, expect, it } from 'vitest'
import { initialData } from '../data/seed'
import { getWeekInfo } from './date'
import { findCourseConflict, getNextUpcomingEvent, getTodayTeachingSummary, resolveSlot } from './schedule'

describe('week calculation', () => {
  it('alternates A and B from the semester start week', () => {
    expect(getWeekInfo(new Date(2026, 7, 31), initialData.semester)).toMatchObject({ number: 1, pattern: 'A' })
    expect(getWeekInfo(new Date(2026, 8, 7), initialData.semester)).toMatchObject({ number: 2, pattern: 'B' })
  })
})

describe('fixed course conflicts', () => {
  const base = { id: 'base', subjectId: 'chinese', classId: '201', day: 1 as const, periodId: 1, weekPattern: 'A' as const }

  it('allows A and B courses to share a slot', () => {
    expect(findCourseConflict([base], { day: 1, periodId: 1, weekPattern: 'B' })).toBeUndefined()
  })

  it('rejects overlapping patterns and excludes the edited course itself', () => {
    expect(findCourseConflict([base], { day: 1, periodId: 1, weekPattern: 'every' })?.id).toBe('base')
    expect(findCourseConflict([base], { day: 1, periodId: 1, weekPattern: 'A' })?.id).toBe('base')
    expect(findCourseConflict([base], { day: 1, periodId: 1, weekPattern: 'every' }, 'base')).toBeUndefined()
  })
})

describe('schedule overrides', () => {
  it('resolves replacement without mutating the recurring course', () => {
    const data = {
      ...initialData,
      overrides: [{ id: 'o1', date: '2026-08-31', periodId: 1, action: 'replace' as const, originalCourseId: 'c1', replacement: { subjectId: 'history', classId: '203' } }],
    }
    expect(resolveSlot(data, new Date(2026, 7, 31), 1).subjectId).toBe('history')
    expect(data.courses.find((course) => course.id === 'c1')?.subjectId).toBe('chinese')
  })

  it('cancels only the specified date', () => {
    const data = {
      ...initialData,
      overrides: [{ id: 'cancel-1', date: '2026-08-31', periodId: 1, action: 'cancel' as const, originalCourseId: 'c1' }],
    }
    expect(resolveSlot(data, new Date(2026, 7, 31), 1).status).toBe('cancelled')
    expect(resolveSlot(data, new Date(2026, 8, 7), 1).status).toBe('regular')
  })
})

describe('today teaching summary', () => {
  it('identifies the current lesson and respects cancellation', () => {
    const duringFirstPeriod = getTodayTeachingSummary(initialData, new Date(2026, 7, 31, 8, 30))
    expect(duringFirstPeriod.state).toBe('current')
    expect(duringFirstPeriod.slot?.subjectName).toBe('國文')

    const cancelled = { ...initialData, overrides: [{ id: 'cancel-1', date: '2026-08-31', periodId: 1, action: 'cancel' as const }] }
    const afterFirstPeriod = getTodayTeachingSummary(cancelled, new Date(2026, 7, 31, 8, 30))
    expect(afterFirstPeriod.state).toBe('next')
    expect(afterFirstPeriod.slot?.period.id).toBe(3)
  })

  it('reports when lessons have finished', () => {
    expect(getTodayTeachingSummary(initialData, new Date(2026, 7, 31, 18, 0)).state).toBe('finished')
  })

  it('does not resolve courses outside semester boundaries', () => {
    expect(resolveSlot(initialData, new Date(2026, 7, 28), 1).status).toBe('empty')
    expect(resolveSlot(initialData, new Date(2027, 0, 22), 1).status).toBe('empty')
    expect(getTodayTeachingSummary(initialData, new Date(2027, 0, 22, 8, 30)).state).toBe('outside-semester')
  })
})

describe('upcoming events', () => {
  it('ignores events that ended or have no valid date', () => {
    const events = [
      { id: 'past', title: '已結束', type: 'meeting' as const, date: '2026-09-01', startTime: '08:00', endTime: '09:00', color: '#000' },
      { id: 'invalid', title: '無日期', type: 'meeting' as const, date: '', startTime: '10:00', endTime: '11:00', color: '#000' },
      { id: 'future', title: '近期會議', type: 'meeting' as const, date: '2026-09-01', startTime: '11:00', endTime: '12:00', color: '#000' },
    ]
    expect(getNextUpcomingEvent(events, new Date(2026, 8, 1, 10, 0))?.id).toBe('future')
  })
})

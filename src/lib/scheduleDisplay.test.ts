import { describe, expect, it } from 'vitest'
import { isActualTeachingOccurrence, toScheduleDisplayDays, toScheduleDisplayEvents } from './scheduleDisplay'
import type { V9ReadDay, V9ReadOccurrence } from './scheduleV9'
import type { ResolvedCalendarEventV8 } from '../types'

const occurrence = (overrides: Partial<V9ReadOccurrence> = {}): V9ReadOccurrence => ({
  occurrenceId: 'v9-occurrence', id: 'lesson', kind: 'recurring', seriesId: 'series',
  projectId: 'project', timetableId: 'timetable', teachingUnitId: 'unit', schoolId: 'school',
  schoolName: '甲校', schoolColor: '#556677', teachingUnitName: '高中部', subjectId: 'subject',
  subjectName: '國文', subjectColor: '#A66D52', classId: 'class', className: '甲班',
  sourceDate: '2026-09-07', date: '2026-09-07', periodId: 1, periodLabel: '第 1 節',
  startTime: '08:00', endTime: '08:50', status: 'regular', hasConflict: false,
  ...overrides,
} as V9ReadOccurrence)

describe('schedule display adapter', () => {
  it('keeps V9 identity and movement role without creating a V4 occurrence', () => {
    const source = occurrence({ occurrenceId: 'move-source', status: 'moved', movementRole: 'source',
      overrideId: 'override', groupId: 'group' })
    const days: readonly V9ReadDay[] = [{ date: new Date(2026, 8, 7), lessons: [source] }]
    const display = toScheduleDisplayDays(days)[0].lessons[0]
    expect(display).toMatchObject({ key: 'move-source', id: 'lesson', status: 'moved',
      movementRole: 'source', overrideId: 'override' })
    expect(isActualTeachingOccurrence(display)).toBe(false)
    expect(isActualTeachingOccurrence({ ...display, movementRole: 'target' })).toBe(true)
  })

  it('maps only the resolver-provided event display fields', () => {
    const event: ResolvedCalendarEventV8 = { id: 'meeting', projectId: 'project', timetableId: 'timetable',
      teachingUnitId: 'unit', ownershipStatus: 'resolved', type: 'meeting', title: '教師會議',
      date: '2026-09-07', startTime: '12:00', endTime: '13:00', color: '#A66D52' }
    const task: ResolvedCalendarEventV8 = { ...event, id: 'task', type: 'task', title: '待辦' }
    expect(toScheduleDisplayEvents([event, task])).toEqual([{ id: 'meeting', type: 'meeting', title: '教師會議',
      date: '2026-09-07', startTime: '12:00', endTime: '13:00' }])
  })
})

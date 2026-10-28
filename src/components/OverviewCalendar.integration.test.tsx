// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OverviewCalendar } from './OverviewCalendar'
import { createOneOffLesson } from '../data/oneOffLessonsV7'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import type { ScheduleDisplayDay, ScheduleDisplayOccurrence } from '../lib/scheduleDisplay'

function fixture() {
  const data = migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
  return { data, projectId: data.projects[0].id, timetableId: data.timetables[0].id }
}

const monday = new Date(2026, 8, 7)
const resolvedOccurrence = (overrides: Partial<ScheduleDisplayOccurrence> = {}): ScheduleDisplayOccurrence => ({
  key: 'v9-lesson', id: 'v9-lesson', kind: 'recurring', date: '2026-09-07',
  startTime: '08:10', endTime: '09:00', teachingUnitId: 'unit-a', schoolId: 'school-a',
  schoolName: '甲校', schoolColor: '#556677', teachingUnitName: '高中部', subjectName: 'V9 國文',
  subjectColor: '#A66D52', className: 'V9 甲班', hasConflict: false, status: 'regular', periodLabel: '第 1 節',
  ...overrides,
})
const resolvedDays = (lessons: readonly ScheduleDisplayOccurrence[] = []): readonly ScheduleDisplayDay[] =>
  Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2026, 8, 6 + index)
    return { date, lessons: date.getDate() === 7 ? lessons : [] }
  })

describe('OverviewCalendar', () => {
  afterEach(cleanup)

  it('依日期與實際開始時間同時呈現課程、會議、活動，並保留週末與非節次時間', () => {
    const { data, projectId, timetableId } = fixture()
    data.events.push(
      { id: 'early-meeting', projectId, date: '2026-09-07', startTime: '07:30', endTime: '08:30', title: '晨間會議', type: 'meeting', color: '#A66D52' },
      { id: 'overlap-meeting', projectId, date: '2026-09-07', startTime: '08:40', endTime: '09:20', title: '課中會議', type: 'meeting', color: '#A66D52' },
      { id: 'lunch-activity', projectId, date: '2026-09-07', startTime: '12:15', endTime: '13:00', title: '午間活動', type: 'activity', color: '#A66D52' },
      { id: 'weekend-activity', projectId: null, date: '2026-09-12', startTime: '18:00', endTime: '19:00', title: '週末活動', type: 'activity', color: '#A66D52' },
      { id: 'other-project', projectId: 'other-project', date: '2026-09-07', startTime: '10:00', endTime: '11:00', title: '別的專案', type: 'meeting', color: '#A66D52' },
    )
    render(<OverviewCalendar data={data} projectId={projectId} timetableId={timetableId} weekStart={monday} />)
    const day = screen.getByRole('region', { name: '2026-09-07 週一' })
    const items = day.querySelector('.overview-day-items')!
    const texts = [...items.children].map((item) => item.textContent ?? '')
    expect(texts[0]).toContain('晨間會議')
    expect(texts[1]).toContain('08:10–09:00')
    expect(texts[1]).toContain('國文')
    expect(texts[1]).toContain('二年 1 班')
    expect(texts[2]).toContain('課中會議')
    expect(texts.find((text) => text.includes('午間活動'))).toContain('12:15–13:00')
    expect(within(day).getByRole('group', { name: '會議 07:30 至 08:30 晨間會議' }).className).toContain('overview-event-meeting')
    expect(within(day).getByRole('group', { name: '活動 12:15 至 13:00 午間活動' }).className).toContain('overview-event-activity')
    expect(screen.getByRole('region', { name: '2026-09-12 週六' }).textContent).toContain('週末活動')
    expect(screen.queryByText('別的專案')).toBeNull()
  })

  it('取消課程保留原日期時段與明確狀態，點擊仍進入原有編輯流程', () => {
    const { data, projectId, timetableId } = fixture()
    data.overrides.push({ id: 'cancel-first', projectId, timetableId, teachingUnitId: data.teachingUnits[0].id,
      date: '2026-09-07', periodId: data.recurringLessons[0].periodId, action: 'cancel', originalLessonId: data.recurringLessons[0].id })
    const onLessonClick = vi.fn()
    render(<OverviewCalendar data={data} projectId={projectId} timetableId={timetableId} weekStart={monday} onLessonClick={onLessonClick} />)
    const day = screen.getByRole('region', { name: '2026-09-07 週一' })
    const cancelled = within(day).getByRole('button', { name: /編輯 國文・二年 1 班・已取消/ })
    expect(cancelled.className).toContain('is-cancelled')
    expect(cancelled.textContent).toContain('08:10–09:00')
    expect(cancelled.textContent).toContain('已取消')
    fireEvent.click(cancelled)
    expect(onLessonClick).toHaveBeenCalledWith(data.recurringLessons[0].id, '2026-09-07', 'cancel-first')
  })

  it('單日自訂時間不依附節次，且無教師課表時仍顯示會議活動', () => {
    const { data, projectId, timetableId } = fixture()
    const withOneOff = createOneOffLesson(data, { projectId, timetableId, teachingUnitId: data.teachingUnits[0].id,
      classId: data.classes[0].id, subjectId: data.subjects[0].id, date: '2026-09-08', purpose: 'extra',
      time: { mode: 'custom', startTime: '18:15', endTime: '19:00' } }, () => '00000000-0000-4000-8000-000000000091')
    const onOneOffClick = vi.fn()
    const view = render(<OverviewCalendar data={withOneOff} projectId={projectId} timetableId={timetableId} weekStart={monday} onOneOffClick={onOneOffClick} />)
    const evening = within(screen.getByRole('region', { name: '2026-09-08 週二' })).getByRole('button', { name: '編輯單日課程 國文・二年 1 班' })
    expect(evening.textContent).toContain('18:15–19:00')
    fireEvent.click(evening)
    expect(onOneOffClick).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000091')

    const withoutTimetable = structuredClone(withOneOff)
    withoutTimetable.timetables = []
    withoutTimetable.events.push({ id: 'standalone', projectId, date: '2026-09-12', startTime: '12:00', endTime: '13:00', title: '週末會議', type: 'meeting', color: '#A66D52' })
    view.rerender(<OverviewCalendar data={withoutTimetable} projectId={projectId} weekStart={monday} />)
    expect(screen.getByRole('region', { name: '2026-09-12 週六' }).textContent).toContain('週末會議')
    expect(screen.queryByRole('button', { name: /編輯單日課程/ })).toBeNull()
  })

  it.each([
    { purpose: 'extra' as const, label: '單日新增' },
    { purpose: 'make-up' as const, label: '補課' },
    { purpose: 'substitute' as const, label: '代課' },
  ])('以既有用途欄位顯示單日課程的 $label 標籤', ({ purpose, label }) => {
    const { data, projectId, timetableId } = fixture()
    const withOneOff = createOneOffLesson(data, { projectId, timetableId,
      teachingUnitId: data.teachingUnits[0].id, classId: data.classes[0].id,
      subjectId: data.subjects[0].id, date: '2026-09-08', purpose,
      time: { mode: 'custom', startTime: '18:15', endTime: '19:00' } },
    () => '00000000-0000-4000-8000-000000000092')
    render(<OverviewCalendar data={withOneOff} projectId={projectId} timetableId={timetableId} weekStart={monday} />)
    const course = within(screen.getByRole('region', { name: '2026-09-08 週二' }))
      .getByRole('button', { name: '編輯單日課程 國文・二年 1 班' })
    expect(within(course).getByText(label).tagName).toBe('EM')
    expect(course.textContent).not.toContain('單日課程')
  })
})

describe('OverviewCalendar resolved read-only data', () => {
  afterEach(cleanup)

  it('renders pre-resolved V9 courses and events with neutral read-only semantics', () => {
    const source = resolvedOccurrence({ key: 'move-source', status: 'moved', movementRole: 'source' })
    render(<OverviewCalendar mode="resolved" weekStart={monday} readStatus="ready"
      days={resolvedDays([source])}
      events={[{ id: 'meeting', type: 'meeting', date: '2026-09-07', startTime: '07:30',
        endTime: '08:00', title: '教師會議' }]} />)
    expect(screen.getByRole('group', { name: '會議 07:30 至 08:00 教師會議' })).toBeTruthy()
    const course = screen.getByRole('button', { name: '課程 V9 國文・V9 甲班・已調離' }) as HTMLButtonElement
    expect(course.disabled).toBe(true)
    expect(course.textContent).toContain('已調離')
    expect(screen.queryByRole('button', { name: /編輯.*V9/ })).toBeNull()
  })

  it.each([
    ['unset-term', '尚未設定學期'],
    ['invalid-scope', '目前選取的課表或授課單位無法使用'],
    ['invalid-document', '課表資料無法通過驗證'],
  ] as const)('distinguishes %s from a legal empty week', (readStatus, message) => {
    const view = render(<OverviewCalendar mode="resolved" weekStart={monday} readStatus={readStatus}
      days={resolvedDays()} events={[]} />)
    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.queryByText('無行程')).toBeNull()
    view.rerender(<OverviewCalendar mode="resolved" weekStart={monday} readStatus="ready"
      days={resolvedDays()} events={[]} />)
    expect(screen.getAllByText('無行程')).toHaveLength(7)
  })
})

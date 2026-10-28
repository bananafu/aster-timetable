// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelLessonOnDate, moveLessonOnDate, revokeLessonOverride } from '../data/lessonChangesV4'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { createOneOffLesson } from '../data/oneOffLessonsV7'
import { initialData } from '../data/seed'
import { getTeachingUnitWeekPattern } from '../lib/scheduleV4'
import type { ScheduleDisplayDay, ScheduleDisplayOccurrence } from '../lib/scheduleDisplay'
import { MultiSchoolSchedule } from './MultiSchoolSchedule'

afterEach(cleanup)
const setup = () => migrateV3ToV4(structuredClone(initialData))
const week = Array.from({ length: 5 }, (_, index) => new Date(2026, 8, 7 + index))
const transfer = () => ({ effectAllowed: '', setData: vi.fn(), getData: vi.fn() })

describe('MultiSchoolSchedule desktop drag and drop', () => {
  it('拖曳只產生意圖，drop 前不修改資料', () => {
    const data = setup(); const before = JSON.stringify(data); const onLessonDrop = vi.fn()
    const { container } = render(<MultiSchoolSchedule data={data} weekDays={week} onLessonDrop={onLessonDrop} />)
    const card = screen.getAllByLabelText('編輯 國文・二年 1 班')[0]
    fireEvent.dragStart(card, { dataTransfer: transfer() })
    expect(screen.getByText(/正在拖曳：國文・二年 1 班/)).toBeTruthy()
    expect(JSON.stringify(data)).toBe(before)
    const tuesday = screen.getByLabelText('2026-09-08 可放置節次')
    const targets = container.querySelectorAll('.lesson-drop-target')
    expect(targets.length).toBeGreaterThan(0)
    expect(within(tuesday).getByText('第 8 節')).toBeTruthy()
    const target = [...tuesday.querySelectorAll('.lesson-drop-target')].find((item) => item.textContent?.includes('第 8 節'))!
    fireEvent.drop(target, { dataTransfer: transfer() })
    expect(onLessonDrop).toHaveBeenCalledWith(expect.objectContaining({ lessonId: 'c1', sourceDate: '2026-09-07', targetDate: '2026-09-08', targetPeriodId: 8 }))
    expect(JSON.stringify(data)).toBe(before)
  })

  it('Escape 取消拖曳且不產生操作意圖', () => {
    const onLessonDrop = vi.fn()
    render(<MultiSchoolSchedule data={setup()} weekDays={week} onLessonDrop={onLessonDrop} />)
    fireEvent.dragStart(screen.getAllByLabelText('編輯 國文・二年 1 班')[0], { dataTransfer: transfer() })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByText('已取消拖曳，沒有修改任何資料。')).toBeTruthy()
    expect(screen.queryByLabelText('2026-09-08 可放置節次')).toBeNull()
    expect(onLessonDrop).not.toHaveBeenCalled()
  })

  it('已有 override 的課程不會產生第二筆拖曳意圖', () => {
    const data = cancelLessonOnDate(setup(), 'c1', '2026-09-07', () => 'cancel')
    const onLessonDrop = vi.fn()
    render(<MultiSchoolSchedule data={data} weekDays={week} onLessonDrop={onLessonDrop} />)
    fireEvent.dragStart(screen.getAllByLabelText('編輯 國文・二年 1 班')[0], { dataTransfer: transfer() })
    const tuesday = screen.getByLabelText('2026-09-08 可放置節次')
    fireEvent.drop(tuesday.querySelector('.lesson-drop-target')!, { dataTransfer: transfer() })
    expect(screen.getByText(/已有單日異動/)).toBeTruthy()
    expect(onLessonDrop).not.toHaveBeenCalled()
    expect(data.overrides).toHaveLength(1)
  })

  it('唯讀模式不啟用 draggable', () => {
    render(<MultiSchoolSchedule data={setup()} weekDays={week} onLessonClick={undefined} onLessonDrop={undefined} />)
    expect(screen.getAllByLabelText('編輯 國文・二年 1 班')[0].getAttribute('draggable')).toBe('false')
  })
})

describe('MultiSchoolSchedule weekend visibility', () => {
  it('五天為週一至週五，七天為本週前一日的週日至週六', () => {
    render(<MultiSchoolSchedule data={setup()} weekDays={week} />)
    const labels = () => [...document.querySelectorAll('.multi-day-column > header span')].map((item) => item.textContent)
    expect(labels()).toEqual(['週一', '週二', '週三', '週四', '週五'])
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    expect(labels()).toEqual(['週日', '週一', '週二', '週三', '週四', '週五', '週六'])
    expect(screen.getByLabelText('2026-09-06 課表').textContent).toContain('9/6')
    expect(screen.getByLabelText('2026-09-12 課表').textContent).toContain('9/12')
  })

  it('跨月、跨年仍由週一前一天取得星期日，不改週次基準', () => {
    const juneWeek = Array.from({ length: 5 }, (_, index) => new Date(2026, 5, 1 + index))
    const view = render(<MultiSchoolSchedule data={setup()} weekDays={juneWeek} />)
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    expect(screen.getByLabelText('2026-05-31 課表')).toBeTruthy()
    expect(screen.getByLabelText('2026-06-06 課表')).toBeTruthy()
    const newYearWeek = Array.from({ length: 5 }, (_, index) => new Date(2029, 0, 1 + index))
    view.rerender(<MultiSchoolSchedule data={setup()} weekDays={newYearWeek} />)
    expect(screen.getByLabelText('2028-12-31 課表')).toBeTruthy()
    expect(screen.getByLabelText('2029-01-06 課表')).toBeTruthy()
    expect(screen.getByLabelText('2029-01-01 課表')).toBeTruthy()
  })

  it('星期日與星期六的異動都計入同週提示，卡片與拖曳目標使用各自日期', () => {
    const sunday = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-06', periodId: 8 }, false, () => 'sunday-move')
    const data = moveLessonOnDate(sunday, 'c2', '2026-09-07', { date: '2026-09-12', periodId: 3 }, false, () => 'saturday-move')
    const onLessonClick = vi.fn()
    const onLessonDrop = vi.fn()
    render(<MultiSchoolSchedule data={data} weekDays={week} onLessonClick={onLessonClick} onLessonDrop={onLessonDrop} />)
    expect(screen.getByText('本週週末有 2 堂課')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    const sundayColumn = screen.getByLabelText('2026-09-06 課表')
    const saturdayColumn = screen.getByLabelText('2026-09-12 課表')
    fireEvent.click(within(sundayColumn).getByRole('button', { name: '編輯 國文・二年 1 班' }))
    fireEvent.click(within(saturdayColumn).getByRole('button', { name: '編輯 歷史・二年 3 班' }))
    expect(onLessonClick.mock.calls).toEqual([['c1', '2026-09-06', 'sunday-move'], ['c2', '2026-09-12', 'saturday-move']])
    const source = screen.getAllByLabelText('編輯 國文・二年 1 班').find((item) => item.className.includes('regular'))!
    fireEvent.dragStart(source, { dataTransfer: transfer() })
    const sundayTargets = screen.getByLabelText('2026-09-06 可放置節次')
    expect(screen.getByLabelText('2026-09-12 可放置節次')).toBeTruthy()
    expect(onLessonDrop).not.toHaveBeenCalled()
    const target = [...sundayTargets.querySelectorAll('.lesson-drop-target')].find((item) => item.textContent?.includes('第 1 節'))!
    fireEvent.drop(target, { dataTransfer: transfer() })
    expect(onLessonDrop).toHaveBeenCalledWith(expect.objectContaining({ targetDate: '2026-09-06', targetPeriodId: 1 }))
  })

  it('下個星期日只歸下週提示與七天欄位，不混入目前週', () => {
    const data = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-13', periodId: 8 }, false, () => 'next-sunday')
    const nextWeek = Array.from({ length: 5 }, (_, index) => new Date(2026, 8, 14 + index))
    const view = render(<MultiSchoolSchedule data={data} weekDays={week} />)
    expect(screen.queryByText(/本週週末有/)).toBeNull()
    view.rerender(<MultiSchoolSchedule data={data} weekDays={nextWeek} />)
    expect(screen.getByText('本週週末有 1 堂課')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    expect(screen.getByLabelText('2026-09-13 課表').querySelector('.multi-lesson-card.moved')).toBeTruthy()
    expect(screen.queryByLabelText('2026-09-20 課表')).toBeNull()
  })

  it('星期日欄位不改 A/B 週錨點，實際衝堂仍有雙卡警示', () => {
    const data = setup()
    data.teachingUnits[0].weekCycle = { enabled: true, anchorDate: '2026-09-07', anchorPattern: 'A' }
    expect(getTeachingUnitWeekPattern(new Date(2026, 8, 6), data.teachingUnits[0])).toBe('B')
    expect(getTeachingUnitWeekPattern(new Date(2026, 8, 7), data.teachingUnits[0])).toBe('A')
    const first = moveLessonOnDate(data, 'c1', '2026-09-07', { date: '2026-09-06', periodId: 1 }, false, () => 'sunday-one')
    const second = moveLessonOnDate(first, 'c2', '2026-09-07', { date: '2026-09-06', periodId: 1 }, true, () => 'sunday-two')
    render(<MultiSchoolSchedule data={second} weekDays={week} />)
    expect(screen.getByText('本週週末有 2 堂課')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    const sunday = screen.getByLabelText('2026-09-06 課表')
    expect(sunday.querySelectorAll('.multi-lesson-card.conflict')).toHaveLength(2)
    expect(within(sunday).getAllByText('衝堂')).toHaveLength(2)
  })

  it('預設五天，週末移動課程有提示；七天模式可開啟課程且不寫入資料', () => {
    const data = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-12', periodId: 8 }, false, () => 'weekend-move')
    const before = JSON.stringify(data)
    const onLessonClick = vi.fn()
    render(<MultiSchoolSchedule data={data} weekDays={week} onLessonClick={onLessonClick} />)
    expect(screen.getByRole('button', { name: '五天' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText('週六')).toBeNull()
    expect(screen.getByText('本週週末有 1 堂課')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '顯示週末' }))
    expect(screen.getByText('週六')).toBeTruthy()
    expect(screen.getByText('週日')).toBeTruthy()
    expect(screen.getByRole('button', { name: '七天' }).getAttribute('aria-pressed')).toBe('true')
    const saturday = screen.getByText('週六').closest('.multi-day-column')!
    fireEvent.click(within(saturday as HTMLElement).getByRole('button', { name: '編輯 國文・二年 1 班' }))
    expect(onLessonClick).toHaveBeenCalledWith('c1', '2026-09-12', 'weekend-move')
    expect(JSON.stringify(data)).toBe(before)
    fireEvent.click(screen.getByRole('button', { name: '五天' }))
    expect(screen.getByText('本週週末有 1 堂課')).toBeTruthy()
  })

  it('同一 recurring lesson 的兩個不同來源 occurrence 分別計入週末提示', () => {
    const first = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-12', periodId: 1 }, false, () => 'first-weekend')
    const data = moveLessonOnDate(first, 'c1', '2026-09-14', { date: '2026-09-12', periodId: 8 }, false, () => 'second-weekend')
    const onLessonClick = vi.fn()
    render(<MultiSchoolSchedule data={data} weekDays={week} onLessonClick={onLessonClick} />)
    expect(screen.getByText('本週週末有 2 堂課')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    const saturday = screen.getByText('週六').closest('.multi-day-column')!
    const cards = within(saturday as HTMLElement).getAllByLabelText('編輯 國文・二年 1 班')
    expect(cards).toHaveLength(2)
    cards.forEach((card) => fireEvent.click(card))
    expect(onLessonClick.mock.calls.map((call) => call[2])).toEqual(['first-weekend', 'second-weekend'])
  })

  it('已撤銷及取消的 occurrence 不計入週末提示，切換週次會更新', () => {
    const moved = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-12', periodId: 8 }, false, () => 'weekend-move')
    const nextWeek = Array.from({ length: 5 }, (_, index) => new Date(2026, 8, 14 + index))
    const view = render(<MultiSchoolSchedule data={moved} weekDays={week} />)
    expect(screen.getByText('本週週末有 1 堂課')).toBeTruthy()
    view.rerender(<MultiSchoolSchedule data={moved} weekDays={nextWeek} />)
    expect(screen.queryByText('本週週末有 1 堂課')).toBeNull()
    const cancelled = cancelLessonOnDate(revokeLessonOverride(moved, 'weekend-move'), 'c1', '2026-09-07', () => 'cancel-source')
    view.rerender(<MultiSchoolSchedule data={cancelled} weekDays={week} />)
    expect(screen.queryByText(/本週週末有/)).toBeNull()
  })

  it('各校與學制篩選只計算目前範圍的週末 occurrence', () => {
    const data = setup()
    const first = data.teachingUnits[0]
    const base = data.recurringLessons.find((item) => item.id === 'c1')!
    data.teachingUnits.push({ ...structuredClone(first), id: 'unit-two', name: '第二學制', schoolLevel: 'junior-high' })
    data.classes.push({ id: 'class-two', projectId: first.projectId, teachingUnitId: 'unit-two', name: '第二班' })
    data.recurringLessons.push({ ...base, id: 'lesson-two', seriesId: 'lesson-two', teachingUnitId: 'unit-two', classId: 'class-two', periodId: 8 })
    data.schools.push({ id: 'school-two', projectId: first.projectId, name: '第二校', color: '#556677' })
    data.teachingUnits.push({ ...structuredClone(first), id: 'unit-three', schoolId: 'school-two' })
    data.classes.push({ id: 'class-three', projectId: first.projectId, teachingUnitId: 'unit-three', name: '第三班' })
    data.recurringLessons.push({ ...base, id: 'lesson-three', seriesId: 'lesson-three', teachingUnitId: 'unit-three', classId: 'class-three', periodId: 8 })
    let moved = moveLessonOnDate(data, 'c1', '2026-09-07', { date: '2026-09-12', periodId: 1 }, false, () => 'move-one')
    moved = moveLessonOnDate(moved, 'lesson-two', '2026-09-07', { date: '2026-09-12', periodId: 8 }, false, () => 'move-two')
    moved = moveLessonOnDate(moved, 'lesson-three', '2026-09-07', { date: '2026-09-06', periodId: 8 }, false, () => 'move-three')
    render(<MultiSchoolSchedule data={moved} weekDays={week} />)
    expect(screen.getByText('本週週末有 3 堂課')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '各校課表' }))
    expect(screen.getByText('本週週末有 2 堂課')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('篩選學制'), { target: { value: 'unit-two' } })
    expect(screen.getByText('本週週末有 1 堂課')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'school-two' } })
    expect(screen.getByText('本週週末有 1 堂課')).toBeTruthy()
  })

  it('週末提示遵守 Timetable 隔離，七天捲動容器內卡片可操作', () => {
    const data = migrateV5ToV6(migrateV4ToV5(setup()))
    const firstTimetableId = data.timetables[0].id
    const firstLesson = data.recurringLessons.find((item) => item.id === 'c1')!
    data.timetables.push({ id: 'teacher-b', projectId: firstLesson.projectId, name: 'B 課表', teacherName: '林老師' })
    data.recurringLessons.push({ ...firstLesson, id: 'b1', seriesId: 'b1', timetableId: 'teacher-b' })
    const moved = moveLessonOnDate(data, 'c1', '2026-09-07', { date: '2026-09-12', periodId: 8 }, false, () => 'weekend-a', firstTimetableId)
    const onLessonClick = vi.fn()
    const view = render(<MultiSchoolSchedule data={moved} weekDays={week} timetableId="teacher-b" onLessonClick={onLessonClick} />)
    expect(screen.queryByText(/本週週末有/)).toBeNull()
    view.rerender(<MultiSchoolSchedule data={moved} weekDays={week} timetableId={firstTimetableId} onLessonClick={onLessonClick} />)
    expect(screen.getByText('本週週末有 1 堂課')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    expect(view.container.querySelector('.multi-schedule-scroll .multi-week-grid.seven-days')).toBeTruthy()
    const saturday = screen.getByText('週六').closest('.multi-day-column')!
    fireEvent.click(within(saturday as HTMLElement).getByRole('button', { name: '編輯 國文・二年 1 班' }))
    expect(onLessonClick).toHaveBeenCalledWith('c1', '2026-09-12', 'weekend-a')
  })

  it('封存 Project 的週末卡片維持唯讀', () => {
    const data = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-12', periodId: 8 }, false, () => 'archived-weekend')
    data.projects[0].archivedAt = '2026-10-01T00:00:00.000Z'
    data.activeProjectId = null
    const projectId = data.projects[0].id
    render(<MultiSchoolSchedule data={data} projectId={projectId} weekDays={week} />)
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    const saturday = screen.getByText('週六').closest('.multi-day-column')!
    const card = within(saturday as HTMLElement).getByRole('button', { name: '編輯 國文・二年 1 班' }) as HTMLButtonElement
    expect(card.disabled).toBe(true)
    expect(card.getAttribute('draggable')).toBe('false')
  })
})

describe('MultiSchoolSchedule one-off occurrences', () => {
  const v7 = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(setup())))
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const oneOff = (data: ReturnType<typeof v7>, date: string, time: { mode: 'period'; periodId: number } | { mode: 'custom'; startTime: string; endTime: string }, n = 1, allowConflict = false) => createOneOffLesson(data, {
    projectId: data.projects[0].id, timetableId: data.timetables[0].id, teachingUnitId: data.teachingUnits[0].id,
    classId: data.classes[0].id, subjectId: data.subjects[0].id, date, purpose: n === 2 ? 'make-up' : 'extra', time,
  }, () => uuid(n), allowConflict)

  it('renders period and custom cards at their resolved times; one-off click is separate and never draggable', () => {
    const first = oneOff(v7(), '2026-09-08', { mode: 'period', periodId: 3 })
    const data = oneOff(first, '2026-09-08', { mode: 'custom', startTime: '18:10', endTime: '19:00' }, 2)
    const onOneOffClick = vi.fn()
    const onLessonClick = vi.fn()
    const onLessonDrop = vi.fn()
    render(<MultiSchoolSchedule data={data} weekDays={week} timetableId={data.timetables[0].id} onOneOffClick={onOneOffClick} onLessonClick={onLessonClick} onLessonDrop={onLessonDrop} />)
    const tuesday = screen.getByLabelText('2026-09-08 課表')
    const cards = tuesday.querySelectorAll<HTMLButtonElement>('.multi-lesson-card.one-off')
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('第 3 節')
    expect(cards[0].textContent).toContain('10:10–11:00')
    expect(cards[1].textContent).toContain('自訂時間')
    expect(cards[1].textContent).toContain('18:10–19:00')
    expect(cards[1].textContent).toContain('補課')
    expect(cards[0].getAttribute('draggable')).toBe('false')
    fireEvent.click(cards[0])
    expect(onOneOffClick).toHaveBeenCalledWith(uuid(1))
    expect(onLessonClick).not.toHaveBeenCalled()
    fireEvent.dragStart(cards[0], { dataTransfer: transfer() })
    expect(screen.queryByText(/正在拖曳/)).toBeNull()
    expect(onLessonDrop).not.toHaveBeenCalled()
  })

  it('counts Sunday-before-Monday and Saturday one-offs without date-column add buttons', () => {
    const first = oneOff(v7(), '2026-09-06', { mode: 'custom', startTime: '18:00', endTime: '19:00' })
    const data = oneOff(first, '2026-09-12', { mode: 'period', periodId: 1 }, 2)
    render(<MultiSchoolSchedule data={data} weekDays={week} timetableId={data.timetables[0].id} />)
    expect(screen.queryByRole('button', { name: /新增單日課程/ })).toBeNull()
    expect(screen.getByText('本週週末有 2 堂課')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    const columns = [...document.querySelectorAll('.multi-day-column')]
    expect(columns[0].getAttribute('aria-label')).toBe('2026-09-06 課表')
    expect(columns[6].getAttribute('aria-label')).toBe('2026-09-12 課表')
    expect(columns[0].querySelector('.one-off')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /新增單日課程/ })).toBeNull()
    expect(screen.queryByLabelText('2026-09-13 課表')).toBeNull()
  })

  it('filters one-offs by timetable and school, while retaining both collision cards and their colors', () => {
    const data = v7()
    data.timetables.push({ ...data.timetables[0], id: 'teacher-b', name: 'B 課表' })
    const first = oneOff(data, '2026-09-07', { mode: 'period', periodId: 1 }, 1, true)
    const second = oneOff(first, '2026-09-07', { mode: 'custom', startTime: '08:15', endTime: '08:45' }, 2, true)
    const view = render(<MultiSchoolSchedule data={second} weekDays={week} timetableId={second.timetables[0].id} />)
    const monday = screen.getByLabelText('2026-09-07 課表')
    expect(monday.querySelectorAll('.multi-lesson-card.conflict')).toHaveLength(3)
    expect(monday.querySelectorAll('.multi-lesson-card.one-off')).toHaveLength(2)
    expect((monday.querySelector('.multi-lesson-card.one-off') as HTMLElement).style.getPropertyValue('--subject-color')).toBe(second.subjects[0].color)
    view.rerender(<MultiSchoolSchedule data={second} weekDays={week} timetableId="teacher-b" />)
    expect(screen.getByLabelText('2026-09-07 課表').querySelectorAll('.multi-lesson-card.one-off')).toHaveLength(0)
  })

  it('keeps weekend one-off counts scoped to school and teaching unit filters', () => {
    const data = v7()
    const firstUnit = data.teachingUnits[0]
    data.schools.push({ ...data.schools[0], id: 'school-b', name: '乙校' })
    data.teachingUnits.push({ ...structuredClone(firstUnit), id: 'unit-b', schoolId: 'school-b', name: '乙校國中部' })
    data.classes.push({ ...data.classes[0], id: 'class-b', teachingUnitId: 'unit-b', name: '乙班' })
    const first = oneOff(data, '2026-09-06', { mode: 'custom', startTime: '09:00', endTime: '10:00' })
    const second = createOneOffLesson(first, {
      projectId: data.projects[0].id, timetableId: data.timetables[0].id, teachingUnitId: 'unit-b', classId: 'class-b',
      subjectId: data.subjects[0].id, date: '2026-09-12', purpose: 'substitute',
      time: { mode: 'custom', startTime: '11:00', endTime: '12:00' },
    }, () => uuid(2))
    render(<MultiSchoolSchedule data={second} weekDays={week} timetableId={data.timetables[0].id} />)
    expect(screen.getByText('本週週末有 2 堂課')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '各校課表' }))
    expect(screen.getByText('本週週末有 1 堂課')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'school-b' } })
    fireEvent.change(screen.getByLabelText('篩選學制'), { target: { value: 'unit-b' } })
    expect(screen.getByText('本週週末有 1 堂課')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    expect(screen.getByLabelText('2026-09-12 課表').querySelectorAll('.one-off')).toHaveLength(1)
    expect(screen.getByLabelText('2026-09-06 課表').querySelectorAll('.one-off')).toHaveLength(0)
  })
})

const displayOccurrence = (overrides: Partial<ScheduleDisplayOccurrence> = {}): ScheduleDisplayOccurrence => ({
  key: 'display-lesson', id: 'display-lesson', kind: 'recurring', date: '2026-09-07',
  startTime: '08:00', endTime: '08:50', teachingUnitId: 'unit-a', schoolId: 'school-a',
  schoolName: '甲校', schoolColor: '#556677', teachingUnitName: '高中部', subjectName: 'V9 國文',
  subjectColor: '#A66D52', className: 'V9 甲班', hasConflict: false, status: 'regular', periodLabel: '第 1 節',
  ...overrides,
})
const displayDays = (byDate: Record<string, readonly ScheduleDisplayOccurrence[]>): readonly ScheduleDisplayDay[] =>
  Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2026, 8, 6 + index)
    const key = `2026-09-${String(6 + index).padStart(2, '0')}`
    return { date, lessons: byDate[key] ?? [] }
  })
const displaySchools = [{ id: 'school-a', name: '甲校' }, { id: 'school-b', name: '乙校' }]
const displayUnits = [
  { id: 'unit-a', schoolId: 'school-a', name: '高中部', schoolLevel: 'senior-high' as const },
  { id: 'unit-b', schoolId: 'school-b', name: '國中部', schoolLevel: 'junior-high' as const },
]

describe('MultiSchoolSchedule resolved V9 read-only data', () => {
  it('keeps source/cancelled placeholders visible but out of teaching counts, conflicts, and short breaks', () => {
    const source = displayOccurrence({ key: 'source', status: 'moved', movementRole: 'source', hasConflict: true })
    const regular = displayOccurrence({ key: 'regular', id: 'regular', startTime: '09:00', endTime: '09:50',
      subjectName: 'V9 英文', hasConflict: true })
    const target = displayOccurrence({ key: 'target', id: 'target', date: '2026-09-08', status: 'moved',
      movementRole: 'target', subjectName: 'V9 數學', hasConflict: true })
    const cancelled = displayOccurrence({ key: 'cancelled', id: 'cancelled', date: '2026-09-09',
      status: 'cancelled', subjectName: 'V9 歷史', hasConflict: true })
    const weekendSource = displayOccurrence({ key: 'weekend-source', id: 'weekend-source', date: '2026-09-12',
      status: 'moved', movementRole: 'source', subjectName: 'V9 週末來源' })
    render(<MultiSchoolSchedule mode="resolved" weekDays={week} readStatus="ready"
      days={displayDays({ '2026-09-07': [source, regular], '2026-09-08': [target],
        '2026-09-09': [cancelled], '2026-09-12': [weekendSource] })}
      schools={displaySchools} teachingUnits={displayUnits} />)

    const sourceCard = screen.getByRole('button', { name: '課程 V9 國文・V9 甲班・已調離' }) as HTMLButtonElement
    expect(sourceCard.disabled).toBe(true)
    expect(sourceCard.getAttribute('draggable')).toBe('false')
    expect(sourceCard.className).not.toContain('conflict')
    expect(sourceCard.textContent).not.toContain('衝堂')
    expect(screen.getByRole('button', { name: '課程 V9 英文・V9 甲班' }).className).not.toContain('short-break')
    expect(screen.getByRole('button', { name: '課程 V9 數學・V9 甲班・調入' }).className).toContain('conflict')
    expect(screen.getByRole('button', { name: '課程 V9 歷史・V9 甲班・單日取消' }).className).not.toContain('conflict')
    expect(screen.queryByText(/本週週末有/)).toBeNull()
    expect(document.querySelector('.lesson-drop-targets')).toBeNull()
    expect(screen.queryByRole('button', { name: /編輯.*V9/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    expect(screen.getByRole('button', { name: '課程 V9 週末來源・V9 甲班・已調離' })).toBeTruthy()
  })

  it('retains 5/7-day and school filters while reporting only an explicit unit for the header', () => {
    const onHeaderTeachingUnitChange = vi.fn()
    const unitA = displayOccurrence({ key: 'unit-a-lesson', subjectName: '甲校課程' })
    const unitB = displayOccurrence({ key: 'unit-b-lesson', id: 'unit-b-lesson', teachingUnitId: 'unit-b',
      schoolId: 'school-b', schoolName: '乙校', teachingUnitName: '國中部', subjectName: '乙校課程' })
    render(<MultiSchoolSchedule mode="resolved" weekDays={week} readStatus="ready"
      days={displayDays({ '2026-09-07': [unitA, unitB] })} schools={displaySchools}
      teachingUnits={displayUnits} onHeaderTeachingUnitChange={onHeaderTeachingUnitChange} />)

    expect(document.querySelectorAll('.multi-day-column')).toHaveLength(5)
    expect(screen.getByText('甲校課程')).toBeTruthy()
    expect(screen.getByText('乙校課程')).toBeTruthy()
    expect(onHeaderTeachingUnitChange).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('tab', { name: '各校課表' }))
    expect(screen.getByText('甲校課程')).toBeTruthy()
    expect(screen.queryByText('乙校課程')).toBeNull()
    expect(onHeaderTeachingUnitChange).toHaveBeenLastCalledWith(null)
    fireEvent.change(screen.getByLabelText('篩選學制'), { target: { value: 'unit-a' } })
    expect(onHeaderTeachingUnitChange).toHaveBeenLastCalledWith('unit-a')
    fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'school-b' } })
    expect(screen.getByText('乙校課程')).toBeTruthy()
    expect(screen.queryByText('甲校課程')).toBeNull()
    expect(onHeaderTeachingUnitChange).toHaveBeenLastCalledWith(null)
    fireEvent.change(screen.getByLabelText('篩選學制'), { target: { value: 'unit-b' } })
    expect(onHeaderTeachingUnitChange).toHaveBeenLastCalledWith('unit-b')
    fireEvent.click(screen.getByRole('tab', { name: '總課表' }))
    expect(screen.getByText('甲校課程')).toBeTruthy()
    expect(screen.getByText('乙校課程')).toBeTruthy()
    expect(onHeaderTeachingUnitChange).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: '七天' }))
    expect(document.querySelectorAll('.multi-day-column')).toHaveLength(7)
  })

  it.each([
    ['unset-term', '尚未設定學期'],
    ['invalid-scope', '目前選取的課表或授課單位無法使用'],
    ['invalid-document', '課表資料無法通過驗證'],
  ] as const)('renders the resolved %s status without treating it as an empty ready schedule', (readStatus, message) => {
    render(<MultiSchoolSchedule mode="resolved" weekDays={week} readStatus={readStatus}
      days={displayDays({})} schools={displaySchools} teachingUnits={displayUnits} />)
    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.queryByText('無有效課程')).toBeNull()
  })
})

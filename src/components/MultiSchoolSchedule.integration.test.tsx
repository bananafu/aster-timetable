// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelLessonOnDate } from '../data/lessonChangesV4'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { initialData } from '../data/seed'
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

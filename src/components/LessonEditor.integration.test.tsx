// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelLessonOnDate, moveLessonOnDate, permanentlyUpdateLesson } from '../data/lessonChangesV4'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { initialData } from '../data/seed'
import { LessonEditor } from './LessonEditor'

afterEach(cleanup)

function setup() {
  return migrateV3ToV4(structuredClone(initialData))
}

describe('LessonEditor integrated experience', () => {
  it('顯示點擊日期的完整課程脈絡與 A/B 狀態', () => {
    const data = setup()
    render(<LessonEditor data={data} setData={vi.fn()} lessonId="c3" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByLabelText('目前課程資訊').textContent).toContain('我的學校')
    expect(screen.getByLabelText('目前課程資訊').textContent).toContain('公民與社會')
    expect(screen.getByLabelText('目前課程資訊').textContent).toContain('2026-09-07・A 週')
    expect(screen.getByLabelText('目前課程資訊').textContent).toContain('第 6 節・14:10–15:00')
  })

  it('單日移動先顯示原位置與目標位置，確認前不寫入', () => {
    const data = setup()
    const setData = vi.fn()
    render(<LessonEditor data={data} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /僅此日期/ }))
    fireEvent.change(screen.getByLabelText('課程異動類型'), { target: { value: 'move' } })
    fireEvent.change(screen.getByLabelText('移至節次'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    expect(setData).not.toHaveBeenCalled()
    const preview = screen.getByLabelText('異動預覽')
    expect(preview.textContent).toContain('原位置：2026-09-07・週一・第 1 節 08:10–09:00（將留白）')
    expect(preview.textContent).toContain('目標位置：2026-09-07・第 8 節 16:10–17:00')
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    expect(setData).toHaveBeenCalledTimes(1)
  })

  it('版本歷史呈現生效範圍且不提供過去版本回寫入口', () => {
    const data = setup()
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    const unit = data.teachingUnits.find((item) => item.id === lesson.teachingUnitId)!
    const school = data.schools.find((item) => item.id === unit.schoolId)!
    const versioned = permanentlyUpdateLesson(data, lesson.id, '2026-09-14', {
      projectId: lesson.projectId, schoolId: school.id, teachingUnitId: unit.id, subjectId: lesson.subjectId,
      classId: lesson.classId, day: lesson.day, periodId: 2, weekPattern: lesson.weekPattern, room: lesson.room,
    }, () => 'c1-v2')
    render(<LessonEditor data={versioned} setData={vi.fn()} lessonId="c1-v2" occurrenceDate="2026-09-14" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByText('課程版本歷史（2）'))
    expect(screen.getByText('2026-08-31 — 2026-09-13')).toBeTruthy()
    expect(screen.getByText('2026-09-14 — 2027-01-20')).toBeTruthy()
    expect(screen.getByText('歷史版本僅供檢視，不可直接回寫。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /回復|修改歷史/ })).toBeNull()
  })

  it('從歷史日期開啟已結束版本時只提供唯讀檢視', () => {
    const data = setup()
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    lesson.effectiveEnd = '2026-09-13'
    data.recurringLessons.push({ ...lesson, id: 'c1-v2', effectiveStart: '2026-09-14', effectiveEnd: '2027-01-20' })
    render(<LessonEditor data={data} setData={vi.fn()} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('目前選取的是已結束的歷史版本，只能查看，不可直接修改或新增異動。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '儲存' })).toBeNull()
    expect(screen.getByRole('button', { name: '關閉' })).toBeTruthy()
  })

  it('Escape 可安全取消編輯器且不寫入', () => {
    const data = setup()
    const setData = vi.fn()
    const onClose = vi.fn()
    render(<LessonEditor data={data} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(setData).not.toHaveBeenCalled()
  })

  it('顯示並預覽撤銷現有移動，確認後原子移除 override', () => {
    const moved = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-07', periodId: 8 }, false, () => 'move-existing')
    const setData = vi.fn()
    render(<LessonEditor data={moved} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByLabelText('現有單日異動').textContent).toContain('單日移動')
    fireEvent.click(screen.getByRole('button', { name: '撤銷異動' }))
    expect(setData).not.toHaveBeenCalled()
    expect(screen.getByLabelText('異動預覽').textContent).toContain('撤銷單日移動')
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    expect((setData.mock.calls[0][0] as ReturnType<typeof setup>).overrides).toHaveLength(0)
  })

  it('修改既有異動時以新紀錄取代舊紀錄', () => {
    const cancelled = cancelLessonOnDate(setup(), 'c1', '2026-09-07', () => 'cancel-existing')
    const setData = vi.fn()
    render(<LessonEditor data={cancelled} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '修改此異動' }))
    expect(screen.getByText(/正在改寫既有單日異動/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('課程異動類型'), { target: { value: 'move' } })
    fireEvent.change(screen.getByLabelText('移至節次'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    const result = setData.mock.calls[0][0] as ReturnType<typeof setup>
    expect(result.overrides).toHaveLength(1)
    expect(result.overrides[0]).toMatchObject({ action: 'move', originalLessonId: 'c1', target: { periodId: 8 } })
    expect(result.overrides[0].id).not.toBe('cancel-existing')
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataV8 } from '../types'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { createBlankProject } from '../data/projectRuntimeV8'
import { createSubject, configureSubjectForTeachingUnit } from '../data/subjectsV8'
import { createClassV8 } from '../data/classesV8'
import { createTeacherTimetableV8 } from '../data/timetablesV8'
import { createRecurringLessonV8 } from '../data/recurringLessonsV8'
import { OneTimeLessonManagerV8 } from './OneTimeLessonManagerV8'

function fixture() {
  let id = 0
  let data = createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `base-${++id}`)
  const projectId = data.activeProjectId!
  const unit = data.teachingUnits[0]
  data = createSubject(data, projectId, { name: '數學', shortName: '數', color: '#123456',
    applicableSchoolLevels: ['senior-high'] }, 'subject-a')
  data = createClassV8(data, projectId, { teachingUnitId: unit.id, name: '一甲' }, 'class-a')
  data = configureSubjectForTeachingUnit(data, projectId, unit.id, 'subject-a', 'relation-a')
  data = createTeacherTimetableV8(data, projectId, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV8(data, projectId, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  data = createRecurringLessonV8(data, { projectId, timetableId: 'teacher-a', teachingUnitId: unit.id,
    classId: 'class-a', subjectId: 'subject-a', day: 1, periodId: unit.periods[0].id,
    weekPattern: 'every' }, 'lesson-a')
  return data
}
const persistence = { pending: false, revision: 0, receipt: null }
function mount(overrides: Partial<Parameters<typeof OneTimeLessonManagerV8>[0]> = {}) {
  const props = { data: fixture(), setData: vi.fn(), status: 'saved' as const, persistence,
    writable: true, exportLocalJson: () => '{}', onExport: vi.fn(), onRecover: vi.fn(), onClose: vi.fn(), ...overrides }
  return { props, ...render(<OneTimeLessonManagerV8 {...props} />) }
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('standalone V8 one-time Lesson manager', () => {
  it('keeps move, cancellation and extra as distinct forms and confirms exact Host receipt', () => {
    const { props, rerender } = mount()
    fireEvent.click(screen.getByText('僅此次停課'))
    fireEvent.change(screen.getByLabelText('原固定課程'), { target: { value: 'lesson-a' } })
    fireEvent.change(screen.getByLabelText('原始上課日期'), { target: { value: '2026-09-07' } })
    fireEvent.submit(screen.getByLabelText('單次課程表單'))
    const next = vi.mocked(props.setData).mock.calls[0][0] as AppDataV8
    expect(next.overrides).toMatchObject([{ action: 'cancel', originalLessonId: 'lesson-a' }])
    expect(next.recurringLessons).toEqual(props.data.recurringLessons)
    rerender(<OneTimeLessonManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: JSON.stringify(next), revision: 2 } }} />)
    expect(screen.queryByText('V8 單次課程操作已確認儲存。')).toBeNull()
    rerender(<OneTimeLessonManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: 'other', revision: 1 } }} />)
    expect(screen.queryByText('V8 單次課程操作已確認儲存。')).toBeNull()
    rerender(<OneTimeLessonManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: JSON.stringify(next), revision: 1 } }} />)
    expect(screen.getByText('V8 單次課程操作已確認儲存。')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('檢視日期'), { target: { value: '2026-09-07' } })
    expect(screen.getByText('當日沒有有效課程。')).toBeTruthy()
  })

  it('blocks read-only and conflict writes, preserves failed draft and confirms discard', () => {
    const { props, rerender } = mount({ writable: false, status: 'conflict' })
    expect((screen.getByText('僅此次調課') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('匯出本頁 JSON'))
    expect(props.onExport).toHaveBeenCalledWith('{}')
    rerender(<OneTimeLessonManagerV8 {...props} writable status="saved" />)
    fireEvent.click(screen.getByText('額外新增課程'))
    fireEvent.change(screen.getByLabelText('任教單位'), { target: { value: props.data.teachingUnits[0].id } })
    fireEvent.change(screen.getByLabelText('班級'), { target: { value: 'class-a' } })
    fireEvent.change(screen.getByLabelText('科目'), { target: { value: 'subject-a' } })
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-09-08' } })
    fireEvent.change(screen.getByLabelText('節次'), { target: { value: String(props.data.teachingUnits[0].periods[0].id) } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByText('完成'))
    expect(confirm).toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.submit(screen.getByLabelText('單次課程表單'))
    expect(props.setData).toHaveBeenCalledOnce()
    rerender(<OneTimeLessonManagerV8 {...props} status="write-error" />)
    expect(screen.getByRole('alert').textContent).toContain('草稿已保留')
    expect((screen.getByLabelText('日期') as HTMLInputElement).value).toBe('2026-09-08')
  })

  it('rejects stale Timetable, Project and document snapshots before persisting', () => {
    const { props, rerender } = mount()
    fireEvent.click(screen.getByText('僅此次調課'))
    fireEvent.change(screen.getByLabelText('原固定課程'), { target: { value: 'lesson-a' } })
    fireEvent.change(screen.getByLabelText('原始上課日期'), { target: { value: '2026-09-07' } })
    fireEvent.change(screen.getByLabelText('目標日期'), { target: { value: '2026-09-08' } })
    fireEvent.change(screen.getByLabelText('目標節次'), { target: { value: String(props.data.teachingUnits[0].periods[0].id) } })
    fireEvent.change(screen.getByLabelText('教師課表'), { target: { value: 'teacher-b' } })
    fireEvent.submit(screen.getByLabelText('單次課程表單'))
    expect(props.setData).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('草稿已保留')
    rerender(<OneTimeLessonManagerV8 {...props} data={{ ...props.data, activeProjectId: null }} />)
    fireEvent.submit(screen.getByLabelText('單次課程表單'))
    expect(props.setData).not.toHaveBeenCalled()
  })
})

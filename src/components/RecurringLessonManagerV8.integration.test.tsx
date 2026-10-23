// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataV8 } from '../types'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { createBlankProject } from '../data/projectRuntimeV8'
import { createSubject, configureSubjectForTeachingUnit } from '../data/subjectsV8'
import { createClassV8 } from '../data/classesV8'
import { createTeacherTimetableV8 } from '../data/timetablesV8'
import { RecurringLessonManagerV8 } from './RecurringLessonManagerV8'

function fixture() {
  let id = 0
  let data = createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `base-${++id}`)
  const projectId = data.activeProjectId!
  const unitId = data.teachingUnits[0].id
  data = createSubject(data, projectId, { name: '數學', shortName: '數', color: '#123456',
    applicableSchoolLevels: ['senior-high'] }, 'subject-a')
  data = createClassV8(data, projectId, { teachingUnitId: unitId, name: '一甲' }, 'class-a')
  data = configureSubjectForTeachingUnit(data, projectId, unitId, 'subject-a', 'relation-a')
  data = createTeacherTimetableV8(data, projectId, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV8(data, projectId, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  return data
}
const persistence = { pending: false, revision: 0, receipt: null }
function mount(overrides: Partial<Parameters<typeof RecurringLessonManagerV8>[0]> = {}) {
  const props = { data: fixture(), setData: vi.fn(), status: 'saved' as const, persistence,
    writable: true, exportLocalJson: () => '{}', onExport: vi.fn(), onRecover: vi.fn(), onClose: vi.fn(), ...overrides }
  return { props, ...render(<RecurringLessonManagerV8 {...props} />) }
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function fill(data: AppDataV8) {
  fireEvent.click(screen.getByText('新增固定課程'))
  fireEvent.change(screen.getByLabelText('任教單位'), { target: { value: data.teachingUnits[0].id } })
  fireEvent.change(screen.getByLabelText('班級'), { target: { value: 'class-a' } })
  fireEvent.change(screen.getByLabelText('科目'), { target: { value: 'subject-a' } })
  fireEvent.change(screen.getByLabelText('節次'), { target: { value: String(data.teachingUnits[0].periods[0].id) } })
  fireEvent.change(screen.getByLabelText('週別'), { target: { value: 'A' } })
}

describe('standalone V8 Recurring Lesson manager', () => {
  it('offers scoped options and waits for exact raw and revision receipt', () => {
    const { props, rerender } = mount()
    expect(screen.getByText('目前教師課表尚無固定課程。')).toBeTruthy()
    fill(props.data)
    fireEvent.submit(screen.getByLabelText('固定課程表單'))
    const next = vi.mocked(props.setData).mock.calls[0][0] as AppDataV8
    expect(next.recurringLessons[0]).toMatchObject({ projectId: props.data.activeProjectId,
      timetableId: 'teacher-a', classId: 'class-a', subjectId: 'subject-a', weekPattern: 'A' })
    rerender(<RecurringLessonManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: JSON.stringify(next), revision: 2 } }} />)
    expect(screen.queryByText('V8 固定課程已確認儲存。')).toBeNull()
    rerender(<RecurringLessonManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: 'wrong', revision: 1 } }} />)
    expect(screen.queryByText('V8 固定課程已確認儲存。')).toBeNull()
    rerender(<RecurringLessonManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: JSON.stringify(next), revision: 1 } }} />)
    expect(screen.getByText('V8 固定課程已確認儲存。')).toBeTruthy()
  })

  it('blocks read-only writes, keeps failed draft and confirms dismissal', () => {
    const { props, rerender } = mount({ writable: false, status: 'conflict' })
    expect((screen.getByText('新增固定課程') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('匯出本頁 JSON'))
    expect(props.onExport).toHaveBeenCalledWith('{}')
    rerender(<RecurringLessonManagerV8 {...props} writable status="saved" />)
    fill(props.data)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByText('完成'))
    expect(confirm).toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.submit(screen.getByLabelText('固定課程表單'))
    rerender(<RecurringLessonManagerV8 {...props} status="write-error" />)
    expect(screen.getByRole('alert').textContent).toContain('草稿已保留')
    expect((screen.getByLabelText('週別') as HTMLSelectElement).value).toBe('A')
  })

  it('blocks a draft after Timetable or Project changes', () => {
    const { props, rerender } = mount()
    fill(props.data)
    fireEvent.change(screen.getByLabelText('教師課表'), { target: { value: 'teacher-b' } })
    fireEvent.submit(screen.getByLabelText('固定課程表單'))
    expect(props.setData).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('草稿已保留')
    rerender(<RecurringLessonManagerV8 {...props} data={{ ...props.data, activeProjectId: null }} />)
    fireEvent.submit(screen.getByLabelText('固定課程表單'))
    expect(props.setData).not.toHaveBeenCalled()
  })
})

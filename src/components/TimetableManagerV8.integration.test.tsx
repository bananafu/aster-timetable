// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataV8 } from '../types'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { createBlankProject } from '../data/projectRuntimeV8'
import { createTeacherTimetableV8 } from '../data/timetablesV8'
import { createSubjectForTeachingUnit } from '../data/subjectsV8'
import { TimetableManagerV8 } from './TimetableManagerV8'

function fixture() {
  let count = 0
  const first = createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115, semester: 'first',
    startDate: '2026-08-01', endDate: '2027-01-31' }, () => `a-${++count}`)
  return createBlankProject(first, { name: 'B', academicYear: 116, semester: 'first',
    startDate: '2027-08-01', endDate: '2028-01-31' }, () => `b-${++count}`)
}
const persistence = { pending: false, revision: 0, receipt: null }
function mount(overrides: Partial<Parameters<typeof TimetableManagerV8>[0]> = {}) {
  const props = { data: fixture(), setData: vi.fn(), status: 'saved' as const, persistence,
    writable: true, onClose: vi.fn(), onExport: vi.fn(), exportLocalJson: () => '{}',
    onRecover: vi.fn(), ...overrides }
  return { props, ...render(<TimetableManagerV8 {...props} />) }
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('standalone V8 teacher Timetable manager', () => {
  it('creates an empty teacher timetable and only reports success for the matching receipt', () => {
    const { props, rerender } = mount()
    expect(screen.getByText('目前專案尚無教師課表。')).toBeTruthy()
    fireEvent.click(screen.getByText('新增教師課表'))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '甲課表' } })
    fireEvent.change(screen.getByLabelText('教師名稱'), { target: { value: '甲老師' } })
    fireEvent.submit(screen.getByLabelText('教師課表表單'))
    const next = vi.mocked(props.setData).mock.calls[0][0] as AppDataV8
    expect(next.timetables).toHaveLength(1)
    expect(next.recurringLessons).toEqual([])
    expect(next.events).toEqual([])
    expect(screen.queryByText('V8 教師課表已確認儲存。')).toBeNull()
    rerender(<TimetableManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: 'wrong', revision: 1 } }} />)
    expect(screen.queryByText('V8 教師課表已確認儲存。')).toBeNull()
    rerender(<TimetableManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: JSON.stringify(next), revision: 2 } }} />)
    expect(screen.queryByText('V8 教師課表已確認儲存。')).toBeNull()
    rerender(<TimetableManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: JSON.stringify(next), revision: 1 } }} />)
    expect(screen.getByText('V8 教師課表已確認儲存。')).toBeTruthy()
  })

  it('revalidates selected timetable after Project switch and stays read-only in conflict', () => {
    const base = fixture()
    const a = base.projects[0].id
    const b = base.projects[1].id
    const withA = createTeacherTimetableV8(base, a, { name: '同名', teacherName: '甲' }, 'teacher-a')
    const withB = createTeacherTimetableV8(withA, b, { name: '同名', teacherName: '乙' }, 'teacher-b')
    const { props, rerender } = mount({ data: { ...withB, activeProjectId: a } })
    expect((screen.getByLabelText('目前選取的教師課表') as HTMLSelectElement).value).toBe('teacher-a')
    rerender(<TimetableManagerV8 {...props} data={{ ...withB, activeProjectId: b }} writable={false} status="conflict" />)
    expect((screen.getByLabelText('目前選取的教師課表') as HTMLSelectElement).value).toBe('teacher-b')
    expect((screen.getByRole('button', { name: /新增教師課表/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('匯出本頁 JSON'))
    expect(props.onExport).toHaveBeenCalledWith('{}')
  })

  it('keeps draft on write failure and confirms discard', () => {
    const { props, rerender } = mount()
    fireEvent.click(screen.getByText('新增教師課表'))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '草稿' } })
    fireEvent.change(screen.getByLabelText('教師名稱'), { target: { value: '甲' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByLabelText('關閉對話框'))
    expect(confirm).toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.submit(screen.getByLabelText('教師課表表單'))
    rerender(<TimetableManagerV8 {...props} status="write-error" />)
    expect(screen.getAllByRole('alert').some((item) => item.textContent?.includes('草稿已保留'))).toBe(true)
    expect((screen.getByLabelText('課表名稱') as HTMLInputElement).value).toBe('草稿')
  })

  it('requires explicit source and destination for settings-only copy', () => {
    const base = fixture()
    const [a, b] = base.projects
    const withTeacher = createTeacherTimetableV8(base, a.id, { name: '來源', teacherName: '甲' }, 'source-teacher')
    const { props } = mount({ data: { ...withTeacher, activeProjectId: a.id } })
    fireEvent.click(screen.getByText('複製課表設定'))
    expect(screen.getByText(/僅複製課表名稱與教師名稱/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('來源課表'), { target: { value: 'source-teacher' } })
    fireEvent.change(screen.getByLabelText('目的專案'), { target: { value: b.id } })
    fireEvent.submit(screen.getByLabelText('教師課表表單'))
    const next = vi.mocked(props.setData).mock.calls[0][0] as AppDataV8
    expect(next.timetables).toHaveLength(2)
    expect(next.timetables.find((item) => item.projectId === b.id)).toMatchObject({ name: '來源（副本）', teacherName: '甲' })
    expect(next.timetables.find((item) => item.projectId === b.id)?.id).not.toBe('source-teacher')
    expect(next.recurringLessons).toEqual([])
    expect(next.events).toEqual([])
  })

  it('shows deletion impact and requires confirmation without touching another Project', () => {
    const base = fixture()
    const [a, b] = base.projects
    const withA = createTeacherTimetableV8(base, a.id, { name: '可刪', teacherName: '甲' }, 'teacher-a')
    const withB = createTeacherTimetableV8(withA, b.id, { name: '保留', teacherName: '乙' }, 'teacher-b')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { props } = mount({ data: { ...withB, activeProjectId: a.id } })
    fireEvent.click(screen.getByText('刪除教師課表'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('固定課程 0'))
    const next = vi.mocked(props.setData).mock.calls[0][0] as AppDataV8
    expect(next.timetables.map((item) => item.id)).toEqual(['teacher-b'])
  })

  it('confirms timetable switches, discards old selection drafts, and blocks stale Project drafts', () => {
    const base = fixture()
    const [a, b] = base.projects
    const first = createTeacherTimetableV8(base, a.id, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
    const both = createTeacherTimetableV8(first, a.id, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
    const activeA = { ...both, activeProjectId: a.id }
    const { props, rerender } = mount({ data: activeA })
    fireEvent.click(screen.getByText('編輯教師課表'))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '修改甲' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.change(screen.getByLabelText('目前選取的教師課表'), { target: { value: 'teacher-b' } })
    expect((screen.getByLabelText('目前選取的教師課表') as HTMLSelectElement).value).toBe('teacher-a')
    expect((screen.getByLabelText('課表名稱') as HTMLInputElement).value).toBe('修改甲')
    expect(props.setData).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.change(screen.getByLabelText('目前選取的教師課表'), { target: { value: 'teacher-b' } })
    expect((screen.getByLabelText('目前選取的教師課表') as HTMLSelectElement).value).toBe('teacher-b')
    expect(screen.queryByLabelText('教師課表表單')).toBeNull()
    fireEvent.click(screen.getByText('編輯教師課表'))
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '修改乙' } })
    const activeB = { ...both, activeProjectId: b.id }
    rerender(<TimetableManagerV8 {...props} data={activeB} />)
    fireEvent.submit(screen.getByLabelText('教師課表表單'))
    expect(props.setData).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert').some((item) => item.textContent?.includes('草稿已保留'))).toBe(true)
  })

  it('does not copy Project Subjects or another teacher lesson into a new blank timetable', () => {
    const base = fixture()
    const projectId = base.activeProjectId!
    const withSubject = createSubjectForTeachingUnit(base, projectId,
      base.teachingUnits.find((unit) => unit.projectId === projectId)!.id,
      { name: '數學', shortName: '數', color: '#123456', applicableSchoolLevels: ['senior-high'] },
      'subject-a', 'relation-a')
    const withTeacher = createTeacherTimetableV8(withSubject, projectId,
      { name: '甲課表', teacherName: '甲' }, 'teacher-a')
    const { props } = mount({ data: withTeacher })
    expect(screen.getByText(/科目庫由目前專案共用；新增空白教師課表不會預選科目/)).toBeTruthy()
    fireEvent.click(screen.getByText('新增教師課表'))
    expect((screen.getByLabelText('課表名稱') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('教師名稱') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('課表名稱'), { target: { value: '乙課表' } })
    fireEvent.change(screen.getByLabelText('教師名稱'), { target: { value: '乙' } })
    fireEvent.submit(screen.getByLabelText('教師課表表單'))
    const next = vi.mocked(props.setData).mock.calls[0][0] as AppDataV8
    expect(next.timetables.map((item) => item.name)).toEqual(['甲課表', '乙課表'])
    expect(next.subjects).toEqual(withTeacher.subjects)
    expect(next.teachingUnitSubjects).toEqual(withTeacher.teachingUnitSubjects)
    expect(next.recurringLessons).toEqual(withTeacher.recurringLessons)
    expect(next.oneOffLessons).toEqual(withTeacher.oneOffLessons)
  })
})

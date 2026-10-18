// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { createOneOffLesson, deleteOneOffLesson, updateOneOffLesson } from '../data/oneOffLessonsV7'
import { initialData } from '../data/seed'
import type { AppDataV7 } from '../types'
import { OneOffLessonEditor, type OneOffSaveRequest } from './OneOffLessonEditor'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const uuid = '00000000-0000-4000-8000-000000000001'
const base = (): AppDataV7 => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
const props = (data: AppDataV7) => ({ data, projectId: data.projects[0].id, timetableId: data.timetables[0].id, initialDate: '2026-09-06', onSave: vi.fn(), onClose: vi.fn() })
const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

function fill(data: AppDataV7) {
  choose('學校', data.schools[0].id)
  choose('學制', data.teachingUnits[0].id)
  choose('班級', data.classes[0].id)
  choose('科目', data.subjects[0].id)
  choose('節次', '1')
}

describe('OneOffLessonEditor', () => {
  it('creates an independent weekend one-off request for the current timetable, without showing success or touching recurring lessons', async () => {
    const data = base()
    const original = structuredClone(data)
    const callbacks = props(data)
    render(<OneOffLessonEditor {...callbacks} />)
    expect(screen.getByRole('dialog', { name: '新增單日課程' })).toBeTruthy()
    expect((screen.getByLabelText('指定日期') as HTMLInputElement).value).toBe('2026-09-06')
    expect((screen.getByRole('button', { name: '送出新增' }) as HTMLButtonElement).disabled).toBe(true)
    fill(data)
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    await waitFor(() => expect(callbacks.onSave).toHaveBeenCalledTimes(1))
    expect(callbacks.onSave.mock.calls[0][0]).toMatchObject({ allowConflict: false, draft: {
      projectId: data.projects[0].id, timetableId: data.timetables[0].id,
      teachingUnitId: data.teachingUnits[0].id, classId: data.classes[0].id,
      subjectId: data.subjects[0].id, date: '2026-09-06', purpose: 'extra',
      time: { mode: 'period', periodId: 1 },
    } })
    expect(callbacks.onClose).not.toHaveBeenCalled()
    expect(screen.queryByText('儲存成功')).toBeNull()
    expect(data).toEqual(original)
  })

  it('offers all three purposes and optional make-up source without leaking it into substitute', async () => {
    const data = base()
    const callbacks = props(data)
    render(<OneOffLessonEditor {...callbacks} />)
    const options = [...(screen.getByLabelText('用途') as HTMLSelectElement).options].map((item) => [item.value, item.text])
    expect(options).toEqual([['extra', '單日新增'], ['make-up', '補課'], ['substitute', '代課']])
    choose('用途', 'make-up')
    expect((screen.getByLabelText('補課來源（選填）') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('補課來源（選填）') as HTMLSelectElement).options.length).toBeGreaterThan(1)
    choose('補課來源（選填）', data.recurringLessons[0].id)
    fill(data)
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    expect(callbacks.onSave.mock.calls[0][0].draft.relatedRecurringLessonId).toBe(data.recurringLessons[0].id)
    await waitFor(() => expect((screen.getByRole('button', { name: '送出新增' }) as HTMLButtonElement).disabled).toBe(false))
    choose('用途', 'substitute')
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    expect(callbacks.onSave.mock.calls[1][0].draft).toMatchObject({ purpose: 'substitute' })
    expect(callbacks.onSave.mock.calls[1][0].draft.relatedRecurringLessonId).toBeUndefined()
  })

  it('links schools, units, classes and applicable subjects without switching timetable', () => {
    const data = base()
    const otherSchool = { ...data.schools[0], id: 'other-school', name: '乙校' }
    const otherUnit = { ...structuredClone(data.teachingUnits[0]), id: 'other-unit', schoolId: otherSchool.id, schoolLevel: 'junior-high' as const, name: '國中部' }
    data.schools.push(otherSchool)
    data.teachingUnits.push(otherUnit)
    data.classes.push({ ...data.classes[0], id: 'other-class', teachingUnitId: otherUnit.id, name: '乙班' })
    data.subjects.push({ id: 'junior-only', name: '理化', shortName: '理化', color: '#123456', applicableSchoolLevels: ['junior-high'] })
    const callbacks = props(data)
    render(<OneOffLessonEditor {...callbacks} />)
    fill(data)
    choose('學校', otherSchool.id)
    expect((screen.getByLabelText('學制') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('班級') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('科目') as HTMLSelectElement).value).toBe('')
    choose('學制', otherUnit.id)
    expect((screen.getByLabelText('班級') as HTMLSelectElement).textContent).toContain('乙班')
    expect((screen.getByLabelText('科目') as HTMLSelectElement).textContent).toContain('理化')
    choose('班級', 'other-class')
    choose('科目', 'junior-only')
    choose('節次', '2')
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    expect(callbacks.onSave.mock.calls[0][0].draft).toMatchObject({ teachingUnitId: otherUnit.id, classId: 'other-class', subjectId: 'junior-only', timetableId: data.timetables[0].id })
  })

  it('uses 24 hour and 12 five-minute options for custom time, rejecting overnight or equal times', () => {
    const data = base()
    const callbacks = props(data)
    render(<OneOffLessonEditor {...callbacks} />)
    fill(data)
    choose('時間模式', 'custom')
    expect((screen.getByLabelText('開始小時') as HTMLSelectElement).options.length).toBe(24)
    expect((screen.getByLabelText('開始分鐘') as HTMLSelectElement).options.length).toBe(12)
    expect((screen.getByLabelText('結束小時') as HTMLSelectElement).options.length).toBe(24)
    expect((screen.getByLabelText('結束分鐘') as HTMLSelectElement).options.length).toBe(12)
    expect((screen.getByLabelText('結束分鐘') as HTMLSelectElement).options[11].value).toBe('55')
    choose('開始小時', '23')
    choose('結束小時', '00')
    expect(screen.getByRole('alert').textContent).toContain('不支援跨午夜')
    expect((screen.getByRole('button', { name: '送出新增' }) as HTMLButtonElement).disabled).toBe(true)
    choose('開始小時', '09')
    choose('結束小時', '09')
    expect((screen.getByRole('button', { name: '送出新增' }) as HTMLButtonElement).disabled).toBe(true)
    choose('結束小時', '11')
    choose('開始分鐘', '30')
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    expect(callbacks.onSave.mock.calls[0][0].draft.time).toEqual({ mode: 'custom', startTime: '09:30', endTime: '11:00' })
  })

  it('shows the actual conflicting lesson and requires explicit consent; callback can revalidate against latest data', () => {
    const data = base()
    const callbacks = props(data)
    render(<OneOffLessonEditor {...callbacks} />)
    fill(data)
    choose('指定日期', '2026-09-07')
    expect(screen.getByText(/此時段已有 1 堂課/)).toBeTruthy()
    expect(screen.getByText(/國文（08:10–09:00）/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '送出新增' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('明確允許衝堂，保留兩堂課'))
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    expect(callbacks.onSave.mock.calls[0][0].allowConflict).toBe(true)
    choose('指定日期', '2026-09-06')
    expect(screen.queryByLabelText('明確允許衝堂，保留兩堂課')).toBeNull()
  })

  it('edits with a stable ID, excludes itself from collisions, and preserves a deleted make-up source', async () => {
    const data = base()
    const draft = { projectId: data.projects[0].id, timetableId: data.timetables[0].id,
      teachingUnitId: data.teachingUnits[0].id, classId: data.classes[0].id, subjectId: data.subjects[0].id,
      date: '2026-09-06', purpose: 'make-up' as const, relatedRecurringLessonId: 'deleted-source', time: { mode: 'custom' as const, startTime: '09:30', endTime: '10:30' } }
    const withOneOff = createOneOffLesson(data, draft, () => uuid)
    const callbacks = props(withOneOff)
    render(<OneOffLessonEditor {...callbacks} oneOffLessonId={uuid} />)
    expect(screen.getByRole('dialog', { name: '編輯單日課程' })).toBeTruthy()
    expect((screen.getByLabelText('補課來源（選填）') as HTMLSelectElement).textContent).toContain('原課已刪除')
    expect(screen.queryByText(/此時段已有/)).toBeNull()
    choose('教室（選填）', '圖書館')
    fireEvent.click(screen.getByRole('button', { name: '送出修改' }))
    await waitFor(() => expect(callbacks.onSave).toHaveBeenCalledTimes(1))
    const request = callbacks.onSave.mock.calls[0][0] as OneOffSaveRequest
    expect(request.id).toBe(uuid)
    expect(request.draft.relatedRecurringLessonId).toBe('deleted-source')
    expect(updateOneOffLesson(withOneOff, request.id!, request.draft).oneOffLessons[0]).toMatchObject({ id: uuid, room: '圖書館' })
  })

  it('confirms deletion before invoking the parent, and only one-off data is removed by the CRUD API', () => {
    const data = base()
    const draft = { projectId: data.projects[0].id, timetableId: data.timetables[0].id,
      teachingUnitId: data.teachingUnits[0].id, classId: data.classes[0].id, subjectId: data.subjects[0].id,
      date: '2026-09-06', purpose: 'extra' as const, time: { mode: 'custom' as const, startTime: '09:30', endTime: '10:30' } }
    const withOneOff = createOneOffLesson(data, draft, () => uuid)
    const onDelete = vi.fn()
    render(<OneOffLessonEditor {...props(withOneOff)} oneOffLessonId={uuid} onDelete={onDelete} />)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: '刪除單日課程' }))
    expect(onDelete).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '刪除單日課程' }))
    expect(onDelete).toHaveBeenCalledWith(uuid)
    const removed = deleteOneOffLesson(withOneOff, uuid)
    expect(removed.recurringLessons).toEqual(withOneOff.recurringLessons)
    expect(removed.oneOffLessons).toEqual([])
  })

  it('keeps archived projects and mismatched timetable contexts read-only', () => {
    const data = base()
    data.projects[0].archivedAt = '2026-09-08T00:00:00.000Z'
    render(<OneOffLessonEditor {...props(data)} />)
    expect(screen.getByText(/封存專案為唯讀/)).toBeTruthy()
    expect((screen.getByLabelText('學校') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '送出新增' })).toBeNull()
    cleanup()
    render(<OneOffLessonEditor {...props(base())} timetableId="another-timetable" />)
    expect(screen.getByRole('alert').textContent).toContain('教師課表不屬於所選專案')
    expect(screen.queryByRole('button', { name: '送出新增' })).toBeNull()
  })

  it('does not submit twice while pending and reports callback failure without clearing the form', async () => {
    const data = base()
    let reject!: (reason: Error) => void
    const onSave = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
    render(<OneOffLessonEditor {...props(data)} onSave={onSave} />)
    fill(data)
    fireEvent.click(screen.getByRole('button', { name: '送出新增' }))
    expect((screen.getByRole('button', { name: '處理中…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '處理中…' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    reject(new Error('跨分頁資料已變更，請重新整理後再試。'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('跨分頁資料已變更'))
    expect((screen.getByLabelText('班級') as HTMLSelectElement).value).toBe(data.classes[0].id)
  })
})

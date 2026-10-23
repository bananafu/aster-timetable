// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataV8 } from '../types'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { createBlankProject } from '../data/projectRuntimeV8'
import { ProjectLifecycleV8 } from './ProjectLifecycleV8'

const data = () => {
  let index = 0
  return createBlankProject(createEmptyAppDataV8(), { name: '來源', teacherName: '教師', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `id-${++index}`)
}
const controls = { exportLocalJson: () => '{}', exportStoredV8Json: () => '{}', adoptExternalV8: vi.fn() }
const persist = { pending: false, revision: 0, receipt: null }
function mount(overrides: Partial<Parameters<typeof ProjectLifecycleV8>[0]> = {}) {
  const props = { data: data(), setData: vi.fn(), status: 'saved' as const, persistence: persist,
    info: { writable: true }, controls, onClose: vi.fn(), onExport: vi.fn(), ...overrides }
  return { props, ...render(<ProjectLifecycleV8 {...props} />) }
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('standalone V8 Project lifecycle UI', () => {
  it('separates blank creation and copy, and waits for the exact persistence receipt', () => {
    const { props, rerender } = mount()
    fireEvent.click(screen.getByText('新增空白專案'))
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '全新專案' } })
    fireEvent.change(screen.getByLabelText('起始日'), { target: { value: '2027-08-01' } })
    fireEvent.change(screen.getByLabelText('結束日'), { target: { value: '2028-01-31' } })
    fireEvent.submit(screen.getByText('新增並切換').closest('form')!)
    expect(props.setData).toHaveBeenCalledTimes(1)
    expect(props.onClose).not.toHaveBeenCalled()
    const next = vi.mocked(props.setData).mock.calls[0][0] as AppDataV8
    const id = next.activeProjectId!
    expect(next.subjects.filter((item) => item.projectId === id)).toEqual([])
    expect(next.timetables.filter((item) => item.projectId === id)).toEqual([])
    expect(next.classes.filter((item) => item.projectId === id)).toEqual([])
    expect(next.recurringLessons.filter((item) => item.projectId === id)).toEqual([])
    rerender(<ProjectLifecycleV8 {...props} persistence={{ pending: false, revision: 1,
      receipt: { raw: JSON.stringify(next), revision: 1 } }} />)
    expect(screen.getByText('V8 寫入已確認。')).toBeTruthy()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('requires explicit source-effective dates and confirms unsaved draft dismissal', () => {
    const { props } = mount()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByText('複製為新學期'))
    fireEvent.change(screen.getByLabelText('來源專案'), { target: { value: props.data.projects[0].id } })
    expect(screen.getByLabelText('來源有效日期')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '下一學期' } })
    fireEvent.submit(screen.getByText('複製並切換').closest('form')!)
    expect(props.setData).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('關閉對話框'))
    expect(confirm).toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('blocks writes when read-only and exposes export/recovery hooks', () => {
    const { props } = mount({ info: { writable: false }, status: 'conflict' })
    expect(screen.getByText('新增空白專案')).toBeTruthy()
    fireEvent.click(screen.getByText('新增空白專案'))
    expect((screen.getByText('新增並切換') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('匯出本頁 JSON'))
    expect(props.onExport).toHaveBeenCalledWith('{}')
    fireEvent.click(screen.getByText('採用外部 V8'))
    expect(controls.adoptExternalV8).toHaveBeenCalled()
  })

  it('keeps the modal open on persistence failure and requires impact acknowledgement before delete', () => {
    const { props, rerender } = mount()
    fireEvent.click(screen.getByText('刪除專案'))
    fireEvent.change(screen.getByLabelText('刪除對象'), { target: { value: props.data.projects[0].id } })
    expect((screen.getByText('永久刪除') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('我已了解應先保存額外備份'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByText('永久刪除'))
    expect(props.setData).toHaveBeenCalledTimes(1)
    expect(props.onClose).not.toHaveBeenCalled()
    rerender(<ProjectLifecycleV8 {...props} status="write-error" />)
    expect(screen.getByRole('alert').textContent).toContain('寫入未確認')
    expect(props.onClose).not.toHaveBeenCalled()
  })
})

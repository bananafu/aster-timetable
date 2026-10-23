// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataV8 } from '../types'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { createBlankProject } from '../data/projectRuntimeV8'
import { ClassManagerV8 } from './ClassManagerV8'

function data() {
  let sequence = 0
  return createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115, semester: 'first',
    startDate: '2026-08-01', endDate: '2027-01-31' }, () => `id-${++sequence}`)
}
const initialPersistence = { pending: false, revision: 0, receipt: null }
function mount(overrides: Partial<Parameters<typeof ClassManagerV8>[0]> = {}) {
  const props = { data: data(), setData: vi.fn(), status: 'saved' as const, persistence: initialPersistence,
    writable: true, exportLocalJson: () => '{}', onExport: vi.fn(), onRecover: vi.fn(), onClose: vi.fn(), ...overrides }
  return { props, ...render(<ClassManagerV8 {...props} />) }
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('standalone V8 Class manager', () => {
  it('waits for matching raw and revision receipt before success', () => {
    const { props, rerender } = mount()
    expect(screen.getByText('目前專案尚無班級。')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('班級名稱'), { target: { value: '新班級' } })
    fireEvent.submit(screen.getByLabelText('班級表單'))
    const next = vi.mocked(props.setData).mock.calls[0][0] as AppDataV8
    expect(next.classes).toHaveLength(1)
    expect(next.timetables).toEqual([])
    expect(next.recurringLessons).toEqual([])
    expect(screen.queryByText('V8 班級資料已確認儲存。')).toBeNull()
    rerender(<ClassManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: 'wrong', revision: 1 } }} />)
    expect(screen.queryByText('V8 班級資料已確認儲存。')).toBeNull()
    rerender(<ClassManagerV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: JSON.stringify(next), revision: 1 } }} />)
    expect(screen.getByText('V8 班級資料已確認儲存。')).toBeTruthy()
  })

  it('blocks read-only writes, preserves draft on conflict and confirms discard', () => {
    const { props, rerender } = mount({ writable: false, status: 'conflict' })
    expect((screen.getByText('新增班級') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('匯出本頁 JSON'))
    expect(props.onExport).toHaveBeenCalledWith('{}')
    fireEvent.click(screen.getByText('查看恢復選項'))
    expect(props.onRecover).toHaveBeenCalled()
    rerender(<ClassManagerV8 {...props} writable status="saved" />)
    fireEvent.change(screen.getByLabelText('班級名稱'), { target: { value: '草稿' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByText('完成'))
    expect(confirm).toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    fireEvent.submit(screen.getByLabelText('班級表單'))
    rerender(<ClassManagerV8 {...props} status="write-error" />)
    expect(screen.getByRole('alert').textContent).toContain('草稿仍保留')
    expect((screen.getByLabelText('班級名稱') as HTMLInputElement).value).toBe('草稿')
  })
})

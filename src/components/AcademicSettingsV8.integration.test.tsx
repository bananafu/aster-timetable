// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDataV8 } from '../types'
import { createBlankProject } from '../data/projectRuntimeV8'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { AcademicSettingsV8 } from './AcademicSettingsV8'

function fixture() {
  let id = 0
  return createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `id-${++id}`)
}
const persistence = { pending: false, revision: 0, receipt: null }
function mount(overrides: Partial<Parameters<typeof AcademicSettingsV8>[0]> = {}) {
  const props = { data: fixture(), setData: vi.fn(), status: 'saved' as const, persistence,
    writable: true, exportLocalJson: () => '{}', onExport: vi.fn(), onClose: vi.fn(), ...overrides }
  return { props, ...render(<AcademicSettingsV8 {...props} />) }
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('V8 academic settings Host integration', () => {
  it('only confirms the exact raw and revision receipt', () => {
    const { props, rerender } = mount()
    fireEvent.click(screen.getByText('新增學校'))
    fireEvent.change(screen.getByLabelText('學校名稱'), { target: { value: '第二校' } })
    fireEvent.click(screen.getByText('儲存設定'))
    const next = vi.mocked(props.setData).mock.calls[0][0] as AppDataV8
    rerender(<AcademicSettingsV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: JSON.stringify(next), revision: 2 } }} />)
    expect(screen.queryByText('V8 教學設定已確認儲存。')).toBeNull()
    rerender(<AcademicSettingsV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: 'wrong', revision: 1 } }} />)
    expect(screen.queryByText('V8 教學設定已確認儲存。')).toBeNull()
    rerender(<AcademicSettingsV8 {...props} data={next} persistence={{ pending: false, revision: 1,
      receipt: { raw: JSON.stringify(next), revision: 1 } }} />)
    expect(screen.getByText('V8 教學設定已確認儲存。')).toBeTruthy()
  })

  it('blocks read-only writes and stale Project drafts', () => {
    const { props, rerender } = mount({ writable: false, status: 'conflict' })
    expect((screen.getByText('新增學校') as HTMLButtonElement).disabled).toBe(true)
    rerender(<AcademicSettingsV8 {...props} writable status="saved" />)
    fireEvent.click(screen.getByText('新增學校'))
    fireEvent.change(screen.getByLabelText('學校名稱'), { target: { value: '草稿校' } })
    rerender(<AcademicSettingsV8 {...props} writable status="saved" data={{ ...props.data, activeProjectId: null }} />)
    fireEvent.click(screen.getByText('儲存設定'))
    expect(props.setData).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('專案或文件已變更')
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getByLabelText('關閉對話框'))
    expect(props.onClose).not.toHaveBeenCalled()
  })
})

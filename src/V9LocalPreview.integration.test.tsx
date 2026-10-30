// @vitest-environment jsdom
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { V9LocalPreview } from './V9LocalPreview'
import { createV9LocalPreviewFixture } from './data/v9LocalPreviewFixture'
import { isCompatibleAppDataV9 } from './data/validators/v9'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('V9 localhost memory preview', () => {
  it('builds a fixed compatible V9 document', () => {
    const data = createV9LocalPreviewFixture()
    expect(isCompatibleAppDataV9(data)).toBe(true)
    expect(data.teachingUnits.filter((item) => item.projectId === data.activeProjectId)).toHaveLength(2)
    expect(data.timetables.filter((item) => item.projectId === data.activeProjectId)).toHaveLength(2)
    expect(data.projects.some((item) => item.id === 'preview-empty-project' && item.term === null)).toBe(true)
  })

  it('renders the shared seven-day Dashboard and five-day Timetable without touching Storage', () => {
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const removals = vi.spyOn(Storage.prototype, 'removeItem')
    render(<StrictMode><V9LocalPreview /></StrictMode>)

    expect(screen.getByRole('heading', { name: '本週行事曆' })).toBeTruthy()
    expect(screen.getByText('教學研究會議')).toBeTruthy()
    expect(screen.getByText('校慶活動')).toBeTruthy()
    expect(screen.getByRole('region', { name: '2026-03-01 週日' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '2026-03-07 週六' })).toBeTruthy()
    expect(screen.getAllByText('已調離').length).toBeGreaterThan(0)
    expect(screen.getAllByText('調入').length).toBeGreaterThan(0)
    expect(screen.getAllByText('已取消').length).toBeGreaterThan(0)
    expect(screen.getAllByText('單日新增').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: '我的課表' }))
    expect(screen.getByRole('heading', { name: '跨校週課表' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '2026-03-02 課表' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '2026-03-06 課表' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: '2026-03-07 課表' })).toBeNull()
    expect(screen.getAllByText('國文').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: '各校課表' }))
    fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'preview-school-b' } })
    fireEvent.change(screen.getByLabelText('篩選學制'), { target: { value: 'preview-unit-b' } })
    expect(screen.getByText('B 週')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '下一週' }))
    expect(screen.getByText('A 週')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '今天' }))
    expect(screen.getByText('B 週')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '切換課表' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /陳老師課表/ }))
    expect(screen.getByText('數學')).toBeTruthy()
    expect(screen.queryByText('國文')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '切換專案' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /空白專案/ }))
    expect(screen.queryByText('數學')).toBeNull()
    expect(reads).not.toHaveBeenCalled()
    expect(writes).not.toHaveBeenCalled()
    expect(removals).not.toHaveBeenCalled()
  }, 15_000)
})

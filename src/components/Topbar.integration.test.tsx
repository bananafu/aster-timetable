// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Topbar } from './Topbar'

afterEach(cleanup)

describe('Topbar add menu', () => {
  const renderMenu = (canAddTimetable = true) => {
    const onAddProject = vi.fn()
    const onAddTimetable = vi.fn()
    render(<Topbar weekStart={new Date(2026, 8, 7)} onWeekChange={vi.fn()} onToday={vi.fn()}
      onMenu={vi.fn()} onAddProject={onAddProject} onAddTimetable={onAddTimetable}
      canAddTimetable={canAddTimetable} addTimetableReason="請先建立課表專案。" />)
    return { onAddProject, onAddTimetable }
  }

  it('offers project before timetable and runs only the chosen existing callback', () => {
    const actions = renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '新增' }))
    expect([...screen.getAllByRole('menuitem')].map((item) => item.textContent)).toEqual(['新增專案', '新增空白課表'])
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '新增專案' }))
    fireEvent.keyDown(screen.getByRole('menu', { name: '新增' }), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '新增空白課表' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '新增空白課表' }))
    expect(actions.onAddTimetable).toHaveBeenCalledOnce()
    expect(actions.onAddProject).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('explains the disabled timetable action and closes on Escape or outside click', () => {
    renderMenu(false)
    const trigger = screen.getByRole('button', { name: '新增' })
    fireEvent.click(trigger)
    expect((screen.getByRole('menuitem', { name: '新增空白課表' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('請先建立課表專案。')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

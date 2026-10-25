// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimetableSwitcher } from './TimetableControls'

afterEach(cleanup)

describe('shared teacher Timetable popover', () => {
  it('navigates by keyboard, restores focus on Escape, and selects by ID', () => {
    const select = vi.fn()
    render(<TimetableSwitcher timetables={[
      { id: 'teacher-a', name: '同名課表', teacherName: '甲' },
      { id: 'teacher-b', name: '同名課表', teacherName: '乙' },
    ]} selectedId="teacher-a" onSelect={select} buttonLabel="切換目前教師課表" />)
    const trigger = screen.getByRole('button', { name: '切換目前教師課表' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu', { name: '教師課表' })
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(menu.querySelector('[data-timetable-id="teacher-b"]'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menu').querySelector('[data-timetable-id="teacher-b"]')!)
    expect(select).toHaveBeenCalledWith('teacher-b')
  })
})

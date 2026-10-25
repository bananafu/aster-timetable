// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreviewProjectSwitcher } from './PreviewProjectSwitcher'

afterEach(() => cleanup())

describe('V8 preview Project popover', () => {
  it('uses the formal switcher pattern and selects by ID', () => {
    const select = vi.fn()
    render(<PreviewProjectSwitcher projects={[{ id: 'a', name: '同名' }, { id: 'b', name: '同名' }]}
      selectedId="a" disabled={false} onSelect={select} />)
    fireEvent.click(screen.getByRole('button', { name: '切換專案' }))
    const options = screen.getAllByRole('menuitemradio')
    expect(options[0].getAttribute('aria-checked')).toBe('true')
    expect(options[1].getAttribute('aria-checked')).toBe('false')
    fireEvent.click(options[1])
    expect(select).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not offer switching while read-only', () => {
    render(<PreviewProjectSwitcher projects={[{ id: 'a', name: '專案' }]}
      selectedId="a" disabled onSelect={vi.fn()} />)
    expect((screen.getByRole('button', { name: '切換專案' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('supports arrow navigation, Home/End and Escape with focus restored', () => {
    const select = vi.fn()
    render(<PreviewProjectSwitcher projects={[{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }]}
      selectedId="a" disabled={false} onSelect={select} />)
    const trigger = screen.getByRole('button', { name: '切換專案' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu', { name: '選擇課表專案' })
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: /乙/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(select).not.toHaveBeenCalled()
  })
})

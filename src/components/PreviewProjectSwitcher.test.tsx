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
})

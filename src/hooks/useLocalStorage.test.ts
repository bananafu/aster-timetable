import { describe, expect, it, vi } from 'vitest'
import { getExternalUpdateDecision, loadStoredValue, readStoredValue, writeStoredValue } from './useLocalStorage'

describe('LocalStorage helpers', () => {
  it('writes and reads JSON data', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    writeStoredValue(storage, 'settings', { density: 'compact' })
    expect(readStoredValue(storage, 'settings', { density: 'comfortable' })).toEqual({ density: 'compact' })
  })

  it('surfaces write failures', () => {
    const storage = { setItem: vi.fn(() => { throw new Error('quota exceeded') }) }
    expect(() => writeStoredValue(storage, 'data', {})).toThrow('quota exceeded')
  })

  it('does not overwrite corrupted raw data while loading', () => {
    const storage = {
      getItem: vi.fn(() => '{broken-json'),
      setItem: vi.fn(),
    }
    const result = loadStoredValue(storage, 'data', { safe: true })
    expect(result.status).toBe('read-error')
    expect(result.raw).toBe('{broken-json')
    expect(result.shouldPersist).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('blocks structurally invalid JSON without writing over it', () => {
    const raw = '{"safe":"not-a-boolean"}'
    const storage = { getItem: vi.fn(() => raw), setItem: vi.fn() }
    const result = loadStoredValue(storage, 'data', { safe: true }, {
      validate: (value): value is { safe: boolean } => Boolean(value && typeof value === 'object' && typeof (value as { safe?: unknown }).safe === 'boolean'),
    })
    expect(result).toMatchObject({ status: 'read-error', raw, shouldPersist: false })
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('flags an external update as conflict while local changes are pending', () => {
    expect(getExternalUpdateDecision(true, '{"version":1}', '{"version":2}')).toBe('conflict')
    expect(getExternalUpdateDecision(false, '{"version":1}', '{"version":2}')).toBe('sync')
    expect(getExternalUpdateDecision(true, '{"version":2}', '{"version":2}')).toBe('ignore')
  })
})

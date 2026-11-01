// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeFreshV9 } from '../data/initializeFreshV9'
import { useAppDataV9 } from './useAppDataV9'

const time = '2026-11-01T00:00:00.000Z'
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
    operation: (lock: unknown) => Promise<unknown>) => operation({}) } })
})
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('fresh V9 Host verification', () => {
  it('starts read-only and independently grants writable only after checking fresh evidence', async () => {
    const initialized = await initializeFreshV9(localStorage, { attemptId: 'fresh-host', createdAt: time })
    if (!initialized.ok) throw new Error(initialized.code)
    const { result } = renderHook(() => useAppDataV9())
    expect(result.current.writable).toBe(false)
    await waitFor(() => expect(result.current.writable).toBe(true))
    expect(result.current.status).toBe('active')
    expect(result.current.revision).toBe(0)
  })

  it('never grants writable for a corrupted fresh backup', async () => {
    const initialized = await initializeFreshV9(localStorage, { attemptId: 'fresh-host', createdAt: time })
    if (!initialized.ok) throw new Error(initialized.code)
    localStorage.setItem(initialized.backupKey, '{corrupt}')
    const { result } = renderHook(() => useAppDataV9())
    await waitFor(() => expect(result.current.status).toBe('conflict'))
    expect(result.current.writable).toBe(false)
  })
})

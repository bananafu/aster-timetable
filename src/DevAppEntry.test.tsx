// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevAppEntry } from './DevAppEntry'
import { V8_BOOTSTRAP_KEY } from './data/activationV8'
import { APP_DATA_V7_KEY } from './data/storageV7'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_BACKUP_PREFIX, type V9ActivationRecord } from './data/storageV9'
import { createEmptyAppDataV8 } from './data/storageV8'
import { V8_PREVIEW_HASH, isV8PreviewRoute } from './previewRoute'

const appMount = vi.hoisted(() => vi.fn())
vi.mock('./App', () => ({ default: () => { appMount(); return <div>V7 正式 App</div> } }))
vi.mock('./V8PreviewApp', () => ({ V8PreviewApp: ({ onReturn }: { onReturn: () => void }) =>
  <button onClick={onReturn}>V8 預覽：返回 V7</button> }))

const digest = `sha256:${'a'.repeat(64)}` as const
const v9Document = () => ({ ...createEmptyAppDataV8(), schemaVersion: 9 })
const metadata = (status: V9ActivationRecord['status']): V9ActivationRecord => ({
  schemaVersion: 1, kind: 'timetable-subject-upgrade', attemptId: 'entry-test', status,
  sourceV8Digest: digest, sourceActivationKey: V8_BOOTSTRAP_KEY,
  sourceActivationDigest: digest, sourceV7Digest: null,
  backupKey: `${V9_BACKUP_PREFIX}entry-test`, initialDigest: digest, currentDigest: digest,
  documentRevision: 0, createdAt: '2026-10-26T00:00:00.000Z',
  updatedAt: '2026-10-26T00:00:00.000Z',
  activatedAt: status === 'active' ? '2026-10-26T00:00:00.000Z' : null,
})
const seedV9 = (status: V9ActivationRecord['status'], withDocument = true) => {
  if (withDocument) localStorage.setItem(APP_DATA_V9_KEY, JSON.stringify(v9Document()))
  localStorage.setItem(V9_ACTIVATION_KEY, JSON.stringify(metadata(status)))
}

beforeEach(() => { localStorage.clear(); appMount.mockClear() })
afterEach(() => { cleanup(); localStorage.clear(); window.location.hash = ''; vi.restoreAllMocks() })

describe('development preview routing', () => {
  it('never exposes the preview route in production', () => {
    expect(isV8PreviewRoute(false, V8_PREVIEW_HASH)).toBe(false)
    expect(isV8PreviewRoute(true, V8_PREVIEW_HASH)).toBe(true)
  })
  it('mounts V8 directly without mounting V7 when a fresh browser opens the preview URL', async () => {
    window.location.hash = V8_PREVIEW_HASH
    render(<DevAppEntry />)
    expect(await screen.findByText('V8 預覽：返回 V7')).toBeTruthy()
    expect(screen.queryByText('V7 正式 App')).toBeNull()
  })
  it('defaults to V7 and only mounts V8 after an explicit development route', async () => {
    render(<DevAppEntry />)
    expect(screen.getByText('V7 正式 App')).toBeTruthy()
    expect(screen.queryByText('V8 預覽：返回 V7')).toBeNull()
    expect((screen.getByText('開啟 V8 開發預覽') as HTMLAnchorElement).getAttribute('href')).toBe(V8_PREVIEW_HASH)
    act(() => { window.location.hash = V8_PREVIEW_HASH; window.dispatchEvent(new HashChangeEvent('hashchange')) })
    expect(window.location.hash).toBe(V8_PREVIEW_HASH)
    expect(await screen.findByText('V8 預覽：返回 V7')).toBeTruthy()
    expect(screen.queryByText('V7 正式 App')).toBeNull()
    fireEvent.click(screen.getByText('V8 預覽：返回 V7'))
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')))
    expect(screen.getByText('V7 正式 App')).toBeTruthy()
  })

  it('mounts the unchanged V7 entry only when V9 evidence is absent', () => {
    render(<DevAppEntry />)
    expect(screen.getByText('V7 正式 App')).toBeTruthy()
    expect(appMount).toHaveBeenCalledTimes(1)
  })

  it('does not mount V7 or create or rewrite its key when V9 is active', () => {
    seedV9('active')
    const emptyV7 = render(<DevAppEntry />)
    expect(screen.queryByText('V7 正式 App')).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBeNull()
    emptyV7.unmount()

    localStorage.clear()
    localStorage.setItem(APP_DATA_V7_KEY, 'preserve-exact-v7-raw')
    seedV9('active')
    render(<DevAppEntry />)
    expect(screen.queryByText('V7 正式 App')).toBeNull()
    expect(appMount).not.toHaveBeenCalled()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe('preserve-exact-v7-raw')
  })

  it('fails closed for preparing, inconsistent and corrupt V9 evidence', () => {
    seedV9('preparing')
    const view = render(<DevAppEntry />)
    expect(screen.queryByText('V7 正式 App')).toBeNull()
    view.unmount()

    localStorage.clear()
    seedV9('active', false)
    render(<DevAppEntry />)
    expect(screen.queryByText('V7 正式 App')).toBeNull()
    cleanup()

    localStorage.clear()
    localStorage.setItem(APP_DATA_V9_KEY, '{corrupt')
    localStorage.setItem(V9_ACTIVATION_KEY, JSON.stringify(metadata('active')))
    render(<DevAppEntry />)
    expect(screen.queryByText('V7 正式 App')).toBeNull()
    expect(appMount).not.toHaveBeenCalled()
  })

  it('unmounts V7 when V9 evidence appears and never auto-falls back in the same mount', () => {
    render(<DevAppEntry />)
    expect(screen.getByText('V7 正式 App')).toBeTruthy()
    const documentRaw = JSON.stringify(v9Document())
    localStorage.setItem(APP_DATA_V9_KEY, documentRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: APP_DATA_V9_KEY, oldValue: null, newValue: documentRaw,
    })))
    expect(screen.queryByText('V7 正式 App')).toBeNull()
    localStorage.removeItem(APP_DATA_V9_KEY)
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: APP_DATA_V9_KEY, oldValue: documentRaw, newValue: null,
    })))
    expect(screen.queryByText('V7 正式 App')).toBeNull()
  })

  it('keeps the explicit development Preview route available when active V9 exists', async () => {
    seedV9('active')
    window.location.hash = V8_PREVIEW_HASH
    render(<DevAppEntry />)
    expect(await screen.findByText('V8 預覽：返回 V7')).toBeTruthy()
    expect(screen.queryByText('V7 正式 App')).toBeNull()
  })
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DevAppEntry } from './DevAppEntry'
import { V8_PREVIEW_HASH, isV8PreviewRoute } from './previewRoute'

vi.mock('./App', () => ({ default: () => <div>V7 正式 App</div> }))
vi.mock('./V8PreviewApp', () => ({ V8PreviewApp: ({ onReturn }: { onReturn: () => void }) =>
  <button onClick={onReturn}>V8 預覽：返回 V7</button> }))
afterEach(() => { cleanup(); window.location.hash = ''; vi.restoreAllMocks() })

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
})

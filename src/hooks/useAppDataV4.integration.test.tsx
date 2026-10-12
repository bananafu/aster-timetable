// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { APP_DATA_V1_KEY, APP_DATA_V3_KEY, APP_DATA_V4_KEY } from '../data/storageV4'
import { useAppDataV4 } from './useAppDataV4'

function Harness() {
  const [data, setData, status, controls] = useAppDataV4()
  const active = data.projects.find((item) => item.id === data.activeProjectId)
  return <div>
    <output data-testid="name">{active?.name}</output><output data-testid="status">{status}</output>
    <output data-testid="backup">{controls.rawBackup ?? ''}</output>
    <button onClick={() => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id === current.activeProjectId ? { ...item, name: '本頁版本' } : item) }))}>rename</button>
    <button onClick={controls.acceptExternal}>accept</button>
  </div>
}

function removeAppKeys() {
  localStorage.removeItem(APP_DATA_V4_KEY)
  localStorage.removeItem(APP_DATA_V3_KEY)
  localStorage.removeItem(APP_DATA_V1_KEY)
}

describe('useAppDataV4 runtime integration', () => {
  beforeEach(() => { vi.useFakeTimers(); removeAppKeys() })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); removeAppKeys() })

  it('首次載入安全遷移 v3、只寫入 v4，重新掛載後讀取 v4', () => {
    const rawV3 = JSON.stringify(initialData)
    localStorage.setItem(APP_DATA_V3_KEY, rawV3)
    const first = render(<Harness />)
    expect(screen.getByTestId('status').textContent).toBe('saved')
    act(() => vi.advanceTimersByTime(200))
    expect(localStorage.getItem(APP_DATA_V4_KEY)).not.toBeNull()
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe(rawV3)
    first.unmount()
    render(<Harness />)
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(screen.getByTestId('name').textContent).toContain('原有課表')
  })

  it('遷移失敗時保持 read-error，不建立 v4 且保留損壞 v3', () => {
    localStorage.setItem(APP_DATA_V3_KEY, '{broken-v3')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('status').textContent).toBe('read-error')
    expect(localStorage.getItem(APP_DATA_V4_KEY)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe('{broken-v3')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('v4 寫入失敗時顯示 write-error 且不修改舊 key', () => {
    const rawV3 = JSON.stringify(initialData)
    const rawV4 = JSON.stringify(migrateV3ToV4(initialData))
    localStorage.setItem(APP_DATA_V4_KEY, rawV4)
    localStorage.setItem(APP_DATA_V3_KEY, rawV3)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    render(<Harness />)
    fireEvent.click(screen.getByText('rename'))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('write-error')
    expect(screen.getByTestId('backup').textContent).toBe(rawV4)
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe(rawV3)
  })

  it('遷移後首次寫入 v4 失敗時保留來源 v3 作為 recovery JSON', () => {
    const rawV3 = JSON.stringify(initialData)
    localStorage.setItem(APP_DATA_V3_KEY, rawV3)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    render(<Harness />)
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('write-error')
    expect(screen.getByTestId('backup').textContent).toBe(rawV3)
    expect(localStorage.getItem(APP_DATA_V4_KEY)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe(rawV3)
  })

  it('跨分頁有本地待寫入內容時進入 conflict，確認前不覆寫外部 v4', () => {
    const original = migrateV3ToV4(initialData)
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(original))
    render(<Harness />)
    fireEvent.click(screen.getByText('rename'))
    const external = structuredClone(original)
    external.projects[0].name = '外部分頁版本'
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V4_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V4_KEY, oldValue: JSON.stringify(original), newValue: externalRaw, storageArea: localStorage })))
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(localStorage.getItem(APP_DATA_V4_KEY)).toBe(externalRaw)
    fireEvent.click(screen.getByText('accept'))
    expect(screen.getByTestId('name').textContent).toBe('外部分頁版本')
    expect(screen.getByTestId('status').textContent).toBe('saved')
  })
})

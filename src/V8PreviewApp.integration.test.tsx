// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { V8PreviewApp } from './V8PreviewApp'
import { APP_DATA_V7_KEY } from './data/storageV7'
import { APP_DATA_V8_KEY } from './data/storageV8'
import { V8_BOOTSTRAP_KEY } from './data/activationV8'

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(navigator, 'locks', { configurable: true,
    value: { request: (_name: string, _options: unknown, operation: (lock: unknown) => Promise<unknown>) => operation({}) } })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

describe('V8 browser preview shell', () => {
  it('requires explicit bootstrap and then supports a persisted blank Project', async () => {
    render(<V8PreviewApp onReturn={vi.fn()} />)
    expect(screen.getByText('建立空白 V8 工作空間')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBeNull()
    fireEvent.click(screen.getByText('確認建立空白 V8'))
    await waitFor(() => expect(screen.getByText('管理專案')).toBeTruthy())
    expect(JSON.parse(localStorage.getItem(V8_BOOTSTRAP_KEY)!).status).toBe('active')
    fireEvent.click(screen.getByText('管理專案'))
    fireEvent.click(screen.getByText('新增空白專案'))
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '新學期' } })
    fireEvent.change(screen.getByLabelText('起始日'), { target: { value: '2027-08-01' } })
    fireEvent.change(screen.getByLabelText('結束日'), { target: { value: '2028-01-31' } })
    await waitFor(() => expect((screen.getByText('新增並切換') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByText('新增並切換'))
    await waitFor(() => expect(screen.getByText('V8 寫入已確認。')).toBeTruthy())
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V8_KEY)!)
    expect(stored.projects).toHaveLength(1)
    expect(stored.subjects).toEqual([])
    expect(stored.classes).toEqual([])
    expect(stored.timetables).toEqual([])
    expect(stored.recurringLessons).toEqual([])
    expect(stored.oneOffLessons).toEqual([])
    expect(stored.overrides).toEqual([])
    expect(stored.events).toEqual([])
    expect(stored.teachingProgress).toEqual([])
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBeNull()
  })

  it('blocks legacy data without touching its exact raw and offers return to V7', () => {
    localStorage.setItem(APP_DATA_V7_KEY, '{legacy-test-raw}')
    const back = vi.fn()
    render(<V8PreviewApp onReturn={back} />)
    expect(screen.getByRole('alert').textContent).toContain('空白 V8 初始化已阻擋')
    expect(screen.queryByText('確認建立空白 V8')).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe('{legacy-test-raw}')
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBeNull()
    fireEvent.click(screen.getByText('返回 V7'))
    expect(back).toHaveBeenCalledOnce()
  })

  it('fails closed without Web Locks and does not overwrite existing V8', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    const { unmount } = render(<V8PreviewApp onReturn={vi.fn()} />)
    expect((screen.getByText('確認建立空白 V8') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('Web Locks')
    unmount()
    localStorage.setItem(APP_DATA_V8_KEY, '{corrupt-v8}')
    render(<V8PreviewApp onReturn={vi.fn()} />)
    expect(screen.getByText('V8 尚無法啟用')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe('{corrupt-v8}')
    expect(screen.getByText('匯出原始 V8 JSON')).toBeTruthy()
    await act(async () => {})
  })

  it('reports lock failure without claiming an active bootstrap', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true,
      value: { request: async () => { throw new Error('lock failed') } } })
    render(<V8PreviewApp onReturn={vi.fn()} />)
    fireEvent.click(screen.getByText('確認建立空白 V8'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('lock-failure'))
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBeNull()
    expect(localStorage.getItem(V8_BOOTSTRAP_KEY)).toBeNull()
  })

  it('keeps valid V8 without active metadata read-only', () => {
    localStorage.setItem(APP_DATA_V8_KEY, JSON.stringify({ schemaVersion: 8, activeProjectId: null,
      projects: [], timetables: [], schools: [], teachingUnits: [], subjects: [], teachingUnitSubjects: [],
      classes: [], recurringLessons: [], events: [], overrides: [], oneOffLessons: [],
      teachingProgress: [], migrationWarnings: [] }))
    render(<V8PreviewApp onReturn={vi.fn()} />)
    expect(screen.getByText('唯讀／恢復狀態')).toBeTruthy()
    expect(screen.getByText('管理專案')).toBeTruthy()
    expect(localStorage.getItem(V8_BOOTSTRAP_KEY)).toBeNull()
  })

  it('warns before returning to V7 from a V8-only origin', () => {
    const back = vi.fn()
    vi.mocked(window.confirm).mockReturnValue(false)
    render(<V8PreviewApp onReturn={back} />)
    fireEvent.click(screen.getByText('返回 V7'))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('V8 為保護資料將停止寫入'))
    expect(back).not.toHaveBeenCalled()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBeNull()
  })
})

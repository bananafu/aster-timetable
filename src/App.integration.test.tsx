// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { createProject } from './data/projectRuntime'
import { initialData } from './data/seed'
import { migrateV3ToV4 } from './data/migrationsV4'
import { APP_DATA_V1_KEY, APP_DATA_V3_KEY, APP_DATA_V4_KEY } from './data/storageV4'

function removeAppKeys() {
  localStorage.removeItem(APP_DATA_V4_KEY)
  localStorage.removeItem(APP_DATA_V3_KEY)
  localStorage.removeItem(APP_DATA_V1_KEY)
}

describe('App v4 runtime', () => {
  beforeEach(() => { vi.useFakeTimers(); removeAppKeys() })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); removeAppKeys() })

  it('首次使用不自動建立範例，預覽範例也不污染正式資料', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '建立空白課表' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '查看範例' }))
    expect(screen.getByText('唯讀範例')).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V4_KEY)!)
    expect(stored.projects).toEqual([])
    expect(stored.recurringLessons).toEqual([])
  })

  it('首次使用建立空白專案後只寫入 v4 且不改動舊 key', () => {
    localStorage.setItem(APP_DATA_V3_KEY, JSON.stringify(initialData))
    const migrated = migrateV3ToV4(initialData)
    migrated.projects = []; migrated.schools = []; migrated.teachingUnits = []; migrated.classes = []; migrated.recurringLessons = []; migrated.events = []; migrated.overrides = []; migrated.activeProjectId = null
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(migrated))
    const oldV3 = localStorage.getItem(APP_DATA_V3_KEY)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '建立空白課表' }))
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '我的新課表' } })
    fireEvent.click(screen.getByRole('button', { name: '建立並開始' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V4_KEY)!)
    expect(stored.projects).toHaveLength(1)
    expect(stored.projects[0].name).toBe('我的新課表')
    expect(stored.classes).toEqual([])
    expect(stored.recurringLessons).toEqual([])
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe(oldV3)
  })

  it('切換專案後更新唯一 v4 state，並顯示隔離後的空課表資料', () => {
    const first = migrateV3ToV4(initialData)
    const ids = ['project-2', 'school-2', 'unit-2']
    const data = createProject(first, { name: '第二份課表', academicYear: 116, semester: 'first', startDate: '2027-08-30', endDate: '2028-01-20' }, () => ids.shift()!, '2027-07-01T00:00:00.000Z')
    data.activeProjectId = first.activeProjectId
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(data))
    render(<App />)
    const selector = screen.getByLabelText('課表專案') as HTMLSelectElement
    expect(selector.value).toBe(first.activeProjectId)
    fireEvent.change(selector, { target: { value: 'project-2' } })
    act(() => vi.advanceTimersByTime(200))
    expect(selector.value).toBe('project-2')
    expect(screen.getAllByText('第二份課表').length).toBeGreaterThan(0)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V4_KEY)!).activeProjectId).toBe('project-2')
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBeNull()
  })

  it('v3 migration 失敗時鎖定課表編輯且不建立 v4', () => {
    localStorage.setItem(APP_DATA_V3_KEY, '{broken-v3')
    render(<App />)
    expect(screen.getByText('資料尚未載入')).toBeTruthy()
    expect(screen.queryByText('本週課表')).toBeNull()
    act(() => vi.advanceTimersByTime(500))
    expect(localStorage.getItem(APP_DATA_V4_KEY)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe('{broken-v3')
  })
})

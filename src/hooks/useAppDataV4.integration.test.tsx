// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialData } from '../data/seed'
import { addSchool } from '../data/academicSettingsV4'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { APP_DATA_V1_KEY, APP_DATA_V3_KEY, APP_DATA_V4_KEY } from '../data/storageV4'
import { APP_DATA_V6_KEY } from '../data/storageV6'
import { APP_DATA_V5_KEY } from '../data/storageV5'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { useAppDataV4 } from './useAppDataV4'
import { AcademicSettingsV4 } from '../components/AcademicSettingsV4'

function Harness() {
  const [data, setData, status, controls] = useAppDataV4()
  const active = data.projects.find((item) => item.id === data.activeProjectId)
  return <div>
    <output data-testid="name">{active?.name}</output><output data-testid="status">{status}</output>
    <output data-testid="backup">{controls.rawBackup ?? ''}</output>
    <output data-testid="first-period">{data.teachingUnits[0] ? `${data.teachingUnits[0].periods[0].id}:${data.teachingUnits[0].periods[0].startTime}-${data.teachingUnits[0].periods[0].endTime}` : ''}</output>
    <button onClick={() => setData((current) => ({ ...current, projects: current.projects.map((item) => item.id === current.activeProjectId ? { ...item, name: '本頁版本' } : item) }))}>rename</button>
    <button onClick={() => setData((current) => addSchool(current, current.activeProjectId!, { name: '第二所學校', color: '#718B6C' }, 'persisted-school'))}>add school</button>
    <button onClick={() => setData((current) => current)}>no-op update</button>
    <button onClick={() => setData((current) => ({ ...current, teachingUnits: current.teachingUnits.map((unit, index) => index === 0 ? { ...unit, periods: [...unit.periods, { id: 999, order: 999, label: '異常節次', startTime: '09:03', endTime: '09:58' }] } : unit) }))}>add invalid period</button>
    <button onClick={() => setData((current) => ({ ...current, teachingUnits: current.teachingUnits.map((unit, index) => index === 0 ? { ...unit, periods: unit.periods.map((period, periodIndex) => periodIndex === 0 ? { ...period, startTime: '08:03' } : period) } : unit) }))}>change valid period invalid</button>
    <button onClick={controls.acceptExternal}>accept</button>
    <output data-testid="school-count">{data.schools.filter((item) => item.projectId === data.activeProjectId).length}</output>
  </div>
}

function SettingsHarness() {
  const [data, setData, status] = useAppDataV4()
  return <><output data-testid="settings-status">{status}</output><AcademicSettingsV4 data={data} setData={setData} page="periods" /></>
}

function removeAppKeys() {
  localStorage.removeItem(APP_DATA_V6_KEY)
  localStorage.removeItem(APP_DATA_V5_KEY)
  localStorage.removeItem(APP_DATA_V4_KEY)
  localStorage.removeItem(APP_DATA_V3_KEY)
  localStorage.removeItem(APP_DATA_V1_KEY)
}

describe('useAppDataV4 runtime integration', () => {
  beforeEach(() => { vi.useFakeTimers(); removeAppKeys() })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); removeAppKeys() })

  it('同一份 AppData 的 no-op updater 不啟動寫入', () => {
    const current = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(current))
    const write = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)
    fireEvent.click(screen.getByText('no-op update'))
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(write).not.toHaveBeenCalled()
  })

  it('首次載入安全遷移 v3、只寫入 v4，重新掛載後讀取 v4', () => {
    const rawV3 = JSON.stringify(initialData)
    localStorage.setItem(APP_DATA_V3_KEY, rawV3)
    const first = render(<Harness />)
    expect(screen.getByTestId('status').textContent).toBe('saved')
    act(() => vi.advanceTimersByTime(200))
    expect(localStorage.getItem(APP_DATA_V6_KEY)).not.toBeNull()
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe(rawV3)
    first.unmount()
    render(<Harness />)
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(screen.getByTestId('name').textContent).toContain('原有課表')
  })

  it('學校設定寫入 v4 後，重新掛載仍完整保留', () => {
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(migrateV3ToV4(initialData)))
    const first = render(<Harness />)
    fireEvent.click(screen.getByText('add school'))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('school-count').textContent).toBe('2')
    first.unmount()
    render(<Harness />)
    expect(screen.getByTestId('school-count').textContent).toBe('2')
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).schools.some((item: { id: string }) => item.id === 'persisted-school')).toBe(true)
  })

  it('runtime 從實際 LocalStorage 載入可修正的舊時間且不自動覆寫', () => {
    const v4 = migrateV3ToV4(structuredClone(initialData)); const period = v4.teachingUnits[0].periods[0]
    period.startTime = '08:03'; period.endTime = '08:58'
    const raw = JSON.stringify(v4)
    localStorage.setItem(APP_DATA_V4_KEY, raw)
    render(<Harness />)
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(screen.getByTestId('first-period').textContent).toBe(`${period.id}:08:03-08:58`)
    act(() => vi.advanceTimersByTime(500))
    expect(localStorage.getItem(APP_DATA_V4_KEY)).toBe(raw)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).teachingUnits[0].periods[0]).toMatchObject({ startTime: '08:03', endTime: '08:58' })
  })

  it('從實際 LocalStorage 載入舊時間後可進入設定頁查看原值與警告', () => {
    const v4 = migrateV3ToV4(structuredClone(initialData)); const unit = v4.teachingUnits[0]
    unit.periods[0].startTime = '08:03'; unit.periods[0].endTime = '08:58'
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(v4))
    render(<SettingsHarness />)
    expect(screen.getByTestId('settings-status').textContent).toBe('saved')
    expect(screen.getByRole('alert').textContent).toContain('非 5 分鐘刻度')
    expect((screen.getAllByLabelText(`${unit.name}開始時間`)[0] as HTMLSelectElement).value).toBe('08:03')
    expect((screen.getAllByLabelText(`${unit.name}結束時間`)[0] as HTMLSelectElement).value).toBe('08:58')
  })

  it('主動新增或修改出非五分鐘時間時在 setValue 階段拒絕且不延遲寫入', () => {
    const original = migrateV3ToV4(structuredClone(initialData)); const raw = JSON.stringify(original)
    localStorage.setItem(APP_DATA_V4_KEY, raw)
    render(<Harness />)
    fireEvent.click(screen.getByText('add invalid period'))
    expect(screen.getByTestId('status').textContent).toBe('write-error')
    act(() => vi.advanceTimersByTime(500))
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V4_KEY)).toBe(raw)
    fireEvent.click(screen.getByText('change valid period invalid'))
    act(() => vi.advanceTimersByTime(500))
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V4_KEY)).toBe(raw)
  })

  it('外部分頁不得把新產生的非五分鐘時間同步為 legacy', () => {
    const original = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))); const originalRaw = JSON.stringify(original)
    localStorage.setItem(APP_DATA_V6_KEY, originalRaw)
    render(<Harness />)
    const external = structuredClone(original); external.teachingUnits[0].periods[0].startTime = '08:03'
    const externalRaw = JSON.stringify(external)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: originalRaw, newValue: externalRaw, storageArea: localStorage })))
    expect(screen.getByTestId('status').textContent).toBe('read-error')
    expect(screen.getByTestId('first-period').textContent).not.toContain('08:03')
  })

  it('保留未修改 legacy 時間時允許更新其他資料並寫入', () => {
    const legacy = migrateV3ToV4(structuredClone(initialData)); legacy.teachingUnits[0].periods[0].startTime = '08:03'; legacy.teachingUnits[0].periods[0].endTime = '08:58'
    localStorage.setItem(APP_DATA_V4_KEY, JSON.stringify(legacy))
    render(<Harness />)
    fireEvent.click(screen.getByText('rename'))
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('status').textContent).toBe('saved')
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    expect(stored.projects[0].name).toBe('本頁版本')
    expect(stored.teachingUnits[0].periods[0]).toMatchObject({ startTime: '08:03', endTime: '08:58' })
  })

  it('遷移失敗時保持 read-error，不建立 v4 且保留損壞 v3', () => {
    localStorage.setItem(APP_DATA_V3_KEY, '{broken-v3')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('status').textContent).toBe('read-error')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBeNull()
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
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V3_KEY)).toBe(rawV3)
  })

  it('跨分頁有本地待寫入內容時進入 conflict，確認前不覆寫外部 v4', () => {
    const original = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(original))
    render(<Harness />)
    fireEvent.click(screen.getByText('rename'))
    const external = structuredClone(original)
    external.projects[0].name = '外部分頁版本'
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, oldValue: JSON.stringify(original), newValue: externalRaw, storageArea: localStorage })))
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(externalRaw)
    fireEvent.click(screen.getByText('accept'))
    expect(screen.getByTestId('name').textContent).toBe('外部分頁版本')
    expect(screen.getByTestId('status').textContent).toBe('saved')
  })

  it('另一分頁在首次 migration 寫入前建立 v5 時不覆寫', () => {
    const rawV4 = JSON.stringify(migrateV3ToV4(initialData))
    localStorage.setItem(APP_DATA_V4_KEY, rawV4)
    render(<Harness />)
    const external = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(initialData)))
    external.projects[0].name = '另一分頁'
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(externalRaw)
    expect(localStorage.getItem(APP_DATA_V4_KEY)).toBe(rawV4)
  })
})

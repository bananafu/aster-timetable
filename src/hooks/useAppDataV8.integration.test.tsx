// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_DATA_V8_ACTIVATION_KEY, type V8ActivationMetadata } from '../data/activationV8'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { migrateV7ToV8 } from '../data/migrationsV8'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { APP_DATA_V8_KEY } from '../data/storageV8'
import type { AppDataV7, AppDataV8 } from '../types'
import { useAppDataV8 } from './useAppDataV8'

const v7 = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
const v8 = () => migrateV7ToV8(v7())
const rename = (data: AppDataV8, name: string): AppDataV8 => ({
  ...data,
  projects: data.projects.map((project, index) => index === 0 ? { ...project, name } : project),
})

function Harness() {
  const [data, setData, status, controls, persistence, info] = useAppDataV8()
  return <>
    <output data-testid="status">{status}</output>
    <output data-testid="name">{data.projects[0]?.name ?? ''}</output>
    <output data-testid="pending">{String(persistence.pending)}</output>
    <output data-testid="revision">{persistence.revision}</output>
    <output data-testid="receipt">{persistence.receipt?.revision ?? ''}</output>
    <output data-testid="source">{info.source}</output>
    <output data-testid="writable">{String(info.writable)}</output>
    <output data-testid="migration">{String(info.migration?.preflight.canMigrate ?? '')}</output>
    <output data-testid="failure">{info.migrationFailure?.code ?? ''}</output>
    <output data-testid="conflict-source">{controls.conflictSource ?? ''}</output>
    <output data-testid="error-code">{controls.errorCode ?? ''}</output>
    <output data-testid="raw-v7">{controls.rawV7 ?? ''}</output>
    <output data-testid="raw-v8">{controls.rawV8 ?? ''}</output>
    <output data-testid="local">{controls.exportLocalJson()}</output>
    <output data-testid="activation-fingerprint">{info.activationMetadata?.sourceV7Fingerprint ?? ''}</output>
    <button onClick={() => setData((current) => rename(current, '本頁草稿'))}>rename</button>
    <button onClick={controls.adoptExternalV8}>adopt</button>
    <button onClick={controls.retryWrite}>retry</button>
  </>
}

function receive(key: string, oldValue: string | null, newValue: string | null) {
  act(() => window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage })))
}

describe('useAppDataV8 standalone runtime host', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('stays inactive and performs no write when both V8 and V7 are absent', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)
    act(() => vi.advanceTimersByTime(500))

    expect(screen.getByTestId('status').textContent).toBe('inactive')
    expect(screen.getByTestId('writable').textContent).toBe('false')
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBeNull()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('builds a read-only reconciled V7 candidate without persisting or changing V7', () => {
    const source = v7()
    const rawV7 = JSON.stringify(source)
    localStorage.setItem(APP_DATA_V7_KEY, rawV7)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)

    expect(screen.getByTestId('status').textContent).toBe('migration-ready')
    expect(screen.getByTestId('migration').textContent).toBe('true')
    expect(screen.getByTestId('raw-v7').textContent).toBe(rawV7)
    fireEvent.click(screen.getByText('rename'))
    act(() => vi.advanceTimersByTime(500))
    expect(screen.getByTestId('name').textContent).toBe(source.projects[0].name)
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(rawV7)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('returns structured migration-blocked state and never creates V8', () => {
    const source = v7()
    const blocked: AppDataV7 = {
      ...source,
      activeProjectId: null,
      projects: [], timetables: [], schools: [], teachingUnits: [], classes: [], recurringLessons: [],
      events: [], overrides: [], oneOffLessons: [], migrationWarnings: [],
    }
    const rawV7 = JSON.stringify(blocked)
    localStorage.setItem(APP_DATA_V7_KEY, rawV7)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)

    expect(screen.getByTestId('status').textContent).toBe('migration-blocked')
    expect(screen.getByTestId('failure').textContent).toBe('zero-project-subjects')
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBeNull()
    expect(setItem).not.toHaveBeenCalled()
  })

  it('loads an existing valid V8 without replacing it from a newer V7 snapshot', () => {
    const current = v8()
    const rawV8 = JSON.stringify(current)
    const newerV7 = { ...v7(), projects: v7().projects.map((project) => ({ ...project, name: '較新的 V7' })) }
    localStorage.setItem(APP_DATA_V8_KEY, rawV8)
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(newerV7))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)
    act(() => vi.advanceTimersByTime(500))

    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(screen.getByTestId('source').textContent).toBe('v8')
    expect(screen.getByTestId('name').textContent).toBe(current.projects[0].name)
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('reports corrupt V8 and exposes its exact raw JSON without reset or V7 fallback', () => {
    const rawV7 = JSON.stringify(v7())
    localStorage.setItem(APP_DATA_V8_KEY, '{broken-v8')
    localStorage.setItem(APP_DATA_V7_KEY, rawV7)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)

    expect(screen.getByTestId('status').textContent).toBe('read-error')
    expect(screen.getByTestId('raw-v8').textContent).toBe('{broken-v8')
    expect(screen.getByTestId('raw-v7').textContent).toBe(rawV7)
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe('{broken-v8')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('writes through the single setData path and advances a receipt only after read-back confirmation', () => {
    const rawV8 = JSON.stringify(v8())
    localStorage.setItem(APP_DATA_V8_KEY, rawV8)
    render(<Harness />)

    fireEvent.click(screen.getByText('rename'))
    expect(screen.getByTestId('name').textContent).toBe('本頁草稿')
    expect(screen.getByTestId('pending').textContent).toBe('true')
    expect(screen.getByTestId('revision').textContent).toBe('0')
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(rawV8)

    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(screen.getByTestId('pending').textContent).toBe('false')
    expect(screen.getByTestId('revision').textContent).toBe('1')
    expect(screen.getByTestId('receipt').textContent).toBe('1')
    expect(JSON.parse(localStorage.getItem(APP_DATA_V8_KEY)!).projects[0].name).toBe('本頁草稿')
  })

  it('preserves the local draft and does not advance the receipt when a write fails', () => {
    const rawV8 = JSON.stringify(v8())
    localStorage.setItem(APP_DATA_V8_KEY, rawV8)
    render(<Harness />)
    fireEvent.click(screen.getByText('rename'))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    act(() => vi.advanceTimersByTime(200))

    expect(screen.getByTestId('status').textContent).toBe('write-error')
    expect(screen.getByTestId('name').textContent).toBe('本頁草稿')
    expect(screen.getByTestId('pending').textContent).toBe('true')
    expect(screen.getByTestId('revision').textContent).toBe('0')
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
  })

  it('rejects a stale V8 snapshot without overwriting it and can adopt the external version', () => {
    const current = v8()
    const rawV8 = JSON.stringify(current)
    localStorage.setItem(APP_DATA_V8_KEY, rawV8)
    render(<Harness />)
    fireEvent.click(screen.getByText('rename'))
    const external = JSON.stringify(rename(current, '外部分頁'))
    localStorage.setItem(APP_DATA_V8_KEY, external)
    act(() => vi.advanceTimersByTime(200))

    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(screen.getByTestId('conflict-source').textContent).toBe('v8')
    expect(screen.getByTestId('name').textContent).toBe('本頁草稿')
    expect(screen.getByTestId('local').textContent).toContain('本頁草稿')
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(external)

    fireEvent.click(screen.getByText('adopt'))
    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(screen.getByTestId('name').textContent).toBe('外部分頁')
    expect(screen.getByTestId('pending').textContent).toBe('false')
    expect(screen.getByTestId('revision').textContent).toBe('0')
  })

  it('synchronizes a valid cross-tab V8 storage event when there is no local draft', () => {
    const current = v8()
    const rawV8 = JSON.stringify(current)
    localStorage.setItem(APP_DATA_V8_KEY, rawV8)
    render(<Harness />)
    const external = JSON.stringify(rename(current, '跨分頁版本'))
    localStorage.setItem(APP_DATA_V8_KEY, external)
    receive(APP_DATA_V8_KEY, rawV8, external)

    expect(screen.getByTestId('status').textContent).toBe('saved')
    expect(screen.getByTestId('name').textContent).toBe('跨分頁版本')
    expect(screen.getByTestId('revision').textContent).toBe('0')
  })

  it('blocks a pending write when the guarded V7 key changes', () => {
    const currentV7 = v7()
    const rawV7 = JSON.stringify(currentV7)
    const rawV8 = JSON.stringify(migrateV7ToV8(currentV7))
    localStorage.setItem(APP_DATA_V7_KEY, rawV7)
    localStorage.setItem(APP_DATA_V8_KEY, rawV8)
    render(<Harness />)
    fireEvent.click(screen.getByText('rename'))
    const changedV7 = JSON.stringify({ ...currentV7, projects: currentV7.projects.map((project) => ({ ...project, name: '舊版分頁' })) })
    localStorage.setItem(APP_DATA_V7_KEY, changedV7)
    act(() => vi.advanceTimersByTime(200))

    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(screen.getByTestId('conflict-source').textContent).toBe('v7')
    expect(screen.getByTestId('name').textContent).toBe('本頁草稿')
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(changedV7)
  })

  it('detects a V7 storage event and never treats it as a new guard baseline', () => {
    const currentV7 = v7()
    const rawV7 = JSON.stringify(currentV7)
    const rawV8 = JSON.stringify(migrateV7ToV8(currentV7))
    localStorage.setItem(APP_DATA_V7_KEY, rawV7)
    localStorage.setItem(APP_DATA_V8_KEY, rawV8)
    render(<Harness />)
    const changedV7 = JSON.stringify({ ...currentV7, projects: currentV7.projects.map((project) => ({ ...project, name: '外部 V7' })) })
    localStorage.setItem(APP_DATA_V7_KEY, changedV7)
    receive(APP_DATA_V7_KEY, rawV7, changedV7)

    expect(screen.getByTestId('status').textContent).toBe('conflict')
    expect(screen.getByTestId('conflict-source').textContent).toBe('v7')
    fireEvent.click(screen.getByText('rename'))
    act(() => vi.advanceTimersByTime(200))
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(rawV8)
  })

  it('keeps activation fingerprint stable across remounts even when V7 changes', () => {
    const currentV7 = v7()
    const rawV8 = JSON.stringify(migrateV7ToV8(currentV7))
    const activation: V8ActivationMetadata = {
      metadataVersion: 1,
      sourceV7Fingerprint: `sha256:${'b'.repeat(64)}`,
      sourceV7Key: APP_DATA_V7_KEY,
      v8ActivationRevision: 3,
      activatedAt: '2026-10-22T02:00:00.000Z',
      status: 'active',
    }
    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(currentV7))
    localStorage.setItem(APP_DATA_V8_KEY, rawV8)
    localStorage.setItem(APP_DATA_V8_ACTIVATION_KEY, JSON.stringify(activation))
    const first = render(<Harness />)
    expect(screen.getByTestId('activation-fingerprint').textContent).toBe(activation.sourceV7Fingerprint)
    first.unmount()

    localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify({
      ...currentV7,
      projects: currentV7.projects.map((project) => ({ ...project, name: '後續 V7 變更' })),
    }))
    render(<Harness />)
    expect(screen.getByTestId('activation-fingerprint').textContent).toBe(activation.sourceV7Fingerprint)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V8_ACTIVATION_KEY)!)).toEqual(activation)
  })
})

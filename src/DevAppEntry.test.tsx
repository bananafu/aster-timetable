// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevAppEntry, FormalAppEntry, selectDevRuntimeEntry } from './DevAppEntry'
import { APP_DATA_V8_ACTIVATION_KEY, fingerprintV7Raw, V8_BOOTSTRAP_KEY,
  V8_TRANSACTION_KEY } from './data/activationV8'
import { initializeFreshV9 } from './data/initializeFreshV9'
import { APP_DATA_V7_KEY } from './data/storageV7'
import { APP_DATA_V8_KEY, createEmptyAppDataV8 } from './data/storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_AUTO_BACKUP_PREFIX, V9_BACKUP_PREFIX,
  type V9ActivationRecord, type V9BackupRecord } from './data/storageV9'
import * as formalRuntime from './formalRuntime'

const appMount = vi.hoisted(() => vi.fn())
const v9Mount = vi.hoisted(() => vi.fn())
vi.mock('./App', () => ({ default: () => { appMount(); return <div>V7 formal App</div> } }))
vi.mock('./FormalV9Composition', () => ({
  FormalV9Composition: () => { v9Mount(); return <div>V9 formal App</div> },
}))
vi.mock('./V9LocalPreview', () => ({ V9LocalPreview: () => <div>V9 local preview</div> }))

const v9Document = JSON.stringify({ ...createEmptyAppDataV8(), schemaVersion: 9 })
const createdAt = '2026-10-26T00:00:00.000Z'
const provideLock = () => vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
  operation: (lock: unknown) => Promise<unknown>) => operation({}) } })

async function activeEvidence() {
  const sourceV8Raw = JSON.stringify(createEmptyAppDataV8())
  const sourceActivationRaw = JSON.stringify({ kind: 'empty-bootstrap-source' })
  const sourceV8Digest = await fingerprintV7Raw(sourceV8Raw)
  const sourceActivationDigest = await fingerprintV7Raw(sourceActivationRaw)
  const candidateDigest = await fingerprintV7Raw(v9Document)
  const backupKey = `${V9_BACKUP_PREFIX}entry-test`
  const metadata: V9ActivationRecord = {
    schemaVersion: 1, kind: 'timetable-subject-upgrade', attemptId: 'entry-test', status: 'active',
    sourceV8Digest, sourceActivationKey: V8_BOOTSTRAP_KEY, sourceActivationDigest, sourceV7Digest: null,
    backupKey, initialDigest: candidateDigest, currentDigest: candidateDigest, documentRevision: 0,
    createdAt, updatedAt: createdAt, activatedAt: createdAt,
  }
  const backup: V9BackupRecord = {
    schemaVersion: 1, kind: 'timetable-subject-upgrade-backup', attemptId: 'entry-test',
    sourceV8Key: APP_DATA_V8_KEY, sourceV8Raw, sourceV8Digest,
    sourceActivationKey: V8_BOOTSTRAP_KEY, sourceActivationRaw, sourceActivationDigest,
    sourceV7Digest: null, candidateRaw: v9Document, candidateDigest, decisions: [], createdAt,
  }
  return [[APP_DATA_V8_KEY, sourceV8Raw], [V8_BOOTSTRAP_KEY, sourceActivationRaw],
    [APP_DATA_V9_KEY, v9Document], [V9_ACTIVATION_KEY, JSON.stringify(metadata)],
    [backupKey, JSON.stringify(backup)]] as [string, string][]
}

function seed(entries: [string, string][]) {
  for (const [key, value] of entries) localStorage.setItem(key, value)
}

function seedBlocked(status: 'preparing' | 'interrupted', withDocument = true) {
  const digest = `sha256:${'a'.repeat(64)}` as const
  const metadata: V9ActivationRecord = {
    schemaVersion: 1, kind: 'timetable-subject-upgrade', attemptId: 'entry-test', status,
    sourceV8Digest: digest, sourceActivationKey: V8_BOOTSTRAP_KEY, sourceActivationDigest: digest,
    sourceV7Digest: null, backupKey: `${V9_BACKUP_PREFIX}entry-test`, initialDigest: digest,
    currentDigest: digest, documentRevision: 0, createdAt, updatedAt: createdAt, activatedAt: null,
  }
  if (withDocument) localStorage.setItem(APP_DATA_V9_KEY, v9Document)
  localStorage.setItem(V9_ACTIVATION_KEY, JSON.stringify(metadata))
}

beforeEach(() => {
  localStorage.clear()
  appMount.mockClear()
  v9Mount.mockClear()
  window.history.replaceState({}, '', '/aster-timetable/')
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  window.history.replaceState({}, '', '/aster-timetable/')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('development V9 local preview entry', () => {
  it('mounts the existing formal V9 composition after explicit fresh initialization', async () => {
    provideLock()
    expect((await initializeFreshV9(localStorage,
      { attemptId: 'fresh-formal', createdAt })).ok).toBe(true)
    render(<FormalAppEntry />)
    expect(await screen.findByText('V9 formal App')).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()
  })

  it.each([
    ['', 'without a query'],
    ['?runtime=preview', 'for the preview value'],
    ['?runtime=unknown', 'for an unknown value'],
    ['?runtime=Formal', 'for a case-mismatched value'],
  ])('mounts only the memory preview on localhost %s (%s)', async (search) => {
    window.history.replaceState({}, '', `/aster-timetable/${search}`)
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    render(<DevAppEntry />)
    expect(await screen.findByText('V9 local preview')).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByText('V9 formal App')).toBeNull()
    expect(screen.queryByRole('dialog', { name: '開始使用 Toki' })).toBeNull()
    expect(reads).not.toHaveBeenCalled()
    expect(writes).not.toHaveBeenCalled()
  })

  it('keeps the retired V8 hash on the memory preview', async () => {
    window.history.replaceState({}, '', '/aster-timetable/#/v8-preview')
    render(<DevAppEntry />)
    expect(await screen.findByText('V9 local preview')).toBeTruthy()
  })

  it('selects FormalAppEntry only for the exact formal query without writing storage', async () => {
    window.history.replaceState({}, '', '/aster-timetable/?runtime=formal')
    const beforeKeys = Object.keys(localStorage)
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const removals = vi.spyOn(Storage.prototype, 'removeItem')
    render(<DevAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByText('V9 local preview')).toBeNull()
    expect(writes).not.toHaveBeenCalled()
    expect(removals).not.toHaveBeenCalled()
    expect(Object.keys(localStorage)).toEqual(beforeKeys)
  })

  it('keeps blocked V9 evidence fail-closed through the formal query', async () => {
    seedBlocked('preparing')
    window.history.replaceState({}, '', '/aster-timetable/?runtime=formal')
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    render(<DevAppEntry />)
    await waitFor(() => expect(reads).toHaveBeenCalledWith(APP_DATA_V9_KEY))
    expect(screen.queryByText('V9 local preview')).toBeNull()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByText('V9 formal App')).toBeNull()
  })

  it.each([
    [true, 'localhost', '?runtime=formal', 'formal'],
    [true, 'localhost', '', 'preview'],
    [true, '127.0.0.1', '?runtime=formal', 'formal'],
    [true, '127.0.0.1', '', 'preview'],
    [true, 'localhost', '?runtime=FORMAL', 'preview'],
    [true, 'localhost', '?runtime=unknown', 'preview'],
    [true, 'localhost', '?runtime=formal&runtime=preview', 'preview'],
    [true, 'localhost', '?source=dev&runtime=formal', 'formal'],
    [false, 'localhost', '?runtime=preview', 'formal'],
    [false, 'localhost', '?runtime=formal', 'formal'],
    [true, 'example.test', '?runtime=preview', 'formal'],
  ] as const)('selects %s/%s/%s as %s', (development, hostname, search, expected) => {
    expect(selectDevRuntimeEntry(development, hostname, search)).toBe(expected)
  })
})

describe('formal runtime entry', () => {
  it('shows the fresh confirmation without mounting V7 or writing storage', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    render(<FormalAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(writes).not.toHaveBeenCalled()
    expect(appMount).not.toHaveBeenCalled()
    expect(v9Mount).not.toHaveBeenCalled()
  })

  it('initializes only after confirmation and mounts formal V9 after gate verification', async () => {
    provideLock()
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    render(<FormalAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    expect(writes).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    expect(await screen.findByText('V9 formal App')).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(writes.mock.calls.filter(([key]) => key === APP_DATA_V9_KEY)).toHaveLength(1)
    expect(writes.mock.calls.filter(([key]) => key === V9_ACTIVATION_KEY)).toHaveLength(2)
  })

  it('cancels without writing or remounting V7, and allows a new session to ask again', async () => {
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    const first = render(<FormalAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V9_KEY })))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(writes).not.toHaveBeenCalled()
    first.unmount()
    render(<FormalAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    expect(writes).not.toHaveBeenCalled()
  })

  it('ignores rapid duplicate confirmation while initialization is pending', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const request = vi.fn(async (_name: string, _options: unknown,
      operation: (lock: unknown) => Promise<unknown>) => { await held; return operation({}) })
    vi.stubGlobal('navigator', { locks: { request } })
    render(<FormalAppEntry />)
    const create = await screen.findByRole('button', { name: '建立' })
    fireEvent.click(create)
    fireEvent.click(create)
    expect(request).toHaveBeenCalledTimes(1)
    expect(create.hasAttribute('disabled')).toBe(true)
    await act(async () => { release() })
    expect(await screen.findByText('V9 formal App')).toBeTruthy()
  })

  it('rejects a second initializer after the first one writes active evidence', async () => {
    let queued = Promise.resolve()
    const request = vi.fn((_name: string, _options: unknown,
      operation: (lock: unknown) => Promise<unknown>) => {
      const next = queued.then(() => operation({}))
      queued = next.then(() => undefined)
      return next
    })
    vi.stubGlobal('navigator', { locks: { request } })
    render(<><FormalAppEntry /><FormalAppEntry /></>)
    await waitFor(() => expect(screen.getAllByRole('dialog', { name: '開始使用 Toki' })).toHaveLength(2))
    const createButtons = screen.getAllByRole('button', { name: '建立' })
    fireEvent.click(createButtons[0])
    fireEvent.click(createButtons[1])
    expect(await screen.findByText('V9 formal App')).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toContain('資料狀態已變更')
    expect(request).toHaveBeenCalledTimes(2)
    expect(Object.keys(localStorage).filter((key) => key.startsWith(V9_BACKUP_PREFIX))).toHaveLength(1)
  })

  it.each([
    [APP_DATA_V8_KEY, '{}'], [V8_BOOTSTRAP_KEY, '{}'], [APP_DATA_V8_ACTIVATION_KEY, '{}'],
    [V8_TRANSACTION_KEY, '{}'], [APP_DATA_V9_KEY, '{corrupt'], [V9_ACTIVATION_KEY, '{corrupt'],
    [`${V9_BACKUP_PREFIX}orphan`, '{}'], [`${V9_AUTO_BACKUP_PREFIX}orphan`, '{}'],
    ['aster-timetable-unknown-v9-evidence', '{}'],
  ])('blocks existing %s evidence without fresh modal or V7 fallback', async (key, value) => {
    localStorage.setItem(key, value)
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    render(<FormalAppEntry />)
    await waitFor(() => expect(reads).toHaveBeenCalled())
    expect(screen.queryByRole('dialog', { name: '開始使用 Toki' })).toBeNull()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByText('V9 formal App')).toBeNull()
  })

  it('blocks multiple orphan backups without altering either backup', async () => {
    const entries: [string, string][] = [[`${V9_BACKUP_PREFIX}a`, '{}'], [`${V9_BACKUP_PREFIX}b`, '{bad']]
    seed(entries)
    render(<FormalAppEntry />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText('V7 formal App')).toBeNull()
    for (const [key, value] of entries) expect(localStorage.getItem(key)).toBe(value)
  })

  it('blocks mixed V7 and V8 evidence rather than mounting V7', async () => {
    seed([[APP_DATA_V7_KEY, 'preserve-v7'], [APP_DATA_V8_KEY, '{}']])
    render(<FormalAppEntry />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('V7 formal App')).toBeNull()
  })

  it('fails closed when storage cannot be read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('read-failure') })
    render(<FormalAppEntry />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByText('V9 formal App')).toBeNull()
  })

  it('rejects evidence added after the modal opens without overwriting it', async () => {
    render(<FormalAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    localStorage.setItem(APP_DATA_V7_KEY, 'new-v7-evidence')
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    expect((await screen.findByRole('alert')).textContent).toContain('資料狀態已變更')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe('new-v7-evidence')
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBeNull()
    expect((screen.getByRole('button', { name: '建立' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps a failed backup attempt blocked without cleanup or retry', async () => {
    provideLock()
    const original = Storage.prototype.getItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith(V9_BACKUP_PREFIX)) return '{corrupt-readback}'
      return original.call(this, key)
    })
    render(<FormalAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    expect((await screen.findByRole('alert')).textContent).toContain('備份驗證失敗')
    expect(Object.keys(localStorage).some((key) => key.startsWith(V9_BACKUP_PREFIX))).toBe(true)
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBeNull()
    expect((screen.getByRole('button', { name: '建立' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('preserves interrupted preparing evidence and does not offer a fresh retry', async () => {
    provideLock()
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === APP_DATA_V9_KEY) throw new Error('document-write-failed')
      return original.call(this, key, value)
    })
    const first = render(<FormalAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    expect((await screen.findByRole('alert')).textContent).toContain('工作環境寫入失敗')
    expect(JSON.parse(localStorage.getItem(V9_ACTIVATION_KEY) ?? '{}').status).toBe('preparing')
    expect(Object.keys(localStorage).some((key) => key.startsWith(V9_BACKUP_PREFIX))).toBe(true)
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBeNull()
    first.unmount()
    render(<FormalAppEntry />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('V7 formal App')).toBeNull()
  })

  it('requires a second Runtime Gate decision before mounting V9', async () => {
    provideLock()
    const original = formalRuntime.inspectFormalRuntime
    let inspections = 0
    vi.spyOn(formalRuntime, 'inspectFormalRuntime').mockImplementation(async (storage) => {
      inspections += 1
      if (inspections === 2) return { runtime: 'blocked-v9', v9Status: 'invalid-evidence' }
      return original(storage)
    })
    render(<FormalAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    await waitFor(() => expect(inspections).toBe(2))
    expect(screen.queryByText('V9 formal App')).toBeNull()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports unavailable Web Locks without writing or granting a runtime', async () => {
    vi.stubGlobal('navigator', { locks: undefined })
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    render(<FormalAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    expect((await screen.findByRole('alert')).textContent).toContain('無法取得資料鎖')
    expect(writes).not.toHaveBeenCalled()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByText('V9 formal App')).toBeNull()
  })

  it('closes the fresh modal if another tab changes Toki evidence', async () => {
    render(<FormalAppEntry />)
    expect(await screen.findByRole('dialog', { name: '開始使用 Toki' })).toBeTruthy()
    localStorage.setItem(APP_DATA_V8_KEY, '{}')
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V8_KEY })))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('V7 formal App')).toBeNull()
  })

  it('mounts V7 when recognized legacy data exists', async () => {
    localStorage.setItem(APP_DATA_V7_KEY, 'preserve-v7')
    render(<FormalAppEntry />)
    expect(await screen.findByText('V7 formal App')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '開始使用 Toki' })).toBeNull()
    expect(appMount).toHaveBeenCalledTimes(1)
    expect(v9Mount).not.toHaveBeenCalled()
  })

  it('mounts only V9 for complete active evidence without rewriting V7 storage', async () => {
    localStorage.setItem(APP_DATA_V7_KEY, 'preserve-exact-v7-raw')
    const entries = await activeEvidence()
    const v7Digest = await fingerprintV7Raw('preserve-exact-v7-raw')
    const metadataIndex = entries.findIndex(([key]) => key === V9_ACTIVATION_KEY)
    const backupIndex = entries.findIndex(([key]) => key.startsWith(V9_BACKUP_PREFIX))
    entries[metadataIndex][1] = JSON.stringify({ ...JSON.parse(entries[metadataIndex][1]), sourceV7Digest: v7Digest })
    entries[backupIndex][1] = JSON.stringify({ ...JSON.parse(entries[backupIndex][1]), sourceV7Digest: v7Digest })
    seed(entries)
    render(<FormalAppEntry />)
    expect(await screen.findByText('V9 formal App')).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByRole('dialog', { name: '開始使用 Toki' })).toBeNull()
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe('preserve-exact-v7-raw')
  })

  it('fails closed for preparing, inconsistent and corrupt V9 evidence', async () => {
    seedBlocked('preparing')
    const preparing = render(<FormalAppEntry />)
    await waitFor(() => expect(appMount).not.toHaveBeenCalled())
    expect(screen.queryByText('V9 formal App')).toBeNull()
    expect(screen.queryByRole('dialog', { name: '開始使用 Toki' })).toBeNull()
    preparing.unmount()
    localStorage.clear()
    seedBlocked('interrupted', false)
    const inconsistent = render(<FormalAppEntry />)
    await waitFor(() => expect(appMount).not.toHaveBeenCalled())
    expect(screen.queryByText('V9 formal App')).toBeNull()
    inconsistent.unmount()
    localStorage.clear()
    localStorage.setItem(APP_DATA_V9_KEY, '{corrupt')
    render(<FormalAppEntry />)
    await waitFor(() => expect(appMount).not.toHaveBeenCalled())
    expect(screen.queryByText('V9 formal App')).toBeNull()
  })

  it('unmounts V7 when V9 evidence appears and never switches runtime in the same mount', async () => {
    const entries = await activeEvidence()
    localStorage.setItem(APP_DATA_V7_KEY, 'preserve-v7')
    render(<FormalAppEntry />)
    expect(await screen.findByText('V7 formal App')).toBeTruthy()
    seed(entries)
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: APP_DATA_V9_KEY, oldValue: null, newValue: v9Document,
    })))
    await waitFor(() => expect(screen.queryByText('V7 formal App')).toBeNull())
    expect(screen.queryByText('V9 formal App')).toBeNull()
  })

  it('unmounts active V9 when its evidence becomes invalid and never falls back', async () => {
    seed(await activeEvidence())
    render(<FormalAppEntry />)
    expect(await screen.findByText('V9 formal App')).toBeTruthy()
    const oldMetadata = localStorage.getItem(V9_ACTIVATION_KEY)
    localStorage.removeItem(V9_ACTIVATION_KEY)
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: V9_ACTIVATION_KEY, oldValue: oldMetadata, newValue: null,
    })))
    await waitFor(() => expect(screen.queryByText('V9 formal App')).toBeNull())
    expect(screen.queryByText('V7 formal App')).toBeNull()
  })
})

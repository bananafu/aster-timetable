// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevAppEntry, FormalAppEntry, selectDevRuntimeEntry } from './DevAppEntry'
import { fingerprintV7Raw, V8_BOOTSTRAP_KEY } from './data/activationV8'
import { APP_DATA_V7_KEY } from './data/storageV7'
import { APP_DATA_V8_KEY, createEmptyAppDataV8 } from './data/storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_BACKUP_PREFIX,
  type V9ActivationRecord, type V9BackupRecord } from './data/storageV9'

const appMount = vi.hoisted(() => vi.fn())
const v9Mount = vi.hoisted(() => vi.fn())
vi.mock('./App', () => ({ default: () => { appMount(); return <div>V7 formal App</div> } }))
vi.mock('./FormalV9Composition', () => ({
  FormalV9Composition: () => { v9Mount(); return <div>V9 formal App</div> },
}))
vi.mock('./V9LocalPreview', () => ({ V9LocalPreview: () => <div>V9 local preview</div> }))

const v9Document = JSON.stringify({ ...createEmptyAppDataV8(), schemaVersion: 9 })
const createdAt = '2026-10-26T00:00:00.000Z'

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
})

describe('development V9 local preview entry', () => {
  it.each([
    ['', 'without a query'],
    ['?runtime=preview', 'for the preview value'],
    ['?runtime=unknown', 'for an unknown value'],
    ['?runtime=Formal', 'for a case-mismatched value'],
  ])('mounts only the memory preview on localhost %s (%s)', async (search) => {
    window.history.replaceState({}, '', `/aster-timetable/${search}`)
    render(<DevAppEntry />)
    expect(await screen.findByText('V9 local preview')).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByText('V9 formal App')).toBeNull()
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
    expect(await screen.findByText('V7 formal App')).toBeTruthy()
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
  it('mounts V7 only when V9 evidence is absent', async () => {
    render(<FormalAppEntry />)
    expect(await screen.findByText('V7 formal App')).toBeTruthy()
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
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe('preserve-exact-v7-raw')
  })

  it('fails closed for preparing, inconsistent and corrupt V9 evidence', async () => {
    seedBlocked('preparing')
    const preparing = render(<FormalAppEntry />)
    await waitFor(() => expect(appMount).not.toHaveBeenCalled())
    expect(screen.queryByText('V9 formal App')).toBeNull()
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

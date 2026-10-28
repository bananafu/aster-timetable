// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevAppEntry } from './DevAppEntry'
import { fingerprintV7Raw, V8_BOOTSTRAP_KEY } from './data/activationV8'
import { APP_DATA_V7_KEY } from './data/storageV7'
import { APP_DATA_V8_KEY, createEmptyAppDataV8 } from './data/storageV8'
import {
  APP_DATA_V9_KEY,
  V9_ACTIVATION_KEY,
  V9_BACKUP_PREFIX,
  type V9ActivationRecord,
  type V9BackupRecord,
} from './data/storageV9'
import { V8_PREVIEW_HASH, isV8PreviewRoute } from './previewRoute'

const appMount = vi.hoisted(() => vi.fn())
const v9Mount = vi.hoisted(() => vi.fn())
vi.mock('./App', () => ({
  default: () => {
    appMount()
    return <div>V7 formal App</div>
  },
}))
vi.mock('./FormalV9Composition', () => ({
  FormalV9Composition: () => {
    v9Mount()
    return <div>V9 formal App</div>
  },
}))
vi.mock('./V8PreviewApp', () => ({
  V8PreviewApp: ({ onReturn }: { onReturn: () => void }) => (
    <button onClick={onReturn}>Return from V8 Preview</button>
  ),
}))

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
    schemaVersion: 1,
    kind: 'timetable-subject-upgrade',
    attemptId: 'entry-test',
    status: 'active',
    sourceV8Digest,
    sourceActivationKey: V8_BOOTSTRAP_KEY,
    sourceActivationDigest,
    sourceV7Digest: null,
    backupKey,
    initialDigest: candidateDigest,
    currentDigest: candidateDigest,
    documentRevision: 0,
    createdAt,
    updatedAt: createdAt,
    activatedAt: createdAt,
  }
  const backup: V9BackupRecord = {
    schemaVersion: 1,
    kind: 'timetable-subject-upgrade-backup',
    attemptId: 'entry-test',
    sourceV8Key: APP_DATA_V8_KEY,
    sourceV8Raw,
    sourceV8Digest,
    sourceActivationKey: V8_BOOTSTRAP_KEY,
    sourceActivationRaw,
    sourceActivationDigest,
    sourceV7Digest: null,
    candidateRaw: v9Document,
    candidateDigest,
    decisions: [],
    createdAt,
  }
  return [
    [APP_DATA_V8_KEY, sourceV8Raw],
    [V8_BOOTSTRAP_KEY, sourceActivationRaw],
    [APP_DATA_V9_KEY, v9Document],
    [V9_ACTIVATION_KEY, JSON.stringify(metadata)],
    [backupKey, JSON.stringify(backup)],
  ] as [string, string][]
}

function seed(entries: [string, string][]) {
  for (const [key, value] of entries) localStorage.setItem(key, value)
}

function seedBlocked(status: 'preparing' | 'interrupted', withDocument = true) {
  const digest = `sha256:${'a'.repeat(64)}` as const
  const metadata: V9ActivationRecord = {
    schemaVersion: 1,
    kind: 'timetable-subject-upgrade',
    attemptId: 'entry-test',
    status,
    sourceV8Digest: digest,
    sourceActivationKey: V8_BOOTSTRAP_KEY,
    sourceActivationDigest: digest,
    sourceV7Digest: null,
    backupKey: `${V9_BACKUP_PREFIX}entry-test`,
    initialDigest: digest,
    currentDigest: digest,
    documentRevision: 0,
    createdAt,
    updatedAt: createdAt,
    activatedAt: null,
  }
  if (withDocument) localStorage.setItem(APP_DATA_V9_KEY, v9Document)
  localStorage.setItem(V9_ACTIVATION_KEY, JSON.stringify(metadata))
}

beforeEach(() => {
  localStorage.clear()
  appMount.mockClear()
  v9Mount.mockClear()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  window.location.hash = ''
  vi.restoreAllMocks()
})

describe('development preview routing', () => {
  it('never exposes the preview route in production', () => {
    expect(isV8PreviewRoute(false, V8_PREVIEW_HASH)).toBe(false)
    expect(isV8PreviewRoute(true, V8_PREVIEW_HASH)).toBe(true)
  })

  it('mounts V8 directly without mounting a formal runtime at the Preview URL', async () => {
    window.location.hash = V8_PREVIEW_HASH
    render(<DevAppEntry />)

    expect(await screen.findByText('Return from V8 Preview')).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByText('V9 formal App')).toBeNull()
  })

  it('defaults to V7 and only mounts V8 after an explicit development route', async () => {
    render(<DevAppEntry />)
    expect(await screen.findByText('V7 formal App')).toBeTruthy()
    expect(screen.queryByText('Return from V8 Preview')).toBeNull()
    expect(document.querySelector<HTMLAnchorElement>('a.v8-preview-link')?.getAttribute('href'))
      .toBe(V8_PREVIEW_HASH)

    act(() => {
      window.location.hash = V8_PREVIEW_HASH
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(await screen.findByText('Return from V8 Preview')).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()

    fireEvent.click(screen.getByText('Return from V8 Preview'))
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')))
    expect(await screen.findByText('V7 formal App')).toBeTruthy()
  })

  it('mounts the unchanged V7 entry only when V9 evidence is absent', async () => {
    render(<DevAppEntry />)

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
    const metadata = JSON.parse(entries[metadataIndex][1]) as V9ActivationRecord
    const backup = JSON.parse(entries[backupIndex][1]) as V9BackupRecord
    entries[metadataIndex][1] = JSON.stringify({ ...metadata, sourceV7Digest: v7Digest })
    entries[backupIndex][1] = JSON.stringify({ ...backup, sourceV7Digest: v7Digest })
    seed(entries)

    render(<DevAppEntry />)

    expect(await screen.findByText('V9 formal App')).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(appMount).not.toHaveBeenCalled()
    expect(v9Mount).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe('preserve-exact-v7-raw')
  })

  it('fails closed for preparing, inconsistent and corrupt V9 evidence', async () => {
    seedBlocked('preparing')
    const preparing = render(<DevAppEntry />)
    await waitFor(() => expect(appMount).not.toHaveBeenCalled())
    expect(screen.queryByText('V9 formal App')).toBeNull()
    preparing.unmount()

    localStorage.clear()
    seedBlocked('interrupted', false)
    const inconsistent = render(<DevAppEntry />)
    await waitFor(() => expect(appMount).not.toHaveBeenCalled())
    expect(screen.queryByText('V9 formal App')).toBeNull()
    inconsistent.unmount()

    localStorage.clear()
    localStorage.setItem(APP_DATA_V9_KEY, '{corrupt')
    render(<DevAppEntry />)
    await waitFor(() => expect(appMount).not.toHaveBeenCalled())
    expect(screen.queryByText('V9 formal App')).toBeNull()
  })

  it('unmounts V7 when complete V9 evidence appears and never switches runtime in the same mount', async () => {
    const entries = await activeEvidence()
    render(<DevAppEntry />)
    expect(await screen.findByText('V7 formal App')).toBeTruthy()

    seed(entries)
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: APP_DATA_V9_KEY,
      oldValue: null,
      newValue: v9Document,
    })))

    await waitFor(() => expect(screen.queryByText('V7 formal App')).toBeNull())
    expect(screen.queryByText('V9 formal App')).toBeNull()
    expect(v9Mount).not.toHaveBeenCalled()
  })

  it('unmounts an active V9 Composition when its evidence becomes invalid and never falls back', async () => {
    seed(await activeEvidence())
    render(<DevAppEntry />)
    expect(await screen.findByText('V9 formal App')).toBeTruthy()

    const oldMetadata = localStorage.getItem(V9_ACTIVATION_KEY)
    localStorage.removeItem(V9_ACTIVATION_KEY)
    act(() => window.dispatchEvent(new StorageEvent('storage', {
      key: V9_ACTIVATION_KEY,
      oldValue: oldMetadata,
      newValue: null,
    })))

    await waitFor(() => expect(screen.queryByText('V9 formal App')).toBeNull())
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(appMount).not.toHaveBeenCalled()
  })

  it('keeps the explicit development Preview route available when active V9 exists', async () => {
    seed(await activeEvidence())
    window.location.hash = V8_PREVIEW_HASH
    render(<DevAppEntry />)

    expect(await screen.findByText('Return from V8 Preview')).toBeTruthy()
    expect(screen.queryByText('V7 formal App')).toBeNull()
    expect(screen.queryByText('V9 formal App')).toBeNull()
  })
})

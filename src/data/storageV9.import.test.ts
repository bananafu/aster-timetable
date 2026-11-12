import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFormalV9RecoveryExportPort, inspectFormalV9Recovery } from '../formalV9Recovery'
import { inspectFormalRuntime } from '../formalRuntime'
import { createEmptyProjectV9 } from './managementV9'
import { initializeFreshV9 } from './initializeFreshV9'
import { fingerprintV7Raw } from './activationV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_AUTO_BACKUP_PREFIX,
  createConfirmedV9ExportSnapshot, createEmptyAppDataV9, loadAppDataV9, persistAppDataV9,
  replaceAppDataV9FromValidatedImport } from './storageV9'

const time = '2026-11-12T01:00:00.000Z'

function memory() {
  const values = new Map<string, string>()
  return { values, get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }) }
}

let lockRequest: (_name: string, _options: unknown,
  operation: (lock: unknown) => Promise<unknown>) => Promise<unknown>

beforeEach(() => {
  lockRequest = async (_name, _options, operation) => operation({})
  vi.stubGlobal('navigator', { locks: { request: (...args: Parameters<typeof lockRequest>) =>
    lockRequest(...args) } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function ready() {
  const storage = memory()
  const initialized = await initializeFreshV9(storage, { attemptId: 'fresh-import', createdAt: time })
  if (!initialized.ok) throw new Error(initialized.code)
  const expected = () => {
    const loaded = loadAppDataV9(storage)
    if (!loaded.rawDocument || !loaded.rawMetadata || !loaded.metadata) throw new Error('missing evidence')
    return { raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata,
      revision: loaded.metadata.documentRevision }
  }
  return { storage, current: createEmptyAppDataV9(), initialized, expected }
}

describe('V9 verified export and dedicated JSON replacement persistence', () => {
  it('exports exact confirmed raw, digest and revision under the existing Web Lock', async () => {
    const fixture = await ready()
    const snapshot = await createConfirmedV9ExportSnapshot(fixture.storage, fixture.expected())
    expect(snapshot).toEqual({ raw: fixture.expected().raw, revision: 0,
      digest: await fingerprintV7Raw(fixture.expected().raw) })
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  it('fails verified export closed when evidence changes before the locked snapshot', async () => {
    const fixture = await ready()
    const baseline = fixture.expected()
    lockRequest = async (_name, _options, operation) => {
      fixture.storage.values.set(V9_ACTIVATION_KEY, `${baseline.metadataRaw} `)
      return operation({})
    }
    await expect(createConfirmedV9ExportSnapshot(fixture.storage, baseline))
      .rejects.toMatchObject({ code: 'activation-conflict' })
  })

  it('replaces the complete document without merging and preserves exact imported bytes', async () => {
    const fixture = await ready()
    const old = fixture.expected()
    const candidate = createEmptyProjectV9(createEmptyAppDataV9(), { name: '完全不同的專案' }, 'other-project')
    const raw = JSON.stringify(candidate, null, 2)
    const candidateDigest = await fingerprintV7Raw(raw)
    const receipt = await replaceAppDataV9FromValidatedImport(fixture.storage, fixture.current,
      raw, candidateDigest, old)
    expect(receipt).toMatchObject({ raw, revision: 1, attemptId: 'fresh-import',
      preMutationBackup: { operation: 'import-json', rawDocument: old.raw, revision: 0,
        digest: await fingerprintV7Raw(old.raw) } })
    expect(receipt.mutationAttemptId).toBe(receipt.preMutationBackup?.mutationAttemptId)
    expect(fixture.storage.getItem(APP_DATA_V9_KEY)).toBe(raw)
    expect(loadAppDataV9(fixture.storage).document).toEqual(candidate)
    const metadata = loadAppDataV9(fixture.storage).metadata!
    expect(metadata).toMatchObject({ attemptId: fixture.initialized.metadata.attemptId,
      backupKey: fixture.initialized.metadata.backupKey,
      initialDigest: fixture.initialized.metadata.initialDigest,
      currentDigest: candidateDigest, documentRevision: 1 })
    expect((loadAppDataV9(fixture.storage).document?.projects ?? []).map(({ id }) => id))
      .toEqual(['other-project'])
    expect(await inspectFormalRuntime(fixture.storage)).toEqual({ runtime: 'v9', v9Status: 'active' })

    const next = createEmptyProjectV9(candidate, { name: '後續一般更新' }, 'ordinary-project')
    const ordinary = await persistAppDataV9(fixture.storage, candidate, next, fixture.expected())
    expect(ordinary.revision).toBe(2)
  })

  it('rejects invalid candidate, stale digest and stale baseline before replacement success', async () => {
    const fixture = await ready()
    const candidate = createEmptyProjectV9(createEmptyAppDataV9(), { name: '候選' }, 'candidate')
    const raw = JSON.stringify(candidate)
    await expect(replaceAppDataV9FromValidatedImport(fixture.storage, fixture.current,
      '{}', await fingerprintV7Raw('{}'), fixture.expected())).rejects.toMatchObject({ code: 'invalid-next' })
    await expect(replaceAppDataV9FromValidatedImport(fixture.storage, fixture.current,
      raw, `sha256:${'0'.repeat(64)}`, fixture.expected())).rejects.toMatchObject({ code: 'stale-snapshot' })
    const stale = fixture.expected()
    fixture.storage.values.set(V9_ACTIVATION_KEY, `${stale.metadataRaw} `)
    await expect(replaceAppDataV9FromValidatedImport(fixture.storage, fixture.current,
      raw, await fingerprintV7Raw(raw), stale)).rejects.toMatchObject({ code: 'activation-conflict' })
    expect(fixture.storage.getItem(APP_DATA_V9_KEY)).toBe(stale.raw)
  })

  it('does not write the imported document when the import-json backup cannot be written', async () => {
    const fixture = await ready()
    const baseline = fixture.expected()
    const candidate = createEmptyProjectV9(createEmptyAppDataV9(), { name: '候選' }, 'candidate')
    const raw = JSON.stringify(candidate)
    const realWrite = fixture.storage.setItem.getMockImplementation()!
    fixture.storage.setItem.mockImplementation((key, value) => {
      if (key.startsWith(V9_AUTO_BACKUP_PREFIX)) throw new Error('quota')
      realWrite(key, value)
    })
    await expect(replaceAppDataV9FromValidatedImport(fixture.storage, fixture.current,
      raw, await fingerprintV7Raw(raw), baseline)).rejects.toMatchObject({ code: 'backup-failure' })
    expect(fixture.storage.getItem(APP_DATA_V9_KEY)).toBe(baseline.raw)
  })

  it('rejects import when the shared Web Lock is unavailable', async () => {
    const fixture = await ready()
    const baseline = fixture.expected()
    const candidate = createEmptyProjectV9(createEmptyAppDataV9(), { name: '候選' }, 'candidate')
    const raw = JSON.stringify(candidate)
    vi.stubGlobal('navigator', {})
    await expect(replaceAppDataV9FromValidatedImport(fixture.storage, fixture.current,
      raw, await fingerprintV7Raw(raw), baseline)).rejects.toMatchObject({ code: 'lock-unavailable' })
    expect(fixture.storage.getItem(APP_DATA_V9_KEY)).toBe(baseline.raw)
  })

  it.each(['document-write', 'document-readback', 'metadata-readback'] as const)(
    'issues no receipt after %s failure', async (mode) => {
      const fixture = await ready()
      const baseline = fixture.expected()
      const candidate = createEmptyProjectV9(createEmptyAppDataV9(), { name: mode }, 'candidate')
      const raw = JSON.stringify(candidate, null, 2)
      const realWrite = fixture.storage.setItem.getMockImplementation()!
      const realRead = fixture.storage.getItem.getMockImplementation()!
      let hideDocumentRead = false
      let hideMetadataRead = false
      fixture.storage.setItem.mockImplementation((key, value) => {
        if (mode === 'document-write' && key === APP_DATA_V9_KEY && value === raw) {
          throw new Error('document quota')
        }
        realWrite(key, value)
        if (mode === 'document-readback' && key === APP_DATA_V9_KEY && value === raw) {
          hideDocumentRead = true
        }
        if (mode === 'metadata-readback' && key === V9_ACTIVATION_KEY
          && fixture.storage.values.get(APP_DATA_V9_KEY) === raw) hideMetadataRead = true
      })
      fixture.storage.getItem.mockImplementation((key) => {
        if (key === APP_DATA_V9_KEY && hideDocumentRead) {
          hideDocumentRead = false
          return baseline.raw
        }
        if (key === V9_ACTIVATION_KEY && hideMetadataRead) {
          hideMetadataRead = false
          return baseline.metadataRaw
        }
        return realRead(key)
      })
      await expect(replaceAppDataV9FromValidatedImport(fixture.storage, fixture.current,
        raw, await fingerprintV7Raw(raw), baseline)).rejects.toMatchObject({
        code: mode === 'document-write' ? 'write-failure' : 'readback-failure',
      })
      expect([...fixture.storage.values.keys()].some((key) => key.startsWith(V9_AUTO_BACKUP_PREFIX)))
        .toBe(true)
    },
  )

  it('leaves exact export-only Recovery evidence when document write succeeds but metadata write fails', async () => {
    const fixture = await ready()
    const baseline = fixture.expected()
    const candidate = createEmptyProjectV9(createEmptyAppDataV9(), { name: '部分寫入' }, 'partial')
    const raw = JSON.stringify(candidate, null, 2)
    const realWrite = fixture.storage.setItem.getMockImplementation()!
    fixture.storage.setItem.mockImplementation((key, value) => {
      if (key === V9_ACTIVATION_KEY && fixture.storage.values.get(APP_DATA_V9_KEY) === raw) {
        throw new Error('metadata quota')
      }
      realWrite(key, value)
    })
    await expect(replaceAppDataV9FromValidatedImport(fixture.storage, fixture.current,
      raw, await fingerprintV7Raw(raw), baseline)).rejects.toMatchObject({ code: 'write-failure' })
    expect(fixture.storage.getItem(APP_DATA_V9_KEY)).toBe(raw)
    expect(fixture.storage.getItem(V9_ACTIVATION_KEY)).toBe(baseline.metadataRaw)
    expect(await inspectFormalRuntime(fixture.storage)).toEqual({ runtime: 'blocked-v9',
      v9Status: 'invalid-evidence' })
    const recovery = await inspectFormalV9Recovery(fixture.storage)
    expect(recovery.kind).toBe('export-only')
    expect(recovery.capabilities).toEqual({ activate: false, resume: false, resumeOrphan: false,
      export: true })
    const port = createFormalV9RecoveryExportPort(recovery)
    expect(port.readExact(APP_DATA_V9_KEY)).toBe(raw)
    expect(port.readExact(V9_ACTIVATION_KEY)).toBe(baseline.metadataRaw)
    const backup = port.entries.find(({ key }) => key.startsWith(V9_AUTO_BACKUP_PREFIX))
    expect(backup?.role).toBe('v9-backup')
    expect(JSON.parse(port.readExact(backup!.key)!)).toMatchObject({ operation: 'import-json',
      rawDocument: baseline.raw, revision: baseline.revision })
  })
})

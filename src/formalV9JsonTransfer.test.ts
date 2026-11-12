import { describe, expect, it, vi } from 'vitest'
import { fingerprintV7Raw } from './data/activationV8'
import { createEmptyProjectV9 } from './data/managementV9'
import { createEmptyAppDataV9, type V9ConfirmedExportSnapshot,
  type V9PersistenceReceipt } from './data/storageV9'
import { createFormalV9JsonTransferController, createV9BackupFileName,
  createVerifiedV9JsonDownload, parseV9JsonImportCandidate } from './formalV9JsonTransfer'
import type { AppDataV9 } from './types/v9'

const digestOf = (raw: string) => fingerprintV7Raw(raw)

describe('Formal V9 JSON import parser', () => {
  it('validates a complete V9 candidate and binds its exact raw digest and summary', async () => {
    const document = createEmptyProjectV9(createEmptyAppDataV9(), { name: '匯入專案' }, 'imported')
    const raw = JSON.stringify(document, null, 2)
    const candidate = await parseV9JsonImportCandidate('backup.json', raw)
    expect(candidate).toMatchObject({ fileName: 'backup.json', raw, schemaVersion: 9,
      digest: await digestOf(raw), summary: { projects: 1, timetables: 0,
        recurringLessons: 0, oneOffLessons: 0, events: 0 } })
    expect(candidate.identity).toBe(`${await digestOf(raw)}:${raw.length}`)
    expect(Object.isFrozen(candidate)).toBe(true)
  })

  it.each([
    ['malformed', '{bad', 'invalid-json'],
    ['primitive', '7', 'invalid-document'],
    ['array', '[]', 'invalid-document'],
    ['v7', '{"schemaVersion":7}', 'unsupported-version'],
    ['v8', '{"schemaVersion":8}', 'unsupported-version'],
    ['unknown', '{"schemaVersion":10}', 'unsupported-version'],
  ])('rejects %s input without a preview', async (_name, raw, code) => {
    await expect(parseV9JsonImportCandidate('bad.json', raw)).rejects.toMatchObject({ code })
  })

  it('rejects duplicate IDs, dangling ownership and invalid activeProjectId', async () => {
    const valid = createEmptyProjectV9(createEmptyAppDataV9(), { name: '專案' }, 'project')
    const duplicate: AppDataV9 = { ...valid, projects: [...valid.projects, { ...valid.projects[0] }] }
    const dangling: AppDataV9 = { ...valid, timetables: [{ id: 'table', projectId: 'missing',
      name: '教師', teacherName: '甲' }] }
    const invalidActive: AppDataV9 = { ...valid, activeProjectId: 'missing' }
    for (const document of [duplicate, dangling, invalidActive]) {
      await expect(parseV9JsonImportCandidate('bad.json', JSON.stringify(document)))
        .rejects.toMatchObject({ code: 'invalid-document' })
    }
  })
})

describe('Formal V9 JSON transfer controller', () => {
  async function fixture(candidateDocument = createEmptyProjectV9(createEmptyAppDataV9(),
    { name: '全新集合' }, 'new-project')) {
    const currentDocument = createEmptyProjectV9(createEmptyAppDataV9(), { name: '目前' }, 'current')
    const currentRaw = JSON.stringify(currentDocument)
    const baseline: V9ConfirmedExportSnapshot = Object.freeze({ raw: currentRaw, revision: 4,
      digest: await digestOf(currentRaw) })
    const candidateRaw = JSON.stringify(candidateDocument, null, 2)
    const replace = vi.fn(async ({ raw }: { raw: string; digest: `sha256:${string}` }):
      Promise<V9PersistenceReceipt> => {
      const mutationAttemptId = '11111111-1111-4111-8111-111111111111'
      return { raw, revision: 5, attemptId: 'activation', mutationAttemptId,
        preMutationBackup: { key: `toki-v9-auto-backup:${mutationAttemptId}`, mutationAttemptId,
          operation: 'import-json', rawDocument: currentRaw, revision: 4, digest: baseline.digest } }
    })
    const state = { status: 'active' as const, writable: true, pending: false, revision: 4 }
    const snapshots = vi.fn(async () => baseline)
    const controller = createFormalV9JsonTransferController({
      get document() { return currentDocument }, get status() { return state.status },
      get writable() { return state.writable }, get pending() { return state.pending },
      get revision() { return state.revision }, createConfirmedExportSnapshot: snapshots,
      replaceDocumentFromValidatedImport: replace,
    })
    return { controller, state, replace, snapshots, baseline, candidateRaw, candidateDocument }
  }

  it('previews without mutation, then replaces once only after explicit confirmation', async () => {
    const value = await fixture()
    const prepared = await value.controller.prepareImport('import.json', value.candidateRaw)
    expect(value.replace).not.toHaveBeenCalled()
    expect(prepared.current.projects).toBe(1)
    expect(prepared.candidate.summary.projects).toBe(1)
    await expect(value.controller.confirmImport(prepared, prepared.candidate.identity, false))
      .rejects.toMatchObject({ code: 'confirmation-required' })
    expect(value.replace).not.toHaveBeenCalled()
    const result = await value.controller.confirmImport(prepared, prepared.candidate.identity, true)
    expect(value.replace).toHaveBeenCalledOnce()
    expect(result.activeProjectId).toBe('new-project')
  })

  it('rejects changed candidate identity, stale current snapshot, pending Host and bad receipt', async () => {
    const identity = await fixture()
    const prepared = await identity.controller.prepareImport('import.json', identity.candidateRaw)
    await expect(identity.controller.confirmImport(prepared, 'changed', true))
      .rejects.toMatchObject({ code: 'stale-preview' })
    const stale = await fixture()
    const stalePrepared = await stale.controller.prepareImport('import.json', stale.candidateRaw)
    stale.snapshots.mockResolvedValueOnce({ ...stale.baseline, revision: 5 })
    await expect(stale.controller.confirmImport(stalePrepared, stalePrepared.candidate.identity, true))
      .rejects.toMatchObject({ code: 'stale-preview' })
    const pending = await fixture()
    const pendingPrepared = await pending.controller.prepareImport('import.json', pending.candidateRaw)
    pending.state.pending = true
    await expect(pending.controller.confirmImport(pendingPrepared, pendingPrepared.candidate.identity, true))
      .rejects.toMatchObject({ code: 'not-ready' })
    expect(pending.replace).not.toHaveBeenCalled()
    const mismatch = await fixture()
    const mismatchPrepared = await mismatch.controller.prepareImport('import.json', mismatch.candidateRaw)
    mismatch.replace.mockResolvedValueOnce({ raw: mismatch.candidateRaw, revision: 5,
      attemptId: 'activation' })
    await expect(mismatch.controller.confirmImport(mismatchPrepared,
      mismatchPrepared.candidate.identity, true)).rejects.toMatchObject({ code: 'receipt-mismatch' })
  })

  it('blocks duplicate confirmation while the first replacement is pending', async () => {
    const value = await fixture()
    let release!: (receipt: V9PersistenceReceipt) => void
    const waiting = new Promise<V9PersistenceReceipt>((resolve) => { release = resolve })
    value.replace.mockReturnValueOnce(waiting)
    const prepared = await value.controller.prepareImport('import.json', value.candidateRaw)
    const first = value.controller.confirmImport(prepared, prepared.candidate.identity, true)
    await expect(value.controller.confirmImport(prepared, prepared.candidate.identity, true))
      .rejects.toMatchObject({ code: 'duplicate-submit' })
    const mutationAttemptId = '11111111-1111-4111-8111-111111111111'
    release({ raw: value.candidateRaw, revision: 5, attemptId: 'activation', mutationAttemptId,
      preMutationBackup: { key: `toki-v9-auto-backup:${mutationAttemptId}`, mutationAttemptId,
        operation: 'import-json', rawDocument: value.baseline.raw, revision: 4,
        digest: value.baseline.digest } })
    await expect(first).resolves.toMatchObject({ activeProjectId: 'new-project' })
  })
})

describe('Formal V9 JSON download', () => {
  it('uses local padded filename and places exact snapshot bytes in the Blob', async () => {
    const raw = '{\n  "schemaVersion": 9\n}'
    const snapshot = { raw, revision: 3, digest: await digestOf(raw) }
    expect(createV9BackupFileName(new Date(2026, 0, 2, 3, 4, 5)))
      .toBe('toki-backup-2026-01-02-030405.json')
    const download = createVerifiedV9JsonDownload(snapshot, new Date(2026, 0, 2, 3, 4, 5))
    expect(await download.blob.text()).toBe(raw)
    expect(download.blob.type).toBe('application/json')
  })
})

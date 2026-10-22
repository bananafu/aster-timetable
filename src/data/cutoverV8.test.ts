import { describe, expect, it, vi } from 'vitest'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8WithReport } from './migrationsV8'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY } from './storageV8'
import { APP_DATA_V8_ACTIVATION_KEY, fingerprintV7Raw } from './activationV8'
import { createCutoverBackupV8, isV8RollbackArchiveV8, verifyCutoverBackupV8, type SourceIdentityV8 } from './cutoverBackupV8'
import { checkV7ActivationGuardV8, isExternalBackupConfirmedV8, preflightCutoverV8 } from './cutoverPreflightV8'

const v7 = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
const time = '2026-10-22T01:00:00.000Z'
function memory(entries: [string, string][] = []) {
  const values = new Map(entries)
  return { values, getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }) }
}

describe('R2-B2a backup foundation', () => {
  it('validates a read-only V8 rollback archive contract without writing one', async () => {
    const rawV8 = JSON.stringify(migrateV7ToV8WithReport(v7()).data)
    const archive = { schemaVersion: 1, archiveId: 'archive-1', activationBackupId: 'attempt-1',
      rawV8, digest: await fingerprintV7Raw(rawV8), archivedAt: time, recoveryStatus: 'read-only' }
    expect(await isV8RollbackArchiveV8(archive)).toBe(true)
    expect(await isV8RollbackArchiveV8({ ...archive, digest: `sha256:${'0'.repeat(64)}` })).toBe(false)
    expect(await isV8RollbackArchiveV8({ ...archive, recoveryStatus: 'active' })).toBe(false)
  })
  it('preserves exact V7 raw, correct SHA-256 and verified receipt without changing source', async () => {
    const raw = `  ${JSON.stringify(v7())}\n`
    const store = memory([[APP_DATA_V7_KEY, raw]])
    const result = await createCutoverBackupV8(store, { backupId: 'attempt-1', expectedRaw: raw, createdAt: time })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.source).toEqual({ type: 'v7', key: APP_DATA_V7_KEY, raw,
      digest: await fingerprintV7Raw(raw), validationStatus: 'valid' })
    expect(await verifyCutoverBackupV8(result.raw)).toEqual(result.record)
    expect(store.values.get(APP_DATA_V7_KEY)).toBe(raw)
    expect(store.values.has(APP_DATA_V8_KEY)).toBe(false)
    expect((await createCutoverBackupV8(store, { backupId: 'attempt-1', expectedRaw: raw, createdAt: time }))).toMatchObject({ ok: false, code: 'already-exists' })
    expect(store.values.get(result.key)).toBe(result.raw)
  })

  it('uses an explicit empty marker and does not invent raw or digest', async () => {
    const result = await createCutoverBackupV8(memory(), { backupId: 'empty-1', expectedRaw: null, createdAt: time })
    expect(result).toMatchObject({ ok: true, record: { source: { type: 'empty', validationStatus: 'no-v7-key' } } })
    if (result.ok) expect(Object.keys(result.record.source)).toEqual(['type', 'validationStatus'])
  })

  it('returns structured failures for write, readback, digest mismatch and stale source', async () => {
    const raw = JSON.stringify(v7())
    const store = memory([[APP_DATA_V7_KEY, raw]])
    store.setItem.mockImplementationOnce(() => { throw new Error('quota') })
    expect(await createCutoverBackupV8(store, { backupId: 'fail-write', expectedRaw: raw, createdAt: time })).toMatchObject({ ok: false, code: 'write-failure' })
    const silent = memory([[APP_DATA_V7_KEY, raw]])
    silent.setItem.mockImplementationOnce(() => {})
    expect(await createCutoverBackupV8(silent, { backupId: 'silent', expectedRaw: raw, createdAt: time })).toMatchObject({ ok: false, code: 'readback-mismatch' })
    const unreadable = memory([[APP_DATA_V7_KEY, raw]])
    unreadable.setItem.mockImplementationOnce(() => { unreadable.getItem.mockImplementationOnce(() => { throw new Error('read') }) })
    expect(await createCutoverBackupV8(unreadable, { backupId: 'unreadable', expectedRaw: raw, createdAt: time })).toMatchObject({ ok: false, code: 'readback-failure' })
    const valid = await createCutoverBackupV8(memory([[APP_DATA_V7_KEY, raw]]), { backupId: 'digest', expectedRaw: raw, createdAt: time })
    if (!valid.ok || valid.record.source.type !== 'v7') throw new Error('fixture failed')
    expect(await verifyCutoverBackupV8(JSON.stringify({ ...valid.record, source: {
      ...valid.record.source, digest: `sha256:${'0'.repeat(64)}`,
    } }))).toBe('digest-mismatch')
    expect(await createCutoverBackupV8(store, { backupId: 'stale', expectedRaw: 'older', createdAt: time })).toMatchObject({ ok: false, code: 'source-changed' })
  })
})

describe('R2-B2a cutover preflight', () => {
  it('produces a valid candidate without storage writes and retains review issues', async () => {
    const source = v7()
    const raw = JSON.stringify(source)
    const store = memory([[APP_DATA_V7_KEY, raw]])
    const result = await preflightCutoverV8(store)
    expect(result.canProceed).toBe(true)
    expect(result.source).toEqual({ type: 'v7', key: APP_DATA_V7_KEY, digest: await fingerprintV7Raw(raw) })
    expect(result.candidate?.schemaVersion).toBe(8)
    expect(result.migration?.reconciliation?.isReconciled).toBe(true)
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('creates an isolated empty candidate and blocks a legacy source without V7', async () => {
    const empty = await preflightCutoverV8(memory())
    expect(empty).toMatchObject({ canProceed: true, source: { type: 'empty' }, candidate: {
      subjects: [], classes: [], recurringLessons: [], events: [], teachingProgress: [],
    } })
    expect((await preflightCutoverV8(memory([['aster-timetable-data-v6', '{}']]))).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'legacy-source-present' }),
    ]))
  })

  it('blocks corrupt V7, blocking migration, existing or corrupt V8 and unknown activation', async () => {
    expect((await preflightCutoverV8(memory([[APP_DATA_V7_KEY, '{bad']]))).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'corrupt-v7' }),
    ]))
    const source = v7()
    const blocked = { ...source, activeProjectId: null, projects: [], timetables: [], schools: [], teachingUnits: [], classes: [],
      recurringLessons: [], events: [], overrides: [], oneOffLessons: [], migrationWarnings: [] }
    const blockingResult = await preflightCutoverV8(memory([[APP_DATA_V7_KEY, JSON.stringify(blocked)]]))
    expect(blockingResult.canProceed).toBe(false)
    expect(blockingResult.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'zero-project-subjects' })]))
    const raw = JSON.stringify(source)
    const validV8 = JSON.stringify(migrateV7ToV8WithReport(source).data)
    expect((await preflightCutoverV8(memory([[APP_DATA_V7_KEY, raw], [APP_DATA_V8_KEY, validV8]]))).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'existing-v8' }),
    ]))
    expect((await preflightCutoverV8(memory([[APP_DATA_V8_KEY, '{bad']]))).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'corrupt-v8' }),
    ]))
    expect((await preflightCutoverV8(memory([[APP_DATA_V8_ACTIVATION_KEY, '{bad']]))).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unknown-activation' }),
    ]))
  })

  it('invalidates external confirmation and preflight when source changes', async () => {
    const source = v7()
    const raw = JSON.stringify(source)
    const store = memory([[APP_DATA_V7_KEY, raw]])
    const digest = await fingerprintV7Raw(raw)
    const identity: SourceIdentityV8 = { type: 'v7', key: APP_DATA_V7_KEY, digest }
    expect(isExternalBackupConfirmedV8({ source: identity, externalExportPrepared: true,
      userConfirmedExternalBackup: false }, identity)).toBe(false)
    expect(isExternalBackupConfirmedV8({ source: identity, externalExportPrepared: true,
      userConfirmedExternalBackup: true }, { ...identity, digest: `sha256:${'0'.repeat(64)}` })).toBe(false)
    expect((await preflightCutoverV8(store, { ...identity, digest: `sha256:${'0'.repeat(64)}` })).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'fingerprint-mismatch' }),
    ]))
    const changed = JSON.stringify({ ...source, projects: source.projects.map((p) => ({ ...p, name: 'changed' })) })
    let firstV7Read = true
    store.getItem.mockImplementation((key: string) => {
      if (key === APP_DATA_V7_KEY && firstV7Read) { firstV7Read = false; return raw }
      return store.values.get(key) ?? null
    })
    store.values.set(APP_DATA_V7_KEY, changed)
    expect((await preflightCutoverV8(store)).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'source-changed' })]))
    expect(await checkV7ActivationGuardV8(store, { source: identity, activationStatus: 'active' })).toBe(false)
  })

  it('rejects invalid candidates and failed reconciliation without writes', async () => {
    const source = v7()
    const raw = JSON.stringify(source)
    const store = memory([[APP_DATA_V7_KEY, raw]])
    const valid = migrateV7ToV8WithReport(source)
    const invalid = await preflightCutoverV8(store, undefined, () => ({ ...valid, data: { ...valid.data, teachingProgress: [{}] } as never }))
    expect(invalid.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'candidate-invalid' })]))
    const unreconciled = await preflightCutoverV8(store, undefined, () => ({ ...valid, reconciliation: {
      isReconciled: false, issues: [{ severity: 'blocking', code: 'reconciliation-count-mismatch', message: 'mismatch', entityIds: [] }],
    } }))
    expect(unreconciled.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'reconciliation-failed' })]))
    expect(store.setItem).not.toHaveBeenCalled()
  })
})

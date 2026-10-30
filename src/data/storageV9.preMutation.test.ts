import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bootstrapEmptyV8 } from './bootstrapV8'
import { fingerprintV7Raw } from './activationV8'
import { activateTimetableSubjectsV9 } from './activateSubjectV9'
import { APP_DATA_V8_KEY, createEmptyAppDataV8 } from './storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_AUTO_BACKUP_LIMIT, V9_AUTO_BACKUP_PREFIX,
  checkV9WriteEvidence, persistAppDataV9 } from './storageV9'
import type { AppDataV9 } from '../types/v9'
import { inspectFormalRuntime } from '../formalRuntime'
import type { FormalV9HostPort } from '../formalRuntime'
import { createFormalLessonManagementV9Controller } from '../formalLessonManagementV9'
import { createBlankProjectV9, createTeacherTimetableV9, createTeacherSubjectV9,
  configureTeacherSubjectV9 } from './teacherSubjectsV9'
import { createClassV9 } from './managementV9'
import { createRecurringLessonV9, type LessonV9Scope } from './lessonMutationsV9'

const timestamp = '2026-10-23T01:00:00.000Z'
function memory() {
  const values = new Map<string, string>()
  const store = {
    values,
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
  return store
}
let lockTail: Promise<unknown>
beforeEach(() => {
  lockTail = Promise.resolve()
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown,
    operation: (lock: object) => Promise<unknown>) => {
    const result = lockTail.then(() => operation({}))
    lockTail = result.then(() => undefined, () => undefined)
    return result
  } } })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function ready() {
  const storage = memory()
  const bootstrap = await bootstrapEmptyV8(storage, { attemptId: 'v8-source', createdAt: timestamp })
  if (!bootstrap.ok) throw new Error(bootstrap.code)
  const rawV8 = storage.getItem(APP_DATA_V8_KEY)!
  const document = { ...createEmptyAppDataV8(), schemaVersion: 9 } as AppDataV9
  const activated = await activateTimetableSubjectsV9(storage, { attemptId: 'upgrade-a', createdAt: timestamp,
    expectedV8Raw: rawV8, candidate: document, decisions: [],
    confirmedExternalV8Digest: await fingerprintV7Raw(rawV8), userConfirmedExternalBackup: true })
  if (!activated.ok) throw new Error(activated.code)
  const expected = () => ({ raw: storage.getItem(APP_DATA_V9_KEY)!,
    metadataRaw: storage.getItem(V9_ACTIVATION_KEY)!,
    revision: JSON.parse(storage.getItem(V9_ACTIVATION_KEY)!).documentRevision as number })
  const autoKeys = () => [...storage.values.keys()].filter((key) => key.startsWith(V9_AUTO_BACKUP_PREFIX))
  return { storage, document, activated, expected, autoKeys }
}

async function lessonReady() {
  const base = await ready()
  let serial = 0
  let document = createBlankProjectV9(base.document, { name: '專案', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `fixture-${++serial}`)
  const projectId = document.activeProjectId!
  const unit = document.teachingUnits.find((item) => item.projectId === projectId)!
  const scope: LessonV9Scope = { projectId, timetableId: 'teacher', teachingUnitId: unit.id }
  document = createTeacherTimetableV9(document, projectId, { name: '教師', teacherName: '甲' }, 'teacher')
  document = createTeacherSubjectV9(document, projectId, 'teacher', { name: '數學', shortName: '數',
    color: '#223344', applicableSchoolLevels: [unit.schoolLevel] }, 'subject')
  document = createClassV9(document, projectId, { teachingUnitId: unit.id, name: '一甲' }, 'class')
  document = configureTeacherSubjectV9(document, projectId, 'teacher', unit.id, 'subject', 'relation')
  const draft = { ...scope, subjectId: 'subject', classId: 'class', day: 1 as const,
    periodId: unit.periods[0].id, weekPattern: 'every' as const }
  document = createRecurringLessonV9(document, scope, draft, 'lesson')
  await persistAppDataV9(base.storage, base.document, document, base.expected())
  let current = document
  const write = async (produce: (value: AppDataV9) => AppDataV9,
    operation?: 'delete-recurring-lesson' | 'permanently-update-lesson') => {
    const next = produce(current)
    const receipt = await persistAppDataV9(base.storage, current, next, base.expected(), operation)
    current = next
    return receipt
  }
  const host = { get document() { return current }, get revision() { return base.expected().revision },
    status: 'active' as const, writable: true, pending: false, receipt: null, errorCode: null,
    update: (produce: (value: AppDataV9) => AppDataV9) => write(produce),
    updateHighRisk: (produce: (value: AppDataV9) => AppDataV9,
      operation: 'delete-recurring-lesson' | 'permanently-update-lesson') => write(produce, operation),
  } satisfies FormalV9HostPort
  return { ...base, scope, draft, host }
}

describe('V9 high-risk pre-mutation backup inside the existing transaction', () => {
  it('integrates real persisted pre-backup and receipt with both formal Lesson operations', async () => {
    const deletion = await lessonReady()
    const beforeDelete = deletion.expected()
    const deleted = await createFormalLessonManagementV9Controller(deletion.host, () => 'unused', deletion.scope)
      .deleteRecurring('lesson', true)
    expect(deleted.document.recurringLessons).toEqual([])
    expect(deleted.receipt.preMutationBackup).toMatchObject({ operation: 'delete-recurring-lesson',
      revision: beforeDelete.revision, rawDocument: beforeDelete.raw })
    expect(JSON.parse(deletion.storage.getItem(deleted.receipt.preMutationBackup!.key)!).rawDocument)
      .toBe(beforeDelete.raw)
    const permanent = await lessonReady()
    const beforePermanent = permanent.expected()
    const unit = permanent.host.document!.teachingUnits.find((item) => item.id === permanent.scope.teachingUnitId)!
    const start = unit.startDate
    const firstMonday = new Date(`${start}T00:00:00`)
    while (firstMonday.getDay() !== 1) firstMonday.setDate(firstMonday.getDate() + 1)
    firstMonday.setDate(firstMonday.getDate() + 7)
    const date = [firstMonday.getFullYear(), String(firstMonday.getMonth() + 1).padStart(2, '0'),
      String(firstMonday.getDate()).padStart(2, '0')].join('-')
    const changed = await createFormalLessonManagementV9Controller(permanent.host, () => 'version-2', permanent.scope)
      .permanentlyUpdateFromDate('lesson', date, { ...permanent.draft, room: '301' })
    expect(changed.document.recurringLessons.map((item) => item.id)).toEqual(['lesson', 'version-2'])
    expect(changed.receipt.preMutationBackup).toMatchObject({ operation: 'permanently-update-lesson',
      revision: beforePermanent.revision, rawDocument: beforePermanent.raw })
    expect(JSON.parse(permanent.storage.getItem(changed.receipt.preMutationBackup!.key)!).rawDocument)
      .toBe(beforePermanent.raw)
  })
  it('backs up the complete persisted raw and revision before write, then returns bound evidence', async () => {
    const { storage, document, expected, autoKeys, activated } = await ready()
    const before = expected()
    const receipt = await persistAppDataV9(storage, document, document, before, 'delete-recurring-lesson')
    expect(receipt.revision).toBe(before.revision + 1)
    expect(receipt.preMutationBackup).toMatchObject({ operation: 'delete-recurring-lesson',
      revision: before.revision, rawDocument: before.raw, digest: await fingerprintV7Raw(before.raw) })
    expect(receipt.attemptId).toBe('upgrade-a')
    expect(receipt.mutationAttemptId).toBe(receipt.preMutationBackup!.mutationAttemptId)
    expect(receipt.mutationAttemptId).not.toBe(receipt.attemptId)
    const key = receipt.preMutationBackup!.key
    expect(autoKeys()).toEqual([key])
    expect(JSON.parse(storage.getItem(key)!)).toMatchObject({ kind: 'v9-pre-mutation-backup',
      mutationAttemptId: receipt.mutationAttemptId, rawDocument: before.raw })
    const writtenKeys = storage.setItem.mock.calls.map(([writtenKey]) => writtenKey)
    expect(writtenKeys.lastIndexOf(key)).toBeLessThan(writtenKeys.lastIndexOf(APP_DATA_V9_KEY))
    expect(storage.getItem(activated.backupKey)).not.toBeNull()
    expect(await checkV9WriteEvidence(storage, receipt.raw, storage.getItem(V9_ACTIVATION_KEY)!)).toBe(true)
    expect(await inspectFormalRuntime(storage)).toEqual({ runtime: 'v9', v9Status: 'active' })
  })
  it('rejects backup write, quota, readback and corrupt-existing-record failures before mutation', async () => {
    for (const mode of ['write', 'readback', 'corrupt-existing'] as const) {
      const { storage, document, expected, autoKeys } = await ready()
      const before = expected()
      if (mode === 'write') {
        storage.setItem.mockImplementation((key, value) => {
          if (key.startsWith(V9_AUTO_BACKUP_PREFIX)) throw new Error('quota')
          storage.values.set(key, value)
        })
      } else if (mode === 'readback') {
        storage.getItem.mockImplementation((key) => key.startsWith(V9_AUTO_BACKUP_PREFIX)
          ? null : storage.values.get(key) ?? null)
      } else {
        storage.values.set(`${V9_AUTO_BACKUP_PREFIX}corrupt`, '{}')
      }
      await expect(persistAppDataV9(storage, document, document, before, 'delete-recurring-lesson'))
        .rejects.toMatchObject({ code: mode === 'write' ? 'backup-failure' : 'backup-readback-failure' })
      expect(storage.getItem(APP_DATA_V9_KEY)).toBe(before.raw)
      expect(storage.getItem(V9_ACTIVATION_KEY)).toBe(before.metadataRaw)
      if (mode !== 'corrupt-existing') expect(autoKeys()).toEqual([])
    }
  })
  it('serializes two writers and never creates a backup for the stale second attempt', async () => {
    const { storage, document, expected, autoKeys } = await ready()
    const before = expected()
    const first = persistAppDataV9(storage, document, document, before, 'delete-recurring-lesson')
    const second = persistAppDataV9(storage, document, document, before, 'permanently-update-lesson')
    const receipt = await first
    await expect(second).rejects.toMatchObject({ code: 'activation-conflict' })
    expect(receipt.preMutationBackup?.operation).toBe('delete-recurring-lesson')
    expect(autoKeys()).toHaveLength(1)
  })
  it('fails before backup for stale revision or mismatched persisted digest', async () => {
    const { storage, document, expected, autoKeys } = await ready()
    const before = expected()
    await expect(persistAppDataV9(storage, document, document,
      { ...before, revision: before.revision + 1 }, 'delete-recurring-lesson'))
      .rejects.toMatchObject({ code: 'stale-snapshot' })
    expect(autoKeys()).toEqual([])
    const metadata = JSON.parse(before.metadataRaw)
    metadata.currentDigest = `sha256:${'0'.repeat(64)}`
    storage.setItem(V9_ACTIVATION_KEY, JSON.stringify(metadata))
    await expect(persistAppDataV9(storage, document, document,
      { ...before, metadataRaw: JSON.stringify(metadata) }, 'delete-recurring-lesson'))
      .rejects.toMatchObject({ code: 'activation-conflict' })
    expect(autoKeys()).toEqual([])
    expect(storage.getItem(APP_DATA_V9_KEY)).toBe(before.raw)
  })
  it('keeps the verified backup and original document if the subsequent V9 write fails', async () => {
    const { storage, document, expected, autoKeys } = await ready()
    const before = expected()
    storage.setItem.mockImplementation((key, value) => {
      if (key === APP_DATA_V9_KEY) throw new Error('document quota')
      storage.values.set(key, value)
    })
    await expect(persistAppDataV9(storage, document, document, before, 'delete-recurring-lesson'))
      .rejects.toMatchObject({ code: 'write-failure' })
    expect(autoKeys()).toHaveLength(1)
    expect(storage.getItem(APP_DATA_V9_KEY)).toBe(before.raw)
    expect(storage.getItem(V9_ACTIVATION_KEY)).toBe(before.metadataRaw)
  })
  it('rechecks backup evidence immediately before changing the V9 document', async () => {
    const { storage, document, expected } = await ready()
    const before = expected()
    let backupReads = 0
    storage.getItem.mockImplementation((key) => {
      if (key.startsWith(V9_AUTO_BACKUP_PREFIX) && ++backupReads === 3) return '{}'
      return storage.values.get(key) ?? null
    })
    await expect(persistAppDataV9(storage, document, document, before, 'delete-recurring-lesson'))
      .rejects.toMatchObject({ code: 'backup-readback-failure' })
    expect(storage.getItem(APP_DATA_V9_KEY)).toBe(before.raw)
    expect(storage.getItem(V9_ACTIVATION_KEY)).toBe(before.metadataRaw)
  })
  it('uses a fresh backup attempt for each operation; callers cannot supply or replay evidence', async () => {
    const { storage, document, expected, autoKeys } = await ready()
    const first = await persistAppDataV9(storage, document, document, expected(), 'delete-recurring-lesson')
    const second = await persistAppDataV9(storage, document, document, expected(), 'permanently-update-lesson')
    expect(second.mutationAttemptId).not.toBe(first.mutationAttemptId)
    expect(second.preMutationBackup?.mutationAttemptId).toBe(second.mutationAttemptId)
    expect(second.preMutationBackup?.key).not.toBe(first.preMutationBackup?.key)
    expect(second.preMutationBackup).toMatchObject({ operation: 'permanently-update-lesson', revision: 1 })
    expect(autoKeys()).toHaveLength(2)
  })
  it('does not create a high-risk backup for an ordinary Host mutation', async () => {
    const { storage, document, expected, autoKeys } = await ready()
    const receipt = await persistAppDataV9(storage, document, document, expected())
    expect(receipt.preMutationBackup).toBeUndefined()
    expect(receipt.mutationAttemptId).toBeUndefined()
    expect(autoKeys()).toEqual([])
  })
  it('keeps fewer than ten automatic backups without rotation', async () => {
    const { storage, document, expected, autoKeys } = await ready()
    for (let index = 0; index < 3; index++) {
      await persistAppDataV9(storage, document, document, expected(), 'delete-recurring-lesson')
    }
    expect(autoKeys()).toHaveLength(3)
  })
  it('rotates only automatic backups after the new record is readable; protects activation and manual JSON', async () => {
    const { storage, document, expected, autoKeys, activated } = await ready()
    storage.setItem('manual-export-json', '{"manual":true}')
    const firstKey = (await persistAppDataV9(storage, document, document, expected(),
      'delete-recurring-lesson')).preMutationBackup!.key
    expect(autoKeys()).toHaveLength(1)
    for (let index = 1; index < V9_AUTO_BACKUP_LIMIT; index++) {
      await persistAppDataV9(storage, document, document, expected(), 'permanently-update-lesson')
    }
    expect(autoKeys()).toHaveLength(V9_AUTO_BACKUP_LIMIT)
    expect(storage.getItem(firstKey)).not.toBeNull()
    await persistAppDataV9(storage, document, document, expected(), 'delete-recurring-lesson')
    expect(autoKeys()).toHaveLength(V9_AUTO_BACKUP_LIMIT)
    expect(storage.getItem(firstKey)).toBeNull()
    expect(storage.getItem(activated.backupKey)).not.toBeNull()
    expect(storage.getItem('manual-export-json')).toBe('{"manual":true}')
  })
  it('does not rotate existing backups when the new write fails', async () => {
    const { storage, document, expected, autoKeys } = await ready()
    for (let index = 0; index < V9_AUTO_BACKUP_LIMIT; index++) {
      await persistAppDataV9(storage, document, document, expected(), 'delete-recurring-lesson')
    }
    const existing = autoKeys()
    storage.setItem.mockImplementation((key, value) => {
      if (key.startsWith(V9_AUTO_BACKUP_PREFIX)) throw new Error('quota')
      storage.values.set(key, value)
    })
    const before = expected()
    await expect(persistAppDataV9(storage, document, document, before, 'delete-recurring-lesson'))
      .rejects.toMatchObject({ code: 'backup-failure' })
    expect(autoKeys()).toEqual(existing)
    expect(storage.getItem(APP_DATA_V9_KEY)).toBe(before.raw)
  })
  it('cleans up the uncommitted new backup when rotation fails, leaving ten older copies', async () => {
    const { storage, document, expected, autoKeys, activated } = await ready()
    for (let index = 0; index < V9_AUTO_BACKUP_LIMIT; index++) {
      await persistAppDataV9(storage, document, document, expected(), 'delete-recurring-lesson')
    }
    const existing = autoKeys()
    const before = expected()
    storage.removeItem.mockImplementation((key) => {
      if (existing.includes(key)) throw new Error('rotation denied')
      storage.values.delete(key)
    })
    await expect(persistAppDataV9(storage, document, document, before, 'delete-recurring-lesson'))
      .rejects.toMatchObject({ code: 'backup-rotation-failure' })
    expect(autoKeys()).toEqual(existing)
    expect(storage.getItem(activated.backupKey)).not.toBeNull()
    expect(storage.getItem(APP_DATA_V9_KEY)).toBe(before.raw)
    expect(storage.getItem(V9_ACTIVATION_KEY)).toBe(before.metadataRaw)
  })
  it('reduces a valid over-limit automatic pool to ten without touching protected records', async () => {
    const { storage, document, expected, autoKeys, activated } = await ready()
    for (let index = 0; index < V9_AUTO_BACKUP_LIMIT; index++) {
      await persistAppDataV9(storage, document, document, expected(), 'delete-recurring-lesson')
    }
    const sample = JSON.parse(storage.getItem(autoKeys()[0])!)
    const extraMutationAttemptId = crypto.randomUUID()
    storage.setItem(`${V9_AUTO_BACKUP_PREFIX}${extraMutationAttemptId}`, JSON.stringify({
      ...sample, mutationAttemptId: extraMutationAttemptId,
      createdAt: '2026-10-22T01:00:00.000Z',
    }))
    expect(autoKeys()).toHaveLength(V9_AUTO_BACKUP_LIMIT + 1)
    const protectedBefore = storage.getItem(activated.backupKey)
    await persistAppDataV9(storage, document, document, expected(), 'permanently-update-lesson')
    expect(autoKeys()).toHaveLength(V9_AUTO_BACKUP_LIMIT)
    expect(storage.getItem(activated.backupKey)).toBe(protectedBefore)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inspectFormalRuntime } from '../formalRuntime'
import { APP_DATA_V8_ACTIVATION_KEY, fingerprintV7Raw, V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY } from './activationV8'
import { initializeFreshV9, preflightFreshV9 } from './initializeFreshV9'
import { createRecurringLessonV9, deleteRecurringLessonV9, updateRecurringLessonV9 } from './lessonMutationsV9'
import { createClassV9, createEmptyProjectV9 } from './managementV9'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY } from './storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_AUTO_BACKUP_PREFIX, V9_BACKUP_PREFIX,
  checkV9WriteEvidence, createEmptyAppDataV9, loadAppDataV9, persistAppDataV9 } from './storageV9'
import { isCompatibleAppDataV9 } from './validators/v9'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9,
  createTeacherTimetableV9 } from './teacherSubjectsV9'

const time = '2026-11-01T00:00:00.000Z'
function memory(entries: [string, string][] = []) {
  const values = new Map(entries)
  return { values, get length() { return values.size }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }) }
}
beforeEach(() => vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
  operation: (lock: unknown) => Promise<unknown>) => operation({}) } }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('explicit fresh V9 initialization', () => {
  it('creates only valid V9 evidence, passes the formal gate, and uses existing revision persistence', async () => {
    const storage = memory()
    expect(preflightFreshV9(storage)).toEqual({ eligible: true, issue: 'none' })
    expect(isCompatibleAppDataV9(createEmptyAppDataV9())).toBe(true)
    const result = await initializeFreshV9(storage, { attemptId: 'fresh-a', createdAt: time })
    if (!result.ok) throw new Error(result.code)
    expect(result.metadata).toMatchObject({ kind: 'fresh-v9-initialization', status: 'active',
      documentRevision: 0, backupKey: `${V9_BACKUP_PREFIX}fresh-a` })
    expect(loadAppDataV9(storage).status).toBe('active')
    expect(await inspectFormalRuntime(storage)).toEqual({ runtime: 'v9', v9Status: 'active' })
    expect(await checkV9WriteEvidence(storage, result.rawDocument, storage.getItem(V9_ACTIVATION_KEY)!)).toBe(true)
    expect(storage.getItem(APP_DATA_V7_KEY)).toBeNull()
    expect(storage.getItem(APP_DATA_V8_KEY)).toBeNull()
    const current = createEmptyAppDataV9()
    const next = createEmptyProjectV9(current, { name: '新專案' }, 'project-a')
    const originalMetadataRaw = storage.getItem(V9_ACTIVATION_KEY)!
    const receipt = await persistAppDataV9(storage, current, next,
      { raw: result.rawDocument, metadataRaw: originalMetadataRaw, revision: 0 })
    expect(receipt).toMatchObject({ revision: 1, attemptId: 'fresh-a' })
    await expect(persistAppDataV9(storage, current, next,
      { raw: result.rawDocument, metadataRaw: originalMetadataRaw, revision: 0 }))
      .rejects.toMatchObject({ code: 'activation-conflict' })
    expect(await inspectFormalRuntime(storage)).toEqual({ runtime: 'v9', v9Status: 'active' })
    expect(storage.getItem(result.backupKey)).not.toBeNull()
  })

  it('persists Project, Timetable, Subject, Class and fixed Lesson CRUD on fresh evidence', async () => {
    const storage = memory()
    const initialized = await initializeFreshV9(storage, { attemptId: 'fresh-workflow', createdAt: time })
    if (!initialized.ok) throw new Error(initialized.code)
    let current = createEmptyAppDataV9()
    const save = async (next: typeof current, operation?: 'delete-recurring-lesson') => {
      const loaded = loadAppDataV9(storage)
      if (!loaded.rawDocument || !loaded.rawMetadata || !loaded.metadata) throw new Error('missing evidence')
      await persistAppDataV9(storage, current, next,
        { raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata,
          revision: loaded.metadata.documentRevision }, operation)
      current = next
    }
    let serial = 0
    await save(createBlankProjectV9(current, { name: '新學期', academicYear: 115,
      semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `new-${++serial}`))
    const projectId = current.activeProjectId!
    const unit = current.teachingUnits.find((item) => item.projectId === projectId)!
    await save(createTeacherTimetableV9(current, projectId,
      { name: '教師課表', teacherName: '甲' }, 'teacher'))
    await save(createTeacherSubjectV9(current, projectId, 'teacher', { name: '數學', shortName: '數',
      color: '#223344', applicableSchoolLevels: [unit.schoolLevel] }, 'subject'))
    await save(configureTeacherSubjectV9(current, projectId, 'teacher', unit.id, 'subject', 'relation'))
    await save(createClassV9(current, projectId, { teachingUnitId: unit.id, name: '一甲' }, 'class'))
    const scope = { projectId, timetableId: 'teacher', teachingUnitId: unit.id }
    const draft = { ...scope, subjectId: 'subject', classId: 'class', day: 1 as const,
      periodId: unit.periods[0].id, weekPattern: 'every' as const }
    await save(createRecurringLessonV9(current, scope, draft, 'lesson'))
    await save(updateRecurringLessonV9(current, scope, 'lesson', { ...draft, room: '301' }))
    await save(deleteRecurringLessonV9(current, scope, 'lesson', true), 'delete-recurring-lesson')
    expect(current.recurringLessons).toEqual([])
    expect(loadAppDataV9(storage).metadata?.documentRevision).toBe(8)
    expect(await inspectFormalRuntime(storage)).toEqual({ runtime: 'v9', v9Status: 'active' })
  })

  it.each([APP_DATA_V7_KEY, APP_DATA_V8_KEY, APP_DATA_V8_ACTIVATION_KEY,
    V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY, APP_DATA_V9_KEY, V9_ACTIVATION_KEY,
    `${V9_BACKUP_PREFIX}orphan`, `${V9_AUTO_BACKUP_PREFIX}orphan`,
    'aster-timetable-data-v10-unknown'])('rejects existing evidence at %s without writing', async (key) => {
    const storage = memory([[key, '{existing}']])
    const result = await initializeFreshV9(storage, { attemptId: 'fresh-a', createdAt: time })
    expect(result).toMatchObject({ ok: false, code: 'existing-evidence' })
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.getItem(key)).toBe('{existing}')
  })

  it('rejects a second initialization without changing the first receipt', async () => {
    const storage = memory()
    const first = await initializeFreshV9(storage, { attemptId: 'fresh-a', createdAt: time })
    if (!first.ok) throw new Error(first.code)
    const before = new Map(storage.values)
    expect(await initializeFreshV9(storage, { attemptId: 'fresh-b', createdAt: time }))
      .toMatchObject({ ok: false, code: 'existing-evidence' })
    expect(storage.values).toEqual(before)
  })

  it.each([V9_BACKUP_PREFIX, V9_ACTIVATION_KEY, APP_DATA_V9_KEY, 'active'])(
    'fails closed when the %s write is interrupted', async (target) => {
      const storage = memory()
      const normal = storage.setItem.getMockImplementation()!
      storage.setItem.mockImplementation((key, value) => {
        if (key.startsWith(target) || target === 'active' && key === V9_ACTIVATION_KEY
          && JSON.parse(value).status === 'active') throw new Error('interrupted')
        normal(key, value)
      })
      const result = await initializeFreshV9(storage, { attemptId: 'fresh-a', createdAt: time })
      expect(result.ok).toBe(false)
      expect(loadAppDataV9(storage).status).not.toBe('active')
      expect((await inspectFormalRuntime(storage)).runtime).not.toBe('v9')
      expect(storage.getItem(APP_DATA_V7_KEY)).toBeNull()
      expect(storage.getItem(APP_DATA_V8_KEY)).toBeNull()
    })

  it('blocks tampered backup, current digest, and a stale source writer', async () => {
    const storage = memory()
    const result = await initializeFreshV9(storage, { attemptId: 'fresh-a', createdAt: time })
    if (!result.ok) throw new Error(result.code)
    const metadataRaw = storage.getItem(V9_ACTIVATION_KEY)!
    const backupRaw = storage.getItem(result.backupKey)!
    storage.setItem(result.backupKey, '{corrupt}')
    expect((await inspectFormalRuntime(storage)).runtime).toBe('blocked-v9')
    storage.setItem(result.backupKey, backupRaw)
    const nonemptyRaw = JSON.stringify(createEmptyProjectV9(createEmptyAppDataV9(),
      { name: '偽造來源' }, 'forged'))
    const nonemptyDigest = await fingerprintV7Raw(nonemptyRaw)
    storage.setItem(result.backupKey, JSON.stringify({ ...JSON.parse(backupRaw),
      candidateRaw: nonemptyRaw, candidateDigest: nonemptyDigest }))
    storage.setItem(V9_ACTIVATION_KEY, JSON.stringify({ ...result.metadata,
      initialDigest: nonemptyDigest }))
    expect((await inspectFormalRuntime(storage)).runtime).toBe('blocked-v9')
    storage.setItem(result.backupKey, backupRaw)
    storage.setItem(V9_ACTIVATION_KEY, JSON.stringify({ ...result.metadata,
      currentDigest: `sha256:${'0'.repeat(64)}` }))
    expect((await inspectFormalRuntime(storage)).runtime).toBe('blocked-v9')
    storage.setItem(V9_ACTIVATION_KEY, metadataRaw)
    storage.setItem(APP_DATA_V7_KEY, '{late-old-writer}')
    expect((await inspectFormalRuntime(storage)).runtime).toBe('blocked-v9')
    await expect(persistAppDataV9(storage, createEmptyAppDataV9(), createEmptyAppDataV9(),
      { raw: result.rawDocument, metadataRaw, revision: 0 }))
      .rejects.toMatchObject({ code: 'activation-conflict' })
    expect(storage.getItem(APP_DATA_V9_KEY)).toBe(result.rawDocument)
  })

  it('does not activate when the immutable backup readback differs from the write', async () => {
    const storage = memory()
    const write = storage.setItem.getMockImplementation()!
    storage.setItem.mockImplementation((key, value) => {
      write(key, key.startsWith(V9_BACKUP_PREFIX) ? '{truncated}' : value)
    })
    expect(await initializeFreshV9(storage, { attemptId: 'fresh-a', createdAt: time }))
      .toMatchObject({ ok: false, code: 'backup-failed' })
    expect(storage.getItem(V9_ACTIVATION_KEY)).toBeNull()
    expect(storage.getItem(APP_DATA_V9_KEY)).toBeNull()
    expect((await inspectFormalRuntime(storage)).runtime).toBe('blocked-v9')
  })

  it('blocks absent Web Locks and evidence inserted while the lock is pending', async () => {
    const storage = memory()
    vi.stubGlobal('navigator', {})
    expect(await initializeFreshV9(storage, { attemptId: 'fresh-a', createdAt: time }))
      .toMatchObject({ ok: false, code: 'lock-unavailable' })
    expect(storage.values.size).toBe(0)
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
      operation: (lock: unknown) => Promise<unknown>) => {
      storage.setItem(APP_DATA_V7_KEY, '{inserted-before-lock}')
      return operation({})
    } } })
    expect(await initializeFreshV9(storage, { attemptId: 'fresh-a', createdAt: time }))
      .toMatchObject({ ok: false, code: 'existing-evidence' })
    expect(storage.getItem(APP_DATA_V7_KEY)).toBe('{inserted-before-lock}')
    expect(storage.getItem(V9_ACTIVATION_KEY)).toBeNull()
  })
})

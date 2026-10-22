import { describe, expect, it, vi } from 'vitest'
import type { AppDataV8 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import { APP_DATA_V7_KEY, loadAppDataV7 } from './storageV7'
import {
  APP_DATA_V8_KEY,
  AppDataV8StorageError,
  loadAppDataV8,
  persistAppDataV8,
  persistLoadedAppDataV8,
} from './storageV8'

const v7 = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
const v8 = () => migrateV7ToV8(v7())

function memoryStorage(values = new Map<string, string>()) {
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  }
}

const code = (action: () => unknown) => {
  try { action(); return null } catch (cause) { return cause instanceof AppDataV8StorageError ? cause.code : 'unknown' }
}

const rename = (data: AppDataV8, name: string): AppDataV8 => ({
  ...data,
  projects: data.projects.map((project, index) => index === 0 ? { ...project, name } : project),
})

describe('AppDataV8 storage', () => {
  it('loads v7 once, persists v8 with confirmation, and preserves the complete v7 key', () => {
    const source = v7()
    const rawV7 = JSON.stringify(source)
    const store = memoryStorage(new Map([[APP_DATA_V7_KEY, rawV7]]))

    const loaded = loadAppDataV8(store, v8())

    expect(loaded).toMatchObject({ status: 'saved', source: 'v7', issue: 'none', raw: null, shouldPersist: true, legacyGuardRaw: rawV7 })
    expect(loaded.value).toEqual(migrateV7ToV8(source))
    expect(loaded.value.subjects.every((subject) => subject.projectId === source.projects[0].id)).toBe(true)
    expect(store.setItem).not.toHaveBeenCalled()
    const confirmation = persistLoadedAppDataV8(store, loaded)
    expect(confirmation).toEqual({ raw: JSON.stringify(loaded.value), revision: 1 })
    expect(store.values.get(APP_DATA_V7_KEY)).toBe(rawV7)
    expect(JSON.parse(store.values.get(APP_DATA_V8_KEY)!)).toEqual(loaded.value)
  })

  it('always prefers a valid v8 document over different v7 data', () => {
    const current = v8()
    const legacy = rename(migrateV7ToV8(v7()), 'Legacy value')
    const rawV8 = JSON.stringify(current)
    const rawV7 = JSON.stringify({ ...legacy, schemaVersion: 7, teachingProgress: undefined })
    const store = memoryStorage(new Map([[APP_DATA_V8_KEY, rawV8], [APP_DATA_V7_KEY, rawV7]]))

    const loaded = loadAppDataV8(store, v8())

    expect(loaded).toMatchObject({ status: 'saved', source: 'v8', issue: 'none', raw: rawV8, shouldPersist: false })
    expect(loaded.value).toEqual(current)
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('upgrades legacy V8 Events in memory and persists them without dropping the original Event', () => {
    const source = v7()
    const unit = source.teachingUnits[0]
    source.events = [{
      id: 'legacy-v8-event', projectId: source.projects[0].id, teachingUnitId: unit.id,
      title: '既有 V8 事件', type: 'meeting', date: unit.startDate,
      startTime: '09:00', endTime: '10:00', notes: '內容必須保留', color: '#123456',
    }]
    const current = migrateV7ToV8(source)
    const legacyEvents = current.events.map((event) => {
      const legacy: Record<string, unknown> = { ...event }
      delete legacy.ownershipStatus
      delete legacy.timetableId
      delete legacy.ownershipIssue
      return legacy
    })
    const legacyDocument = { ...current, events: legacyEvents }
    const raw = JSON.stringify(legacyDocument)
    const store = memoryStorage(new Map([[APP_DATA_V8_KEY, raw]]))

    const loaded = loadAppDataV8(store, v8())

    expect(loaded).toMatchObject({ status: 'saved', source: 'v8', issue: 'none', raw, shouldPersist: true })
    expect(loaded.value.events).toEqual(current.events)
    expect(loaded.value.events[0]).toMatchObject({
      id: 'legacy-v8-event', title: '既有 V8 事件', notes: '內容必須保留',
      ownershipStatus: 'resolved', timetableId: source.timetables[0].id,
    })
    expect(store.values.get(APP_DATA_V8_KEY)).toBe(raw)

    const confirmation = persistLoadedAppDataV8(store, loaded)
    expect(confirmation?.raw).toBe(JSON.stringify(current))
    expect(JSON.parse(store.values.get(APP_DATA_V8_KEY)!)).toEqual(current)
  })

  it('upgrades a recognized pre-relation V8 document in memory and preserves the original raw until confirmed', () => {
    const current = v8()
    const { teachingUnitSubjects: _relations, ...legacyDocument } = current
    void _relations
    const raw = JSON.stringify(legacyDocument)
    const store = memoryStorage(new Map([[APP_DATA_V8_KEY, raw]]))

    const loaded = loadAppDataV8(store, v8())

    expect(loaded).toMatchObject({ status: 'saved', source: 'v8', issue: 'none', raw, shouldPersist: true })
    expect(loaded.value).toEqual(current)
    expect(store.values.get(APP_DATA_V8_KEY)).toBe(raw)
    const confirmation = persistLoadedAppDataV8(store, loaded)
    expect(JSON.parse(confirmation!.raw)).toEqual(current)
    expect(JSON.parse(store.values.get(APP_DATA_V8_KEY)!)).toEqual(current)
  })

  it('does not reinterpret a present but incomplete relation collection as legacy missing data', () => {
    const current = v8()
    const invalidRaw = JSON.stringify({ ...current, teachingUnitSubjects: [] })
    const store = memoryStorage(new Map([[APP_DATA_V8_KEY, invalidRaw]]))

    const loaded = loadAppDataV8(store, v8())

    expect(loaded).toMatchObject({
      status: 'read-error', source: 'v8', issue: 'corrupt', raw: invalidRaw,
      rawBackup: invalidRaw, shouldPersist: false,
    })
    expect(store.values.get(APP_DATA_V8_KEY)).toBe(invalidRaw)
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('reports corrupt v8 and never falls back to a valid v7 document', () => {
    const rawV7 = JSON.stringify(v7())
    const store = memoryStorage(new Map([[APP_DATA_V8_KEY, '{broken-v8'], [APP_DATA_V7_KEY, rawV7]]))

    const loaded = loadAppDataV8(store, v8())

    expect(loaded).toMatchObject({ status: 'read-error', source: 'v8', issue: 'corrupt', rawBackup: '{broken-v8', shouldPersist: false })
    expect(store.values.get(APP_DATA_V8_KEY)).toBe('{broken-v8')
    expect(store.values.get(APP_DATA_V7_KEY)).toBe(rawV7)
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('rejects a parseable but incompatible v8 document without falling back to v7', () => {
    const invalidV8 = JSON.stringify({ ...v8(), schemaVersion: 8, teachingProgress: [{}] })
    const rawV7 = JSON.stringify(v7())
    const store = memoryStorage(new Map([[APP_DATA_V8_KEY, invalidV8], [APP_DATA_V7_KEY, rawV7]]))

    const loaded = loadAppDataV8(store, v8())

    expect(loaded).toMatchObject({
      status: 'read-error', source: 'v8', issue: 'corrupt', raw: invalidV8,
      rawBackup: invalidV8, shouldPersist: false,
    })
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('distinguishes storage read failures and does not attempt recovery writes', () => {
    const store = {
      getItem: vi.fn(() => { throw new Error('storage unavailable') }),
      setItem: vi.fn(),
    }

    const loaded = loadAppDataV8(store, v8())

    expect(loaded).toMatchObject({ status: 'read-error', source: 'v8', issue: 'read-failure', shouldPersist: false })
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('distinguishes a completely missing document from corrupt data', () => {
    const store = memoryStorage()
    const initial = v8()

    const loaded = loadAppDataV8(store, initial)

    expect(loaded).toMatchObject({ status: 'saved', source: 'initial', issue: 'missing', raw: null, rawBackup: null, shouldPersist: true })
    expect(loaded.value).toEqual(initial)
  })

  it('detects v8 creation and v7 changes racing a migration without writing either key', () => {
    const source = v7()
    const rawV7 = JSON.stringify(source)
    const externalV8 = JSON.stringify(rename(migrateV7ToV8(source), 'External v8'))
    let v8Reads = 0
    const v8Race = {
      getItem: vi.fn((key: string) => key === APP_DATA_V8_KEY ? (++v8Reads === 1 ? null : externalV8) : key === APP_DATA_V7_KEY ? rawV7 : null),
      setItem: vi.fn(),
    }
    expect(loadAppDataV8(v8Race, v8())).toMatchObject({
      status: 'conflict', source: 'v8', issue: 'version-conflict', rawBackup: externalV8, shouldPersist: false,
    })
    expect(v8Race.setItem).not.toHaveBeenCalled()

    const changedV7 = JSON.stringify({ ...source, projects: source.projects.map((project) => ({ ...project, name: 'External v7' })) })
    let v7Reads = 0
    const v7Race = {
      getItem: vi.fn((key: string) => {
        if (key === APP_DATA_V8_KEY) return null
        if (key === APP_DATA_V7_KEY) return ++v7Reads < 3 ? rawV7 : changedV7
        return null
      }),
      setItem: vi.fn(),
    }
    expect(loadAppDataV8(v7Race, v8())).toMatchObject({
      status: 'conflict', source: 'v7', issue: 'version-conflict', rawBackup: changedV7, shouldPersist: false,
    })
    expect(v7Race.setItem).not.toHaveBeenCalled()
  })

  it('rejects stale persistence revisions and stale expected documents', () => {
    const current = v8()
    const raw = JSON.stringify(current)
    const store = memoryStorage(new Map([[APP_DATA_V8_KEY, raw]]))
    const next = rename(current, 'Local update')

    expect(code(() => persistAppDataV8(store, current, next, { raw, legacyGuardRaw: null, revision: 2 }, 3))).toBe('stale-revision')
    expect(store.setItem).not.toHaveBeenCalled()
    const external = JSON.stringify(rename(current, 'External update'))
    store.values.set(APP_DATA_V8_KEY, external)
    expect(code(() => persistAppDataV8(store, current, next, { raw, legacyGuardRaw: null, revision: 2 }, 2))).toBe('stale-document')
    expect(store.values.get(APP_DATA_V8_KEY)).toBe(external)
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('rejects a changed v7 guard before a v8 write', () => {
    const current = v8()
    const raw = JSON.stringify(current)
    const originalV7 = JSON.stringify(v7())
    const changedV7 = JSON.stringify({ ...v7(), projects: v7().projects.map((project) => ({ ...project, name: 'Older tab' })) })
    const store = memoryStorage(new Map([[APP_DATA_V8_KEY, raw], [APP_DATA_V7_KEY, changedV7]]))

    expect(code(() => persistAppDataV8(store, current, rename(current, 'Local'), {
      raw, legacyGuardRaw: originalV7, revision: 0,
    }, 0))).toBe('legacy-conflict')
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('preserves the old document and reports write failures without advancing revision', () => {
    const current = v8()
    const raw = JSON.stringify(current)
    const values = new Map([[APP_DATA_V8_KEY, raw]])
    const store = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn(() => { throw new Error('quota exceeded') }),
    }

    expect(code(() => persistAppDataV8(store, current, rename(current, 'Local'), {
      raw, legacyGuardRaw: null, revision: 4,
    }, 4))).toBe('write-failure')
    expect(values.get(APP_DATA_V8_KEY)).toBe(raw)
  })

  it('does not report success when storage silently fails to retain a migration write', () => {
    const source = v7()
    const rawV7 = JSON.stringify(source)
    const values = new Map([[APP_DATA_V7_KEY, rawV7]])
    const store = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn(),
    }
    const loaded = loadAppDataV8(store, v8())

    expect(code(() => persistLoadedAppDataV8(store, loaded))).toBe('write-unconfirmed')
    expect(values.get(APP_DATA_V8_KEY)).toBeUndefined()
    expect(values.get(APP_DATA_V7_KEY)).toBe(rawV7)
    expect(store.setItem).toHaveBeenCalledOnce()
  })

  it('rejects invalid documents and safe-update violations before storage writes', () => {
    const current = v8()
    const raw = JSON.stringify(current)
    const store = memoryStorage(new Map([[APP_DATA_V8_KEY, raw]]))
    const expectation = { raw, legacyGuardRaw: null, revision: 0 }

    expect(code(() => persistAppDataV8(store, current, { ...current, teachingProgress: [{}] } as never, expectation, 0))).toBe('invalid-next')
    const unsafe = { ...current, projects: current.projects.map((project) => ({ ...project, archivedAt: '2026-10-20T02:00:00.000Z' })) }
    expect(code(() => persistAppDataV8(store, current, unsafe, expectation, 0))).toBe('invalid-next')
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('refuses an unsafe progress timestamp-only update and confirms valid writes once', () => {
    const source = v8()
    const lesson = source.recurringLessons[0]
    const progress = {
      id: '123e4567-e89b-42d3-a456-426614174000', projectId: lesson.projectId, timetableId: lesson.timetableId,
      teachingUnitId: lesson.teachingUnitId, classId: lesson.classId, subjectId: lesson.subjectId,
      content: { chapter: '第一章', unit: '', note: '' }, previousProgress: null,
      createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z',
    }
    const current: AppDataV8 = { ...source, teachingProgress: [progress] }
    const raw = JSON.stringify(current)
    const store = memoryStorage(new Map([[APP_DATA_V8_KEY, raw]]))
    const unsafe: AppDataV8 = { ...current, teachingProgress: [{ ...progress, updatedAt: '2026-10-20T02:00:00.000Z' }] }
    expect(code(() => persistAppDataV8(store, current, unsafe, { raw, legacyGuardRaw: null, revision: 0 }, 0))).toBe('unsafe-update')
    expect(store.setItem).not.toHaveBeenCalled()

    const next = rename(current, 'Confirmed update')
    const confirmation = persistAppDataV8(store, current, next, { raw, legacyGuardRaw: null, revision: 0 }, 0)
    expect(confirmation).toEqual({ raw: JSON.stringify(next), revision: 1 })
    expect(store.setItem).toHaveBeenCalledOnce()
    expect(store.getItem).toHaveBeenLastCalledWith(APP_DATA_V8_KEY)
  })

  it('leaves the existing v7 loader behavior unchanged', () => {
    const source = v7()
    const rawV7 = JSON.stringify(source)
    const store = memoryStorage(new Map([[APP_DATA_V7_KEY, rawV7], [APP_DATA_V8_KEY, '{ignored-by-v7']]))

    const loaded = loadAppDataV7(store, source)

    expect(loaded).toMatchObject({ status: 'saved', source: 'v7', shouldPersist: false })
    expect(loaded.value).toEqual(source)
    expect(store.values.get(APP_DATA_V8_KEY)).toBe('{ignored-by-v7')
    expect(store.setItem).not.toHaveBeenCalled()
  })
})

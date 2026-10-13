import { describe, expect, it, vi } from 'vitest'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { APP_DATA_V1_KEY, APP_DATA_V3_KEY, APP_DATA_V4_KEY } from './storageV4'
import { APP_DATA_V5_KEY, loadAppDataV5, persistAppDataV5 } from './storageV5'
import { isAppDataV5, isCompatibleAppDataV5 } from './validators/v5'
import { createInitialAppDataV4 } from '../hooks/useAppDataV4'
import { SCHOOL_LEVELS } from '../types'
import type { LegacyAppDataV1 } from './migrations'
import { resolveProjectDay } from '../lib/scheduleV4'

const source = () => migrateV3ToV4(structuredClone(initialData))
const storage = (values: Map<string, string>) => ({
  getItem: vi.fn((key: string) => values.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => values.set(key, value)),
})

describe('AppData v5 storage and migration', () => {
  it('preserves legacy subjects, references, archives, and all old keys', () => {
    const v4 = source()
    v4.projects[0].archivedAt = '2026-10-01T00:00:00.000Z'
    v4.activeProjectId = null
    const oldRaw = JSON.stringify(v4)
    const values = new Map([[APP_DATA_V4_KEY, oldRaw], [APP_DATA_V3_KEY, JSON.stringify(initialData)], [APP_DATA_V1_KEY, '{"legacy":true}']])
    const store = storage(values)
    const result = loadAppDataV5(store, createInitialAppDataV4())
    expect(result).toMatchObject({ status: 'saved', source: 'v4', shouldPersist: true })
    expect(result.value.schemaVersion).toBe(5)
    expect(result.value.subjects.map(({ id, name, color }) => ({ id, name, color }))).toEqual(v4.subjects.map(({ id, name, color }) => ({ id, name, color })))
    expect(result.value.subjects.every((subject) => JSON.stringify(subject.applicableSchoolLevels) === JSON.stringify(SCHOOL_LEVELS))).toBe(true)
    expect(result.value.recurringLessons).toEqual(v4.recurringLessons)
    expect(result.value.projects).toEqual(v4.projects)
    expect(resolveProjectDay(result.value, v4.projects[0].id, new Date(2026, 8, 7)).some((item) => item.subjectName === '國文')).toBe(true)
    persistAppDataV5(store, result.value)
    expect(values.get(APP_DATA_V4_KEY)).toBe(oldRaw)
    expect(values.get(APP_DATA_V3_KEY)).toBe(JSON.stringify(initialData))
    expect(values.get(APP_DATA_V1_KEY)).toBe('{"legacy":true}')
  })

  it('is deterministic and rejects malformed applicability', () => {
    const v4 = source()
    expect(migrateV4ToV5(v4)).toEqual(migrateV4ToV5(v4))
    expect(v4.subjects[0].applicableSchoolLevels).toBeUndefined()
    for (const levels of [[], ['junior-high', 'junior-high'], ['unknown']]) {
      const invalid = migrateV4ToV5(v4)
      invalid.subjects[0].applicableSchoolLevels = levels as typeof SCHOOL_LEVELS[number][]
      expect(isCompatibleAppDataV5(invalid)).toBe(false)
    }
    expect(isAppDataV5(migrateV4ToV5(v4))).toBe(true)
  })

  it('blocks fallback on corrupt v5 and leaves all source keys unchanged', () => {
    const rawV4 = JSON.stringify(source())
    const values = new Map([[APP_DATA_V5_KEY, '{bad-v5'], [APP_DATA_V4_KEY, rawV4]])
    const store = storage(values)
    expect(loadAppDataV5(store, createInitialAppDataV4())).toMatchObject({ status: 'read-error', source: 'v5', rawBackup: '{bad-v5', shouldPersist: false })
    expect(store.getItem).toHaveBeenCalledTimes(1)
    expect(store.setItem).not.toHaveBeenCalled()
    expect(values.get(APP_DATA_V4_KEY)).toBe(rawV4)
  })

  it('does not bypass a corrupt v4 source to read v3', () => {
    const values = new Map([[APP_DATA_V4_KEY, '{bad-v4'], [APP_DATA_V3_KEY, JSON.stringify(initialData)]])
    const store = storage(values)
    expect(loadAppDataV5(store, createInitialAppDataV4())).toMatchObject({ status: 'read-error', source: 'v4', rawBackup: '{bad-v4', shouldPersist: false })
    expect(store.getItem).toHaveBeenCalledTimes(2)
    expect(store.setItem).not.toHaveBeenCalled()
  })

  it('migrates v3 directly when v4 is absent and protects keys on write failure', () => {
    const rawV3 = JSON.stringify(initialData)
    const values = new Map([[APP_DATA_V3_KEY, rawV3]])
    const store = storage(values)
    const result = loadAppDataV5(store, createInitialAppDataV4())
    expect(result).toMatchObject({ status: 'saved', source: 'v3', rawBackup: rawV3, shouldPersist: true })
    store.setItem.mockImplementation(() => { throw new Error('quota exceeded') })
    expect(() => persistAppDataV5(store, result.value)).toThrow('quota exceeded')
    expect(values.get(APP_DATA_V3_KEY)).toBe(rawV3)
    expect(values.has(APP_DATA_V5_KEY)).toBe(false)
  })

  it('keeps the existing v1 migration path without writing v1 or v4', () => {
    const term = initialData.academicTerms[0]
    const legacy: LegacyAppDataV1 = {
      subjects: initialData.subjects, classes: initialData.classes,
      periods: term.periods.map(({ id, label, startTime, endTime }) => ({ id, label, startTime, endTime })),
      courses: initialData.courses.map(({ id, subjectId, classId, day, periodId, weekPattern, room, origin }) => ({ id, subjectId, classId, day, periodId, weekPattern, room, origin })),
      events: [], overrides: [],
      semester: { name: term.name, startDate: term.startDate, endDate: term.endDate, firstWeekPattern: 'A' },
    }
    const rawV1 = JSON.stringify(legacy)
    const values = new Map([[APP_DATA_V1_KEY, rawV1]])
    const result = loadAppDataV5(storage(values), createInitialAppDataV4())
    expect(result).toMatchObject({ status: 'saved', source: 'v1', shouldPersist: true })
    expect(result.value.subjects.map((item) => item.id)).toEqual(legacy.subjects.map((item) => item.id))
    expect(result.value.recurringLessons.map((item) => item.id)).toEqual(legacy.courses.map((item) => item.id))
    expect(values.get(APP_DATA_V1_KEY)).toBe(rawV1)
    expect(values.has(APP_DATA_V4_KEY)).toBe(false)
  })
})

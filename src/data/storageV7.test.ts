import { describe, expect, it } from 'vitest'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { APP_DATA_V3_KEY } from './storageV4'
import { APP_DATA_V6_KEY } from './storageV6'
import { APP_DATA_V7_KEY, loadAppDataV7, persistAppDataV7 } from './storageV7'
import { isCompatibleAppDataV7 } from './validators/v7'
import { copyTimetable, updateTimetable } from './timetablesV6'
import { createInitialAppDataV7 } from '../hooks/useAppDataV4'

const source = () => migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))
const storage = (values: Map<string, string>) => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value) },
})

describe('v6 to v7 migration and storage', () => {
  it('preserves all v6 entities and IDs, initializes an empty collection deterministically', () => {
    const v6 = source()
    const snapshot = structuredClone(v6)
    const first = migrateV6ToV7(v6)
    expect(first).toEqual({ ...snapshot, schemaVersion: 7, oneOffLessons: [] })
    expect(migrateV6ToV7(v6)).toEqual(first)
    expect(v6).toEqual(snapshot)
    expect(isCompatibleAppDataV7(first)).toBe(true)
    expect(() => migrateV6ToV7({ ...v6, recurringLessons: [{ ...v6.recurringLessons[0], classId: 'missing' }, ...v6.recurringLessons.slice(1)] })).toThrow('Invalid AppData v6')
    expect(() => migrateV6ToV7({ ...v6, oneOffLessons: [{ id: 'unexpected' }] } as never)).toThrow('Unexpected one-off data')
  })

  it('reads v6 without writing to it, then persists only a validated v7 key', () => {
    const v6 = source()
    const rawV6 = JSON.stringify(v6)
    const values = new Map([[APP_DATA_V6_KEY, rawV6]])
    const result = loadAppDataV7(storage(values), createInitialAppDataV7())
    expect(result).toMatchObject({ status: 'saved', source: 'v6', shouldPersist: true, legacyGuardRaw: rawV6 })
    expect(result.value.oneOffLessons).toEqual([])
    expect(values.get(APP_DATA_V6_KEY)).toBe(rawV6)
    expect(values.has(APP_DATA_V7_KEY)).toBe(false)
    persistAppDataV7(storage(values), result.value)
    expect(JSON.parse(values.get(APP_DATA_V7_KEY)!).schemaVersion).toBe(7)
    expect(values.get(APP_DATA_V6_KEY)).toBe(rawV6)
    expect(loadAppDataV7(storage(values), createInitialAppDataV7()).source).toBe('v7')
  })

  it('retains older v3 data during chained migration', () => {
    const rawV3 = JSON.stringify(initialData)
    const values = new Map([[APP_DATA_V3_KEY, rawV3]])
    const result = loadAppDataV7(storage(values), createInitialAppDataV7())
    expect(result.status).toBe('saved')
    expect(result.shouldPersist).toBe(true)
    expect(result.value.oneOffLessons).toEqual([])
    expect(values.get(APP_DATA_V3_KEY)).toBe(rawV3)
  })

  it('does not fall back over corrupt v7 or v6 and exposes the original recovery JSON', () => {
    const rawV6 = JSON.stringify(source())
    const brokenV7 = new Map([[APP_DATA_V7_KEY, '{bad-v7'], [APP_DATA_V6_KEY, rawV6]])
    const v7 = loadAppDataV7(storage(brokenV7), createInitialAppDataV7())
    expect(v7).toMatchObject({ status: 'read-error', rawBackup: '{bad-v7', shouldPersist: false })
    expect(brokenV7.get(APP_DATA_V7_KEY)).toBe('{bad-v7')
    const brokenV6 = new Map([[APP_DATA_V6_KEY, '{bad-v6'], [APP_DATA_V3_KEY, JSON.stringify(initialData)]])
    const v6 = loadAppDataV7(storage(brokenV6), createInitialAppDataV7())
    expect(v6).toMatchObject({ status: 'read-error', rawBackup: '{bad-v6', shouldPersist: false })
    expect(brokenV6.has(APP_DATA_V7_KEY)).toBe(false)
  })

  it('refuses an inconsistent v6 snapshot during migration and a failed v7 write', () => {
    const v6 = source()
    const firstRaw = JSON.stringify(v6)
    const changedRaw = JSON.stringify({ ...v6, projects: v6.projects.map((project) => ({ ...project, name: 'other tab' })) })
    let reads = 0
    const result = loadAppDataV7({ getItem: (key) => {
      if (key !== APP_DATA_V6_KEY) return null
      reads += 1
      return reads < 3 ? firstRaw : changedRaw
    } }, createInitialAppDataV7())
    expect(result).toMatchObject({ status: 'read-error', shouldPersist: false })
    const values = new Map([[APP_DATA_V6_KEY, firstRaw]])
    expect(() => persistAppDataV7({ setItem: () => { throw new Error('quota') } }, migrateV6ToV7(v6))).toThrow('quota')
    expect(values.has(APP_DATA_V7_KEY)).toBe(false)
    expect(values.get(APP_DATA_V6_KEY)).toBe(firstRaw)
    expect(() => persistAppDataV7(storage(values), { ...migrateV6ToV7(v6), oneOffLessons: [{}] } as never)).toThrow('Refusing')
  })

  it('copies a timetable without copying dated one-off lessons', () => {
    const sourceData = source()
    const ready = updateTimetable(migrateV6ToV7(sourceData), sourceData.timetables[0].id, { name: '原課表', teacherName: '林老師' })
    ready.oneOffLessons.push({
      id: 'one-off-1', projectId: ready.projects[0].id, timetableId: ready.timetables[0].id,
      teachingUnitId: ready.teachingUnits[0].id, classId: ready.classes[0].id, subjectId: ready.subjects[0].id,
      date: '2026-09-06', purpose: 'substitute', time: { mode: 'custom', startTime: '09:30', endTime: '11:00' },
    })
    let index = 0
    const copied = copyTimetable(ready, {
      projectId: ready.projects[0].id, sourceTimetableId: ready.timetables[0].id,
      baseDate: '2026-09-07', name: '新課表', teacherName: '王老師',
    }, () => `copy-${++index}`)
    expect(copied.timetables).toHaveLength(2)
    expect(copied.oneOffLessons).toEqual(ready.oneOffLessons)
    expect(copied.oneOffLessons[0].timetableId).toBe(ready.timetables[0].id)
  })
})

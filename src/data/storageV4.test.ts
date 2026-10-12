import { describe, expect, it, vi } from 'vitest'
import type { AppDataV4 } from '../types'
import { initialData } from './seed'
import type { LegacyAppDataV1 } from './migrations'
import { migrateV3ToV4 } from './migrationsV4'
import { APP_DATA_V1_KEY, APP_DATA_V3_KEY, APP_DATA_V4_KEY, loadAppDataV4, persistLoadedAppDataV4 } from './storageV4'

const initialV4 = () => migrateV3ToV4(structuredClone(initialData))

describe('AppData v4 storage routing', () => {
  it('有效 v4 存在時優先讀取且不檢查舊 key', () => {
    const v4 = initialV4(); v4.projects[0].name = 'v4 專案'
    const getItem = vi.fn((key: string) => key === APP_DATA_V4_KEY ? JSON.stringify(v4) : JSON.stringify(initialData))
    const result = loadAppDataV4({ getItem }, initialV4())
    expect(result).toMatchObject({ status: 'saved', source: 'v4', shouldPersist: false })
    expect(result.value.projects[0].name).toBe('v4 專案')
    expect(getItem).toHaveBeenCalledTimes(1)
  })

  it('損壞 v4 存在時不 fallback 至有效 v3，且保留原始內容', () => {
    const values = new Map([[APP_DATA_V4_KEY, '{broken-v4'], [APP_DATA_V3_KEY, JSON.stringify(initialData)]])
    const getItem = vi.fn((key: string) => values.get(key) ?? null)
    const result = loadAppDataV4({ getItem }, initialV4())
    expect(result).toMatchObject({ status: 'read-error', source: 'v4', rawBackup: '{broken-v4', shouldPersist: false })
    expect(getItem).toHaveBeenCalledTimes(1)
  })

  it('v4 缺少時由 v3 遷移，寫入時只建立 v4 並保留 v3/v1', () => {
    const values = new Map([[APP_DATA_V3_KEY, JSON.stringify(initialData)], [APP_DATA_V1_KEY, '{"legacy":true}']])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    }
    const result = loadAppDataV4(storage, initialV4())
    expect(result).toMatchObject({ status: 'saved', source: 'v3', shouldPersist: true })
    expect(persistLoadedAppDataV4(storage, result)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledOnce()
    expect(storage.setItem).toHaveBeenCalledWith(APP_DATA_V4_KEY, expect.any(String))
    expect(values.get(APP_DATA_V3_KEY)).toBe(JSON.stringify(initialData))
    expect(values.get(APP_DATA_V1_KEY)).toBe('{"legacy":true}')
  })

  it('無效 v3 遷移失敗時不讀取 v1 也不寫入任何 key', () => {
    const values = new Map([[APP_DATA_V3_KEY, '{"schemaVersion":3}'], [APP_DATA_V1_KEY, '{"valid":"but ignored"}']])
    const storage = { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn() }
    const result = loadAppDataV4(storage, initialV4())
    expect(result).toMatchObject({ status: 'read-error', source: 'v3', shouldPersist: false })
    expect(storage.getItem).toHaveBeenCalledTimes(2)
    expect(persistLoadedAppDataV4(storage, result)).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('v4 與 v3 都缺少時支援 v1 → v3 → v4 路徑', () => {
    const legacy: LegacyAppDataV1 = {
      subjects: initialData.subjects,
      classes: initialData.classes,
      periods: initialData.academicTerms[0].periods.map(({ id, label, startTime, endTime }) => ({ id, label, startTime, endTime })),
      courses: initialData.courses.map((course) => ({ id: course.id, subjectId: course.subjectId, classId: course.classId, day: course.day, periodId: course.periodId, weekPattern: course.weekPattern, room: course.room, origin: course.origin })),
      events: [], overrides: [],
      semester: { name: initialData.academicTerms[0].name, startDate: initialData.academicTerms[0].startDate, endDate: initialData.academicTerms[0].endDate, firstWeekPattern: 'A' },
    }
    const result = loadAppDataV4({ getItem: (key) => key === APP_DATA_V1_KEY ? JSON.stringify(legacy) : null }, initialV4())
    expect(result).toMatchObject({ status: 'saved', source: 'v1', shouldPersist: true })
    expect(result.value.recurringLessons.map((item) => item.id)).toEqual(legacy.courses.map((item) => item.id))
  })

  it('storage 讀取例外會中止且不嘗試 fallback', () => {
    const getItem = vi.fn(() => { throw new Error('storage denied') })
    expect(loadAppDataV4({ getItem }, initialV4())).toMatchObject({ status: 'read-error', source: 'v4', rawBackup: null, shouldPersist: false })
    expect(getItem).toHaveBeenCalledOnce()
  })

  it('拒絕持久化無效 migration 結果', () => {
    const storage = { setItem: vi.fn() }
    const invalid = { ...initialV4(), activeProjectId: 'missing' } as AppDataV4
    expect(() => persistLoadedAppDataV4(storage, { value: invalid, status: 'saved', source: 'v3', rawBackup: '{}', shouldPersist: true })).toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('v4 寫入失敗時不會改動舊 v3 或 v1 內容', () => {
    const originalV3 = JSON.stringify(initialData)
    const values = new Map([[APP_DATA_V3_KEY, originalV3], [APP_DATA_V1_KEY, '{"legacy":true}']])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn(() => { throw new Error('quota exceeded') }),
    }
    const loaded = loadAppDataV4(storage, initialV4())
    expect(() => persistLoadedAppDataV4(storage, loaded)).toThrow('quota exceeded')
    expect(values.get(APP_DATA_V3_KEY)).toBe(originalV3)
    expect(values.get(APP_DATA_V1_KEY)).toBe('{"legacy":true}')
    expect(values.has(APP_DATA_V4_KEY)).toBe(false)
  })
})

// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDataV4, AppDataV7 } from '../types'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { isCompatibleAppDataV7 } from '../data/validators/v7'
import { useAppDataV4 } from './useAppDataV4'

const base = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
const shrink = (data: AppDataV4): AppDataV4 => ({ ...data, subjects: data.subjects.map((subject, index) => index === 0
  ? { ...subject, applicableSchoolLevels: ['junior-high'] } : subject) })
const validBatch = (data: AppDataV4): AppDataV4 => ({ ...data,
  projects: data.projects.map((project) => ({ ...project, name: 'Local project' })),
  subjects: [...data.subjects, { id: 'new-subject', name: 'New subject', shortName: 'NS', color: '#123456', applicableSchoolLevels: ['other'] }],
})

function setup(data = base()) {
  const raw = JSON.stringify(data)
  localStorage.setItem(APP_DATA_V7_KEY, raw)
  return { ...renderHook(() => useAppDataV4()), data, raw }
}

function receive(raw: string, oldValue: string) {
  localStorage.setItem(APP_DATA_V7_KEY, raw)
  act(() => window.dispatchEvent(new StorageEvent('storage', {
    key: APP_DATA_V7_KEY, oldValue, newValue: raw, storageArea: localStorage,
  })))
}

describe('v7 subject safety across persistence and synchronization', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear() })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })

  it('loads legacy conflicts and colors without cleaning them, then persists unrelated edits intact', () => {
    const data = base()
    data.subjects[1].name = data.subjects[0].name
    data.subjects[1].shortName = data.subjects[0].shortName
    data.subjects[0].color = 'rgb(12, 34, 56)'
    const { result, raw } = setup(data)
    act(() => vi.advanceTimersByTime(200))
    expect(result.current[2]).toBe('saved')
    expect(result.current[4].revision).toBe(0)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    act(() => result.current[1]((current) => ({ ...current,
      projects: current.projects.map((project) => ({ ...project, name: 'Renamed' })),
    })))
    act(() => vi.advanceTimersByTime(200))
    expect(result.current[2]).toBe('saved')
    expect(result.current[4].revision).toBe(1)
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!).subjects).toEqual(data.subjects)
  })

  it.each(['shrink', 'delete-unassigned', 'duplicate', 'rename-short'] as const)(
    'rejects an unsafe %s transaction before updating either state or storage', (operation) => {
      const data = base()
      if (operation === 'delete-unassigned') {
        data.recurringLessons = data.recurringLessons.filter((lesson) => lesson.subjectId !== data.subjects[0].id)
        data.overrides.push({ id: 'unassigned', projectId: null, timetableId: null, teachingUnitId: null,
          action: 'replace', date: '2026-09-07', periodId: 1,
          replacement: { subjectId: data.subjects[0].id, classId: 'unknown' } })
      }
      const { result, raw } = setup(data)
      let next: AppDataV4 = validBatch(data)
      if (operation === 'shrink') next = shrink(next)
      if (operation === 'delete-unassigned') next.subjects = next.subjects.slice(1)
      if (operation === 'duplicate') next.subjects = [...next.subjects, { ...data.subjects[0], id: 'duplicate' }]
      if (operation === 'rename-short') next.subjects = next.subjects.map((subject, index) => index === 1
        ? { ...subject, shortName: data.subjects[0].shortName } : subject)
      expect(isCompatibleAppDataV7(next)).toBe(true)
      act(() => result.current[1](next))
      act(() => vi.advanceTimersByTime(200))
      expect(result.current[2]).toBe('write-error')
      expect(result.current[0]).toEqual(data)
      expect(result.current[4]).toEqual({ pending: false, revision: 0 })
      expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    },
  )

  it('rejects an unsafe external subject update without partially applying the document', () => {
    const { result, data, raw } = setup()
    const external = JSON.stringify(shrink(validBatch(data)))
    receive(external, raw)
    expect(result.current[2]).toBe('read-error')
    expect(result.current[0]).toEqual(data)
    expect(result.current[3].rawBackup).toBe(external)
    act(() => vi.advanceTimersByTime(200))
    // Another tab owns this write; we preserve it for recovery, never overwrite it silently.
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(external)
    expect(result.current[4].revision).toBe(0)
  })

  it('blocks pending writes on conflict and revalidates accept-external before allowing keep-local', () => {
    const { result, data, raw } = setup()
    act(() => result.current[1](validBatch))
    const local = result.current[0]
    const external = JSON.stringify(shrink(data))
    receive(external, raw)
    act(() => vi.advanceTimersByTime(200))
    expect(result.current[2]).toBe('conflict')
    expect(result.current[4].revision).toBe(0)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(external)
    act(() => result.current[3].acceptExternal())
    expect(result.current[2]).toBe('read-error')
    expect(result.current[0]).toEqual(local)
    act(() => result.current[3].keepLocal())
    expect(result.current[2]).toBe('saved')
    expect(result.current[4]).toEqual({ pending: false, revision: 1 })
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)).toEqual(local)
  })

  it('retains the entire old document on write failure and persists the whole batch only after retry', () => {
    const { result, raw } = setup()
    act(() => result.current[1](validBatch))
    const candidate = result.current[0]
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current[2]).toBe('write-error')
    expect(result.current[4]).toEqual({ pending: true, revision: 0 })
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    expect(result.current[0]).toEqual(candidate)
    write.mockRestore()
    act(() => result.current[3].keepLocal())
    expect(result.current[2]).toBe('saved')
    expect(result.current[4]).toEqual({ pending: false, revision: 1 })
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!)).toEqual(candidate)
  })

  it('rechecks the persisted base for debounced and keep-local writes, not only intermediate local states', () => {
    const { result, data, raw } = setup()
    act(() => result.current[1]((current) => ({ ...current, recurringLessons: [] })))
    act(() => result.current[1]((current) => ({ ...current, subjects: current.subjects.slice(1) })))
    act(() => vi.advanceTimersByTime(200))
    expect(result.current[2]).toBe('write-error')
    expect(result.current[4].revision).toBe(0)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(raw)
    act(() => result.current[3].keepLocal())
    expect(result.current[2]).toBe('write-error')
    expect(JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV7).toEqual(data)
  })
})

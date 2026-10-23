import { describe, expect, it, vi } from 'vitest'
import { APP_DATA_V8_ACTIVATION_KEY, V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY } from './activationV8'
import { clearLegacyTestData, inspectLegacyTestData } from './devLegacyResetV8'
import { APP_DATA_V7_KEY } from './storageV7'
import { APP_DATA_V8_KEY } from './storageV8'

function memory(entries: [string, string][] = []) {
  const values = new Map(entries)
  return { values, getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => { values.delete(key) }) }
}

describe('explicit development-only legacy cleanup', () => {
  it('inventories exact raw without mutation and removes only explicitly confirmed keys', () => {
    const keep: [string, string][] = [[APP_DATA_V8_KEY, 'v8'], [APP_DATA_V8_ACTIVATION_KEY, 'v1'],
      [V8_TRANSACTION_KEY, 'v2'], [V8_BOOTSTRAP_KEY, 'bootstrap'],
      ['aster-timetable-v8-cutover-backup:one', 'backup'], ['aster-timetable-v8-rollback-archive:one', 'archive'],
      ['another-app', 'other']]
    const store = memory([[APP_DATA_V7_KEY, ' exact raw\n'], ['aster-timetable-data-v6', '{}'], ...keep])
    const inventory = inspectLegacyTestData(store, true)
    expect(inventory.ok).toBe(true)
    if (!inventory.ok) return
    expect(inventory.snapshot.entries).toContainEqual({ key: APP_DATA_V7_KEY, raw: ' exact raw\n' })
    expect(store.removeItem).not.toHaveBeenCalled()
    expect(clearLegacyTestData(store, { development: true, snapshot: inventory.snapshot,
      selectedKeys: [APP_DATA_V7_KEY], confirmedKeys: [] })).toMatchObject({ ok: false, code: 'confirmation-required' })
    expect(clearLegacyTestData(store, { development: true, snapshot: inventory.snapshot,
      selectedKeys: [APP_DATA_V7_KEY], confirmedKeys: [APP_DATA_V7_KEY] })).toEqual({ ok: true, removed: [APP_DATA_V7_KEY] })
    expect(store.values.get('aster-timetable-data-v6')).toBe('{}')
    for (const [key, raw] of keep) expect(store.values.get(key)).toBe(raw)
    expect(store.removeItem).toHaveBeenCalledTimes(1)
  })

  it('blocks production mode, stale snapshots, unknown keys and unconfirmed removal', () => {
    const store = memory([[APP_DATA_V7_KEY, 'first']])
    expect(inspectLegacyTestData(store, false)).toMatchObject({ ok: false, code: 'not-development' })
    const inventory = inspectLegacyTestData(store, true)
    if (!inventory.ok) throw new Error('fixture failed')
    expect(clearLegacyTestData(store, { development: false, snapshot: inventory.snapshot,
      selectedKeys: [APP_DATA_V7_KEY], confirmedKeys: [APP_DATA_V7_KEY] })).toMatchObject({ ok: false, code: 'not-development' })
    expect(clearLegacyTestData(store, { development: true, snapshot: inventory.snapshot,
      selectedKeys: [APP_DATA_V8_KEY], confirmedKeys: [APP_DATA_V8_KEY] })).toMatchObject({ ok: false, code: 'invalid-selection' })
    store.values.set(APP_DATA_V7_KEY, 'changed')
    expect(clearLegacyTestData(store, { development: true, snapshot: inventory.snapshot,
      selectedKeys: [APP_DATA_V7_KEY], confirmedKeys: [APP_DATA_V7_KEY] })).toMatchObject({ ok: false, code: 'source-changed' })
    expect(store.removeItem).not.toHaveBeenCalled()
  })
})

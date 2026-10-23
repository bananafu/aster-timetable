import { TOKI_LEGACY_DATA_KEYS } from './storageV8'

type ReadStorage = Pick<Storage, 'getItem'>
type ResetStorage = Pick<Storage, 'getItem' | 'removeItem'>
export interface LegacyTestDataSnapshot {
  entries: { key: string; raw: string }[]
  /** Exact-key list suitable for a confirmation dialog; no prefix matching. */
  keys: string[]
}
export type LegacyResetResult =
  | { ok: true; removed: string[] }
  | { ok: false; code: 'not-development' | 'read-failure' | 'invalid-selection' | 'confirmation-required'
      | 'source-changed' | 'remove-failure' | 'remove-unconfirmed'; removed: string[]; failedKey?: string }

const allowed = (development: boolean) => import.meta.env.DEV && development

/** Read-only, dev-only export inventory. No browser storage is touched on import. */
export function inspectLegacyTestData(storage: ReadStorage, development: boolean):
  { ok: true; snapshot: LegacyTestDataSnapshot } | Exclude<LegacyResetResult, { ok: true }> {
  if (!allowed(development)) return { ok: false, code: 'not-development', removed: [] }
  try {
    const entries = TOKI_LEGACY_DATA_KEYS.flatMap((key) => {
      const raw = storage.getItem(key)
      return raw === null ? [] : [{ key, raw }]
    })
    return { ok: true, snapshot: { entries, keys: entries.map((item) => item.key) } }
  } catch { return { ok: false, code: 'read-failure', removed: [] } }
}

/** Explicit selection + exact confirmation; the caller must offer every raw for export first. */
export function clearLegacyTestData(storage: ResetStorage, input: {
  development: boolean
  snapshot: LegacyTestDataSnapshot
  selectedKeys: string[]
  confirmedKeys: string[]
}): LegacyResetResult {
  if (!allowed(input.development)) return { ok: false, code: 'not-development', removed: [] }
  const selected = input.selectedKeys
  const expected = input.snapshot.entries
  if (!selected.length || new Set(selected).size !== selected.length
    || selected.some((key) => !TOKI_LEGACY_DATA_KEYS.some((allowedKey) => allowedKey === key)
      || !expected.some((item) => item.key === key))) return { ok: false, code: 'invalid-selection', removed: [] }
  if (JSON.stringify(selected) !== JSON.stringify(input.confirmedKeys)) {
    return { ok: false, code: 'confirmation-required', removed: [] }
  }
  try {
    if (expected.some((item) => storage.getItem(item.key) !== item.raw)) {
      return { ok: false, code: 'source-changed', removed: [] }
    }
  } catch { return { ok: false, code: 'read-failure', removed: [] } }
  const removed: string[] = []
  for (const key of selected) {
    try {
      if (storage.getItem(key) !== expected.find((item) => item.key === key)?.raw) {
        return { ok: false, code: 'source-changed', removed, failedKey: key }
      }
    } catch { return { ok: false, code: 'read-failure', removed, failedKey: key } }
    try { storage.removeItem(key) }
    catch { return { ok: false, code: 'remove-failure', removed, failedKey: key } }
    try {
      if (storage.getItem(key) !== null) return { ok: false, code: 'remove-unconfirmed', removed, failedKey: key }
    } catch { return { ok: false, code: 'remove-unconfirmed', removed, failedKey: key } }
    removed.push(key)
  }
  return { ok: true, removed }
}

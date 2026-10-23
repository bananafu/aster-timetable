/** Web Locks coordinate cooperating V8 pages only. Legacy pages do not participate. */
export const V8_STORAGE_LOCK = 'toki-v8-storage-transaction'

export async function withV8StorageLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('lock-unavailable')
  const result = await navigator.locks.request(V8_STORAGE_LOCK, { mode: 'exclusive' }, async (lock) => {
    if (!lock) throw new Error('lock-unavailable')
    return { acquired: true, value: await operation() }
  })
  if (!result?.acquired) throw new Error('lock-unavailable')
  return result.value
}

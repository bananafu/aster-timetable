import type { Dispatch, SetStateAction } from 'react'
import { APP_DATA_V9_KEY, V9_BACKUP_PREFIX, loadAppDataV9, type V9LoadStatus } from './data/storageV9'
import { useAppDataV4 } from './hooks/useAppDataV4'
import type { StorageControls, StoragePersistence, StorageStatus } from './hooks/useLocalStorage'
import type { V9Host } from './hooks/useAppDataV9'
import type { AppDataV4 } from './types'

export type FormalRuntimeDecision =
  | { runtime: 'v7'; v9Status: 'absent' }
  | { runtime: 'blocked-v9'; v9Status: Exclude<V9LoadStatus, 'absent'> | 'unknown-evidence' }

type RuntimeStorage = Pick<Storage, 'getItem' | 'key' | 'length'>

/**
 * Read-only production gate. Only the proven absence of every known V9 artifact
 * may mount the V7 Host. Active V9 is intentionally blocked until the formal
 * V9 controller reaches product parity in a later stage.
 */
export function inspectFormalRuntime(storage: RuntimeStorage): FormalRuntimeDecision {
  const loaded = loadAppDataV9(storage)
  if (loaded.status !== 'absent') return { runtime: 'blocked-v9', v9Status: loaded.status }
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(APP_DATA_V9_KEY) || key?.startsWith(V9_BACKUP_PREFIX)) {
        return { runtime: 'blocked-v9', v9Status: 'unknown-evidence' }
      }
    }
  } catch {
    return { runtime: 'blocked-v9', v9Status: 'read-error' }
  }
  return { runtime: 'v7', v9Status: 'absent' }
}

export function isV9RuntimeStorageKey(key: string | null): boolean {
  return key === null || key.startsWith(APP_DATA_V9_KEY) || key.startsWith(V9_BACKUP_PREFIX)
}

export interface FormalV7AppController {
  runtime: 'v7'
  document: AppDataV4
  updateDocument: Dispatch<SetStateAction<AppDataV4>>
  storageStatus: StorageStatus
  storageControls: StorageControls
  storagePersistence: StoragePersistence
}

/** Keeps the established V7 Host behavior behind a narrow formal-App port. */
export function useFormalV7AppController(): FormalV7AppController {
  const [document, updateDocument, storageStatus, storageControls, storagePersistence] = useAppDataV4()
  return { runtime: 'v7', document, updateDocument, storageStatus, storageControls, storagePersistence }
}

/**
 * Compile-time boundary for the later formal V9 controller. Mapping does not
 * mount the Host or perform a write; its only mutation capability is host.update.
 */
export type FormalV9HostPort = {
  document: V9Host['data']
  status: V9Host['status']
  writable: V9Host['writable']
  pending: V9Host['pending']
  receipt: V9Host['receipt']
  revision: V9Host['revision']
  errorCode: V9Host['errorCode']
  update: V9Host['update']
}

export function toFormalV9HostPort(host: V9Host): FormalV9HostPort {
  return { document: host.data, status: host.status, writable: host.writable, pending: host.pending,
    receipt: host.receipt, revision: host.revision, errorCode: host.errorCode, update: host.update }
}

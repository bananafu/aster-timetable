import type { Dispatch, SetStateAction } from 'react'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_BACKUP_PREFIX, checkV9WriteEvidence,
  loadAppDataV9, type V9LoadStatus } from './data/storageV9'
import { useAppDataV4 } from './hooks/useAppDataV4'
import type { StorageControls, StoragePersistence, StorageStatus } from './hooks/useLocalStorage'
import type { V9Host } from './hooks/useAppDataV9'
import type { AppDataV4 } from './types'

export type FormalRuntimeDecision =
  | { runtime: 'v7'; v9Status: 'absent' }
  | { runtime: 'v9'; v9Status: 'active' }
  | { runtime: 'blocked-v9'; v9Status: Exclude<V9LoadStatus, 'absent'>
    | 'unknown-evidence' | 'invalid-evidence' }

type RuntimeStorage = Pick<Storage, 'getItem' | 'key' | 'length'>

function hasUnknownV9Evidence(storage: RuntimeStorage, allowed: ReadonlySet<string>): boolean {
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key && (key.startsWith(APP_DATA_V9_KEY) || key.startsWith(V9_BACKUP_PREFIX))
      && !allowed.has(key)) return true
  }
  return false
}

/** Structural recheck used after mount; cryptographic evidence remains owned by the V9 Host. */
export function hasActiveFormalV9Structure(storage: RuntimeStorage): boolean {
  try {
    const loaded = loadAppDataV9(storage)
    if (loaded.status !== 'active' || !loaded.document || !loaded.metadata
      || !loaded.rawDocument || !loaded.rawMetadata
      || storage.getItem(loaded.metadata.backupKey) === null) return false
    return !hasUnknownV9Evidence(storage,
      new Set([APP_DATA_V9_KEY, V9_ACTIVATION_KEY, loaded.metadata.backupKey]))
  } catch { return false }
}

/**
 * Read-only production gate. V7 mounts only when every V9 artifact is absent.
 * V9 mounts only after its active document, activation, backup, source evidence,
 * and digests have all been verified. Every ambiguous state stays blocked.
 */
export async function inspectFormalRuntime(storage: RuntimeStorage): Promise<FormalRuntimeDecision> {
  const loaded = loadAppDataV9(storage)
  if (loaded.status === 'active') {
    if (!hasActiveFormalV9Structure(storage)) {
      return { runtime: 'blocked-v9', v9Status: 'invalid-evidence' }
    }
    if (!loaded.rawDocument || !loaded.rawMetadata
      || !(await checkV9WriteEvidence(storage, loaded.rawDocument, loaded.rawMetadata))) {
      return { runtime: 'blocked-v9', v9Status: 'invalid-evidence' }
    }
    return { runtime: 'v9', v9Status: 'active' }
  }
  if (loaded.status !== 'absent') return { runtime: 'blocked-v9', v9Status: loaded.status }
  try {
    if (hasUnknownV9Evidence(storage, new Set())) {
      return { runtime: 'blocked-v9', v9Status: 'unknown-evidence' }
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
  updateHighRisk?: V9Host['updateHighRisk']
}

export function toFormalV9HostPort(host: V9Host): FormalV9HostPort {
  return { document: host.data, status: host.status, writable: host.writable, pending: host.pending,
    receipt: host.receipt, revision: host.revision, errorCode: host.errorCode,
    update: host.update, updateHighRisk: host.updateHighRisk }
}

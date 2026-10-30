import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppDataV9 } from '../types/v9'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { APP_DATA_V8_KEY } from '../data/storageV8'
import { V8_BOOTSTRAP_KEY, V8_TRANSACTION_KEY } from '../data/activationV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, checkV9WriteEvidence, loadAppDataV9,
  persistAppDataV9, type V9HighRiskOperation, type V9LoadStatus, type V9PersistenceReceipt } from '../data/storageV9'
import { isCompatibleAppDataV9 } from '../data/validators/v9'

export type V9HostStatus = V9LoadStatus | 'conflict' | 'write-error' | 'lock-unavailable'
export interface V9Host {
  data: AppDataV9 | null
  status: V9HostStatus
  writable: boolean
  pending: boolean
  receipt: V9PersistenceReceipt | null
  revision: number
  errorCode: string | null
  /** Returns a verified persistence receipt; rejected writes leave the caller's form draft intact. */
  update: (produce: (current: AppDataV9) => AppDataV9) => Promise<V9PersistenceReceipt>
  updateHighRisk?: (produce: (current: AppDataV9) => AppDataV9,
    operation: V9HighRiskOperation) => Promise<V9PersistenceReceipt>
  exportLocalJson: () => string | null
  exportStoredJson: () => string | null
  exportActivationJson: () => string | null
  exportBackupJson: () => string | null
  adoptExternal: () => Promise<boolean>
}

/** V9 never mounts the V8 Host or writes to an older key. */
export function useAppDataV9(): V9Host {
  const [initial] = useState(() => loadAppDataV9(localStorage))
  const [data, setData] = useState(initial.document)
  const [status, setStatus] = useState<V9HostStatus>(initial.status)
  const [writable, setWritable] = useState(false)
  const [pending, setPending] = useState(false)
  const [receipt, setReceipt] = useState<V9PersistenceReceipt | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const rawRef = useRef(initial.rawDocument)
  const metadataRawRef = useRef(initial.rawMetadata)
  const backupKeyRef = useRef(initial.metadata?.backupKey ?? null)
  const revisionRef = useRef(initial.metadata?.documentRevision ?? 0)
  const documentRef = useRef(initial.document)
  const writableRef = useRef(false)
  const pendingRef = useRef(false)
  const generationRef = useRef(0)

  const revoke = useCallback((code: string, next: V9HostStatus = 'conflict') => {
    generationRef.current += 1
    writableRef.current = false
    setWritable(false)
    setStatus(next)
    setErrorCode(code)
    setReceipt(null)
  }, [])

  const verify = useCallback(async () => {
    const generation = generationRef.current
    const hasLock = typeof navigator !== 'undefined' && !!navigator.locks?.request
    if (!hasLock) { revoke('web-locks-unavailable', 'lock-unavailable'); return false }
    if (rawRef.current === null || metadataRawRef.current === null
      || !(await checkV9WriteEvidence(localStorage, rawRef.current, metadataRawRef.current))) {
      revoke('activation-or-source-conflict'); return false
    }
    if (generationRef.current !== generation) return false
    writableRef.current = true
    setWritable(true)
    setStatus('active')
    setErrorCode(null)
    return true
  }, [revoke])

  useEffect(() => {
    if (initial.status !== 'active') return
    void verify()
  }, [initial.status, verify])

  useEffect(() => {
    const watched = new Set([APP_DATA_V7_KEY, APP_DATA_V8_KEY, V8_BOOTSTRAP_KEY,
      V8_TRANSACTION_KEY, APP_DATA_V9_KEY, V9_ACTIVATION_KEY])
    const handle = (event: StorageEvent) => {
      if (event.key === null || watched.has(event.key)
        || event.key === backupKeyRef.current) {
        revoke('external-storage-change')
      }
    }
    window.addEventListener('storage', handle)
    return () => window.removeEventListener('storage', handle)
  }, [revoke])

  const update = useCallback(async (produce: (current: AppDataV9) => AppDataV9,
    highRiskOperation?: V9HighRiskOperation) => {
    const current = documentRef.current
    const expectedRaw = rawRef.current
    const expectedMetadataRaw = metadataRawRef.current
    if (!writableRef.current || pendingRef.current || !current || !expectedRaw || !expectedMetadataRaw) {
      throw new Error('v9-not-writable')
    }
    const next = produce(current)
    if (!isCompatibleAppDataV9(next)) throw new Error('invalid-v9-update')
    pendingRef.current = true
    setPending(true)
    const generation = generationRef.current
    try {
      const confirmed = await persistAppDataV9(localStorage, current, next,
        { raw: expectedRaw, metadataRaw: expectedMetadataRaw, revision: revisionRef.current }, highRiskOperation)
      if (generationRef.current !== generation) {
        revoke('external-storage-change')
        throw new Error('external-storage-change')
      }
      const loaded = loadAppDataV9(localStorage)
      if (loaded.rawDocument !== confirmed.raw || !loaded.rawMetadata || !loaded.document
        || loaded.metadata?.documentRevision !== confirmed.revision) {
        revoke('post-write-readback-failed')
        throw new Error('post-write-readback-failed')
      }
      rawRef.current = loaded.rawDocument
      metadataRawRef.current = loaded.rawMetadata
      backupKeyRef.current = loaded.metadata.backupKey
      revisionRef.current = confirmed.revision
      documentRef.current = loaded.document
      setData(loaded.document)
      setReceipt(confirmed)
      setStatus('active')
      return confirmed
    } catch (cause) {
      revoke(cause instanceof Error ? cause.message : 'v9-write-failed', 'write-error')
      throw cause
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [revoke])

  const adoptExternal = useCallback(async () => {
    if (pendingRef.current) return false
    const loaded = loadAppDataV9(localStorage)
    if (loaded.status !== 'active' || !loaded.rawDocument || !loaded.rawMetadata || !loaded.document
      || !(await checkV9WriteEvidence(localStorage, loaded.rawDocument, loaded.rawMetadata))) return false
    generationRef.current += 1
    rawRef.current = loaded.rawDocument
    metadataRawRef.current = loaded.rawMetadata
    backupKeyRef.current = loaded.metadata!.backupKey
    revisionRef.current = loaded.metadata!.documentRevision
    documentRef.current = loaded.document
    setData(loaded.document)
    setReceipt(null)
    setStatus('active')
    setErrorCode(null)
    void verify()
    return true
  }, [verify])

  return { data, status, writable, pending, receipt, revision: revisionRef.current, errorCode,
    update, updateHighRisk: (produce, operation) => update(produce, operation), adoptExternal,
    exportLocalJson: () => documentRef.current ? JSON.stringify(documentRef.current) : null,
    exportStoredJson: () => { try { return localStorage.getItem(APP_DATA_V9_KEY) } catch { return null } },
    exportActivationJson: () => { try { return localStorage.getItem(V9_ACTIVATION_KEY) } catch { return null } },
    exportBackupJson: () => {
      try {
        const raw = localStorage.getItem(V9_ACTIVATION_KEY)
        const backupKey: string | undefined = raw ? JSON.parse(raw).backupKey : undefined
        return backupKey ? localStorage.getItem(backupKey) : null
      } catch { return null }
    },
  }
}

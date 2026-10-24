import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  loadV8ActivationMetadata,
  APP_DATA_V8_ACTIVATION_KEY,
  V8_BOOTSTRAP_KEY,
  loadV8BootstrapMetadata,
  loadV8Transaction,
  fingerprintV7Raw,
  V8_TRANSACTION_KEY,
  type V8ActivationTransaction,
  type V8ActivationMetadata,
  type V8ActivationMetadataLoadResult,
  type V8BootstrapMetadata,
} from '../data/activationV8'
import type { V8MigrationPreflightReport, V8MigrationReconciliationReport } from '../data/migrationPreflightV8'
import {
  APP_DATA_V8_KEY,
  AppDataV8StorageError,
  createEmptyAppDataV8,
  loadAppDataV8,
  loadAppDataV8Only,
  parseAppDataV8Raw,
  persistAppDataV8,
  type AppDataV8LoadIssue,
  type AppDataV8LoadResult,
  type AppDataV8StorageErrorCode,
  type AppDataV8WriteConfirmation,
  type V8OnlyLoadStatus,
} from '../data/storageV8'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_BACKUP_PREFIX } from '../data/storageV9'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from '../data/validators/v8'
import { withV8StorageLock } from '../data/v8Coordination'
import type { AppDataV8 } from '../types'
import type { StoragePersistence, StorageStatus } from './useLocalStorage'

export type AppDataV8RuntimeStatus = StorageStatus | 'inactive' | 'migration-ready' | 'migration-blocked'
export type AppDataV8ConflictSource = 'v8' | 'v7' | null

export interface AppDataV8Persistence extends StoragePersistence {
  /** Last confirmed write by this host; external synchronization does not create a receipt. */
  receipt: AppDataV8WriteConfirmation | null
}

export interface AppDataV8RuntimeInfo {
  source: AppDataV8LoadResult['source']
  loadIssue: AppDataV8LoadIssue
  migration: {
    preflight: V8MigrationPreflightReport
    reconciliation: V8MigrationReconciliationReport | null
  } | null
  migrationFailure: AppDataV8LoadResult['migrationFailure'] | null
  activationMetadata: V8ActivationMetadata | null
  activationIssue: V8ActivationMetadataLoadResult['issue']
  transaction: V8ActivationTransaction | null
  bootstrapMetadata: V8BootstrapMetadata | null
  bootstrapIssue: ReturnType<typeof loadV8BootstrapMetadata>['issue']
  v8OnlyStatus: V8OnlyLoadStatus | null
  /** Granted only after one verified active evidence record and current source checks. */
  writable: boolean
}

export async function checkV8HostWriteEligibility(
  storage: Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'key' | 'length'>>,
  expectedRaw: string | null,
  expectedTransactionId?: string,
): Promise<{ eligible: boolean; transaction: V8ActivationTransaction | null; bootstrap: V8BootstrapMetadata | null }> {
  try {
    const loaded = loadV8Transaction(storage)
    const bootstrap = loadV8BootstrapMetadata(storage)
    const blocked = { eligible: false, transaction: loaded.value, bootstrap: bootstrap.value }
    if (loaded.issue !== 'none' || bootstrap.issue !== 'none'
      || (loaded.raw !== null && bootstrap.raw !== null)
      || storage.getItem(APP_DATA_V9_KEY) !== null || storage.getItem(V9_ACTIVATION_KEY) !== null
      || (typeof storage.length === 'number' && storage.key !== undefined
        && Array.from({ length: storage.length }, (_, index) => storage.key!(index))
          .some((key) => key?.startsWith(V9_BACKUP_PREFIX)))
      || storage.getItem(APP_DATA_V8_ACTIVATION_KEY) !== null
      || storage.getItem(APP_DATA_V8_KEY) !== expectedRaw || expectedRaw === null) return blocked
    parseAppDataV8Raw(expectedRaw)
    const evidence = bootstrap.value ?? loaded.value
    if (!evidence || evidence.status !== 'active'
      || (expectedTransactionId && (bootstrap.value?.attemptId ?? loaded.value?.transactionId) !== expectedTransactionId)
      || await fingerprintV7Raw(expectedRaw) !== evidence.currentDigest) return blocked
    if (bootstrap.value && bootstrap.value.initialDigest !== await fingerprintV7Raw(JSON.stringify(createEmptyAppDataV8()))) return blocked
    const v7 = storage.getItem(APP_DATA_V7_KEY)
    if (bootstrap.value || loaded.value?.source.type === 'empty') {
      if (v7 !== null) return blocked
    } else if (loaded.value?.source.type === 'v7') {
      if (v7 === null || await fingerprintV7Raw(v7) !== loaded.value.source.digest) return blocked
    } else return blocked
    if (loadV8Transaction(storage).raw !== loaded.raw || loadV8BootstrapMetadata(storage).raw !== bootstrap.raw
      || storage.getItem(APP_DATA_V8_KEY) !== expectedRaw || storage.getItem(APP_DATA_V7_KEY) !== v7) return blocked
    return { eligible: true, transaction: loaded.value, bootstrap: bootstrap.value }
  } catch { return { eligible: false, transaction: null, bootstrap: null } }
}

export interface AppDataV8RuntimeControls {
  rawV7: string | null
  rawV8: string | null
  rawBootstrap: string | null
  rawBackup: string | null
  conflictSource: AppDataV8ConflictSource
  errorCode: AppDataV8StorageErrorCode | 'invalid-next' | 'inactive' | 'activation-conflict' | 'lock-unavailable' | null
  exportStoredV7Json: () => string | null
  exportStoredV8Json: () => string | null
  exportStoredBootstrapJson: () => string | null
  exportLocalJson: () => string
  adoptExternalV8: () => void
  retryWrite: () => void
}

interface InitialRuntime {
  load: AppDataV8LoadResult
  activation: V8ActivationMetadataLoadResult
  bootstrap: ReturnType<typeof loadV8BootstrapMetadata>
  status: AppDataV8RuntimeStatus
  v8OnlyStatus: V8OnlyLoadStatus | null
}

export function createInitialAppDataV8(): AppDataV8 {
  return createEmptyAppDataV8()
}

function initialStatus(load: AppDataV8LoadResult): AppDataV8RuntimeStatus {
  if (load.issue === 'migration-failure') return 'migration-blocked'
  if (load.status !== 'saved') return load.status
  if (load.source === 'v8') return 'saved'
  if (load.issue === 'missing') return 'inactive'
  return 'migration-ready'
}

function initialize(initialValue: AppDataV8, loadMode: 'legacy-candidate' | 'v8-only'): InitialRuntime {
  const only = loadMode === 'v8-only' ? loadAppDataV8Only(localStorage, initialValue) : null
  const load: AppDataV8LoadResult = only ? {
    value: only.value, source: only.rawV8 === null ? 'initial' : 'v8',
    status: only.status === 'existing-v8' || only.status === 'bootstrap-active' || only.status === 'fresh' ? 'saved' : 'read-error',
    issue: only.status === 'fresh' ? 'missing' : only.status === 'corrupt-v8' ? 'corrupt'
      : only.status === 'existing-v8' || only.status === 'bootstrap-active' ? 'none' : 'version-conflict',
    raw: only.rawV8, rawBackup: only.rawV8 ?? only.rawV7, shouldPersist: false, legacyGuardRaw: only.rawV7,
  } : loadAppDataV8(localStorage, initialValue)
  const activation = loadV8ActivationMetadata(localStorage)
  const bootstrap = loadV8BootstrapMetadata(localStorage)
  return {
    load,
    activation,
    bootstrap,
    status: activation.issue === 'read-failure' || bootstrap.issue !== 'none'
      || (bootstrap.value !== null && bootstrap.value.status !== 'active') ? 'read-error' : initialStatus(load),
    v8OnlyStatus: only?.status ?? null,
  }
}

/**
 * Standalone R2-A host. It intentionally has no migration activation command:
 * missing V8 data and V7 migration candidates remain read-only until R2-B.
 */
export function useAppDataV8(options: { loadMode?: 'legacy-candidate' | 'v8-only' } = {}) {
  const initialValue = useMemo(createInitialAppDataV8, [])
  const [initial] = useState(() => initialize(initialValue, options.loadMode ?? 'legacy-candidate'))
  const [value, setValueState] = useState(initial.load.value)
  const [status, setStatusState] = useState<AppDataV8RuntimeStatus>(initial.status)
  const [persistence, setPersistence] = useState<AppDataV8Persistence>({
    pending: false,
    revision: 0,
    receipt: null,
  })
  const [rawV7, setRawV7] = useState(initial.load.legacyGuardRaw)
  const [rawV8, setRawV8] = useState(initial.load.raw)
  const [rawBootstrap, setRawBootstrap] = useState(initial.bootstrap.raw)
  const [rawBackup, setRawBackup] = useState(initial.load.rawBackup)
  const [conflictSource, setConflictSource] = useState<AppDataV8ConflictSource>(
    initial.status === 'conflict' ? (initial.load.source === 'v8' ? 'v8' : 'v7') : null,
  )
  const [errorCode, setErrorCode] = useState<AppDataV8RuntimeControls['errorCode']>(null)
  const [writeAttempt, setWriteAttempt] = useState(0)
  const [writable, setWritable] = useState(false)
  const [transaction, setTransaction] = useState<V8ActivationTransaction | null>(null)
  const [bootstrapMetadata, setBootstrapMetadata] = useState<V8BootstrapMetadata | null>(null)

  const valueRef = useRef(value)
  const statusRef = useRef(status)
  const pendingRef = useRef(false)
  const revisionRef = useRef(0)
  const writeBaseRef = useRef(initial.load.value)
  const storedV8RawRef = useRef(initial.load.raw)
  const legacyGuardRawRef = useRef(initial.load.legacyGuardRaw)
  const externalV8RawRef = useRef<string | null>(null)
  const rawV7Ref = useRef(rawV7)
  const rawV8Ref = useRef(rawV8)
  const rawBootstrapRef = useRef(rawBootstrap)
  const writableRef = useRef(false)
  const transactionIdRef = useRef<string | null>(null)
  const activationGenerationRef = useRef(0)

  valueRef.current = value
  statusRef.current = status
  revisionRef.current = persistence.revision
  rawV7Ref.current = rawV7
  rawV8Ref.current = rawV8
  rawBootstrapRef.current = rawBootstrap

  const setStatus = useCallback((next: AppDataV8RuntimeStatus) => {
    statusRef.current = next
    setStatusState(next)
  }, [])

  useEffect(() => {
    if (initial.load.source !== 'v8' || initial.load.status !== 'saved') return
    let cancelled = false
    const generation = activationGenerationRef.current
    void checkV8HostWriteEligibility(localStorage, storedV8RawRef.current).then((result) => {
      if (cancelled || activationGenerationRef.current !== generation) return
      const eligible = result.eligible && typeof navigator !== 'undefined' && !!navigator.locks?.request
      writableRef.current = eligible
      transactionIdRef.current = eligible ? result.bootstrap?.attemptId ?? result.transaction?.transactionId ?? null : null
      setTransaction(result.transaction)
      setBootstrapMetadata(result.bootstrap)
      setWritable(eligible)
      if (!eligible) setErrorCode(result.eligible ? 'lock-unavailable' : 'inactive')
    })
    return () => { cancelled = true }
  }, [initial.load.source, initial.load.status, setStatus])

  const setPending = useCallback((pending: boolean) => {
    pendingRef.current = pending
    setPersistence((current) => ({ ...current, pending }))
  }, [])

  const setData: Dispatch<SetStateAction<AppDataV8>> = useCallback((update) => {
    if (!writableRef.current) {
      setErrorCode('inactive')
      return
    }
    if (statusRef.current !== 'saved') return
    const current = valueRef.current
    const next = typeof update === 'function' ? (update as (current: AppDataV8) => AppDataV8)(current) : update
    if (Object.is(current, next)) return
    if (!isCompatibleAppDataV8(current) || !isCompatibleAppDataV8(next) || !isSafeAppDataV8Update(current, next)) {
      setErrorCode('invalid-next')
      setStatus('write-error')
      return
    }
    if (!pendingRef.current) writeBaseRef.current = current
    pendingRef.current = true
    valueRef.current = next
    setValueState(next)
    setErrorCode(null)
    setPersistence((currentPersistence) => ({ ...currentPersistence, pending: true }))
  }, [setStatus])

  useEffect(() => {
    if (!writableRef.current || !pendingRef.current || statusRef.current !== 'saved') return
    const timer = window.setTimeout(async () => {
      if (!pendingRef.current || statusRef.current !== 'saved') return
      try {
        const result = await withV8StorageLock(async () => {
          const gate = await checkV8HostWriteEligibility(localStorage, storedV8RawRef.current, transactionIdRef.current ?? undefined)
          if (!gate.eligible || (!gate.transaction && !gate.bootstrap)) {
            if (localStorage.getItem(APP_DATA_V7_KEY) !== legacyGuardRawRef.current) {
              throw new AppDataV8StorageError('legacy-conflict', 'V7 source changed before V8 write')
            }
            if (localStorage.getItem(APP_DATA_V8_KEY) !== storedV8RawRef.current) {
              throw new AppDataV8StorageError('stale-document', 'V8 document changed before write')
            }
            throw new Error('activation-conflict')
          }
          const confirmation = persistAppDataV8(localStorage, writeBaseRef.current, valueRef.current, {
            raw: storedV8RawRef.current,
            legacyGuardRaw: legacyGuardRawRef.current,
            revision: revisionRef.current,
          }, revisionRef.current)
          const digest = await fingerprintV7Raw(confirmation.raw)
          const updatedTransaction: V8ActivationTransaction | null = gate.transaction ? {
            ...gate.transaction, currentDigest: digest,
            documentRevision: gate.transaction.documentRevision + 1,
            updatedAt: new Date(Math.max(Date.now(), Date.parse(gate.transaction.updatedAt))).toISOString(),
          } : null
          const updatedBootstrap: V8BootstrapMetadata | null = gate.bootstrap ? {
            ...gate.bootstrap, currentDigest: digest,
            documentRevision: gate.bootstrap.documentRevision + 1,
            updatedAt: new Date(Math.max(Date.now(), Date.parse(gate.bootstrap.updatedAt))).toISOString(),
          } : null
          if (localStorage.getItem(APP_DATA_V7_KEY) !== legacyGuardRawRef.current
            || localStorage.getItem(APP_DATA_V8_KEY) !== confirmation.raw) throw new Error('activation-conflict')
          const metadataKey = updatedBootstrap ? V8_BOOTSTRAP_KEY : V8_TRANSACTION_KEY
          const priorMetadata = gate.bootstrap ?? gate.transaction
          const nextMetadata = updatedBootstrap ?? updatedTransaction
          if (localStorage.getItem(metadataKey) !== JSON.stringify(priorMetadata)) throw new Error('activation-conflict')
          try { localStorage.setItem(metadataKey, JSON.stringify(nextMetadata)) }
          catch (cause) {
            if (updatedBootstrap) throw new Error('activation-conflict')
            throw cause
          }
          if (localStorage.getItem(metadataKey) !== JSON.stringify(nextMetadata)) throw new Error('activation-conflict')
          if (!(await checkV8HostWriteEligibility(localStorage, confirmation.raw,
            gate.bootstrap?.attemptId ?? gate.transaction?.transactionId)).eligible) {
            throw new Error('activation-conflict')
          }
          return { confirmation, updatedTransaction, updatedBootstrap }
        })
        const { confirmation, updatedTransaction, updatedBootstrap } = result
        setTransaction(updatedTransaction)
        setBootstrapMetadata(updatedBootstrap)
        storedV8RawRef.current = confirmation.raw
        rawV8Ref.current = confirmation.raw
        writeBaseRef.current = valueRef.current
        pendingRef.current = false
        revisionRef.current = confirmation.revision
        externalV8RawRef.current = null
        setRawV8(confirmation.raw)
        if (updatedBootstrap) setRawBootstrap(JSON.stringify(updatedBootstrap))
        setRawBackup(null)
        setConflictSource(null)
        setErrorCode(null)
        setPersistence({ pending: false, revision: confirmation.revision, receipt: confirmation })
        setStatus('saved')
      } catch (cause) {
        const stillEligible = await checkV8HostWriteEligibility(
          localStorage, storedV8RawRef.current, transactionIdRef.current ?? undefined,
        )
        if (!stillEligible.eligible) {
          writableRef.current = false
          setWritable(false)
        }
        const code = cause instanceof AppDataV8StorageError ? cause.code
          : cause instanceof Error && (cause.message === 'activation-conflict' || cause.message === 'lock-unavailable')
            ? cause.message : 'write-failure'
        setErrorCode(code)
        if (code === 'activation-conflict' || code === 'lock-unavailable') {
          writableRef.current = false
          setWritable(false)
          setStatus('conflict')
        } else if (code === 'stale-document' || code === 'stale-revision' || code === 'legacy-conflict') {
          writableRef.current = false
          setWritable(false)
          const source = code === 'legacy-conflict' ? 'v7' : 'v8'
          setConflictSource(source)
          try {
            if (source === 'v8') {
              externalV8RawRef.current = localStorage.getItem(APP_DATA_V8_KEY)
              setRawV8(externalV8RawRef.current)
              setRawBackup(externalV8RawRef.current)
            } else {
              const latestV7 = localStorage.getItem(APP_DATA_V7_KEY)
              setRawV7(latestV7)
              setRawBackup(latestV7)
            }
          } catch {
            // Keep the original snapshots available for export.
          }
          setStatus('conflict')
        } else {
          setRawBackup(storedV8RawRef.current)
          setStatus('write-error')
        }
      }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [setStatus, value, writeAttempt])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === V8_TRANSACTION_KEY || event.key === APP_DATA_V8_ACTIVATION_KEY
        || event.key === V8_BOOTSTRAP_KEY || event.key === APP_DATA_V9_KEY
        || event.key === V9_ACTIVATION_KEY || event.key?.startsWith(V9_BACKUP_PREFIX)) {
        if (event.key === V8_BOOTSTRAP_KEY) setRawBootstrap(event.newValue)
        activationGenerationRef.current += 1
        writableRef.current = false
        transactionIdRef.current = null
        setWritable(false)
        setTransaction(null)
        setBootstrapMetadata(null)
        setErrorCode('activation-conflict')
        setStatus('conflict')
        return
      }
      if (event.key === APP_DATA_V7_KEY) {
        setRawV7(event.newValue)
        if (event.newValue === legacyGuardRawRef.current) return
        writableRef.current = false
        setWritable(false)
        setRawBackup(event.newValue)
        setConflictSource('v7')
        setErrorCode('legacy-conflict')
        setStatus('conflict')
        return
      }
      if (event.key !== APP_DATA_V8_KEY || event.newValue === storedV8RawRef.current) return
      activationGenerationRef.current += 1
      writableRef.current = false
      setWritable(false)
      externalV8RawRef.current = event.newValue
      setRawV8(event.newValue)
      if (pendingRef.current || event.newValue === null) {
        setRawBackup(event.newValue)
        setConflictSource('v8')
        setErrorCode('stale-document')
        setStatus('conflict')
        return
      }
      try {
        const external = parseAppDataV8Raw(event.newValue)
        if (!isSafeAppDataV8Update(valueRef.current, external)) throw new Error('Unsafe external V8 update')
        valueRef.current = external
        writeBaseRef.current = external
        storedV8RawRef.current = event.newValue
        externalV8RawRef.current = null
        setValueState(external)
        setRawBackup(null)
        setConflictSource(null)
        setErrorCode(null)
        setStatus('saved')
      } catch {
        setRawBackup(event.newValue)
        setConflictSource('v8')
        setErrorCode('stale-document')
        setStatus('conflict')
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [setStatus])

  const adoptExternalV8 = useCallback(() => {
    const raw = externalV8RawRef.current
    if (raw === null || conflictSource !== 'v8') return
    try {
      const external = parseAppDataV8Raw(raw)
      if (!isSafeAppDataV8Update(writeBaseRef.current, external)) throw new Error('Unsafe external V8 update')
      valueRef.current = external
      writeBaseRef.current = external
      storedV8RawRef.current = raw
      pendingRef.current = false
      externalV8RawRef.current = null
      setValueState(external)
      setPending(false)
      setRawV8(raw)
      setRawBackup(null)
      setConflictSource(null)
      setErrorCode(null)
      setStatus('saved')
    } catch {
      setErrorCode('stale-document')
      setStatus('read-error')
    }
  }, [conflictSource, setPending, setStatus])

  const retryWrite = useCallback(() => {
    if (!writableRef.current || !pendingRef.current || statusRef.current !== 'write-error') return
    setErrorCode(null)
    setStatus('saved')
    setWriteAttempt((current) => current + 1)
  }, [setStatus])

  const controls: AppDataV8RuntimeControls = {
    rawV7,
    rawV8,
    rawBootstrap,
    rawBackup,
    conflictSource,
    errorCode,
    exportStoredV7Json: () => rawV7Ref.current,
    exportStoredV8Json: () => rawV8Ref.current,
    exportStoredBootstrapJson: () => rawBootstrapRef.current,
    exportLocalJson: () => JSON.stringify(valueRef.current),
    adoptExternalV8,
    retryWrite,
  }
  const info: AppDataV8RuntimeInfo = {
    source: initial.load.source,
    loadIssue: initial.load.issue,
    migration: initial.load.migration ?? null,
    migrationFailure: initial.load.migrationFailure ?? null,
    activationMetadata: initial.activation.value,
    activationIssue: initial.activation.issue,
    writable,
    transaction,
    bootstrapMetadata,
    bootstrapIssue: initial.bootstrap.issue,
    v8OnlyStatus: initial.v8OnlyStatus,
  }

  return [value, setData, status, controls, persistence, info] as const
}

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  loadV8ActivationMetadata,
  type V8ActivationMetadata,
  type V8ActivationMetadataLoadResult,
} from '../data/activationV8'
import type { V8MigrationPreflightReport, V8MigrationReconciliationReport } from '../data/migrationPreflightV8'
import {
  APP_DATA_V8_KEY,
  AppDataV8StorageError,
  loadAppDataV8,
  parseAppDataV8Raw,
  persistAppDataV8,
  type AppDataV8LoadIssue,
  type AppDataV8LoadResult,
  type AppDataV8StorageErrorCode,
  type AppDataV8WriteConfirmation,
} from '../data/storageV8'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from '../data/validators/v8'
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
  /** Only a valid document already stored under the V8 key is writable in R2-A. */
  writable: boolean
}

export interface AppDataV8RuntimeControls {
  rawV7: string | null
  rawV8: string | null
  rawBackup: string | null
  conflictSource: AppDataV8ConflictSource
  errorCode: AppDataV8StorageErrorCode | 'invalid-next' | 'inactive' | null
  exportStoredV7Json: () => string | null
  exportStoredV8Json: () => string | null
  exportLocalJson: () => string
  adoptExternalV8: () => void
  retryWrite: () => void
}

interface InitialRuntime {
  load: AppDataV8LoadResult
  activation: V8ActivationMetadataLoadResult
  status: AppDataV8RuntimeStatus
  writable: boolean
}

export function createInitialAppDataV8(): AppDataV8 {
  return {
    schemaVersion: 8,
    activeProjectId: null,
    projects: [],
    timetables: [],
    schools: [],
    teachingUnits: [],
    subjects: [],
    teachingUnitSubjects: [],
    classes: [],
    recurringLessons: [],
    events: [],
    overrides: [],
    oneOffLessons: [],
    teachingProgress: [],
    migrationWarnings: [],
  }
}

function initialStatus(load: AppDataV8LoadResult): AppDataV8RuntimeStatus {
  if (load.issue === 'migration-failure') return 'migration-blocked'
  if (load.status !== 'saved') return load.status
  if (load.source === 'v8') return 'saved'
  if (load.issue === 'missing') return 'inactive'
  return 'migration-ready'
}

function initialize(initialValue: AppDataV8): InitialRuntime {
  const load = loadAppDataV8(localStorage, initialValue)
  const activation = loadV8ActivationMetadata(localStorage)
  return {
    load,
    activation,
    status: activation.issue === 'read-failure' ? 'read-error' : initialStatus(load),
    writable: load.source === 'v8' && load.status === 'saved' && load.issue === 'none',
  }
}

/**
 * Standalone R2-A host. It intentionally has no migration activation command:
 * missing V8 data and V7 migration candidates remain read-only until R2-B.
 */
export function useAppDataV8() {
  const initialValue = useMemo(createInitialAppDataV8, [])
  const [initial] = useState(() => initialize(initialValue))
  const [value, setValueState] = useState(initial.load.value)
  const [status, setStatusState] = useState<AppDataV8RuntimeStatus>(initial.status)
  const [persistence, setPersistence] = useState<AppDataV8Persistence>({
    pending: false,
    revision: 0,
    receipt: null,
  })
  const [rawV7, setRawV7] = useState(initial.load.legacyGuardRaw)
  const [rawV8, setRawV8] = useState(initial.load.raw)
  const [rawBackup, setRawBackup] = useState(initial.load.rawBackup)
  const [conflictSource, setConflictSource] = useState<AppDataV8ConflictSource>(
    initial.status === 'conflict' ? (initial.load.source === 'v8' ? 'v8' : 'v7') : null,
  )
  const [errorCode, setErrorCode] = useState<AppDataV8RuntimeControls['errorCode']>(null)
  const [writeAttempt, setWriteAttempt] = useState(0)

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

  valueRef.current = value
  statusRef.current = status
  revisionRef.current = persistence.revision
  rawV7Ref.current = rawV7
  rawV8Ref.current = rawV8

  const setStatus = useCallback((next: AppDataV8RuntimeStatus) => {
    statusRef.current = next
    setStatusState(next)
  }, [])

  const setPending = useCallback((pending: boolean) => {
    pendingRef.current = pending
    setPersistence((current) => ({ ...current, pending }))
  }, [])

  const setData: Dispatch<SetStateAction<AppDataV8>> = useCallback((update) => {
    if (!initial.writable) {
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
  }, [initial.writable, setStatus])

  useEffect(() => {
    if (!initial.writable || !pendingRef.current || statusRef.current !== 'saved') return
    const timer = window.setTimeout(() => {
      if (!pendingRef.current || statusRef.current !== 'saved') return
      try {
        const confirmation = persistAppDataV8(localStorage, writeBaseRef.current, valueRef.current, {
          raw: storedV8RawRef.current,
          legacyGuardRaw: legacyGuardRawRef.current,
          revision: revisionRef.current,
        }, revisionRef.current)
        storedV8RawRef.current = confirmation.raw
        rawV8Ref.current = confirmation.raw
        writeBaseRef.current = valueRef.current
        pendingRef.current = false
        revisionRef.current = confirmation.revision
        externalV8RawRef.current = null
        setRawV8(confirmation.raw)
        setRawBackup(null)
        setConflictSource(null)
        setErrorCode(null)
        setPersistence({ pending: false, revision: confirmation.revision, receipt: confirmation })
        setStatus('saved')
      } catch (cause) {
        const code = cause instanceof AppDataV8StorageError ? cause.code : 'write-failure'
        setErrorCode(code)
        if (code === 'stale-document' || code === 'stale-revision' || code === 'legacy-conflict') {
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
  }, [initial.writable, setStatus, value, writeAttempt])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === APP_DATA_V7_KEY) {
        setRawV7(event.newValue)
        if (event.newValue === legacyGuardRawRef.current) return
        setRawBackup(event.newValue)
        setConflictSource('v7')
        setErrorCode('legacy-conflict')
        setStatus('conflict')
        return
      }
      if (event.key !== APP_DATA_V8_KEY || event.newValue === storedV8RawRef.current) return
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
    if (!initial.writable || !pendingRef.current || statusRef.current !== 'write-error') return
    setErrorCode(null)
    setStatus('saved')
    setWriteAttempt((current) => current + 1)
  }, [initial.writable, setStatus])

  const controls: AppDataV8RuntimeControls = {
    rawV7,
    rawV8,
    rawBackup,
    conflictSource,
    errorCode,
    exportStoredV7Json: () => rawV7Ref.current,
    exportStoredV8Json: () => rawV8Ref.current,
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
    writable: initial.writable,
  }

  return [value, setData, status, controls, persistence, info] as const
}

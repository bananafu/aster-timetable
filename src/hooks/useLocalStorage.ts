import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

export type StorageStatus = 'saved' | 'read-error' | 'write-error' | 'conflict'

interface LocalStorageOptions<T> {
  migrate?: (value: T) => T
  validate?: (value: unknown) => value is T
}

export interface StorageControls {
  rawBackup: string | null
  acceptExternal: () => void
  keepLocal: () => void
  reset: () => void
}

export interface StorageLoadResult<T> {
  value: T
  status: StorageStatus
  raw: string | null
  shouldPersist: boolean
}

function parseValue<T>(raw: string, options: LocalStorageOptions<T>): T {
  const parsed: unknown = JSON.parse(raw)
  if (options.validate && !options.validate(parsed)) throw new Error('Invalid stored data structure')
  return options.migrate ? options.migrate(parsed as T) : parsed as T
}

export function loadStoredValue<T>(storage: Pick<Storage, 'getItem'>, key: string, initialValue: T, options: LocalStorageOptions<T> = {}): StorageLoadResult<T> {
  let raw: string | null = null
  try {
    raw = storage.getItem(key)
    if (raw === null) return { value: initialValue, status: 'saved', raw: null, shouldPersist: true }
    const value = parseValue(raw, options)
    return { value, status: 'saved', raw, shouldPersist: JSON.stringify(value) !== raw }
  } catch {
    return { value: initialValue, status: 'read-error', raw, shouldPersist: false }
  }
}

export function readStoredValue<T>(storage: Pick<Storage, 'getItem'>, key: string, initialValue: T, migrate?: (value: T) => T): T {
  const result = loadStoredValue(storage, key, initialValue, { migrate })
  if (result.status === 'read-error') throw new Error('Unable to read stored data')
  return result.value
}

export function writeStoredValue<T>(storage: Pick<Storage, 'setItem'>, key: string, value: T): void {
  storage.setItem(key, JSON.stringify(value))
}

export function getExternalUpdateDecision(hasPendingChanges: boolean, currentRaw: string | null, incomingRaw: string | null): 'ignore' | 'sync' | 'conflict' {
  if (incomingRaw === currentRaw) return 'ignore'
  return hasPendingChanges ? 'conflict' : 'sync'
}

export function useLocalStorage<T>(key: string, initialValue: T, options: LocalStorageOptions<T> = {}) {
  const [initialLoad] = useState(() => loadStoredValue(localStorage, key, initialValue, options))
  const [value, setValueState] = useState<T>(initialLoad.value)
  const [status, setStatus] = useState<StorageStatus>(initialLoad.status)
  const [rawBackup, setRawBackup] = useState<string | null>(initialLoad.status === 'read-error' ? initialLoad.raw : null)
  const pendingRef = useRef(initialLoad.shouldPersist)
  const blockedRef = useRef(initialLoad.status !== 'saved')
  const lastStoredRawRef = useRef<string | null>(initialLoad.raw)
  const externalRawRef = useRef<string | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value

  const setValue: Dispatch<SetStateAction<T>> = useCallback((next) => {
    pendingRef.current = true
    setValueState(next)
  }, [])

  const applyRaw = useCallback((raw: string | null) => {
    const nextValue = raw === null ? initialValue : parseValue(raw, options)
    setValueState(nextValue)
    valueRef.current = nextValue
    pendingRef.current = false
    blockedRef.current = false
    lastStoredRawRef.current = raw
    externalRawRef.current = null
    setRawBackup(null)
    setStatus('saved')
  }, [initialValue, options])

  useEffect(() => {
    if (!pendingRef.current || blockedRef.current) return
    const timer = window.setTimeout(() => {
      if (!pendingRef.current || blockedRef.current) return
      try {
        const raw = JSON.stringify(value)
        localStorage.setItem(key, raw)
        lastStoredRawRef.current = raw
        pendingRef.current = false
        setRawBackup(null)
        setStatus('saved')
      } catch {
        blockedRef.current = true
        setRawBackup(lastStoredRawRef.current)
        setStatus('write-error')
      }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [key, value])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) return
      const decision = getExternalUpdateDecision(pendingRef.current, lastStoredRawRef.current, event.newValue)
      if (decision === 'ignore') return
      if (decision === 'conflict') {
        externalRawRef.current = event.newValue
        blockedRef.current = true
        setRawBackup(event.newValue)
        setStatus('conflict')
        return
      }
      try {
        applyRaw(event.newValue)
      } catch {
        externalRawRef.current = event.newValue
        blockedRef.current = true
        setRawBackup(event.newValue)
        setStatus('read-error')
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [applyRaw, key])

  const controls: StorageControls = {
    rawBackup,
    acceptExternal: () => {
      try {
        applyRaw(externalRawRef.current)
      } catch {
        setStatus('read-error')
      }
    },
    keepLocal: () => {
      try {
        const raw = JSON.stringify(valueRef.current)
        localStorage.setItem(key, raw)
        lastStoredRawRef.current = raw
        pendingRef.current = false
        blockedRef.current = false
        externalRawRef.current = null
        setRawBackup(null)
        setStatus('saved')
      } catch {
        blockedRef.current = true
        setStatus('write-error')
      }
    },
    reset: () => {
      try {
        const raw = JSON.stringify(initialValue)
        localStorage.setItem(key, raw)
        setValueState(initialValue)
        valueRef.current = initialValue
        lastStoredRawRef.current = raw
        pendingRef.current = false
        blockedRef.current = false
        externalRawRef.current = null
        setRawBackup(null)
        setStatus('saved')
      } catch {
        blockedRef.current = true
        setStatus('write-error')
      }
    },
  }

  return [value, setValue, status, controls] as const
}

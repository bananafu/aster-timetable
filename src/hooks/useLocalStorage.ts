import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

export type StorageStatus = 'saved' | 'read-error' | 'write-error' | 'conflict'

interface LocalStorageOptions<T> {
  migrate?: (value: T) => T
  validate?: (value: unknown) => value is T
  validateUpdate?: (current: T, next: T) => boolean
  legacy?: { key: string; validate: (value: unknown) => boolean; migrate: (value: unknown) => T }
  loader?: (storage: Pick<Storage, 'getItem'>, key: string, initialValue: T) => StorageLoadResult<T>
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
  rawBackup?: string | null
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
    if (raw === null && options.legacy) {
      const legacyRaw = storage.getItem(options.legacy.key)
      if (legacyRaw !== null) {
        raw = legacyRaw
        const legacyParsed: unknown = JSON.parse(legacyRaw)
        if (!options.legacy.validate(legacyParsed)) throw new Error('Invalid legacy data structure')
        const migrated = options.legacy.migrate(legacyParsed)
        if (options.validate && !options.validate(migrated)) throw new Error('Invalid migrated data structure')
        return { value: migrated, status: 'saved', raw: null, shouldPersist: true }
      }
    }
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
  const [initialLoad] = useState(() => options.loader ? options.loader(localStorage, key, initialValue) : loadStoredValue(localStorage, key, initialValue, options))
  const [value, setValueState] = useState<T>(initialLoad.value)
  const [status, setStatus] = useState<StorageStatus>(initialLoad.status)
  const [rawBackup, setRawBackup] = useState<string | null>(initialLoad.rawBackup ?? (initialLoad.status === 'read-error' ? initialLoad.raw : null))
  const pendingRef = useRef(initialLoad.shouldPersist)
  const pendingBaseRef = useRef(initialLoad.value)
  const blockedRef = useRef(initialLoad.status !== 'saved')
  const lastStoredRawRef = useRef<string | null>(initialLoad.raw)
  const externalRawRef = useRef<string | null>(null)
  const valueRef = useRef(value)
  const validateRef = useRef(options.validate)
  const validateUpdateRef = useRef(options.validateUpdate)
  valueRef.current = value
  validateRef.current = options.validate
  validateUpdateRef.current = options.validateUpdate

  const setValue: Dispatch<SetStateAction<T>> = useCallback((next) => {
    setValueState((current) => {
      const resolved = typeof next === 'function' ? (next as (value: T) => T)(current) : next
      if ((validateRef.current && !validateRef.current(resolved)) || (validateUpdateRef.current && !validateUpdateRef.current(current, resolved))) {
        blockedRef.current = true
        setStatus('write-error')
        return current
      }
      if (!pendingRef.current) pendingBaseRef.current = current
      pendingRef.current = true
      valueRef.current = resolved
      return resolved
    })
  }, [])

  const applyRaw = useCallback((raw: string | null) => {
    const nextValue = raw === null ? initialValue : parseValue(raw, options)
    if (validateUpdateRef.current && !validateUpdateRef.current(valueRef.current, nextValue)) throw new Error('Unsafe external data update')
    setValueState(nextValue)
    valueRef.current = nextValue
    pendingRef.current = false
    pendingBaseRef.current = nextValue
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
        if (validateRef.current && !validateRef.current(value)) throw new Error('Invalid data structure')
        if (validateUpdateRef.current && !validateUpdateRef.current(pendingBaseRef.current, value)) throw new Error('Unsafe pending data update')
        const raw = JSON.stringify(value)
        localStorage.setItem(key, raw)
        lastStoredRawRef.current = raw
        pendingRef.current = false
        pendingBaseRef.current = value
        setRawBackup(null)
        setStatus('saved')
      } catch {
        blockedRef.current = true
        setRawBackup((current) => current ?? lastStoredRawRef.current)
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
        if (options.validate && !options.validate(valueRef.current)) throw new Error('Invalid data structure')
        if (options.validateUpdate && !options.validateUpdate(pendingBaseRef.current, valueRef.current)) throw new Error('Unsafe pending data update')
        const raw = JSON.stringify(valueRef.current)
        localStorage.setItem(key, raw)
        lastStoredRawRef.current = raw
        pendingRef.current = false
        pendingBaseRef.current = valueRef.current
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
        if (options.validate && !options.validate(initialValue)) throw new Error('Invalid initial data structure')
        const raw = JSON.stringify(initialValue)
        localStorage.setItem(key, raw)
        setValueState(initialValue)
        valueRef.current = initialValue
        lastStoredRawRef.current = raw
        pendingRef.current = false
        pendingBaseRef.current = initialValue
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

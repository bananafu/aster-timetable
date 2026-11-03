import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import App from './App'
import { FormalV9RecoveryPage } from './components/FormalV9RecoveryPage'
import { Modal } from './components/Modal'
import { initializeFreshV9, preflightFreshV9, type FreshV9Failure } from './data/initializeFreshV9'
import { TOKI_LEGACY_DATA_KEYS } from './data/storageV8'
import { FormalV9Composition } from './FormalV9Composition'
import { createFormalV9RecoveryCoordinator, type FormalV9RecoveryActionResult,
  type FormalV9RecoverySnapshot } from './formalV9Recovery'
import { hasActiveFormalV9Structure, inspectFormalRuntime, isV9RuntimeStorageKey,
  type FormalRuntimeDecision } from './formalRuntime'

const LocalPreview = import.meta.env.DEV
  ? lazy(() => import('./V9LocalPreview').then((module) => ({ default: module.V9LocalPreview }))) : null

const isLocalV9PreviewHost = (development: boolean, hostname: string) =>
  development && (hostname === 'localhost' || hostname === '127.0.0.1')

type FormalEntryState = { kind: 'checking' | 'cancelled' }
  | { kind: 'fresh'; pending: boolean; error: string | null }
  | { kind: 'recovery'; snapshot: FormalV9RecoverySnapshot; error: string | null }
  | { kind: 'runtime'; decision: FormalRuntimeDecision }

const blocked = (): FormalEntryState => ({ kind: 'runtime',
  decision: { runtime: 'blocked-v9', v9Status: 'unknown-evidence' } })

/** The existing V7 App may mount only for its recognized legacy data keys. */
function hasOnlyLegacyEvidence(storage: Storage): boolean {
  try {
    const legacy = new Set<string>(TOKI_LEGACY_DATA_KEYS)
    if (![...legacy].some((key) => storage.getItem(key) !== null)) return false
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key === null || ((key.startsWith('aster-timetable-') || key.startsWith('toki-v9-'))
        && !legacy.has(key))) return false
    }
    return true
  } catch { return false }
}

function freshError(code: FreshV9Failure): string {
  if (code === 'existing-evidence' || code === 'source-changed') return '資料狀態已變更，無法建立空白工作環境。'
  if (code === 'read-error') return '無法讀取儲存資料，初始化已停止。'
  if (code === 'lock-unavailable') return '無法取得資料鎖，初始化已停止。'
  if (code === 'backup-failed' || code === 'digest-failed') return '備份驗證失敗，初始化已停止。'
  if (code === 'preparing-failed') return '初始化狀態寫入失敗，工作環境未啟用。'
  if (code === 'document-failed') return '工作環境寫入失敗，初始化未完成。'
  if (code === 'active-failed') return '正式啟用驗證失敗，工作環境未啟用。'
  if (code === 'invalid-candidate') return '空白工作環境驗證失敗，初始化已停止。'
  return '初始化驗證失敗，工作環境未啟用。'
}

function recoveryError(result: Extract<FormalV9RecoveryActionResult, { ok: false }>): string {
  if (result.code === 'snapshot-stale') return '資料快照已變更，舊操作已停用。請重新檢查資料與確認。'
  if (result.code === 'runtime-blocked') return `復原已執行，但正式驗證仍阻擋：${result.runtimeDecision?.v9Status ?? 'unknown'}。`
  if (result.code === 'service-failed') return `復原中止：${result.serviceCode ?? 'service-failed'}。原始資料仍保留。`
  if (result.code === 'invalid-decisions') return '科目或任教配置決策不完整，未執行轉換。'
  if (result.code === 'export-evidence-mismatch') return '匯出資料與目前快照不符，未執行轉換。'
  return '目前沒有可安全執行的操作。'
}

// Exported only so the DEV/production environment matrix can be verified without mutating window.location.
// eslint-disable-next-line react-refresh/only-export-components
export function selectDevRuntimeEntry(development: boolean, hostname: string, search: string): 'formal' | 'preview' {
  if (!isLocalV9PreviewHost(development, hostname)) return 'formal'
  const runtimes = new URLSearchParams(search).getAll('runtime')
  return runtimes.length === 1 && runtimes[0] === 'formal' ? 'formal' : 'preview'
}

export function FormalAppEntry() {
  const [state, setState] = useState<FormalEntryState>({ kind: 'checking' })
  const stateRef = useRef(state)
  const pendingRef = useRef(false)
  const refreshEpochRef = useRef(0)
  const coordinatorRef = useRef<ReturnType<typeof createFormalV9RecoveryCoordinator> | null>(null)
  if (!coordinatorRef.current) coordinatorRef.current = createFormalV9RecoveryCoordinator(localStorage)
  const coordinator = coordinatorRef.current
  stateRef.current = state
  const commitRef = useRef<(next: FormalEntryState) => void>(() => undefined)
  useEffect(() => {
    let generation = 0
    let mounted = true
    const commit = (next: FormalEntryState) => {
      if (!mounted) return
      stateRef.current = next
      setState(next)
    }
    commitRef.current = commit
    const inspectInitial = async () => {
      const currentGeneration = ++generation
      const preflight = preflightFreshV9(localStorage)
      if (preflight.eligible) {
        if (mounted && currentGeneration === generation) commit({ kind: 'fresh', pending: false, error: null })
        return
      }
      const next = preflight.issue === 'read-error' ? null : await inspectFormalRuntime(localStorage)
      if (next?.runtime === 'v7' && hasOnlyLegacyEvidence(localStorage)) {
        if (mounted && currentGeneration === generation) commit({ kind: 'runtime', decision: next })
        return
      }
      const recovery = await coordinator.inspect()
      if (next?.runtime === 'v9' && recovery.kind !== 'ambiguous' && recovery.kind !== 'read-error') {
        if (mounted && currentGeneration === generation) commit({ kind: 'runtime', decision: next })
        return
      }
      if (mounted && currentGeneration === generation) commit({ kind: 'recovery', snapshot: recovery, error: null })
    }
    void inspectInitial()
    const inspect = (event: StorageEvent) => {
      const current = stateRef.current
      if (current.kind === 'cancelled') return
      if (current.kind === 'fresh') {
        if (event.key !== null && !event.key.startsWith('aster-timetable-')
          && !event.key.startsWith('toki-v9-')) return
        generation += 1
        commit(blocked())
        return
      }
      if (current.kind === 'runtime' && current.decision.runtime === 'v7') {
        if (event.key !== null && !isV9RuntimeStorageKey(event.key)
          && (TOKI_LEGACY_DATA_KEYS as readonly string[]).includes(event.key)) return
        if (event.key !== null && !event.key.startsWith('aster-timetable-')
          && !event.key.startsWith('toki-v9-')) return
        generation += 1
        commit(blocked())
        return
      }
      if (event.key !== null && !event.key.startsWith('aster-timetable-')
        && !event.key.startsWith('toki-v9-')) return
      refreshEpochRef.current += 1
      generation += 1
      if (current.kind === 'recovery') {
        coordinator.invalidate(current.snapshot)
        commit({ kind: 'checking' })
        void inspectInitial()
        return
      }
      if (current.kind === 'runtime' && current.decision.runtime === 'v9') {
        if (isV9RuntimeStorageKey(event.key) && !hasActiveFormalV9Structure(localStorage)) {
          commit({ kind: 'runtime', decision: { runtime: 'blocked-v9', v9Status: 'invalid-evidence' } })
        }
        return
      }
      if (current.kind === 'runtime' && current.decision.runtime === 'blocked-v9') return
      void inspectInitial()
    }
    window.addEventListener('storage', inspect)
    return () => { mounted = false; generation += 1; window.removeEventListener('storage', inspect) }
  }, [coordinator])
  const cancelFresh = () => {
    if (!pendingRef.current) commitRef.current({ kind: 'cancelled' })
  }
  const confirmFresh = async () => {
    if (pendingRef.current || stateRef.current.kind !== 'fresh' || stateRef.current.error) return
    pendingRef.current = true
    commitRef.current({ kind: 'fresh', pending: true, error: null })
    try {
      const result = await initializeFreshV9(localStorage,
        { attemptId: crypto.randomUUID(), createdAt: new Date().toISOString() })
      if (stateRef.current.kind !== 'fresh') return
      if (!result.ok) {
        commitRef.current({ kind: 'fresh', pending: false, error: freshError(result.code) })
        return
      }
      const verified = await inspectFormalRuntime(localStorage)
      if (stateRef.current.kind === 'fresh') commitRef.current({ kind: 'runtime', decision: verified.runtime === 'v9'
        ? verified : { runtime: 'blocked-v9', v9Status: 'invalid-evidence' } })
    } catch {
      if (stateRef.current.kind === 'fresh') commitRef.current({ kind: 'fresh', pending: false,
        error: '初始化驗證失敗，工作環境未啟用。' })
    } finally { pendingRef.current = false }
  }
  const handleRecoveryResult = async (result: FormalV9RecoveryActionResult) => {
    const current = stateRef.current
    if (current.kind !== 'recovery') return
    if (result.ok) {
      commitRef.current({ kind: 'runtime', decision: result.runtimeDecision })
      return
    }
    coordinator.invalidate(current.snapshot)
    const refreshEpoch = ++refreshEpochRef.current
    commitRef.current({ kind: 'checking' })
    const updated = await coordinator.inspect()
    if (stateRef.current.kind === 'checking' && refreshEpochRef.current === refreshEpoch) {
      commitRef.current({ kind: 'recovery', snapshot: updated,
      error: recoveryError(result) })
    }
  }
  if (state.kind === 'runtime' && state.decision.runtime === 'v7') return <App />
  if (state.kind === 'runtime' && state.decision.runtime === 'v9') return <FormalV9Composition />
  if (state.kind === 'recovery') return <FormalV9RecoveryPage key={state.snapshot.evidenceIdentity ?? 'read-error'}
    snapshot={state.snapshot} coordinator={coordinator} error={state.error}
    onResult={(result) => { void handleRecoveryResult(result) }} />
  if (state.kind === 'fresh') return <Modal title="開始使用 Toki" onClose={cancelFresh}>
    <div className="form-grid">
      <p className="full">目前沒有既有資料。確認後將建立全新的空白工作環境。</p>
      {state.error && <p className="form-error full" role="alert">{state.error}</p>}
      <div className="form-actions full"><button type="button" disabled={state.pending} onClick={cancelFresh}>取消</button>
        <button type="button" className="primary-button" disabled={state.pending || !!state.error}
          onClick={() => { void confirmFresh() }}>建立</button></div>
    </div>
  </Modal>
  return null
}

/** The production entry never offers or renders the development-only runtime. */
export function DevAppEntry() {
  const runtime = selectDevRuntimeEntry(import.meta.env.DEV, window.location.hostname, window.location.search)
  if (runtime === 'formal' || !LocalPreview) {
    return <FormalAppEntry />
  }
  return <Suspense fallback={null}><LocalPreview /></Suspense>
}

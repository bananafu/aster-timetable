import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import App from './App'
import { FormalV9Composition } from './FormalV9Composition'
import { hasActiveFormalV9Structure, inspectFormalRuntime, isV9RuntimeStorageKey,
  type FormalRuntimeDecision } from './formalRuntime'

const LocalPreview = import.meta.env.DEV
  ? lazy(() => import('./V9LocalPreview').then((module) => ({ default: module.V9LocalPreview }))) : null

const isLocalV9PreviewHost = (development: boolean, hostname: string) =>
  development && (hostname === 'localhost' || hostname === '127.0.0.1')

// Exported only so the DEV/production environment matrix can be verified without mutating window.location.
// eslint-disable-next-line react-refresh/only-export-components
export function selectDevRuntimeEntry(development: boolean, hostname: string, search: string): 'formal' | 'preview' {
  if (!isLocalV9PreviewHost(development, hostname)) return 'formal'
  const runtimes = new URLSearchParams(search).getAll('runtime')
  return runtimes.length === 1 && runtimes[0] === 'formal' ? 'formal' : 'preview'
}

export function FormalAppEntry() {
  const [runtime, setRuntime] = useState<FormalRuntimeDecision | null>(null)
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  useEffect(() => {
    let generation = 0
    let mounted = true
    const commit = (next: FormalRuntimeDecision) => {
      if (!mounted) return
      runtimeRef.current = next
      setRuntime(next)
    }
    const inspectInitial = async () => {
      const currentGeneration = ++generation
      const next = await inspectFormalRuntime(localStorage)
      if (mounted && currentGeneration === generation) commit(next)
    }
    void inspectInitial()
    const inspect = (event: StorageEvent) => {
      if (!isV9RuntimeStorageKey(event.key)) return
      generation += 1
      const current = runtimeRef.current
      if (current?.runtime === 'v7') {
        commit({ runtime: 'blocked-v9', v9Status: 'unknown-evidence' })
        return
      }
      if (current?.runtime === 'v9') {
        if (!hasActiveFormalV9Structure(localStorage)) {
          commit({ runtime: 'blocked-v9', v9Status: 'invalid-evidence' })
        }
        return
      }
      if (current?.runtime === 'blocked-v9') return
      void inspectInitial()
    }
    window.addEventListener('storage', inspect)
    return () => { mounted = false; generation += 1; window.removeEventListener('storage', inspect) }
  }, [])
  if (runtime?.runtime === 'v7') return <App />
  if (runtime?.runtime === 'v9') return <FormalV9Composition />
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

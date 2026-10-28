import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import App from './App'
import { FormalV9Composition } from './FormalV9Composition'
import { hasActiveFormalV9Structure, inspectFormalRuntime, isV9RuntimeStorageKey,
  type FormalRuntimeDecision } from './formalRuntime'
import { V8_PREVIEW_HASH, isV8PreviewRoute } from './previewRoute'

const Preview = import.meta.env.DEV
  ? lazy(() => import('./V8PreviewApp').then((module) => ({ default: module.V8PreviewApp }))) : null

function FormalAppEntry() {
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
  const [preview, setPreview] = useState(() => isV8PreviewRoute(import.meta.env.DEV, window.location.hash))
  useEffect(() => {
    const route = () => setPreview(isV8PreviewRoute(import.meta.env.DEV, window.location.hash))
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])
  if (!import.meta.env.DEV) return <FormalAppEntry />
  return preview && Preview ? <Suspense fallback={<div role="status">正在載入 V8 開發預覽…</div>}><Preview onReturn={() => { window.location.hash = '' }} /></Suspense>
    : <><FormalAppEntry /><a className="v8-preview-link" href={V8_PREVIEW_HASH}>開啟 V8 開發預覽</a></>
}

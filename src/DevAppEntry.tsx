import { lazy, Suspense, useEffect, useState } from 'react'
import App from './App'
import { V8_PREVIEW_HASH, isV8PreviewRoute } from './previewRoute'

const Preview = import.meta.env.DEV
  ? lazy(() => import('./V8PreviewApp').then((module) => ({ default: module.V8PreviewApp }))) : null

/** The production entry never offers or renders the development-only runtime. */
export function DevAppEntry() {
  const [preview, setPreview] = useState(() => isV8PreviewRoute(import.meta.env.DEV, window.location.hash))
  useEffect(() => {
    const route = () => setPreview(isV8PreviewRoute(import.meta.env.DEV, window.location.hash))
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])
  if (!import.meta.env.DEV) return <App />
  return preview && Preview ? <Suspense fallback={<div role="status">正在載入 V8 開發預覽…</div>}><Preview onReturn={() => { window.location.hash = '' }} /></Suspense>
    : <><App /><a className="v8-preview-link" href={V8_PREVIEW_HASH}>開啟 V8 開發預覽</a></>
}

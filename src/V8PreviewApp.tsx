import { useEffect, useState } from 'react'
import { bootstrapEmptyV8, preflightEmptyV8Bootstrap } from './data/bootstrapV8'
import { createEmptyAppDataV8, loadAppDataV8Only, type V8OnlyLoadResult } from './data/storageV8'
import { useAppDataV8 } from './hooks/useAppDataV8'
import { ProjectLifecycleV8 } from './components/ProjectLifecycleV8'

type Page = 'overview' | 'resources' | 'timetables' | 'lessons' | 'settings'
const pages: { id: Page; label: string }[] = [
  { id: 'overview', label: '總覽' }, { id: 'resources', label: '教學資源' },
  { id: 'timetables', label: '教師課表' }, { id: 'lessons', label: '課程管理' },
  { id: 'settings', label: '設定' },
]
const inspect = () => loadAppDataV8Only(localStorage, createEmptyAppDataV8())

function downloadJson(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function V8PreviewApp({ onReturn }: { onReturn: () => void }) {
  const [inspection, setInspection] = useState<V8OnlyLoadResult>(inspect)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState(0)
  const returnToV7 = () => {
    if (inspection.rawV7 === null && !window.confirm('返回 V7 可能在此儲存空間建立 V7 key；之後 V8 為保護資料將停止寫入。仍要返回？')) return
    onReturn()
  }
  useEffect(() => {
    const refresh = () => setInspection(inspect())
    window.addEventListener('storage', refresh)
    return () => window.removeEventListener('storage', refresh)
  }, [])
  const initialize = async () => {
    if (bootstrapping || !window.confirm('建立全新空白 V8 資料？此操作不會遷移或刪除 V7 資料。')) return
    setBootstrapping(true)
    setError('')
    const result = await bootstrapEmptyV8(localStorage, { attemptId: crypto.randomUUID() })
    setInspection(inspect())
    if (result.ok) setSession((value) => value + 1)
    else setError(`初始化未完成：${result.code}。請保留原始資料供人工檢查。`)
    setBootstrapping(false)
  }
  const preflight = inspection.status === 'fresh' ? preflightEmptyV8Bootstrap(localStorage) : null
  const canLoadHost = inspection.rawV8 !== null && inspection.status !== 'corrupt-v8'
  return <div className="app-shell v8-preview-shell">
    {canLoadHost ? <V8Workspace key={session} onReturn={returnToV7} /> : <>
      <aside className="sidebar"><div className="brand"><strong>Toki</strong><span>・V8 開發預覽</span></div></aside>
      <main className="main-area"><header className="topbar"><strong>V8 開發預覽</strong><button onClick={returnToV7}>返回 V7</button></header>
        <div className="content"><section className="panel v8-preview-panel">
          <h1>{inspection.status === 'fresh' ? '建立空白 V8 工作空間' : 'V8 尚無法啟用'}</h1>
          <p>狀態：{inspection.status}。不會自動遷移、覆寫或清除任何既有資料。</p>
          {inspection.legacyKeys.length > 0 && <p role="alert">偵測到舊版 Toki 資料：{inspection.legacyKeys.join('、')}。請返回 V7；空白 V8 初始化已阻擋。</p>}
          {preflight?.issues.includes('web-locks-unavailable') && <p role="alert">瀏覽器不支援 Web Locks，禁止初始化及 V8 寫入。</p>}
          {inspection.status === 'fresh' && <button className="primary-button" disabled={!preflight?.canBootstrap || bootstrapping} onClick={initialize}>確認建立空白 V8</button>}
          {bootstrapping && <p role="status">正在驗證 V8 寫入…</p>}
          {error && <p role="alert" className="form-error">{error}</p>}
          {inspection.rawV8 !== null && <button onClick={() => downloadJson(inspection.rawV8!, 'toki-v8-recovery.json')}>匯出原始 V8 JSON</button>}
          {inspection.rawBootstrap !== null && <button onClick={() => downloadJson(inspection.rawBootstrap!, 'toki-v8-bootstrap-recovery.json')}>匯出啟用紀錄 JSON</button>}
        </section></div></main>
    </>}
  </div>
}

function V8Workspace({ onReturn }: { onReturn: () => void }) {
  const [data, setData, status, controls, persistence, info] = useAppDataV8({ loadMode: 'v8-only' })
  const [page, setPage] = useState<Page>('overview')
  const [projectOpen, setProjectOpen] = useState(false)
  const project = data.projects.find((item) => item.id === data.activeProjectId)
  const canWrite = status === 'saved' && info.writable && !persistence.pending
  return <>
    <aside className="sidebar"><div className="brand"><strong>Toki</strong><span>・V8 開發預覽</span></div>
      <div className="project-switcher">課表專案<strong>{project?.name ?? '尚未選擇專案'}</strong><button onClick={() => setProjectOpen(true)}>切換或管理專案</button></div><nav className="side-nav" aria-label="V8 導覽"><p className="nav-label">工作空間</p>
        {pages.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}>{item.label}</button>)}
        <button onClick={() => setProjectOpen(true)}>專案管理</button></nav>
      <div className="sidebar-bottom"><div className={`storage-status ${status}`} role="status">V8：{canWrite ? '可寫入' : '唯讀／待確認'}・{status}</div></div>
    </aside>
    <main className="main-area"><header className="topbar"><strong>V8 開發預覽</strong><button onClick={onReturn}>返回 V7</button></header>
      <div className="content"><section className="page-heading"><div><p className="eyebrow">Toki / V8</p><h1>{pages.find((item) => item.id === page)?.label}</h1></div></section>
        {!canWrite && <section className="panel v8-preview-panel" role="alert"><h2>唯讀／恢復狀態</h2><p>狀態：{status}；原因：{controls.errorCode ?? info.v8OnlyStatus ?? 'activation gate'}。任何寫入都已阻擋。</p>
          <button onClick={() => downloadJson(controls.exportLocalJson(), 'toki-v8-local-draft.json')}>匯出本頁資料</button>
          {controls.exportStoredV8Json() !== null && <button onClick={() => downloadJson(controls.exportStoredV8Json()!, 'toki-v8-stored.json')}>匯出原始 V8 JSON</button>}
          {status === 'conflict' && <button onClick={controls.adoptExternalV8}>採用外部分頁版本</button>}
          {status === 'write-error' && <button onClick={controls.retryWrite}>重試寫入</button>}
        </section>}
        {page === 'overview' ? <section className="panel v8-preview-panel"><h2>{project?.name ?? '尚無課表專案'}</h2>
          <p>{project ? `學年度 ${project.term.academicYear}；目前有 ${data.timetables.filter((item) => item.projectId === project.id).length} 份教師課表。` : '先建立空白 Project；不會自動建立科目、班級、教師課表或課程。'}</p>
          <button className="primary-button" onClick={() => setProjectOpen(true)}>管理專案</button></section>
          : <section className="panel v8-preview-panel"><h2>{pages.find((item) => item.id === page)?.label}</h2><p>開發中；D1 尚未接入此頁面的 V8 操作。</p></section>}
      </div>
    </main>
    {projectOpen && <ProjectLifecycleV8 data={data} setData={setData} status={status} persistence={persistence}
      info={info} controls={controls} onClose={() => setProjectOpen(false)}
      onExport={(raw) => downloadJson(raw, 'toki-v8-project-draft.json')} />}
  </>
}

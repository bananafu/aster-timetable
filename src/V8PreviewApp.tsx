import { useCallback, useEffect, useState } from 'react'
import { bootstrapEmptyV8, preflightEmptyV8Bootstrap } from './data/bootstrapV8'
import { createEmptyAppDataV8, loadAppDataV8Only, type V8OnlyLoadResult } from './data/storageV8'
import { useAppDataV8 } from './hooks/useAppDataV8'
import { ProjectLifecycleV8 } from './components/ProjectLifecycleV8'
import { TimetableManagerV8 } from './components/TimetableManagerV8'
import { V8SubjectClassManager } from './components/V8SubjectClassManager'
import { AcademicSettingsV8 } from './components/AcademicSettingsV8'
import { reconcileTimetableSelectionV8 } from './data/timetableSelectionV8'
import { inspectSubjectMigrationV9 } from './data/subjectMigrationPlanV9'
import { loadAppDataV9, V9_BACKUP_PREFIX } from './data/storageV9'
import { resumeOrphanedSubjectUpgradeV9 } from './data/activateSubjectV9'
import { SubjectUpgradeV9 } from './components/SubjectUpgradeV9'
import { TeacherSubjectWorkspaceV9 } from './components/TeacherSubjectWorkspaceV9'
import { PreviewProjectSwitcher } from './components/PreviewProjectSwitcher'
import { TimetableSwitcher } from './components/TimetableControls'
import { PreviewSidebar, PreviewTopbar, type PreviewNavItem } from './components/PreviewShellNavigation'
import { switchActiveProject } from './data/projectRuntimeV8'
import { CalendarDays, GraduationCap, LayoutDashboard, LibraryBig, Settings } from 'lucide-react'
import { previewReadOnlyMessage } from './previewReadOnlyV8'

type Page = 'overview' | 'resources' | 'timetables' | 'lessons' | 'settings'
const pages: (PreviewNavItem & { id: Page })[] = [
  { id: 'overview', label: '總覽', icon: LayoutDashboard }, { id: 'resources', label: '科目與班級', icon: LibraryBig },
  { id: 'timetables', label: '教師課表', icon: GraduationCap }, { id: 'lessons', label: '課程管理', icon: CalendarDays },
  { id: 'settings', label: '設定', icon: Settings },
]
const inspect = () => loadAppDataV8Only(localStorage, createEmptyAppDataV8())
const inspectionMessage = (status: V8OnlyLoadResult['status']) => status === 'legacy-v7-present'
  ? '偵測到舊版 Toki 資料。為保護原始內容，無法建立空白 V8；請返回舊版或先使用受控的開發清理流程。'
  : status === 'corrupt-v8' ? '既有 V8 資料無法通過驗證。請先匯出原始 JSON，暫勿重新初始化。'
    : status === 'fresh' ? '目前沒有 V8 文件；確認後才會建立全新空白工作空間。'
      : '目前資料或啟用紀錄需要人工檢查，系統不會自動覆寫或清除。'
const orphanedSubjectBackups = () => {
  try {
    return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key !== null && key.startsWith(V9_BACKUP_PREFIX))
  } catch { return [] }
}

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
  const [v9Inspection, setV9Inspection] = useState(() => loadAppDataV9(localStorage))
  const [orphanBackups, setOrphanBackups] = useState(orphanedSubjectBackups)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const returnToV7 = () => {
    if (inspection.rawV7 === null && !window.confirm('返回 V7 可能在此儲存空間建立 V7 key；之後 V8 為保護資料將停止寫入。仍要返回？')) return
    onReturn()
  }
  useEffect(() => {
    const refresh = () => { setInspection(inspect()); setV9Inspection(loadAppDataV9(localStorage));
      setOrphanBackups(orphanedSubjectBackups()) }
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
  const resumeOrphan = async (key: string) => {
    if (!window.confirm('確認使用此備份的原候選文件續接中斷轉換？若 V8 來源已變更，會安全阻擋。')) return
    setError('')
    const result = await resumeOrphanedSubjectUpgradeV9(localStorage, key.slice(V9_BACKUP_PREFIX.length))
    if (result.ok) { setV9Inspection(loadAppDataV9(localStorage)); setSession((value) => value + 1) }
    else setError(`無法續接：${result.code}。請保留並匯出備份及原始資料供人工檢查。`)
  }
  return <div className={`app-shell v8-preview-shell ${sidebarCollapsed && (v9Inspection.status !== 'absent' || canLoadHost && !orphanBackups.length) ? 'sidebar-is-collapsed' : ''}`}>
    {v9Inspection.status !== 'absent' ? <TeacherSubjectWorkspaceV9 key={session} onReturn={returnToV7}
      sidebarCollapsed={sidebarCollapsed} onSidebarCollapsedChange={setSidebarCollapsed}
      onRecovered={() => { setV9Inspection(loadAppDataV9(localStorage)); setSession((value) => value + 1) }} />
      : orphanBackups.length ? <><aside className="sidebar"><div className="brand"><strong>Toki</strong><span>・V8 開發預覽</span></div></aside>
        <main className="main-area"><header className="topbar"><strong>科目庫轉換恢復</strong><button onClick={returnToV7}>返回 V7</button></header>
          <div className="content"><section className="panel v8-preview-panel"><h1>發現未完成的備份階段</h1>
            <p role="alert">已暫停 V8 寫入，原始資料未自動刪除或覆寫。請先匯出備份，再明確選擇續接。</p>
            {orphanBackups.map((key) => <div key={key} className="v8-preview-recovery-row"><code>{key}</code><div className="v8-preview-actions">
              <button onClick={() => { const raw = localStorage.getItem(key); if (raw) downloadJson(raw, 'toki-v8-orphan-backup.json') }}>匯出備份</button>
              <button disabled={orphanBackups.length !== 1} onClick={() => void resumeOrphan(key)}>確認續接此備份</button></div></div>)}
            {orphanBackups.length !== 1 && <p role="alert">存在多筆未完成備份，不能自動判斷正確來源；請匯出後人工處理。</p>}
            {inspection.rawV8 && <button onClick={() => downloadJson(inspection.rawV8!, 'toki-v8-source.json')}>匯出原始 V8 JSON</button>}
            {error && <p role="alert" className="form-error">{error}</p>}
          </section></div></main></>
      : canLoadHost ? <V8Workspace key={session} onReturn={returnToV7}
        sidebarCollapsed={sidebarCollapsed} onSidebarCollapsedChange={setSidebarCollapsed}
        onV9Activated={() => { setV9Inspection(loadAppDataV9(localStorage)); setSession((value) => value + 1) }}
        onV9StorageChanged={() => { setV9Inspection(loadAppDataV9(localStorage));
          setOrphanBackups(orphanedSubjectBackups()); setSession((value) => value + 1) }} /> : <>
      <aside className="sidebar"><div className="brand"><strong>Toki</strong><span>・V8 開發預覽</span></div></aside>
      <main className="main-area"><header className="topbar"><strong>V8 開發預覽</strong><button onClick={returnToV7}>返回 V7</button></header>
        <div className="content"><section className="panel v8-preview-panel">
          <h1>{inspection.status === 'fresh' ? '建立空白 V8 工作空間' : 'V8 尚無法啟用'}</h1>
          <p>{inspectionMessage(inspection.status)}</p><details className="v8-preview-advanced"><summary>診斷資訊</summary><code>{inspection.status}</code></details>
          {inspection.legacyKeys.length > 0 && <p role="alert">偵測到舊版 Toki 資料：{inspection.legacyKeys.join('、')}。請返回 V7；空白 V8 初始化已阻擋。</p>}
          {preflight?.issues.includes('web-locks-unavailable') && <p role="alert">瀏覽器不支援 Web Locks，禁止初始化及 V8 寫入。</p>}
          {inspection.status === 'fresh' && <div className="v8-preview-actions"><button className="primary-button" disabled={!preflight?.canBootstrap || bootstrapping} onClick={initialize}>確認建立空白 V8</button></div>}
          {bootstrapping && <p role="status">正在驗證 V8 寫入…</p>}
          {error && <p role="alert" className="form-error">{error}</p>}
          <div className="v8-preview-actions">{inspection.rawV8 !== null && <button onClick={() => downloadJson(inspection.rawV8!, 'toki-v8-recovery.json')}>匯出原始 V8 JSON</button>}
          {inspection.rawBootstrap !== null && <button onClick={() => downloadJson(inspection.rawBootstrap!, 'toki-v8-bootstrap-recovery.json')}>匯出啟用紀錄 JSON</button>}</div>
        </section></div></main>
    </>}
  </div>
}

function V8Workspace({ onReturn, onV9Activated, onV9StorageChanged, sidebarCollapsed, onSidebarCollapsedChange }: {
  onReturn: () => void; onV9Activated: () => void; onV9StorageChanged: () => void
  sidebarCollapsed: boolean; onSidebarCollapsedChange: (collapsed: boolean) => void
}) {
  const [data, setData, status, controls, persistence, info] = useAppDataV8({ loadMode: 'v8-only' })
  const [page, setPage] = useState<Page>('overview')
  const [projectOpen, setProjectOpen] = useState(false)
  const [resourceOpen, setResourceOpen] = useState(false)
  const [switchError, setSwitchError] = useState('')
  const [switchExpected, setSwitchExpected] = useState<{ raw: string; revision: number } | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [timetableSelection, setTimetableSelection] = useState<{ projectId: string | null; timetableId: string | null }>({ projectId: null, timetableId: null })
  const project = data.projects.find((item) => item.id === data.activeProjectId)
  const selectedTimetableId = reconcileTimetableSelectionV8(data, data.activeProjectId,
    timetableSelection.projectId === data.activeProjectId ? timetableSelection.timetableId : null)
  const selectedTimetable = data.timetables.find((item) => item.id === selectedTimetableId)
  const selectTimetable = useCallback((id: string | null) => setTimetableSelection({ projectId: data.activeProjectId, timetableId: id }), [data.activeProjectId])
  const canWrite = status === 'saved' && info.writable && !persistence.pending
  useEffect(() => {
    if (!switchExpected) return
    if (status === 'saved' && !persistence.pending && persistence.receipt
      && persistence.revision > switchExpected.revision
      && persistence.receipt.revision === persistence.revision
      && persistence.receipt.raw === switchExpected.raw && JSON.stringify(data) === switchExpected.raw) {
      setSwitchExpected(null)
    } else if (status === 'write-error' || status === 'conflict' || status === 'read-error') {
      setSwitchExpected(null)
      setSwitchError('專案切換未確認儲存；本頁資料仍可匯出，請先處理寫入狀態。')
    }
  }, [data, persistence.pending, persistence.receipt, persistence.revision, status, switchExpected])
  const selectProject = (id: string) => {
    if (!canWrite || switchExpected || projectOpen || resourceOpen || page === 'settings' || page === 'timetables') return
    try { const next = switchActiveProject(data, id); setSwitchError('');
      setSwitchExpected({ raw: JSON.stringify(next), revision: persistence.revision }); setData(next) }
    catch (cause) { setSwitchError(cause instanceof Error ? cause.message : '無法切換專案。') }
  }
  const subjectReview = page === 'resources' ? inspectSubjectMigrationV9(data) : null
  const currentSubjectReview = subjectReview?.entries.filter((item) => item.projectId === data.activeProjectId) ?? []
  return <>
    <PreviewSidebar open={menuOpen} onOpen={() => setMenuOpen(true)} onClose={() => setMenuOpen(false)} activePage={page}
      collapsed={sidebarCollapsed} onCollapsedChange={onSidebarCollapsedChange}
      mobileItemIds={['overview', 'resources', 'timetables']}
      items={pages} label="V8 導覽" onNavigate={(id) => { setPage(id as Page); setMenuOpen(false) }}
      controls={<div className="project-switcher v8-preview-switchers">課表專案
        <PreviewProjectSwitcher projects={data.projects.filter((item) => !item.archivedAt)} selectedId={data.activeProjectId}
          disabled={!canWrite || !!switchExpected || projectOpen || resourceOpen || page === 'settings' || page === 'timetables'} onSelect={selectProject} />
        <button onClick={() => setProjectOpen(true)}>專案設定</button>
        <div className="preview-timetable-control"><span>目前教師課表</span>
          <TimetableSwitcher timetables={data.timetables.filter((item) => item.projectId === data.activeProjectId)}
            selectedId={selectedTimetableId} onSelect={selectTimetable} buttonLabel="切換目前教師課表"
            buttonText={selectedTimetable?.name ?? '尚未建立課表'} />
        </div></div>}
      footer={<><button onClick={() => { setProjectOpen(true); setMenuOpen(false) }}><Settings size={19} aria-hidden="true" /><span className="sidebar-item-label">專案管理</span></button>
        <p>目前教師課表：{selectedTimetable ? `${selectedTimetable.name}・${selectedTimetable.teacherName}` : '尚未建立'}</p>
        <div className={`storage-status ${status}`} role="status">V8：{canWrite ? '可寫入' : '唯讀／待確認'}</div></>} />
    <main className="main-area"><PreviewTopbar title="V8 開發預覽" onMenu={() => setMenuOpen(true)} onReturn={onReturn} />
      <div className="content"><section className="page-heading"><div><p className="eyebrow">Toki / V8</p><h1>{pages.find((item) => item.id === page)?.label}</h1></div></section>
        {switchError && <p role="alert" className="form-error">{switchError}</p>}
        {!canWrite && <section className="panel v8-preview-panel" role="alert"><h2>目前無法儲存</h2><p>{previewReadOnlyMessage(status, info.v8OnlyStatus === 'legacy-v7-present')}</p>
          <details className="v8-preview-advanced"><summary>診斷資訊</summary><code>{status} / {controls.errorCode ?? info.v8OnlyStatus ?? 'activation gate'}</code></details>
          <div className="v8-preview-actions">
          <button onClick={() => downloadJson(controls.exportLocalJson(), 'toki-v8-local-draft.json')}>匯出本頁資料</button>
          {controls.exportStoredV8Json() !== null && <button onClick={() => downloadJson(controls.exportStoredV8Json()!, 'toki-v8-stored.json')}>匯出原始 V8 JSON</button>}
          {status === 'conflict' && <button onClick={controls.adoptExternalV8}>採用外部分頁版本</button>}
          {status === 'write-error' && <button onClick={controls.retryWrite}>重試寫入</button>}
          </div>
        </section>}
        {page === 'resources' && <section className="panel v8-preview-panel" aria-label="教師科目庫版本說明">
          <h2>教師專屬科目庫尚未啟用</h2>
          <p>目前專案：{project?.name ?? '尚未建立'}；目前教師課表：{selectedTimetable?.name ?? '尚未建立'}。</p>
          <p>此 V8 預覽的下方科目管理仍使用 Project 共用科目庫，並非目前教師獨立的科目庫。資料轉換須逐筆確認歸屬；不會在開啟頁面時自動遷移。</p>
          <p>目前專案待審核科目：{currentSubjectReview.length} 筆；其中 {currentSubjectReview.filter((item) => item.requiresUserDecision).length} 筆需要人工決定。</p>
          <details className="v8-preview-advanced"><summary>進階資料管理：原始匯出與教師科目庫轉換</summary>
            <p>轉換需先備份與確認歸屬。日常科目與班級管理可直接使用下方入口。</p>
            {controls.exportStoredV8Json() !== null && <div className="v8-preview-actions"><button type="button" onClick={() => downloadJson(controls.exportStoredV8Json()!, 'toki-v8-before-subject-migration.json')}>匯出原始 V8 JSON</button></div>}
            <SubjectUpgradeV9 data={data} sourceRaw={controls.exportStoredV8Json()}
              writable={canWrite} onExport={(raw) => downloadJson(raw, 'toki-v8-before-teacher-subject-upgrade.json')}
              onActivated={onV9Activated} onStorageChanged={onV9StorageChanged} />
          </details>
        </section>}
        {page === 'overview' ? <section className="panel v8-preview-panel"><h2>{project?.name ?? '尚無課表專案'}</h2>
          <p>{project ? `學年度 ${project.term.academicYear}；目前有 ${data.timetables.filter((item) => item.projectId === project.id).length} 份教師課表。` : '先建立空白 Project；不會自動建立科目、班級、教師課表或課程。'}</p>
          <p>目前教師課表：{selectedTimetable ? `${selectedTimetable.name}・${selectedTimetable.teacherName}` : '尚未建立'}</p>
          <div className="v8-preview-actions">
          <button className="primary-button" onClick={() => setProjectOpen(true)}>管理專案</button>
          <button onClick={() => setPage('timetables')}>管理教師課表</button></div></section>
          : page === 'lessons' ? <section className="panel v8-preview-panel"><h2>課程管理</h2><p>開發中；D3 尚未接入課程管理與週課表。</p></section>
            : <section className="panel v8-preview-panel"><h2>{pages.find((item) => item.id === page)?.label}</h2><p>目前專案：{project?.name ?? '尚未建立'}；目前教師課表：{selectedTimetable?.name ?? '尚未建立'}。</p>
              {page === 'resources' && <div className="v8-preview-actions"><button className="primary-button" onClick={() => setResourceOpen(true)}>開啟科目與班級管理</button></div>}
            </section>}
      </div>
    </main>
    {projectOpen && <ProjectLifecycleV8 data={data} setData={setData} status={status} persistence={persistence}
      info={info} controls={controls} onClose={() => setProjectOpen(false)}
      onExport={(raw) => downloadJson(raw, 'toki-v8-project-draft.json')} />}
    {page === 'timetables' && <TimetableManagerV8 data={data} setData={setData} status={status}
      persistence={persistence} writable={canWrite} exportLocalJson={controls.exportLocalJson}
      onExport={(raw) => downloadJson(raw, 'toki-v8-timetable-draft.json')} onRecover={controls.adoptExternalV8}
      selectedTimetableId={selectedTimetableId} onSelectTimetable={selectTimetable} onClose={() => setPage('overview')} />}
    {page === 'resources' && resourceOpen && <V8SubjectClassManager data={data} setData={setData} status={status}
      persistence={persistence} writable={canWrite} controls={controls}
      onExport={(raw) => downloadJson(raw, 'toki-v8-resource-draft.json')} onClose={() => setResourceOpen(false)} />}
    {page === 'settings' && <AcademicSettingsV8 data={data} setData={setData} status={status}
      persistence={persistence} writable={canWrite} exportLocalJson={controls.exportLocalJson}
      onExport={(raw) => downloadJson(raw, 'toki-v8-settings-draft.json')} onClose={() => setPage('overview')} />}
  </>
}

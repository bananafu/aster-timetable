import { useState } from 'react'
import { useAppDataV9 } from '../hooks/useAppDataV9'
import { resumeTimetableSubjectsV9 } from '../data/activateSubjectV9'
import { V9_BACKUP_PREFIX } from '../data/storageV9'
import { createBlankProjectV9, createTeacherSubjectV9, createTeacherTimetableV9,
  configureTeacherSubjectV9, deleteTeacherSubjectV9,
  deleteTeacherTimetableV9, duplicateTeacherTimetableV9, renameTeacherSubjectV9,
  switchActiveProjectV9, updateTeacherTimetableV9, type SubjectDraftV9 } from '../data/teacherSubjectsV9'
import type { AppDataV9, SubjectV9 } from '../types/v9'
import { PreviewProjectSwitcher } from './PreviewProjectSwitcher'
import { TimetableSwitcher } from './TimetableControls'
import { PreviewSidebar, PreviewTopbar, type PreviewNavItem } from './PreviewShellNavigation'
import { AcademicClassManagerV9 } from './AcademicClassManagerV9'
import { Modal } from './Modal'
import { archiveProjectV9, copyProjectV9, deleteEmptyProjectV9,
  getProjectV9Impact, reactivateProjectV9 } from '../data/managementV9'
import { GraduationCap, LayoutDashboard, LibraryBig, Settings, Shapes } from 'lucide-react'

type Page = 'overview' | 'projects' | 'timetables' | 'subjects' | 'settings'
type CopyUnitDraft = { sourceEffectiveDate: string; startDate: string; endDate: string; anchorDate: string; anchorPattern: 'A' | 'B' }
const pages: (PreviewNavItem & { id: Page })[] = [
  { id: 'overview', label: '總覽', icon: LayoutDashboard },
  { id: 'projects', label: '專案', icon: Shapes },
  { id: 'timetables', label: '教師課表', icon: GraduationCap },
  { id: 'subjects', label: '科目與班級', icon: LibraryBig },
  { id: 'settings', label: '任教單位', icon: Settings },
]
type Scope = { projectId: string | null; timetableId: string | null; raw: string }
const blank = (): SubjectDraftV9 => ({ name: '', shortName: '', color: '#A66D52', applicableSchoolLevels: ['senior-high'] })
const uid = () => crypto.randomUUID()
function download(raw: string, filename: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url)
}

/** Internal schema 9, presented as the Toki V8 teacher-owned Subject workspace. */
export function TeacherSubjectWorkspaceV9({ onReturn, onRecovered, sidebarCollapsed, onSidebarCollapsedChange }: {
  onReturn: () => void; onRecovered: () => void
  sidebarCollapsed: boolean; onSidebarCollapsedChange: (collapsed: boolean) => void
}) {
  const host = useAppDataV9()
  const data = host.data
  const [page, setPage] = useState<Page>('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [selection, setSelection] = useState<{ projectId: string | null; timetableId: string | null }>(
    { projectId: null, timetableId: null })
  const [projectDraft, setProjectDraft] = useState({ name: '', academicYear: 115, semester: 'first' as 'first' | 'second' | 'summer',
    startDate: '', endDate: '' })
  const [copyDraft, setCopyDraft] = useState({ sourceProjectId: '', name: '', academicYear: 115,
    semester: 'first' as 'first' | 'second' | 'summer' })
  const [copyUnits, setCopyUnits] = useState<Record<string, CopyUnitDraft>>({})
  const [deleteProjectId, setDeleteProjectId] = useState('')
  const [tableDraft, setTableDraft] = useState({ name: '', teacherName: '' })
  const [editingTableId, setEditingTableId] = useState<string | null>(null)
  const [subjectDraft, setSubjectDraft] = useState<SubjectDraftV9>(blank)
  const [editing, setEditing] = useState<string | null>(null)
  const [draftScope, setDraftScope] = useState<Scope | null>(null)
  const [message, setMessage] = useState('')
  const [managementOpen, setManagementOpen] = useState<'settings' | 'classes' | null>(null)
  const [subjectManagerOpen, setSubjectManagerOpen] = useState(false)
  const [projectManagerOpen, setProjectManagerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const resume = async () => {
    if (!window.confirm('確認以已驗證的原始備份及原轉換候選資料續接？不會清除或覆寫 V7／V8；來源若已變更將阻擋。')) return
    setBusy(true)
    const result = await resumeTimetableSubjectsV9(localStorage)
    if (result.ok) onRecovered()
    else setMessage(`無法安全續接：${result.code}。請匯出原始文件、啟用紀錄與備份進行人工恢復。`)
    setBusy(false)
  }
  const projectId = data?.activeProjectId ?? null
  const project = data?.projects.find((item) => item.id === projectId)
  const tables = data?.timetables.filter((item) => item.projectId === projectId) ?? []
  const timetableId = selection.projectId === projectId && tables.some((item) => item.id === selection.timetableId)
    ? selection.timetableId : tables[0]?.id ?? null
  const timetable = tables.find((item) => item.id === timetableId)
  const subjects = data?.subjects.filter((item) => item.projectId === projectId && item.timetableId === timetableId) ?? []
  const units = data?.teachingUnits.filter((item) => item.projectId === projectId) ?? []
  const dirty = Boolean(draftScope || editing || editingTableId || subjectDraft.name || subjectDraft.shortName
    || tableDraft.name || tableDraft.teacherName || projectDraft.name || copyDraft.name)
  const writable = host.writable && host.status === 'active' && !host.pending && !busy
  const verifying = host.status === 'active' && !host.writable && !host.errorCode
  const readOnlyReason = host.status === 'lock-unavailable' ? '此瀏覽器不支援必要的安全鎖定，因此無法儲存。'
    : host.status === 'conflict' ? '資料或啟用紀錄已在其他位置變更。請先匯出並確認外部版本。'
      : host.status === 'preparing' || host.status === 'interrupted' ? '科目庫轉換未完成，需先檢查備份後明確續接。'
        : '目前資料尚未通過寫入驗證。請先匯出原始資料並檢查狀態。'
  const backupKeys = (() => {
    try { return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key !== null && key.startsWith(V9_BACKUP_PREFIX)) }
    catch { return [] }
  })()
  const scope = (): Scope => ({ projectId, timetableId, raw: data ? JSON.stringify(data) : '' })
  const resetDrafts = () => {
    setProjectDraft({ name: '', academicYear: 115, semester: 'first', startDate: '', endDate: '' })
    setCopyDraft({ sourceProjectId: '', name: '', academicYear: 115, semester: 'first' })
    setCopyUnits({})
    setTableDraft({ name: '', teacherName: '' })
    setEditingTableId(null)
    setSubjectDraft(blank())
    setEditing(null)
    setDraftScope(null)
  }
  const confirmDiscard = () => !dirty || window.confirm('尚有未儲存草稿，確定捨棄並切換？')
  const navigate = (next: Page) => {
    if (managementOpen || subjectManagerOpen || projectManagerOpen || !confirmDiscard()) return
    resetDrafts(); setMessage(''); setMenuOpen(false)
    if (next === 'projects') setProjectManagerOpen(true)
    else setPage(next)
  }
  const chooseTable = (id: string) => {
    if (managementOpen || projectManagerOpen || !confirmDiscard()) return
    setSubjectManagerOpen(false)
    resetDrafts(); setSelection({ projectId, timetableId: id }); setMessage('')
  }
  const run = async (label: string, produce: (current: AppDataV9) => AppDataV9,
    after?: () => void, expected = draftScope): Promise<boolean> => {
    if (!writable || !data) return false
    if (expected && (expected.projectId !== projectId || expected.timetableId !== timetableId
      || expected.raw !== JSON.stringify(data))) {
      setMessage('資料或專案／教師已變更；草稿保留，請重新確認，未寫入。'); return false
    }
    setBusy(true); setMessage('')
    try {
      let producedRaw: string | null = null
      const oldRevision = host.revision
      const receipt = await host.update((current) => {
        if (JSON.stringify(current) !== JSON.stringify(data)) throw new Error('stale-document')
        const next = produce(current)
        producedRaw = JSON.stringify(next)
        return next
      })
      if (!producedRaw || receipt.raw !== producedRaw || receipt.revision <= oldRevision) {
        throw new Error('receipt-mismatch')
      }
      after?.()
      setMessage(`${label}，資料已保存。`)
      return true
    } catch (cause) {
      setMessage(`未確認儲存：${cause instanceof Error ? cause.message : 'unknown'}。草稿保留，可匯出本頁資料。`)
      return false
    } finally { setBusy(false) }
  }
  const beginSubjectEdit = (subject: SubjectV9) => {
    if (!confirmDiscard()) return
    setEditing(subject.id)
    setSubjectDraft({ name: subject.name, shortName: subject.shortName, color: subject.color,
      applicableSchoolLevels: [...subject.applicableSchoolLevels] })
    setDraftScope(scope())
  }
  const saveSubject = () => {
    if (!projectId || !timetableId) return
    const subjectId = editing ?? uid()
    void run(editing ? '已更新科目' : '已新增科目', (current) => editing
      ? renameTeacherSubjectV9(current, projectId, timetableId, subjectId, subjectDraft)
      : createTeacherSubjectV9(current, projectId, timetableId, subjectDraft, subjectId),
    () => { setEditing(null); setSubjectDraft(blank()); setDraftScope(null) })
  }
  const configure = (subject: SubjectV9, targetUnitId: string) => {
    if (!projectId || !timetableId) return
    const unit = units.find((item) => item.id === targetUnitId)!
    const extension = !subject.applicableSchoolLevels.includes(unit.schoolLevel)
    if (extension && !window.confirm(`「${subject.name}」尚未適用${unit.name}的學制。確定擴充適用學制並建立任教配置？`)) return
    void run('已建立任教配置', (current) => configureTeacherSubjectV9(current, projectId,
      timetableId, targetUnitId, subject.id, uid(), extension), undefined, null)
  }
  const deleteSubject = (subject: SubjectV9) => {
    if (!projectId || !timetableId || !window.confirm(`永久刪除 ${subject.name}？有任教配置或課程引用時會阻擋。`)) return
    void run('已刪除科目', (current) => deleteTeacherSubjectV9(current, projectId, timetableId, subject.id), undefined, null)
  }
  const selectProject = (id: string) => {
    if (managementOpen || projectManagerOpen || !confirmDiscard()) return
    setSubjectManagerOpen(false)
    resetDrafts()
    void run('已切換專案', (current) => switchActiveProjectV9(current, id),
      () => { setSelection({ projectId: id, timetableId: null }); setMessage('') }, null)
  }
  const selectedCopySource = data?.projects.find((item) => item.id === copyDraft.sourceProjectId)
  const selectedCopyUnits = data?.teachingUnits.filter((item) => item.projectId === copyDraft.sourceProjectId) ?? []
  const deleteImpact = data && deleteProjectId ? getProjectV9Impact(data, deleteProjectId) : null
  const deleteHasDependencies = !!deleteImpact && Boolean(deleteImpact.timetables || deleteImpact.subjects
    || deleteImpact.teachingUnitSubjects || deleteImpact.classes || deleteImpact.recurringLessons
    || deleteImpact.oneOffLessons || deleteImpact.overrides || deleteImpact.events || deleteImpact.teachingProgress)
  const updateCopyUnit = (id: string, patch: Partial<CopyUnitDraft>) => {
    if (!draftScope) setDraftScope(scope())
    setCopyUnits((current) => ({ ...current, [id]: { ...(current[id] ?? { sourceEffectiveDate: '', startDate: '',
      endDate: '', anchorDate: '', anchorPattern: 'A' as const }), ...patch } }))
  }
  return <>
    <PreviewSidebar open={menuOpen} onOpen={() => setMenuOpen(true)} onClose={() => setMenuOpen(false)} activePage={page}
      collapsed={sidebarCollapsed} onCollapsedChange={onSidebarCollapsedChange}
      mobileItemIds={['overview', 'timetables', 'subjects']}
      items={pages} label="V8 教師科目庫導覽" onNavigate={(id) => navigate(id as Page)}
      controls={<div className="project-switcher v8-preview-switchers">目前專案
        <PreviewProjectSwitcher projects={data?.projects ?? []} selectedId={projectId} disabled={!writable} onSelect={selectProject} />
        <div className="preview-timetable-control"><span>目前教師課表</span>
          <TimetableSwitcher timetables={tables} selectedId={timetableId} onSelect={chooseTable}
            buttonLabel="切換目前教師課表" buttonText={timetable?.name ?? '尚未建立課表'} />
        </div>
      </div>}
      footer={<div className="storage-status" role="status">{writable ? '可寫入' : verifying ? '正在確認資料' : '唯讀／需處理'}</div>} />
    <main className="main-area"><PreviewTopbar title="V8 教師獨立科目庫" onMenu={() => setMenuOpen(true)} onReturn={onReturn} />
      <div className="content"><section className="page-heading"><div><p className="eyebrow">Toki / V8</p>
        <h1>{{ overview: '總覽', projects: '課表專案', timetables: '教師課表', subjects: '科目與班級', settings: '任教單位' }[page]}</h1></div></section>
        <section className="panel v8-preview-panel"><p>目前專案：{project?.name ?? '尚未建立'}；目前教師課表：{timetable?.name ?? '尚未建立'}。</p>
          {!writable && <div role={verifying ? 'status' : 'alert'} className="preview-readonly-notice">{verifying ? '正在確認資料及啟用紀錄，暫停寫入。' : readOnlyReason}
            <button onClick={() => void host.adoptExternal().then((ok) => {
              if (!ok) setMessage('外部版本或原始來源未通過驗證；仍維持唯讀，請先匯出資料。')
            })}>檢查並採用外部版本</button>
            <details><summary>診斷資訊</summary><code>{host.status}{host.errorCode ? ` / ${host.errorCode}` : ''}</code></details></div>}
          {message && <p role="status">{message}</p>}
          <details className="v8-preview-advanced"><summary>進階資料管理與救援匯出</summary>
            <p>只有在備份、資料衝突或轉換恢復時才需要使用。匯出不會更動原始資料。</p>
          <div className="v8-preview-actions">{host.exportLocalJson() && <button onClick={() => download(JSON.stringify({
            documentRaw: host.exportLocalJson(), draft: { projectDraft, tableDraft, subjectDraft,
              editingSubjectId: editing, editingTableId, scope: draftScope },
          }), 'toki-v8-teacher-local-draft.json')}>匯出本頁資料及草稿</button>}
          {host.exportStoredJson() && <button onClick={() => download(host.exportStoredJson()!, 'toki-v8-teacher-stored.json')}>匯出原始新文件</button>}
          {host.exportActivationJson() && <button onClick={() => download(host.exportActivationJson()!, 'toki-v8-teacher-activation.json')}>匯出啟用紀錄</button>}
          {host.exportBackupJson() && <button onClick={() => download(host.exportBackupJson()!, 'toki-v8-teacher-source-backup.json')}>匯出 V8 原始備份</button>}
          {!host.exportBackupJson() && backupKeys.map((key) => <button key={key}
            onClick={() => { const raw = localStorage.getItem(key); if (raw) download(raw, 'toki-v8-teacher-recovery-backup.json') }}>
            匯出備份 {key.slice(V9_BACKUP_PREFIX.length)}</button>)}
          {(host.status === 'preparing' || host.status === 'interrupted') &&
            <button disabled={busy} onClick={() => void resume()}>確認續接中斷的科目庫轉換</button>}
          </div></details>
        </section>
        {data && page === 'overview' && <section className="panel v8-preview-panel"><h2>教師獨立科目庫</h2>
          <p>這份課表有 {subjects.length} 筆科目；同一教師可將科目配置到多個任教單位。不同教師可以使用同名科目。</p>
          <button onClick={() => navigate('subjects')}>管理目前教師科目</button></section>}
        {data && projectManagerOpen && <Modal title="課表專案管理" subtitle="新增、複製、封存與安全刪除"
          onClose={() => { if (confirmDiscard()) { resetDrafts(); setProjectManagerOpen(false) } }}>
          <section className="project-settings preview-management-page preview-project-manager"><div className="preview-section-heading"><div><h2>課表專案</h2><p>切換專案請使用左側的專案 Popover；管理彈窗不會因導覽而切換背景頁面。</p></div></div>
          <div className="preview-management-section"><h3>目前專案</h3>{data.projects.map((item) => <div className="project-history-row" key={item.id}><div><strong>{item.name}</strong><span>{item.id === projectId ? '目前使用中' : '其他專案'}</span></div></div>)}
            {!data.projects.length && <p className="settings-empty">尚未建立專案。</p>}</div>
          <div className="preview-management-section"><h3>新增空白專案</h3><p>不複製其他專案的科目、班級、課表或課程。</p>
          <div className="form-grid preview-inline-form">
          <label>專案名稱<input aria-label="新專案名稱" placeholder="專案名稱" value={projectDraft.name}
            onChange={(event) => { if (!draftScope) setDraftScope(scope()); setProjectDraft({ ...projectDraft, name: event.target.value }) }} />
          </label><label>學年度<input aria-label="學年度" type="number" value={projectDraft.academicYear}
            onChange={(event) => { if (!draftScope) setDraftScope(scope()); setProjectDraft({ ...projectDraft, academicYear: Number(event.target.value) }) }} /></label>
          <label>學期<select value={projectDraft.semester} onChange={(event) => {
            if (!draftScope) setDraftScope(scope()); setProjectDraft({ ...projectDraft, semester: event.target.value as 'first' }) }}>
            <option value="first">上學期</option><option value="second">下學期</option><option value="summer">暑期</option></select></label>
          <label>學期開始日<input aria-label="學期開始日" type="date" value={projectDraft.startDate} onChange={(event) => {
            if (!draftScope) setDraftScope(scope()); setProjectDraft({ ...projectDraft, startDate: event.target.value }) }} /></label>
          <label>學期結束日<input aria-label="學期結束日" type="date" value={projectDraft.endDate} onChange={(event) => {
            if (!draftScope) setDraftScope(scope()); setProjectDraft({ ...projectDraft, endDate: event.target.value }) }} /></label>
          <div className="form-actions full"><button onClick={() => { if (confirmDiscard()) resetDrafts() }}>取消</button><button disabled={!writable} className="primary-button" onClick={() => void run('已新增空白專案', (current) =>
            createBlankProjectV9(current, projectDraft, uid), resetDrafts)}>新增空白專案</button>
          </div></div></div><div className="preview-management-section"><h3>複製為新學期</h3>
            <p>獨立複製學校、任教單位、班級、教師課表、各教師科目及指定來源日期的固定課程；不複製單次異動、事件或進度。</p>
            <div className="form-grid preview-inline-form">
              <label>來源專案<select aria-label="複製來源專案" value={copyDraft.sourceProjectId} onChange={(event) => {
                if (!draftScope) setDraftScope(scope())
                setCopyDraft({ ...copyDraft, sourceProjectId: event.target.value }); setCopyUnits({}) }}>
                <option value="">請選擇來源專案</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select></label>
              <label>新專案名稱<input aria-label="複製後專案名稱" value={copyDraft.name} onChange={(event) => {
                if (!draftScope) setDraftScope(scope()); setCopyDraft({ ...copyDraft, name: event.target.value }) }} /></label>
              <label>新學年度<input aria-label="複製後學年度" type="number" value={copyDraft.academicYear} onChange={(event) => {
                if (!draftScope) setDraftScope(scope()); setCopyDraft({ ...copyDraft, academicYear: Number(event.target.value) }) }} /></label>
              <label>新學期<select value={copyDraft.semester} onChange={(event) => {
                if (!draftScope) setDraftScope(scope()); setCopyDraft({ ...copyDraft, semester: event.target.value as 'first' }) }}>
                <option value="first">上學期</option><option value="second">下學期</option><option value="summer">暑期</option></select></label>
            </div>
            {selectedCopyUnits.map((unit) => { const values = copyUnits[unit.id] ?? { sourceEffectiveDate: '', startDate: '', endDate: '', anchorDate: '', anchorPattern: 'A' as const }
              return <fieldset className="preview-period-settings" key={unit.id}><legend>{unit.name}：來源與新學期日期</legend><div className="form-grid preview-inline-form">
                <label>來源有效日期<input type="date" aria-label={`${unit.name} 來源有效日期`} value={values.sourceEffectiveDate} onChange={(event) => updateCopyUnit(unit.id, { sourceEffectiveDate: event.target.value })} /></label>
                <label>新學期開始日<input type="date" aria-label={`${unit.name} 新學期開始日`} value={values.startDate} onChange={(event) => updateCopyUnit(unit.id, { startDate: event.target.value })} /></label>
                <label>新學期結束日<input type="date" aria-label={`${unit.name} 新學期結束日`} value={values.endDate} onChange={(event) => updateCopyUnit(unit.id, { endDate: event.target.value })} /></label>
                <label>新 A/B 錨點日期<input type="date" aria-label={`${unit.name} 新錨點日期`} value={values.anchorDate} onChange={(event) => updateCopyUnit(unit.id, { anchorDate: event.target.value })} /></label>
                <label>錨點週型<select aria-label={`${unit.name} 新錨點週型`} value={values.anchorPattern} onChange={(event) => updateCopyUnit(unit.id, { anchorPattern: event.target.value as 'A' | 'B' })}><option value="A">A 週</option><option value="B">B 週</option></select></label>
              </div></fieldset> })}
            {selectedCopySource && <p role="status">複製摘要：{data.schools.filter((item) => item.projectId === selectedCopySource.id).length} 所學校、{selectedCopyUnits.length} 個任教單位、{data.classes.filter((item) => item.projectId === selectedCopySource.id).length} 個班級、{data.timetables.filter((item) => item.projectId === selectedCopySource.id).length} 份教師課表、{data.subjects.filter((item) => item.projectId === selectedCopySource.id).length} 筆教師科目。固定課程依各單位明確指定的來源有效日期擷取。</p>}
            <div className="form-actions"><button onClick={() => { if (confirmDiscard()) resetDrafts() }}>取消</button>
              <button className="primary-button" disabled={!writable || !selectedCopySource || !copyDraft.name.trim()
                || selectedCopyUnits.some((unit) => !copyUnits[unit.id]?.sourceEffectiveDate || !copyUnits[unit.id]?.startDate
                  || !copyUnits[unit.id]?.endDate || !copyUnits[unit.id]?.anchorDate)} onClick={() => {
                if (!selectedCopySource) return
                if (!window.confirm(`確認複製「${selectedCopySource.name}」為新學期？會建立新的教師、科目與班級 ID；單次異動、事件與進度不會複製。`)) return
                void run('已複製為新學期', (current) => copyProjectV9(current, { ...copyDraft,
                  units: selectedCopyUnits.map((unit) => ({ sourceUnitId: unit.id, ...copyUnits[unit.id] })) }, uid),
                resetDrafts)
              }}>確認複製新學期</button></div>
          </div>
          <div className="preview-management-section"><h3>封存與重新啟用</h3>
            <p>封存保留所有教學資料，只暫停該專案的日常編輯。</p>
            {data.projects.map((item) => <div className="project-history-row" key={item.id}><div><strong>{item.name}</strong><span>{item.archivedAt ? '已封存' : '使用中'}</span></div>
              <button disabled={!writable} onClick={() => { if (!confirmDiscard() || !window.confirm(`${item.archivedAt ? '重新啟用' : '封存'}「${item.name}」？原始資料會保留。`)) return
                void run(item.archivedAt ? '已重新啟用專案' : '已封存專案', (current) => item.archivedAt
                  ? reactivateProjectV9(current, item.id) : archiveProjectV9(current, item.id), resetDrafts, null) }}>
                {item.archivedAt ? '重新啟用' : '封存'}</button></div>)}
          </div>
          <div className="preview-danger-section"><h3>危險操作：永久刪除專案</h3>
            <p>有課表、科目、班級、課程、事件或進度時一律阻擋，不會級聯刪除；空白專案仍會刪除其初始學校與任教單位。</p>
            <label>刪除對象<select aria-label="選擇刪除專案" value={deleteProjectId} onChange={(event) => setDeleteProjectId(event.target.value)}><option value="">請選擇專案</option>
              {data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {deleteImpact && <p role="status">影響摘要：{deleteImpact.schools} 所學校、{deleteImpact.teachingUnits} 個任教單位、{deleteImpact.timetables} 份課表、{deleteImpact.subjects} 筆科目、{deleteImpact.classes} 個班級、{deleteImpact.recurringLessons} 筆固定課程、{deleteImpact.events + deleteImpact.overrides + deleteImpact.oneOffLessons + deleteImpact.teachingProgress} 筆其他關聯資料。{deleteHasDependencies ? '存在依賴，禁止永久刪除；可先封存。' : '確認後可刪除此空白專案。'}</p>}
            <button className="danger-button" disabled={!writable || !deleteProjectId || deleteHasDependencies} onClick={() => {
              const target = data.projects.find((item) => item.id === deleteProjectId)
              if (!target || !confirmDiscard() || !window.confirm(`永久刪除空白專案「${target.name}」及其初始學校、任教單位？此操作不可復原。`)) return
              void run('已刪除空白專案', (current) => deleteEmptyProjectV9(current, target.id, true),
                () => { resetDrafts(); setDeleteProjectId('') }, null)
            }}>永久刪除空白專案</button>
          </div></section></Modal>}
        {data && page === 'timetables' && <section className="panel v8-preview-panel preview-management-page"><h2>教師課表</h2>
          {!project && <p>請先建立 Project。</p>}
          {tables.map((item) => <div key={item.id} className="v8-preview-list-row project-history-row preview-timetable-row"><button onClick={() => chooseTable(item.id)}>{item.name}・{item.teacherName}{item.id === timetableId ? '（目前）' : ''}</button>
            <div className="v8-preview-actions">
            <button disabled={!writable} onClick={() => { if (confirmDiscard()) { setTableDraft({ name: item.name, teacherName: item.teacherName ?? '' });
              setEditingTableId(item.id); setDraftScope({ ...scope(), timetableId: item.id });
              setSelection({ projectId, timetableId: item.id }) } }}>編輯</button>
            <button disabled={!writable} onClick={() => void run('已複製課表設定', (current) =>
              duplicateTeacherTimetableV9(current, projectId!, item.id, uid()), undefined, null)}>只複製設定</button>
            <button disabled={!writable} onClick={() => { if (window.confirm(`刪除 ${item.name}？有科目或課程引用時會阻擋。`)) void run('已刪除課表',
              (current) => deleteTeacherTimetableV9(current, projectId!, item.id), undefined, null) }}>刪除</button></div></div>)}
          <h3>{editingTableId ? '編輯教師課表' : '新增空白教師課表'}</h3>
          <div className="form-grid preview-inline-form">
          <label>課表名稱<input aria-label="課表名稱" placeholder="課表名稱" value={tableDraft.name}
            onChange={(event) => { if (!draftScope) setDraftScope(scope()); setTableDraft({ ...tableDraft, name: event.target.value }) }} /></label>
          <label>教師名稱<input aria-label="教師名稱" placeholder="教師名稱" value={tableDraft.teacherName}
            onChange={(event) => { if (!draftScope) setDraftScope(scope()); setTableDraft({ ...tableDraft, teacherName: event.target.value }) }} /></label>
          </div><div className="form-actions"><button onClick={() => { if (confirmDiscard()) resetDrafts() }}>取消</button><button disabled={!writable || !projectId} className="primary-button" onClick={() => {
            const existing = editingTableId && tables.find((item) => item.id === editingTableId)
            void run(existing ? '已編輯教師課表' : '已新增空白教師課表', (current) => existing
              ? updateTeacherTimetableV9(current, projectId!, existing.id, tableDraft)
              : createTeacherTimetableV9(current, projectId!, tableDraft, uid()), resetDrafts)
          }}>儲存教師課表</button></div></section>}
        {data && page === 'subjects' && <section className="panel v8-preview-panel preview-management-page"><h2>科目與班級</h2>
          <p>這裡是教學進度工作區的預留入口；進度功能尚未接線。管理目前教師的科目或專案班級請開啟對應彈窗。</p>
          <div className="v8-preview-actions"><button className="primary-button" disabled={!timetable}
            onClick={() => setSubjectManagerOpen(true)}>管理科目</button>
            <button disabled={!projectId} onClick={() => setManagementOpen('classes')}>管理班級</button></div></section>}
        {data && page === 'subjects' && subjectManagerOpen && <Modal title="教師科目管理"
          subtitle={`目前專案：${project?.name ?? '無'}・目前教師：${timetable?.teacherName ?? '無'}`}
          onClose={() => { if (confirmDiscard()) { resetDrafts(); setSubjectManagerOpen(false) } }}>
          <section className="project-settings preview-management-page preview-subject-manager"><h2>目前教師：{timetable?.teacherName ?? '尚未選取'}</h2>
          {!timetable && <p>請先在「教師課表」新增或選取教師課表。空白教師課表沒有科目。</p>}
          {timetable && <><p>科目只屬於這位教師。需要切換教師時，請使用左側「目前教師課表」。</p>
            <ul className="v8-preview-list">{subjects.map((subject) => <li key={subject.id} className="v8-preview-list-row project-history-row preview-subject-row"><div><strong>{subject.name}</strong><span>簡稱：{subject.shortName}</span></div>
              <div className="v8-preview-actions">
              <button disabled={!writable} onClick={() => beginSubjectEdit(subject)}>編輯</button>
              <button disabled={!writable} onClick={() => deleteSubject(subject)}>刪除</button>
              {units.map((unit) => { const configured = data.teachingUnitSubjects.some((item) =>
                item.subjectId === subject.id && item.teachingUnitId === unit.id)
                return <button key={unit.id} disabled={!writable || configured} title={configured ? '此教師已完成任教配置' : `將此科目配置給${unit.name}；如需擴充適用學制，會再次確認`} onClick={() => configure(subject, unit.id)}>
                  {unit.name}：{configured ? '已配置' : '配置'}</button> })}</div></li>)}</ul>
            {!subjects.length && <p>此教師尚無科目；不繼承其他教師的科目。</p>}
            <h3>{editing ? '編輯科目' : '新增科目'}</h3>
            <div className="form-grid preview-inline-form">
            <label>科目名稱<input aria-label="科目名稱" placeholder="科目名稱" value={subjectDraft.name}
              onChange={(event) => { if (!draftScope) setDraftScope(scope()); setSubjectDraft({ ...subjectDraft, name: event.target.value }) }} /></label>
            <label>科目簡稱<input aria-label="科目簡稱" placeholder="簡稱" value={subjectDraft.shortName}
              onChange={(event) => { if (!draftScope) setDraftScope(scope()); setSubjectDraft({ ...subjectDraft, shortName: event.target.value }) }} /></label>
            <label>適用學制<select aria-label="科目初始學制" value={subjectDraft.applicableSchoolLevels[0]}
              onChange={(event) => { if (!draftScope) setDraftScope(scope()); setSubjectDraft({ ...subjectDraft, applicableSchoolLevels: [event.target.value as 'senior-high'] }) }}>
              <option value="senior-high">高中部</option><option value="junior-high">國中部</option><option value="other">其他</option></select></label>
            </div><div className="form-actions"><button onClick={() => { if (confirmDiscard()) resetDrafts() }}>取消</button>
              <button disabled={!writable} className="primary-button" onClick={saveSubject}>儲存科目</button></div></>}
          <div className="v8-preview-subsection"><div className="preview-section-heading"><div><h3>班級</h3>
            <p>班級歸屬任教單位，可供同專案的不同教師合法引用。</p></div>
            <button disabled={!writable || !projectId} onClick={() => { if (confirmDiscard()) { resetDrafts(); setSubjectManagerOpen(false); setManagementOpen('classes') } }}>管理班級</button></div>
            {units.map((unit) => <div key={unit.id}><strong>{unit.name}</strong><ul>
              {data.classes.filter((item) => item.projectId === projectId && item.teachingUnitId === unit.id)
                .map((item) => <li key={item.id}>{item.name}</li>)}
              {!data.classes.some((item) => item.projectId === projectId && item.teachingUnitId === unit.id) && <li>尚無班級</li>}
            </ul></div>)}
          </div>
        </section></Modal>}
        {data && page === 'settings' && <section className="panel v8-preview-panel preview-management-page"><div className="preview-section-heading"><h2>學校與任教單位</h2>
          <button disabled={!writable || !projectId} onClick={() => setManagementOpen('settings')}>管理教學設定</button></div>
          <div className="preview-management-section"><h3>學校</h3>
            {data.schools.filter((item) => item.projectId === projectId).map((item) => <div className="project-history-row" key={item.id}><div><strong>{item.name}</strong></div></div>)}</div>
          <div className="preview-management-section"><h3>任教單位與學期</h3>
          {units.map((item) => <div className="project-history-row" key={item.id}><div><strong>{item.name}</strong><span>學制：{item.schoolLevel}</span><span>學期：{item.startDate}～{item.endDate}</span></div></div>)}
          <p>科目可按教師分別配置到多個任教單位；新增與編輯請使用上方管理彈窗。</p></div>
        </section>}
      </div></main>
    {data && projectId && managementOpen && <AcademicClassManagerV9 data={data} projectId={projectId}
      section={managementOpen} writable={writable} onClose={() => setManagementOpen(null)}
      onCommit={(label, produce, expectedRaw) => run(label, produce, undefined,
        { projectId, timetableId, raw: expectedRaw })} />}
  </>
}

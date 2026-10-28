import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Archive, ChevronLeft, ChevronRight, Copy, Eye, FolderPlus, RotateCcw, Trash2 } from 'lucide-react'
import { type NewProjectInput } from '../data/projectRuntime'
import type { ConfigureProjectTermV9Input } from '../data/managementV9'
import type { ProjectLifecycleActions } from '../formalV7ProjectTimetableActions'
import { addDays, toDateKey } from '../lib/date'
import type { MigrationWarningV4, SemesterKind, TeachingUnit } from '../types'
import type { ProjectV9 } from '../types/v9'
import type { AcademicSettingsPage } from './AcademicSettingsV4'
import { Modal } from './Modal'

const academicYearNow = () => Math.max(1, new Date().getFullYear() - 1911)
const blankDraft = (): NewProjectInput => ({ name: '', teacherName: '', academicYear: academicYearNow(), semester: 'first', customLabel: '', startDate: toDateKey(new Date()), endDate: toDateKey(addDays(new Date(), 120)) })
type CreationDraft = Pick<NewProjectInput, 'name'> | NewProjectInput
const creationDraft = (actions: ProjectLifecycleActions): CreationDraft =>
  actions.creationMode === 'empty-v9' ? { name: '' } : blankDraft()
function submitProject(actions: ProjectLifecycleActions, draft: CreationDraft) {
  if (actions.creationMode === 'empty-v9') return actions.createProject({ name: draft.name })
  if (!('academicYear' in draft)) throw new Error('Legacy Project term fields are unavailable.')
  return actions.createProject(draft)
}

function AcademicTermFields<T extends ConfigureProjectTermV9Input>({ value, onChange }: { value: T; onChange: (value: T) => void }) {
  return <>
    <label>學年度<input type="number" min="1" value={value.academicYear} onChange={(event) => onChange({ ...value, academicYear: Number(event.target.value) })} required /></label>
    <label>學期<select value={value.semester} onChange={(event) => onChange({ ...value, semester: event.target.value as SemesterKind })}><option value="first">第一學期</option><option value="second">第二學期</option><option value="summer">暑期</option><option value="custom">其他</option></select></label>
    {value.semester === 'custom' && <label className="full">自訂學期名稱<input value={value.customLabel} onChange={(event) => onChange({ ...value, customLabel: event.target.value })} required /></label>}
  </>
}
function TermFields({ value, onChange, requireDates = true }: { value: NewProjectInput; onChange: (value: NewProjectInput) => void; requireDates?: boolean }) {
  return <>
    <label className="full">專案名稱<input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} required /></label>
    <AcademicTermFields value={value} onChange={onChange} />
    {requireDates && <><label>起始日<input type="date" value={value.startDate} onChange={(event) => onChange({ ...value, startDate: event.target.value })} required /></label><label>結束日<input type="date" value={value.endDate} onChange={(event) => onChange({ ...value, endDate: event.target.value })} required /></label></>}
  </>
}

export interface ProjectLifecycleViewData {
  projects: ProjectV9[]
  activeProjectId: string | null
  teachingUnits: TeachingUnit[]
  migrationWarnings: MigrationWarningV4[]
}

type SharedProps = {
  data: ProjectLifecycleViewData
  actions: ProjectLifecycleActions
  onViewArchived?: (id: string) => void
  pending?: boolean
  readOnly?: boolean
  protectDrafts?: boolean
}

/** Presentation boundary: no document setter, storage hook, or runtime conversion. */
export function FirstUseView({ data, onViewArchived, actions, example, pending = false, readOnly = false,
  protectDrafts = false }: SharedProps & { example?: ReactNode }) {
  const [showCreate, setShowCreate] = useState(false)
  const [showExample, setShowExample] = useState(false)
  const [draft, setDraft] = useState(() => creationDraft(actions))
  const [error, setError] = useState('')
  const archived = data.projects.filter((item) => item.archivedAt)
  const busy = useRef(false)
  const cancel = () => {
    if (protectDrafts && (pending || busy.current)) return
    if (protectDrafts && draft.name && !window.confirm('尚有未儲存的專案草稿，確定捨棄？')) return
    if (protectDrafts) { setDraft(creationDraft(actions)); setError('') }
    setShowCreate(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (protectDrafts && (pending || readOnly || busy.current)) return
    busy.current = true
    try {
      await submitProject(actions, draft)
      setError('')
    } catch { setError(actions.creationMode === 'empty-v9'
      ? protectDrafts ? '專案尚未確認儲存，請確認名稱與儲存狀態；草稿已保留。' : '請確認專案名稱。'
      : '請確認專案名稱、授課教師姓名、學年度及學期日期。') }
    finally { busy.current = false }
  }

  return <section className="content first-use">
    <div className="first-use-hero"><p className="eyebrow">Toki・開始使用</p><h1>建立你的第一份課表</h1><p>{actions.creationMode === 'empty-v9' ? '建立空白專案，不會複製或預先建立其他資料。' : '第一個專案會建立預設學校、高中學制與 7 節課堂時間；範例只供預覽，不會寫入正式資料。'}</p><div className="first-use-actions"><button className="primary-button" disabled={pending || readOnly} onClick={() => { setShowCreate(true); setShowExample(false) }}><FolderPlus size={17} />建立第一個課表專案</button><button disabled={!example} onClick={() => { setShowExample(true); setShowCreate(false) }}><Eye size={17} />查看範例</button></div></div>
    {showCreate && <form className="panel form-grid onboarding-form" onSubmit={submit}><div className="full"><h2>第一個課表專案設定</h2><p>{actions.creationMode === 'empty-v9' ? '建立空白專案，不會複製或預先建立其他資料。' : '預設建立「我的學校／高中部」，不會複製任何既有資料。'}</p></div>{actions.creationMode === 'empty-v9' ? <label className="full">專案名稱<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label> : 'academicYear' in draft && <><TermFields value={draft} onChange={setDraft} /><label className="full">授課教師姓名<input value={draft.teacherName ?? ''} onChange={(event) => setDraft({ ...draft, teacherName: event.target.value })} required /></label></>}{error && <p className="form-error full">{error}</p>}<div className="form-actions full"><button type="button" disabled={pending} onClick={cancel}>取消</button><button className="primary-button" type="submit" disabled={pending || readOnly}>建立並開始</button></div></form>}
    {showExample && <section className="panel example-preview"><div className="panel-heading"><div><h2>唯讀範例</h2><p>此預覽不會建立專案或寫入 LocalStorage。</p></div><button onClick={() => setShowExample(false)}>關閉</button></div>{example}</section>}
    {archived.length > 0 && <section className="panel archived-projects"><div className="panel-heading"><div><h2>歷史專案</h2><p>可唯讀查看或重新啟用。</p></div></div>{archived.map((project) => <div className="project-history-row" key={project.id}><div><strong>{project.name}</strong><span>{project.term ? `${project.term.academicYear} 學年度・${project.term.semester}` : '尚未設定學期'}</span></div><button disabled={!onViewArchived} onClick={() => onViewArchived?.(project.id)}><Eye size={14} />查看</button><button disabled={pending || readOnly} onClick={async () => { try { await actions.reactivateProject(project.id) } catch { setError('目前無法重新啟用專案。') } }}><RotateCcw size={14} />重新啟用</button></div>)}</section>}
  </section>
}

export function ProjectLifecycleView({ data, initialPage = 'root', onClose, onViewArchived, actions,
  pending = false, readOnly = false, protectDrafts = false, renderAcademicSettings, deletionMessage }: SharedProps & {
  initialPage?: 'root' | 'blank' | 'term'
  onClose: () => void
  renderAcademicSettings?: (page: 'schools' | 'periods') => ReactNode
  deletionMessage: (projectId: string) => string
}) {
  const active = data.projects.find((item) => item.id === data.activeProjectId)
  const [name, setName] = useState(active?.name ?? '')
  const [draft, setDraft] = useState(() => creationDraft(actions))
  const [copySourceId, setCopySourceId] = useState(active?.id ?? data.projects[0]?.id ?? '')
  const [copyDraft, setCopyDraft] = useState<NewProjectInput>({ ...blankDraft(), startDate: '', endDate: '' })
  const [termDraft, setTermDraft] = useState<ConfigureProjectTermV9Input>({ academicYear: academicYearNow(), semester: 'first', customLabel: '' })
  const sourceUnits = useMemo(() => data.teachingUnits.filter((item) => item.projectId === copySourceId), [data.teachingUnits, copySourceId])
  const [unitDates, setUnitDates] = useState<Record<string, { sourceEffectiveDate: string; startDate: string; endDate: string; anchorDate: string; anchorPattern: 'A' | 'B' }>>({})
  const [error, setError] = useState('')
  const [page, setPage] = useState<'root' | 'name' | 'schools' | 'schools-settings' | 'blank' | 'copy' | 'term' | 'history' | Exclude<AcademicSettingsPage, 'classes' | 'subjects'>>(initialPage)
  const busy = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const initialCopy = useRef(JSON.stringify(copyDraft))
  const initialCopySource = useRef(copySourceId)
  const initialTerm = useRef(JSON.stringify(termDraft))
  const close = () => {
    if (protectDrafts && (pending || busy.current)) return
    const dirty = draft.name || name !== (active?.name ?? '') || JSON.stringify(copyDraft) !== initialCopy.current
      || JSON.stringify(termDraft) !== initialTerm.current
      || copySourceId !== initialCopySource.current
      || sourceUnits.some((unit) => unitDates[unit.id] && unitDates[unit.id].anchorPattern !== unit.weekCycle.anchorPattern)
      || Object.values(unitDates).some((value) => value.sourceEffectiveDate || value.startDate || value.endDate || value.anchorDate)
    if (protectDrafts && dirty && !window.confirm('尚有未儲存的專案草稿，確定捨棄？')) return
    onClose()
  }
  const locked = protectDrafts && (readOnly || pending || submitting)
  const run = async (operation: () => Promise<void>) => {
    if (!protectDrafts) { await operation(); return }
    if (protectDrafts && (readOnly || pending || busy.current)) return
    busy.current = true
    setSubmitting(true)
    try { await operation() } finally { busy.current = false; setSubmitting(false) }
  }
  useEffect(() => setName(active?.name ?? ''), [active])
  useEffect(() => setUnitDates(Object.fromEntries(sourceUnits.map((unit) => [unit.id, { sourceEffectiveDate: '', startDate: '', endDate: '', anchorDate: '', anchorPattern: unit.weekCycle.anchorPattern }]))), [sourceUnits])

  const submitBlank = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await submitProject(actions, draft)
      setError('')
      onClose()
    } catch { setError(actions.creationMode === 'empty-v9'
      ? protectDrafts ? '空白專案尚未確認儲存，請確認名稱與儲存狀態；草稿已保留。' : '請確認空白專案名稱。'
      : '請確認空白專案的名稱、授課教師姓名與日期。') }
  }
  const submitCopy = async (event: FormEvent) => {
    event.preventDefault()
    try {
      if (actions.copyRequiresSourceEffectiveDate && sourceUnits.some((unit) => !unitDates[unit.id]?.sourceEffectiveDate)) {
        setError('請為每個學制設定來源有效日期。')
        return
      }
      await actions.copyProject({ sourceProjectId: copySourceId, name: copyDraft.name, academicYear: copyDraft.academicYear, semester: copyDraft.semester, customLabel: copyDraft.customLabel, units: sourceUnits.map((unit) => ({ sourceUnitId: unit.id, ...unitDates[unit.id] })) })
      setError('')
      onClose()
    } catch (reason) {
      if (protectDrafts && actions.runtime === 'v9') {
        setError('複製尚未確認儲存，請確認來源學期、日期與儲存狀態；草稿已保留。')
        return
      }
      setError(reason instanceof Error && reason.message.includes('Versioned') ? '來源包含多版本固定課程，需在 LessonEditor 完成版本確認後才能安全複製。'
        : reason instanceof Error && reason.message.includes('Multiple or missing timetables') ? '多教師專案複製尚未支援，目前不會建立不完整副本。'
        : reason instanceof Error && reason.message.includes('subjects applicable') ? '來源課程使用了不適用目前學制的科目，請先檢查科目適用學制後再複製。'
          : '每個學制設定都必須設定新的起訖日期與 A/B anchor，且 anchor 必須位於新日期範圍內。')
    }
  }
  const submitTerm = async (event: FormEvent) => {
    event.preventDefault()
    if (!active || active.term !== null || !actions.configureTerm) return
    try {
      await actions.configureTerm(termDraft)
      setError('')
      onClose()
    } catch { setError('學期尚未確認儲存，請確認學年度、學期與儲存狀態；草稿已保留。') }
  }
  const remove = async (projectId: string) => {
    if (!window.confirm(deletionMessage(projectId))) return
    try { await actions.deleteProject(projectId) } catch { setError('目前無法安全刪除專案。') }
  }

  const goBack = () => setPage(['schools-settings', 'periods'].includes(page) ? 'schools' : 'root')
  const menuItem = (label: string, description: string, target: typeof page, disabled = false) => <button type="button" disabled={disabled || pending} className="settings-menu-item" onClick={() => setPage(target)}><span><strong>{label}</strong><small>{description}</small></span><ChevronRight size={17} /></button>

  const content = <>
    {page !== 'root' && <div className="settings-breadcrumb"><button type="button" onClick={goBack}><ChevronLeft size={15} />返回上一層</button></div>}
    {page === 'root' && <nav className="settings-menu" aria-label="專案管理">{active && menuItem('目前專案名稱', active.name, 'name')}{active?.term === null && actions.configureTerm && menuItem('學期設定', '設定學年度與學期', 'term')}{active && menuItem('學校與學制管理', '學校、學制與課堂時間表', 'schools', !renderAcademicSettings)}{data.projects.length > 0 && menuItem('複製為新學期', '複製固定設定並重新確認日期', 'copy')}{menuItem('歷史與專案管理', '封存、查看、重新啟用或刪除', 'history')}</nav>}
    {page === 'schools' && <nav className="settings-menu" aria-label="學校與學制管理">{menuItem('學校與學制', '建立或修改學校、識別色、日期與輪週規則', 'schools-settings')}{menuItem('課堂時間表', '管理所選學制的節次與起訖時間', 'periods')}</nav>}
    {page === 'schools-settings' && renderAcademicSettings?.('schools')}
    {page === 'periods' && renderAcademicSettings?.('periods')}
    {page === 'name' && active && <form className="form-grid compact-form" onSubmit={async (event) => { event.preventDefault(); if (!actions.renameProject) return; if (!name.trim()) { setError('專案名稱不得為空白。'); return } try { await actions.renameProject(active.id, name); setError('') } catch { setError('專案名稱未儲存，請重新確認。') } }}>{actions.renameProject && <label className="full">目前專案名稱<input value={name} onChange={(event) => setName(event.target.value)} required /></label>}<div className="form-actions full"><button type="button" className="danger-button" onClick={async () => { if (window.confirm(`封存「${active.name}」？封存後仍可唯讀查看及重新啟用。`)) { try { await actions.archiveProject(active.id); onClose() } catch { setError('目前無法封存專案。') } } }}><Archive size={14} />封存</button>{actions.renameProject && <button type="submit" className="primary-button">重新命名</button>}</div></form>}
    {page === 'term' && active?.term === null && actions.configureTerm && <form className="form-grid compact-form" onSubmit={(event) => { event.preventDefault(); void run(() => submitTerm(event)) }}><AcademicTermFields value={termDraft} onChange={setTermDraft} /><div className="form-actions full"><button type="button" onClick={close}>取消</button><button type="submit" className="primary-button">儲存學期</button></div></form>}
    {page === 'blank' && <form className="form-grid project-create-form" onSubmit={(event) => { event.preventDefault(); void run(() => submitBlank(event)) }}><div className="full"><strong>建立新專案</strong><p>{actions.creationMode === 'empty-v9' ? '建立完全空白的專案，不沿用目前專案資料。' : '使用固定預設，不沿用目前專案的學校、節次、班級或課程。'}</p></div>{actions.creationMode === 'empty-v9' ? <label className="full">專案名稱<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label> : 'academicYear' in draft && <><TermFields value={draft} onChange={setDraft} /><label className="full">授課教師姓名<input value={draft.teacherName ?? ''} onChange={(event) => setDraft({ ...draft, teacherName: event.target.value })} required /></label></>}<div className="form-actions full"><button type="button" onClick={close}>取消</button><button type="submit" className="primary-button">建立並切換</button></div></form>}
    {page === 'copy' && data.projects.length > 0 && <form className="form-grid project-create-form" onSubmit={(event) => { event.preventDefault(); void run(() => submitCopy(event)) }}><div className="full"><strong>複製為新學期</strong><p>複製學校、學制設定、節次、班級與固定課程；不複製事件、取消或單日異動。</p></div><label className="full">來源專案<select value={copySourceId} onChange={(event) => setCopySourceId(event.target.value)}>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><TermFields value={copyDraft} onChange={setCopyDraft} requireDates={false} />{sourceUnits.map((unit) => { const value = unitDates[unit.id] ?? { sourceEffectiveDate: '', startDate: '', endDate: '', anchorDate: '', anchorPattern: 'A' as const }; return <fieldset className="copy-unit-dates full" key={unit.id}><legend>{unit.name}</legend>{actions.copyRequiresSourceEffectiveDate && <label>來源有效日期<input type="date" value={value.sourceEffectiveDate} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, sourceEffectiveDate: event.target.value } })} required /></label>}<label>新起始日<input type="date" value={value.startDate} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, startDate: event.target.value } })} required /></label><label>新結束日<input type="date" value={value.endDate} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, endDate: event.target.value } })} required /></label><label>A/B anchor<input type="date" value={value.anchorDate} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, anchorDate: event.target.value } })} required /></label><label>anchor 週型<select value={value.anchorPattern} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, anchorPattern: event.target.value as 'A' | 'B' } })}><option value="A">A 週</option><option value="B">B 週</option></select></label></fieldset>})}<div className="form-actions full"><button type="submit" className="primary-button"><Copy size={14} />複製並切換</button></div></form>}
    {page === 'history' && <section className="archived-projects"><div><strong>歷史與專案管理</strong><p>封存專案可唯讀查看、重新啟用或永久刪除。</p></div>{data.projects.map((project) => <div className="project-history-row" key={project.id}><div><strong>{project.name}</strong><span>{project.archivedAt ? '已封存' : project.id === data.activeProjectId ? '使用中' : '可使用'}</span></div>{project.archivedAt && <><button disabled={!onViewArchived} onClick={() => { onViewArchived?.(project.id); onClose() }}><Eye size={14} />查看</button><button disabled={pending || readOnly} onClick={async () => { try { await actions.reactivateProject(project.id); onClose() } catch { setError('目前無法重新啟用專案。') } }}><RotateCcw size={14} />重新啟用</button></>}<button className="danger-button" onClick={() => void remove(project.id)}><Trash2 size={14} />刪除</button></div>)}</section>}
    {page === 'history' && data.migrationWarnings.length > 0 && <section className="migration-warning-list"><strong>資料遷移警告</strong><p>以下資料仍完整保留，不會自動套用或刪除。</p>{data.migrationWarnings.map((warning) => <div className="warning-row" key={warning.id}><div><strong>{warning.entityType === 'override' ? '未歸屬的單日異動' : '待確認資料'}</strong><p>紀錄 ID {warning.entityId}</p><p>{warning.message}</p></div></div>)}</section>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </>
  return <Modal title="專案設定" subtitle={page === 'root' ? '選擇要管理的項目。' : `目前位置：專案管理 / ${page === 'schools' ? '學校與學制管理' : page === 'schools-settings' ? '學校與學制管理 / 學校與學制' : page === 'periods' ? '學校與學制管理 / 課堂時間表' : page === 'name' ? '目前專案名稱' : page === 'blank' ? '建立新專案' : page === 'term' ? '學期設定' : page === 'copy' ? '複製為新學期' : '歷史與專案管理'}`} onClose={close}>
    <div className="project-settings">{protectDrafts
      ? <fieldset disabled={locked} style={{ display: 'contents' }}>{content}</fieldset> : content}</div>
  </Modal>
}

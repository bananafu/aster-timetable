import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Archive, ChevronLeft, ChevronRight, Copy, Eye, FolderPlus, RotateCcw, Trash2 } from 'lucide-react'
import { archiveProject, copyProject, createBlankProject, deleteProject, reactivateProject, renameProject, type NewProjectInput } from '../data/projectRuntime'
import { createExampleAppDataV4 } from '../hooks/useAppDataV4'
import type { StoragePersistence, StorageStatus } from '../hooks/useLocalStorage'
import { addDays, fromDateKey, startOfWeek, toDateKey } from '../lib/date'
import type { AppDataV4, SemesterKind } from '../types'
import { AcademicSettingsV4, type AcademicSettingsPage } from './AcademicSettingsV4'
import { Modal } from './Modal'
import { MultiSchoolSchedule } from './MultiSchoolSchedule'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const academicYearNow = () => Math.max(1, new Date().getFullYear() - 1911)
const blankDraft = (): NewProjectInput => ({ name: '', teacherName: '', academicYear: academicYearNow(), semester: 'first', customLabel: '', startDate: toDateKey(new Date()), endDate: toDateKey(addDays(new Date(), 120)) })

function TermFields({ value, onChange, requireDates = true }: { value: NewProjectInput; onChange: (value: NewProjectInput) => void; requireDates?: boolean }) {
  return <>
    <label className="full">專案名稱<input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} required /></label>
    <label>學年度<input type="number" min="1" value={value.academicYear} onChange={(event) => onChange({ ...value, academicYear: Number(event.target.value) })} required /></label>
    <label>學期<select value={value.semester} onChange={(event) => onChange({ ...value, semester: event.target.value as SemesterKind })}><option value="first">第一學期</option><option value="second">第二學期</option><option value="summer">暑期</option><option value="custom">其他</option></select></label>
    {value.semester === 'custom' && <label className="full">自訂學期名稱<input value={value.customLabel} onChange={(event) => onChange({ ...value, customLabel: event.target.value })} required /></label>}
    {requireDates && <><label>起始日<input type="date" value={value.startDate} onChange={(event) => onChange({ ...value, startDate: event.target.value })} required /></label><label>結束日<input type="date" value={value.endDate} onChange={(event) => onChange({ ...value, endDate: event.target.value })} required /></label></>}
  </>
}

function createBlank(data: AppDataV4, draft: NewProjectInput, setData: Dispatch<SetStateAction<AppDataV4>>, onSuccess?: () => void) {
  setData(createBlankProject(data, draft, uid))
  onSuccess?.()
}

export function FirstUse({ data, setData, onViewArchived }: { data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; onViewArchived: (id: string) => void }) {
  const [showCreate, setShowCreate] = useState(false)
  const [showExample, setShowExample] = useState(false)
  const [draft, setDraft] = useState(blankDraft)
  const [error, setError] = useState('')
  const example = useMemo(createExampleAppDataV4, [])
  const exampleWeek = useMemo(() => Array.from({ length: 5 }, (_, index) => addDays(startOfWeek(fromDateKey(example.teachingUnits[0].startDate)), index)), [example])
  const archived = data.projects.filter((item) => item.archivedAt)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    try { createBlank(data, draft, setData); setError('') } catch { setError('請確認專案名稱、授課教師姓名、學年度及學期日期。') }
  }

  return <section className="content first-use">
    <div className="first-use-hero"><p className="eyebrow">Toki・開始使用</p><h1>建立你的第一份課表</h1><p>第一個專案會建立預設學校、高中學制與 7 節課堂時間；範例只供預覽，不會寫入正式資料。</p><div className="first-use-actions"><button className="primary-button" onClick={() => { setShowCreate(true); setShowExample(false) }}><FolderPlus size={17} />建立第一個課表專案</button><button onClick={() => { setShowExample(true); setShowCreate(false) }}><Eye size={17} />查看範例</button></div></div>
    {showCreate && <form className="panel form-grid onboarding-form" onSubmit={submit}><div className="full"><h2>第一個課表專案設定</h2><p>預設建立「我的學校／高中部」，不會複製任何既有資料。</p></div><TermFields value={draft} onChange={setDraft} /><label className="full">授課教師姓名<input value={draft.teacherName ?? ''} onChange={(event) => setDraft({ ...draft, teacherName: event.target.value })} required /></label>{error && <p className="form-error full">{error}</p>}<div className="form-actions full"><button type="button" onClick={() => setShowCreate(false)}>取消</button><button className="primary-button" type="submit">建立並開始</button></div></form>}
    {showExample && <section className="panel example-preview"><div className="panel-heading"><div><h2>唯讀範例</h2><p>此預覽不會建立專案或寫入 LocalStorage。</p></div><button onClick={() => setShowExample(false)}>關閉</button></div><MultiSchoolSchedule data={example} weekDays={exampleWeek} /></section>}
    {archived.length > 0 && <section className="panel archived-projects"><div className="panel-heading"><div><h2>歷史專案</h2><p>可唯讀查看或重新啟用。</p></div></div>{archived.map((project) => <div className="project-history-row" key={project.id}><div><strong>{project.name}</strong><span>{project.term.academicYear} 學年度・{project.term.semester}</span></div><button onClick={() => onViewArchived(project.id)}><Eye size={14} />查看</button><button onClick={() => setData((current) => reactivateProject(current, project.id))}><RotateCcw size={14} />重新啟用</button></div>)}</section>}
  </section>
}

export function ProjectLifecycleModal({ data, setData, initialPage = 'root', onClose, onViewArchived, storageStatus = 'saved', storagePersistence = { pending: false, revision: 0 }, readOnly = false }: { data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; initialPage?: 'root' | 'blank'; onClose: () => void; onViewArchived: (id: string) => void; storageStatus?: StorageStatus; storagePersistence?: StoragePersistence; readOnly?: boolean }) {
  const active = data.projects.find((item) => item.id === data.activeProjectId)
  const [name, setName] = useState(active?.name ?? '')
  const [draft, setDraft] = useState(blankDraft)
  const [copySourceId, setCopySourceId] = useState(active?.id ?? data.projects[0]?.id ?? '')
  const [copyDraft, setCopyDraft] = useState<NewProjectInput>({ ...blankDraft(), startDate: '', endDate: '' })
  const sourceUnits = useMemo(() => data.teachingUnits.filter((item) => item.projectId === copySourceId), [data.teachingUnits, copySourceId])
  const [unitDates, setUnitDates] = useState<Record<string, { startDate: string; endDate: string; anchorDate: string; anchorPattern: 'A' | 'B' }>>({})
  const [error, setError] = useState('')
  const [page, setPage] = useState<'root' | 'name' | 'schools' | 'schools-settings' | 'blank' | 'copy' | 'history' | AcademicSettingsPage>(initialPage)
  useEffect(() => setName(active?.name ?? ''), [active])
  useEffect(() => setUnitDates(Object.fromEntries(sourceUnits.map((unit) => [unit.id, { startDate: '', endDate: '', anchorDate: '', anchorPattern: unit.weekCycle.anchorPattern }]))), [sourceUnits])

  const submitBlank = (event: FormEvent) => {
    event.preventDefault()
    try { createBlank(data, draft, setData, onClose) } catch { setError('請確認空白專案的名稱、授課教師姓名與日期。') }
  }
  const submitCopy = (event: FormEvent) => {
    event.preventDefault()
    try {
      setData(copyProject(data, { sourceProjectId: copySourceId, name: copyDraft.name, academicYear: copyDraft.academicYear, semester: copyDraft.semester, customLabel: copyDraft.customLabel, units: sourceUnits.map((unit) => ({ sourceUnitId: unit.id, ...unitDates[unit.id] })) }, uid))
      onClose()
    } catch (reason) {
      setError(reason instanceof Error && reason.message.includes('Versioned') ? '來源包含多版本固定課程，需在 LessonEditor 完成版本確認後才能安全複製。'
        : reason instanceof Error && reason.message.includes('Multiple or missing timetables') ? '多教師專案複製尚未支援，目前不會建立不完整副本。'
        : reason instanceof Error && reason.message.includes('subjects applicable') ? '來源課程使用了不適用目前學制的科目，請先檢查科目適用學制後再複製。'
          : '每個學制設定都必須設定新的起訖日期與 A/B anchor，且 anchor 必須位於新日期範圍內。')
    }
  }
  const remove = (projectId: string) => {
    const project = data.projects.find((item) => item.id === projectId)!
    const counts = {
      timetables: data.timetables?.filter((item) => item.projectId === projectId).length ?? 0,
      schools: data.schools.filter((item) => item.projectId === projectId).length,
      units: data.teachingUnits.filter((item) => item.projectId === projectId).length,
      classes: data.classes.filter((item) => item.projectId === projectId).length,
      lessons: data.recurringLessons.filter((item) => item.projectId === projectId).length,
      events: data.events.filter((item) => item.projectId === projectId).length,
      overrides: data.overrides.filter((item) => item.projectId === projectId).length,
    }
    if (!window.confirm(`永久刪除「${project.name}」？\n將刪除 ${counts.timetables} 份教師課表、${counts.schools} 所學校、${counts.units} 個學制設定、${counts.classes} 個班級、${counts.lessons} 筆固定課程、${counts.events} 筆事件及 ${counts.overrides} 筆異動。\n其他專案與全域科目不受影響。`)) return
    setData((current) => deleteProject(current, projectId))
  }

  const goBack = () => setPage(['schools-settings', 'periods', 'classes', 'subjects'].includes(page) ? 'schools' : 'root')
  const menuItem = (label: string, description: string, target: typeof page) => <button type="button" className="settings-menu-item" onClick={() => setPage(target)}><span><strong>{label}</strong><small>{description}</small></span><ChevronRight size={17} /></button>

  return <Modal title="專案設定" subtitle={page === 'root' ? '選擇要管理的項目。' : `目前位置：專案管理 / ${page === 'schools' ? '學校與學制管理' : page === 'schools-settings' ? '學校與學制管理 / 學校與學制' : page === 'periods' ? '學校與學制管理 / 課堂時間表' : page === 'classes' ? '學校與學制管理 / 班級' : page === 'subjects' ? '學校與學制管理 / 科目' : page === 'name' ? '目前專案名稱' : page === 'blank' ? '建立新專案' : page === 'copy' ? '複製為新學期' : '歷史與專案管理'}`} onClose={onClose}><div className="project-settings">
    {page !== 'root' && <div className="settings-breadcrumb"><button type="button" onClick={goBack}><ChevronLeft size={15} />返回上一層</button></div>}
    {page === 'root' && <nav className="settings-menu" aria-label="專案管理">{active && menuItem('目前專案名稱', active.name, 'name')}{active && menuItem('學校與學制管理', '課堂時間表、班級與科目', 'schools')}{menuItem('建立新專案', '使用明確預設建立全新專案', 'blank')}{data.projects.length > 0 && menuItem('複製為新學期', '複製固定設定並重新確認日期', 'copy')}{menuItem('歷史與專案管理', '封存、查看、重新啟用或刪除', 'history')}</nav>}
    {page === 'schools' && <nav className="settings-menu" aria-label="學校與學制管理">{menuItem('學校與學制', '建立或修改學校、識別色、日期與輪週規則', 'schools-settings')}{menuItem('課堂時間表', '管理所選學制的節次與起訖時間', 'periods')}{menuItem('班級', '管理所選學制的班級名單', 'classes')}{menuItem('科目', '管理共用科目與識別色', 'subjects')}</nav>}
    {page === 'schools-settings' && <AcademicSettingsV4 data={data} setData={setData} page="schools" />}
    {(page === 'periods' || page === 'classes' || page === 'subjects') && <AcademicSettingsV4 data={data} setData={setData} page={page} storageStatus={storageStatus} storagePersistence={storagePersistence} readOnly={readOnly} />}
    {page === 'name' && active && <form className="form-grid compact-form" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) { setError('專案名稱不得為空白。'); return } setData((current) => renameProject(current, active.id, name)); setError('') }}><label className="full">目前專案名稱<input value={name} onChange={(event) => setName(event.target.value)} required /></label><div className="form-actions full"><button type="button" className="danger-button" onClick={() => { if (window.confirm(`封存「${active.name}」？封存後仍可唯讀查看及重新啟用。`)) { setData((current) => archiveProject(current, active.id)); onClose() } }}><Archive size={14} />封存</button><button type="submit" className="primary-button">重新命名</button></div></form>}
    {page === 'blank' && <form className="form-grid project-create-form" onSubmit={submitBlank}><div className="full"><strong>建立新專案</strong><p>使用固定預設，不沿用目前專案的學校、節次、班級或課程。</p></div><TermFields value={draft} onChange={setDraft} /><label className="full">授課教師姓名<input value={draft.teacherName ?? ''} onChange={(event) => setDraft({ ...draft, teacherName: event.target.value })} required /></label><div className="form-actions full"><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary-button">建立並切換</button></div></form>}
    {page === 'copy' && data.projects.length > 0 && <form className="form-grid project-create-form" onSubmit={submitCopy}><div className="full"><strong>複製為新學期</strong><p>複製學校、學制設定、節次、班級與固定課程；不複製事件、取消或單日異動。</p></div><label className="full">來源專案<select value={copySourceId} onChange={(event) => setCopySourceId(event.target.value)}>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><TermFields value={copyDraft} onChange={setCopyDraft} requireDates={false} />{sourceUnits.map((unit) => { const value = unitDates[unit.id] ?? { startDate: '', endDate: '', anchorDate: '', anchorPattern: 'A' as const }; return <fieldset className="copy-unit-dates full" key={unit.id}><legend>{unit.name}</legend><label>新起始日<input type="date" value={value.startDate} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, startDate: event.target.value } })} required /></label><label>新結束日<input type="date" value={value.endDate} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, endDate: event.target.value } })} required /></label><label>A/B anchor<input type="date" value={value.anchorDate} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, anchorDate: event.target.value } })} required /></label><label>anchor 週型<select value={value.anchorPattern} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, anchorPattern: event.target.value as 'A' | 'B' } })}><option value="A">A 週</option><option value="B">B 週</option></select></label></fieldset>})}<div className="form-actions full"><button type="submit" className="primary-button"><Copy size={14} />複製並切換</button></div></form>}
    {page === 'history' && <section className="archived-projects"><div><strong>歷史與專案管理</strong><p>封存專案可唯讀查看、重新啟用或永久刪除。</p></div>{data.projects.map((project) => <div className="project-history-row" key={project.id}><div><strong>{project.name}</strong><span>{project.archivedAt ? '已封存' : project.id === data.activeProjectId ? '使用中' : '可使用'}</span></div>{project.archivedAt && <><button onClick={() => { onViewArchived(project.id); onClose() }}><Eye size={14} />查看</button><button onClick={() => { setData((current) => reactivateProject(current, project.id)); onClose() }}><RotateCcw size={14} />重新啟用</button></>}<button className="danger-button" onClick={() => remove(project.id)}><Trash2 size={14} />刪除</button></div>)}</section>}
    {page === 'history' && data.migrationWarnings.length > 0 && <section className="migration-warning-list"><strong>資料遷移警告</strong><p>以下資料仍完整保留，不會自動套用或刪除。</p>{data.migrationWarnings.map((warning) => <div className="warning-row" key={warning.id}><div><strong>{warning.entityType === 'override' ? '未歸屬的單日異動' : '待確認資料'}</strong><p>紀錄 ID {warning.entityId}</p><p>{warning.message}</p></div></div>)}</section>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div></Modal>
}

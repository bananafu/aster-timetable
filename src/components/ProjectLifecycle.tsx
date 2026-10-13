import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { Archive, Copy, Eye, FolderPlus, RotateCcw, Trash2 } from 'lucide-react'
import { archiveProject, copyProject, createBlankProject, deleteProject, reactivateProject, renameProject, type NewProjectInput } from '../data/projectRuntime'
import { createExampleAppDataV4 } from '../hooks/useAppDataV4'
import { addDays, fromDateKey, startOfWeek, toDateKey } from '../lib/date'
import type { AppDataV4, SemesterKind } from '../types'
import { AcademicSettingsV4 } from './AcademicSettingsV4'
import { Modal } from './Modal'
import { MultiSchoolSchedule } from './MultiSchoolSchedule'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const academicYearNow = () => Math.max(1, new Date().getFullYear() - 1911)
const blankDraft = (): NewProjectInput => ({ name: '', academicYear: academicYearNow(), semester: 'first', customLabel: '', startDate: toDateKey(new Date()), endDate: toDateKey(addDays(new Date(), 120)) })

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
    try { createBlank(data, draft, setData); setError('') } catch { setError('請確認專案名稱、學年度及學期日期。') }
  }

  return <section className="content first-use">
    <div className="first-use-hero"><p className="eyebrow">Toki・開始使用</p><h1>建立你的第一份課表</h1><p>空白專案使用明確的預設學校、任教單位與 7 節高中節次；範例只供預覽，不會寫入正式資料。</p><div className="first-use-actions"><button className="primary-button" onClick={() => { setShowCreate(true); setShowExample(false) }}><FolderPlus size={17} />建立空白課表</button><button onClick={() => { setShowExample(true); setShowCreate(false) }}><Eye size={17} />查看範例</button></div></div>
    {showCreate && <form className="panel form-grid onboarding-form" onSubmit={submit}><div className="full"><h2>空白課表設定</h2><p>預設建立「我的學校／主要任教單位」，不會複製任何既有資料。</p></div><TermFields value={draft} onChange={setDraft} />{error && <p className="form-error full">{error}</p>}<div className="form-actions full"><button type="button" onClick={() => setShowCreate(false)}>取消</button><button className="primary-button" type="submit">建立並開始</button></div></form>}
    {showExample && <section className="panel example-preview"><div className="panel-heading"><div><h2>唯讀範例</h2><p>此預覽不會建立專案或寫入 LocalStorage。</p></div><button onClick={() => setShowExample(false)}>關閉</button></div><MultiSchoolSchedule data={example} weekDays={exampleWeek} /></section>}
    {archived.length > 0 && <section className="panel archived-projects"><div className="panel-heading"><div><h2>歷史專案</h2><p>可唯讀查看或重新啟用。</p></div></div>{archived.map((project) => <div className="project-history-row" key={project.id}><div><strong>{project.name}</strong><span>{project.term.academicYear} 學年度・{project.term.semester}</span></div><button onClick={() => onViewArchived(project.id)}><Eye size={14} />查看</button><button onClick={() => setData((current) => reactivateProject(current, project.id))}><RotateCcw size={14} />重新啟用</button></div>)}</section>}
  </section>
}

export function ProjectLifecycleModal({ data, setData, onClose, onViewArchived }: { data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; onClose: () => void; onViewArchived: (id: string) => void }) {
  const active = data.projects.find((item) => item.id === data.activeProjectId)
  const [name, setName] = useState(active?.name ?? '')
  const [draft, setDraft] = useState(blankDraft)
  const [copySourceId, setCopySourceId] = useState(active?.id ?? data.projects[0]?.id ?? '')
  const [copyDraft, setCopyDraft] = useState<NewProjectInput>({ ...blankDraft(), startDate: '', endDate: '' })
  const sourceUnits = useMemo(() => data.teachingUnits.filter((item) => item.projectId === copySourceId), [data.teachingUnits, copySourceId])
  const [unitDates, setUnitDates] = useState<Record<string, { startDate: string; endDate: string; anchorDate: string; anchorPattern: 'A' | 'B' }>>({})
  const [error, setError] = useState('')
  useEffect(() => setName(active?.name ?? ''), [active])
  useEffect(() => setUnitDates(Object.fromEntries(sourceUnits.map((unit) => [unit.id, { startDate: '', endDate: '', anchorDate: '', anchorPattern: unit.weekCycle.anchorPattern }]))), [sourceUnits])

  const submitBlank = (event: FormEvent) => {
    event.preventDefault()
    try { createBlank(data, draft, setData, onClose) } catch { setError('請確認空白專案的名稱與日期。') }
  }
  const submitCopy = (event: FormEvent) => {
    event.preventDefault()
    try {
      setData(copyProject(data, { sourceProjectId: copySourceId, name: copyDraft.name, academicYear: copyDraft.academicYear, semester: copyDraft.semester, customLabel: copyDraft.customLabel, units: sourceUnits.map((unit) => ({ sourceUnitId: unit.id, ...unitDates[unit.id] })) }, uid))
      onClose()
    } catch (reason) {
      setError(reason instanceof Error && reason.message.includes('Versioned') ? '來源包含多版本固定課程，需在 LessonEditor 完成版本確認後才能安全複製。' : '每個任教單位都必須設定新的起訖日期與 A/B anchor，且 anchor 必須位於新日期範圍內。')
    }
  }
  const remove = (projectId: string) => {
    const project = data.projects.find((item) => item.id === projectId)!
    const counts = {
      schools: data.schools.filter((item) => item.projectId === projectId).length,
      units: data.teachingUnits.filter((item) => item.projectId === projectId).length,
      classes: data.classes.filter((item) => item.projectId === projectId).length,
      lessons: data.recurringLessons.filter((item) => item.projectId === projectId).length,
      events: data.events.filter((item) => item.projectId === projectId).length,
      overrides: data.overrides.filter((item) => item.projectId === projectId).length,
    }
    if (!window.confirm(`永久刪除「${project.name}」？\n將刪除 ${counts.schools} 所學校、${counts.units} 個任教單位、${counts.classes} 個班級、${counts.lessons} 筆固定課程、${counts.events} 筆事件及 ${counts.overrides} 筆異動。\n其他專案與全域科目不受影響。`)) return
    setData((current) => deleteProject(current, projectId))
  }

  return <Modal title="課表專案" subtitle="專案名稱、學年度與學期彼此獨立。" onClose={onClose}><div className="project-settings">
    {active && <><form className="form-grid compact-form" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) { setError('專案名稱不得為空白。'); return } setData((current) => renameProject(current, active.id, name)); setError('') }}><label className="full">目前專案名稱<input value={name} onChange={(event) => setName(event.target.value)} required /></label><div className="form-actions full"><button type="button" className="danger-button" onClick={() => { if (window.confirm(`封存「${active.name}」？封存後仍可唯讀查看及重新啟用。`)) { setData((current) => archiveProject(current, active.id)); onClose() } }}><Archive size={14} />封存</button><button type="submit" className="primary-button">重新命名</button></div></form><AcademicSettingsV4 data={data} setData={setData} /></>}
    <form className="form-grid project-create-form" onSubmit={submitBlank}><div className="full"><strong>建立空白課表</strong><p>使用固定預設，不沿用目前專案的學校、節次、班級或課程。</p></div><TermFields value={draft} onChange={setDraft} /><div className="form-actions full"><button type="submit" className="primary-button">建立並切換</button></div></form>
    {data.projects.length > 0 && <form className="form-grid project-create-form" onSubmit={submitCopy}><div className="full"><strong>複製為新學期</strong><p>複製學校、任教單位、節次、班級與固定課程；不複製事件、取消或單日異動。</p></div><label className="full">來源專案<select value={copySourceId} onChange={(event) => setCopySourceId(event.target.value)}>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><TermFields value={copyDraft} onChange={setCopyDraft} requireDates={false} />{sourceUnits.map((unit) => { const value = unitDates[unit.id] ?? { startDate: '', endDate: '', anchorDate: '', anchorPattern: 'A' as const }; return <fieldset className="copy-unit-dates full" key={unit.id}><legend>{unit.name}</legend><label>新起始日<input type="date" value={value.startDate} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, startDate: event.target.value } })} required /></label><label>新結束日<input type="date" value={value.endDate} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, endDate: event.target.value } })} required /></label><label>A/B anchor<input type="date" value={value.anchorDate} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, anchorDate: event.target.value } })} required /></label><label>anchor 週型<select value={value.anchorPattern} onChange={(event) => setUnitDates({ ...unitDates, [unit.id]: { ...value, anchorPattern: event.target.value as 'A' | 'B' } })}><option value="A">A 週</option><option value="B">B 週</option></select></label></fieldset>})}<div className="form-actions full"><button type="submit" className="primary-button"><Copy size={14} />複製並切換</button></div></form>}
    <section className="archived-projects"><div><strong>歷史與專案管理</strong><p>封存專案可唯讀查看、重新啟用或永久刪除。</p></div>{data.projects.map((project) => <div className="project-history-row" key={project.id}><div><strong>{project.name}</strong><span>{project.archivedAt ? '已封存' : project.id === data.activeProjectId ? '使用中' : '可使用'}</span></div>{project.archivedAt && <><button onClick={() => { onViewArchived(project.id); onClose() }}><Eye size={14} />查看</button><button onClick={() => { setData((current) => reactivateProject(current, project.id)); onClose() }}><RotateCcw size={14} />重新啟用</button></>}<button className="danger-button" onClick={() => remove(project.id)}><Trash2 size={14} />刪除</button></div>)}</section>
    {data.migrationWarnings.length > 0 && <section className="migration-warning-list"><strong>資料遷移警告</strong><p>以下資料仍完整保留，不會自動套用或刪除。</p>{data.migrationWarnings.map((warning) => <div className="warning-row" key={warning.id}><div><strong>{warning.entityType === 'override' ? '未歸屬的單日異動' : '待確認資料'}</strong><p>紀錄 ID {warning.entityId}</p><p>{warning.message}</p></div></div>)}</section>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div></Modal>
}

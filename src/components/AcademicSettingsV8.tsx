import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type { AppDataV8, SchoolLevel } from '../types'
import type { AppDataV8Persistence, AppDataV8RuntimeStatus } from '../hooks/useAppDataV8'
import { createSchoolV8, createTeachingUnitV8, updateSchoolV8, updateTeachingUnitV8,
  type SchoolV8Draft, type TeachingUnitV8Draft } from '../data/academicSettingsV8'
import { Modal } from './Modal'
import { ChevronLeft } from 'lucide-react'
import { previewReadOnlyMessage } from '../previewReadOnlyV8'

type Props = { data: AppDataV8; setData: Dispatch<SetStateAction<AppDataV8>>; status: AppDataV8RuntimeStatus;
  persistence: AppDataV8Persistence; writable: boolean; exportLocalJson: () => string;
  onExport?: (raw: string) => void; onClose: () => void }
type Mode = 'school' | 'unit' | null
const blankSchool = (): SchoolV8Draft => ({ name: '', color: '#A5A051' })
const blankUnit = (schoolId = ''): TeachingUnitV8Draft => ({ schoolId, name: '', schoolLevel: 'senior-high',
  startDate: '', endDate: '', periods: [{ id: 1, order: 1, label: '第 1 節', startTime: '08:10', endTime: '09:00' }],
  weekCycle: { enabled: true, anchorDate: '', anchorPattern: 'A' } })

export function AcademicSettingsV8({ data, setData, status, persistence, writable, exportLocalJson,
  onExport, onClose }: Props) {
  const projectId = data.activeProjectId
  const schools = data.schools.filter((item) => item.projectId === projectId)
  const units = data.teachingUnits.filter((item) => item.projectId === projectId)
  const [mode, setMode] = useState<Mode>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [schoolDraft, setSchoolDraft] = useState<SchoolV8Draft>(blankSchool)
  const [unitDraft, setUnitDraft] = useState<TeachingUnitV8Draft>(() => blankUnit(schools[0]?.id))
  const [formProjectId, setFormProjectId] = useState<string | null>(null)
  const [formRaw, setFormRaw] = useState<string | null>(null)
  const [expectedRaw, setExpectedRaw] = useState<string | null>(null)
  const [startedRevision, setStartedRevision] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const canWrite = writable && status === 'saved' && !persistence.pending && !expectedRaw
  const dirty = mode === 'school' ? JSON.stringify(schoolDraft) !== JSON.stringify(blankSchool())
    : mode === 'unit' ? JSON.stringify(unitDraft) !== JSON.stringify(blankUnit(unitDraft.schoolId)) : false

  useEffect(() => {
    if (!expectedRaw) return
    if (status === 'saved' && !persistence.pending && persistence.receipt
      && persistence.revision > startedRevision && persistence.receipt.revision === persistence.revision
      && persistence.receipt.raw === expectedRaw && JSON.stringify(data) === expectedRaw) {
      setExpectedRaw(null); setMode(null); setEditingId(null); setSuccess('V8 教學設定已確認儲存。')
    } else if (status !== 'saved') {
      setExpectedRaw(null); setError('寫入未確認；設定草稿已保留。')
    }
  }, [data, expectedRaw, persistence.pending, persistence.receipt, persistence.revision, startedRevision, status])

  const discard = () => !dirty || window.confirm('捨棄尚未儲存的教學設定草稿？')
  const beginSchool = (id: string | null) => {
    if (!canWrite || !discard()) return
    const item = schools.find((school) => school.id === id)
    setSchoolDraft(item ? { name: item.name, color: item.color } : blankSchool())
    setMode('school'); setEditingId(id); setFormProjectId(projectId); setFormRaw(JSON.stringify(data)); setError('')
  }
  const beginUnit = (id: string | null) => {
    if (!canWrite || !discard()) return
    const item = units.find((unit) => unit.id === id)
    setUnitDraft(item ? { schoolId: item.schoolId, name: item.name, schoolLevel: item.schoolLevel,
      startDate: item.startDate, endDate: item.endDate, periods: item.periods.map((period) => ({ ...period })),
      weekCycle: { ...item.weekCycle } } : blankUnit(schools[0]?.id))
    setMode('unit'); setEditingId(id); setFormProjectId(projectId); setFormRaw(JSON.stringify(data)); setError('')
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!canWrite || !projectId || projectId !== formProjectId || JSON.stringify(data) !== formRaw) {
      setError('專案或文件已變更；草稿保留，請重新確認目標。'); return
    }
    try {
      const next = mode === 'school' ? editingId
        ? updateSchoolV8(data, projectId, editingId, schoolDraft)
        : createSchoolV8(data, projectId, schoolDraft, crypto.randomUUID())
        : mode === 'unit' ? editingId
          ? updateTeachingUnitV8(data, projectId, editingId, unitDraft)
          : createTeachingUnitV8(data, projectId, unitDraft, crypto.randomUUID()) : null
      if (!next) return
      setError(''); setSuccess(''); setStartedRevision(persistence.revision)
      setExpectedRaw(JSON.stringify(next)); setData(next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '設定資料無效。') }
  }
  const period = (index: number, patch: Partial<TeachingUnitV8Draft['periods'][number]>) =>
    setUnitDraft((current) => ({ ...current, periods: current.periods.map((item, offset) => offset === index
      ? { ...item, ...patch } : item) }))
  const addPeriod = () => {
    const last = [...unitDraft.periods].sort((a, b) => b.endTime.localeCompare(a.endTime))[0]
    const endMinutes = last ? Number(last.endTime.slice(0, 2)) * 60 + Number(last.endTime.slice(3)) : 8 * 60
    const start = endMinutes + 10
    if (start + 50 > 23 * 60 + 55) { setError('當日沒有足夠時間新增 50 分鐘節次。'); return }
    const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    const id = Math.max(0, ...unitDraft.periods.map((item) => item.id)) + 1
    const order = Math.max(0, ...unitDraft.periods.map((item) => item.order)) + 1
    setUnitDraft({ ...unitDraft, periods: [...unitDraft.periods, { id, order, label: `第 ${order} 節`,
      startTime: clock(start), endTime: clock(start + 50) }] })
  }
  return <Modal title="V8 學校與任教單位設定" subtitle={`目前專案：${data.projects.find((item) => item.id === projectId)?.name ?? '無'}`} onClose={() => { if (discard()) onClose() }}><div className="project-settings preview-academic-settings">
    {!canWrite && <div role="status" className="preview-readonly-notice">{previewReadOnlyMessage(status)}<button onClick={() => onExport?.(exportLocalJson())}>匯出本頁 JSON</button>
      <details><summary>診斷資訊</summary><code>{status}</code></details></div>}
    {!mode && <><section className="preview-management-section"><div className="preview-section-heading"><div><h3>學校</h3><p>管理學校名稱及識別色。</p></div><button disabled={!canWrite || !projectId} onClick={() => beginSchool(null)}>新增學校</button></div>
      {schools.map((item) => <div className="project-history-row" key={item.id}>
        <div><strong>{item.name}</strong><span>學校識別色：{item.color}</span></div><button disabled={!canWrite} onClick={() => beginSchool(item.id)}>編輯學校</button></div>)}
      {!schools.length && <p className="settings-empty">目前專案尚無學校。</p>}</section>
    <section className="preview-management-section"><div className="preview-section-heading"><div><h3>任教單位</h3><p>各單位獨立設定學期、A/B 週錨點與節次時間。</p></div><button disabled={!canWrite || !projectId || !schools.length} onClick={() => beginUnit(null)}>新增任教單位</button></div>
      {units.map((item) => <div className="project-history-row" key={item.id}><div><strong>{item.name}</strong>
        <span>{schools.find((school) => school.id === item.schoolId)?.name}・{item.schoolLevel}</span>
        <span>學期 {item.startDate}～{item.endDate}</span>
        <span>{item.weekCycle.anchorPattern} 週錨點 {item.weekCycle.anchorDate}・{item.periods.length} 節</span></div>
        <button disabled={!canWrite} onClick={() => beginUnit(item.id)}>編輯任教單位</button></div>)}
      {!units.length && <p className="settings-empty">目前專案尚無任教單位。</p>}</section></>}
    {mode && <form className="form-grid" aria-label="V8 教學設定表單" onSubmit={save}>
      <div className="settings-breadcrumb full"><button type="button" onClick={() => { if (discard()) setMode(null) }}><ChevronLeft size={15} />返回設定清單</button></div>
      <h3 className="full">{editingId ? '編輯' : '新增'}{mode === 'school' ? '學校' : '任教單位'}</h3>
      {mode === 'school' ? <><label>學校名稱<input required value={schoolDraft.name} onChange={(event) => setSchoolDraft({ ...schoolDraft, name: event.target.value })} /></label>
        <label>學校顏色<input type="color" value={schoolDraft.color} onChange={(event) => setSchoolDraft({ ...schoolDraft, color: event.target.value })} /></label></>
        : <><label>所屬學校<select value={unitDraft.schoolId} onChange={(event) => setUnitDraft({ ...unitDraft, schoolId: event.target.value })}>
          {schools.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>任教單位名稱<input required value={unitDraft.name} onChange={(event) => setUnitDraft({ ...unitDraft, name: event.target.value })} /></label>
          <label>學制<select value={unitDraft.schoolLevel} onChange={(event) => setUnitDraft({ ...unitDraft, schoolLevel: event.target.value as SchoolLevel })}>
            <option value="senior-high">高中</option><option value="junior-high">國中</option><option value="other">其他</option></select></label>
          <label>學期起始日<input required type="date" value={unitDraft.startDate} onChange={(event) => setUnitDraft({ ...unitDraft, startDate: event.target.value })} /></label>
          <label>學期結束日<input required type="date" value={unitDraft.endDate} onChange={(event) => setUnitDraft({ ...unitDraft, endDate: event.target.value })} /></label>
          <label>A/B 錨點日期<input required type="date" value={unitDraft.weekCycle.anchorDate} onChange={(event) => setUnitDraft({ ...unitDraft,
            weekCycle: { ...unitDraft.weekCycle, anchorDate: event.target.value } })} /></label>
          <label>錨點週型<select value={unitDraft.weekCycle.anchorPattern} onChange={(event) => setUnitDraft({ ...unitDraft,
            weekCycle: { ...unitDraft.weekCycle, anchorPattern: event.target.value as 'A' | 'B' } })}>
            <option value="A">A 週</option><option value="B">B 週</option></select></label>
          <label>啟用 A/B 輪週<input type="checkbox" checked={unitDraft.weekCycle.enabled} onChange={(event) => setUnitDraft({ ...unitDraft,
            weekCycle: { ...unitDraft.weekCycle, enabled: event.target.checked } })} /></label>
          <fieldset className="full preview-period-settings"><legend>節次與實際時間</legend>{unitDraft.periods.map((item, index) => <div className="project-history-row" key={item.id}>
            <label>節次名稱<input value={item.label} onChange={(event) => period(index, { label: event.target.value })} /></label>
            <label>開始時間<input type="time" step="300" value={item.startTime} onChange={(event) => period(index, { startTime: event.target.value })} /></label>
            <label>結束時間<input type="time" step="300" value={item.endTime} onChange={(event) => period(index, { endTime: event.target.value })} /></label>
            <button type="button" disabled={unitDraft.periods.length <= 1} onClick={() => setUnitDraft({ ...unitDraft, periods: unitDraft.periods.filter((_, offset) => offset !== index) })}>移除節次</button>
          </div>)}<button type="button" onClick={addPeriod}>新增節次</button></fieldset>
        </>}
      <div className="form-actions full"><button type="button" onClick={() => { if (discard()) setMode(null) }}>取消編輯</button>
        <button className="primary-button" type="submit" disabled={!canWrite}>儲存設定</button></div>
    </form>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {success && <p role="status">{success}</p>}
  </div></Modal>
}

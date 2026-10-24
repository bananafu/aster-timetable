import { useState, type FormEvent } from 'react'
import type { AppDataV9 } from '../types/v9'
import type { SchoolLevel } from '../types'
import { gradesForLevel } from '../lib/classes'
import { createClassV9, createSchoolV9, createTeachingUnitV9, deleteClassV9,
  getClassV9Impact, updateClassV9, updateSchoolV9, updateTeachingUnitV9 } from '../data/managementV9'
import type { ClassV8Draft } from '../data/classesV8'
import type { SchoolV8Draft, TeachingUnitV8Draft } from '../data/academicSettingsV8'
import { Modal } from './Modal'

type Section = 'settings' | 'classes'
type Mode = 'school' | 'unit' | 'class' | null
type Props = {
  data: AppDataV9
  projectId: string
  section: Section
  writable: boolean
  onClose: () => void
  onCommit: (label: string, produce: (current: AppDataV9) => AppDataV9, expectedRaw: string) => Promise<boolean>
}
const id = () => crypto.randomUUID()
const blankSchool = (): SchoolV8Draft => ({ name: '', color: '#A5A051' })
const blankUnit = (data: AppDataV9, projectId: string): TeachingUnitV8Draft => {
  const source = data.teachingUnits.find((item) => item.projectId === projectId)
  const schoolId = data.schools.find((item) => item.projectId === projectId)?.id ?? ''
  return { schoolId, name: '', schoolLevel: 'senior-high', startDate: source?.startDate ?? '',
    endDate: source?.endDate ?? '', periods: source?.periods.map((item) => ({ ...item })) ??
      [{ id: 1, order: 1, label: '第 1 節', startTime: '08:10', endTime: '09:00' }],
    weekCycle: { enabled: true, anchorDate: source?.weekCycle.anchorDate ?? '', anchorPattern: 'A' } }
}
const blankClass = (unitId = ''): ClassV8Draft => ({ teachingUnitId: unitId, grade: undefined, classNumber: 1, name: '' })

/** Existing Modal/form visual system, with V9 Host persistence supplied by the workspace. */
export function AcademicClassManagerV9({ data, projectId, section, writable, onClose, onCommit }: Props) {
  const schools = data.schools.filter((item) => item.projectId === projectId)
  const units = data.teachingUnits.filter((item) => item.projectId === projectId)
  const classes = data.classes.filter((item) => item.projectId === projectId)
  const [mode, setMode] = useState<Mode>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [schoolDraft, setSchoolDraft] = useState<SchoolV8Draft>(blankSchool)
  const [unitDraft, setUnitDraft] = useState<TeachingUnitV8Draft>(() => blankUnit(data, projectId))
  const [classDraft, setClassDraft] = useState<ClassV8Draft>(() => blankClass(units[0]?.id))
  const [formRaw, setFormRaw] = useState('')
  const [initialDraft, setInitialDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const activeDraft = mode === 'school' ? schoolDraft : mode === 'unit' ? unitDraft : classDraft
  const dirty = !!mode && JSON.stringify(activeDraft) !== initialDraft
  const discard = () => !dirty || window.confirm('尚有未儲存草稿，確定捨棄？')
  const close = () => { if (discard()) onClose() }
  const begin = (nextMode: Exclude<Mode, null>, targetId: string | null) => {
    if (!writable || busy || !discard()) return
    if (nextMode === 'school') {
      const item = schools.find((school) => school.id === targetId)
      const draft = item ? { name: item.name, color: item.color } : blankSchool()
      setSchoolDraft(draft); setInitialDraft(JSON.stringify(draft))
    } else if (nextMode === 'unit') {
      const item = units.find((unit) => unit.id === targetId)
      const draft = item ? { schoolId: item.schoolId, name: item.name, schoolLevel: item.schoolLevel,
        startDate: item.startDate, endDate: item.endDate, periods: item.periods.map((period) => ({ ...period })),
        weekCycle: { ...item.weekCycle } } : blankUnit(data, projectId)
      setUnitDraft(draft); setInitialDraft(JSON.stringify(draft))
    } else {
      const item = classes.find((schoolClass) => schoolClass.id === targetId)
      const draft = item ? { teachingUnitId: item.teachingUnitId, name: item.name,
        grade: item.grade, classNumber: item.classNumber, room: item.room } : blankClass(units[0]?.id)
      setClassDraft(draft); setInitialDraft(JSON.stringify(draft))
    }
    setMode(nextMode); setEditingId(targetId); setFormRaw(JSON.stringify(data)); setMessage('')
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!writable || busy || !mode) return
    if (JSON.stringify(data) !== formRaw) { setMessage('資料已變更；草稿保留，請重新開啟表單確認。'); return }
    setBusy(true); setMessage('')
    const currentMode = mode
    const success = await onCommit('管理資料已保存', (current) => {
      if (currentMode === 'school') return editingId
        ? updateSchoolV9(current, projectId, editingId, schoolDraft)
        : createSchoolV9(current, projectId, schoolDraft, id())
      if (currentMode === 'unit') return editingId
        ? updateTeachingUnitV9(current, projectId, editingId, unitDraft)
        : createTeachingUnitV9(current, projectId, unitDraft, id())
      return editingId ? updateClassV9(current, projectId, editingId, classDraft)
        : createClassV9(current, projectId, classDraft, id())
    }, formRaw)
    setBusy(false)
    if (success) { setMode(null); setEditingId(null); setMessage('已確認保存；可繼續新增或編輯。') }
    else setMessage('未確認儲存，草稿已保留；請檢查畫面狀態或匯出資料。')
  }
  const removeClass = async (classId: string) => {
    if (!writable || busy) return
    const impact = getClassV9Impact(data, projectId, classId)
    if (impact.recurringLessons || impact.oneOffLessons || impact.overrides || impact.teachingProgress) {
      setMessage('班級仍有課程、異動或進度引用，不可刪除。'); return
    }
    if (!window.confirm(`刪除班級「${impact.schoolClass.name}」？此操作不會刪除其他任教單位或教師資料。`)) return
    setBusy(true)
    const success = await onCommit('已刪除班級', (current) => deleteClassV9(current, projectId, classId, true), JSON.stringify(data))
    setBusy(false); setMessage(success ? '班級已確認刪除。' : '刪除未確認，原始資料仍保留。')
  }
  const period = (index: number, patch: Partial<TeachingUnitV8Draft['periods'][number]>) =>
    setUnitDraft((draft) => ({ ...draft, periods: draft.periods.map((item, offset) => offset === index
      ? { ...item, ...patch } : item) }))
  const addPeriod = () => {
    const last = [...unitDraft.periods].sort((a, b) => b.endTime.localeCompare(a.endTime))[0]
    const endMinutes = last ? Number(last.endTime.slice(0, 2)) * 60 + Number(last.endTime.slice(3)) : 8 * 60
    const start = endMinutes + 10
    if (start + 50 > 23 * 60 + 55) { setMessage('當日沒有足夠時間新增 50 分鐘節次。'); return }
    const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    const id = Math.max(0, ...unitDraft.periods.map((item) => item.id)) + 1
    const order = Math.max(0, ...unitDraft.periods.map((item) => item.order)) + 1
    setUnitDraft({ ...unitDraft, periods: [...unitDraft.periods, { id, order, label: `第 ${order} 節`,
      startTime: clock(start), endTime: clock(start + 50) }] })
  }
  const selectedUnit = units.find((item) => item.id === classDraft.teachingUnitId)
  const grades = gradesForLevel(selectedUnit?.schoolLevel ?? 'other')
  return <Modal title={section === 'settings' ? '學校與任教單位管理' : '班級管理'}
    subtitle={`目前專案：${data.projects.find((item) => item.id === projectId)?.name ?? '無'}`} onClose={close}>
    <div className="project-settings preview-academic-settings">
      {!writable && <p role="alert" className="form-error">目前為唯讀或資料衝突狀態，所有管理寫入均已停止；可從進階資料管理匯出。</p>}
      {message && <p role="status" className={message.includes('未確認') || message.includes('不可') ? 'form-error' : undefined}>{message}</p>}
      {mode === null && (section === 'settings' ? <>
        <section className="preview-management-section"><div className="preview-section-heading"><div><h3>學校</h3><p>學校名稱與識別色。</p></div><button disabled={!writable} onClick={() => begin('school', null)}>新增學校</button></div>
          {schools.map((item) => <div className="project-history-row" key={item.id}><div><strong>{item.name}</strong></div>
            <button disabled={!writable} onClick={() => begin('school', item.id)}>編輯學校</button></div>)}</section>
        <section className="preview-management-section"><div className="preview-section-heading"><div><h3>任教單位</h3><p>學制、學期日期、A/B 錨點及節次時間各自獨立。</p></div><button disabled={!writable || !schools.length} onClick={() => begin('unit', null)}>新增任教單位</button></div>
          {units.map((item) => <div className="project-history-row" key={item.id}><div><strong>{item.name}</strong>
            <span>{item.schoolLevel}・{item.startDate}～{item.endDate}・{item.periods.length} 節</span></div>
            <button disabled={!writable} onClick={() => begin('unit', item.id)}>編輯任教單位</button></div>)}</section>
      </> : <section className="preview-management-section"><div className="preview-section-heading"><div><h3>班級</h3><p>班級屬於任教單位，可供同專案的不同教師引用。</p></div><button disabled={!writable || !units.length} onClick={() => begin('class', null)}>新增班級</button></div>
        {units.map((unit) => <div key={unit.id}><h3>{unit.name}</h3>{classes.filter((item) => item.teachingUnitId === unit.id).map((item) => <div className="project-history-row" key={item.id}><div><strong>{item.name}</strong><span>{item.room ? `教室 ${item.room}` : '未設定教室'}</span></div><div className="v8-preview-actions">
          <button disabled={!writable} onClick={() => begin('class', item.id)}>編輯</button>
          <button disabled={!writable} onClick={() => void removeClass(item.id)}>刪除</button></div></div>)}
          {!classes.some((item) => item.teachingUnitId === unit.id) && <p className="settings-empty">尚無班級。</p>}</div>)}</section>)}
      {mode !== null && <form className="form-grid" aria-label="新版管理表單" onSubmit={(event) => void save(event)}>
        <h3 className="full">{editingId ? '編輯' : '新增'}{mode === 'school' ? '學校' : mode === 'unit' ? '任教單位' : '班級'}</h3>
        {mode === 'school' && <><label>學校名稱<input required value={schoolDraft.name} onChange={(event) => setSchoolDraft({ ...schoolDraft, name: event.target.value })} /></label>
          <label>學校顏色<input type="color" value={schoolDraft.color} onChange={(event) => setSchoolDraft({ ...schoolDraft, color: event.target.value })} /></label></>}
        {mode === 'unit' && <><label>所屬學校<select value={unitDraft.schoolId} onChange={(event) => setUnitDraft({ ...unitDraft, schoolId: event.target.value })}>{schools.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>任教單位名稱<input required value={unitDraft.name} onChange={(event) => setUnitDraft({ ...unitDraft, name: event.target.value })} /></label>
          <label>學制<select value={unitDraft.schoolLevel} onChange={(event) => setUnitDraft({ ...unitDraft, schoolLevel: event.target.value as SchoolLevel })}><option value="senior-high">高中部</option><option value="junior-high">國中部</option><option value="other">其他</option></select></label>
          <label>學期起始日<input required type="date" value={unitDraft.startDate} onChange={(event) => setUnitDraft({ ...unitDraft, startDate: event.target.value })} /></label>
          <label>學期結束日<input required type="date" value={unitDraft.endDate} onChange={(event) => setUnitDraft({ ...unitDraft, endDate: event.target.value })} /></label>
          <label>A/B 錨點日期<input required type="date" value={unitDraft.weekCycle.anchorDate} onChange={(event) => setUnitDraft({ ...unitDraft, weekCycle: { ...unitDraft.weekCycle, anchorDate: event.target.value } })} /></label>
          <label>錨點週型<select value={unitDraft.weekCycle.anchorPattern} onChange={(event) => setUnitDraft({ ...unitDraft, weekCycle: { ...unitDraft.weekCycle, anchorPattern: event.target.value as 'A' | 'B' } })}><option value="A">A 週</option><option value="B">B 週</option></select></label>
          <label>啟用 A/B 輪週<input type="checkbox" checked={unitDraft.weekCycle.enabled} onChange={(event) => setUnitDraft({ ...unitDraft, weekCycle: { ...unitDraft.weekCycle, enabled: event.target.checked } })} /></label>
          <fieldset className="full preview-period-settings"><legend>節次與實際時間</legend>{unitDraft.periods.map((item, index) => <div className="project-history-row" key={item.id}>
            <label>節次名稱<input value={item.label} onChange={(event) => period(index, { label: event.target.value })} /></label>
            <label>開始時間<input type="time" step="300" value={item.startTime} onChange={(event) => period(index, { startTime: event.target.value })} /></label>
            <label>結束時間<input type="time" step="300" value={item.endTime} onChange={(event) => period(index, { endTime: event.target.value })} /></label>
            <button type="button" disabled={unitDraft.periods.length <= 1} onClick={() => setUnitDraft({ ...unitDraft, periods: unitDraft.periods.filter((_, offset) => offset !== index) })}>移除節次</button></div>)}
            <button type="button" onClick={addPeriod}>新增節次</button></fieldset></>}
        {mode === 'class' && <><label>所屬任教單位<select value={classDraft.teachingUnitId} onChange={(event) => setClassDraft(blankClass(event.target.value))}>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {grades.length ? <><label>年級<select value={classDraft.grade ?? ''} onChange={(event) => setClassDraft({ ...classDraft, grade: Number(event.target.value) })}><option value="">選擇年級</option>{grades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></label>
            <label>班號<input type="number" min="1" value={classDraft.classNumber ?? 1} onChange={(event) => setClassDraft({ ...classDraft, classNumber: Number(event.target.value) })} /></label></>
            : <label>班級名稱<input required value={classDraft.name ?? ''} onChange={(event) => setClassDraft({ ...classDraft, name: event.target.value, grade: undefined, classNumber: undefined })} /></label>}
          <label>教室<input value={classDraft.room ?? ''} onChange={(event) => setClassDraft({ ...classDraft, room: event.target.value })} /></label></>}
        <div className="form-actions full"><button type="button" onClick={() => { if (discard()) setMode(null) }}>取消</button>
          <button className="primary-button" type="submit" disabled={!writable || busy}>儲存{mode === 'school' ? '學校' : mode === 'unit' ? '任教單位' : '班級'}</button></div>
      </form>}
    </div>
  </Modal>
}

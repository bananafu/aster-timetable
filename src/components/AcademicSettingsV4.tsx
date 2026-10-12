import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  addClass,
  addSchool,
  addTeachingUnit,
  removeClass,
  removeSchool,
  removeTeachingUnit,
  updateClass,
  updateSchool,
  updateTeachingUnit,
  type ClassDraft,
  type TeachingUnitDraft,
} from '../data/academicSettingsV4'
import type { AppDataV4, ProjectClass, School, SchoolLevel, SchoolPeriod, TeachingUnit } from '../types'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const levelLabel: Record<SchoolLevel, string> = { 'junior-high': '國中部', 'senior-high': '高中部', other: '其他' }

function apply<T>(operation: () => T, onSuccess: (value: T) => void, setError: (value: string) => void) {
  try { onSuccess(operation()); setError('') } catch (error) { setError(error instanceof Error ? error.message : '設定無法儲存。') }
}

export function AcademicSettingsV4({ data, setData }: { data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>> }) {
  const projectId = data.activeProjectId!
  const schools = data.schools.filter((item) => item.projectId === projectId)
  const units = data.teachingUnits.filter((item) => item.projectId === projectId)
  const classes = data.classes.filter((item) => item.projectId === projectId)
  const [schoolDraft, setSchoolDraft] = useState({ name: '', color: '#718B6C' })
  const [unitDraft, setUnitDraft] = useState({ schoolId: schools[0]?.id ?? '', name: '', schoolLevel: 'senior-high' as SchoolLevel, startDate: '', endDate: '' })
  const [classDraft, setClassDraft] = useState<ClassDraft>({ name: '', room: '', teachingUnitId: units[0]?.id ?? '' })
  const [error, setError] = useState('')
  useEffect(() => {
    if (!schools.some((item) => item.id === unitDraft.schoolId)) setUnitDraft((current) => ({ ...current, schoolId: schools[0]?.id ?? '' }))
    if (!units.some((item) => item.id === classDraft.teachingUnitId)) setClassDraft((current) => ({ ...current, teachingUnitId: units[0]?.id ?? '' }))
  }, [classDraft.teachingUnitId, schools, unitDraft.schoolId, units])

  const createSchool = (event: FormEvent) => {
    event.preventDefault()
    apply(() => addSchool(data, projectId, schoolDraft, uid()), setData, setError)
    setSchoolDraft({ name: '', color: '#718B6C' })
  }
  const createUnit = (event: FormEvent) => {
    event.preventDefault()
    apply(() => addTeachingUnit(data, unitDraft.schoolId, { name: unitDraft.name, schoolLevel: unitDraft.schoolLevel, startDate: unitDraft.startDate, endDate: unitDraft.endDate, weekCycle: { enabled: true, anchorDate: unitDraft.startDate, anchorPattern: 'A' } }, uid()), setData, setError)
  }
  const createClass = (event: FormEvent) => {
    event.preventDefault()
    apply(() => addClass(data, projectId, classDraft, uid()), setData, setError)
    setClassDraft((current) => ({ ...current, name: '', room: '' }))
  }

  return <section className="academic-settings">
    <header><strong>學校、任教單位與班級</strong><p>各校使用自己的識別色；日期、節次與輪週規則由任教單位獨立管理。</p></header>
    {schools.map((school) => <SchoolEditor key={school.id} school={school} units={units.filter((item) => item.schoolId === school.id)} data={data} setData={setData} setError={setError} />)}
    <form className="inline-create" onSubmit={createSchool}><input aria-label="新學校名稱" value={schoolDraft.name} onChange={(event) => setSchoolDraft({ ...schoolDraft, name: event.target.value })} placeholder="新增學校名稱" required /><input aria-label="新學校識別色" type="color" value={schoolDraft.color} onChange={(event) => setSchoolDraft({ ...schoolDraft, color: event.target.value })} /><button type="submit">新增學校</button></form>
    <form className="form-grid settings-subform" onSubmit={createUnit}>
      <div className="full"><strong>新增任教單位</strong><p>國中預設 45 分鐘，高中預設 50 分鐘；建立後可逐節調整。</p></div>
      <label>所屬學校<select value={unitDraft.schoolId} onChange={(event) => setUnitDraft({ ...unitDraft, schoolId: event.target.value })}>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
      <label>單位類型<select value={unitDraft.schoolLevel} onChange={(event) => setUnitDraft({ ...unitDraft, schoolLevel: event.target.value as SchoolLevel })}>{Object.entries(levelLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="full">單位名稱<input value={unitDraft.name} onChange={(event) => setUnitDraft({ ...unitDraft, name: event.target.value })} placeholder="例如：高中部" required /></label>
      <label>起始日<input type="date" value={unitDraft.startDate} onChange={(event) => setUnitDraft({ ...unitDraft, startDate: event.target.value })} required /></label>
      <label>結束日<input type="date" value={unitDraft.endDate} onChange={(event) => setUnitDraft({ ...unitDraft, endDate: event.target.value })} required /></label>
      <div className="form-actions full"><button type="submit" className="primary-button" disabled={!schools.length}>新增任教單位</button></div>
    </form>
    <section className="class-settings">
      <div><strong>班級</strong><p>班級必須屬於目前專案中的一個任教單位。</p></div>
      {classes.map((schoolClass) => <ClassEditor key={schoolClass.id} schoolClass={schoolClass} units={units} data={data} setData={setData} setError={setError} />)}
      <form className="inline-create class-create" onSubmit={createClass}><input aria-label="新班級名稱" value={classDraft.name} onChange={(event) => setClassDraft({ ...classDraft, name: event.target.value })} placeholder="班級名稱" required /><input aria-label="新班級教室" value={classDraft.room} onChange={(event) => setClassDraft({ ...classDraft, room: event.target.value })} placeholder="預設教室" /><select aria-label="新班級所屬任教單位" value={classDraft.teachingUnitId} onChange={(event) => setClassDraft({ ...classDraft, teachingUnitId: event.target.value })}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><button type="submit" disabled={!units.length}>新增班級</button></form>
    </section>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}

function SchoolEditor({ school, units, data, setData, setError }: { school: School; units: TeachingUnit[]; data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; setError: (value: string) => void }) {
  const [draft, setDraft] = useState({ name: school.name, color: school.color })
  useEffect(() => setDraft({ name: school.name, color: school.color }), [school])
  return <article className="school-editor" style={{ borderLeftColor: draft.color }}>
    <form className="school-editor-heading" onSubmit={(event) => { event.preventDefault(); apply(() => updateSchool(data, school.id, draft), setData, setError) }}><input aria-label="學校名稱" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /><input aria-label="學校識別色" type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /><button type="submit">儲存學校</button><button type="button" className="danger-outline" onClick={() => { if (window.confirm(`確定刪除「${school.name}」？`)) apply(() => removeSchool(data, school.id), setData, setError) }}>刪除</button></form>
    {units.map((unit) => <UnitEditor key={unit.id} unit={unit} data={data} setData={setData} setError={setError} />)}
  </article>
}

function nextPeriod(periods: SchoolPeriod[], level: SchoolLevel): SchoolPeriod {
  const last = [...periods].sort((a, b) => a.order - b.order).at(-1)
  const [hour, minute] = (last?.endTime ?? '08:00').split(':').map(Number)
  const startValue = hour * 60 + minute + (last ? 10 : 0)
  const duration = level === 'junior-high' ? 45 : 50
  const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
  return { id: Math.max(0, ...periods.map((item) => item.id)) + 1, order: periods.length + 1, label: `第 ${periods.length + 1} 節`, startTime: format(startValue), endTime: format(startValue + duration) }
}

function UnitEditor({ unit, data, setData, setError }: { unit: TeachingUnit; data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; setError: (value: string) => void }) {
  const [draft, setDraft] = useState<TeachingUnitDraft>(() => ({ name: unit.name, schoolLevel: unit.schoolLevel, startDate: unit.startDate, endDate: unit.endDate, periods: unit.periods.map((item) => ({ ...item })), weekCycle: { ...unit.weekCycle } }))
  useEffect(() => setDraft({ name: unit.name, schoolLevel: unit.schoolLevel, startDate: unit.startDate, endDate: unit.endDate, periods: unit.periods.map((item) => ({ ...item })), weekCycle: { ...unit.weekCycle } }), [unit])
  const updatePeriod = (id: number, field: keyof SchoolPeriod, value: string | number) => setDraft((current) => ({ ...current, periods: current.periods.map((item) => item.id === id ? { ...item, [field]: value } : item) }))
  return <form className="unit-editor" onSubmit={(event) => { event.preventDefault(); apply(() => updateTeachingUnit(data, unit.id, draft), setData, setError) }}>
    <div className="unit-editor-grid"><label>任教單位<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label><label>類型<select value={draft.schoolLevel} onChange={(event) => setDraft({ ...draft, schoolLevel: event.target.value as SchoolLevel })}>{Object.entries(levelLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>起始日<input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} required /></label><label>結束日<input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} required /></label></div>
    <div className="week-cycle-editor"><label><input type="checkbox" checked={draft.weekCycle.enabled} onChange={(event) => setDraft({ ...draft, weekCycle: { ...draft.weekCycle, enabled: event.target.checked } })} />啟用 A/B 週</label><label>基準日期<input type="date" value={draft.weekCycle.anchorDate} onChange={(event) => setDraft({ ...draft, weekCycle: { ...draft.weekCycle, anchorDate: event.target.value } })} /></label><label>基準週<select value={draft.weekCycle.anchorPattern} onChange={(event) => setDraft({ ...draft, weekCycle: { ...draft.weekCycle, anchorPattern: event.target.value as 'A' | 'B' } })}><option value="A">A 週</option><option value="B">B 週</option></select></label></div>
    <div className="unit-periods">{[...draft.periods].sort((a, b) => a.order - b.order).map((period) => <div className="period-editor" key={period.id}><small>ID {period.id}</small><input aria-label={`${unit.name}節次名稱`} value={period.label} onChange={(event) => updatePeriod(period.id, 'label', event.target.value)} /><input aria-label={`${unit.name}開始時間`} type="time" step="300" value={period.startTime} onChange={(event) => updatePeriod(period.id, 'startTime', event.target.value)} /><input aria-label={`${unit.name}結束時間`} type="time" step="300" value={period.endTime} onChange={(event) => updatePeriod(period.id, 'endTime', event.target.value)} /><button type="button" onClick={() => setDraft((current) => ({ ...current, periods: current.periods.filter((item) => item.id !== period.id).map((item, index) => ({ ...item, order: index + 1 })) }))}>移除</button></div>)}</div>
    <div className="unit-actions"><button type="button" onClick={() => setDraft((current) => ({ ...current, periods: [...current.periods, nextPeriod(current.periods, current.schoolLevel)] }))}>新增節次</button><button type="submit" className="primary-button">儲存任教單位</button><button type="button" className="danger-outline" onClick={() => { if (window.confirm(`確定刪除「${unit.name}」？`)) apply(() => removeTeachingUnit(data, unit.id), setData, setError) }}>刪除</button></div>
  </form>
}

function ClassEditor({ schoolClass, units, data, setData, setError }: { schoolClass: ProjectClass; units: TeachingUnit[]; data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; setError: (value: string) => void }) {
  const [draft, setDraft] = useState<ClassDraft>({ name: schoolClass.name, room: schoolClass.room ?? '', teachingUnitId: schoolClass.teachingUnitId })
  useEffect(() => setDraft({ name: schoolClass.name, room: schoolClass.room ?? '', teachingUnitId: schoolClass.teachingUnitId }), [schoolClass])
  return <form className="class-editor-row" onSubmit={(event) => { event.preventDefault(); apply(() => updateClass(data, schoolClass.id, draft), setData, setError) }}><input aria-label="班級名稱" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /><input aria-label="班級教室" value={draft.room} onChange={(event) => setDraft({ ...draft, room: event.target.value })} placeholder="預設教室" /><select aria-label="班級所屬任教單位" value={draft.teachingUnitId} onChange={(event) => setDraft({ ...draft, teachingUnitId: event.target.value })}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select><button type="submit">儲存</button><button type="button" className="danger-outline" onClick={() => { if (window.confirm(`確定刪除「${schoolClass.name}」？`)) apply(() => removeClass(data, schoolClass.id), setData, setError) }}>刪除</button></form>
}

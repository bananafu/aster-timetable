import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
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
import { SCHOOL_LEVELS, type AppDataV4, type ProjectClass, type School, type SchoolLevel, type SchoolPeriod, type Subject, type TeachingUnit } from '../types'
import { classDisplayName, gradeLabel, gradesForLevel, isGradeValidForLevel } from '../lib/classes'
import { subjectsForLevel } from '../lib/subjects'
import { addSubjectForLevel, getSubjectImpact, updateSubject } from '../data/subjectsV5'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const levelLabel: Record<SchoolLevel, string> = { 'junior-high': '國中部', 'senior-high': '高中部', other: '其他' }
export type AcademicSettingsPage = 'schools' | 'periods' | 'classes' | 'subjects'

const timeOptions = Array.from({ length: 24 * 12 }, (_, index) => `${String(Math.floor(index / 12)).padStart(2, '0')}:${String((index % 12) * 5).padStart(2, '0')}`)
const isFiveMinuteTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value) && Number(value.slice(3)) % 5 === 0
const addMinutes = (value: string, amount: number) => {
  const [hour, minute] = value.split(':').map(Number)
  const result = Math.min(23 * 60 + 55, hour * 60 + minute + amount)
  return `${String(Math.floor(result / 60)).padStart(2, '0')}:${String(result % 60).padStart(2, '0')}`
}

function apply<T>(operation: () => T, onSuccess: (value: T) => void, setError: (value: string) => void) {
  try { onSuccess(operation()); setError('') } catch (error) { setError(error instanceof Error ? error.message : '設定無法儲存。') }
}

export function AcademicSettingsV4({ data, setData, page = 'schools' }: { data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; page?: AcademicSettingsPage }) {
  const projectId = data.activeProjectId!
  const schools = data.schools.filter((item) => item.projectId === projectId)
  const units = data.teachingUnits.filter((item) => item.projectId === projectId)
  const classes = data.classes.filter((item) => item.projectId === projectId)
  const [schoolDraft, setSchoolDraft] = useState({ name: '', color: '#718B6C' })
  const [unitDraft, setUnitDraft] = useState({ schoolId: schools[0]?.id ?? '', name: '', schoolLevel: 'senior-high' as SchoolLevel, startDate: '', endDate: '' })
  const firstClassUnit = units[0]
  const [classDraft, setClassDraft] = useState<ClassDraft>({ grade: gradesForLevel(firstClassUnit?.schoolLevel ?? 'other')[0], classNumber: undefined, room: '', teachingUnitId: firstClassUnit?.id ?? '' })
  const [error, setError] = useState('')
  const [newSubjectName, setNewSubjectName] = useState('')
  const [selectedSchoolId, setSelectedSchoolId] = useState(schools[0]?.id ?? '')
  const selectedSchoolUnits = useMemo(() => units.filter((item) => item.schoolId === selectedSchoolId), [selectedSchoolId, units])
  const [selectedUnitId, setSelectedUnitId] = useState(selectedSchoolUnits[0]?.id ?? '')
  const selectedUnit = selectedSchoolUnits.find((item) => item.id === selectedUnitId)
  const visibleSubjects = subjectsForLevel(data.subjects, selectedUnit?.schoolLevel)
  useEffect(() => {
    if (!schools.some((item) => item.id === unitDraft.schoolId)) setUnitDraft((current) => ({ ...current, schoolId: schools[0]?.id ?? '' }))
    if (classDraft.teachingUnitId !== (units[0]?.id ?? '') && !units.some((item) => item.id === classDraft.teachingUnitId)) {
      const nextUnit = units[0]
      setClassDraft((current) => ({ ...current, teachingUnitId: nextUnit?.id ?? '', grade: gradesForLevel(nextUnit?.schoolLevel ?? 'other')[0], classNumber: undefined }))
    }
  }, [classDraft.teachingUnitId, schools, unitDraft.schoolId, units])
  useEffect(() => {
    if (!schools.some((item) => item.id === selectedSchoolId)) setSelectedSchoolId(schools[0]?.id ?? '')
  }, [schools, selectedSchoolId])
  useEffect(() => {
    if (!selectedSchoolUnits.some((item) => item.id === selectedUnitId)) setSelectedUnitId(selectedSchoolUnits[0]?.id ?? '')
  }, [selectedSchoolUnits, selectedUnitId])
  useEffect(() => {
    if (selectedUnitId && classDraft.teachingUnitId !== selectedUnitId) {
      const nextUnit = units.find((item) => item.id === selectedUnitId)
      setClassDraft((current) => ({ ...current, teachingUnitId: selectedUnitId, grade: gradesForLevel(nextUnit?.schoolLevel ?? 'other')[0], classNumber: undefined, name: undefined }))
    }
  }, [classDraft.teachingUnitId, selectedUnitId, units])

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
    setClassDraft((current) => ({ ...current, classNumber: undefined, name: undefined, room: '' }))
  }
  const changeSubjectColor = (subject: Subject, color: string) => {
    const impact = getSubjectImpact(data, subject.id)
    if (!window.confirm(`變更「${subject.name}」的全域顏色？科目庫會同步更新；目前有 ${impact.projectIds.length} 個專案、${impact.references.length} 筆課程或異動引用。`)) return
    apply(() => updateSubject(data, subject.id, {
      name: subject.name, shortName: subject.shortName, color,
      applicableSchoolLevels: [...(subject.applicableSchoolLevels ?? SCHOOL_LEVELS)],
    }, true), setData, setError)
  }

  const selectors = <div className="academic-context-selectors"><label>任教學校<select aria-label="任教學校" value={selectedSchoolId} onChange={(event) => setSelectedSchoolId(event.target.value)}>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label><label>學制<select aria-label="學制" value={selectedUnitId} onChange={(event) => setSelectedUnitId(event.target.value)}>{selectedSchoolUnits.map((unit) => <option key={unit.id} value={unit.id}>{levelLabel[unit.schoolLevel]}・{unit.name}</option>)}</select></label></div>

  return <section className="academic-settings">
    {selectors}
    {page === 'schools' && <>
    <header><strong>任教學校與學制</strong><p>學校識別色由同校各學制共用；學期日期與輪週規則由學制獨立管理。</p></header>
    {schools.filter((school) => school.id === selectedSchoolId).map((school) => <SchoolEditor key={school.id} school={school} data={data} setData={setData} setError={setError} />)}
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
    </>}
    {page === 'periods' && <>{selectedUnit ? <UnitEditor unit={selectedUnit} data={data} setData={setData} setError={setError} /> : <p className="settings-empty">請先為所選學校建立學制，才能設定課堂時間表。</p>}</>}
    {page === 'classes' && <>
    <section className="class-settings">
      <div><strong>任教班級</strong><p>只顯示目前學校與學制的班級名單。</p></div>
      {classes.filter((item) => item.teachingUnitId === selectedUnitId).map((schoolClass) => <ClassEditor key={schoolClass.id} schoolClass={schoolClass} units={selectedSchoolUnits} data={data} setData={setData} setError={setError} />)}
      {selectedUnit ? <form className="inline-create class-create" onSubmit={createClass}><ClassIdentityFields draft={{ ...classDraft, teachingUnitId: selectedUnitId }} units={[selectedUnit]} onChange={setClassDraft} prefix="新班級" /><input aria-label="新班級教室" value={classDraft.room ?? ''} onChange={(event) => setClassDraft({ ...classDraft, room: event.target.value })} placeholder="預設教室" /><button type="submit">新增班級</button></form> : <p className="settings-empty">請先建立學制，才能新增班級。</p>}
    </section>
    </>}
    {page === 'subjects' && <section className="subject-settings"><div><strong>任教科目</strong><p>科目庫由所有課表專案共用；目前只顯示所選學制適用的科目。</p></div>{!selectedUnit ? <p className="settings-empty">請先選擇學校與學制，才能查看或新增科目。</p> : <>{visibleSubjects.length === 0 && <p className="settings-empty">目前學制尚無適用科目，可在下方新增。</p>}{visibleSubjects.map((subject) => <div className="subject-setting-row" key={subject.id}><i style={{ background: subject.color }} /><span>{subject.name}</span><input aria-label={`${subject.name}顏色`} type="color" value={subject.color} onChange={(event) => changeSubjectColor(subject, event.target.value)} /></div>)}<form className="inline-create" onSubmit={(event) => { event.preventDefault(); try { setData(addSubjectForLevel(data, newSubjectName, selectedUnit.schoolLevel, uid())); setNewSubjectName(''); setError('') } catch (reason) { setError(reason instanceof Error ? reason.message : '科目無法新增。') } }}><input aria-label="新科目名稱" value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} placeholder="新科目名稱" required /><button type="submit">新增科目</button></form></>}</section>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}

function SchoolEditor({ school, data, setData, setError }: { school: School; data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; setError: (value: string) => void }) {
  const [draft, setDraft] = useState({ name: school.name, color: school.color })
  useEffect(() => setDraft({ name: school.name, color: school.color }), [school])
  return <article className="school-editor" style={{ borderLeftColor: draft.color }}>
    <form className="school-editor-heading" onSubmit={(event) => { event.preventDefault(); apply(() => updateSchool(data, school.id, draft), setData, setError) }}><input aria-label="學校名稱" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /><input aria-label="學校識別色" type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /><button type="submit">儲存學校</button><button type="button" className="danger-outline" onClick={() => { if (window.confirm(`確定刪除「${school.name}」？`)) apply(() => removeSchool(data, school.id), setData, setError) }}>刪除</button></form>
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
  const [automaticEndPeriodIds, setAutomaticEndPeriodIds] = useState<Set<number>>(() => new Set())
  useEffect(() => { setDraft({ name: unit.name, schoolLevel: unit.schoolLevel, startDate: unit.startDate, endDate: unit.endDate, periods: unit.periods.map((item) => ({ ...item })), weekCycle: { ...unit.weekCycle } }); setAutomaticEndPeriodIds(new Set()) }, [unit])
  const updatePeriod = (id: number, field: keyof SchoolPeriod, value: string | number) => setDraft((current) => ({ ...current, periods: current.periods.map((item) => item.id === id ? { ...item, [field]: value } : item) }))
  const updateStartTime = (period: SchoolPeriod, value: string) => setDraft((current) => ({ ...current, periods: current.periods.map((item) => item.id === period.id ? { ...item, startTime: value, endTime: automaticEndPeriodIds.has(period.id) ? addMinutes(value, current.schoolLevel === 'junior-high' ? 45 : 50) : item.endTime } : item) }))
  const updateEndTime = (periodId: number, value: string) => { setAutomaticEndPeriodIds((current) => { const next = new Set(current); next.delete(periodId); return next }); updatePeriod(periodId, 'endTime', value) }
  const addPeriod = () => {
    const period = nextPeriod(draft.periods, draft.schoolLevel)
    setDraft((current) => ({ ...current, periods: [...current.periods, period] }))
    setAutomaticEndPeriodIds((current) => new Set(current).add(period.id))
  }
  const invalidRanges = draft.periods.filter((period) => period.endTime <= period.startTime)
  return <form className="unit-editor" onSubmit={(event) => { event.preventDefault(); apply(() => updateTeachingUnit(data, unit.id, draft), setData, setError) }}>
    <div className="unit-editor-grid"><label>任教單位<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label><label>類型<select value={draft.schoolLevel} onChange={(event) => setDraft({ ...draft, schoolLevel: event.target.value as SchoolLevel })}>{Object.entries(levelLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>起始日<input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} required /></label><label>結束日<input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} required /></label></div>
    <div className="week-cycle-editor"><label><input type="checkbox" checked={draft.weekCycle.enabled} onChange={(event) => setDraft({ ...draft, weekCycle: { ...draft.weekCycle, enabled: event.target.checked } })} />啟用 A/B 週</label><label>基準日期<input type="date" value={draft.weekCycle.anchorDate} onChange={(event) => setDraft({ ...draft, weekCycle: { ...draft.weekCycle, anchorDate: event.target.value } })} /></label><label>基準週<select value={draft.weekCycle.anchorPattern} onChange={(event) => setDraft({ ...draft, weekCycle: { ...draft.weekCycle, anchorPattern: event.target.value as 'A' | 'B' } })}><option value="A">A 週</option><option value="B">B 週</option></select></label></div>
    {draft.periods.some((period) => !isFiveMinuteTime(period.startTime) || !isFiveMinuteTime(period.endTime)) && <p className="form-warning" role="alert">既有節次含非 5 分鐘刻度的時間。資料尚未變更，請逐項修正後再儲存。</p>}
    {invalidRanges.length > 0 && <p className="form-warning" role="alert">結束時間必須晚於開始時間，請修正後再儲存。</p>}
    <div className="unit-periods">{[...draft.periods].sort((a, b) => a.order - b.order).map((period) => <div className="period-editor" key={period.id}><small>ID {period.id}</small><input aria-label={`${unit.name}節次名稱`} value={period.label} onChange={(event) => updatePeriod(period.id, 'label', event.target.value)} /><TimeSelect label={`${unit.name}開始時間`} value={period.startTime} onChange={(value) => updateStartTime(period, value)} /><TimeSelect label={`${unit.name}結束時間`} value={period.endTime} onChange={(value) => updateEndTime(period.id, value)} /><button type="button" onClick={() => setDraft((current) => ({ ...current, periods: current.periods.filter((item) => item.id !== period.id).map((item, index) => ({ ...item, order: index + 1 })) }))}>移除</button></div>)}</div>
    <div className="unit-actions"><button type="button" onClick={addPeriod}>新增節次</button><button type="submit" className="primary-button" disabled={invalidRanges.length > 0}>儲存任教單位</button><button type="button" className="danger-outline" onClick={() => { if (window.confirm(`確定刪除「${unit.name}」？`)) apply(() => removeTeachingUnit(data, unit.id), setData, setError) }}>刪除</button></div>
  </form>
}

function TimeSelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const invalid = !isFiveMinuteTime(value)
  return <select aria-label={label} value={value} className={invalid ? 'invalid-time' : ''} onChange={(event) => onChange(event.target.value)}>{invalid && <option value={value}>{value}（需修正）</option>}{timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select>
}

function ClassEditor({ schoolClass, units, data, setData, setError }: { schoolClass: ProjectClass; units: TeachingUnit[]; data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; setError: (value: string) => void }) {
  const toDraft = (item: ProjectClass): ClassDraft => ({ name: item.name, grade: item.grade, classNumber: item.classNumber, room: item.room ?? '', teachingUnitId: item.teachingUnitId })
  const [draft, setDraft] = useState<ClassDraft>(() => toDraft(schoolClass))
  useEffect(() => setDraft(toDraft(schoolClass)), [schoolClass])
  return <form className="class-editor-row" onSubmit={(event) => { event.preventDefault(); apply(() => updateClass(data, schoolClass.id, draft), setData, setError) }}><ClassIdentityFields draft={draft} units={units} onChange={setDraft} prefix="班級" legacyName={schoolClass.grade === undefined || schoolClass.classNumber === undefined} /><input aria-label="班級教室" value={draft.room ?? ''} onChange={(event) => setDraft({ ...draft, room: event.target.value })} placeholder="預設教室" /><span className="class-code-preview">顯示：{classDisplayName({ name: draft.name ?? schoolClass.name, grade: draft.grade, classNumber: draft.classNumber })}</span><button type="submit">儲存</button><button type="button" className="danger-outline" onClick={() => { if (window.confirm(`確定刪除「${classDisplayName(schoolClass)}」？`)) apply(() => removeClass(data, schoolClass.id), setData, setError) }}>刪除</button></form>
}

function ClassIdentityFields({ draft, units, onChange, prefix, legacyName = false }: { draft: ClassDraft; units: TeachingUnit[]; onChange: (draft: ClassDraft) => void; prefix: string; legacyName?: boolean }) {
  const unit = units.find((item) => item.id === draft.teachingUnitId)
  const grades = gradesForLevel(unit?.schoolLevel ?? 'other')
  const selectUnit = (teachingUnitId: string) => {
    const nextUnit = units.find((item) => item.id === teachingUnitId)
    const nextGrades = gradesForLevel(nextUnit?.schoolLevel ?? 'other')
    onChange({
      ...draft,
      teachingUnitId,
      grade: draft.grade !== undefined && isGradeValidForLevel(nextUnit?.schoolLevel ?? 'other', draft.grade) ? draft.grade : nextGrades[0],
      classNumber: nextGrades.length ? draft.classNumber : undefined,
      name: nextGrades.length ? undefined : draft.name,
    })
  }
  return <>
    <select aria-label={`${prefix}所屬學制`} value={draft.teachingUnitId} onChange={(event) => selectUnit(event.target.value)}>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    {grades.length > 0 && !legacyName ? <><select aria-label={`${prefix}年級`} value={draft.grade ?? ''} onChange={(event) => onChange({ ...draft, grade: Number(event.target.value), name: undefined })}>{grades.map((grade) => <option key={grade} value={grade}>{gradeLabel(unit!.schoolLevel, grade)}</option>)}</select><input aria-label={`${prefix}班號`} type="number" min="1" step="1" value={draft.classNumber ?? ''} onChange={(event) => onChange({ ...draft, classNumber: event.target.value ? Number(event.target.value) : undefined, name: undefined })} placeholder="班號" required /></> : <input aria-label={`${prefix}名稱`} value={draft.name ?? ''} onChange={(event) => onChange({ ...draft, name: event.target.value, grade: undefined, classNumber: undefined })} placeholder="班級名稱" required />}
  </>
}

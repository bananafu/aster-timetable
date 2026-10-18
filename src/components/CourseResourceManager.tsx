import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { addClass, removeClass, updateClass, type ClassDraft } from '../data/academicSettingsV4'
import { addSubjectForLevel, deleteSubject, getSubjectImpact, updateSubject, type SubjectDraft } from '../data/subjectsV5'
import { classDisplayName, gradeLabel, gradesForLevel, isGradeValidForLevel } from '../lib/classes'
import { subjectsForLevel } from '../lib/subjects'
import { SCHOOL_LEVELS, type AppDataV4, type ProjectClass, type SchoolLevel, type Subject, type TeachingUnit } from '../types'
import type { StoragePersistence, StorageStatus } from '../hooks/useLocalStorage'
import { SubjectCatalogInstaller } from './SubjectCatalogInstaller'
import { Modal } from './Modal'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const levelLabel: Record<SchoolLevel, string> = { 'junior-high': '國中部', 'senior-high': '高中部', other: '其他' }
const unitLabel = (unit: TeachingUnit, units: TeachingUnit[]) => {
  const peers = units.filter((item) => item.schoolId === unit.schoolId && item.schoolLevel === unit.schoolLevel)
  if (peers.length === 1) return unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]
  return `${unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]}（重複設定 ${peers.findIndex((item) => item.id === unit.id) + 1}：${unit.name}）`
}

interface Props {
  data: AppDataV4
  setData: Dispatch<SetStateAction<AppDataV4>>
  mode: 'classes' | 'subjects'
  storageStatus?: StorageStatus
  storagePersistence?: StoragePersistence
  readOnly?: boolean
  onOpenSettings?: () => void
  onClose?: () => void
}

export function CourseResourceManagerDialog(props: Props & { onClose: () => void }) {
  const trigger = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    trigger.current = document.activeElement as HTMLElement | null
    ;(content.current?.querySelector<HTMLSelectElement>('select:not(:disabled)') ?? content.current?.closest('[role="dialog"]')?.querySelector<HTMLButtonElement>('button'))?.focus()
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = [...(content.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])]
      if (!focusable.length) return
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus() }
    }
    document.addEventListener('keydown', trap)
    return () => { document.removeEventListener('keydown', trap); if (trigger.current?.isConnected) trigger.current.focus(); else document.querySelector<HTMLButtonElement>('[data-course-add]')?.focus() }
  }, [])
  return <Modal title={props.mode === 'classes' ? '管理班級' : '管理科目'} subtitle={props.mode === 'classes' ? '班級屬於所選專案與學制，不屬於教師課表。' : '科目庫由所有專案共用，變更會影響適用的課程。'} onClose={props.onClose}>
    <div ref={content} className="resource-manager-dialog"><CourseResourceManager {...props} /></div>
  </Modal>
}

export function CourseResourceManager({ data, setData, mode, storageStatus = 'saved', storagePersistence = { pending: false, revision: 0 }, readOnly = false, onOpenSettings }: Props) {
  const projectId = data.activeProjectId
  const project = data.projects.find((item) => item.id === projectId)
  const schools = useMemo(() => data.schools.filter((item) => item.projectId === projectId), [data.schools, projectId])
  const units = useMemo(() => data.teachingUnits.filter((item) => item.projectId === projectId), [data.teachingUnits, projectId])
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? '')
  const schoolUnits = useMemo(() => units.filter((item) => item.schoolId === schoolId), [schoolId, units])
  const duplicate = schoolUnits.some((unit) => schoolUnits.some((item) => item.id !== unit.id && item.schoolLevel === unit.schoolLevel))
  const [unitId, setUnitId] = useState(duplicate ? '' : schoolUnits[0]?.id ?? '')
  const unit = schoolUnits.find((item) => item.id === unitId)
  const [classDraft, setClassDraft] = useState<ClassDraft>({ teachingUnitId: unitId, grade: gradesForLevel(unit?.schoolLevel ?? 'other')[0], classNumber: undefined, room: '' })
  const [subjectName, setSubjectName] = useState('')
  const [showAllSubjects, setShowAllSubjects] = useState(false)
  const [error, setError] = useState('')
  const editable = !readOnly && Boolean(project && !project.archivedAt) && storageStatus === 'saved' && !storagePersistence.pending

  useEffect(() => { if (!schools.some((item) => item.id === schoolId)) setSchoolId(schools[0]?.id ?? '') }, [schoolId, schools])
  useEffect(() => { if (!schoolUnits.some((item) => item.id === unitId)) setUnitId(duplicate ? '' : schoolUnits[0]?.id ?? '') }, [duplicate, schoolUnits, unitId])
  useEffect(() => {
    if (classDraft.teachingUnitId === unitId) return
    setClassDraft({ teachingUnitId: unitId, grade: gradesForLevel(unit?.schoolLevel ?? 'other')[0], classNumber: undefined, room: '' })
  }, [classDraft.teachingUnitId, unit?.schoolLevel, unitId])

  const transact = (operation: (current: AppDataV4) => AppDataV4) => {
    if (!editable || !projectId) { setError('封存、唯讀或尚未完成儲存時，不能修改班級與科目。'); return }
    try {
      operation(data)
      setData((current) => {
        if (current.activeProjectId !== projectId || current.projects.find((item) => item.id === projectId)?.archivedAt) throw new Error('目前專案已切換或封存，請重新開啟管理視窗。')
        return operation(current)
      })
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '資料已變更，請重新確認。') }
  }
  const createClass = (event: FormEvent) => {
    event.preventDefault()
    if (!projectId || !unit) return
    const id = uid()
    transact((current) => addClass(current, projectId, { ...classDraft, teachingUnitId: unit.id }, id))
  }
  const createSubject = (event: FormEvent) => {
    event.preventDefault()
    if (!unit) return
    const id = uid()
    transact((current) => addSubjectForLevel(current, subjectName, unit.schoolLevel, id))
  }
  const empty = !schools.length || !units.length

  return <section className="academic-settings resource-manager">
    <div className="academic-context-selectors"><label>學校<select aria-label="學校" value={schoolId} onChange={(event) => { setSchoolId(event.target.value); setUnitId('') }} disabled={!schools.length}>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label><label>學制<select aria-label="目前學制" value={unitId} onChange={(event) => setUnitId(event.target.value)} disabled={!schoolUnits.length}>{duplicate && <option value="">請選擇要管理的學制設定</option>}{schoolUnits.map((item) => <option key={item.id} value={item.id}>{unitLabel(item, units)}</option>)}</select></label></div>
    {empty && <div className="settings-empty">目前專案尚無學校或學制。請先前往專案設定建立學校與學制。{onOpenSettings && <button type="button" onClick={onOpenSettings}>前往專案設定</button>}</div>}
    {mode === 'classes' && <section className="class-settings"><div><strong>班級</strong><p>顯示目前學校與學制的班級；不受教師課表篩選影響。</p></div>
      {data.classes.filter((item) => item.projectId === projectId && item.teachingUnitId === unitId).map((item) => <ClassRow key={item.id} schoolClass={item} units={schoolUnits} editable={editable} transact={transact} />)}
      {unit ? <form className="inline-create class-create" onSubmit={createClass}><ClassIdentityFields draft={{ ...classDraft, teachingUnitId: unitId }} units={[unit]} onChange={setClassDraft} prefix="新班級" disabled={!editable} /><input aria-label="新班級教室" value={classDraft.room ?? ''} onChange={(event) => setClassDraft({ ...classDraft, room: event.target.value })} placeholder="預設教室" disabled={!editable} /><button type="submit" disabled={!editable}>新增班級</button></form> : !empty && <p className="settings-empty">請選擇學制，才能管理班級。</p>}
    </section>}
    {mode === 'subjects' && <><section className="subject-settings"><div><strong>科目</strong><p>科目庫由所有課表專案共用；目前顯示所選學制適用科目，修改名稱、簡稱、顏色或適用學制會影響其他專案。</p></div>
      {unit ? <><label className="resource-all-subjects"><input type="checkbox" checked={showAllSubjects} onChange={(event) => setShowAllSubjects(event.target.checked)} />顯示全域所有科目</label>{(showAllSubjects ? data.subjects : subjectsForLevel(data.subjects, unit.schoolLevel)).map((subject) => <SubjectRow key={subject.id} subject={subject} editable={editable} data={data} transact={transact} />)}<form className="inline-create" onSubmit={createSubject}><input aria-label="新科目名稱" value={subjectName} onChange={(event) => setSubjectName(event.target.value)} placeholder="新科目名稱" disabled={!editable} required /><button type="submit" disabled={!editable}>新增科目</button></form></> : !empty && <p className="settings-empty">請先選擇學校與學制，才能查看或新增科目。</p>}
    </section><SubjectCatalogInstaller data={data} setData={setData} storageStatus={storageStatus} storagePersistence={storagePersistence} readOnly={!editable} /></>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}

type Transact = (operation: (current: AppDataV4) => AppDataV4) => void

function ClassRow({ schoolClass, units, editable, transact }: { schoolClass: ProjectClass; units: TeachingUnit[]; editable: boolean; transact: Transact }) {
  const [draft, setDraft] = useState<ClassDraft>({ name: schoolClass.name, grade: schoolClass.grade, classNumber: schoolClass.classNumber, room: schoolClass.room ?? '', teachingUnitId: schoolClass.teachingUnitId })
  useEffect(() => setDraft({ name: schoolClass.name, grade: schoolClass.grade, classNumber: schoolClass.classNumber, room: schoolClass.room ?? '', teachingUnitId: schoolClass.teachingUnitId }), [schoolClass])
  return <form className="class-editor-row" onSubmit={(event) => { event.preventDefault(); transact((current) => updateClass(current, schoolClass.id, draft)) }}><ClassIdentityFields draft={draft} units={units} onChange={setDraft} prefix="班級" legacyName={schoolClass.grade === undefined || schoolClass.classNumber === undefined} disabled={!editable} /><input aria-label="班級教室" value={draft.room ?? ''} onChange={(event) => setDraft({ ...draft, room: event.target.value })} placeholder="預設教室" disabled={!editable} /><span className="class-code-preview">顯示：{classDisplayName({ name: draft.name ?? schoolClass.name, grade: draft.grade, classNumber: draft.classNumber })}</span><button type="submit" disabled={!editable}>儲存</button><button type="button" className="danger-outline" disabled={!editable} onClick={() => { if (window.confirm(`確定刪除「${classDisplayName(schoolClass)}」？`)) transact((current) => removeClass(current, schoolClass.id)) }}>刪除</button></form>
}

function ClassIdentityFields({ draft, units, onChange, prefix, legacyName = false, disabled = false }: { draft: ClassDraft; units: TeachingUnit[]; onChange: (draft: ClassDraft) => void; prefix: string; legacyName?: boolean; disabled?: boolean }) {
  const unit = units.find((item) => item.id === draft.teachingUnitId)
  const grades = gradesForLevel(unit?.schoolLevel ?? 'other')
  const selectUnit = (teachingUnitId: string) => {
    const nextUnit = units.find((item) => item.id === teachingUnitId)
    const nextGrades = gradesForLevel(nextUnit?.schoolLevel ?? 'other')
    onChange({ ...draft, teachingUnitId, grade: draft.grade !== undefined && isGradeValidForLevel(nextUnit?.schoolLevel ?? 'other', draft.grade) ? draft.grade : nextGrades[0], classNumber: nextGrades.length ? draft.classNumber : undefined, name: nextGrades.length ? undefined : draft.name })
  }
  return <><select aria-label={`${prefix}所屬學制`} value={draft.teachingUnitId} onChange={(event) => selectUnit(event.target.value)} disabled={disabled}>{units.map((item) => <option key={item.id} value={item.id}>{unitLabel(item, units)}</option>)}</select>
    {grades.length > 0 && !legacyName ? <><select aria-label={`${prefix}年級`} value={draft.grade ?? ''} onChange={(event) => onChange({ ...draft, grade: Number(event.target.value), name: undefined })} disabled={disabled}>{grades.map((grade) => <option key={grade} value={grade}>{gradeLabel(unit!.schoolLevel, grade)}</option>)}</select><input aria-label={`${prefix}班號`} type="number" min="1" step="1" value={draft.classNumber ?? ''} onChange={(event) => onChange({ ...draft, classNumber: event.target.value ? Number(event.target.value) : undefined, name: undefined })} placeholder="班號" required disabled={disabled} /></> : <input aria-label={`${prefix}名稱`} value={draft.name ?? ''} onChange={(event) => onChange({ ...draft, name: event.target.value, grade: undefined, classNumber: undefined })} placeholder="班級名稱" required disabled={disabled} />}
  </>
}

function SubjectRow({ subject, editable, data, transact }: { subject: Subject; editable: boolean; data: AppDataV4; transact: Transact }) {
  const [draft, setDraft] = useState<SubjectDraft>({ name: subject.name, shortName: subject.shortName, color: subject.color, applicableSchoolLevels: [...(subject.applicableSchoolLevels ?? SCHOOL_LEVELS)] })
  useEffect(() => setDraft({ name: subject.name, shortName: subject.shortName, color: subject.color, applicableSchoolLevels: [...(subject.applicableSchoolLevels ?? SCHOOL_LEVELS)] }), [subject])
  const impact = getSubjectImpact(data, subject.id)
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!editable) return
    const changed = draft.name !== subject.name || draft.shortName !== subject.shortName || draft.color !== subject.color
      || JSON.stringify(draft.applicableSchoolLevels) !== JSON.stringify(subject.applicableSchoolLevels ?? SCHOOL_LEVELS)
    if (!changed) return
    const message = `變更全域科目「${subject.name}」？此科目被 ${impact.projectIds.length} 個專案、${impact.references.length} 筆課程或異動引用；名稱、簡稱、顏色與適用學制會同步影響所有專案。${!subject.applicableSchoolLevels ? '舊資料未指定適用學制，本次會明確設為所有學制。' : ''}`
    if (!window.confirm(message)) return
    transact((current) => updateSubject(current, subject.id, draft, true))
  }
  return <form className="subject-management-row" onSubmit={save} aria-label={`管理科目 ${subject.name}`}><label>名稱<input aria-label={`${subject.name}名稱`} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={!editable} /></label><label>簡稱<input aria-label={`${subject.name}簡稱`} value={draft.shortName} onChange={(event) => setDraft({ ...draft, shortName: event.target.value })} disabled={!editable} /></label><label>顏色<input aria-label={`${subject.name}顏色`} type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} disabled={!editable} /></label><fieldset><legend>適用學制</legend>{SCHOOL_LEVELS.map((level) => <label key={level}><input type="checkbox" checked={draft.applicableSchoolLevels.includes(level)} disabled={!editable} onChange={(event) => setDraft((current) => ({ ...current, applicableSchoolLevels: event.target.checked ? [...current.applicableSchoolLevels, level] : current.applicableSchoolLevels.filter((item) => item !== level) }))} />{levelLabel[level]}</label>)}</fieldset><div className="subject-management-actions"><button type="submit" disabled={!editable}>儲存科目</button><button type="button" className="danger-outline" disabled={!editable} onClick={() => { if (window.confirm(`確定刪除全域科目「${subject.name}」？目前有 ${impact.references.length} 筆課程或異動引用；有引用時系統會拒絕刪除。`)) transact((current) => deleteSubject(current, subject.id, true)) }}>刪除科目</button></div></form>
}

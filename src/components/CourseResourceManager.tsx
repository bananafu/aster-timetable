import { useEffect, useRef, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { addClass, removeClass, updateClass, type ClassDraft } from '../data/academicSettingsV4'
import { addSubjectForLevel, deleteSubject, getSubjectImpact, removeSubjectSchoolLevel, updateSubject, type SubjectDraft } from '../data/subjectsV5'
import { classDisplayName, gradeLabel, gradesForLevel } from '../lib/classes'
import { subjectsForLevel } from '../lib/subjects'
import { SCHOOL_LEVELS, type AppDataV4, type ProjectClass, type SchoolLevel, type Subject, type TeachingUnit } from '../types'
import type { StorageControls, StoragePersistence, StorageStatus } from '../hooks/useLocalStorage'
import { useResourceManagementSession, type ResourceManagementSession } from '../hooks/useResourceManagementSession'
import { SubjectCatalogInstaller } from './SubjectCatalogInstaller'
import { Modal } from './Modal'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const CLASS_ROOM_MAX_LENGTH = 15
const classRoomError = (room?: string) => (room?.length ?? 0) > CLASS_ROOM_MAX_LENGTH ? `預設教室最多 ${CLASS_ROOM_MAX_LENGTH} 個字元；既有內容已保留，請修正後再儲存。` : ''
const emptyClassDraft = (unit?: TeachingUnit): ClassDraft => ({ teachingUnitId: unit?.id ?? '', grade: gradesForLevel(unit?.schoolLevel ?? 'other')[0], classNumber: undefined, room: '' })
const levelLabel: Record<SchoolLevel, string> = { 'junior-high': '國中部', 'senior-high': '高中部', other: '其他' }
const unitLabel = (unit: TeachingUnit, units: TeachingUnit[]) => {
  const peers = units.filter((item) => item.schoolId === unit.schoolId && item.schoolLevel === unit.schoolLevel)
  if (peers.length === 1) return unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]
  return `${unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]}（重複設定 ${peers.findIndex((item) => item.id === unit.id) + 1}：${unit.name}）`
}
const subjectDraft = (subject: Subject): SubjectDraft => ({ name: subject.name, shortName: subject.shortName, color: subject.color, applicableSchoolLevels: [...(subject.applicableSchoolLevels ?? SCHOOL_LEVELS)] })
const classDraft = (item: ProjectClass): ClassDraft => ({ name: item.name, grade: item.grade, classNumber: item.classNumber, room: item.room ?? '', teachingUnitId: item.teachingUnitId })

interface Props {
  data: AppDataV4
  setData: Dispatch<SetStateAction<AppDataV4>>
  mode: 'classes' | 'subjects'
  storageStatus?: StorageStatus
  storagePersistence?: StoragePersistence
  storageControls?: StorageControls
  session?: ResourceManagementSession
  readOnly?: boolean
  onOpenSettings?: () => void
  onClose?: () => void
}

export function CourseResourceManagerDialog(props: Props & { onClose: () => void }) {
  const localSession = useResourceManagementSession(props.data, props.setData, props.storageStatus, props.storagePersistence)
  const session = props.session ?? localSession
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
  return <Modal title={props.mode === 'classes' ? '管理班級' : '管理科目'} subtitle={props.mode === 'classes' ? '班級屬於所選專案與學制，不屬於教師課表。' : '科目庫由所有專案共用，變更會影響適用的課程。'} onClose={() => session.requestTransition(props.onClose)}>
    <div ref={content} className="resource-manager-dialog"><CourseResourceManager {...props} session={session} /></div>
  </Modal>
}

export function CourseResourceManager(props: Props) {
  const localSession = useResourceManagementSession(props.data, props.setData, props.storageStatus, props.storagePersistence)
  return <ResourceManagerContent {...props} session={props.session ?? localSession} />
}

function ResourceManagerContent({ data, setData, mode, storageStatus = 'saved', storagePersistence, storageControls, readOnly = false, onOpenSettings, session }: Props & { session: ResourceManagementSession }) {
  const { schoolId, unitId, showClassCreate, showAllSubjects, projectId } = session.view
  const project = data.projects.find((item) => item.id === projectId)
  const schools = data.schools.filter((item) => item.projectId === projectId)
  const units = data.teachingUnits.filter((item) => item.projectId === projectId)
  const schoolUnits = units.filter((item) => item.schoolId === schoolId)
  const duplicate = schoolUnits.some((unit) => schoolUnits.some((item) => item.id !== unit.id && item.schoolLevel === unit.schoolLevel))
  const unit = schoolUnits.find((item) => item.id === unitId)
  const editable = !readOnly && Boolean(project && !project.archivedAt) && data.activeProjectId === projectId
    && storageStatus === 'saved' && !session.locked
  const subjectCreateKey = `subject-create:${projectId}:${unitId}`
  const classCreateKey = `class-create:${projectId}:${unitId}`
  const subjectName = session.draft(subjectCreateKey, '')
  const newClass = session.draft(classCreateKey, emptyClassDraft(unit))
  const subjectCreateLocked = !editable || Boolean(session.drafts[subjectCreateKey]?.submittedTargetId)
  const classCreateLocked = !editable || Boolean(session.drafts[classCreateKey]?.submittedTargetId)
  const subjects = unit ? (showAllSubjects ? data.subjects : subjectsForLevel(data.subjects, unit.schoolLevel)) : []
  const classes = data.classes.filter((item) => item.projectId === projectId && item.teachingUnitId === unitId)
  const retained = Object.entries(session.drafts).filter(([key, entry]) => mode === 'subjects'
    ? (entry.kind === 'subject' && !subjects.some((item) => `subject:${item.id}` === key))
      || (entry.kind === 'subject-create' && (!unit || key !== subjectCreateKey))
    : (entry.kind === 'class' && !classes.some((item) => `class:${item.id}` === key))
      || (entry.kind === 'class-create' && (!unit || key !== classCreateKey)))

  useEffect(() => {
    if (session.dirtyKeys.length || session.locked) return
    if (!schools.some((item) => item.id === schoolId)) {
      const nextSchool = schools[0]?.id ?? ''
      const nextUnits = units.filter((item) => item.schoolId === nextSchool)
      const ambiguous = nextUnits.some((item) => nextUnits.some((other) => item.id !== other.id && item.schoolLevel === other.schoolLevel))
      if (schoolId !== nextSchool || unitId !== (ambiguous ? '' : nextUnits[0]?.id ?? '')) session.setView({ schoolId: nextSchool, unitId: ambiguous ? '' : nextUnits[0]?.id ?? '' })
    } else if (!schoolUnits.some((item) => item.id === unitId)) {
      const nextUnit = duplicate ? '' : schoolUnits[0]?.id ?? ''
      if (unitId !== nextUnit) session.setView({ unitId: nextUnit })
    }
  }, [session, schools, units, schoolId, unitId, schoolUnits, duplicate])
  const changeScope = (nextSchoolId: string, nextUnitId: string, nextAll = showAllSubjects) => {
    const nextUnit = units.find((item) => item.id === nextUnitId)
    const nextSubjects = new Set((nextUnit ? (nextAll ? data.subjects : subjectsForLevel(data.subjects, nextUnit.schoolLevel)) : []).map((item) => `subject:${item.id}`))
    const affected = session.dirtyKeys.filter((key) => {
      const entry = session.drafts[key]
      if (entry.kind === 'subject') return mode === 'subjects' && !nextSubjects.has(key)
      if (entry.kind === 'class') return mode === 'classes' && entry.teachingUnitId !== nextUnitId
      return entry.teachingUnitId !== nextUnitId || nextSchoolId !== schoolId
    })
    session.requestTransition(() => session.setView({ schoolId: nextSchoolId, unitId: nextUnitId, showAllSubjects: nextAll,
      showClassCreate: nextUnitId === unitId ? showClassCreate : false }), affected)
  }
  const createClass = (event: FormEvent) => {
    event.preventDefault()
    if (!editable || !unit || !projectId) return
    const roomError = classRoomError(newClass.room)
    if (roomError) { session.fail(roomError); return }
    const id = session.drafts[classCreateKey]?.submittedTargetId ?? uid()
    session.submit({ type: 'create-class', targetId: id, projectId, teachingUnitId: unit.id, draftKeys: [classCreateKey], success: '已儲存：已新增班級。' }, (current) => addClass(current, projectId, newClass, id))
  }
  const createSubject = (event: FormEvent) => {
    event.preventDefault()
    if (!editable || !unit || !projectId) return
    const id = session.drafts[subjectCreateKey]?.submittedTargetId ?? uid()
    session.submit({ type: 'create-subject', targetId: id, projectId, teachingUnitId: unit.id, draftKeys: [subjectCreateKey], success: '已儲存：已新增科目。' }, (current) => addSubjectForLevel(current, subjectName, unit.schoolLevel, id))
  }
  const removeSubjectLevel = (subject: Subject, level: SchoolLevel) => {
    if (!editable || !storagePersistence || !projectId) return
    try {
      removeSubjectSchoolLevel(data, subject.id, level, true)
      if (!window.confirm(`解除「${subject.name}」的${levelLabel[level]}適用關係？\n此操作將從所有${levelLabel[level]}的可用科目中移除此科目，不會刪除科目本身，也不會影響其他學制。\n適用範圍包含所有專案、學校與課表。`)) return
      session.submit({ type: 'remove-subject-level', targetId: subject.id, projectId, source: subject, draftKeys: [],
        success: `已儲存：已解除「${subject.name}」的${levelLabel[level]}適用關係；科目與其他學制均已保留。` }, (current) => removeSubjectSchoolLevel(current, subject.id, level, true))
    } catch (cause) { session.fail(cause instanceof Error ? cause.message : '無法解除適用關係，請重新確認。') }
  }
  const openSettings = onOpenSettings ? () => session.requestTransition(onOpenSettings) : undefined
  return <section className="academic-settings resource-manager" data-resource-state={session.status}>
    {projectId !== data.activeProjectId && <p role="status">使用中專案已變更；原操作脈絡與草稿已保留，請確認後關閉並重新開啟管理視窗。</p>}
    <div className="academic-context-selectors">
      <label>學校<select aria-label="學校" value={schoolId} onChange={(event) => {
        const nextSchool = event.target.value
        const nextUnits = units.filter((item) => item.schoolId === nextSchool)
        const ambiguous = nextUnits.some((item) => nextUnits.some((other) => item.id !== other.id && item.schoolLevel === other.schoolLevel))
        changeScope(nextSchool, ambiguous ? '' : nextUnits[0]?.id ?? '')
      }} disabled={!schools.length}>{!schools.some((item) => item.id === schoolId) && schoolId && <option value={schoolId}>原學校已不存在（草稿保留）</option>}{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
      <label>學制<select aria-label="目前學制" value={unitId} onChange={(event) => changeScope(schoolId, event.target.value)} disabled={!schoolUnits.length}>
        {duplicate && <option value="">請選擇要管理的學制設定</option>}{!schoolUnits.some((item) => item.id === unitId) && unitId && <option value={unitId}>原學制已不存在（草稿保留）</option>}{schoolUnits.map((item) => <option key={item.id} value={item.id}>{unitLabel(item, units)}</option>)}
      </select></label>
    </div>
    {(!schools.length || !units.length) && <div className="settings-empty">目前專案尚無學校或學制。請先前往專案設定建立學校與學制。{openSettings && <button type="button" onClick={openSettings}>前往專案設定</button>}</div>}
    {mode === 'classes' && <section className="class-settings"><div><strong>班級</strong><p>顯示目前學校與學制的班級；不受教師課表篩選影響。</p></div>
      {classes.map((item) => unit && <ClassRow key={item.id} schoolClass={item} unit={unit} editable={editable} data={data} session={session} />)}
      {unit && !showClassCreate && <div className="class-add-row"><button type="button" className="class-add-trigger" disabled={!editable} onClick={() => session.setView({ showClassCreate: true })}>＋ 新增班級</button></div>}
      {unit && showClassCreate ? <form className="inline-create class-create" aria-label="新增班級表單" onSubmit={createClass}>
        <ClassIdentityFields draft={newClass} unit={unit} onChange={(value) => session.edit(classCreateKey, { kind: 'class-create', projectId: projectId!, teachingUnitId: unitId, source: null, unitSnapshot: unit, initial: emptyClassDraft(unit), value })} prefix="新班級" disabled={classCreateLocked} />
        <ClassRoomField id="new-class-room-help" prefix="新班級" room={newClass.room ?? ''} disabled={classCreateLocked} onChange={(room) => session.edit(classCreateKey, { kind: 'class-create', projectId: projectId!, teachingUnitId: unitId, source: null, unitSnapshot: unit, initial: emptyClassDraft(unit), value: { ...newClass, room } })} />
        <div className="class-create-actions"><button type="button" onClick={() => session.requestTransition(() => session.setView({ showClassCreate: false }), [classCreateKey])}>取消</button><button type="submit" disabled={classCreateLocked}>{session.locked ? '儲存中…' : '新增班級'}</button></div>
      </form> : !unit && units.length > 0 && <p className="settings-empty">請選擇學制，才能管理班級。</p>}
    </section>}
    {mode === 'subjects' && <><section className="subject-settings"><div><strong>科目</strong><p>科目庫由所有課表專案共用；目前顯示所選學制適用科目，修改名稱、簡稱、顏色或適用學制會影響其他專案。</p></div>
      {unit ? <><label className="resource-all-subjects"><input type="checkbox" checked={showAllSubjects} onChange={(event) => changeScope(schoolId, unitId, event.target.checked)} />顯示全域所有科目</label>
        {subjects.map((subject) => <SubjectRow key={subject.id} subject={subject} editable={editable} data={data} session={session} schoolLevel={unit.schoolLevel} canConfirmRemoval={Boolean(storagePersistence)} onRemoveLevel={removeSubjectLevel} />)}
        <form className="inline-create" onSubmit={createSubject}><input aria-label="新科目名稱" value={subjectName} onChange={(event) => session.edit(subjectCreateKey, { kind: 'subject-create', projectId: projectId!, teachingUnitId: unitId, source: null, unitSnapshot: unit, initial: '', value: event.target.value })} placeholder="新科目名稱" disabled={subjectCreateLocked} required /><button type="submit" disabled={subjectCreateLocked}>新增科目</button></form>
      </> : units.length > 0 && <p className="settings-empty">請先選擇學校與學制，才能查看或新增科目。</p>}
    </section><SubjectCatalogInstaller data={data} setData={setData} storageStatus={storageStatus} storagePersistence={storagePersistence ?? { pending: false, revision: 0 }} readOnly={!editable} /></>}
    {retained.length > 0 && <section aria-label="保留的資源草稿"><p>來源資料已變更、刪除或不在目前範圍；草稿已保留，不會自動重建資源。</p>{retained.map(([key, entry]) => <div key={key}>
      {entry.kind === 'subject' ? <SubjectRow subject={entry.source as Subject} data={data} session={session} editable={editable} schoolLevel={unit?.schoolLevel ?? 'other'} canConfirmRemoval={false} onRemoveLevel={removeSubjectLevel} />
        : entry.kind === 'class' && entry.unitSnapshot ? <ClassRow schoolClass={entry.source as ProjectClass} unit={entry.unitSnapshot} data={data} session={session} editable={editable} />
          : <><pre aria-label="保留的新增草稿">{JSON.stringify(entry.value)}</pre><button type="button" onClick={() => session.requestTransition(() => {}, [key])}>捨棄此筆新增草稿</button></>}
    </div>)}</section>}
    {session.unconfirmedCreations.length > 0 && <section aria-label="未確認的新增操作"><p>請先核對原新增 ID。結束這次未確認新增只會清除該筆輸入，保留目前文件中的資源；不會認定本地儲存成功。</p>
      {session.unconfirmedCreations.map((entry) => <div key={entry.key}><p>{entry.message}</p><button type="button" onClick={() => session.requestTransition(() => {
        if (entry.kind === 'class-create' && entry.key === classCreateKey) session.setView({ showClassCreate: false })
      }, [entry.key])}>結束這次未確認新增並清除輸入</button></div>)}
    </section>}
    {session.error && <p className="form-error" role="alert">{session.error}</p>}
    {session.locked && storageStatus === 'saved' && <p role="status">{session.operation?.type === 'remove-subject-level' ? '正在儲存解除適用關係…' : '正在儲存資源變更，尚未確認持久化…'}</p>}
    {session.success && <p role="status">{session.success}</p>}
    {storageControls && storageStatus !== 'saved' && <section aria-label="資源儲存復原"><p>以下復原操作會套用整份 AppData（所有專案、課表與資源），不是只處理目前這筆科目或班級。尚未提交的草稿仍會保留。</p>
      <button type="button" onClick={() => { if (window.confirm('保留本頁整份 AppData 並寫入此裝置？此操作可能取代其他分頁版本；請先核對資料。')) storageControls.keepLocal() }}>保留本頁完整資料並重試儲存</button>
      {storageStatus === 'conflict' && storageControls.conflictSource === 'current' && <button type="button" onClick={() => { if (window.confirm('採用其他分頁的整份 AppData？本頁已提交但未寫入的變更將被取代；未提交草稿仍保留。')) session.adoptExternal(storageControls.acceptExternal) }}>採用其他分頁版本</button>}
      {storageControls.conflictSource === 'legacy' && <p>舊版分頁變更無法自動合併；請先關閉舊分頁並核對備份，再決定是否保留本頁 v7。</p>}
    </section>}
  </section>
}

function ClassRow({ schoolClass, unit, editable, data, session }: { schoolClass: ProjectClass; unit: TeachingUnit; editable: boolean; data: AppDataV4; session: ResourceManagementSession }) {
  const key = `class:${schoolClass.id}`
  const initial = classDraft(schoolClass)
  const draft = session.draft(key, initial)
  const entry = session.drafts[key]
  const latest = data.classes.find((item) => item.id === schoolClass.id)
  const stale = !latest || Boolean(entry?.source && JSON.stringify(entry.source) !== JSON.stringify(latest))
    || Boolean(entry?.unitSnapshot && JSON.stringify(entry.unitSnapshot) !== JSON.stringify(data.teachingUnits.find((item) => item.id === unit.id)))
  const context = { projectId: schoolClass.projectId, teachingUnitId: schoolClass.teachingUnitId }
  return <form className="class-editor-row" aria-label={`管理班級 ${schoolClass.name}`} onSubmit={(event) => {
    event.preventDefault()
    if (!editable) return
    const roomError = classRoomError(draft.room)
    if (roomError) { session.fail(roomError); return }
    if (!entry) return
    session.submit({ ...context, type: 'update-class', targetId: schoolClass.id, source: schoolClass, draftKeys: [key], success: '已儲存：已更新班級。' }, (current) => updateClass(current, schoolClass.id, draft))
  }}>
    <ClassIdentityFields draft={draft} unit={unit} onChange={(value) => session.edit(key, { ...context, kind: 'class', source: schoolClass, unitSnapshot: unit, initial, value })} prefix="班級" legacyName={schoolClass.grade === undefined || schoolClass.classNumber === undefined} disabled={!editable} />
    <ClassRoomField id={`class-room-help-${schoolClass.id}`} prefix="班級" room={draft.room ?? ''} disabled={!editable} onChange={(room) => session.edit(key, { ...context, kind: 'class', source: schoolClass, unitSnapshot: unit, initial, value: { ...draft, room } })} />
    <span className="class-code-preview">顯示：{classDisplayName({ name: draft.name ?? schoolClass.name, grade: draft.grade, classNumber: draft.classNumber })}</span>
    {stale && <p role="status">來源資料已變更或刪除；草稿保留，請先確認最新資料。</p>}
    <button type="submit" disabled={!editable || stale}>儲存</button><button type="button" className="danger-outline" disabled={!editable || stale} onClick={() => {
      if (window.confirm(`確定刪除「${classDisplayName(schoolClass)}」？`)) session.submit({ ...context, type: 'delete-class', targetId: schoolClass.id, source: schoolClass, draftKeys: [key], success: '已儲存：已刪除班級。' }, (current) => removeClass(current, schoolClass.id))
    }}>刪除</button>
    {entry && <button type="button" onClick={() => session.requestTransition(() => {}, [key])}>捨棄此筆班級草稿</button>}
  </form>
}

function ClassIdentityFields({ draft, unit, onChange, prefix, legacyName = false, disabled = false }: { draft: ClassDraft; unit: TeachingUnit; onChange: (draft: ClassDraft) => void; prefix: string; legacyName?: boolean; disabled?: boolean }) {
  const grades = gradesForLevel(unit.schoolLevel)
  return <>{grades.length > 0 && !legacyName ? <><select className="class-grade-field" aria-label={`${prefix}年級`} value={draft.grade ?? ''} onChange={(event) => onChange({ ...draft, teachingUnitId: unit.id, grade: Number(event.target.value), name: undefined })} disabled={disabled}>{grades.map((grade) => <option key={grade} value={grade}>{gradeLabel(unit.schoolLevel, grade)}</option>)}</select><input className="class-number-field" aria-label={`${prefix}班號`} type="number" inputMode="numeric" min="1" step="1" value={draft.classNumber ?? ''} onChange={(event) => onChange({ ...draft, teachingUnitId: unit.id, classNumber: event.target.value ? Number(event.target.value) : undefined, name: undefined })} placeholder="班號" required disabled={disabled} /></> : <input className="class-name-field" aria-label={`${prefix}名稱`} value={draft.name ?? ''} onChange={(event) => onChange({ ...draft, teachingUnitId: unit.id, name: event.target.value, grade: undefined, classNumber: undefined })} placeholder="班級名稱" required disabled={disabled} />}
  </>
}

function ClassRoomField({ id, prefix, room, disabled, onChange }: { id: string; prefix: string; room: string; disabled: boolean; onChange: (room: string) => void }) {
  const validation = classRoomError(room)
  return <div className="class-room-field"><input aria-label={`${prefix}教室`} aria-invalid={Boolean(validation)} aria-describedby={validation ? id : undefined} maxLength={CLASS_ROOM_MAX_LENGTH} value={room} onChange={(event) => onChange(event.target.value)} placeholder="預設教室" disabled={disabled} />{validation && <small id={id} role="alert">{validation}</small>}</div>
}

function SubjectRow({ subject, editable, data, session, schoolLevel, canConfirmRemoval, onRemoveLevel }: {
  subject: Subject; editable: boolean; data: AppDataV4; session: ResourceManagementSession; schoolLevel: SchoolLevel
  canConfirmRemoval: boolean; onRemoveLevel: (subject: Subject, level: SchoolLevel) => void
}) {
  const key = `subject:${subject.id}`
  const initial = subjectDraft(subject)
  const draft = session.draft(key, initial)
  const entry = session.drafts[key]
  const latest = data.subjects.find((item) => item.id === subject.id)
  const stale = !latest || Boolean(entry?.source && JSON.stringify(entry.source) !== JSON.stringify(latest))
  const context = { projectId: session.view.projectId! }
  const impact = latest ? getSubjectImpact(data, subject.id) : null
  const edit = (value: SubjectDraft) => session.edit(key, { ...context, kind: 'subject', source: subject, initial, value })
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!editable || !entry || !impact) return
    if (!window.confirm(`變更全域科目「${subject.name}」？此科目被 ${impact.projectIds.length} 個專案、${impact.references.length} 筆課程或異動引用；名稱、簡稱、顏色與適用學制會同步影響所有專案。${!subject.applicableSchoolLevels ? '舊資料未指定適用學制，本次會明確設為所有學制。' : ''}`)) return
    session.submit({ ...context, type: 'update-subject', targetId: subject.id, source: subject, draftKeys: [key], success: '已儲存：已更新科目。' }, (current) => updateSubject(current, subject.id, draft, true))
  }
  return <form className="subject-management-row" onSubmit={save} aria-label={`管理科目 ${subject.name}`}>
    <label>名稱<input aria-label={`${subject.name}名稱`} value={draft.name} onChange={(event) => edit({ ...draft, name: event.target.value })} disabled={!editable} /></label>
    <label>簡稱<input aria-label={`${subject.name}簡稱`} value={draft.shortName} onChange={(event) => edit({ ...draft, shortName: event.target.value })} disabled={!editable} /></label>
    <label>顏色<input aria-label={`${subject.name}顏色`} type="color" value={draft.color} onChange={(event) => edit({ ...draft, color: event.target.value })} disabled={!editable} /></label>
    <fieldset><legend>適用學制</legend>{SCHOOL_LEVELS.map((level) => <label key={level}><input type="checkbox" checked={draft.applicableSchoolLevels.includes(level)} disabled={!editable} onChange={(event) => edit({ ...draft, applicableSchoolLevels: event.target.checked ? [...draft.applicableSchoolLevels, level] : draft.applicableSchoolLevels.filter((item) => item !== level) })} />{levelLabel[level]}</label>)}</fieldset>
    {stale && <p role="status">來源資料已變更或刪除；草稿保留，請先確認最新資料，不能直接回寫。</p>}
    <div className="subject-management-actions">{(subject.applicableSchoolLevels ?? SCHOOL_LEVELS).includes(schoolLevel) && <button type="button" disabled={!editable || !canConfirmRemoval || stale} title={!canConfirmRemoval ? '無法確認儲存狀態，請重新開啟管理視窗。' : undefined} onClick={() => onRemoveLevel(subject, schoolLevel)}>解除{levelLabel[schoolLevel]}適用</button>}
      <button type="submit" disabled={!editable || stale}>儲存科目</button><button type="button" className="danger-outline" disabled={!editable || stale} onClick={() => {
        if (window.confirm(`確定刪除全域科目「${subject.name}」？目前有 ${impact?.references.length ?? 0} 筆課程或異動引用；有引用時系統會拒絕刪除。`)) session.submit({ ...context, type: 'delete-subject', targetId: subject.id, source: subject, draftKeys: [key], success: '已儲存：已刪除科目。' }, (current) => deleteSubject(current, subject.id, true))
      }}>刪除科目</button>
      {entry && <button type="button" onClick={() => session.requestTransition(() => {}, [key])}>捨棄此筆科目草稿</button>}
    </div>
  </form>
}

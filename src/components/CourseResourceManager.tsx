import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type ReactNode, type SetStateAction } from 'react'
import { addClass, removeClass, updateClass, type ClassDraft } from '../data/academicSettingsV4'
import { DEFAULT_SUBJECT_CATALOG, OPTIONAL_SUBJECT_CATALOG, type SubjectCatalogEntry } from '../data/defaultSubjects'
import { analyzeSubjectCatalog, type SubjectCatalogAnalysisItem } from '../data/subjectCatalogAnalysis'
import { createProjectSubject, deleteProjectSubject, getProjectSubjectImpact, removeProjectSubjectSchoolLevel, updateProjectSubject } from '../data/subjectManagementAdapter'
import { findProjectSubject, selectProjectSubjects } from '../data/subjectSelectorsV8'
import type { SubjectDraft } from '../data/subjectsV5'
import type { SubjectReference } from '../data/subjectReferences'
import { classDisplayName, gradeLabel, gradesForLevel } from '../lib/classes'
import { normalizeSubjectText } from '../lib/subjectSearch'
import { SCHOOL_LEVELS, type AppDataV4, type ProjectClass, type SchoolLevel, type Subject, type TeachingUnit } from '../types'
import type { StorageControls, StoragePersistence, StorageStatus } from '../hooks/useLocalStorage'
import { useResourceManagementSession, type ResourceManagementSession } from '../hooks/useResourceManagementSession'
import { Modal } from './Modal'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const CLASS_ROOM_MAX_LENGTH = 15
const classRoomError = (room?: string) => (room?.length ?? 0) > CLASS_ROOM_MAX_LENGTH ? `預設教室最多 ${CLASS_ROOM_MAX_LENGTH} 個字元；既有內容已保留，請修正後再儲存。` : ''
const emptyClassDraft = (unit?: TeachingUnit): ClassDraft => ({ teachingUnitId: unit?.id ?? '', grade: gradesForLevel(unit?.schoolLevel ?? 'other')[0], classNumber: undefined, room: '' })
const emptySubjectDraft = (unit?: TeachingUnit): SubjectDraft => ({ name: '', shortName: '', color: '#A66D52', applicableSchoolLevels: unit ? [unit.schoolLevel] : [] })
const levelLabel: Record<SchoolLevel, string> = { 'junior-high': '國中部', 'senior-high': '高中部', other: '其他' }
const unitLabel = (unit: TeachingUnit, units: TeachingUnit[]) => {
  const peers = units.filter((item) => item.schoolId === unit.schoolId && item.schoolLevel === unit.schoolLevel)
  if (peers.length === 1) return unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]
  return `${unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]}（重複設定 ${peers.findIndex((item) => item.id === unit.id) + 1}：${unit.name}）`
}
const subjectDraft = (subject: Subject): SubjectDraft => ({ name: subject.name, shortName: subject.shortName, color: subject.color, applicableSchoolLevels: [...(subject.applicableSchoolLevels ?? SCHOOL_LEVELS)] })
const classDraft = (item: ProjectClass): ClassDraft => ({ name: item.name, grade: item.grade, classNumber: item.classNumber, room: item.room ?? '', teachingUnitId: item.teachingUnitId })

type EditorSelection = { kind: 'subject' | 'class'; id: string } | { kind: 'subject-create' } | null
const subjectCatalog = [...DEFAULT_SUBJECT_CATALOG, ...OPTIONAL_SUBJECT_CATALOG] as readonly SubjectCatalogEntry[]

const referenceKindLabel: Record<SubjectReference['kind'], string> = {
  lesson: '固定課程',
  override: '課程異動',
  'one-off': '單日課程',
}

function subjectReferenceLabel(data: AppDataV4, reference: SubjectReference) {
  const project = reference.projectId ? data.projects.find((item) => item.id === reference.projectId) : undefined
  const unit = reference.teachingUnitId ? data.teachingUnits.find((item) => item.id === reference.teachingUnitId) : undefined
  const flags = [reference.historical ? '歷史版本' : '', reference.archived ? '封存專案' : ''].filter(Boolean)
  const scope = [project?.name ?? (reference.projectId ? `專案 ${reference.projectId}` : '無法判斷專案'), unit?.name ?? (reference.teachingUnitId ? `任教單位 ${reference.teachingUnitId}` : '無法判斷學制')]
  return `${flags.length ? `${flags.join('、')} ` : ''}${referenceKindLabel[reference.kind]}「${reference.id}」（${scope.join('／')}）`
}

function subjectOperationError(data: AppDataV4, cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback
  const references = (cause as Error & { details?: { blockedReferences?: SubjectReference[] } }).details?.blockedReferences
  if (!references?.length) return cause.message
  const shown = references.slice(0, 3).map((reference) => subjectReferenceLabel(data, reference))
  const remainder = references.length - shown.length
  return `${cause.message} 阻擋項目：${shown.join('；')}${remainder > 0 ? `；另有 ${remainder} 筆引用` : ''}。請先在原課程或異動中改用其他科目。`
}

function catalogConflictMessage(data: AppDataV4, item: SubjectCatalogAnalysisItem) {
  const existing = item.existingSubjectIds.map((id) => data.subjects.find((subject) => subject.id === id)).filter((subject): subject is Subject => Boolean(subject))
  if (item.status === 'exists-missing-level') return existing[0]
    ? `既有科目「${existing[0].name}」尚未加入目前學制；會保留原 ID、名稱、簡稱與顏色。`
    : item.reason
  if (item.status === 'alias-match-review') return existing.length
    ? `符合既有科目${existing.map((subject) => `「${subject.name}」`).join('、')}；請先檢視，系統不會自動合併。`
    : item.reason
  if (item.status === 'short-name-conflict') return existing.length
    ? `簡稱「${existing[0].shortName}」已由${existing.map((subject) => `「${subject.name}」`).join('、')}使用。`
    : item.reason
  if (item.status === 'same-name-review') return existing.length
    ? `找到 ${existing.length} 筆同名科目：${existing.map((subject) => `「${subject.name}」`).join('、')}；不得自動選擇。`
    : item.reason
  return item.reason
}

function catalogStatusLabel(item: SubjectCatalogAnalysisItem) {
  if (item.status === 'alias-match-review') return '既有科目'
  if (item.status === 'short-name-conflict') return '簡稱衝突'
  if (item.status === 'same-name-review') return '同名資料'
  if (item.status === 'catalog-key-id-conflict') return 'ID 衝突'
  return '目錄錯誤'
}

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
  onCreated?: (mode: 'classes' | 'subjects', id: string) => void
}

function persistedCreationKey(operation: ResourceManagementSession['operation']) {
  return operation?.status === 'persisted' && (operation.type === 'create-class' || operation.type === 'create-subject')
    ? `${operation.startedRevision}:${operation.type}:${operation.targetId}` : null
}

export function CourseResourceManagerDialog(props: Props & { onClose: () => void }) {
  const { onCreated } = props
  const localSession = useResourceManagementSession(props.data, props.setData, props.storageStatus, props.storagePersistence)
  const session = props.session ?? localSession
  const trigger = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const handledCreation = useRef(persistedCreationKey(session.operation))
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
  useEffect(() => {
    const operation = session.operation
    const key = persistedCreationKey(operation)
    if (!key || key === handledCreation.current || !operation || !onCreated) return
    handledCreation.current = key
    onCreated(operation.type === 'create-class' ? 'classes' : 'subjects', operation.targetId)
  }, [onCreated, session.operation])
  return <Modal title={props.mode === 'classes' ? '管理班級' : '管理科目'} subtitle={props.mode === 'classes' ? '班級屬於所選專案與學制，不屬於教師課表。' : props.data.schemaVersion === 8 ? '科目庫屬於所選專案，變更只會影響該專案內的課程。' : '科目庫由所有專案共用，變更會影響適用的課程。'} onClose={() => session.requestTransition(props.onClose)}>
    <div className="resource-manager-dialog">
      <div ref={content} className="resource-manager-scroll">
        <CourseResourceManager {...props} session={session} />
      </div>
      <div className="resource-manager-complete">
        <p>「新增{props.mode === 'classes' ? '班級' : '科目'}」會儲存目前這一筆；「建立」會完成管理並返回原流程。</p>
        <button type="button" className="primary-button" disabled={session.locked} onClick={() => session.requestTransition(props.onClose)}>建立</button>
      </div>
    </div>
  </Modal>
}

export function CourseResourceManager(props: Props) {
  const localSession = useResourceManagementSession(props.data, props.setData, props.storageStatus, props.storagePersistence)
  return <ResourceManagerContent {...props} session={props.session ?? localSession} />
}

function ResourceManagerContent({ data, mode, storageStatus = 'saved', storagePersistence, storageControls, readOnly = false, onOpenSettings, session }: Props & { session: ResourceManagementSession }) {
  const { schoolId, unitId, showClassCreate, projectId } = session.view
  const [editor, setEditor] = useState<EditorSelection>(null)
  const [subjectQuery, setSubjectQuery] = useState('')
  const [subjectActionId, setSubjectActionId] = useState<string | null>(null)
  const managerContent = useRef<HTMLElement>(null)
  const editorTrigger = useRef<HTMLElement | null>(null)
  const previousEditor = useRef<EditorSelection>(null)
  const project = data.projects.find((item) => item.id === projectId)
  const schools = data.schools.filter((item) => item.projectId === projectId)
  const units = data.teachingUnits.filter((item) => item.projectId === projectId)
  const schoolUnits = units.filter((item) => item.schoolId === schoolId)
  const duplicate = schoolUnits.some((unit) => schoolUnits.some((item) => item.id !== unit.id && item.schoolLevel === unit.schoolLevel))
  const unit = schoolUnits.find((item) => item.id === unitId)
  const editable = !readOnly && Boolean(project && !project.archivedAt) && data.activeProjectId === projectId && storageStatus === 'saved' && !session.locked
  const subjectCreateKey = `subject-create:${projectId}:${unitId}`
  const classCreateKey = `class-create:${projectId}:${unitId}`
  const newSubject = session.draft(subjectCreateKey, emptySubjectDraft(unit))
  const newClass = session.draft(classCreateKey, emptyClassDraft(unit))
  const subjectCreateLocked = !editable || Boolean(session.drafts[subjectCreateKey]?.submittedTargetId)
  const classCreateLocked = !editable || Boolean(session.drafts[classCreateKey]?.submittedTargetId)
  const classes = data.classes.filter((item) => item.projectId === projectId && item.teachingUnitId === unitId)
  const projectSubjects = useMemo(() => selectProjectSubjects(data, projectId), [data, projectId])
  const subjectsInScope = !unit ? [] : projectSubjects.filter((subject) => (subject.applicableSchoolLevels ?? SCHOOL_LEVELS).includes(unit.schoolLevel))
  const needle = normalizeSubjectText(subjectQuery)
  const visibleSubjects = subjectsInScope.filter((subject) => !needle || normalizeSubjectText(subject.name).includes(needle) || normalizeSubjectText(subject.shortName).includes(needle))
  const catalogReport = unit ? analyzeSubjectCatalog(projectSubjects, unit.schoolLevel, subjectCatalog) : null
  const visibleCatalogItems = catalogReport?.items.map((item) => ({ item, entry: subjectCatalog.find((entry) => entry.catalogKey === item.catalogKey)! }))
    .filter(({ entry }) => !needle || [entry.name, entry.shortName, ...entry.aliases, ...entry.zhuyinAliases].some((value) => normalizeSubjectText(value).includes(needle))) ?? []
  const retained = Object.entries(session.drafts).filter(([key, entry]) => mode === 'subjects'
    ? (entry.kind === 'subject' && !projectSubjects.some((item) => `subject:${item.id}` === key)) || (entry.kind === 'subject-create' && !key.startsWith('subject-catalog:') && (!unit || key !== subjectCreateKey))
    : (entry.kind === 'class' && !classes.some((item) => `class:${item.id}` === key)) || (entry.kind === 'class-create' && (!unit || key !== classCreateKey)))
  const dirtyCount = Object.values(session.drafts).filter((entry) => mode === 'subjects'
    ? entry.kind === 'subject' || entry.kind === 'subject-create' : entry.kind === 'class' || entry.kind === 'class-create').length

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

  useEffect(() => {
    if (editor?.kind === 'subject' && !projectSubjects.some((item) => item.id === editor.id) && !session.drafts[`subject:${editor.id}`]) setEditor(null)
    if (editor?.kind === 'class' && !data.classes.some((item) => item.id === editor.id) && !session.drafts[`class:${editor.id}`]) setEditor(null)
  }, [data.classes, editor, projectSubjects, session.drafts])

  useEffect(() => {
    if (editor && previousEditor.current !== editor) managerContent.current?.querySelector<HTMLButtonElement>('.resource-editor-heading > button')?.focus()
    else if (!editor && previousEditor.current) {
      const fallback = managerContent.current?.querySelector<HTMLElement>('.resource-browser button:not(:disabled), .resource-browser input:not(:disabled)')
      ;(editorTrigger.current?.isConnected ? editorTrigger.current : fallback)?.focus()
    }
    previousEditor.current = editor
  }, [editor])

  const openEditor = (selection: Exclude<EditorSelection, null>) => {
    editorTrigger.current = document.activeElement as HTMLElement | null
    setEditor(selection)
  }

  const changeScope = (nextSchoolId: string, nextUnitId: string) => {
    const affected = session.dirtyKeys.filter((key) => {
      const entry = session.drafts[key]
      if (entry.kind === 'subject') return false
      if (entry.kind === 'class') return mode === 'classes' && entry.teachingUnitId !== nextUnitId
      return entry.teachingUnitId !== nextUnitId || nextSchoolId !== schoolId
    })
    session.requestTransition(() => {
      session.setView({ schoolId: nextSchoolId, unitId: nextUnitId, showAllSubjects: false, showClassCreate: false })
      setEditor(null)
    }, affected)
  }
  const createClass = (event: FormEvent) => {
    event.preventDefault()
    if (!editable || !unit || !projectId) return
    const roomError = classRoomError(newClass.room)
    if (roomError) { session.fail(roomError); return }
    const id = session.drafts[classCreateKey]?.submittedTargetId ?? uid()
    session.submit({ type: 'create-class', targetId: id, projectId, teachingUnitId: unit.id, draftKeys: [classCreateKey], success: '已儲存：已新增班級。' }, (current) => addClass(current, projectId, newClass, id))
  }
  const createNewSubject = (event: FormEvent) => {
    event.preventDefault()
    if (!editable || !unit || !projectId) return
    const id = session.drafts[subjectCreateKey]?.submittedTargetId ?? uid()
    session.submit({ type: 'create-subject', targetId: id, projectId, teachingUnitId: unit.id, draftKeys: [subjectCreateKey], success: '已儲存：已新增科目。' }, (current) => createProjectSubject(current, projectId, newSubject, id))
  }
  const addCatalogSubject = (entry: SubjectCatalogEntry) => {
    if (!editable || !unit || !projectId) return
    const analysis = analyzeSubjectCatalog(projectSubjects, unit.schoolLevel, subjectCatalog).items.find((item) => item.catalogKey === entry.catalogKey)
    if (!analysis || analysis.status !== 'safe-to-add') {
      session.fail(analysis?.reason ?? '此預設科目不適用目前學制。')
      return
    }
    const key = `subject-catalog:${projectId}:${unit.id}:${entry.catalogKey}`
    const draft: SubjectDraft = { name: entry.name, shortName: entry.shortName, color: entry.color, applicableSchoolLevels: [unit.schoolLevel] }
    session.edit(key, { kind: 'subject-create', projectId, teachingUnitId: unit.id, source: null, unitSnapshot: unit, initial: emptySubjectDraft(unit), value: draft })
    const id = session.drafts[key]?.submittedTargetId ?? uid()
    session.submit({ type: 'create-subject', targetId: id, projectId, teachingUnitId: unit.id, draftKeys: [key], success: `已儲存：已加入預設科目「${entry.name}」。` },
      (current) => createProjectSubject(current, projectId, draft, id))
  }
  const addCatalogSubjectLevel = (entry: SubjectCatalogEntry, subjectId: string) => {
    if (!editable || !unit || !projectId) return
    const subject = findProjectSubject(data, projectId, subjectId)
    if (!subject) { session.fail('找不到要擴充學制的既有科目。'); return }
    const levels = subject.applicableSchoolLevels ?? [...SCHOOL_LEVELS]
    if (levels.includes(unit.schoolLevel)) return
    const draft: SubjectDraft = { name: subject.name, shortName: subject.shortName, color: subject.color, applicableSchoolLevels: [...levels, unit.schoolLevel] }
    setSubjectActionId(subject.id)
    try {
      updateProjectSubject(data, projectId, subject.id, draft, true)
      if (!window.confirm(`將既有科目「${subject.name}」加入${levelLabel[unit.schoolLevel]}適用？\n科目 ID、名稱、簡稱與顏色都會保留。`)) return
      session.requestTransition(() => session.submit({ type: 'update-subject', targetId: subject.id, projectId, teachingUnitId: unit.id, source: subject, draftKeys: [], success: `已儲存：已將「${entry.name}」加入${levelLabel[unit.schoolLevel]}適用。` },
        (current) => updateProjectSubject(current, projectId, subject.id, draft, true)), [`subject:${subject.id}`])
    } catch (cause) { session.fail(subjectOperationError(data, cause, '目前無法將這個科目加入目前學制。')) }
  }
  const removeSubjectLevel = (subject: Subject, level: SchoolLevel) => {
    if (!editable || !storagePersistence || !projectId) return
    setSubjectActionId(subject.id)
    try {
      removeProjectSubjectSchoolLevel(data, projectId, subject.id, level, true)
      if (!window.confirm(`解除「${subject.name}」的${levelLabel[level]}適用關係？\n此操作會讓所有${levelLabel[level]}課程無法再選用這個科目，但會保留科目本身及其他學制。\n若目前仍有課程使用，系統會阻止這項變更。`)) return
      session.submit({ type: 'remove-subject-level', targetId: subject.id, projectId, source: subject, draftKeys: [], success: `已儲存：已解除「${subject.name}」的${levelLabel[level]}適用關係；科目與其他學制均已保留。` }, (current) => removeProjectSubjectSchoolLevel(current, projectId, subject.id, level, true))
    } catch (cause) { session.fail(subjectOperationError(data, cause, '目前無法取消這個學制，請確認是否仍有課程使用此科目。')) }
  }
  const removeSelectedSubject = (subject: Subject) => {
    if (!editable || !storagePersistence || !unit || !projectId) return
    setSubjectActionId(subject.id)
    const levels = subject.applicableSchoolLevels ?? [...SCHOOL_LEVELS]
    try {
      if (levels.length > 1) {
        removeProjectSubjectSchoolLevel(data, projectId, subject.id, unit.schoolLevel, true)
        if (!window.confirm(`取消「${subject.name}」在${data.schemaVersion === 8 ? '目前專案' : '所有專案'}的${levelLabel[unit.schoolLevel]}適用？\n科目本身與其他學制仍會保留；若目前或歷史課程仍有引用，系統會阻止操作。`)) return
        session.requestTransition(() => session.submit({ type: 'remove-subject-level', targetId: subject.id, projectId, source: subject, draftKeys: [], success: `已儲存：已取消「${subject.name}」的${levelLabel[unit.schoolLevel]}適用。` },
          (current) => removeProjectSubjectSchoolLevel(current, projectId, subject.id, unit.schoolLevel, true)), [`subject:${subject.id}`])
      } else {
        deleteProjectSubject(data, projectId, subject.id, true)
        if (!window.confirm(`「${subject.name}」目前只適用${levelLabel[unit.schoolLevel]}，資料模型無法只取消最後一個適用學制。\n確定永久刪除這筆科目？若有任何專案、歷史課程或異動引用，系統會阻止刪除。`)) return
        session.requestTransition(() => session.submit({ type: 'delete-subject', targetId: subject.id, projectId, source: subject, draftKeys: [], success: `已儲存：已永久刪除科目「${subject.name}」。` },
          (current) => deleteProjectSubject(current, projectId, subject.id, true)), [`subject:${subject.id}`])
      }
    } catch (cause) { session.fail(subjectOperationError(data, cause, '目前無法安全移除這個科目。')) }
  }
  const openSettings = onOpenSettings ? () => session.requestTransition(onOpenSettings) : undefined
  const returnToList = () => {
    if (session.locked) { session.fail('這筆變更尚未完成儲存，請先完成儲存或處理復原。'); return }
    setEditor(null)
  }
  const selectedSubjectEntry = editor?.kind === 'subject' ? session.drafts[`subject:${editor.id}`] : undefined
  const selectedSubject = editor?.kind === 'subject' ? (selectedSubjectEntry?.source as Subject | undefined) ?? findProjectSubject(data, projectId, editor.id) : undefined
  const selectedClassEntry = editor?.kind === 'class' ? session.drafts[`class:${editor.id}`] : undefined
  const selectedClass = editor?.kind === 'class' ? (selectedClassEntry?.source as ProjectClass | undefined) ?? data.classes.find((item) => item.id === editor.id) : undefined
  const selectedClassUnit = selectedClassEntry?.unitSnapshot ?? units.find((item) => item.id === selectedClass?.teachingUnitId)

  return <section ref={managerContent} className="academic-settings resource-manager" data-resource-state={session.status}>
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

    {mode === 'subjects' && unit && !editor && <section className="resource-browser subject-picker" aria-label="科目清單">
      <ResourceBrowserHeading title="我的科目" description={`目前${levelLabel[unit.schoolLevel]}可使用的科目。點標籤可編輯；× 會取消${data.schemaVersion === 8 ? '目前專案' : '所有專案'}的目前學制適用，若是唯一適用學制則會明確詢問是否永久刪除。`} dirtyCount={dirtyCount} action={null} />
      <label className="subject-picker-search">搜尋科目<input type="search" aria-label="搜尋科目" value={subjectQuery} onChange={(event) => setSubjectQuery(event.target.value)} placeholder="搜尋已選與預設科目" /></label>
      <div className="subject-chip-list" aria-label="我的科目標籤">
        {visibleSubjects.map((subject) => <div key={subject.id} style={{ display: 'grid', gap: 4 }}><SubjectChip subject={subject} session={session} projectScoped={data.schemaVersion === 8} disabled={!editable || !storagePersistence} onSelect={() => openEditor({ kind: 'subject', id: subject.id })} onRemove={() => removeSelectedSubject(subject)} />{subjectActionId === subject.id && session.error && <p className="form-error" role="alert">{session.error}</p>}</div>)}
        {!visibleSubjects.length && <p className="resource-list-empty">{subjectsInScope.length ? '我的科目中沒有符合搜尋條件的項目。' : '目前學制尚未選用科目，請從下方預設目錄加入。'}</p>}
      </div>
      <section className="subject-catalog-picker" aria-label="加入預設科目">
        <div><h3>加入預設科目</h3><p>目錄依目前學制篩選；＋ 只會建立通過既有衝突檢查的科目。</p></div>
        <div className="subject-catalog-cards">
          {visibleCatalogItems.map(({ item, entry }) => {
            const message = catalogConflictMessage(data, item)
            const existingSubjectId = item.existingSubjectIds[0]
            const inlineError = existingSubjectId && subjectActionId === existingSubjectId ? session.error : ''
            return <div key={item.catalogKey} className={`subject-catalog-card ${item.status}`} title={message}><i style={{ background: entry.color }} aria-hidden="true" /><span><strong>{entry.name}</strong><small>{entry.shortName}</small>{!['safe-to-add', 'exists-applicable'].includes(item.status) && <small role={inlineError ? 'alert' : undefined}>{inlineError || message}</small>}</span>{item.status === 'safe-to-add' ? <button type="button" aria-label={`加入預設科目 ${entry.name}`} title={`加入 ${entry.name}`} disabled={!editable || session.locked} onClick={() => addCatalogSubject(entry)}>＋</button> : item.status === 'exists-applicable' ? <em>已加入</em> : item.status === 'exists-missing-level' && existingSubjectId ? <button type="button" aria-label={`將既有科目 ${entry.name} 加入此學制`} title={message} disabled={!editable || session.locked} onClick={() => addCatalogSubjectLevel(entry, existingSubjectId)} style={{ width: 'auto', height: 'auto', padding: '5px 8px', borderRadius: 'var(--radius-sm)', fontSize: 10, whiteSpace: 'nowrap' }}>加入此學制</button> : <em title={message}>{catalogStatusLabel(item)}</em>}</div>
          })}
          {!visibleCatalogItems.length && <p className="resource-list-empty">{unit.schoolLevel === 'other' ? '現有預設目錄沒有「其他」學制項目，可在下方新增自訂科目。' : '預設目錄中沒有符合搜尋條件的科目。'}</p>}
        </div>
      </section>
      <div className="subject-custom-action"><span>找不到需要的科目？</span><button type="button" className="resource-add-button" aria-label="＋ 新增科目" disabled={!editable} onClick={() => openEditor({ kind: 'subject-create' })}>＋ 新增自訂科目{session.drafts[subjectCreateKey] ? '（未儲存）' : ''}</button></div>
    </section>}

    {mode === 'subjects' && unit && editor?.kind === 'subject-create' && <section className="resource-editor-shell">
      <EditorHeading title="新增科目" dirty={Boolean(session.drafts[subjectCreateKey])} locked={session.locked} onBack={returnToList} backLabel="返回科目清單" />
      <form className="resource-editor subject-management-row" aria-label="新增科目表單" onSubmit={createNewSubject}>
        <SubjectFields draft={newSubject} prefix="新科目" disabled={subjectCreateLocked} onChange={(value) => session.edit(subjectCreateKey, { kind: 'subject-create', projectId: projectId!, teachingUnitId: unitId, source: null, unitSnapshot: unit, initial: emptySubjectDraft(unit), value })} />
        <div className="subject-management-actions"><button type="submit" className="primary-button" disabled={subjectCreateLocked}>{session.locked ? '儲存中…' : '新增科目'}</button>{session.drafts[subjectCreateKey] && <button type="button" onClick={() => session.requestTransition(() => setEditor(null), [subjectCreateKey])}>捨棄草稿</button>}</div>
      </form>
    </section>}
    {mode === 'subjects' && selectedSubject && <section className="resource-editor-shell">
      <EditorHeading title={`編輯科目｜${selectedSubject.name}`} dirty={Boolean(selectedSubjectEntry)} locked={session.locked} onBack={returnToList} backLabel="返回科目清單" />
      <SubjectEditor subject={selectedSubject} editable={editable} data={data} session={session} schoolLevel={unit?.schoolLevel ?? 'other'} canConfirmRemoval={Boolean(storagePersistence)} onRemoveLevel={removeSubjectLevel} />
    </section>}
    {mode === 'subjects' && !unit && units.length > 0 && <p className="settings-empty">請先選擇學校與學制，才能查看或新增科目。</p>}

    {mode === 'classes' && unit && !editor && <section className="resource-browser" aria-label="班級清單">
      <ResourceBrowserHeading title="班級" description="班級屬於目前專案與學制，不受教師課表篩選影響。" dirtyCount={dirtyCount} action={<button type="button" className="resource-add-button class-create-trigger" aria-expanded={showClassCreate} aria-controls="inline-class-create" disabled={!editable} onClick={() => session.setView({ showClassCreate: true })}>＋ 新增班級{session.drafts[classCreateKey] ? '（未儲存）' : ''}</button>} />
      <div className="resource-list">
        {classes.map((item) => <ClassListItem key={item.id} item={item} session={session} onSelect={() => openEditor({ kind: 'class', id: item.id })} />)}
        {!classes.length && <p className="resource-list-empty">目前學制尚無班級。</p>}
      </div>
      {showClassCreate && <section id="inline-class-create" className="inline-class-create" aria-label="建立新班級">
        <header><div><h4>新增班級</h4><p>選擇年級與班號後會自動產生班級名稱。</p></div>{session.drafts[classCreateKey] && <span className="resource-dirty-badge">未儲存</span>}</header>
        <form className="resource-editor class-editor-row class-create" aria-label="新增班級表單" onSubmit={createClass}>
          <ClassIdentityFields draft={newClass} unit={unit} onChange={(value) => session.edit(classCreateKey, { kind: 'class-create', projectId: projectId!, teachingUnitId: unitId, source: null, unitSnapshot: unit, initial: emptyClassDraft(unit), value })} prefix="新班級" disabled={classCreateLocked} />
          <ClassRoomField id="new-class-room-help" prefix="新班級" room={newClass.room ?? ''} disabled={classCreateLocked} onChange={(room) => session.edit(classCreateKey, { kind: 'class-create', projectId: projectId!, teachingUnitId: unitId, source: null, unitSnapshot: unit, initial: emptyClassDraft(unit), value: { ...newClass, room } })} />
          <span className="class-code-preview">顯示：{classDisplayName({ name: newClass.name ?? '', grade: newClass.grade, classNumber: newClass.classNumber })}</span>
          <div className="class-create-actions"><button type="submit" className="primary-button class-create-submit" disabled={classCreateLocked}>{session.locked ? '儲存中…' : '新增班級'}</button><button type="button" disabled={session.locked} onClick={() => session.setView({ showClassCreate: false })}>收起</button>{session.drafts[classCreateKey] && <button type="button" disabled={session.locked} onClick={() => session.requestTransition(() => session.setView({ showClassCreate: false }), [classCreateKey])}>捨棄草稿</button>}</div>
        </form>
      </section>}
    </section>}
    {mode === 'classes' && selectedClass && selectedClassUnit && <section className="resource-editor-shell">
      <EditorHeading title={`編輯班級｜${classDisplayName(selectedClass)}`} dirty={Boolean(selectedClassEntry)} locked={session.locked} onBack={returnToList} backLabel="返回班級清單" />
      <ClassEditor schoolClass={selectedClass} unit={selectedClassUnit} editable={editable} data={data} session={session} />
    </section>}
    {mode === 'classes' && !unit && units.length > 0 && <p className="settings-empty">請選擇學制，才能管理班級。</p>}

    {retained.length > 0 && <section className="retained-resource-drafts" aria-label="保留的資源草稿"><p>來源資料已變更、刪除或不在目前範圍；草稿已保留，不會自動重建資源。</p>{retained.map(([key, entry]) => {
      const editableKind = entry.kind === 'subject' || entry.kind === 'class' ? entry.kind : null
      return <div key={key}>{editableKind && entry.source ? <button type="button" onClick={() => openEditor({ kind: editableKind, id: entry.source!.id })}>檢視「{entry.source.name}」草稿</button> : <><span aria-label="保留的新增草稿">{entry.kind === 'subject-create' ? String((entry.value as SubjectDraft).name) : String((entry.value as ClassDraft).name ?? '')}</span><button type="button" onClick={() => session.requestTransition(() => {}, [key])}>捨棄此筆新增草稿</button></>}</div>
    })}</section>}
    {session.unconfirmedCreations.length > 0 && <section aria-label="未確認的新增操作"><p>請先核對原新增 ID。結束這次未確認新增只會清除該筆輸入，保留目前文件中的資源；不會認定本地儲存成功。</p>{session.unconfirmedCreations.map((entry) => <div key={entry.key}><p>{entry.message}</p><button type="button" onClick={() => session.requestTransition(() => { if (entry.kind === 'class-create' && entry.key === classCreateKey) session.setView({ showClassCreate: false }); if (entry.key === subjectCreateKey || entry.key === classCreateKey) setEditor(null) }, [entry.key])}>結束這次未確認新增並清除輸入</button></div>)}</section>}
    {session.error && !(mode === 'subjects' && !editor && subjectActionId && (visibleSubjects.some((subject) => subject.id === subjectActionId) || visibleCatalogItems.some(({ item }) => item.existingSubjectIds.includes(subjectActionId)))) && <p className="form-error" role="alert">{session.error}</p>}
    {session.locked && storageStatus === 'saved' && <p role="status">{session.operation?.type === 'remove-subject-level' ? '正在儲存解除適用關係…' : '正在儲存資源變更，尚未確認持久化…'}</p>}
    {session.success && <p role="status">{session.success}</p>}
    {storageControls && storageStatus !== 'saved' && <section aria-label="資源儲存復原"><p>以下復原操作會套用整份 AppData（所有專案、課表與資源），不是只處理目前這筆科目或班級。尚未提交的草稿仍會保留。</p><button type="button" onClick={() => { if (window.confirm('保留本頁整份 AppData 並寫入此裝置？此操作可能取代其他分頁版本；請先核對資料。')) storageControls.keepLocal() }}>保留本頁完整資料並重試儲存</button>{storageStatus === 'conflict' && storageControls.conflictSource === 'current' && <button type="button" onClick={() => { if (window.confirm('採用其他分頁的整份 AppData？本頁已提交但未寫入的變更將被取代；未提交草稿仍保留。')) session.adoptExternal(storageControls.acceptExternal) }}>採用其他分頁版本</button>}{storageControls.conflictSource === 'legacy' && <p>舊版分頁變更無法自動合併；請先關閉舊分頁並核對備份，再決定是否保留本頁 v7。</p>}</section>}
  </section>
}

function ResourceBrowserHeading({ title, description, dirtyCount, action }: { title: string; description: string; dirtyCount: number; action: ReactNode }) {
  return <header className="resource-browser-heading"><div><h3>{title}</h3><p>{description}</p></div><div>{dirtyCount > 0 && <span className="resource-dirty-count">{dirtyCount} 筆未儲存</span>}{action}</div></header>
}

function EditorHeading({ title, dirty, locked, onBack, backLabel }: { title: string; dirty: boolean; locked: boolean; onBack: () => void; backLabel: string }) {
  return <header className="resource-editor-heading"><button type="button" onClick={onBack} disabled={locked}>← {backLabel}</button><div><h3>{title}</h3>{dirty && <span className="resource-dirty-badge">未儲存</span>}</div></header>
}

function SubjectChip({ subject, session, projectScoped, disabled, onSelect, onRemove }: { subject: Subject; session: ResourceManagementSession; projectScoped: boolean; disabled: boolean; onSelect: () => void; onRemove: () => void }) {
  const key = `subject:${subject.id}`
  const preview = session.draft(key, subjectDraft(subject))
  const levels = subject.applicableSchoolLevels ?? SCHOOL_LEVELS
  const removeAction = levels.length > 1 ? `取消「${subject.name}」在${projectScoped ? '目前專案' : '所有專案'}的目前學制適用` : `永久刪除科目「${subject.name}」`
  return <div className="subject-chip">
    <button type="button" className="subject-chip-edit" aria-label={`編輯科目 ${subject.name}`} onClick={onSelect}><i style={{ background: preview.color }} aria-hidden="true" /><span>{preview.name}</span>{session.drafts[key] && <em>未儲存</em>}</button>
    <button type="button" className="subject-chip-remove" aria-label={removeAction} title={removeAction} disabled={disabled || session.locked} onClick={onRemove}>×</button>
  </div>
}

function ClassListItem({ item, session, onSelect }: { item: ProjectClass; session: ResourceManagementSession; onSelect: () => void }) {
  const key = `class:${item.id}`
  const preview = session.draft(key, classDraft(item))
  return <button type="button" className="resource-list-item class-resource-item" aria-label={`編輯班級 ${classDisplayName(item)}`} onClick={onSelect}>
    <span><strong>{classDisplayName({ ...item, ...preview })}</strong><small>{preview.room || '未設定教室'}</small></span>{session.drafts[key] && <em>未儲存</em>}
  </button>
}

function ClassEditor({ schoolClass, unit, editable, data, session }: { schoolClass: ProjectClass; unit: TeachingUnit; editable: boolean; data: AppDataV4; session: ResourceManagementSession }) {
  const key = `class:${schoolClass.id}`
  const initial = classDraft(schoolClass)
  const draft = session.draft(key, initial)
  const entry = session.drafts[key]
  const latest = data.classes.find((item) => item.id === schoolClass.id)
  const stale = !latest || Boolean(entry?.source && JSON.stringify(entry.source) !== JSON.stringify(latest)) || Boolean(entry?.unitSnapshot && JSON.stringify(entry.unitSnapshot) !== JSON.stringify(data.teachingUnits.find((item) => item.id === unit.id)))
  const context = { projectId: schoolClass.projectId, teachingUnitId: schoolClass.teachingUnitId }
  return <form className="resource-editor class-editor-row" aria-label={`管理班級 ${schoolClass.name}`} onSubmit={(event) => {
    event.preventDefault()
    if (!editable) return
    const roomError = classRoomError(draft.room)
    if (roomError) { session.fail(roomError); return }
    if (entry) session.submit({ ...context, type: 'update-class', targetId: schoolClass.id, source: schoolClass, draftKeys: [key], success: '已儲存：已更新班級。' }, (current) => updateClass(current, schoolClass.id, draft))
  }}>
    <ClassIdentityFields draft={draft} unit={unit} onChange={(value) => session.edit(key, { ...context, kind: 'class', source: schoolClass, unitSnapshot: unit, initial, value })} prefix="班級" legacyName={schoolClass.grade === undefined || schoolClass.classNumber === undefined} disabled={!editable} />
    <ClassRoomField id={`class-room-help-${schoolClass.id}`} prefix="班級" room={draft.room ?? ''} disabled={!editable} onChange={(room) => session.edit(key, { ...context, kind: 'class', source: schoolClass, unitSnapshot: unit, initial, value: { ...draft, room } })} />
    <span className="class-code-preview">顯示：{classDisplayName({ name: draft.name ?? schoolClass.name, grade: draft.grade, classNumber: draft.classNumber })}</span>
    {stale && <p className="resource-editor-message" role="status">這筆班級已在其他地方變更或刪除。草稿仍保留，但不能直接覆寫，請先核對最新資料。</p>}
    <div className="resource-editor-actions"><button type="submit" className="primary-button" disabled={!editable || stale || !entry}>儲存班級</button><button type="button" className="danger-outline" disabled={!editable || stale} onClick={() => { if (window.confirm(`確定刪除「${classDisplayName(schoolClass)}」？如果仍有課程使用這個班級，系統會阻止刪除。`)) session.submit({ ...context, type: 'delete-class', targetId: schoolClass.id, source: schoolClass, draftKeys: [key], success: '已儲存：已刪除班級。' }, (current) => removeClass(current, schoolClass.id)) }}>刪除班級</button>{entry && <button type="button" onClick={() => session.requestTransition(() => {}, [key])}>捨棄草稿</button>}</div>
  </form>
}

function ClassIdentityFields({ draft, unit, onChange, prefix, legacyName = false, disabled = false }: { draft: ClassDraft; unit: TeachingUnit; onChange: (draft: ClassDraft) => void; prefix: string; legacyName?: boolean; disabled?: boolean }) {
  const grades = gradesForLevel(unit.schoolLevel)
  return <div className="class-identity-fields">{grades.length > 0 && !legacyName ? <><label>年級<select className="class-grade-field" aria-label={`${prefix}年級`} value={draft.grade ?? ''} onChange={(event) => onChange({ ...draft, teachingUnitId: unit.id, grade: Number(event.target.value), name: undefined })} disabled={disabled}>{grades.map((grade) => <option key={grade} value={grade}>{gradeLabel(unit.schoolLevel, grade)}</option>)}</select></label><label>班號<input className="class-number-field" aria-label={`${prefix}班號`} type="number" inputMode="numeric" min="1" step="1" value={draft.classNumber ?? ''} onChange={(event) => onChange({ ...draft, teachingUnitId: unit.id, classNumber: event.target.value ? Number(event.target.value) : undefined, name: undefined })} placeholder="班號" required disabled={disabled} /></label></> : <label>班級名稱<input className="class-name-field" aria-label={`${prefix}名稱`} value={draft.name ?? ''} onChange={(event) => onChange({ ...draft, teachingUnitId: unit.id, name: event.target.value, grade: undefined, classNumber: undefined })} placeholder="班級名稱" required disabled={disabled} /></label>}</div>
}

function ClassRoomField({ id, prefix, room, disabled, onChange }: { id: string; prefix: string; room: string; disabled: boolean; onChange: (room: string) => void }) {
  const validation = classRoomError(room)
  return <label className="class-room-field">教室（選填）<input aria-label={`${prefix}教室`} aria-invalid={Boolean(validation)} aria-describedby={validation ? id : undefined} maxLength={CLASS_ROOM_MAX_LENGTH} value={room} onChange={(event) => onChange(event.target.value)} placeholder="預設教室" disabled={disabled} />{validation && <small id={id} role="alert">{validation}</small>}</label>
}

function SubjectFields({ draft, prefix, disabled, onChange }: { draft: SubjectDraft; prefix: string; disabled: boolean; onChange: (draft: SubjectDraft) => void }) {
  return <><label>名稱<input aria-label={`${prefix}名稱`} value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} disabled={disabled} required /></label><label>簡稱<input aria-label={`${prefix}簡稱`} value={draft.shortName} onChange={(event) => onChange({ ...draft, shortName: event.target.value })} disabled={disabled} required /></label><label>顏色<input aria-label={`${prefix}顏色`} type="color" value={draft.color} onChange={(event) => onChange({ ...draft, color: event.target.value })} disabled={disabled} /></label><fieldset><legend>適用學制</legend>{SCHOOL_LEVELS.map((level) => <label key={level}><input type="checkbox" checked={draft.applicableSchoolLevels.includes(level)} disabled={disabled} onChange={(event) => onChange({ ...draft, applicableSchoolLevels: event.target.checked ? [...draft.applicableSchoolLevels, level] : draft.applicableSchoolLevels.filter((item) => item !== level) })} />{levelLabel[level]}</label>)}</fieldset></>
}

function SubjectEditor({ subject, editable, data, session, schoolLevel, canConfirmRemoval, onRemoveLevel }: { subject: Subject; editable: boolean; data: AppDataV4; session: ResourceManagementSession; schoolLevel: SchoolLevel; canConfirmRemoval: boolean; onRemoveLevel: (subject: Subject, level: SchoolLevel) => void }) {
  const key = `subject:${subject.id}`
  const initial = subjectDraft(subject)
  const draft = session.draft(key, initial)
  const entry = session.drafts[key]
  const latest = findProjectSubject(data, session.view.projectId, subject.id)
  const stale = !latest || Boolean(entry?.source && JSON.stringify(entry.source) !== JSON.stringify(latest))
  const context = { projectId: session.view.projectId! }
  const impact = latest ? getProjectSubjectImpact(data, context.projectId, subject.id) : null
  const edit = (value: SubjectDraft) => session.edit(key, { ...context, kind: 'subject', source: subject, initial, value })
  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!editable || !entry || !impact) return
    if (!window.confirm(`儲存${data.schemaVersion === 8 ? '目前專案科目' : '全域科目'}「${subject.name}」的變更？這會同步影響 ${impact.projectIds.length} 個專案及 ${impact.references.length} 筆使用中的課程或異動。${!subject.applicableSchoolLevels ? '這筆舊資料尚未標示適用學制，儲存後會明確設為目前勾選的學制。' : ''}`)) return
    session.submit({ ...context, type: 'update-subject', targetId: subject.id, source: subject, draftKeys: [key], success: '已儲存：已更新科目。' }, (current) => updateProjectSubject(current, context.projectId, subject.id, draft, true))
  }
  return <form className="resource-editor subject-management-row" onSubmit={save} aria-label={`管理科目 ${subject.name}`}><SubjectFields draft={draft} prefix={subject.name} disabled={!editable} onChange={edit} />{stale && <p className="resource-editor-message" role="status">這筆科目已在其他地方變更或刪除。草稿仍保留，但不能直接覆寫，請先核對最新資料。</p>}<div className="subject-management-actions">{(subject.applicableSchoolLevels ?? SCHOOL_LEVELS).includes(schoolLevel) && <button type="button" disabled={!editable || !canConfirmRemoval || stale} title={!canConfirmRemoval ? '無法確認儲存狀態，請重新開啟管理視窗。' : undefined} onClick={() => onRemoveLevel(subject, schoolLevel)}>解除{levelLabel[schoolLevel]}適用</button>}<button type="submit" className="primary-button" disabled={!editable || stale || !entry}>儲存科目</button><button type="button" className="danger-outline" disabled={!editable || stale} onClick={() => { if (window.confirm(`確定刪除${data.schemaVersion === 8 ? '目前專案科目' : '全域科目'}「${subject.name}」？如果仍有課程使用這個科目，系統會阻止刪除。`)) session.submit({ ...context, type: 'delete-subject', targetId: subject.id, source: subject, draftKeys: [key], success: '已儲存：已刪除科目。' }, (current) => deleteProjectSubject(current, context.projectId, subject.id, true)) }}>刪除科目</button>{entry && <button type="button" onClick={() => session.requestTransition(() => {}, [key])}>捨棄草稿</button>}</div></form>
}

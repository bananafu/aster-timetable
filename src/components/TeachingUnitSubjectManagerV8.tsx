import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { DEFAULT_SUBJECT_CATALOG, OPTIONAL_SUBJECT_CATALOG } from '../data/defaultSubjects'
import {
  addSubjectDraftToTeachingUnit,
  configureExistingSubjectForTeachingUnit,
  getTeachingUnitSubjectView,
  removeConfiguredSubjectFromTeachingUnit,
  teachingUnitSubjectErrorMessage,
  updateConfiguredSubjectForTeachingUnit,
} from '../data/teachingUnitSubjectManagementAdapter'
import { deleteSubject, getSubjectImpact, updateSubject, type SubjectV8Draft } from '../data/subjectsV8'
import { useTeachingUnitSubjectManagementSession } from '../hooks/useTeachingUnitSubjectManagementSession'
import type { StoragePersistence, StorageStatus } from '../hooks/useLocalStorage'
import type { AppDataV8, SchoolLevel, TeachingUnit } from '../types'

const catalog = [...DEFAULT_SUBJECT_CATALOG, ...OPTIONAL_SUBJECT_CATALOG]
const levelLabel: Record<SchoolLevel, string> = {
  'junior-high': '國中部',
  'senior-high': '高中部',
  other: '其他',
}
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const emptyDraft = (unit?: TeachingUnit): SubjectV8Draft => ({
  name: '',
  shortName: '',
  color: '#A66D52',
  applicableSchoolLevels: unit ? [unit.schoolLevel] : [],
})
const sameDocument = (left: AppDataV8, right: AppDataV8) => left === right
  || JSON.stringify(left) === JSON.stringify(right)

interface Props {
  data: AppDataV8
  setData: Dispatch<SetStateAction<AppDataV8>>
  storageStatus: StorageStatus
  storagePersistence: StoragePersistence
  readOnly?: boolean
  writable?: boolean
  createId?: () => string
  onComplete?: () => void
}

/**
 * Standalone V8 foundation. Production App remains on the V7 manager until a
 * V8 runtime host can supply V8 data, a single V8 setter, and persistence receipts.
 */
export function TeachingUnitSubjectManagerV8({
  data,
  setData,
  storageStatus,
  storagePersistence,
  readOnly = false,
  writable = true,
  createId = uid,
  onComplete,
}: Props) {
  const projectId = data.activeProjectId
  const schools = data.schools.filter((school) => school.projectId === projectId)
  const units = data.teachingUnits.filter((unit) => unit.projectId === projectId)
  const [schoolId, setSchoolId] = useState(() => schools[0]?.id ?? '')
  const [unitId, setUnitId] = useState(() => units.find((unit) => unit.schoolId === schoolId)?.id ?? '')
  const [scopeProjectId, setScopeProjectId] = useState(projectId)
  const [staleScope, setStaleScope] = useState(false)
  const [query, setQuery] = useState('')
  const unit = units.find((item) => item.id === unitId && item.schoolId === schoolId)
  const [draft, setDraft] = useState<SubjectV8Draft>(() => emptyDraft(unit))
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null)
  const session = useTeachingUnitSubjectManagementSession({
    data,
    setData,
    storageStatus,
    storagePersistence,
  })
  const project = data.projects.find((item) => item.id === projectId)
  const scopeChanged = staleScope || scopeProjectId !== projectId
  const editable = !readOnly && writable && Boolean(project && !project.archivedAt)
    && storageStatus === 'saved' && !session.locked && !scopeChanged
  const hasDraft = Boolean(editingSubjectId || draft.name.trim() || draft.shortName.trim())
  const view = useMemo(() => projectId && unit
    ? getTeachingUnitSubjectView(data, projectId, unit.id, query, catalog)
    : { configured: [], available: [] }, [data, projectId, query, unit])

  useEffect(() => {
    if (scopeProjectId === projectId) return
    if (hasDraft || session.locked) { setStaleScope(true); return }
    const nextSchoolId = schools[0]?.id ?? ''
    const nextUnit = units.find((item) => item.schoolId === nextSchoolId)
    setSchoolId(nextSchoolId)
    setUnitId(nextUnit?.id ?? '')
    setDraft(emptyDraft(nextUnit))
    setEditingSubjectId(null)
    setQuery('')
    setScopeProjectId(projectId)
  }, [hasDraft, projectId, schools, scopeProjectId, session.locked, units])

  const discardStaleScope = () => {
    if (session.locked) { session.fail('科目操作尚未確認儲存，暫時不能捨棄草稿。'); return }
    if (hasDraft && !window.confirm('專案已切換，確定捨棄前一專案的科目草稿？')) return
    const nextSchoolId = schools[0]?.id ?? ''
    const nextUnit = units.find((item) => item.schoolId === nextSchoolId)
    setSchoolId(nextSchoolId)
    setUnitId(nextUnit?.id ?? '')
    setDraft(emptyDraft(nextUnit))
    setEditingSubjectId(null)
    setQuery('')
    setScopeProjectId(projectId)
    setStaleScope(false)
    session.clearMessage()
  }

  useEffect(() => {
    if (session.locked || hasDraft) return
    const validSchool = schools.some((school) => school.id === schoolId)
    const nextSchoolId = validSchool ? schoolId : schools[0]?.id ?? ''
    const validUnit = units.some((item) => item.id === unitId && item.schoolId === nextSchoolId)
    const nextUnit = validUnit ? units.find((item) => item.id === unitId) : units.find((item) => item.schoolId === nextSchoolId)
    if (nextSchoolId !== schoolId) setSchoolId(nextSchoolId)
    if ((nextUnit?.id ?? '') !== unitId) {
      setUnitId(nextUnit?.id ?? '')
      setDraft(emptyDraft(nextUnit))
    }
  }, [hasDraft, schoolId, schools, session.locked, unitId, units])

  const requestScope = (nextSchoolId: string, nextUnitId: string) => {
    if (scopeChanged) { session.fail('專案已切換；請先確認是否捨棄前一專案的草稿。'); return }
    if (session.locked) {
      session.fail('科目操作尚未確認儲存，暫時不能切換學校或學制。')
      return
    }
    if (hasDraft && !window.confirm('尚有未儲存的科目輸入，確定捨棄並切換學校或學制？')) return
    const nextUnit = units.find((item) => item.id === nextUnitId && item.schoolId === nextSchoolId)
    setSchoolId(nextSchoolId)
    setUnitId(nextUnit?.id ?? '')
    setDraft(emptyDraft(nextUnit))
    setEditingSubjectId(null)
    setQuery('')
    session.clearMessage()
  }

  const withFreshData = (source: AppDataV8, update: (current: AppDataV8) => AppDataV8) =>
    (current: AppDataV8) => {
      if (!sameDocument(current, source)) throw new Error('科目資料已變更，輸入內容已保留，請重新確認。')
      return update(current)
    }

  const configure = (subjectId: string, name: string) => {
    if (!editable || !projectId || !unit) return
    const relationId = createId()
    const source = data
    session.submit(withFreshData(source, (current) => configureExistingSubjectForTeachingUnit(
      current, projectId, unit.id, subjectId, relationId,
    ).data), `已儲存：已在目前學校與學制啟用「${name}」。`, undefined, teachingUnitSubjectErrorMessage)
  }

  const addSubject = (event: FormEvent) => {
    event.preventDefault()
    if (!editable || !projectId || (!unit && !editingSubjectId)) return
    if (editingSubjectId) {
      const editing = data.subjects.find((subject) => subject.id === editingSubjectId)
      if (!editing) {
        session.fail('原科目已變更或刪除，輸入內容已保留。')
        return
      }
      const source = data
      session.submit(withFreshData(source, (current) => unit && current.teachingUnitSubjects.some((relation) =>
        relation.projectId === projectId && relation.teachingUnitId === unit.id && relation.subjectId === editing.id)
        ? updateConfiguredSubjectForTeachingUnit(current, projectId, unit.id, editing.id, draft)
        : updateSubject(current, projectId, editing.id, draft)), `已儲存：已更新科目「${draft.name.trim()}」。`, () => {
        setEditingSubjectId(null)
        setDraft(emptyDraft(unit))
      }, teachingUnitSubjectErrorMessage)
      return
    }
    if (!unit) return
    const ids = { subjectId: createId(), relationId: createId() }
    let confirmExtension = false
    let preview: ReturnType<typeof addSubjectDraftToTeachingUnit>
    try {
      preview = addSubjectDraftToTeachingUnit(data, projectId, unit.id, draft, ids, false, catalog)
      if (preview.status === 'requires-applicability-confirmation') {
        if (!window.confirm(`「${preview.subject.name}」已存在，但尚未適用${levelLabel[preview.schoolLevel]}。\n確定擴充適用學制並在目前學校啟用？\n其他學校的啟用狀態不會改變。`)) return
        confirmExtension = true
      }
    } catch (cause) {
      session.fail(teachingUnitSubjectErrorMessage(cause))
      return
    }

    const source = data
    const kind = preview.status === 'updated' ? preview.kind : 'extended-applicability'
    session.submit(withFreshData(source, (current) => {
      const result = addSubjectDraftToTeachingUnit(
        current, projectId, unit.id, draft, ids, confirmExtension, catalog,
      )
      if (result.status !== 'updated') throw new Error('科目適用學制仍待確認，輸入內容已保留。')
      return result.data
    }), kind === 'created'
      ? `已儲存：已新增並啟用「${draft.name.trim()}」。`
      : `已儲存：已在目前學校與學制啟用「${preview.status === 'updated' ? data.subjects.find((item) => item.id === preview.subjectId)?.name ?? draft.name.trim() : preview.subject.name}」。`,
    () => setDraft(emptyDraft(unit)), teachingUnitSubjectErrorMessage)
  }

  const remove = (subjectId: string, name: string) => {
    if (!editable || !projectId || !unit) return
    const source = data
    session.submit(withFreshData(source, (current) => removeConfiguredSubjectFromTeachingUnit(
      current, projectId, unit.id, subjectId,
    )), `已儲存：已從目前學校與學制移除「${name}」。`, editingSubjectId === subjectId ? () => {
      setEditingSubjectId(null)
      setDraft(emptyDraft(unit))
    } : undefined, teachingUnitSubjectErrorMessage)
  }

  const removeSubject = (subjectId: string, name: string) => {
    if (!editable || !projectId) return
    try {
      const impact = getSubjectImpact(data, projectId, subjectId)
      if (impact.configurations.length || impact.references.length) {
        session.fail(`「${name}」仍有 ${impact.configurations.length} 筆任教配置與 ${impact.references.length} 筆課程／進度引用；請先處理引用。`)
        return
      }
      if (!window.confirm(`永久刪除目前專案的科目「${name}」？`)) return
      const source = data
      session.submit(withFreshData(source, (current) => deleteSubject(current, projectId, subjectId, true)),
        `已儲存：已刪除科目「${name}」。`, undefined, teachingUnitSubjectErrorMessage)
    } catch (cause) { session.fail(teachingUnitSubjectErrorMessage(cause)) }
  }

  const edit = (subjectId: string) => {
    if (session.locked || scopeChanged) return
    const subject = data.subjects.find((item) => item.id === subjectId && item.projectId === projectId)
    if (!subject) return
    if (hasDraft && editingSubjectId !== subjectId
      && !window.confirm('尚有未儲存的科目輸入，確定捨棄並編輯另一個科目？')) return
    setEditingSubjectId(subject.id)
    setDraft({
      name: subject.name,
      shortName: subject.shortName,
      color: subject.color,
      applicableSchoolLevels: [...subject.applicableSchoolLevels],
    })
    session.clearMessage()
  }

  const complete = () => {
    if (session.locked) {
      session.fail('科目操作尚未確認儲存，完成後才能離開。')
      return
    }
    if (hasDraft && !window.confirm('尚有未儲存的科目輸入，確定捨棄並完成管理？')) return
    setDraft(emptyDraft(unit))
    setEditingSubjectId(null)
    onComplete?.()
  }

  return <section className="teaching-unit-subject-manager" aria-label="依學校與學制管理科目">
    {scopeChanged && <p role="alert" className="form-error">專案已切換；前一專案的科目草稿已保留，但不能寫入目前專案。
      <button type="button" onClick={discardStaleScope}>捨棄舊草稿並使用目前專案</button>
    </p>}
    <div className="subject-configuration-list" aria-label="目前專案科目庫">
      <h3>目前專案科目庫</h3>
      {data.subjects.filter((subject) => subject.projectId === projectId).length === 0 && <p className="resource-list-empty">目前專案尚無科目。</p>}
      {data.subjects.filter((subject) => subject.projectId === projectId).map((subject) => <div className="subject-configuration-item" key={subject.id}>
        <span><strong>{subject.name}</strong><small>{subject.shortName}</small></span>
        <button type="button" disabled={!editable} onClick={() => edit(subject.id)}>編輯</button>
        <button type="button" disabled={!editable} onClick={() => removeSubject(subject.id, subject.name)}>刪除</button>
      </div>)}
    </div>
    <div className="resource-list-tools teaching-unit-subject-scope">
      <label>學校
        <select value={schoolId} disabled={session.locked || scopeChanged} onChange={(event) => {
          const nextSchoolId = event.target.value
          const nextUnit = units.find((item) => item.schoolId === nextSchoolId)
          requestScope(nextSchoolId, nextUnit?.id ?? '')
        }}>
          {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
        </select>
      </label>
      <label>學制
        <select value={unitId} disabled={session.locked || scopeChanged || !schoolId} onChange={(event) => requestScope(schoolId, event.target.value)}>
          {units.filter((item) => item.schoolId === schoolId).map((item) => <option key={item.id} value={item.id}>
            {levelLabel[item.schoolLevel]}{units.filter((peer) => peer.schoolId === schoolId && peer.schoolLevel === item.schoolLevel).length > 1 ? `・${item.name}` : ''}
          </option>)}
        </select>
      </label>
    </div>

    {!unit && <p className="resource-list-empty">請先建立並選擇學校與學制。</p>}
    {unit && <>
      <div className="resource-browser-heading">
        <div>
          <h3>目前使用的科目</h3>
          <p>只顯示這所學校與學制已啟用的科目。</p>
        </div>
      </div>
      <div className="subject-configuration-list" aria-label="已啟用科目">
        {view.configured.length === 0 && <p className="resource-list-empty">目前尚未啟用科目。</p>}
        {view.configured.map((subject) => <div className="subject-configuration-item" key={subject.id}>
          <i aria-hidden="true" style={{ background: subject.color }} />
          <span><strong>{subject.name}</strong><small>{subject.shortName}</small></span>
          <div className="subject-configuration-actions">
            <button type="button" disabled={!editable} onClick={() => edit(subject.id)} aria-label={`編輯科目「${subject.name}」`}>編輯</button>
            <button type="button" disabled={!editable} onClick={() => remove(subject.id, subject.name)} aria-label={`移除科目「${subject.name}」`}>移除</button>
          </div>
        </div>)}
      </div>

      <div className="subject-catalog-picker">
        <div><h3>啟用既有科目</h3><p>搜尋目前專案中適用此學制、但尚未在這所學校啟用的科目。</p></div>
        <label className="teaching-unit-subject-search">搜尋科目
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="輸入科目名稱或簡稱" />
        </label>
        <div className="subject-catalog-cards" aria-label="可啟用科目">
          {view.available.map((subject) => <div className="subject-catalog-card" key={subject.id}>
            <i aria-hidden="true" style={{ background: subject.color }} />
            <span><strong>{subject.name}</strong><small>{subject.shortName}</small></span>
            <button type="button" disabled={!editable} onClick={() => configure(subject.id, subject.name)} aria-label={`啟用科目「${subject.name}」`}>＋</button>
          </div>)}
        </div>
        {view.available.length === 0 && <p className="resource-list-empty">沒有其他可啟用的既有科目。</p>}
      </div>
    </>}
    {(unit || scopeChanged) &&
      <form className="subject-management-row teaching-unit-subject-create" aria-label={editingSubjectId ? '編輯科目表單' : '新增科目表單'} onSubmit={addSubject}>
        <label>科目名稱<input aria-label={editingSubjectId ? '編輯科目名稱' : '新科目名稱'} value={draft.name} disabled={!editable} onChange={(event) => {
          setDraft((current) => ({ ...current, name: event.target.value })); session.clearMessage()
        }} /></label>
        <label>簡稱<input aria-label={editingSubjectId ? '編輯科目簡稱' : '新科目簡稱'} value={draft.shortName} disabled={!editable} onChange={(event) => {
          setDraft((current) => ({ ...current, shortName: event.target.value })); session.clearMessage()
        }} /></label>
        <label>顏色<input aria-label={editingSubjectId ? '編輯科目顏色' : '新科目顏色'} type="color" value={draft.color} disabled={!editable} onChange={(event) => {
          setDraft((current) => ({ ...current, color: event.target.value })); session.clearMessage()
        }} /></label>
        {editingSubjectId && <p className="teaching-unit-subject-edit-note">名稱、簡稱與顏色會同步更新所有使用這個科目的學校與學制。</p>}
        <div className="subject-management-actions">
          {editingSubjectId && <button type="button" disabled={!editable} onClick={() => {
            setEditingSubjectId(null); setDraft(emptyDraft(unit)); session.clearMessage()
          }}>取消編輯</button>}
          <button type="submit" className="primary-button" disabled={!editable}>{editingSubjectId ? '儲存科目' : '新增科目'}</button>
        </div>
      </form>
    }

    {session.locked && <p className="teaching-unit-subject-status" role="status">正在確認科目資料是否已儲存…</p>}
    {session.error && <p className="form-error" role="alert">{session.error}</p>}
    {session.success && <p className="form-success" role="status">{session.success}</p>}
    <div className="resource-manager-complete">
      <p>「新增科目」會儲存目前這一筆；「建立」會完成科目管理。</p>
      <button type="button" className="primary-button" disabled={session.locked} onClick={complete}>建立</button>
    </div>
  </section>
}

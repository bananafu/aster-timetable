import { useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import {
  removeSchool,
  removeTeachingUnit,
  updateSchool,
  updateTeachingUnit,
} from '../data/academicSettingsV4'
import { type AppDataV4, type School, type SchoolLevel, type TeachingUnit } from '../types'
import type { StoragePersistence, StorageStatus } from '../hooks/useLocalStorage'
import { SubjectCatalogInstaller } from './SubjectCatalogInstaller'
import { previewSubjectCatalogInstall, type CatalogSchoolLevel } from '../data/subjectCatalogInstall'
import { addTeachingUnitToSchool, createSchoolWithTeachingUnit, type NewTeachingUnitInput } from '../data/schoolUnitCreation'
import { CourseResourceManager } from './CourseResourceManager'
import { AcademicPeriodEditor, AcademicSchoolEditor } from './AcademicSettingsEditors'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
const levelLabel: Record<SchoolLevel, string> = { 'junior-high': '國中部', 'senior-high': '高中部', other: '其他' }
const unitLabel = (unit: TeachingUnit, units: TeachingUnit[]) => {
  const peers = units.filter((item) => item.schoolId === unit.schoolId && item.schoolLevel === unit.schoolLevel)
  if (peers.length === 1) return unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]
  const index = peers.findIndex((item) => item.id === unit.id) + 1
  const base = unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]
  return `${base}（重複設定 ${index}：${unit.name}）`
}
export type AcademicSettingsPage = 'schools' | 'periods' | 'classes' | 'subjects'
type CreationSubmission = { kind: 'school' | 'unit'; schoolId: string; unitId: string; level: SchoolLevel; label: string; revision: number }

export function AcademicSettingsV4({ data, setData, page = 'schools', storageStatus = 'saved', storagePersistence = { pending: false, revision: 0 }, readOnly = false }: { data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; page?: AcademicSettingsPage; storageStatus?: StorageStatus; storagePersistence?: StoragePersistence; readOnly?: boolean }) {
  const projectId = data.activeProjectId!
  const schools = data.schools.filter((item) => item.projectId === projectId)
  const units = data.teachingUnits.filter((item) => item.projectId === projectId)
  const [schoolDraft, setSchoolDraft] = useState({ name: '', color: '#718B6C', schoolLevel: 'senior-high' as SchoolLevel, unitName: '', startDate: '', endDate: '' })
  const [unitDraft, setUnitDraft] = useState({ schoolId: schools[0]?.id ?? '', name: '', schoolLevel: 'senior-high' as SchoolLevel, startDate: '', endDate: '' })
  const [showSchoolForm, setShowSchoolForm] = useState(true)
  const [showUnitForm, setShowUnitForm] = useState(false)
  const [creationSubmission, setCreationSubmission] = useState<CreationSubmission | null>(null)
  const [creationResult, setCreationResult] = useState('')
  const creatingRef = useRef(false)
  const [error, setError] = useState('')
  const [subjectOnboarding, setSubjectOnboarding] = useState<{ unitId: string; level: CatalogSchoolLevel; viewing: boolean } | null>(null)
  useEffect(() => { if (page !== 'schools') setSubjectOnboarding(null) }, [page])
  const [selectedSchoolId, setSelectedSchoolId] = useState(schools[0]?.id ?? '')
  const selectedSchoolUnits = useMemo(() => units.filter((item) => item.schoolId === selectedSchoolId), [selectedSchoolId, units])
  const selectedSchoolHasDuplicates = selectedSchoolUnits.some((unit) => selectedSchoolUnits.some((item) => item.id !== unit.id && item.schoolLevel === unit.schoolLevel))
  const [selectedUnitId, setSelectedUnitId] = useState(selectedSchoolHasDuplicates ? '' : selectedSchoolUnits[0]?.id ?? '')
  const selectedUnit = selectedSchoolUnits.find((item) => item.id === selectedUnitId)
  const activeProject = data.projects.find((item) => item.id === projectId)
  const editable = !readOnly && Boolean(activeProject && !activeProject.archivedAt)
  const creationReady = editable && storageStatus === 'saved' && !storagePersistence.pending && !creationSubmission
  useEffect(() => {
    if (!creationSubmission) return
    const fail = (message: string) => {
      creatingRef.current = false
      setCreationSubmission(null)
      setError(message)
    }
    if (storageStatus === 'conflict') { fail('其他分頁已更新資料；本次建立未確認儲存。請先處理跨分頁衝突後重試。'); return }
    if (storageStatus === 'write-error' || storageStatus === 'read-error') { fail('學校與學制寫入失敗；輸入內容已保留，請先處理儲存問題。'); return }
    if (storageStatus !== 'saved' || storagePersistence.pending || storagePersistence.revision <= creationSubmission.revision) return
    const school = data.schools.find((item) => item.id === creationSubmission.schoolId && item.projectId === projectId)
    const unit = data.teachingUnits.find((item) => item.id === creationSubmission.unitId && item.schoolId === school?.id && item.projectId === projectId)
    if (!school || !unit) { fail('儲存期間資料已變更，請重新檢查學校與學制。'); return }
    creatingRef.current = false
    setCreationSubmission(null)
    setError('')
    setCreationResult(`已建立「${creationSubmission.label}」，可在上方卡片查看並編輯。`)
    if (creationSubmission.kind === 'school') {
      setShowSchoolForm(false)
      setSchoolDraft({ name: '', color: '#718B6C', schoolLevel: 'senior-high', unitName: '', startDate: '', endDate: '' })
      setUnitDraft((current) => ({ ...current, schoolId: school.id }))
    } else {
      setShowUnitForm(false)
      setUnitDraft((current) => ({ ...current, name: '', startDate: '', endDate: '' }))
    }
    const level = creationSubmission.level
    const counts = level === 'other' ? null : previewSubjectCatalogInstall(data, [level]).counts
    setSubjectOnboarding(counts && counts['safe-to-add'] + counts['needs-review'] > 0 && level !== 'other' ? { unitId: unit.id, level, viewing: false } : null)
  }, [creationSubmission, data, projectId, storagePersistence.pending, storagePersistence.revision, storageStatus])
  useEffect(() => {
    if (!schools.some((item) => item.id === unitDraft.schoolId)) setUnitDraft((current) => ({ ...current, schoolId: schools[0]?.id ?? '' }))
  }, [schools, unitDraft.schoolId])
  useEffect(() => {
    if (!schools.some((item) => item.id === selectedSchoolId)) setSelectedSchoolId(schools[0]?.id ?? '')
  }, [schools, selectedSchoolId])
  useEffect(() => {
    if (selectedSchoolUnits.some((item) => item.id === selectedUnitId)) return
    setSelectedUnitId(selectedSchoolHasDuplicates ? '' : selectedSchoolUnits[0]?.id ?? '')
  }, [selectedSchoolHasDuplicates, selectedSchoolUnits, selectedUnitId])

  const createFromForm = (kind: 'school' | 'unit', event: FormEvent) => {
    event.preventDefault()
    if (creatingRef.current) return
    if (!creationReady) { setError(!editable ? '封存或唯讀專案不可建立學校與學制。' : '資料尚未完成儲存，請稍後再試。'); return }
    const schoolId = kind === 'school' ? uid() : unitDraft.schoolId
    const unitId = uid()
    const draft = kind === 'school' ? schoolDraft : unitDraft
    const unit: NewTeachingUnitInput = { schoolLevel: draft.schoolLevel, name: kind === 'school' ? schoolDraft.unitName : unitDraft.name, startDate: draft.startDate, endDate: draft.endDate }
    const label = kind === 'school' ? `${schoolDraft.name.trim()}・${draft.schoolLevel === 'other' ? unit.name?.trim() : levelLabel[draft.schoolLevel]}`
      : `${schools.find((item) => item.id === schoolId)?.name ?? '學校'}・${draft.schoolLevel === 'other' ? unit.name?.trim() : levelLabel[draft.schoolLevel]}`
    const context = { projectId, readOnly }
    const operation = (current: AppDataV4) => kind === 'school'
      ? createSchoolWithTeachingUnit(current, context, { name: schoolDraft.name, color: schoolDraft.color }, unit, { schoolId, teachingUnitId: unitId })
      : addTeachingUnitToSchool(current, context, schoolId, unit, unitId)
    try {
      operation(data)
      creatingRef.current = true
      setError('')
      setCreationResult('')
      setCreationSubmission({ kind, schoolId, unitId, level: unit.schoolLevel, label, revision: storagePersistence.revision })
      setData((current) => {
        try { return operation(current) }
        catch (reason) {
          queueMicrotask(() => {
            creatingRef.current = false
            setCreationSubmission((pending) => pending?.unitId === unitId ? null : pending)
            setError(reason instanceof Error ? reason.message : '資料已變更，請檢查後重試。')
          })
          return current
        }
      })
    } catch (reason) {
      creatingRef.current = false
      setCreationSubmission(null)
      setError(reason instanceof Error ? reason.message : '學校與學制無法建立。')
    }
  }

  const unitCreationFor = (school: School) => {
    const expanded = showUnitForm && unitDraft.schoolId === school.id
    return <div className="school-unit-create">
      <button type="button" className="school-add-unit" onClick={() => {
        if (expanded) { setShowUnitForm(false); return }
        setUnitDraft((current) => ({ ...current, schoolId: school.id }))
        setShowUnitForm(true)
      }} disabled={!editable || Boolean(creationSubmission)} aria-expanded={expanded} aria-controls={`unit-create-${school.id}`}>＋ 新增學制</button>
      {expanded && <form id={`unit-create-${school.id}`} className="form-grid settings-subform" onSubmit={(event) => createFromForm('unit', event)}>
        <label>學制<select aria-label="新增學制" value={unitDraft.schoolLevel} onChange={(event) => setUnitDraft({ ...unitDraft, schoolLevel: event.target.value as SchoolLevel })} disabled={!editable || Boolean(creationSubmission)}>{Object.entries(levelLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {unitDraft.schoolLevel === 'other' && <label className="full">自訂學制名稱<input value={unitDraft.name} onChange={(event) => setUnitDraft({ ...unitDraft, name: event.target.value })} placeholder="例如：實驗課程" disabled={!editable || Boolean(creationSubmission)} required /></label>}
        <label>起始日<input aria-label="新學制起始日" type="date" value={unitDraft.startDate} onChange={(event) => setUnitDraft({ ...unitDraft, startDate: event.target.value })} disabled={!editable || Boolean(creationSubmission)} required /></label>
        <label>結束日<input aria-label="新學制結束日" type="date" value={unitDraft.endDate} onChange={(event) => setUnitDraft({ ...unitDraft, endDate: event.target.value })} disabled={!editable || Boolean(creationSubmission)} required /></label>
        <p className="settings-create-preview full">{school.name}・{unitDraft.schoolLevel === 'other' ? unitDraft.name.trim() || '其他學制' : levelLabel[unitDraft.schoolLevel]}。節次預設{unitDraft.schoolLevel === 'junior-high' ? '每節 45 分鐘' : unitDraft.schoolLevel === 'senior-high' ? '每節 50 分鐘' : '沿用既有其他學制設定'}。</p>
        <div className="form-actions full"><button type="submit" className="primary-button" disabled={!creationReady}>{creationSubmission?.kind === 'unit' ? '儲存中…' : '新增學制設定'}</button></div>
      </form>}
    </div>
  }

  const selectors = <div className="academic-context-selectors"><label>學校<select aria-label="學校" value={selectedSchoolId} onChange={(event) => setSelectedSchoolId(event.target.value)}>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label><label>學制<select aria-label="目前學制" value={selectedUnitId} onChange={(event) => setSelectedUnitId(event.target.value)}>{selectedSchoolHasDuplicates && <option value="">請選擇要管理的學制設定</option>}{selectedSchoolUnits.map((unit) => <option key={unit.id} value={unit.id}>{unitLabel(unit, units)}</option>)}</select></label></div>

  return <section className="academic-settings">
    {page === 'periods' && selectors}
    {page === 'schools' && <>
    <header><strong>學校與學制</strong><p>學校識別色由同校各學制共用；學期日期與輪週規則由學制獨立管理。</p></header>
    <div className="school-card-list">{schools.map((school) => <AcademicSchoolEditor key={school.id}
      school={school} units={units.filter((unit) => unit.schoolId === school.id)} readOnly={!editable}
      unitCreation={unitCreationFor(school)} onError={setError}
      onUpdate={(draft) => setData(updateSchool(data, school.id, draft))}
      onDelete={() => setData(removeSchool(data, school.id))}
      onUpdateUnit={(unit, draft) => setData(updateTeachingUnit(data, unit.id, draft))}
      onDeleteUnit={(unit) => setData(removeTeachingUnit(data, unit.id))} />)}</div>
    {creationResult && <p className="settings-create-result" role="status">{creationResult}</p>}
    <section className="settings-create-section"><div className="settings-create-heading"><div><strong>新增學校與第一個學制</strong><p>單次建立學校與學制設定；不會建立新的專案或教師課表。</p></div><button type="button" onClick={() => setShowSchoolForm((current) => !current)} disabled={!editable || Boolean(creationSubmission)} aria-expanded={showSchoolForm}>{showSchoolForm ? '收合' : '新增學校與學制'}</button></div>
    {showSchoolForm && <form className="form-grid settings-subform" onSubmit={(event) => createFromForm('school', event)}>
      <label className="full">學校名稱<input aria-label="新學校名稱" value={schoolDraft.name} onChange={(event) => setSchoolDraft({ ...schoolDraft, name: event.target.value })} disabled={!editable || Boolean(creationSubmission)} required /></label>
      <label>學校識別色<input aria-label="新學校識別色" type="color" value={schoolDraft.color} onChange={(event) => setSchoolDraft({ ...schoolDraft, color: event.target.value })} disabled={!editable || Boolean(creationSubmission)} /></label>
      <label>第一個學制<select aria-label="新學校第一個學制" value={schoolDraft.schoolLevel} onChange={(event) => setSchoolDraft({ ...schoolDraft, schoolLevel: event.target.value as SchoolLevel })} disabled={!editable || Boolean(creationSubmission)}>{Object.entries(levelLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {schoolDraft.schoolLevel === 'other' && <label className="full">自訂學制名稱<input aria-label="新學校自訂學制名稱" value={schoolDraft.unitName} onChange={(event) => setSchoolDraft({ ...schoolDraft, unitName: event.target.value })} disabled={!editable || Boolean(creationSubmission)} required /></label>}
      <label>起始日<input aria-label="新學校學制起始日" type="date" value={schoolDraft.startDate} onChange={(event) => setSchoolDraft({ ...schoolDraft, startDate: event.target.value })} disabled={!editable || Boolean(creationSubmission)} required /></label>
      <label>結束日<input aria-label="新學校學制結束日" type="date" value={schoolDraft.endDate} onChange={(event) => setSchoolDraft({ ...schoolDraft, endDate: event.target.value })} disabled={!editable || Boolean(creationSubmission)} required /></label>
      <p className="settings-create-preview full">{schoolDraft.name.trim() || '學校'}・{schoolDraft.schoolLevel === 'other' ? schoolDraft.unitName.trim() || '其他學制' : levelLabel[schoolDraft.schoolLevel]}。節次預設{schoolDraft.schoolLevel === 'junior-high' ? '每節 45 分鐘' : schoolDraft.schoolLevel === 'senior-high' ? '每節 50 分鐘' : '沿用既有其他學制設定'}；建立後可在課堂時間表調整 5 分鐘刻度的起訖時間。</p>
      <div className="form-actions full"><button type="submit" className="primary-button" disabled={!creationReady}>{creationSubmission?.kind === 'school' ? '儲存中…' : '建立學校與學制'}</button></div>
    </form>}</section>
    {subjectOnboarding && units.some((unit) => unit.id === subjectOnboarding.unitId) && !readOnly && !data.projects.find((item) => item.id === projectId)?.archivedAt && <section className="subject-onboarding" aria-label="預設科目引導">
      <div><strong>要檢視{levelLabel[subjectOnboarding.level]}的預設科目嗎？</strong><p>科目庫由所有專案共用。只會在確認後新增安全項目；既有科目與待確認衝突不會自動修改。</p></div>
      {!subjectOnboarding.viewing && <div className="subject-onboarding-actions"><button type="button" className="primary-button" onClick={() => setSubjectOnboarding({ ...subjectOnboarding, viewing: true })}>檢視並補齊</button><button type="button" onClick={() => setSubjectOnboarding(null)}>稍後再說</button></div>}
      {subjectOnboarding.viewing && <SubjectCatalogInstaller data={data} setData={setData} storageStatus={storageStatus} storagePersistence={storagePersistence} readOnly={readOnly} initialLevel={subjectOnboarding.level} />}
    </section>}
    </>}
    {page === 'periods' && <>{selectedUnit ? <AcademicPeriodEditor unit={selectedUnit}
      label={unitLabel(selectedUnit, data.teachingUnits)} onError={setError}
      onUpdate={(draft) => setData(updateTeachingUnit(data, selectedUnit.id, draft))} />
      : <p className="settings-empty">請先為所選學校建立學制，才能設定課堂時間表。</p>}</>}
    {(page === 'classes' || page === 'subjects') && <CourseResourceManager data={data} setData={setData} mode={page} storageStatus={storageStatus} storagePersistence={storagePersistence} readOnly={readOnly} />}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>
}

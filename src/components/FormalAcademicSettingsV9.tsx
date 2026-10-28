import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { FormalTeachingUnitV9Input } from '../formalAcademicSettingsV9'
import type { useFormalAcademicSettingsV9Adapter } from '../hooks/useFormalAcademicSettingsV9Adapter'
import type { School, SchoolLevel, TeachingUnit } from '../types'
import { AcademicPeriodEditor, AcademicSchoolEditor } from './AcademicSettingsEditors'

const levelLabel: Record<SchoolLevel, string> = {
  'junior-high': '國中部', 'senior-high': '高中部', other: '其他',
}
const unitLabel = (unit: TeachingUnit, units: TeachingUnit[]) => {
  const peers = units.filter((item) => item.schoolId === unit.schoolId
    && item.schoolLevel === unit.schoolLevel)
  if (peers.length === 1) return unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]
  const index = peers.findIndex((item) => item.id === unit.id) + 1
  const base = unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]
  return `${base}（重複設定 ${index}：${unit.name}）`
}

type Port = ReturnType<typeof useFormalAcademicSettingsV9Adapter>
type UnitDraft = FormalTeachingUnitV9Input & { schoolId: string }
const blankUnit = (schoolId = ''): UnitDraft => ({
  schoolId, name: '', schoolLevel: 'senior-high', startDate: '', endDate: '',
})

/** Reuses the established AcademicSettings school/level forms with a V9-only action port. */
export function FormalAcademicSettingsV9({ port, page }: { port: Port; page: 'schools' | 'periods' }) {
  const { schools, teachingUnits: units } = port
  const [schoolDraft, setSchoolDraft] = useState({ name: '', color: '#718B6C',
    schoolLevel: 'senior-high' as SchoolLevel, unitName: '', startDate: '', endDate: '' })
  const [unitDraft, setUnitDraft] = useState<UnitDraft>(() => blankUnit(schools[0]?.id))
  const [showSchoolForm, setShowSchoolForm] = useState(true)
  const [showUnitForm, setShowUnitForm] = useState(false)
  const [selectedSchoolId, setSelectedSchoolId] = useState(schools[0]?.id ?? '')
  const selectedSchoolUnits = useMemo(() => units.filter((item) => item.schoolId === selectedSchoolId),
    [selectedSchoolId, units])
  const selectedSchoolHasDuplicates = selectedSchoolUnits.some((unit) => selectedSchoolUnits.some(
    (item) => item.id !== unit.id && item.schoolLevel === unit.schoolLevel))
  const [selectedUnitId, setSelectedUnitId] = useState(() => {
    if (port.selection.teachingUnitId && units.some((item) => item.id === port.selection.teachingUnitId)) {
      return port.selection.teachingUnitId
    }
    return selectedSchoolHasDuplicates ? '' : selectedSchoolUnits[0]?.id ?? ''
  })
  const selectedUnit = selectedSchoolUnits.find((item) => item.id === selectedUnitId)
  const [localError, setLocalError] = useState('')
  const [localSuccess, setLocalSuccess] = useState('')
  const creatingRef = useRef(false)
  const readOnly = !port.writable || port.pending

  useEffect(() => {
    if (!schools.some((item) => item.id === unitDraft.schoolId)) {
      setUnitDraft((current) => ({ ...current, schoolId: schools[0]?.id ?? '' }))
    }
  }, [schools, unitDraft.schoolId])
  useEffect(() => {
    if (!schools.some((item) => item.id === selectedSchoolId)) {
      setSelectedSchoolId(schools[0]?.id ?? '')
    }
  }, [schools, selectedSchoolId])
  useEffect(() => {
    const portUnit = port.selection.teachingUnitId
    if (portUnit && units.some((item) => item.id === portUnit)) {
      const schoolId = units.find((item) => item.id === portUnit)!.schoolId
      setSelectedSchoolId(schoolId)
      setSelectedUnitId(portUnit)
      return
    }
    if (!selectedSchoolUnits.some((item) => item.id === selectedUnitId)) {
      setSelectedUnitId(selectedSchoolHasDuplicates ? '' : selectedSchoolUnits[0]?.id ?? '')
    }
  }, [port.selection.teachingUnitId, selectedSchoolHasDuplicates, selectedSchoolUnits,
    selectedUnitId, units])

  const reportError = (message: string) => {
    setLocalError(message)
    setLocalSuccess('')
  }
  const createFromForm = async (kind: 'school' | 'unit', event: FormEvent) => {
    event.preventDefault()
    if (creatingRef.current || readOnly) return
    creatingRef.current = true
    setLocalError('')
    setLocalSuccess('')
    try {
      if (kind === 'school') {
        await port.actions.createSchoolWithTeachingUnit(
          { name: schoolDraft.name, color: schoolDraft.color },
          { schoolLevel: schoolDraft.schoolLevel, name: schoolDraft.unitName,
            startDate: schoolDraft.startDate, endDate: schoolDraft.endDate })
        setSchoolDraft({ name: '', color: '#718B6C', schoolLevel: 'senior-high',
          unitName: '', startDate: '', endDate: '' })
        setShowSchoolForm(false)
        setLocalSuccess('已建立學校與學制，可在上方卡片查看並編輯。')
      } else {
        const school = schools.find((item) => item.id === unitDraft.schoolId)
        if (!school) throw new Error('所選學校不屬於目前專案。')
        await port.actions.createTeachingUnit(school.id, unitDraft)
        setUnitDraft(blankUnit(school.id))
        setShowUnitForm(false)
        setLocalSuccess(`已為「${school.name}」建立學制，可在上方卡片查看並編輯。`)
      }
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : '學校與學制無法建立。')
    } finally {
      creatingRef.current = false
    }
  }

  const unitCreationFor = (school: School) => {
    const expanded = showUnitForm && unitDraft.schoolId === school.id
    return <div className="school-unit-create">
      <button type="button" className="school-add-unit" onClick={() => {
        if (expanded) { setShowUnitForm(false); return }
        setUnitDraft(blankUnit(school.id))
        setShowUnitForm(true)
      }} disabled={readOnly} aria-expanded={expanded} aria-controls={`formal-v9-unit-create-${school.id}`}>
        ＋ 新增學制
      </button>
      {expanded && <form id={`formal-v9-unit-create-${school.id}`} className="form-grid settings-subform"
        onSubmit={(event) => void createFromForm('unit', event)}>
        <label>學制<select aria-label="新增學制" value={unitDraft.schoolLevel}
          onChange={(event) => setUnitDraft({ ...unitDraft, schoolLevel: event.target.value as SchoolLevel })}
          disabled={readOnly}>{Object.entries(levelLabel).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}</select></label>
        {unitDraft.schoolLevel === 'other' && <label className="full">自訂學制名稱<input
          value={unitDraft.name ?? ''} onChange={(event) => setUnitDraft({ ...unitDraft, name: event.target.value })}
          placeholder="例如：實驗課程" disabled={readOnly} required /></label>}
        <label>起始日<input aria-label="新學制起始日" type="date" value={unitDraft.startDate}
          onChange={(event) => setUnitDraft({ ...unitDraft, startDate: event.target.value })}
          disabled={readOnly} required /></label>
        <label>結束日<input aria-label="新學制結束日" type="date" value={unitDraft.endDate}
          onChange={(event) => setUnitDraft({ ...unitDraft, endDate: event.target.value })}
          disabled={readOnly} required /></label>
        <p className="settings-create-preview full">{school.name}・{unitDraft.schoolLevel === 'other'
          ? unitDraft.name?.trim() || '其他學制' : levelLabel[unitDraft.schoolLevel]}。節次預設
          {unitDraft.schoolLevel === 'junior-high' ? '每節 45 分鐘' : unitDraft.schoolLevel === 'senior-high'
            ? '每節 50 分鐘' : '沿用既有其他學制設定'}。</p>
        <div className="form-actions full"><button type="submit" className="primary-button"
          disabled={readOnly}>新增學制設定</button></div>
      </form>}
    </div>
  }

  const selectors = <div className="academic-context-selectors"><label>學校<select aria-label="學校"
    value={selectedSchoolId} onChange={(event) => setSelectedSchoolId(event.target.value)}>
    {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
    <label>學制<select aria-label="目前學制" value={selectedUnitId}
      onChange={(event) => setSelectedUnitId(event.target.value)}>
      {selectedSchoolHasDuplicates && <option value="">請選擇要管理的學制設定</option>}
      {selectedSchoolUnits.map((item) => <option key={item.id} value={item.id}>{unitLabel(item, units)}</option>)}
    </select></label></div>

  return <section className="academic-settings">
    {page === 'periods' && selectors}
    {page === 'schools' && <>
      <header><strong>學校與學制</strong><p>學校識別色由同校各學制共用；學期日期與輪週規則由學制獨立管理。</p></header>
      <div className="school-card-list">{schools.map((school) => <AcademicSchoolEditor key={school.id}
        school={school} units={units.filter((unit) => unit.schoolId === school.id)} readOnly={readOnly}
        unitCreation={unitCreationFor(school)} onError={reportError}
        onUpdate={(draft) => port.actions.updateSchool(school.id, draft)}
        onUpdateUnit={(unit, draft) => port.actions.updateTeachingUnit(unit.id,
          { ...draft, schoolId: unit.schoolId })} />)}</div>
      <section className="settings-create-section"><div className="settings-create-heading"><div>
        <strong>新增學校與第一個學制</strong><p>單次建立學校與學制設定；不會建立新的專案或教師課表。</p></div>
        <button type="button" onClick={() => setShowSchoolForm((current) => !current)} disabled={readOnly}
          aria-expanded={showSchoolForm}>{showSchoolForm ? '收合' : '新增學校與學制'}</button></div>
      {showSchoolForm && <form className="form-grid settings-subform"
        onSubmit={(event) => void createFromForm('school', event)}>
        <label className="full">學校名稱<input aria-label="新學校名稱" value={schoolDraft.name}
          onChange={(event) => setSchoolDraft({ ...schoolDraft, name: event.target.value })}
          disabled={readOnly} required /></label>
        <label>學校識別色<input aria-label="新學校識別色" type="color" value={schoolDraft.color}
          onChange={(event) => setSchoolDraft({ ...schoolDraft, color: event.target.value })}
          disabled={readOnly} /></label>
        <label>第一個學制<select aria-label="新學校第一個學制" value={schoolDraft.schoolLevel}
          onChange={(event) => setSchoolDraft({ ...schoolDraft, schoolLevel: event.target.value as SchoolLevel })}
          disabled={readOnly}>{Object.entries(levelLabel).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}</select></label>
        {schoolDraft.schoolLevel === 'other' && <label className="full">自訂學制名稱<input
          aria-label="新學校自訂學制名稱" value={schoolDraft.unitName}
          onChange={(event) => setSchoolDraft({ ...schoolDraft, unitName: event.target.value })}
          disabled={readOnly} required /></label>}
        <label>起始日<input aria-label="新學校學制起始日" type="date" value={schoolDraft.startDate}
          onChange={(event) => setSchoolDraft({ ...schoolDraft, startDate: event.target.value })}
          disabled={readOnly} required /></label>
        <label>結束日<input aria-label="新學校學制結束日" type="date" value={schoolDraft.endDate}
          onChange={(event) => setSchoolDraft({ ...schoolDraft, endDate: event.target.value })}
          disabled={readOnly} required /></label>
        <p className="settings-create-preview full">{schoolDraft.name.trim() || '學校'}・
          {schoolDraft.schoolLevel === 'other' ? schoolDraft.unitName.trim() || '其他學制'
            : levelLabel[schoolDraft.schoolLevel]}。節次預設
          {schoolDraft.schoolLevel === 'junior-high' ? '每節 45 分鐘' : schoolDraft.schoolLevel === 'senior-high'
            ? '每節 50 分鐘' : '沿用既有其他學制設定'}；建立後可在課堂時間表調整 5 分鐘刻度的起訖時間。</p>
        <div className="form-actions full"><button type="submit" className="primary-button"
          disabled={readOnly}>建立學校與學制</button></div>
      </form>}</section>
    </>}
    {page === 'periods' && (selectedUnit ? <AcademicPeriodEditor unit={selectedUnit}
      label={unitLabel(selectedUnit, units)} readOnly={readOnly} onError={reportError}
      onUpdate={(draft) => port.actions.updateTeachingUnit(selectedUnit.id,
        { ...draft, schoolId: selectedUnit.schoolId })} />
      : <p className="settings-empty">請先為所選學校建立學制，才能設定課堂時間表。</p>)}
    {(localError || port.error) && <p className="form-error" role="alert">{localError || port.error}</p>}
    {(localSuccess || port.success) && <p className="settings-create-result" role="status">
      {localSuccess || port.success}</p>}
  </section>
}

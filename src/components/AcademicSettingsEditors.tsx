import { useEffect, useState, type ReactNode } from 'react'
import type { TeachingUnitDraft } from '../data/academicSettingsV4'
import type { School, SchoolLevel, SchoolPeriod, TeachingUnit } from '../types'

const levelLabel: Record<SchoolLevel, string> = {
  'junior-high': '國中部', 'senior-high': '高中部', other: '其他',
}
const timeOptions = Array.from({ length: 24 * 12 }, (_, index) =>
  `${String(Math.floor(index / 12)).padStart(2, '0')}:${String((index % 12) * 5).padStart(2, '0')}`)
const isFiveMinuteTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
  && Number(value.slice(3)) % 5 === 0
const addMinutes = (value: string, amount: number) => {
  const [hour, minute] = value.split(':').map(Number)
  const result = Math.min(23 * 60 + 55, hour * 60 + minute + amount)
  return `${String(Math.floor(result / 60)).padStart(2, '0')}:${String(result % 60).padStart(2, '0')}`
}

type UpdateSchool = (draft: { name: string; color: string }) => void | Promise<unknown>
type UpdateUnit = (draft: TeachingUnitDraft) => void | Promise<unknown>
const draftFromUnit = (unit: TeachingUnit): TeachingUnitDraft => ({
  name: unit.name,
  schoolLevel: unit.schoolLevel,
  startDate: unit.startDate,
  endDate: unit.endDate,
  periods: unit.periods.map((item) => ({ ...item })),
  weekCycle: { ...unit.weekCycle },
})

export function AcademicSchoolEditor({ school, units, readOnly, unitCreation, onUpdate,
  onDelete, onUpdateUnit, onDeleteUnit, onError }: {
  school: School
  units: TeachingUnit[]
  readOnly: boolean
  unitCreation: ReactNode
  onUpdate: UpdateSchool
  onDelete?: () => void | Promise<unknown>
  onUpdateUnit: (unit: TeachingUnit, draft: TeachingUnitDraft) => void | Promise<unknown>
  onDeleteUnit?: (unit: TeachingUnit) => void | Promise<unknown>
  onError: (message: string) => void
}) {
  const [draft, setDraft] = useState({ name: school.name, color: school.color })
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft({ name: school.name, color: school.color }),
    [school.id, school.name, school.color])
  const duplicateLevels = new Set(units.filter((unit) => units.some((item) => item.id !== unit.id
    && item.schoolLevel === unit.schoolLevel)).map((unit) => unit.schoolLevel))
  const run = async (operation: () => void | Promise<unknown>) => {
    if (busy || readOnly) return
    setBusy(true)
    try { await operation(); onError('') }
    catch (cause) { onError(cause instanceof Error ? cause.message : '設定無法儲存。') }
    finally { setBusy(false) }
  }
  return <article className="school-editor" style={{ borderLeftColor: school.color }} data-testid={`school-card-${school.id}`}>
    <form className="school-editor-heading" onSubmit={(event) => { event.preventDefault(); void run(() => onUpdate(draft)) }}>
      <input aria-label={`${school.name}學校名稱`} value={draft.name}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })} required disabled={readOnly || busy} />
      <label className="school-color-field"><span>識別色</span><input aria-label={`${school.name}學校識別色`}
        type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })}
        disabled={readOnly || busy} /></label>
      <button type="submit" disabled={readOnly || busy}>儲存學校</button>
      <button type="button" className="danger-outline" disabled={readOnly || busy || !onDelete}
        onClick={() => { if (onDelete && window.confirm(`確定刪除「${school.name}」？`)) void run(onDelete) }}>刪除</button>
    </form>
    <div className="school-unit-list">{units.length > 0 ? units.map((unit) =>
      <AcademicTeachingUnitEditor key={unit.id} unit={unit} duplicate={duplicateLevels.has(unit.schoolLevel)}
        readOnly={readOnly} onUpdate={(next) => onUpdateUnit(unit, next)}
        onDelete={onDeleteUnit ? () => onDeleteUnit(unit) : undefined} onError={onError} />)
      : <p className="settings-empty">尚未建立學制設定。</p>}</div>
    {unitCreation}
  </article>
}

export function AcademicTeachingUnitEditor({ unit, duplicate, readOnly, onUpdate, onDelete, onError }: {
  unit: TeachingUnit
  duplicate: boolean
  readOnly: boolean
  onUpdate: UpdateUnit
  onDelete?: () => void | Promise<unknown>
  onError: (message: string) => void
}) {
  const unitFingerprint = JSON.stringify(draftFromUnit(unit))
  const [draft, setDraft] = useState<TeachingUnitDraft>(() => draftFromUnit(unit))
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(JSON.parse(unitFingerprint) as TeachingUnitDraft), [unitFingerprint])
  const label = unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]
  const run = async (operation: () => void | Promise<unknown>, allowDuplicate = false) => {
    if (busy || readOnly || (duplicate && !allowDuplicate)) return
    setBusy(true)
    try { await operation(); onError('') }
    catch (cause) { onError(cause instanceof Error ? cause.message : '設定無法儲存。') }
    finally { setBusy(false) }
  }
  return <form className="teaching-unit-settings" data-testid={`teaching-unit-${unit.id}`} onSubmit={(event) => {
    event.preventDefault()
    if (draft.schoolLevel === 'other' && !draft.name.trim()) {
      onError('其他學制需要可辨識的自訂名稱。'); return
    }
    void run(() => onUpdate(draft))
  }}>
    <div className="teaching-unit-heading"><div><strong>{label}</strong><small>TeachingUnit ID {unit.id}</small></div>
      {duplicate && <span className="duplicate-unit-badge">重複學制資料</span>}</div>
    {duplicate && <p className="form-warning">此校有多筆相同學制。資料已逐筆保留；既有更新函式無法安全修改重複項目，本階段不會自動合併、刪除、改 ID 或代選其中一筆。</p>}
    <div className="unit-editor-grid">
      {draft.schoolLevel === 'other' && <label>自訂學制名稱<input aria-label={`${unit.id}自訂學制名稱`}
        value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        required disabled={duplicate || readOnly || busy} /></label>}
      <label>學制<span className="readonly-field">{levelLabel[draft.schoolLevel]}</span></label>
      <label>起始日<input aria-label={`${unit.id}起始日`} type="date" value={draft.startDate}
        onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
        required disabled={duplicate || readOnly || busy} /></label>
      <label>結束日<input aria-label={`${unit.id}結束日`} type="date" value={draft.endDate}
        onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
        required disabled={duplicate || readOnly || busy} /></label>
    </div>
    <div className="week-cycle-editor"><label><input aria-label={`${unit.id}啟用 A/B 週`} type="checkbox"
      checked={draft.weekCycle.enabled} onChange={(event) => setDraft({ ...draft,
        weekCycle: { ...draft.weekCycle, enabled: event.target.checked } })}
      disabled={duplicate || readOnly || busy} />啟用 A/B 週</label>
      <label>基準日期<input aria-label={`${unit.id}基準日期`} type="date" value={draft.weekCycle.anchorDate}
        onChange={(event) => setDraft({ ...draft, weekCycle: { ...draft.weekCycle, anchorDate: event.target.value } })}
        disabled={duplicate || readOnly || busy} /></label>
      <label>基準週<select aria-label={`${unit.id}基準週`} value={draft.weekCycle.anchorPattern}
        onChange={(event) => setDraft({ ...draft, weekCycle: { ...draft.weekCycle,
          anchorPattern: event.target.value as 'A' | 'B' } })} disabled={duplicate || readOnly || busy}>
        <option value="A">A 週</option><option value="B">B 週</option></select></label></div>
    <div className="unit-actions"><button type="submit" className="primary-button"
      disabled={duplicate || readOnly || busy}>儲存學制設定</button>
      <button type="button" className="danger-outline" disabled={readOnly || busy || !onDelete}
        onClick={() => { if (onDelete && window.confirm(`確定刪除「${unit.name}」？`)) void run(onDelete, true) }}>刪除學制</button></div>
  </form>
}

function nextPeriod(periods: SchoolPeriod[], level: SchoolLevel): SchoolPeriod {
  const last = [...periods].sort((a, b) => a.order - b.order).at(-1)
  const [hour, minute] = (last?.endTime ?? '08:00').split(':').map(Number)
  const startValue = hour * 60 + minute + (last ? 10 : 0)
  const duration = level === 'junior-high' ? 45 : 50
  const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
  return { id: Math.max(0, ...periods.map((item) => item.id)) + 1, order: periods.length + 1,
    label: `第 ${periods.length + 1} 節`, startTime: format(startValue), endTime: format(startValue + duration) }
}

export function AcademicPeriodEditor({ unit, label, readOnly = false, onUpdate, onError }: {
  unit: TeachingUnit
  label: string
  readOnly?: boolean
  onUpdate: UpdateUnit
  onError: (message: string) => void
}) {
  const unitFingerprint = JSON.stringify(draftFromUnit(unit))
  const [draft, setDraft] = useState<TeachingUnitDraft>(() => draftFromUnit(unit))
  const [automaticEndPeriodIds, setAutomaticEndPeriodIds] = useState<Set<number>>(() => new Set())
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setDraft(JSON.parse(unitFingerprint) as TeachingUnitDraft); setAutomaticEndPeriodIds(new Set())
  }, [unitFingerprint])
  const updatePeriod = (id: number, field: keyof SchoolPeriod, value: string | number) =>
    setDraft((current) => ({ ...current, periods: current.periods.map((item) => item.id === id
      ? { ...item, [field]: value } : item) }))
  const updateStartTime = (period: SchoolPeriod, value: string) => setDraft((current) => ({ ...current,
    periods: current.periods.map((item) => item.id === period.id ? { ...item, startTime: value,
      endTime: automaticEndPeriodIds.has(period.id)
        ? addMinutes(value, current.schoolLevel === 'junior-high' ? 45 : 50) : item.endTime } : item) }))
  const updateEndTime = (periodId: number, value: string) => {
    setAutomaticEndPeriodIds((current) => { const next = new Set(current); next.delete(periodId); return next })
    updatePeriod(periodId, 'endTime', value)
  }
  const addPeriod = () => {
    const period = nextPeriod(draft.periods, draft.schoolLevel)
    setDraft((current) => ({ ...current, periods: [...current.periods, period] }))
    setAutomaticEndPeriodIds((current) => new Set(current).add(period.id))
  }
  const invalidRanges = draft.periods.filter((period) => period.endTime <= period.startTime)
  return <form className="unit-editor" onSubmit={async (event) => {
    event.preventDefault()
    if (readOnly || busy || invalidRanges.length) return
    setBusy(true)
    try { await onUpdate(draft); onError('') }
    catch (cause) { onError(cause instanceof Error ? cause.message : '設定無法儲存。') }
    finally { setBusy(false) }
  }}>
    <header className="period-editor-heading"><strong>課堂時間表</strong><p>{label}・TeachingUnit ID {unit.id}</p></header>
    {draft.periods.some((period) => !isFiveMinuteTime(period.startTime) || !isFiveMinuteTime(period.endTime))
      && <p className="form-warning" role="alert">既有節次含非 5 分鐘刻度的時間。資料尚未變更，請逐項修正後再儲存。</p>}
    {invalidRanges.length > 0 && <p className="form-warning" role="alert">結束時間必須晚於開始時間，請修正後再儲存。</p>}
    <div className="unit-periods">{[...draft.periods].sort((a, b) => a.order - b.order).map((period) =>
      <div className="period-editor" key={period.id}><small>ID {period.id}</small>
        <input aria-label={`${unit.name}節次名稱`} value={period.label} disabled={readOnly || busy}
          onChange={(event) => updatePeriod(period.id, 'label', event.target.value)} />
        <TimeSelect label={`${unit.name}開始時間`} value={period.startTime} disabled={readOnly || busy}
          onChange={(value) => updateStartTime(period, value)} />
        <TimeSelect label={`${unit.name}結束時間`} value={period.endTime} disabled={readOnly || busy}
          onChange={(value) => updateEndTime(period.id, value)} />
        <button type="button" disabled={readOnly || busy} onClick={() => setDraft((current) => ({ ...current,
          periods: current.periods.filter((item) => item.id !== period.id)
            .map((item, index) => ({ ...item, order: index + 1 })) }))}>移除</button></div>)}</div>
    <div className="unit-actions"><button type="button" disabled={readOnly || busy} onClick={addPeriod}>新增節次</button>
      <button type="submit" className="primary-button" disabled={readOnly || busy || invalidRanges.length > 0}>儲存課堂時間</button></div>
  </form>
}

function TimeSelect({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean;
  onChange: (value: string) => void }) {
  const invalid = !isFiveMinuteTime(value)
  return <select aria-label={label} value={value} className={invalid ? 'invalid-time' : ''} disabled={disabled}
    onChange={(event) => onChange(event.target.value)}>{invalid && <option value={value}>{value}（需修正）</option>}
    {timeOptions.map((time) => <option key={time} value={time}>{time}</option>)}</select>
}

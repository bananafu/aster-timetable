import { useMemo, useState } from 'react'
import type { AppDataV8 } from '../types'
import { fingerprintV7Raw } from '../data/activationV8'
import { activateTimetableSubjectsV9 } from '../data/activateSubjectV9'
import { buildSubjectMigrationCandidateV9, type SubjectMigrationDecisionV9 } from '../data/subjectMigrationCandidateV9'
import { inspectSubjectMigrationV9 } from '../data/subjectMigrationPlanV9'
import { APP_DATA_V8_KEY } from '../data/storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY } from '../data/storageV9'

type Props = {
  data: AppDataV8
  sourceRaw: string | null
  writable: boolean
  onExport: (raw: string) => void
  onActivated: () => void
  onStorageChanged: () => void
}

/** User decisions are never inferred for unowned Subjects or shared configurations. */
export function SubjectUpgradeV9({ data, sourceRaw, writable, onExport, onActivated, onStorageChanged }: Props) {
  const plan = useMemo(() => inspectSubjectMigrationV9(data), [data])
  const [ownerChoices, setOwnerChoices] = useState<Record<string, string>>({})
  const [relationChoices, setRelationChoices] = useState<Record<string, string[]>>({})
  const [exported, setExported] = useState<{ raw: string; digest: `sha256:${string}` } | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const projectTables = (projectId: string) => data.timetables.filter((item) => item.projectId === projectId)
  const directOwners = (subjectId: string) => [...new Set(plan.entries.find((item) => item.subjectId === subjectId)
    ?.references.filter((item) => item.kind !== 'teaching-unit-subject').map((item) => item.timetableId).filter((id): id is string => !!id) ?? [])].sort()
  const ownersFor = (subjectId: string) => {
    const direct = directOwners(subjectId)
    return direct.length ? direct : ownerChoices[subjectId] ? [ownerChoices[subjectId]] : []
  }
  const ready = plan.sourceCompatibleV8 && plan.entries.every((entry) => {
    const owners = ownersFor(entry.subjectId)
    if (!owners.length || entry.classification === 'invalid-or-ambiguous') return false
    return entry.references.filter((ref) => ref.kind === 'teaching-unit-subject').every((ref) => {
      const selected = owners.length === 1 ? owners : relationChoices[ref.id] ?? []
      return selected.length > 0 && selected.every((id) => owners.includes(id))
    })
  })
  const prepareExport = async () => {
    if (!sourceRaw) return
    try {
      const digest = await fingerprintV7Raw(sourceRaw)
      setExported({ raw: sourceRaw, digest })
      setConfirmed(false)
      onExport(sourceRaw)
    } catch { setError('無法準備原始 JSON 與 digest；轉換已阻擋。') }
  }
  const activate = async () => {
    if (!ready || !writable || busy || !sourceRaw || !exported || exported.raw !== sourceRaw || !confirmed) return
    setBusy(true)
    setError('')
    try {
      const decisions: SubjectMigrationDecisionV9[] = plan.entries.map((entry) => {
        const owners = ownersFor(entry.subjectId)
        return { sourceSubjectId: entry.subjectId,
          owners: owners.map((timetableId, index) => ({ timetableId,
            subjectId: index === 0 ? entry.subjectId : crypto.randomUUID() })),
          relations: entry.references.filter((ref) => ref.kind === 'teaching-unit-subject').flatMap((ref) => {
            const selected = owners.length === 1 ? owners : relationChoices[ref.id] ?? []
            return selected.map((timetableId, index) => ({ sourceRelationId: ref.id,
              timetableId, relationId: index === 0 ? ref.id : crypto.randomUUID() }))
          }),
        }
      })
      const candidate = buildSubjectMigrationCandidateV9(data, decisions)
      if (!candidate.ok) { setError(`資料盤點未通過：${candidate.issues.map((issue) => issue.code).join('、')}`); return }
      if (localStorage.getItem(APP_DATA_V8_KEY) !== sourceRaw
        || localStorage.getItem(APP_DATA_V9_KEY) !== null
        || localStorage.getItem(V9_ACTIVATION_KEY) !== null) {
        setError('來源已變更或已有新版本資料；請重新載入並檢查，未執行轉換。')
        return
      }
      const result = await activateTimetableSubjectsV9(localStorage, {
        attemptId: crypto.randomUUID(), createdAt: new Date().toISOString(),
        expectedV8Raw: sourceRaw, candidate: candidate.candidate, decisions,
        confirmedExternalV8Digest: exported.digest,
        userConfirmedExternalBackup: true,
      })
      if (!result.ok) { setError(`轉換中止：${result.code}。原始 V8 保留；請匯出現有資料並人工檢查中斷狀態。`)
        onStorageChanged(); return }
      onActivated()
    } catch (cause) {
      setError(`轉換中止：${cause instanceof Error ? cause.message : 'unknown'}。原始 V8 保留。`)
      onStorageChanged()
    } finally { setBusy(false) }
  }
  return <section className="panel v8-preview-panel" aria-label="教師獨立科目庫轉換">
    <h2>啟用教師獨立科目庫</h2>
    <p>轉換僅在你確認後執行；原 V8 key 與啟用紀錄將先備份並保留。不同教師共用的科目會建立各自 ID；不會自動清除舊資料。</p>
    <p>需要盤點 {plan.entries.length} 筆科目；阻擋問題 {plan.issues.filter((item) => item.code.startsWith('reference-') || item.code === 'missing-subject').length} 筆。</p>
    {plan.entries.map((entry) => {
      const direct = directOwners(entry.subjectId)
      const owners = ownersFor(entry.subjectId)
      const subject = data.subjects.find((item) => item.id === entry.subjectId)!
      return <div key={entry.subjectId} className="settings-section">
        <h3>{subject.name}・{entry.classification}</h3>
        {entry.issues.filter((issue) => issue.code.startsWith('reference-')).map((issue, index) =>
          <p key={index} role="alert">引用異常：{issue.code}／{issue.referenceId}</p>)}
        {direct.length ? <p>已有課程／進度歸屬：{direct.map((id) => data.timetables.find((item) => item.id === id)?.name ?? id).join('、')}。共用科目會複製並重映射。</p>
          : <label>選擇此科目的教師課表 <select aria-label={`${subject.name} 歸屬教師`}
            value={ownerChoices[subject.id] ?? ''} onChange={(event) => setOwnerChoices((old) => ({ ...old, [subject.id]: event.target.value }))}>
            <option value="">請選擇</option>{projectTables(subject.projectId).map((item) =>
              <option key={item.id} value={item.id}>{item.name}・{item.teacherName}</option>)}</select></label>}
        {entry.references.filter((ref) => ref.kind === 'teaching-unit-subject' && owners.length > 1).map((ref) =>
          <fieldset key={ref.id}><legend>任教配置 {data.teachingUnits.find((unit) => unit.id === ref.teachingUnitId)?.name ?? ref.id} 要保留在哪些教師課表？</legend>
            {owners.map((id) => <label key={id}><input type="checkbox" checked={(relationChoices[ref.id] ?? []).includes(id)}
              onChange={(event) => setRelationChoices((old) => ({ ...old,
                [ref.id]: event.target.checked ? [...(old[ref.id] ?? []), id]
                  : (old[ref.id] ?? []).filter((value) => value !== id) }))} />
              {data.timetables.find((item) => item.id === id)?.name ?? id}</label>)}</fieldset>)}
      </div>
    })}
    <div className="v8-preview-upgrade-confirm">
      <button type="button" disabled={!sourceRaw} onClick={() => void prepareExport()}>準備並下載原始 V8 JSON</button>
      {exported && <p>已準備外部匯出：{exported.digest}。下載按鈕不代表檔案已實際保存。</p>}
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}
        disabled={!exported || exported.raw !== sourceRaw} /> 我已自行確認此快照的 JSON 檔已保存</label>
      <div className="v8-preview-form-actions"><button type="button" className="primary-button"
        disabled={!ready || !writable || !confirmed || exported?.raw !== sourceRaw || busy}
        onClick={() => void activate()}>確認轉換並啟用獨立科目庫</button></div>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
  </section>
}

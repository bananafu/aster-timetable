import { useMemo, useState } from 'react'
import { fingerprintV7Raw } from '../data/activationV8'
import { buildSubjectMigrationCandidateV9, type SubjectMigrationDecisionV9 } from '../data/subjectMigrationCandidateV9'
import { parseAppDataV8Raw } from '../data/storageV8'
import { V9_BACKUP_PREFIX, type V9BackupRecord } from '../data/storageV9'
import { createFormalV9RecoveryExportPort, type FormalV9RecoveryActionResult,
  type FormalV9RecoverySnapshot } from '../formalV9Recovery'

type Coordinator = ReturnType<typeof import('../formalV9Recovery').createFormalV9RecoveryCoordinator>

interface Props {
  snapshot: FormalV9RecoverySnapshot
  coordinator: Coordinator
  error: string | null
  onResult: (result: FormalV9RecoveryActionResult) => void
}

const stateText: Record<FormalV9RecoverySnapshot['kind'], string> = {
  'migration-ready': '已驗證原始 V8 資料，可在確認歸屬與外部備份後轉換。',
  'resume-ready': '已驗證中斷的轉換紀錄與備份，可明確續接同一份候選資料。',
  'orphan-ready': '已驗證唯一且完整的孤立備份，可明確續接同一份候選資料。',
  'export-only': '目前資料無法安全續接。請先匯出可取得的原始資料並人工檢查。',
  ambiguous: '資料證據不一致或有多份候選備份。請先匯出可取得的原始資料並人工檢查。',
  'read-error': '無法讀取儲存資料，所有轉換與匯出操作已停用。',
}

const filename = (role: string, index: number) => role === 'v8-source'
  ? 'toki-v8-before-teacher-subject-upgrade.json'
  : `toki-v9-recovery-${role}-${index + 1}.json`

function downloadExact(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
  } finally { URL.revokeObjectURL(url) }
}

/** Presentation only. All storage reads and mutations remain in the snapshot-bound coordinator. */
export function FormalV9RecoveryPage({ snapshot, coordinator, error, onResult }: Props) {
  const port = useMemo(() => createFormalV9RecoveryExportPort(snapshot), [snapshot])
  const source = useMemo(() => snapshot.migration
    ? parseAppDataV8Raw(snapshot.migration.sourceRaw) : null, [snapshot])
  const plan = snapshot.migration?.plan
  const existingDecisions = useMemo(() => {
    if (!snapshot.recoveryAttemptId) return null
    const raw = port.readExact(`${V9_BACKUP_PREFIX}${snapshot.recoveryAttemptId}`)
    if (raw === null) return null
    try {
      const backup = JSON.parse(raw) as V9BackupRecord
      if (backup.kind !== 'timetable-subject-upgrade-backup') return null
      const source = parseAppDataV8Raw(backup.sourceV8Raw)
      return backup.decisions.map((decision) => ({
        subject: source.subjects.find((item) => item.id === decision.sourceSubjectId)?.name
          ?? decision.sourceSubjectId,
        owners: decision.owners.map((owner) => source.timetables.find((item) => item.id === owner.timetableId)?.name
          ?? owner.timetableId),
        relations: decision.relations.map((relation) => {
          const original = source.teachingUnitSubjects.find((item) => item.id === relation.sourceRelationId)
          const unit = source.teachingUnits.find((item) => item.id === original?.teachingUnitId)
          const timetable = source.timetables.find((item) => item.id === relation.timetableId)
          return `${unit?.name ?? relation.sourceRelationId} → ${timetable?.name ?? relation.timetableId}`
        }),
      }))
    } catch { return null }
  }, [port, snapshot.recoveryAttemptId])
  const [owners, setOwners] = useState<Record<string, string>>({})
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({})
  const [relations, setRelations] = useState<Record<string, string[]>>({})
  const [exported, setExported] = useState<{ raw: string; digest: `sha256:${string}` } | null>(null)
  const [confirmedBackup, setConfirmedBackup] = useState(false)
  const [confirmedRecovery, setConfirmedRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const directOwners = (subjectId: string) => [...new Set(plan?.entries.find((item) => item.subjectId === subjectId)
    ?.references.filter((item) => item.kind !== 'teaching-unit-subject')
    .map((item) => item.timetableId).filter((id): id is string => !!id) ?? [])].sort()
  const ownersFor = (subjectId: string) => {
    const direct = directOwners(subjectId)
    return direct.length ? (reviewed[subjectId] ? direct : []) : owners[subjectId] ? [owners[subjectId]] : []
  }
  const ready = !!plan?.sourceCompatibleV8 && plan.entries.every((entry) => {
    const selected = ownersFor(entry.subjectId)
    return entry.classification !== 'invalid-or-ambiguous' && selected.length > 0
      && entry.references.filter((ref) => ref.kind === 'teaching-unit-subject').every((ref) => {
        const assignment = relations[ref.id] ?? []
        return assignment.length > 0 && assignment.every((id) => selected.includes(id))
      })
  })

  const exportEntry = async (key: string, role: string, index: number) => {
    const raw = port.readExact(key)
    if (raw === null) return
    try {
      const digest = role === 'v8-source' ? await fingerprintV7Raw(raw) : null
      downloadExact(raw, filename(role, index))
      if (role === 'v8-source' && digest) {
        setExported({ raw, digest })
        setConfirmedBackup(false)
      }
      setLocalError(null)
    } catch { setLocalError('無法準備此快照的原始 JSON 匯出。') }
  }

  const run = async () => {
    if (busy) return
    setBusy(true)
    setLocalError(null)
    try {
      let result: FormalV9RecoveryActionResult
      if (snapshot.kind === 'migration-ready' && source && plan && ready && confirmedBackup && exported
        && exported.raw === snapshot.migration?.sourceRaw) {
        const decisions: SubjectMigrationDecisionV9[] = plan.entries.map((entry) => {
          const selected = ownersFor(entry.subjectId)
          return { sourceSubjectId: entry.subjectId,
            owners: selected.map((timetableId, index) => ({ timetableId,
              subjectId: index === 0 ? entry.subjectId : crypto.randomUUID() })),
            relations: entry.references.filter((ref) => ref.kind === 'teaching-unit-subject')
              .flatMap((ref) => (relations[ref.id] ?? []).map((timetableId, index) => ({
                sourceRelationId: ref.id, timetableId, relationId: index === 0 ? ref.id : crypto.randomUUID(),
              }))),
          }
        })
        const candidate = buildSubjectMigrationCandidateV9(source, decisions)
        if (!candidate.ok) {
          setLocalError(`資料盤點未通過：${candidate.issues.map((issue) => issue.code).join('、')}`)
          return
        }
        result = await coordinator.activate(snapshot, { attemptId: crypto.randomUUID(),
          createdAt: new Date().toISOString(), decisions, externalExportRaw: exported.raw,
          externalExportDigest: exported.digest, userConfirmedExternalBackup: confirmedBackup })
      } else if (snapshot.kind === 'resume-ready' && confirmedRecovery) {
        result = await coordinator.resume(snapshot, { userConfirmed: true })
      } else if (snapshot.kind === 'orphan-ready' && confirmedRecovery) {
        result = await coordinator.resumeOrphan(snapshot, { userConfirmed: true })
      } else return
      onResult(result)
    } catch { setLocalError('復原檢查中止；原始資料仍保留。') }
    finally { setBusy(false) }
  }

  return <main className="formal-recovery-page">
    <header><span className="brand-title">Toki</span><p className="eyebrow">資料復原</p></header>
    <section className="panel" aria-label="資料復原">
      <div className="panel-heading"><div><h2>資料復原</h2></div></div>
      <div className="formal-recovery-body">
        <p>{stateText[snapshot.kind]}</p>
        {plan && source && <section aria-label="科目歸屬決策">
          <h3>確認科目歸屬</h3>
          <p>轉換僅在你確認後執行；原 V8 資料與啟用紀錄會保留。共用科目將建立各自的 ID。</p>
          {plan.entries.map((entry) => {
            const subject = source.subjects.find((item) => item.id === entry.subjectId)
            const direct = directOwners(entry.subjectId)
            const selected = ownersFor(entry.subjectId)
            return <div className="settings-section" key={entry.subjectId}>
              <h4>{subject?.name ?? entry.subjectId}</h4>
              {entry.issues.filter((issue) => issue.code.startsWith('reference-')).map((issue, index) =>
                <p role="alert" key={index}>引用異常：{issue.code}／{issue.referenceId}</p>)}
              {direct.length ? <label><input type="checkbox" checked={!!reviewed[entry.subjectId]}
                onChange={(event) => setReviewed((old) => ({ ...old, [entry.subjectId]: event.target.checked }))} />
                確認既有課程與進度歸屬：{direct.map((id) => source.timetables.find((item) => item.id === id)?.name ?? id).join('、')}
              </label> : <label>選擇此科目的教師課表 <select aria-label={`${subject?.name ?? entry.subjectId} 歸屬教師`}
                value={owners[entry.subjectId] ?? ''} onChange={(event) => setOwners((old) => ({ ...old, [entry.subjectId]: event.target.value }))}>
                <option value="">請選擇</option>{source.timetables.filter((item) => item.projectId === entry.projectId)
                  .map((item) => <option key={item.id} value={item.id}>{item.name}・{item.teacherName}</option>)}
              </select></label>}
              {entry.references.filter((ref) => ref.kind === 'teaching-unit-subject').map((ref) =>
                <fieldset key={ref.id}><legend>任教配置 {source.teachingUnits.find((item) => item.id === ref.teachingUnitId)?.name
                  ?? ref.id} 要保留在哪些教師課表？</legend>
                  {selected.map((id) => <label key={id}><input type="checkbox"
                    checked={(relations[ref.id] ?? []).includes(id)}
                    onChange={(event) => setRelations((old) => ({ ...old,
                      [ref.id]: event.target.checked ? [...(old[ref.id] ?? []), id]
                        : (old[ref.id] ?? []).filter((value) => value !== id),
                    }))} />{source.timetables.find((item) => item.id === id)?.name ?? id}</label>)}
                </fieldset>)}
            </div>
          })}
        </section>}
        {existingDecisions && <section aria-label="既有遷移決策"><h3>既有遷移決策</h3>
          {existingDecisions.length === 0 ? <p>此備份沒有科目歸屬決策。</p>
            : existingDecisions.map((item, index) => <div key={index}>
              <p>{item.subject}：{item.owners.join('、')}</p>
              {item.relations.length > 0 && <p>任教配置：{item.relations.join('、')}</p>}
            </div>)}
        </section>}
        {port.entries.length > 0 && <section aria-label="原始資料匯出"><h3>匯出原始資料</h3>
          <p>下載會使用此檢查快照的原始 JSON；開始下載不代表檔案已保存。</p>
          <div className="formal-recovery-exports">{port.entries.map((item, index) =>
            <button type="button" key={item.key} disabled={busy}
              onClick={() => { void exportEntry(item.key, item.role, index) }}>
              匯出 {item.role}{item.role === 'v8-source' ? '' : ` ${index + 1}`} 原始 JSON</button>)}</div>
        </section>}
        {snapshot.kind === 'migration-ready' && <section className="formal-recovery-confirm">
          {exported && <p>已準備此快照的原始 V8 JSON：{exported.digest}。請自行確認檔案已保存。</p>}
          <label><input type="checkbox" checked={confirmedBackup} disabled={!exported || busy}
            onChange={(event) => setConfirmedBackup(event.target.checked)} /> 我已自行確認此快照的 JSON 檔已保存</label>
          <button className="primary-button" type="button" disabled={!ready || !confirmedBackup || !exported || busy}
            onClick={() => { void run() }}>確認轉換並啟用獨立科目庫</button>
        </section>}
        {(snapshot.kind === 'resume-ready' || snapshot.kind === 'orphan-ready') && <section className="formal-recovery-confirm">
          <label><input type="checkbox" checked={confirmedRecovery} disabled={busy}
            onChange={(event) => setConfirmedRecovery(event.target.checked)} /> 我確認續接已驗證的同一份資料</label>
          <button className="primary-button" type="button" disabled={!confirmedRecovery || busy}
            onClick={() => { void run() }}>確認續接復原</button>
        </section>}
        {(localError || error) && <p className="form-error" role="alert">{localError || error}</p>}
      </div>
    </section>
  </main>
}

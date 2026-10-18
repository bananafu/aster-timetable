import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { OPTIONAL_SUBJECT_CATALOG } from '../data/defaultSubjects'
import {
  installSafeSubjectCatalog,
  previewSubjectCatalogInstall,
  type CatalogInstallPreview,
  type CatalogSchoolLevel,
} from '../data/subjectCatalogInstall'
import type { StoragePersistence, StorageStatus } from '../hooks/useLocalStorage'
import type { AppDataV4 } from '../types'
import './SubjectCatalogInstaller.css'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

interface Props {
  data: AppDataV4
  setData: Dispatch<SetStateAction<AppDataV4>>
  storageStatus: StorageStatus
  storagePersistence: StoragePersistence
  readOnly?: boolean
}

export function SubjectCatalogInstaller({ data, setData, storageStatus, storagePersistence, readOnly = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [levels, setLevels] = useState<CatalogSchoolLevel[]>(['junior-high', 'senior-high'])
  const [optionalKeys, setOptionalKeys] = useState<string[]>([])
  const [preview, setPreview] = useState<CatalogInstallPreview | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<{ revision: number; ids: string[] } | null>(null)
  const active = data.projects.find((project) => project.id === data.activeProjectId)
  const editable = !readOnly && Boolean(active && !active.archivedAt)
  const ready = editable && storageStatus === 'saved' && !storagePersistence.pending && !pending

  useEffect(() => {
    if (!pending) return
    if (storageStatus === 'conflict') {
      setMessage('跨分頁資料衝突；本次補齊未確認儲存。請先處理資料衝突，再重新預覽。')
      setPending(null)
    } else if (storageStatus === 'write-error' || storageStatus === 'read-error') {
      setMessage('科目補齊寫入失敗；請先處理儲存問題，再重新預覽。')
      setPending(null)
    } else if (storageStatus === 'saved' && !storagePersistence.pending && storagePersistence.revision > pending.revision) {
      const savedIds = new Set(data.subjects.map((subject) => subject.id))
      setMessage(pending.ids.every((id) => savedIds.has(id))
        ? `已儲存 ${pending.ids.length} 筆預設科目；需要人工確認的項目仍保留。`
        : '資料在儲存期間已變更，請重新預覽並確認科目庫。')
      setPreview(null)
      setPending(null)
    }
  }, [data.subjects, pending, storagePersistence.pending, storagePersistence.revision, storageStatus])

  const changeLevel = (level: CatalogSchoolLevel, checked: boolean) => {
    setLevels((current) => checked ? [...current, level] : current.filter((item) => item !== level))
    setPreview(null); setMessage('')
  }
  const changeOptional = (key: string, checked: boolean) => {
    setOptionalKeys((current) => checked ? [...current, key] : current.filter((item) => item !== key))
    setPreview(null); setMessage('')
  }
  const showPreview = () => {
    try {
      setPreview(previewSubjectCatalogInstall(data, levels, optionalKeys))
      setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : '無法建立補齊預覽。') }
  }
  const confirm = () => {
    if (!preview || !ready) {
      setMessage(storageStatus === 'conflict' ? '跨分頁資料衝突，請先處理後重新預覽。'
        : !editable ? '目前沒有可編輯的使用中專案；封存專案僅供檢視。'
          : '資料尚未完成儲存，請稍後重新預覽。')
      return
    }
    try {
      const result = installSafeSubjectCatalog(data, preview, uid)
      if (!result.addedSubjectIds.length) { setMessage('目前沒有可安全新增的科目；請檢查待確認項目。'); return }
      setPending({ revision: storagePersistence.revision, ids: result.addedSubjectIds })
      setMessage('正在儲存預設科目…')
      setData(result.data)
    } catch (error) {
      setPreview(null)
      setMessage(error instanceof Error ? error.message : '科目補齊失敗，資料未變更。')
    }
  }

  return <section className="subject-catalog-installer" aria-label="預設科目補齊">
    <div className="subject-catalog-heading"><div><strong>補齊預設科目</strong><p>科目庫由所有課表專案共用；新增後，其他專案也可使用適用學制的科目。</p></div><button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>{expanded ? '收合' : '檢視補齊'}</button></div>
    {expanded && <div className="subject-catalog-content">
      <fieldset><legend>適用範圍</legend><label><input type="checkbox" checked={levels.includes('junior-high')} onChange={(event) => changeLevel('junior-high', event.target.checked)} />國中部</label><label><input type="checkbox" checked={levels.includes('senior-high')} onChange={(event) => changeLevel('senior-high', event.target.checked)} />普通高中部</label></fieldset>
      <fieldset><legend>常用其他課程（選用，預設不安裝）</legend><div className="subject-catalog-options">{OPTIONAL_SUBJECT_CATALOG.map((entry) => <label key={entry.catalogKey}><input type="checkbox" checked={optionalKeys.includes(entry.catalogKey)} onChange={(event) => changeOptional(entry.catalogKey, event.target.checked)} />{entry.name}</label>)}</div></fieldset>
      <div className="subject-catalog-actions"><button type="button" onClick={showPreview} disabled={!ready || levels.length === 0}>產生衝突預覽</button>{!editable && <span role="status">封存或沒有使用中專案時不可補齊。</span>}{storageStatus !== 'saved' && <span role="status">資料儲存狀態異常，請先處理後再補齊。</span>}</div>
      {preview && <section className="subject-catalog-preview" aria-label="科目補齊預覽"><p>可安全新增 {preview.counts['safe-to-add']} 筆・已存在 {preview.counts['exists-applicable']} 筆・需人工確認 {preview.counts['needs-review']} 筆</p><p className="subject-catalog-note">只會新增安全項目；同名跨學制共用一筆 Subject。待確認項目不會合併或修改。</p>
        {(['core', 'optional'] as const).map((category) => {
          const items = preview.items.filter((item) => item.category === category)
          return items.length > 0 && <div key={category} className="subject-catalog-group"><strong>{category === 'core' ? '核心科目' : '常用其他課程'}</strong><ul>{items.map((item) => <li key={item.catalogKey}><span><i className={`subject-catalog-state ${item.status}`} />{item.name}<small>{item.levels.map((level) => level === 'junior-high' ? '國中部' : '普通高中部').join('、')}</small></span><em>{item.status === 'safe-to-add' ? '可安全新增' : item.status === 'exists-applicable' ? '已存在' : '待確認'}</em>{item.status === 'needs-review' && <p>{item.reasons.join(' ')}</p>}</li>)}</ul></div>
        })}
        <div className="subject-catalog-actions"><button type="button" className="primary-button" onClick={confirm} disabled={!ready || preview.counts['safe-to-add'] === 0}>確認安裝安全項目（{preview.counts['safe-to-add']}）</button><button type="button" onClick={() => { setPreview(null); setMessage('') }}>取消預覽</button></div>
      </section>}
      {message && <p className={message.startsWith('已儲存') ? 'subject-catalog-success' : 'subject-catalog-message'} role="status">{message}</p>}
    </div>}
  </section>
}

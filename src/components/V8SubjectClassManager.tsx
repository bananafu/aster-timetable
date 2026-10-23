import { useState, type Dispatch, type SetStateAction } from 'react'
import type { AppDataV8 } from '../types'
import type { AppDataV8Persistence, AppDataV8RuntimeControls, AppDataV8RuntimeStatus } from '../hooks/useAppDataV8'
import { ClassManagerV8 } from './ClassManagerV8'
import { TeachingUnitSubjectManagerV8 } from './TeachingUnitSubjectManagerV8'
import { Modal } from './Modal'

export function V8SubjectClassManager({ data, setData, status, persistence, writable, controls, onClose, onExport }: {
  data: AppDataV8; setData: Dispatch<SetStateAction<AppDataV8>>; status: AppDataV8RuntimeStatus;
  persistence: AppDataV8Persistence; writable: boolean;
  controls: Pick<AppDataV8RuntimeControls, 'exportLocalJson' | 'adoptExternalV8'>;
  onClose: () => void; onExport?: (raw: string) => void
}) {
  const [page, setPage] = useState<'subjects' | 'classes'>('subjects')
  const readOnly = !writable || status !== 'saved'
  const verifiedPersistence = persistence.revision === 0 || (persistence.receipt?.raw === JSON.stringify(data)
    && persistence.receipt.revision === persistence.revision)
    ? persistence : { ...persistence, pending: true, revision: 0 }
  const leave = () => { if (window.confirm('若有未儲存的草稿，確定捨棄並離開？')) onClose() }
  const changePage = (next: 'subjects' | 'classes') => {
    if (next !== page && window.confirm('若有未儲存的草稿，確定捨棄並切換？')) setPage(next)
  }
  return <Modal title="V8 科目與班級管理" onClose={leave}><div className="resource-manager-dialog">
    <nav className="settings-menu" aria-label="資源類型">
      <button type="button" onClick={() => changePage('subjects')}>科目與任教配置</button>
      <button type="button" onClick={() => changePage('classes')}>班級</button>
    </nav>
    {readOnly && <div role="status">目前唯讀或有衝突：{status}。
      <button type="button" disabled={!onExport} onClick={() => onExport?.(controls.exportLocalJson())}>匯出本頁 JSON</button>
      <button type="button" onClick={controls.adoptExternalV8}>採用外部 V8</button>
    </div>}
    {page === 'subjects' ? <TeachingUnitSubjectManagerV8 data={data} setData={setData}
      storageStatus={status === 'saved' ? 'saved' : 'conflict'} storagePersistence={verifiedPersistence}
      readOnly={readOnly} writable={writable} onComplete={onClose} />
      : <ClassManagerV8 data={data} setData={setData} status={status} persistence={persistence}
        writable={writable} exportLocalJson={controls.exportLocalJson} onExport={onExport}
        onRecover={controls.adoptExternalV8} onClose={onClose} />}
  </div></Modal>
}

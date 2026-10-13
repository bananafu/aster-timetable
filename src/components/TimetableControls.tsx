import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import type { Timetable } from '../types'
import type { TimetableDetails } from '../data/timetablesV6'
import { Modal } from './Modal'

interface ControlsProps {
  timetables: Timetable[]
  selected?: Timetable
  canManage: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onEdit: () => void
}

export function TimetableControls({ timetables, selected, canManage, onSelect, onCreate, onEdit }: ControlsProps) {
  return <div className="timetable-controls">
    <div className="timetable-teacher"><span>授課教師</span><strong>{selected ? selected.teacherName ?? '待補授課教師' : '請選擇教師課表'}</strong></div>
    <div className="timetable-control-row">
      <label>教師課表<select aria-label="教師課表" value={selected?.id ?? ''} onChange={(event) => onSelect(event.target.value)}>
        {!selected && <option value="">請選擇課表</option>}
        {timetables.map((item) => <option key={item.id} value={item.id}>{item.name}・{item.teacherName ?? '待補授課教師'}</option>)}
      </select></label>
      {canManage && <><button type="button" onClick={onCreate}><Plus size={14} />新增空白課表</button><button type="button" onClick={onEdit} disabled={!selected}>編輯課表資訊</button></>}
    </div>
  </div>
}

interface FormProps {
  mode: 'create' | 'edit'
  timetable?: Timetable
  error: string
  onSubmit: (details: TimetableDetails) => void
  onClose: () => void
}

export function TimetableForm({ mode, timetable, error, onSubmit, onClose }: FormProps) {
  const [name, setName] = useState(timetable?.name ?? '')
  const [teacherName, setTeacherName] = useState(timetable?.teacherName ?? '')
  const [wasPending] = useState(Boolean(timetable?.teacherNamePending))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit({ name, teacherName: teacherName.trim() || null })
  }
  return <Modal title={mode === 'create' ? '新增空白課表' : '編輯課表資訊'} subtitle={mode === 'create'
    ? '沿用目前專案的學校、學制與節次；新課表不含課程或異動。'
    : '課表名稱與授課教師姓名只屬於這份課表。'} onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label className="full">課表名稱<input value={name} onChange={(event) => setName(event.target.value)} required autoFocus /></label>
      <label className="full">授課教師姓名<input value={teacherName} onChange={(event) => setTeacherName(event.target.value)} required={mode === 'create' || !wasPending} /></label>
      {mode === 'edit' && wasPending && <p className="settings-empty full">舊課表尚未填寫授課教師姓名。可先保留待補狀態，之後再填寫。</p>}
      {error && <p className="form-error full" role="alert">{error}</p>}
      <div className="form-actions full"><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary-button">{mode === 'create' ? '建立並切換' : '儲存課表資訊'}</button></div>
    </form>
  </Modal>
}

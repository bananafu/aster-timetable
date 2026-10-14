import { useState, type FormEvent } from 'react'
import { Copy, Plus } from 'lucide-react'
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
  onCopy: () => void
  notice?: string
}

export function TimetableControls({ timetables, selected, canManage, onSelect, onCreate, onEdit, onCopy, notice }: ControlsProps) {
  const canCopy = Boolean(selected?.teacherName?.trim()) && !selected?.teacherNamePending
  return <div className="timetable-controls">
    <div className="timetable-teacher"><span>授課教師</span><strong>{selected ? selected.teacherName ?? '待補授課教師' : '請選擇教師課表'}</strong></div>
    {notice && <p className="settings-empty" role="status">{notice}</p>}
    <div className="timetable-control-row">
      <label>教師課表<select aria-label="教師課表" value={selected?.id ?? ''} onChange={(event) => onSelect(event.target.value)}>
        {!selected && <option value="">請選擇課表</option>}
        {timetables.map((item) => <option key={item.id} value={item.id}>{item.name}・{item.teacherName ?? '待補授課教師'}</option>)}
      </select></label>
      {canManage && <><button type="button" onClick={onCreate}><Plus size={14} />新增空白課表</button>{canCopy && <button type="button" onClick={onCopy}><Copy size={14} />複製課表</button>}<button type="button" onClick={onEdit} disabled={!selected}>編輯課表資訊</button></>}
    </div>
  </div>
}

export interface TimetableCopyDetails {
  name: string
  teacherName: string
  baseDate: string
}

interface CopyFormProps {
  source: Timetable
  defaultDate: string
  error: string
  submitting: boolean
  onSubmit: (details: TimetableCopyDetails) => void
  onClose: () => void
}

export function TimetableCopyForm({ source, defaultDate, error, submitting, onSubmit, onClose }: CopyFormProps) {
  const [name, setName] = useState(`${source.name}（副本）`)
  const [teacherName, setTeacherName] = useState(source.teacherName ?? '')
  const [baseDate, setBaseDate] = useState(defaultDate)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit({ name, teacherName, baseDate })
  }
  const close = submitting ? () => undefined : onClose
  return <Modal title="複製課表" subtitle="建立同一專案內的獨立教師課表。" onClose={close}>
    <form className="form-grid" onSubmit={submit}>
      <label className="full">課表名稱<input value={name} onChange={(event) => setName(event.target.value)} required autoFocus /></label>
      <label className="full">授課教師姓名<input value={teacherName} onChange={(event) => setTeacherName(event.target.value)} required /></label>
      <label className="full">基準日期<input type="date" value={baseDate} onChange={(event) => setBaseDate(event.target.value)} required /></label>
      <p className="settings-empty full">只複製基準日期有效的完整固定週課表（包含 A／B 輪週），不複製單日異動。新課程會從基準日期延續至所屬任教單位的學期末。</p>
      {error && <p className="form-error full" role="alert">{error}</p>}
      <div className="form-actions full"><button type="button" onClick={onClose} disabled={submitting}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? '正在儲存…' : '複製並切換'}</button></div>
    </form>
  </Modal>
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

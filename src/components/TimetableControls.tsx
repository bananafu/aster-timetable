import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { Timetable } from '../types'
import type { TimetableDetails } from '../data/timetablesV6'
import { Modal } from './Modal'

interface ControlsProps {
  timetables: Timetable[]
  selected?: Timetable
  canManage: boolean
  onSelect: (id: string) => void
  onEdit: () => void
  notice?: string
}

type SwitcherTimetable = Pick<Timetable, 'id' | 'name' | 'teacherName'>

/** Presentation only; each host keeps its own timetable selection and persistence rules. */
export function TimetableSwitcher({ timetables, selectedId, onSelect, disabled = false,
  buttonLabel = '切換課表', buttonText = '切換課表' }: {
  timetables: SwitcherTimetable[]
  selectedId: string | null
  onSelect: (id: string) => void
  disabled?: boolean
  buttonLabel?: string
  buttonText?: string
}) {
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(0, timetables.findIndex((item) => item.id === selectedId))
  useEffect(() => {
    if (!switcherOpen) return
    queueMicrotask(() => optionRefs.current[selectedIndex]?.focus())
    const handlePointerDown = (event: MouseEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) setSwitcherOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setSwitcherOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedIndex, switcherOpen])

  const moveOptionFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || timetables.length === 0) return
    event.preventDefault()
    const currentIndex = optionRefs.current.findIndex((item) => item === document.activeElement)
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? timetables.length - 1
        : event.key === 'ArrowDown' ? (currentIndex + 1 + timetables.length) % timetables.length
          : (currentIndex - 1 + timetables.length) % timetables.length
    optionRefs.current[nextIndex]?.focus()
  }

  return <div className="timetable-switcher" ref={switcherRef}>
    <button ref={triggerRef} type="button" aria-label={buttonLabel} aria-haspopup="menu" aria-expanded={switcherOpen}
      disabled={disabled || timetables.length === 0} onClick={() => setSwitcherOpen((value) => !value)} onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        setSwitcherOpen(true)
      }}>{buttonText} <ChevronDown aria-hidden="true" /></button>
    {switcherOpen && <div className="timetable-switcher-popover" role="menu" aria-label="教師課表" onKeyDown={moveOptionFocus}>
      {timetables.map((item, index) => <button
        ref={(element) => { optionRefs.current[index] = element }}
        type="button"
        role="menuitemradio"
        data-timetable-id={item.id}
        aria-checked={item.id === selectedId}
        key={item.id}
        onClick={() => {
          onSelect(item.id)
          setSwitcherOpen(false)
          triggerRef.current?.focus()
        }}
      ><span><strong>{item.name}</strong><small>{item.teacherName ?? '待補授課教師'}</small></span>{item.id === selectedId && <Check aria-label="目前課表" />}</button>)}
    </div>}
  </div>
}

export function TimetableControls({ timetables, selected, canManage, onSelect, onEdit, notice }: ControlsProps) {
  return <div className="timetable-controls">
    <div className="timetable-teacher"><span>授課教師</span><strong>{selected ? selected.teacherName ?? '待補授課教師' : '請選擇教師課表'}</strong></div>
    {notice && <p className="settings-empty" role="status">{notice}</p>}
    <div className="timetable-control-row">
      <TimetableSwitcher timetables={timetables} selectedId={selected?.id ?? null} onSelect={onSelect} />
      {canManage && <button type="button" onClick={(event) => { event.currentTarget.focus(); onEdit() }} disabled={!selected}>編輯課表資訊</button>}
    </div>
  </div>
}

export interface TimetableCopyDetails {
  name: string
  teacherName: string
  baseDate: string
}

interface InfoDialogProps {
  timetable: Timetable
  defaultDate: string
  error: string
  submitting: boolean
  deleteImpact: { lessons: number; overrides: number; oneOffLessons: number }
  onEdit: (details: TimetableDetails) => void
  onCopy: (details: TimetableCopyDetails) => void
  onDelete: () => void
  onClose: () => void
  copyMode?: 'schedule' | 'settings'
}

export function TimetableInfoDialog({ timetable, defaultDate, error, submitting, deleteImpact, onEdit, onCopy, onDelete, onClose, copyMode = 'schedule' }: InfoDialogProps) {
  const [name, setName] = useState(timetable.name)
  const [teacherName, setTeacherName] = useState(timetable.teacherName ?? '')
  const [copyOpen, setCopyOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteSubmitted, setDeleteSubmitted] = useState(false)
  const [copyName, setCopyName] = useState(`${timetable.name}（副本）`)
  const [copyTeacher, setCopyTeacher] = useState(timetable.teacherName ?? '')
  const [baseDate, setBaseDate] = useState(defaultDate)
  const inputRef = useRef<HTMLInputElement>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement>(null)
  const deleteConfirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (deleteOpen) deleteConfirmRef.current?.focus() }, [deleteOpen])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    inputRef.current?.focus()
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const dialog = inputRef.current?.closest('[role="dialog"]')
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', trapTab)
    return () => { document.removeEventListener('keydown', trapTab); previous?.focus() }
  }, [])
  const editDirty = name !== timetable.name || teacherName !== (timetable.teacherName ?? '')
  const dirty = editDirty
    || copyName !== `${timetable.name}（副本）` || copyTeacher !== (timetable.teacherName ?? '') || baseDate !== defaultDate
  const close = () => {
    if (submitting) return
    if (deleteOpen) { setDeleteOpen(false); queueMicrotask(() => deleteTriggerRef.current?.focus()); return }
    if (dirty && !window.confirm('尚未儲存的課表資訊會遺失，確定關閉？')) return
    onClose()
  }
  const canCopy = Boolean(timetable.teacherName?.trim()) && !timetable.teacherNamePending
  return <Modal title="編輯課表資訊" subtitle={`目前課表：${timetable.name}・${timetable.teacherName ?? '待補授課教師'}`} onClose={close}>
    <div className="timetable-info-body">
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); onEdit({ name, teacherName: teacherName.trim() || null }) }}>
        <label className="full">課表名稱<input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} required disabled={submitting} /></label>
        <label className="full">授課教師姓名<input value={teacherName} onChange={(event) => setTeacherName(event.target.value)} required={!timetable.teacherNamePending} disabled={submitting} /></label>
        {timetable.teacherNamePending && <p className="settings-empty full">舊課表尚未填寫授課教師姓名。可先保留待補狀態，之後再填寫。</p>}
        {error && !copyOpen && !deleteOpen && <p className="form-error full" role="alert">{error}</p>}
        <div className="form-actions full"><button type="button" onClick={close} disabled={submitting}>取消</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? '正在儲存…' : '儲存課表資訊'}</button></div>
      </form>
      <section className="timetable-copy-section" aria-label="複製課表">
        <h3>{copyMode === 'settings' ? '只複製課表設定' : '複製課表'}</h3><p>{copyMode === 'settings' ? '只複製課表設定；不複製固定課程、單日課程、課程異動或 Event。' : '依基準日期複製有效的固定課程版本與 A／B 週配置；不複製單日異動或單日課程。'}</p>
        <button type="button" onClick={() => setCopyOpen((value) => !value)} disabled={!canCopy || submitting} aria-expanded={copyOpen}>{copyMode === 'settings' ? '只複製課表設定' : '複製課表'}</button>
        {!canCopy && <p>請先補齊授課教師姓名，才能複製。</p>}
        {copyOpen && <form className="form-grid" aria-label="複製課表設定" onSubmit={(event) => { event.preventDefault(); onCopy({ name: copyName, teacherName: copyTeacher, baseDate }) }}>
          {editDirty && <p className="settings-empty full">請先儲存或還原上方課表資訊，再複製課表。</p>}
          <label className="full">副本名稱<input value={copyName} onChange={(event) => setCopyName(event.target.value)} required disabled={submitting} /></label>
          <label className="full">副本授課教師姓名<input value={copyTeacher} onChange={(event) => setCopyTeacher(event.target.value)} required disabled={submitting} /></label>
          <label className="full">基準日期<input type="date" value={baseDate} onChange={(event) => setBaseDate(event.target.value)} required disabled={submitting} /></label>
          {error && !deleteOpen && <p className="form-error full" role="alert">{error}</p>}
          <div className="form-actions full"><button type="submit" className="primary-button" disabled={submitting || editDirty}>{submitting ? '正在儲存…' : copyMode === 'settings' ? '複製設定並切換' : '複製並切換'}</button></div>
        </form>}
      </section>
      <section className="timetable-delete-section" aria-label="刪除課表">
        <h3>刪除課表</h3>
        <p>刪除「{timetable.name}」會一併移除這份課表的 {deleteImpact.lessons} 筆固定課程版本、{deleteImpact.overrides} 筆單日異動與 {deleteImpact.oneOffLessons} 筆單日課程。專案及學校、學制、班級和科目不受影響。</p>
        {!deleteOpen ? <button ref={deleteTriggerRef} type="button" className="danger-outline" disabled={submitting} onClick={() => {
          if (dirty && !window.confirm('尚未儲存的課表資訊會遺失，確定繼續刪除？')) return
          setDeleteSubmitted(false)
          setDeleteOpen(true)
        }}>刪除課表</button> : <div className="timetable-delete-confirm">
          <p>請再次確認：永久刪除「{timetable.name}」及上述課程與異動？此操作無法復原。</p>
          {error && deleteSubmitted && <p className="form-error" role="alert">{error}</p>}
          <div className="form-actions"><button type="button" disabled={submitting} onClick={() => { setDeleteOpen(false); queueMicrotask(() => deleteTriggerRef.current?.focus()) }}>保留課表</button><button ref={deleteConfirmRef} type="button" className="danger-outline" disabled={submitting} onClick={() => { setDeleteSubmitted(true); onDelete() }}>{submitting ? '正在儲存…' : `確認刪除「${timetable.name}」`}</button></div>
        </div>}
      </section>
    </div>
  </Modal>
}

interface FormProps {
  error: string
  onSubmit: (details: TimetableDetails) => void
  onClose: () => void
}

export function TimetableForm({ error, onSubmit, onClose }: FormProps) {
  const [name, setName] = useState('')
  const [teacherName, setTeacherName] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit({ name, teacherName: teacherName.trim() || null })
  }
  return <Modal title="建立空白課表" subtitle="沿用目前專案的學校、學制與節次；新課表不含課程或異動。" onClose={onClose}>
    <form className="form-grid" onSubmit={submit}>
      <label className="full">課表名稱<input value={name} onChange={(event) => setName(event.target.value)} required autoFocus /></label>
      <label className="full">授課教師姓名<input value={teacherName} onChange={(event) => setTeacherName(event.target.value)} required /></label>
      {error && <p className="form-error full" role="alert">{error}</p>}
      <div className="form-actions full"><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary-button">建立並切換</button></div>
    </form>
  </Modal>
}

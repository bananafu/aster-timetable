import { useEffect, useRef, useState } from 'react'
import { Bell, ChevronLeft, ChevronRight, Menu, Plus, Search } from 'lucide-react'
import { formatWeekRange } from '../lib/date'

interface TopbarProps {
  weekStart: Date
  onWeekChange: (offset: number) => void
  onToday: () => void
  onAddProject: () => void
  onAddTimetable: () => void
  canAddTimetable: boolean
  addTimetableReason: string
  onMenu: () => void
  readOnly?: boolean
}

export function Topbar({ weekStart, onWeekChange, onToday, onAddProject, onAddTimetable, canAddTimetable, addTimetableReason, onMenu, readOnly = false }: TopbarProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const outside = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const choose = (action: () => void) => { setOpen(false); action() }
  return (
    <header className="topbar">
      <button className="icon-button menu-button" onClick={onMenu} aria-label="開啟選單"><Menu size={21} /></button>
      <div className="week-controls">
        <button className="today-button" onClick={onToday}>今天</button>
        <div className="arrow-group">
          <button onClick={() => onWeekChange(-7)} aria-label="上一週"><ChevronLeft size={18} /></button>
          <button onClick={() => onWeekChange(7)} aria-label="下一週"><ChevronRight size={18} /></button>
        </div>
        <strong>{formatWeekRange(weekStart)}</strong>
      </div>
      <div className="topbar-actions">
        <button className="icon-button search-button" aria-label="搜尋"><Search size={19} /></button>
        <button className="icon-button notification-button" aria-label="通知"><Bell size={19} /><i /></button>
        {!readOnly && <div className="topbar-add" ref={menuRef}>
          <button ref={triggerRef} type="button" className="primary-button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? 'topbar-add-menu' : undefined} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}><Plus size={18} />新增</button>
          {open && <div id="topbar-add-menu" className="topbar-add-menu" role="menu" aria-label="新增" onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
            items[next]?.focus()
          }}>
            <button type="button" role="menuitem" onClick={() => choose(onAddProject)}>新增專案</button>
            <button type="button" role="menuitem" disabled={!canAddTimetable} onClick={() => choose(onAddTimetable)}>新增空白課表</button>
            {!canAddTimetable && <p>{addTimetableReason}</p>}
          </div>}
        </div>}
      </div>
    </header>
  )
}

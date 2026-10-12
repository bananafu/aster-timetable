import { Bell, ChevronLeft, ChevronRight, Menu, Plus, Search } from 'lucide-react'
import { formatWeekRange } from '../lib/date'

interface TopbarProps {
  weekStart: Date
  onWeekChange: (offset: number) => void
  onToday: () => void
  onAdd: () => void
  onMenu: () => void
}

export function Topbar({ weekStart, onWeekChange, onToday, onAdd, onMenu }: TopbarProps) {
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
        <button className="primary-button" onClick={onAdd}><Plus size={18} />新增</button>
      </div>
    </header>
  )
}

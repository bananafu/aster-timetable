import { AlertCircle, CalendarDays, Check, GraduationCap, LayoutDashboard, Settings, Shapes, Users, X } from 'lucide-react'
import type { StorageStatus } from '../hooks/useLocalStorage'
import type { TimetableProject } from '../types'

interface SidebarProps {
  activePage: string
  onNavigate: (page: string) => void
  open: boolean
  onClose: () => void
  storageStatus: StorageStatus
  projects: TimetableProject[]
  activeProjectId: string | null
  onProjectChange: (projectId: string) => void
}

const navItems = [
  { id: 'dashboard', label: '總覽', icon: LayoutDashboard },
  { id: 'timetable', label: '我的課表', icon: CalendarDays },
  { id: 'subjects', label: '科目與班級', icon: Shapes },
  { id: 'events', label: '會議與活動', icon: Users },
]

export function Sidebar({ activePage, onNavigate, open, onClose, storageStatus, projects, activeProjectId, onProjectChange }: SidebarProps) {
  const statusLabel = storageStatus === 'saved' ? '已儲存至此裝置'
    : storageStatus === 'conflict' ? '偵測到多分頁衝突'
      : storageStatus === 'read-error' ? '資料讀取失敗，已暫停寫入'
        : '資料寫入失敗'
  return (
    <>
      {open && <button className="sidebar-backdrop" aria-label="關閉選單" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><GraduationCap size={21} /></div>
          <div className="sidebar-brand"><strong>Toki</strong><span lang="ja">とき・時間</span></div>
          <button className="icon-button mobile-only" onClick={onClose} aria-label="關閉選單"><X size={20} /></button>
        </div>
        <label className="project-switcher">課表專案<select value={activeProjectId ?? ''} onChange={(event) => onProjectChange(event.target.value)} disabled={storageStatus === 'read-error'}>{projects.filter((project) => !project.archivedAt).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <nav className="side-nav" aria-label="主要導覽">
          <p className="nav-label">工作空間</p>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={activePage === id ? 'active' : ''} onClick={() => { onNavigate(id); onClose() }}>
              <Icon size={19} strokeWidth={1.8} />{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button disabled={storageStatus === 'read-error'} onClick={() => { onNavigate('settings'); onClose() }}><Settings size={19} />專案設定</button>
          <div className={`storage-status ${storageStatus}`} role="status">
            {storageStatus === 'saved' ? <Check size={13} /> : <AlertCircle size={13} />}
            {statusLabel}
          </div>
          <div className="profile">
            <div className="avatar">T</div>
            <div><strong>{projects.find((project) => project.id === activeProjectId)?.name ?? '課表專案'}</strong><span>個人教師工作空間</span></div>
          </div>
        </div>
      </aside>
    </>
  )
}

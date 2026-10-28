import { AlertCircle, CalendarDays, Check, GraduationCap, LayoutDashboard, LibraryBig, Settings, Shapes, Users, X } from 'lucide-react'
import type { Ref } from 'react'
import type { StorageStatus } from '../hooks/useLocalStorage'
import type { TimetableProject } from '../types'
import { MobileBottomNavigation } from './PreviewShellNavigation'
import { PreviewProjectSwitcher } from './PreviewProjectSwitcher'

interface SidebarProps {
  activePage: string
  onNavigate: (page: string) => void
  open: boolean
  onOpen: () => void
  onClose: () => void
  storageStatus: StorageStatus
  projects: Pick<TimetableProject, 'id' | 'name' | 'archivedAt'>[]
  activeProjectId: string | null
  onProjectChange: (projectId: string) => void
  canManageResources?: boolean
  resourceMode?: 'classes' | 'subjects' | null
  subjectCount: number
  classCount: number
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  subjectManagerButtonRef?: Ref<HTMLButtonElement>
  classManagerButtonRef?: Ref<HTMLButtonElement>
  projectSelectionDisabled?: boolean
  workspaceUnavailableReason?: string
  storageLabel?: string
}

const navItems = [
  { id: 'dashboard', label: '總覽', icon: LayoutDashboard },
  { id: 'timetable', label: '我的課表', icon: CalendarDays },
  { id: 'events', label: '會議與活動', icon: Users },
]

export function Sidebar({ activePage, onNavigate, open, onOpen, onClose, storageStatus, projects, activeProjectId, onProjectChange, canManageResources = Boolean(activeProjectId) && storageStatus === 'saved', resourceMode = null, subjectCount, classCount, collapsed, onCollapsedChange, subjectManagerButtonRef, classManagerButtonRef, projectSelectionDisabled = false, workspaceUnavailableReason, storageLabel }: SidebarProps) {
  const statusLabel = storageLabel ?? (storageStatus === 'saved' ? '已儲存至此裝置'
    : storageStatus === 'conflict' ? '偵測到多分頁衝突'
      : storageStatus === 'read-error' ? '資料讀取失敗，已暫停寫入'
        : '資料寫入失敗')
  return (
    <>
      {open && <button className="sidebar-backdrop" aria-label="關閉選單" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'sidebar-open' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="brand">
          <button type="button" className="brand-toggle" aria-label={collapsed ? '展開側邊欄' : '收合側邊欄'} title={collapsed ? '展開側邊欄' : '收合側邊欄'} aria-expanded={!collapsed} onClick={() => onCollapsedChange(!collapsed)}>
            <span className="brand-mark" role="img" aria-label="Toki 品牌標誌"><GraduationCap size={21} aria-hidden="true" /></span>
            <span className="sidebar-brand"><strong>Toki</strong><span lang="ja">とき・時間</span></span>
          </button>
          <button className="icon-button mobile-only" onClick={onClose} aria-label="關閉選單"><X size={20} /></button>
        </div>
        <div className="project-switcher"><span>課表專案</span>
          <PreviewProjectSwitcher projects={projects.filter((project) => !project.archivedAt)}
            selectedId={activeProjectId} disabled={projectSelectionDisabled || storageStatus === 'read-error'} onSelect={onProjectChange} />
        </div>
        <nav className="side-nav" aria-label="主要導覽">
          <p className="nav-label">工作空間</p>
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} disabled={Boolean(workspaceUnavailableReason)} className={activePage === id && !resourceMode ? 'active' : ''} aria-current={activePage === id && !resourceMode ? 'page' : undefined} aria-label={label} title={workspaceUnavailableReason ?? (collapsed ? label : undefined)} onClick={() => { onNavigate(id); onClose() }}>
              <Icon size={19} strokeWidth={1.8} /><span className="sidebar-item-label">{label}</span>
            </button>
          ))}
          <p className="nav-label">資源</p>
          <button ref={subjectManagerButtonRef} className={resourceMode === 'subjects' ? 'active' : ''} aria-current={resourceMode === 'subjects' ? 'page' : undefined} aria-label={`管理科目，已選 ${subjectCount} 科`} title={collapsed ? `管理科目・已選 ${subjectCount} 科` : undefined} disabled={!canManageResources} onClick={() => { onNavigate('subjects'); onClose() }}>
            <LibraryBig size={19} strokeWidth={1.8} /><span className="sidebar-item-label">管理科目</span><span className="sidebar-count" aria-hidden="true">{subjectCount}</span>
          </button>
          <button ref={classManagerButtonRef} className={resourceMode === 'classes' ? 'active' : ''} aria-current={resourceMode === 'classes' ? 'page' : undefined} aria-label={`管理班級，${classCount} 個有效班級`} title={collapsed ? `管理班級・${classCount} 個有效班級` : undefined} disabled={!canManageResources} onClick={() => { onNavigate('classes'); onClose() }}>
            <Shapes size={19} strokeWidth={1.8} /><span className="sidebar-item-label">管理班級</span><span className="sidebar-count" aria-hidden="true">{classCount}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <button aria-label="專案設定" title={collapsed ? '專案設定' : undefined} disabled={storageStatus === 'read-error'} onClick={() => { onNavigate('settings'); onClose() }}><Settings size={19} /><span className="sidebar-item-label">專案設定</span></button>
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
      <MobileBottomNavigation items={navItems} activePage={resourceMode ? '' : activePage}
        disabledReason={workspaceUnavailableReason} onNavigate={(id) => { onNavigate(id); onClose() }} onMore={onOpen} />
    </>
  )
}

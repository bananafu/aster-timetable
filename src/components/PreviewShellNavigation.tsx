import type { ReactNode } from 'react'
import { GraduationCap, Menu, X, type LucideIcon } from 'lucide-react'

export type PreviewNavItem = { id: string; label: string; icon: LucideIcon }

/** The same mobile destinations accompany both Sidebar variants. */
export function MobileBottomNavigation({ items, activePage, onNavigate, onMore, disabledReason }: {
  items: PreviewNavItem[]
  activePage: string
  onNavigate: (id: string) => void
  onMore: () => void
  disabledReason?: string
}) {
  return <nav className="mobile-bottom-nav" aria-label="手機底部導覽">
    {items.map(({ id, label, icon: Icon }) => <button key={id} type="button"
      disabled={Boolean(disabledReason)} title={disabledReason}
      aria-label={`手機導覽：${label}`} aria-current={activePage === id ? 'page' : undefined}
      data-label={label} onClick={() => onNavigate(id)}>
      <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
    </button>)}
    <button type="button" aria-label="手機導覽：更多" data-label="更多" onClick={onMore}>
      <Menu size={20} strokeWidth={1.8} aria-hidden="true" />
    </button>
  </nav>
}

export function PreviewSidebar({ open, onOpen, onClose, activePage, items, mobileItemIds, onNavigate,
  controls, footer, label, collapsed, onCollapsedChange }: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  activePage: string
  items: PreviewNavItem[]
  mobileItemIds: string[]
  onNavigate: (id: string) => void
  controls: ReactNode
  footer: ReactNode
  label: string
  collapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
}) {
  return <>
    {open && <button className="sidebar-backdrop" aria-label="關閉選單" onClick={onClose} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="brand">
        <button type="button" className="brand-toggle" aria-label={collapsed ? '展開側邊欄' : '收合側邊欄'}
          title={collapsed ? '展開側邊欄' : '收合側邊欄'} aria-expanded={!collapsed}
          onClick={() => onCollapsedChange(!collapsed)}>
          <span className="brand-mark" role="img" aria-label="Toki 品牌標誌"><GraduationCap size={21} aria-hidden="true" /></span>
          <span className="sidebar-brand"><strong>Toki</strong><span lang="ja">とき・時間</span></span>
        </button>
        <button className="icon-button mobile-only" aria-label="關閉選單" onClick={onClose}><X size={20} /></button>
      </div>
      {controls}
      <nav className="side-nav" aria-label={label}>
        <p className="nav-label">工作空間</p>
        {items.map(({ id, label: itemLabel, icon: Icon }) => <button key={id}
          className={activePage === id ? 'active' : ''} aria-current={activePage === id ? 'page' : undefined}
          aria-label={itemLabel} title={collapsed ? itemLabel : undefined}
          onClick={() => onNavigate(id)}>
          <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
          <span className="sidebar-item-label">{itemLabel}</span>
        </button>)}
      </nav>
      <div className="sidebar-bottom">{footer}</div>
    </aside>
    <MobileBottomNavigation items={items.filter((item) => mobileItemIds.includes(item.id))}
      activePage={activePage} onNavigate={onNavigate} onMore={onOpen} />
  </>
}

export function PreviewTopbar({ title, onMenu, onReturn }: {
  title: string
  onMenu: () => void
  onReturn: () => void
}) {
  return <header className="topbar preview-topbar">
    <button className="icon-button menu-button" aria-label="開啟選單" onClick={onMenu}><Menu size={21} /></button>
    <strong className="preview-topbar-title">{title}</strong>
    <div className="topbar-actions"><button className="today-button" onClick={onReturn}>返回 V7</button></div>
  </header>
}

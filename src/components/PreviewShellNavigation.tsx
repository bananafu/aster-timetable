import type { ReactNode } from 'react'
import { GraduationCap, Menu, X, type LucideIcon } from 'lucide-react'

export type PreviewNavItem = { id: string; label: string; icon: LucideIcon }

export function PreviewSidebar({ open, onClose, activePage, items, onNavigate, controls, footer, label }: {
  open: boolean
  onClose: () => void
  activePage: string
  items: PreviewNavItem[]
  onNavigate: (id: string) => void
  controls: ReactNode
  footer: ReactNode
  label: string
}) {
  return <>
    {open && <button className="sidebar-backdrop" aria-label="關閉選單" onClick={onClose} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="brand">
        <span className="brand-mark" role="img" aria-label="Toki 品牌標誌"><GraduationCap size={21} aria-hidden="true" /></span>
        <span className="sidebar-brand"><strong>Toki</strong><span lang="ja">とき・時間</span></span>
        <button className="icon-button mobile-only" aria-label="關閉選單" onClick={onClose}><X size={20} /></button>
      </div>
      {controls}
      <nav className="side-nav" aria-label={label}>
        <p className="nav-label">工作空間</p>
        {items.map(({ id, label: itemLabel, icon: Icon }) => <button key={id}
          className={activePage === id ? 'active' : ''} aria-current={activePage === id ? 'page' : undefined}
          onClick={() => onNavigate(id)}>
          <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
          <span className="sidebar-item-label">{itemLabel}</span>
        </button>)}
      </nav>
      <div className="sidebar-bottom">{footer}</div>
    </aside>
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

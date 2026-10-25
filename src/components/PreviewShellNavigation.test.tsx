// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LayoutDashboard, LibraryBig } from 'lucide-react'
import { PreviewSidebar, PreviewTopbar } from './PreviewShellNavigation'

afterEach(() => cleanup())

describe('V8 preview presentation navigation', () => {
  it('keeps the formal brand, icon navigation, controls and status without V7 data operations', () => {
    const navigate = vi.fn()
    render(<PreviewSidebar open={false} onOpen={vi.fn()} onClose={vi.fn()} activePage="subjects"
      collapsed={false} onCollapsedChange={vi.fn()} mobileItemIds={['overview', 'subjects']}
      items={[{ id: 'overview', label: '總覽', icon: LayoutDashboard },
        { id: 'subjects', label: '科目與班級', icon: LibraryBig }]}
      onNavigate={navigate} label="預覽導覽" controls={<div>目前教師課表</div>}
      footer={<div role="status">唯讀／需處理</div>} />)
    expect(screen.getByRole('img', { name: 'Toki 品牌標誌' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '預覽導覽' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '科目與班級' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('目前教師課表')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('唯讀／需處理')
    fireEvent.click(screen.getByRole('button', { name: '總覽' }))
    expect(navigate).toHaveBeenCalledWith('overview')
  })

  it('offers a dismissible mobile drawer and an explicit return action', () => {
    const close = vi.fn()
    const menu = vi.fn()
    const back = vi.fn()
    render(<><PreviewSidebar open onOpen={menu} onClose={close} activePage="overview"
      collapsed={false} onCollapsedChange={vi.fn()} mobileItemIds={['overview']}
      items={[{ id: 'overview', label: '總覽', icon: LayoutDashboard }]}
      onNavigate={vi.fn()} label="預覽導覽" controls={null} footer={null} />
      <PreviewTopbar title="V8 開發預覽" onMenu={menu} onReturn={back} /></>)
    expect(document.querySelector('.sidebar-open')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '開啟選單' }))
    expect(menu).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '返回 V7' }))
    expect(back).toHaveBeenCalledOnce()
    fireEvent.click(screen.getAllByRole('button', { name: '關閉選單' })[0])
    expect(close).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '手機導覽：更多' }))
    expect(menu).toHaveBeenCalledTimes(2)
  })

  it('uses the logo for collapse and keeps mobile destinations tied to the same navigation callbacks', () => {
    const collapse = vi.fn()
    const navigate = vi.fn()
    render(<PreviewSidebar open={false} onOpen={vi.fn()} onClose={vi.fn()} activePage="overview"
      collapsed onCollapsedChange={collapse} mobileItemIds={['overview', 'subjects']}
      items={[{ id: 'overview', label: '總覽', icon: LayoutDashboard },
        { id: 'subjects', label: '科目與班級', icon: LibraryBig }]}
      onNavigate={navigate} label="預覽導覽" controls={null} footer={null} />)
    expect(document.querySelector('.sidebar-collapsed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展開側邊欄' }))
    expect(collapse).toHaveBeenCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: '手機導覽：科目與班級' }))
    expect(navigate).toHaveBeenCalledWith('subjects')
  })
})

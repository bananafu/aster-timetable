import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'

type ProjectOption = { id: string; name: string }

/** Shared presentation; each host owns its Project transition and persistence rules. */
export function PreviewProjectSwitcher({ projects, selectedId, disabled, onSelect }: {
  projects: ProjectOption[]; selectedId: string | null; disabled: boolean; onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const options = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(0, projects.findIndex((item) => item.id === selectedId))
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => options.current[selectedIndex]?.focus())
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open, selectedIndex])
  const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !projects.length) return
    event.preventDefault()
    const current = options.current.findIndex((item) => item === document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? projects.length - 1
      : event.key === 'ArrowDown' ? (current + 1 + projects.length) % projects.length
        : (current - 1 + projects.length) % projects.length
    options.current[next]?.focus()
  }
  const selected = projects.find((item) => item.id === selectedId)
  return <div className="timetable-switcher preview-project-switcher" ref={root}>
    <button ref={trigger} type="button" aria-label="切換專案" aria-haspopup="menu" aria-expanded={open}
      disabled={disabled || projects.length === 0} onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
      }}>
      <span>{selected?.name ?? '尚未選擇專案'}</span><ChevronDown size={14} />
    </button>
    {open && <div className="timetable-switcher-popover" role="menu" aria-label="選擇課表專案" onKeyDown={moveFocus}>
      {projects.map((item, index) => <button ref={(element) => { options.current[index] = element }}
        type="button" role="menuitemradio" data-project-id={item.id} aria-checked={item.id === selectedId}
        key={item.id} onClick={() => { setOpen(false); if (item.id !== selectedId) onSelect(item.id); trigger.current?.focus() }}>
        <span><strong>{item.name}</strong><small>{item.id === selectedId ? '目前專案' : '切換至此專案'}</small></span>
        {item.id === selectedId && <Check size={16} />}
      </button>)}
    </div>}
  </div>
}

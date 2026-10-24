import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

type ProjectOption = { id: string; name: string }

/** The formal timetable switcher presentation, without a V7 data dispatcher. */
export function PreviewProjectSwitcher({ projects, selectedId, disabled, onSelect }: {
  projects: ProjectOption[]; selectedId: string | null; disabled: boolean; onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const selected = projects.find((item) => item.id === selectedId)
  return <div className="timetable-switcher preview-project-switcher" ref={root}>
    <button type="button" aria-label="切換專案" aria-haspopup="menu" aria-expanded={open}
      disabled={disabled || projects.length === 0} onClick={() => setOpen((value) => !value)}>
      <span>{selected?.name ?? '尚未選擇專案'}</span><ChevronDown size={14} />
    </button>
    {open && <div className="timetable-switcher-popover" role="menu" aria-label="選擇課表專案">
      {projects.map((item) => <button type="button" role="menuitemradio" aria-checked={item.id === selectedId}
        key={item.id} onClick={() => { setOpen(false); if (item.id !== selectedId) onSelect(item.id) }}>
        <span><strong>{item.name}</strong><small>{item.id === selectedId ? '目前專案' : '切換至此專案'}</small></span>
        {item.id === selectedId && <Check size={16} />}
      </button>)}
    </div>}
  </div>
}

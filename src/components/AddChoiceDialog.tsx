import { useEffect, useRef } from 'react'
import { BookOpenCheck, CalendarPlus } from 'lucide-react'
import { Modal } from './Modal'

export type AddChoiceFocus = 'lesson' | 'one-off' | null

export function AddChoiceDialog({ initialFocus, canAddLesson, addLessonReason, canAddOneOff,
  addOneOffReason, onAddLesson, onAddOneOff, onClose }: {
  initialFocus: AddChoiceFocus
  canAddLesson: boolean
  addLessonReason: string
  canAddOneOff: boolean
  addOneOffReason: string
  onAddLesson: () => void
  onAddOneOff: () => void
  onClose: () => void
}) {
  const lessonButton = useRef<HTMLButtonElement>(null)
  const oneOffButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const requested = initialFocus === 'lesson' ? lessonButton.current
      : initialFocus === 'one-off' ? oneOffButton.current : null
    const fallback = canAddLesson ? lessonButton.current : canAddOneOff ? oneOffButton.current
      : lessonButton.current?.closest('[role="dialog"]')?.querySelector<HTMLButtonElement>('header button') ?? null
    ;(requested && !requested.disabled ? requested : fallback)?.focus()
  }, [canAddLesson, canAddOneOff, initialFocus])
  return <Modal title="新增課程" subtitle="選擇要加入目前教師課表的課程。" onClose={onClose}>
    <div className="add-choice-dialog">
      <nav className="settings-menu" aria-label="新增項目">
        <section className="add-choice-group" aria-labelledby="add-course-group">
          <p id="add-course-group" className="add-choice-group-title">課程</p>
          <button ref={lessonButton} type="button" className="settings-menu-item" onClick={onAddLesson}
            disabled={!canAddLesson}><BookOpenCheck aria-hidden="true" /><span><strong>新增固定課程</strong>
              <small>{canAddLesson ? '使用目前的專案與教師課表。' : addLessonReason}</small></span></button>
          <button ref={oneOffButton} type="button" className="settings-menu-item" onClick={onAddOneOff}
            disabled={!canAddOneOff}><CalendarPlus aria-hidden="true" /><span><strong>新增單日課程</strong>
              <small>{canAddOneOff ? '只在指定日期加入目前教師課表。' : addOneOffReason}</small></span></button>
        </section>
      </nav>
    </div>
  </Modal>
}

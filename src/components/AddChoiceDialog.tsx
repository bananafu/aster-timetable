import { useEffect, useRef } from 'react'
import { BookOpenCheck, CalendarPlus, LibraryBig, Shapes } from 'lucide-react'
import { Modal } from './Modal'

export type AddChoiceFocus = 'lesson' | 'one-off' | 'subjects' | 'classes' | null

export function AddChoiceDialog({ initialFocus, canAddLesson, addLessonReason, canAddOneOff,
  addOneOffReason, canManageSubjects, manageSubjectsReason, canManageClasses,
  manageClassesReason, onAddLesson, onAddOneOff, onManage, onClose }: {
  initialFocus: AddChoiceFocus
  canAddLesson: boolean
  addLessonReason: string
  canAddOneOff: boolean
  addOneOffReason: string
  canManageSubjects: boolean
  manageSubjectsReason: string
  canManageClasses: boolean
  manageClassesReason: string
  onAddLesson: () => void
  onAddOneOff: () => void
  onManage: (mode: 'subjects' | 'classes') => void
  onClose: () => void
}) {
  const lessonButton = useRef<HTMLButtonElement>(null)
  const oneOffButton = useRef<HTMLButtonElement>(null)
  const subjectButton = useRef<HTMLButtonElement>(null)
  const classButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const requested = initialFocus === 'lesson' ? lessonButton.current
      : initialFocus === 'one-off' ? oneOffButton.current
        : initialFocus === 'subjects' ? subjectButton.current
          : initialFocus === 'classes' ? classButton.current : null
    const fallback = canAddLesson ? lessonButton.current : canAddOneOff ? oneOffButton.current
      : canManageSubjects ? subjectButton.current : canManageClasses ? classButton.current
        : lessonButton.current?.closest('[role="dialog"]')?.querySelector<HTMLButtonElement>('header button') ?? null
    ;(requested && !requested.disabled ? requested : fallback)?.focus()
  }, [canAddLesson, canAddOneOff, canManageClasses, canManageSubjects, initialFocus])
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
        <hr className="add-choice-divider" aria-hidden="true" />
        <section className="add-choice-group" aria-labelledby="add-resource-group">
          <p id="add-resource-group" className="add-choice-group-title">基礎資料</p>
          <button ref={subjectButton} data-add-choice-manage="subjects" type="button"
            className="settings-menu-item" onClick={() => onManage('subjects')}
            disabled={!canManageSubjects}><LibraryBig aria-hidden="true" /><span><strong>管理科目</strong>
              <small>{canManageSubjects ? '管理目前可使用的科目。' : manageSubjectsReason}</small></span></button>
          <button ref={classButton} data-add-choice-manage="classes" type="button"
            className="settings-menu-item" onClick={() => onManage('classes')}
            disabled={!canManageClasses}><Shapes aria-hidden="true" /><span><strong>管理班級</strong>
              <small>{canManageClasses ? '管理目前專案的班級。' : manageClassesReason}</small></span></button>
        </section>
      </nav>
    </div>
  </Modal>
}

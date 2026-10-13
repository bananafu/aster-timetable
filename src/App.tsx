import { Fragment, useCallback, useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { CalendarClock, CalendarDays, Clock3, MapPin, Plus } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { ScheduleGrid } from './components/ScheduleGrid'
import { TimeCalendar } from './components/TimeCalendar'
import { Modal } from './components/Modal'
import { AcademicSettingsV4 } from './components/AcademicSettingsV4'
import { MultiSchoolSchedule } from './components/MultiSchoolSchedule'
import { createProject, mergeProjectView, projectToLegacyView, renameProject, switchActiveProject } from './data/projectRuntime'
import { useAppDataV4 } from './hooks/useAppDataV4'
import { useLocalStorage, type StorageControls, type StorageStatus } from './hooks/useLocalStorage'
import { addDays, getWeekInfo, startOfWeek, toDateKey } from './lib/date'
import { findCourseConflict, getNextUpcomingEvent, getTodayTeachingSummary, resolveSlot } from './lib/schedule'
import { classifyEventTerm, getActiveTerm, getTermForDate, isTermEditable } from './lib/academic'
import type { TodayTeachingSummary } from './lib/schedule'
import type { AppData, AppDataV4, CalendarEvent, DayOfWeek, ModalKind, ScheduleDensity, SemesterKind, ViewMode, WeekPattern } from './types'

const DENSITY_KEY = 'aster-timetable-density-v1'
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

interface SelectedSlot { date: Date; periodId: number }

function downloadRawData(raw: string) {
  const blob = new Blob([raw], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `aster-timetable-recovery-${toDateKey(new Date())}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [appData, setAppData, storageStatus, storageControls] = useAppDataV4()
  const data = useMemo(() => projectToLegacyView(appData), [appData])
  const setData = useCallback<Dispatch<SetStateAction<AppData>>>((update) => {
    setAppData((current) => {
      if (!current.activeProjectId) return current
      const view = projectToLegacyView(current)
      const next = typeof update === 'function' ? update(view) : update
      return mergeProjectView(current, current.activeProjectId, next)
    })
  }, [setAppData])
  const [density, setDensity] = useLocalStorage<ScheduleDensity>(DENSITY_KEY, 'comfortable')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [viewMode, setViewMode] = useState<ViewMode>('period')
  const [activePage, setActivePage] = useState('dashboard')
  const [modal, setModal] = useState<ModalKind>(null)
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [operationError, setOperationError] = useState('')
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const activeTerm = getActiveTerm(data)
  const activeProject = appData.projects.find((project) => project.id === appData.activeProjectId)
  const weekTerms = weekDays.map((date) => getTermForDate(data, date)).filter((term, index, terms) => term && terms.findIndex((item) => item?.id === term.id) === index)
  const displayedTerm = weekTerms.length === 1 ? weekTerms[0] : undefined
  const weekInfo = displayedTerm ? getWeekInfo(weekDays.find((date) => getTermForDate(data, date)?.id === displayedTerm.id) ?? weekStart, displayedTerm) : null
  const weekTermLabel = weekTerms.length > 1 ? weekTerms.map((term) => term?.name).join(' ／ ') : displayedTerm?.name ?? '目前日期不屬於任何學期'
  const isMixedWeek = weekTerms.length > 1 || weekDays.some((date) => !getTermForDate(data, date))
  const todaySummary = getTodayTeachingSummary(data, now)
  const upcomingEvent = getNextUpcomingEvent(data.events, now)

  const switchProject = (projectId: string) => {
    const project = appData.projects.find((item) => item.id === projectId && !item.archivedAt)
    if (!project) return
    setAppData((current) => switchActiveProject(current, projectId))
    setSelectedSlot(null)
    setModal(null)
  }

  const openSlotModal = (kind: ModalKind, date?: Date, periodId?: number) => {
    setOperationError('')
    setSelectedSlot(date && periodId ? { date, periodId } : null)
    setModal(kind)
  }

  const handleAddEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setData((current) => {
      const date = String(form.get('date'))
      return ({
      ...current, events: [...current.events, {
        id: uid(), title: String(form.get('title')), type: String(form.get('type')) as 'meeting' | 'activity' | 'task',
        termId: classifyEventTerm({ date }, current.academicTerms), date, startTime: String(form.get('startTime')), endTime: String(form.get('endTime')),
        location: String(form.get('location') || ''), color: '#A66D52', origin: 'user',
      }],
    })})
    setModal(null)
  }

  const handleAddCourse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const term = selectedSlot ? getTermForDate(data, selectedSlot.date) : activeTerm
    if (!term || !isTermEditable(term)) { setOperationError('此日期沒有可編輯的學期，或該學期已封存。'); return }
    const course = {
      id: uid(), termId: term.id, subjectId: String(form.get('subjectId')), classId: String(form.get('classId')),
      day: Number(form.get('day')) as DayOfWeek, periodId: Number(form.get('periodId')),
      weekPattern: String(form.get('weekPattern')) as WeekPattern, room: String(form.get('room') || ''), origin: 'user' as const,
    }
    if (findCourseConflict(data.courses, course)) {
      setOperationError('此星期、節次與輪週已有重疊的固定課程。A 週與 B 週可共用時段，但每週課程不可與其重疊。')
      return
    }
    setData((current) => ({ ...current, courses: [...current.courses, course] }))
    setModal(null)
  }

  const handleCourseEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedSlot) return
    const form = new FormData(event.currentTarget)
    const mode = String(form.get('mode')) as 'semester' | 'date' | 'cancel'
    const original = resolveSlot(data, selectedSlot.date, selectedSlot.periodId).course
    if (!original) return
    const term = data.academicTerms.find((item) => item.id === original.termId)
    if (!isTermEditable(term)) { setOperationError('封存學期僅供查看，請先取消封存後再編輯。'); return }
    if (mode === 'semester') {
      const candidate = { termId: original.termId, day: original.day, periodId: original.periodId, weekPattern: String(form.get('weekPattern')) as WeekPattern }
      if (findCourseConflict(data.courses, candidate, original.id)) {
        setOperationError('修改後會與同時段的固定課程重疊，請調整輪週設定。')
        return
      }
      setData((current) => ({ ...current, courses: current.courses.map((course) => course.id === original.id ? {
        ...course,
        subjectId: String(form.get('subjectId')),
        classId: String(form.get('classId')),
        room: String(form.get('room') || ''),
        weekPattern: String(form.get('weekPattern')) as WeekPattern,
        origin: 'user',
      } : course) }))
      setModal(null)
      return
    }
    const action = mode === 'cancel' ? 'cancel' as const : 'replace' as const
    const next = {
      id: uid(), termId: original.termId, date: toDateKey(selectedSlot.date), periodId: selectedSlot.periodId, action,
      originalCourseId: original?.id, note: String(form.get('note') || ''),
      replacement: action === 'replace' ? { subjectId: String(form.get('subjectId')), classId: String(form.get('classId')), room: String(form.get('room') || '') } : undefined,
      origin: 'user' as const,
    }
    setData((current) => ({ ...current, overrides: [...current.overrides.filter((item) => !(item.termId === next.termId && item.date === next.date && item.periodId === next.periodId)), next] }))
    setModal(null)
  }

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={(page) => { setActivePage(page); if (page === 'settings') setModal('settings') }} open={sidebarOpen} onClose={() => setSidebarOpen(false)} storageStatus={storageStatus} projects={appData.projects} activeProjectId={appData.activeProjectId} onProjectChange={switchProject} />
      <main className="main-area">
        {storageStatus !== 'read-error' && <Topbar weekStart={weekStart} onWeekChange={(days) => setWeekStart(addDays(weekStart, days))} onToday={() => setWeekStart(startOfWeek(new Date()))} onAdd={() => setModal('event')} onMenu={() => setSidebarOpen(true)} />}
        {storageStatus !== 'saved' && <StorageSafetyNotice status={storageStatus} controls={storageControls} />}
        {storageStatus === 'read-error' ? <section className="content"><div className="panel blocked-editor"><h1>資料尚未載入</h1><p>為避免在不完整資料上編輯，目前已鎖定課表。請先匯出原始 JSON，或經二次確認後重設。</p></div></section> : <>
        <div className="content">
          {appData.migrationWarnings.length > 0 && <section className="migration-summary" role="status"><strong>有 {appData.migrationWarnings.length} 筆資料需要確認</strong><span>未歸屬資料已保留，且不會自動套用至課表。</span></section>}
          <section className="page-heading">
            <div><p className="eyebrow">{activePage === 'timetable' ? activeProject?.name : weekTermLabel}</p><h1>{activePage === 'dashboard' ? '總覽' : activePage === 'timetable' ? '我的課表' : activePage === 'subjects' ? '科目與班級' : '會議與活動'}</h1>{activePage !== 'dashboard' && <p>所有資料都會自動儲存在這台裝置。</p>}</div>
            <div className="week-pill">{activePage === 'timetable' ? <><span>多校檢視</span><strong>實際時間</strong></> : <><span>{isMixedWeek ? '跨學期週' : weekInfo ? `第 ${weekInfo.number} 週` : '學期外'}</span><strong>{isMixedWeek ? '逐日' : weekInfo?.pattern ? `${weekInfo.pattern} 週` : '—'}</strong></>}</div>
          </section>

          {activePage === 'dashboard' && <DashboardCards summary={todaySummary} event={upcomingEvent} />}

          {activePage === 'subjects' ? (
            <SubjectPanel data={data} setData={setData} />
          ) : activePage === 'events' ? (
            <EventsPanel data={data} setData={setData} onAdd={() => setModal('event')} />
          ) : (
            <section className="panel timetable-panel">
              <div className="panel-heading">
                <div><h2>{activePage === 'dashboard' ? '本週課表' : '跨校週課表'}</h2><p>{activePage === 'dashboard' ? '點選課程可建立單日調課，空白節次可快速新增。' : '依各任教單位的實際節次與輪週設定逐日整合。'}</p></div>
                {activePage === 'dashboard' && <div className="schedule-controls">
                  <div className="view-switch" role="group" aria-label="課表密度">
                    <button className={density === 'comfortable' ? 'active' : ''} onClick={() => setDensity('comfortable')}>舒適</button>
                    <button className={density === 'compact' ? 'active' : ''} onClick={() => setDensity('compact')}>緊湊</button>
                  </div>
                  <div className="view-switch" role="group" aria-label="課表顯示方式">
                    <button className={viewMode === 'period' ? 'active' : ''} onClick={() => setViewMode('period')}>節次</button>
                    <button className={viewMode === 'time' ? 'active' : ''} onClick={() => setViewMode('time')}>時間</button>
                  </div>
                </div>}
              </div>
              {weekTerms.some((term) => term?.archivedAt) && <p className="form-error">週內包含封存學期；封存日期為唯讀模式。</p>}
              {activePage === 'timetable'
                ? <MultiSchoolSchedule data={appData} weekDays={weekDays} />
                : <>{viewMode === 'period' ? <ScheduleGrid data={data} weekDays={weekDays} mode={viewMode} density={density} onEmptyClick={(date, periodId) => { const term=getTermForDate(data,date); if (term && !term.archivedAt) openSlotModal('course', date, periodId) }} onCourseClick={(date, periodId) => { const term=getTermForDate(data,date); if (term && !term.archivedAt) openSlotModal('editCourse', date, periodId) }} /> : <TimeCalendar data={data} weekDays={weekDays} onCourseClick={(date, periodId) => { const term=getTermForDate(data,date); if (term && !term.archivedAt) openSlotModal('editCourse', date, periodId) }} />}<div className="legend"><span><i className="legend-a" />A 週課程</span><span><i className="legend-b" />B 週課程</span><span><i className="legend-change" />單日調課不影響固定課表</span></div></>}
            </section>
          )}
        </div>
        </>}
      </main>

      {storageStatus !== 'read-error' && <>{modal === 'event' && <EventForm onSubmit={handleAddEvent} onClose={() => setModal(null)} defaultDate={selectedSlot ? toDateKey(selectedSlot.date) : toDateKey(new Date())} />}
      {modal === 'course' && <CourseForm data={data} slot={selectedSlot} error={operationError} onSubmit={handleAddCourse} onClose={() => setModal(null)} onEvent={() => setModal('event')} />}
      {modal === 'editCourse' && selectedSlot && <EditCourseForm data={data} slot={selectedSlot} error={operationError} onSubmit={handleCourseEdit} onClose={() => setModal(null)} onRemove={() => { if (!window.confirm('確定移除此單日異動？此操作無法復原。')) return; setData((current) => ({ ...current, overrides: current.overrides.filter((item) => !(item.date === toDateKey(selectedSlot.date) && item.periodId === selectedSlot.periodId)) })); setModal(null) }} />}
      {modal === 'settings' && <ProjectForm data={appData} setData={setAppData} onClose={() => setModal(null)} />}</>}
    </div>
  )
}

function StorageSafetyNotice({ status, controls }: { status: StorageStatus; controls: StorageControls }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const isConflict = status === 'conflict'
  const message = status === 'read-error'
    ? '無法讀取已儲存的資料。原始內容仍保留，系統已暫停寫入。'
    : status === 'write-error'
      ? '資料寫入失敗。請先匯出備份，再檢查瀏覽器儲存空間。'
      : '其他分頁已更新資料，本分頁仍有尚未寫入的變更。已暫停自動儲存以避免覆寫。'

  return <section className="storage-notice" role="alert">
    <div><strong>{isConflict ? '偵測到多分頁資料衝突' : '資料儲存需要處理'}</strong><p>{message}</p></div>
    <div className="storage-notice-actions">
      {controls.rawBackup !== null && <button type="button" onClick={() => downloadRawData(controls.rawBackup!)}>匯出原始 JSON</button>}
      {isConflict ? <><button type="button" onClick={controls.acceptExternal}>採用其他分頁版本</button><button type="button" className="danger-outline" onClick={controls.keepLocal}>保留本分頁版本</button></> : !confirmReset ? <button type="button" className="danger-outline" onClick={() => setConfirmReset(true)}>重設資料</button> : <div className="reset-confirm"><span>確定重設？原始資料將被取代。</span><button type="button" onClick={() => setConfirmReset(false)}>取消</button><button type="button" className="danger-outline" onClick={() => { controls.reset(); setConfirmReset(false) }}>再次確認重設</button></div>}
    </div>
  </section>
}

function DashboardCards({ summary, event }: { summary: TodayTeachingSummary; event?: CalendarEvent }) {
  const lessonLabel = summary.state === 'current' ? '目前課程' : summary.state === 'next' ? '下一節課' : '下一節課'
  const lessonEmpty = summary.state === 'finished' ? '今日課程已結束' : summary.state === 'outside-semester' ? '目前不在學期期間' : '今日無排定課程'
  return <section className="dashboard-cards">
    <article className="summary-card">
      <div className="summary-icon"><CalendarDays size={18} /></div>
      <div><span>今日課程</span><strong>{summary.count}<small> 節</small></strong><p>{summary.state === 'outside-semester' ? '不在學期範圍內' : '已納入調課與取消'}</p></div>
    </article>
    <article className="summary-card lesson-card">
      <div className="summary-icon"><Clock3 size={18} /></div>
      <div><span>{lessonLabel}</span>{summary.slot ? <><strong>{summary.slot.subjectName}<small>・{summary.slot.className}</small></strong><p><b>{summary.slot.period.startTime}</b><i><MapPin size={11} />{summary.slot.displayRoom}</i></p></> : <strong className="empty-summary">{lessonEmpty}</strong>}</div>
    </article>
    <article className="summary-card meeting-card">
      <div className="summary-icon"><CalendarClock size={18} /></div>
      <div><span>近期會議</span>{event ? <><strong>{event.title}</strong><p><b>{event.date}</b><i>{event.startTime}{event.location ? `・${event.location}` : ''}</i></p></> : <strong className="empty-summary">目前沒有即將到來的會議</strong>}</div>
    </article>
  </section>
}

function EventForm({ onSubmit, onClose, defaultDate }: { onSubmit: (e: FormEvent<HTMLFormElement>) => void; onClose: () => void; defaultDate: string }) {
  return <Modal title="新增會議或活動" subtitle="建立一次性行程，不會影響固定課表。" onClose={onClose}><form onSubmit={onSubmit} className="form-grid">
    <label className="full">名稱<input name="title" placeholder="例如：導師會議" required autoFocus /></label>
    <label>類型<select name="type"><option value="meeting">會議</option><option value="activity">活動</option><option value="task">待辦</option></select></label>
    <label>日期<input name="date" type="date" defaultValue={defaultDate} required /></label>
    <label>開始時間<input name="startTime" type="time" defaultValue="12:20" required /></label>
    <label>結束時間<input name="endTime" type="time" defaultValue="13:00" required /></label>
    <label className="full">地點<input name="location" placeholder="選填" /></label><FormActions onClose={onClose} />
  </form></Modal>
}

function CourseForm({ data, slot, error, onSubmit, onClose, onEvent }: { data: AppData; slot: SelectedSlot | null; error: string; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onClose: () => void; onEvent: () => void }) {
  const term = slot ? getTermForDate(data, slot.date) : getActiveTerm(data)
  const periods = [...(term?.periods ?? [])].sort((a,b) => a.order-b.order)
  return <Modal title="新增固定課程" subtitle="課程會依輪週規則出現在每週課表。" onClose={onClose}><form onSubmit={onSubmit} className="form-grid">
    <label>科目<select name="subjectId">{data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>班級<select name="classId">{data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>星期<select name="day" defaultValue={slot?.date.getDay()}>{[1,2,3,4,5].map((d) => <option key={d} value={d}>週{'一二三四五'[d-1]}</option>)}</select></label>
    <label>節次<select name="periodId" defaultValue={slot?.periodId}>{periods.map((p) => <option key={p.id} value={p.id}>{p.label}（{p.startTime}）</option>)}</select></label>
    <label>輪週<select name="weekPattern"><option value="every">每週</option><option value="A">只在 A 週</option><option value="B">只在 B 週</option></select></label>
    <label>教室<input name="room" placeholder="依班級預設" /></label>
    {error && <p className="form-error full" role="alert">{error}</p>}
    <button type="button" className="text-button full" onClick={onEvent}><Clock3 size={15} />改為新增單次活動</button><FormActions onClose={onClose} />
  </form></Modal>
}

function EditCourseForm({ data, slot, error, onSubmit, onClose, onRemove }: { data: AppData; slot: SelectedSlot; error: string; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onClose: () => void; onRemove: () => void }) {
  const resolved = resolveSlot(data, slot.date, slot.periodId)
  const course = resolved.course
  const existing = data.overrides.find((o) => o.termId === course?.termId && o.date === toDateKey(slot.date) && o.periodId === slot.periodId)
  const [mode, setMode] = useState<'semester' | 'date' | 'cancel'>(existing?.action === 'cancel' ? 'cancel' : existing ? 'date' : 'semester')
  if (!course) return null
  return <Modal title="編輯課程" subtitle={`${toDateKey(slot.date)}・第 ${slot.periodId} 節。單日異動不會覆蓋固定課程。`} onClose={onClose}><form onSubmit={onSubmit} className="form-grid">
    <fieldset className="operation-picker full"><legend>套用範圍</legend>
      <label><input type="radio" name="mode" value="semester" checked={mode === 'semester'} onChange={() => setMode('semester')} /><span><strong>整學期固定課程</strong><small>修改每週重複的原始課程</small></span></label>
      <label><input type="radio" name="mode" value="date" checked={mode === 'date'} onChange={() => setMode('date')} /><span><strong>僅修改指定日期</strong><small>建立一次性調課，保留原始課程</small></span></label>
      <label><input type="radio" name="mode" value="cancel" checked={mode === 'cancel'} onChange={() => setMode('cancel')} /><span><strong>僅取消指定日期</strong><small>其他日期仍照常上課</small></span></label>
    </fieldset>
    {mode !== 'cancel' && <Fragment key={mode}>
      <label>科目<select name="subjectId" defaultValue={mode === 'date' ? existing?.replacement?.subjectId || course.subjectId : course.subjectId}>{data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>班級<select name="classId" defaultValue={mode === 'date' ? existing?.replacement?.classId || course.classId : course.classId}>{data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>輪週<select name="weekPattern" defaultValue={course.weekPattern} disabled={mode === 'date'}><option value="every">每週</option><option value="A">只在 A 週</option><option value="B">只在 B 週</option></select></label>
      <label>教室<input name="room" defaultValue={mode === 'date' ? existing?.replacement?.room || course.room : course.room} placeholder="依班級預設" /></label>
    </Fragment>}
    <label className="full">備註<input name="note" defaultValue={existing?.note} placeholder="例如：與王老師互調" /></label>
    {error && <p className="form-error full" role="alert">{error}</p>}
    {existing && <button type="button" className="danger-button" onClick={onRemove}>移除此異動</button>}<FormActions onClose={onClose} />
  </form></Modal>
}

function ProjectForm({ data, setData, onClose }: { data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>; onClose: () => void }) {
  const active = data.projects.find((item) => item.id === data.activeProjectId)!
  const [name, setName] = useState(active.name)
  const [error, setError] = useState('')
  const today = toDateKey(new Date())
  const [draft, setDraft] = useState({ name: '', academicYear: Math.max(1, new Date().getFullYear() - 1911), semester: 'first' as SemesterKind, customLabel: '', startDate: today, endDate: toDateKey(addDays(new Date(), 120)) })
  useEffect(() => setName(active.name), [active])

  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName) { setError('專案名稱不得為空白。'); return }
    setData((current) => renameProject(current, active.id, nextName))
    setError('')
  }
  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft.name.trim()) { setError('新專案名稱不得為空白。'); return }
    if (!Number.isInteger(draft.academicYear) || draft.academicYear <= 0 || draft.startDate > draft.endDate || (draft.semester === 'custom' && !draft.customLabel.trim())) { setError('請確認學年度、學期名稱與日期範圍。'); return }
    try {
      setData(createProject(data, draft, uid))
    } catch {
      setError('目前專案缺少可沿用的學校或節次設定。')
      return
    }
    onClose()
  }

  return <Modal title="課表專案" subtitle="Toki 是 App 品牌；每份課表都可以使用自己的名稱。" onClose={onClose}>
    <div className="project-settings">
      <form onSubmit={rename} className="form-grid compact-form">
        <label className="full">目前專案名稱<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <div className="form-actions full"><button type="button" onClick={onClose}>關閉</button><button type="submit" className="primary-button">重新命名</button></div>
      </form>
      <form onSubmit={create} className="form-grid project-create-form">
        <div className="full"><strong>建立新課表專案</strong><p>新專案會沿用目前節次設定，但不會複製課程、班級、事件或異動。</p></div>
        <label className="full">專案名稱<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：高二教學課表" required /></label>
        <label>學年度<input type="number" min="1" value={draft.academicYear} onChange={(event) => setDraft({ ...draft, academicYear: Number(event.target.value) })} required /></label>
        <label>學期<select value={draft.semester} onChange={(event) => setDraft({ ...draft, semester: event.target.value as SemesterKind })}><option value="first">第一學期</option><option value="second">第二學期</option><option value="summer">暑期</option><option value="custom">其他</option></select></label>
        {draft.semester === 'custom' && <label className="full">自訂學期名稱<input value={draft.customLabel} onChange={(event) => setDraft({ ...draft, customLabel: event.target.value })} required /></label>}
        <label>起始日<input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} required /></label>
        <label>結束日<input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} required /></label>
        <div className="form-actions full"><button type="submit" className="primary-button">建立並切換</button></div>
      </form>
      <AcademicSettingsV4 data={data} setData={setData} />
      {data.migrationWarnings.length > 0 && <section className="migration-warning-list"><strong>資料遷移警告</strong><p>以下資料仍完整保留，不會自動套用或刪除。</p>{data.migrationWarnings.map((warning) => <div className="warning-row" key={warning.id}><div><strong>{warning.entityType === 'override' ? '未歸屬的單日異動' : '待確認資料'}</strong><p>紀錄 ID {warning.entityId}</p><p>{warning.message}</p></div></div>)}</section>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </Modal>
}

function FormActions({ onClose }: { onClose: () => void }) { return <div className="form-actions full"><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary-button">儲存</button></div> }

function SubjectPanel({ data, setData }: { data: AppData; setData: Dispatch<SetStateAction<AppData>> }) {
  return <div className="manage-grid"><section className="panel manage-panel"><div className="panel-heading"><div><h2>科目</h2><p>以顏色快速辨識課程。</p></div></div>{data.subjects.map((s) => <div className="manage-row" key={s.id}><i style={{ background: s.color }} /><div><strong>{s.name}</strong><span>{data.courses.filter((c) => c.subjectId === s.id).length} 門課</span></div><input aria-label={`${s.name} 顏色`} type="color" value={s.color} onChange={(e) => setData((current) => ({ ...current, subjects: current.subjects.map((item) => item.id === s.id ? { ...item, color: e.target.value, origin: 'user' } : item) }))} /></div>)}</section>
    <section className="panel manage-panel"><div className="panel-heading"><div><h2>班級</h2><p>班級與預設教室分開管理。</p></div></div>{data.classes.map((c) => <div className="manage-row" key={c.id}><div className="class-avatar">{c.name.slice(-2,-1)}</div><div><strong>{c.name}</strong><span>{c.room || '未設定教室'}</span></div></div>)}</section></div>
}

function EventsPanel({ data, setData, onAdd }: { data: AppData; setData: Dispatch<SetStateAction<AppData>>; onAdd: () => void }) {
  const events = [...data.events].sort((a,b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
  return <section className="panel events-panel"><div className="panel-heading"><div><h2>會議與活動</h2><p>一次性行程獨立於固定課表。</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} />新增活動</button></div>{events.map((e) => <div className="event-row" key={e.id}><div className="event-date"><strong>{e.date.slice(5).replace('-', '/')}</strong><span>{e.startTime}</span></div><i style={{ background: e.color }} /><div><strong>{e.title}</strong><span>{e.location || '未設定地點'}・{e.startTime}–{e.endTime}</span></div><button onClick={() => { if (window.confirm(`確定刪除「${e.title}」？此操作無法復原。`)) setData((current) => ({ ...current, events: current.events.filter((item) => item.id !== e.id) })) }}>刪除</button></div>)}</section>
}

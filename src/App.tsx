import { Fragment, useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { CalendarClock, CalendarDays, Clock3, MapPin, Plus } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { ScheduleGrid } from './components/ScheduleGrid'
import { TimeCalendar } from './components/TimeCalendar'
import { Modal } from './components/Modal'
import { initialData } from './data/seed'
import { clearDemoRecords, countDemoRecords, isAppData, migrateAppData } from './data/migrations'
import { useLocalStorage, type StorageControls, type StorageStatus } from './hooks/useLocalStorage'
import { addDays, getWeekInfo, startOfWeek, toDateKey } from './lib/date'
import { findCourseConflict, getNextUpcomingEvent, getTodayTeachingSummary, resolveSlot } from './lib/schedule'
import type { TodayTeachingSummary } from './lib/schedule'
import type { AppData, CalendarEvent, DayOfWeek, ModalKind, ScheduleDensity, ViewMode, WeekPattern } from './types'

const STORAGE_KEY = 'aster-timetable-data-v1'
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
  const [data, setData, storageStatus, storageControls] = useLocalStorage<AppData>(STORAGE_KEY, initialData, { migrate: migrateAppData, validate: isAppData })
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
  const weekInfo = getWeekInfo(weekStart, data.semester)
  const todaySummary = getTodayTeachingSummary(data, now)
  const upcomingEvent = getNextUpcomingEvent(data.events, now)

  const openSlotModal = (kind: ModalKind, date?: Date, periodId?: number) => {
    setOperationError('')
    setSelectedSlot(date && periodId ? { date, periodId } : null)
    setModal(kind)
  }

  const handleAddEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setData((current) => ({
      ...current,
      events: [...current.events, {
        id: uid(), title: String(form.get('title')), type: String(form.get('type')) as 'meeting' | 'activity' | 'task',
        date: String(form.get('date')), startTime: String(form.get('startTime')), endTime: String(form.get('endTime')),
        location: String(form.get('location') || ''), color: '#A66D52', origin: 'user',
      }],
    }))
    setModal(null)
  }

  const handleAddCourse = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const course = {
      id: uid(), subjectId: String(form.get('subjectId')), classId: String(form.get('classId')),
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
    if (mode === 'semester') {
      const candidate = { day: original.day, periodId: original.periodId, weekPattern: String(form.get('weekPattern')) as WeekPattern }
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
      id: uid(), date: toDateKey(selectedSlot.date), periodId: selectedSlot.periodId, action,
      originalCourseId: original?.id, note: String(form.get('note') || ''),
      replacement: action === 'replace' ? { subjectId: String(form.get('subjectId')), classId: String(form.get('classId')), room: String(form.get('room') || '') } : undefined,
      origin: 'user' as const,
    }
    setData((current) => ({ ...current, overrides: [...current.overrides.filter((item) => !(item.date === next.date && item.periodId === next.periodId)), next] }))
    setModal(null)
  }

  const handleSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setData((current) => ({ ...current, semester: { name: String(form.get('name')), startDate: String(form.get('startDate')), endDate: String(form.get('endDate')), firstWeekPattern: String(form.get('firstWeekPattern')) as 'A' | 'B' } }))
    setModal(null)
  }

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={(page) => { setActivePage(page); if (page === 'settings') setModal('settings') }} open={sidebarOpen} onClose={() => setSidebarOpen(false)} storageStatus={storageStatus} />
      <main className="main-area">
        <Topbar weekStart={weekStart} onWeekChange={(days) => setWeekStart(addDays(weekStart, days))} onToday={() => setWeekStart(startOfWeek(new Date()))} onAdd={() => setModal('event')} onMenu={() => setSidebarOpen(true)} />
        {storageStatus !== 'saved' && <StorageSafetyNotice status={storageStatus} controls={storageControls} />}
        <div className="content">
          <section className="page-heading">
            <div><p className="eyebrow">{data.semester.name}</p><h1>{activePage === 'dashboard' ? '總覽' : activePage === 'timetable' ? '我的課表' : activePage === 'subjects' ? '科目與班級' : '會議與活動'}</h1>{activePage !== 'dashboard' && <p>所有資料都會自動儲存在這台裝置。</p>}</div>
            <div className="week-pill"><span>第 {weekInfo.number} 週</span><strong>{weekInfo.pattern} 週</strong></div>
          </section>

          {activePage === 'dashboard' && <DashboardCards summary={todaySummary} event={upcomingEvent} />}

          {activePage === 'subjects' ? (
            <SubjectPanel data={data} setData={setData} />
          ) : activePage === 'events' ? (
            <EventsPanel data={data} setData={setData} onAdd={() => setModal('event')} />
          ) : (
            <section className="panel timetable-panel">
              <div className="panel-heading">
                <div><h2>{activePage === 'dashboard' ? '本週課表' : '週課表'}</h2><p>點選課程可建立單日調課，空白節次可快速新增。</p></div>
                <div className="schedule-controls">
                  <div className="view-switch" role="group" aria-label="課表密度">
                    <button className={density === 'comfortable' ? 'active' : ''} onClick={() => setDensity('comfortable')}>舒適</button>
                    <button className={density === 'compact' ? 'active' : ''} onClick={() => setDensity('compact')}>緊湊</button>
                  </div>
                  <div className="view-switch" role="group" aria-label="課表顯示方式">
                    <button className={viewMode === 'period' ? 'active' : ''} onClick={() => setViewMode('period')}>節次</button>
                    <button className={viewMode === 'time' ? 'active' : ''} onClick={() => setViewMode('time')}>時間</button>
                  </div>
                </div>
              </div>
              {viewMode === 'period' ? <ScheduleGrid data={data} weekDays={weekDays} mode={viewMode} density={density} onEmptyClick={(date, periodId) => openSlotModal('course', date, periodId)} onCourseClick={(date, periodId) => openSlotModal('editCourse', date, periodId)} /> : <TimeCalendar data={data} weekDays={weekDays} onCourseClick={(date, periodId) => openSlotModal('editCourse', date, periodId)} />}
              <div className="legend"><span><i className="legend-a" />A 週課程</span><span><i className="legend-b" />B 週課程</span><span><i className="legend-change" />單日調課不影響固定課表</span></div>
            </section>
          )}
        </div>
      </main>

      {modal === 'event' && <EventForm onSubmit={handleAddEvent} onClose={() => setModal(null)} defaultDate={selectedSlot ? toDateKey(selectedSlot.date) : toDateKey(new Date())} />}
      {modal === 'course' && <CourseForm data={data} slot={selectedSlot} error={operationError} onSubmit={handleAddCourse} onClose={() => setModal(null)} onEvent={() => setModal('event')} />}
      {modal === 'editCourse' && selectedSlot && <EditCourseForm data={data} slot={selectedSlot} error={operationError} onSubmit={handleCourseEdit} onClose={() => setModal(null)} onRemove={() => { setData((current) => ({ ...current, overrides: current.overrides.filter((item) => !(item.date === toDateKey(selectedSlot.date) && item.periodId === selectedSlot.periodId)) })); setModal(null) }} />}
      {modal === 'settings' && <SettingsForm data={data} demoCount={countDemoRecords(data)} onSubmit={handleSettings} onClearDemo={() => setData((current) => clearDemoRecords(current))} onClose={() => setModal(null)} />}
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
  return <Modal title="新增固定課程" subtitle="課程會依輪週規則出現在每週課表。" onClose={onClose}><form onSubmit={onSubmit} className="form-grid">
    <label>科目<select name="subjectId">{data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <label>班級<select name="classId">{data.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>星期<select name="day" defaultValue={slot?.date.getDay()}>{[1,2,3,4,5].map((d) => <option key={d} value={d}>週{'一二三四五'[d-1]}</option>)}</select></label>
    <label>節次<select name="periodId" defaultValue={slot?.periodId}>{data.periods.map((p) => <option key={p.id} value={p.id}>{p.label}（{p.startTime}）</option>)}</select></label>
    <label>輪週<select name="weekPattern"><option value="every">每週</option><option value="A">只在 A 週</option><option value="B">只在 B 週</option></select></label>
    <label>教室<input name="room" placeholder="依班級預設" /></label>
    {error && <p className="form-error full" role="alert">{error}</p>}
    <button type="button" className="text-button full" onClick={onEvent}><Clock3 size={15} />改為新增單次活動</button><FormActions onClose={onClose} />
  </form></Modal>
}

function EditCourseForm({ data, slot, error, onSubmit, onClose, onRemove }: { data: AppData; slot: SelectedSlot; error: string; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onClose: () => void; onRemove: () => void }) {
  const resolved = resolveSlot(data, slot.date, slot.periodId)
  const course = resolved.course
  const existing = data.overrides.find((o) => o.date === toDateKey(slot.date) && o.periodId === slot.periodId)
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

function SettingsForm({ data, demoCount, onSubmit, onClose, onClearDemo }: { data: AppData; demoCount: number; onSubmit: (e: FormEvent<HTMLFormElement>) => void; onClose: () => void; onClearDemo: () => void }) {
  const [confirmClear, setConfirmClear] = useState(false)
  return <Modal title="學期與輪週設定" subtitle="A/B 週會由學期起始日自動推算。" onClose={onClose}><form onSubmit={onSubmit} className="form-grid">
    <label className="full">學期名稱<input name="name" defaultValue={data.semester.name} required /></label>
    <label>學期起始日<input type="date" name="startDate" defaultValue={data.semester.startDate} required /></label>
    <label>學期結束日<input type="date" name="endDate" defaultValue={data.semester.endDate} required /></label>
    <label className="full">第一週類型<select name="firstWeekPattern" defaultValue={data.semester.firstWeekPattern}><option value="A">A 週</option><option value="B">B 週</option></select></label>
    <section className="demo-management full"><div><strong>示範資料</strong><p>只會清除具有可靠 demo 標記的紀錄。使用者建立或曾修改而無法辨識的資料會保留。</p></div>
      {!confirmClear ? <button type="button" className="danger-outline" disabled={demoCount === 0} onClick={() => setConfirmClear(true)}>{demoCount > 0 ? `清除示範資料（${demoCount}）` : '沒有可清除的示範資料'}</button> : <div className="confirm-clear"><p>確定清除？重新整理後不會再次加入。</p><button type="button" onClick={() => setConfirmClear(false)}>返回</button><button type="button" className="danger-button" onClick={() => { onClearDemo(); setConfirmClear(false) }}>確認清除</button></div>}
    </section><FormActions onClose={onClose} />
  </form></Modal>
}

function FormActions({ onClose }: { onClose: () => void }) { return <div className="form-actions full"><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary-button">儲存</button></div> }

function SubjectPanel({ data, setData }: { data: AppData; setData: Dispatch<SetStateAction<AppData>> }) {
  return <div className="manage-grid"><section className="panel manage-panel"><div className="panel-heading"><div><h2>科目</h2><p>以顏色快速辨識課程。</p></div></div>{data.subjects.map((s) => <div className="manage-row" key={s.id}><i style={{ background: s.color }} /><div><strong>{s.name}</strong><span>{data.courses.filter((c) => c.subjectId === s.id).length} 門課</span></div><input aria-label={`${s.name} 顏色`} type="color" value={s.color} onChange={(e) => setData((current) => ({ ...current, subjects: current.subjects.map((item) => item.id === s.id ? { ...item, color: e.target.value, origin: 'user' } : item) }))} /></div>)}</section>
    <section className="panel manage-panel"><div className="panel-heading"><div><h2>班級</h2><p>班級與預設教室分開管理。</p></div></div>{data.classes.map((c) => <div className="manage-row" key={c.id}><div className="class-avatar">{c.name.slice(-2,-1)}</div><div><strong>{c.name}</strong><span>{c.room || '未設定教室'}</span></div></div>)}</section></div>
}

function EventsPanel({ data, setData, onAdd }: { data: AppData; setData: Dispatch<SetStateAction<AppData>>; onAdd: () => void }) {
  const events = [...data.events].sort((a,b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
  return <section className="panel events-panel"><div className="panel-heading"><div><h2>會議與活動</h2><p>一次性行程獨立於固定課表。</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} />新增活動</button></div>{events.map((e) => <div className="event-row" key={e.id}><div className="event-date"><strong>{e.date.slice(5).replace('-', '/')}</strong><span>{e.startTime}</span></div><i style={{ background: e.color }} /><div><strong>{e.title}</strong><span>{e.location || '未設定地點'}・{e.startTime}–{e.endTime}</span></div><button onClick={() => setData((current) => ({ ...current, events: current.events.filter((item) => item.id !== e.id) }))}>刪除</button></div>)}</section>
}

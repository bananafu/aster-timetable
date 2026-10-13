import { useCallback, useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { CalendarClock, CalendarDays, Clock3, MapPin, Plus } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { Modal } from './components/Modal'
import { MultiSchoolSchedule } from './components/MultiSchoolSchedule'
import { FirstUse, ProjectLifecycleModal } from './components/ProjectLifecycle'
import { LessonEditor } from './components/LessonEditor'
import { mergeProjectView, projectToLegacyView, switchActiveProject } from './data/projectRuntime'
import { useAppDataV4 } from './hooks/useAppDataV4'
import { type StorageControls, type StorageStatus } from './hooks/useLocalStorage'
import { addDays, getWeekInfo, startOfWeek, toDateKey } from './lib/date'
import { getNextUpcomingEvent } from './lib/schedule'
import { classifyEventTerm, getTermForDate } from './lib/academic'
import { getTodayTeachingSummaryV4, type TodayTeachingSummaryV4 } from './lib/scheduleV4'
import type { AppData, CalendarEvent, ModalKind } from './types'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

const EMPTY_LEGACY_DATA: AppData = {
  schemaVersion: 3,
  school: { id: 'primary-school', name: '', timezone: 'Asia/Taipei', defaultPeriods: [] },
  academicTerms: [], activeTermId: '', subjects: [], classes: [], courses: [], events: [], overrides: [], migrationWarnings: [],
}

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
  const data = useMemo(() => appData.activeProjectId ? projectToLegacyView(appData) : EMPTY_LEGACY_DATA, [appData])
  const setData = useCallback<Dispatch<SetStateAction<AppData>>>((update) => {
    setAppData((current) => {
      if (!current.activeProjectId) return current
      const view = projectToLegacyView(current)
      const next = typeof update === 'function' ? update(view) : update
      return mergeProjectView(current, current.activeProjectId, next)
    })
  }, [setAppData])
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [activePage, setActivePage] = useState('dashboard')
  const [modal, setModal] = useState<ModalKind>(null)
  const [lessonEditorOpen, setLessonEditorOpen] = useState(false)
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null)
  const [selectedLessonDate, setSelectedLessonDate] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [historicalProjectId, setHistoricalProjectId] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const activeProject = appData.projects.find((project) => project.id === appData.activeProjectId)
  const historicalProject = appData.projects.find((project) => project.id === historicalProjectId && project.archivedAt)
  const displayProject = historicalProject ?? activeProject
  const weekTerms = weekDays.map((date) => getTermForDate(data, date)).filter((term, index, terms) => term && terms.findIndex((item) => item?.id === term.id) === index)
  const displayedTerm = weekTerms.length === 1 ? weekTerms[0] : undefined
  const weekInfo = displayedTerm ? getWeekInfo(weekDays.find((date) => getTermForDate(data, date)?.id === displayedTerm.id) ?? weekStart, displayedTerm) : null
  const weekTermLabel = weekTerms.length > 1 ? weekTerms.map((term) => term?.name).join(' ／ ') : displayedTerm?.name ?? '目前日期不屬於任何學期'
  const isMixedWeek = weekTerms.length > 1 || weekDays.some((date) => !getTermForDate(data, date))
  const todaySummary = activeProject ? getTodayTeachingSummaryV4(appData, activeProject.id, now) : { count: 0, state: 'outside-semester' as const }
  const upcomingEvent = getNextUpcomingEvent(data.events, now)

  const switchProject = (projectId: string) => {
    const project = appData.projects.find((item) => item.id === projectId && !item.archivedAt)
    if (!project) return
    setAppData((current) => switchActiveProject(current, projectId))
    setHistoricalProjectId(null)
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setLessonEditorOpen(false)
    setModal(null)
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

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={(page) => { if (page !== 'settings') setHistoricalProjectId(null); setActivePage(page); if (page === 'settings') setModal('settings') }} open={sidebarOpen} onClose={() => setSidebarOpen(false)} storageStatus={storageStatus} projects={appData.projects} activeProjectId={appData.activeProjectId} onProjectChange={switchProject} />
      <main className="main-area">
        {storageStatus !== 'read-error' && displayProject && <Topbar weekStart={weekStart} onWeekChange={(days) => setWeekStart(addDays(weekStart, days))} onToday={() => setWeekStart(startOfWeek(new Date()))} onAdd={() => { setSelectedLessonId(null); setSelectedLessonDate(null); setLessonEditorOpen(true) }} onMenu={() => setSidebarOpen(true)} readOnly={Boolean(historicalProject)} />}
        {storageStatus !== 'saved' && <StorageSafetyNotice status={storageStatus} controls={storageControls} />}
        {storageStatus === 'read-error' ? <section className="content"><div className="panel blocked-editor"><h1>資料尚未載入</h1><p>為避免在不完整資料上編輯，目前已鎖定課表。請先匯出原始 JSON，或經二次確認後重設。</p></div></section> : !displayProject ? <FirstUse data={appData} setData={setAppData} onViewArchived={(id) => { setHistoricalProjectId(id); setActivePage('timetable') }} /> : <>
        <div className="content">
          {historicalProject && <section className="history-mode" role="status"><div><strong>歷史專案・唯讀</strong><span>目前查看「{historicalProject.name}」，不會修改此專案。</span></div><button onClick={() => setHistoricalProjectId(null)}>返回目前專案</button></section>}
          {appData.migrationWarnings.length > 0 && <section className="migration-summary" role="status"><strong>有 {appData.migrationWarnings.length} 筆資料需要確認</strong><span>未歸屬資料已保留，且不會自動套用至課表。</span></section>}
          <section className="page-heading">
            <div><p className="eyebrow">{activePage === 'timetable' ? displayProject.name : weekTermLabel}</p><h1>{activePage === 'dashboard' ? '總覽' : activePage === 'timetable' ? '我的課表' : activePage === 'subjects' ? '科目與班級' : '會議與活動'}</h1>{activePage !== 'dashboard' && <p>{historicalProject ? '封存專案僅供查看。' : '所有資料都會自動儲存在這台裝置。'}</p>}</div>
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
                <div><h2>{activePage === 'dashboard' ? '本週課表' : '跨校週課表'}</h2><p>依各任教單位的實際節次與輪週設定逐日整合；點選課程可編輯固定資料。</p></div>
                {!historicalProject && <button className="primary-button" onClick={() => { setSelectedLessonId(null); setSelectedLessonDate(null); setLessonEditorOpen(true) }}><Plus size={16} />新增固定課程</button>}
              </div>
              <MultiSchoolSchedule data={appData} weekDays={weekDays} projectId={displayProject.id} onLessonClick={historicalProject ? undefined : (lessonId, date) => { setSelectedLessonId(lessonId); setSelectedLessonDate(date); setLessonEditorOpen(true) }} />
            </section>
          )}
        </div>
        </>}
      </main>

      {storageStatus !== 'read-error' && <>{modal === 'event' && <EventForm onSubmit={handleAddEvent} onClose={() => setModal(null)} defaultDate={toDateKey(new Date())} />}
      {modal === 'settings' && <ProjectLifecycleModal data={appData} setData={setAppData} onClose={() => setModal(null)} onViewArchived={(id) => { setHistoricalProjectId(id); setActivePage('timetable') }} />}</>}
      {storageStatus === 'saved' && lessonEditorOpen && !historicalProject && <LessonEditor data={appData} setData={setAppData} lessonId={selectedLessonId} occurrenceDate={selectedLessonDate} onClose={() => setLessonEditorOpen(false)} onSaved={(projectId) => { if (projectId !== appData.activeProjectId) switchProject(projectId) }} />}
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

function DashboardCards({ summary, event }: { summary: TodayTeachingSummaryV4; event?: CalendarEvent }) {
  const lessonLabel = summary.state === 'current' ? '目前課程' : summary.state === 'next' ? '下一節課' : '下一節課'
  const lessonEmpty = summary.state === 'finished' ? '今日課程已結束' : summary.state === 'outside-semester' ? '目前不在學期期間' : '今日無排定課程'
  return <section className="dashboard-cards">
    <article className="summary-card">
      <div className="summary-icon"><CalendarDays size={18} /></div>
      <div><span>今日課程</span><strong>{summary.count}<small> 節</small></strong><p>{summary.state === 'outside-semester' ? '不在學期範圍內' : '已納入調課與取消'}</p></div>
    </article>
    <article className="summary-card lesson-card">
      <div className="summary-icon"><Clock3 size={18} /></div>
      <div><span>{lessonLabel}</span>{summary.lesson ? <><strong>{summary.lesson.subjectName}<small>・{summary.lesson.className}</small></strong><p><b>{summary.lesson.startTime}</b><i><MapPin size={11} />{summary.lesson.room || '未設定教室'}</i></p></> : <strong className="empty-summary">{lessonEmpty}</strong>}</div>
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

function FormActions({ onClose }: { onClose: () => void }) { return <div className="form-actions full"><button type="button" onClick={onClose}>取消</button><button type="submit" className="primary-button">儲存</button></div> }

function SubjectPanel({ data, setData }: { data: AppData; setData: Dispatch<SetStateAction<AppData>> }) {
  return <div className="manage-grid"><section className="panel manage-panel"><div className="panel-heading"><div><h2>科目</h2><p>以顏色快速辨識課程。</p></div></div>{data.subjects.map((s) => <div className="manage-row" key={s.id}><i style={{ background: s.color }} /><div><strong>{s.name}</strong><span>{data.courses.filter((c) => c.subjectId === s.id).length} 門課</span></div><input aria-label={`${s.name} 顏色`} type="color" value={s.color} onChange={(e) => setData((current) => ({ ...current, subjects: current.subjects.map((item) => item.id === s.id ? { ...item, color: e.target.value, origin: 'user' } : item) }))} /></div>)}</section>
    <section className="panel manage-panel"><div className="panel-heading"><div><h2>班級</h2><p>班級與預設教室分開管理。</p></div></div>{data.classes.map((c) => <div className="manage-row" key={c.id}><div className="class-avatar">{c.name.slice(-2,-1)}</div><div><strong>{c.name}</strong><span>{c.room || '未設定教室'}</span></div></div>)}</section></div>
}

function EventsPanel({ data, setData, onAdd }: { data: AppData; setData: Dispatch<SetStateAction<AppData>>; onAdd: () => void }) {
  const events = [...data.events].sort((a,b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
  return <section className="panel events-panel"><div className="panel-heading"><div><h2>會議與活動</h2><p>一次性行程獨立於固定課表。</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} />新增活動</button></div>{events.map((e) => <div className="event-row" key={e.id}><div className="event-date"><strong>{e.date.slice(5).replace('-', '/')}</strong><span>{e.startTime}</span></div><i style={{ background: e.color }} /><div><strong>{e.title}</strong><span>{e.location || '未設定地點'}・{e.startTime}–{e.endTime}</span></div><button onClick={() => { if (window.confirm(`確定刪除「${e.title}」？此操作無法復原。`)) setData((current) => ({ ...current, events: current.events.filter((item) => item.id !== e.id) })) }}>刪除</button></div>)}</section>
}

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { CalendarClock, CalendarDays, Clock3, MapPin, Plus } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { Modal } from './components/Modal'
import { MultiSchoolSchedule } from './components/MultiSchoolSchedule'
import { FirstUse, ProjectLifecycleModal } from './components/ProjectLifecycle'
import { LessonEditor } from './components/LessonEditor'
import { TimetableControls, TimetableCopyForm, TimetableForm, type TimetableCopyDetails } from './components/TimetableControls'
import { projectToLegacyView, switchActiveProject } from './data/projectRuntime'
import { copyTimetable, createTimetable, updateTimetable, type TimetableDetails } from './data/timetablesV6'
import { getSubjectImpact, updateSubject } from './data/subjectsV5'
import { SCHOOL_LEVELS } from './types'
import { useAppDataV4 } from './hooks/useAppDataV4'
import { type StorageControls, type StorageStatus } from './hooks/useLocalStorage'
import { addDays, getWeekInfo, startOfWeek, toDateKey } from './lib/date'
import { getNextUpcomingEvent } from './lib/schedule'
import { classifyEventTerm, getTermForDate } from './lib/academic'
import { getTodayTeachingSummaryV4, type TodayTeachingSummaryV4 } from './lib/scheduleV4'
import type { LessonDragIntent } from './lib/lessonDrag'
import type { AppData, AppDataV4, CalendarEvent, ModalKind, Timetable } from './types'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

type TimetableDialog = {
  mode: 'create' | 'edit'
  projectId: string
  timetableId?: string
  original?: TimetableDetails
} | {
  mode: 'copy'
  projectId: string
  timetableId: string
  source: Timetable
  sourceFingerprint: string
  defaultDate: string
}

function timetableCopySourceFingerprint(data: AppDataV4, projectId: string, timetableId: string): string | null {
  const project = data.projects.find((item) => item.id === projectId)
  const timetable = data.timetables?.find((item) => item.id === timetableId && item.projectId === projectId)
  if (!project || !timetable) return null
  return JSON.stringify({
    project,
    timetable,
    lessons: data.recurringLessons.filter((item) => item.projectId === projectId && item.timetableId === timetableId),
    teachingUnits: data.teachingUnits.filter((item) => item.projectId === projectId),
  })
}

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
  const [appData, setAppData, storageStatus, storageControls, storagePersistence] = useAppDataV4()
  // Timetable selection is view state; it must never update persisted AppData.
  const [timetableSelection, setTimetableSelection] = useState(() => ({
    projectId: appData.activeProjectId,
    timetableId: appData.timetables?.find((item) => item.projectId === appData.activeProjectId)?.id ?? null,
  }))
  const activeTimetableCandidate = timetableSelection.projectId === appData.activeProjectId
    ? timetableSelection.timetableId : appData.timetables?.find((item) => item.projectId === appData.activeProjectId)?.id ?? null
  const activeTimetableId = appData.timetables?.some((item) => item.projectId === appData.activeProjectId && item.id === activeTimetableCandidate)
    ? activeTimetableCandidate : null
  const data = useMemo(() => {
    if (!appData.activeProjectId) return EMPTY_LEGACY_DATA
    const view = projectToLegacyView(appData, appData.activeProjectId, activeTimetableId ?? undefined)
    return activeTimetableCandidate && !activeTimetableId ? { ...view, courses: [], overrides: [] } : view
  }, [appData, activeTimetableCandidate, activeTimetableId])
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [activePage, setActivePage] = useState('dashboard')
  const [modal, setModal] = useState<ModalKind>(null)
  const [projectLifecycleInitialPage, setProjectLifecycleInitialPage] = useState<'root' | 'blank'>('root')
  const [addChoiceOpen, setAddChoiceOpen] = useState(false)
  const [lessonEditorOpen, setLessonEditorOpen] = useState(false)
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null)
  const [selectedLessonDate, setSelectedLessonDate] = useState<string | null>(null)
  const [selectedLessonOverrideId, setSelectedLessonOverrideId] = useState<string | null>(null)
  const [lessonDragIntent, setLessonDragIntent] = useState<LessonDragIntent | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [historicalProjectId, setHistoricalProjectId] = useState<string | null>(null)
  const [timetableDialog, setTimetableDialog] = useState<TimetableDialog | null>(null)
  const [timetableError, setTimetableError] = useState('')
  const [timetableNotice, setTimetableNotice] = useState('')
  const [pendingTimetableCopy, setPendingTimetableCopy] = useState<{ projectId: string; timetableId: string; startedRevision: number } | null>(null)
  const copySubmittingRef = useRef(false)
  const lessonEditorFromAddRef = useRef(false)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    lessonEditorFromAddRef.current = false
  }, [activeTimetableId])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!pendingTimetableCopy) return
    if (storageStatus === 'conflict') {
      setTimetableError('其他分頁已更新資料，複製尚未儲存。請先處理多分頁衝突。')
      return
    }
    if (storageStatus === 'write-error' || storageStatus === 'read-error') {
      setTimetableError('資料尚未成功寫入此裝置，複製尚未完成。請先處理儲存問題。')
      return
    }
    if (storageStatus !== 'saved' || storagePersistence.pending) return
    const persistedCopy = appData.timetables?.find((item) => item.id === pendingTimetableCopy.timetableId && item.projectId === pendingTimetableCopy.projectId)
    if (!persistedCopy) {
      copySubmittingRef.current = false
      setPendingTimetableCopy(null)
      setTimetableError('已採用其他資料版本，這次複製未完成。請重新確認來源後再試。')
      return
    }
    if (storagePersistence.revision <= pendingTimetableCopy.startedRevision) return
    setTimetableSelection({ projectId: pendingTimetableCopy.projectId, timetableId: pendingTimetableCopy.timetableId })
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    setTimetableDialog(null)
    setTimetableError('')
    setTimetableNotice(`已複製並儲存「${persistedCopy.name}」。`)
    copySubmittingRef.current = false
    setPendingTimetableCopy(null)
  }, [appData.timetables, pendingTimetableCopy, storagePersistence, storageStatus])
  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const activeProject = appData.projects.find((project) => project.id === appData.activeProjectId)
  const historicalProject = appData.projects.find((project) => project.id === historicalProjectId && project.archivedAt)
  const displayProject = historicalProject ?? activeProject
  const displayTimetables = appData.timetables?.filter((item) => item.projectId === displayProject?.id) ?? []
  const displayTimetableCandidate = timetableSelection.projectId === displayProject?.id
    ? timetableSelection.timetableId : displayTimetables[0]?.id ?? null
  const displayTimetable = displayTimetables.find((item) => item.id === displayTimetableCandidate)
  const weekTerms = weekDays.map((date) => getTermForDate(data, date)).filter((term, index, terms) => term && terms.findIndex((item) => item?.id === term.id) === index)
  const displayedTerm = weekTerms.length === 1 ? weekTerms[0] : undefined
  const weekInfo = displayedTerm ? getWeekInfo(weekDays.find((date) => getTermForDate(data, date)?.id === displayedTerm.id) ?? weekStart, displayedTerm) : null
  const weekTermLabel = weekTerms.length > 1 ? weekTerms.map((term) => term?.name).join(' ／ ') : displayedTerm?.name ?? '目前日期不屬於任何學期'
  const isMixedWeek = weekTerms.length > 1 || weekDays.some((date) => !getTermForDate(data, date))
  const activeTimetable = appData.timetables?.find((item) => item.projectId === activeProject?.id && item.id === activeTimetableId)
  const canCreateTimetable = Boolean(displayProject && !historicalProject && !displayProject.archivedAt && storageStatus === 'saved')
  const createTimetableUnavailableReason = storageStatus !== 'saved'
    ? '資料目前無法安全寫入，請先處理儲存狀態。'
    : historicalProject || displayProject?.archivedAt
      ? '封存專案為唯讀，不能建立課表。'
      : !displayProject
        ? '請先建立課表專案。'
        : ''
  const canAddLesson = canCreateTimetable && Boolean(activeTimetable?.teacherName?.trim()) && !activeTimetable?.teacherNamePending
  const addLessonUnavailableReason = createTimetableUnavailableReason || (!activeTimetable
    ? '請先選擇教師課表。'
    : activeTimetable.teacherNamePending || !activeTimetable.teacherName?.trim()
      ? '目前課表的授課教師姓名尚待補齊。'
      : '')
  const todaySummary = activeProject && (appData.schemaVersion < 6 || activeTimetable)
    ? getTodayTeachingSummaryV4(appData, activeProject.id, now, activeTimetable?.id)
    : { count: 0, state: 'idle' as const }
  const upcomingEvent = getNextUpcomingEvent(data.events, now)

  const changeSubjectColor = (subjectId: string, color: string) => {
    const subject = appData.subjects.find((item) => item.id === subjectId)
    if (!subject) return
    const impact = getSubjectImpact(appData, subjectId)
    if (!window.confirm(`變更「${subject.name}」的全域顏色？科目庫會同步更新；目前有 ${impact.projectIds.length} 個專案、${impact.references.length} 筆課程或異動引用。`)) return
    setAppData((current) => {
      const latest = current.subjects.find((item) => item.id === subjectId)
      if (!latest) return current
      return updateSubject(current, subjectId, {
        name: latest.name, shortName: latest.shortName, color,
        applicableSchoolLevels: [...(latest.applicableSchoolLevels ?? SCHOOL_LEVELS)],
      }, true)
    })
  }

  const chooseTimetable = (projectId: string, timetableId: string) => {
    if (!appData.timetables?.some((item) => item.id === timetableId && item.projectId === projectId)) return
    setTimetableSelection({ projectId, timetableId })
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    lessonEditorFromAddRef.current = false
  }

  const openAddChoice = () => {
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    lessonEditorFromAddRef.current = false
    setAddChoiceOpen(true)
  }

  const openNewProject = () => {
    if (historicalProject || storageStatus !== 'saved') return
    setProjectLifecycleInitialPage('blank')
    setModal('settings')
  }

  const viewArchivedProject = (projectId: string) => {
    setHistoricalProjectId(projectId)
    setTimetableSelection({ projectId, timetableId: appData.timetables?.find((item) => item.projectId === projectId)?.id ?? null })
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    lessonEditorFromAddRef.current = false
    setAddChoiceOpen(false)
    setActivePage('timetable')
  }

  const submitTimetable = (details: TimetableDetails) => {
    if (!timetableDialog || timetableDialog.mode === 'copy' || timetableDialog.projectId !== displayProject?.id || historicalProject || storageStatus !== 'saved') {
      setTimetableError('目前專案無法修改課表資訊。'); return
    }
    try {
      if (timetableDialog.mode === 'create') {
        const id = uid()
        const next = createTimetable(appData, timetableDialog.projectId, details, id)
        setAppData(next)
        setTimetableSelection({ projectId: timetableDialog.projectId, timetableId: id })
        setSelectedLessonId(null)
        setSelectedLessonDate(null)
        setLessonDragIntent(null)
        setLessonEditorOpen(false)
      } else {
        if (!timetableDialog.timetableId) throw new Error('Timetable does not exist')
        const latest = appData.timetables?.find((item) => item.id === timetableDialog.timetableId && item.projectId === timetableDialog.projectId)
        if (!latest || latest.name !== timetableDialog.original?.name || latest.teacherName !== timetableDialog.original?.teacherName) {
          setTimetableError('課表資訊已變更，請關閉後重新開啟編輯。'); return
        }
        setAppData(updateTimetable(appData, timetableDialog.timetableId, details))
      }
      setTimetableDialog(null)
      setTimetableError('')
    } catch (reason) {
      setTimetableError(reason instanceof Error && reason.message.includes('read-only')
        ? '封存或不存在的專案不可修改課表。' : '課表名稱與授課教師姓名不正確，或課表資料已變更。')
    }
  }

  const submitTimetableCopy = (details: TimetableCopyDetails) => {
    if (copySubmittingRef.current) return
    if (!timetableDialog || timetableDialog.mode !== 'copy' || timetableDialog.projectId !== displayProject?.id || historicalProject || storageStatus !== 'saved') {
      setTimetableError('目前專案無法複製課表。')
      return
    }
    const latestFingerprint = timetableCopySourceFingerprint(appData, timetableDialog.projectId, timetableDialog.timetableId)
    if (!latestFingerprint || latestFingerprint !== timetableDialog.sourceFingerprint) {
      setTimetableError('來源課表、固定課程或學校與學制設定已變更，請關閉後重新開啟複製。')
      return
    }
    try {
      copySubmittingRef.current = true
      const next = copyTimetable(appData, {
        projectId: timetableDialog.projectId,
        sourceTimetableId: timetableDialog.timetableId,
        baseDate: details.baseDate,
        name: details.name,
        teacherName: details.teacherName,
      }, uid)
      const created = next.timetables?.find((item) => !appData.timetables?.some((current) => current.id === item.id))
      if (!created) throw new Error('Copied timetable was not created')
      setPendingTimetableCopy({ projectId: timetableDialog.projectId, timetableId: created.id, startedRevision: storagePersistence.revision })
      setTimetableError('')
      setTimetableNotice('')
      setAppData(next)
    } catch (reason) {
      copySubmittingRef.current = false
      const message = reason instanceof Error ? reason.message : ''
      setTimetableError(message.includes('Base date')
        ? '請輸入真實有效的基準日期。'
        : message.includes('name') || message.includes('teacher')
          ? '課表名稱與授課教師姓名不可空白。'
          : '課表資料已變更或不符合安全規則，未建立副本。')
    }
  }

  const switchProject = (projectId: string) => {
    const project = appData.projects.find((item) => item.id === projectId && !item.archivedAt)
    if (!project) return
    setAppData((current) => switchActiveProject(current, projectId))
    setHistoricalProjectId(null)
    setTimetableSelection({ projectId, timetableId: appData.timetables?.find((item) => item.projectId === projectId)?.id ?? null })
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    lessonEditorFromAddRef.current = false
    setAddChoiceOpen(false)
    setTimetableDialog(null)
    setModal(null)
  }

  const handleAddEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const date = String(form.get('date'))
    const unitId = classifyEventTerm({ date }, data.academicTerms)
    setAppData((current) => {
      const assignedUnit = current.teachingUnits.find((item) => item.id === unitId && item.projectId === current.activeProjectId)
      return ({
      ...current, events: [...current.events, {
        id: uid(), title: String(form.get('title')), type: String(form.get('type')) as 'meeting' | 'activity' | 'task',
        projectId: assignedUnit ? current.activeProjectId : null, teachingUnitId: assignedUnit?.id ?? null,
        date, startTime: String(form.get('startTime')), endTime: String(form.get('endTime')),
        location: String(form.get('location') || ''), color: '#A66D52', origin: 'user',
      }],
    })})
    setModal(null)
  }

  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={(page) => { if (page !== 'settings') setHistoricalProjectId(null); setActivePage(page); if (page === 'settings') { setProjectLifecycleInitialPage('root'); setModal('settings') } }} open={sidebarOpen} onClose={() => setSidebarOpen(false)} storageStatus={storageStatus} projects={appData.projects} activeProjectId={appData.activeProjectId} onProjectChange={switchProject} />
      <main className="main-area">
        {storageStatus !== 'read-error' && displayProject && <Topbar weekStart={weekStart} onWeekChange={(days) => setWeekStart(addDays(weekStart, days))} onToday={() => setWeekStart(startOfWeek(new Date()))} onAdd={openNewProject} onMenu={() => setSidebarOpen(true)} readOnly={Boolean(historicalProject) || storageStatus !== 'saved'} />}
        {storageStatus !== 'saved' && <StorageSafetyNotice status={storageStatus} controls={storageControls} />}
        {storageStatus === 'read-error' ? <section className="content"><div className="panel blocked-editor"><h1>資料尚未載入</h1><p>為避免在不完整資料上編輯，目前已鎖定課表。請先匯出原始 JSON，或經二次確認後重設。</p></div></section> : !displayProject ? <FirstUse data={appData} setData={setAppData} onViewArchived={viewArchivedProject} /> : <>
        <div className="content">
          {historicalProject && <section className="history-mode" role="status"><div><strong>歷史專案・唯讀</strong><span>目前查看「{historicalProject.name}」，不會修改此專案。</span></div><button onClick={() => { setHistoricalProjectId(null); setTimetableSelection({ projectId: appData.activeProjectId, timetableId: appData.timetables?.find((item) => item.projectId === appData.activeProjectId)?.id ?? null }) }}>返回目前專案</button></section>}
          {appData.migrationWarnings.length > 0 && <section className="migration-summary" role="status"><strong>有 {appData.migrationWarnings.length} 筆資料需要確認</strong><span>未歸屬資料已保留，且不會自動套用至課表。</span></section>}
          <section className="page-heading">
            <div><p className="eyebrow">{activePage === 'timetable' ? displayProject.name : weekTermLabel}</p><h1>{activePage === 'dashboard' ? '總覽' : activePage === 'timetable' ? '我的課表' : activePage === 'subjects' ? '科目與班級' : '會議與活動'}</h1>{activePage !== 'dashboard' && <p>{historicalProject ? '封存專案僅供查看。' : '所有資料都會自動儲存在這台裝置。'}</p>}</div>
            <div className="page-heading-side">
              {(activePage === 'timetable' || activePage === 'dashboard') && <TimetableControls timetables={displayTimetables} selected={displayTimetable} canManage={!historicalProject && storageStatus === 'saved'} notice={timetableNotice} onSelect={(id) => { setTimetableNotice(''); chooseTimetable(displayProject.id, id) }} onCopy={() => {
                if (!displayTimetable) return
                const sourceFingerprint = timetableCopySourceFingerprint(appData, displayProject.id, displayTimetable.id)
                if (!sourceFingerprint) return
                setTimetableNotice('')
                setTimetableError('')
                setTimetableDialog({ mode: 'copy', projectId: displayProject.id, timetableId: displayTimetable.id, source: displayTimetable, sourceFingerprint, defaultDate: toDateKey(new Date()) })
              }} onEdit={() => { if (!displayTimetable) return; setTimetableNotice(''); setTimetableError(''); setTimetableDialog({ mode: 'edit', projectId: displayProject.id, timetableId: displayTimetable.id, original: { name: displayTimetable.name, teacherName: displayTimetable.teacherName } }) }} />}
              <div className="week-pill">{activePage === 'timetable' ? <><span>多校檢視</span><strong>實際時間</strong></> : <><span>{isMixedWeek ? '跨學期週' : weekInfo ? `第 ${weekInfo.number} 週` : '學期外'}</span><strong>{isMixedWeek ? '逐日' : weekInfo?.pattern ? `${weekInfo.pattern} 週` : '—'}</strong></>}</div>
            </div>
          </section>

          {activePage === 'dashboard' && <DashboardCards summary={todaySummary} event={upcomingEvent} />}

          {activePage === 'subjects' ? (
            <SubjectPanel data={data} onColorChange={changeSubjectColor} />
          ) : activePage === 'events' ? (
            <EventsPanel data={data} onDelete={(eventId) => setAppData((current) => ({ ...current, events: current.events.filter((item) => item.id !== eventId) }))} onAdd={() => setModal('event')} />
          ) : (
            <section className="panel timetable-panel">
              <div className="panel-heading">
                <div><h2>{activePage === 'dashboard' ? '本週課表' : '跨校週課表'}</h2><p>依各校學制的實際節次與輪週設定逐日整合；點選課程可編輯固定資料。</p></div>
                {!historicalProject && <button className="primary-button" aria-label="新增課程或課表" onClick={openAddChoice}><Plus size={16} />新增</button>}
              </div>
              <MultiSchoolSchedule key={displayTimetable?.id ?? displayProject.id} data={appData} weekDays={weekDays} projectId={displayProject.id} timetableId={displayTimetable?.id} onLessonClick={historicalProject ? undefined : (lessonId, date, overrideId) => { lessonEditorFromAddRef.current = false; setSelectedLessonId(lessonId); setSelectedLessonDate(date); setSelectedLessonOverrideId(overrideId ?? null); setLessonDragIntent(null); setLessonEditorOpen(true) }} onLessonDrop={historicalProject ? undefined : (intent) => { lessonEditorFromAddRef.current = false; setSelectedLessonId(intent.lessonId); setSelectedLessonDate(intent.sourceDate); setSelectedLessonOverrideId(null); setLessonDragIntent(intent); setLessonEditorOpen(true) }} />
            </section>
          )}
        </div>
        </>}
      </main>

      {storageStatus !== 'read-error' && <>{modal === 'event' && <EventForm onSubmit={handleAddEvent} onClose={() => setModal(null)} defaultDate={toDateKey(new Date())} />}
      {modal === 'settings' && <ProjectLifecycleModal data={appData} setData={setAppData} initialPage={projectLifecycleInitialPage} storageStatus={storageStatus} storagePersistence={storagePersistence} readOnly={Boolean(historicalProject)} onClose={() => { setModal(null); setProjectLifecycleInitialPage('root') }} onViewArchived={viewArchivedProject} />}</>}
      {addChoiceOpen && <AddChoiceDialog canAddLesson={canAddLesson} addLessonReason={addLessonUnavailableReason} canCreateTimetable={canCreateTimetable} createTimetableReason={createTimetableUnavailableReason} onAddLesson={() => {
        if (!canAddLesson) return
        setAddChoiceOpen(false)
        lessonEditorFromAddRef.current = true
        setSelectedLessonOverrideId(null)
        setLessonEditorOpen(true)
      }} onCreateTimetable={() => {
        if (!canCreateTimetable || !displayProject) return
        setAddChoiceOpen(false)
        setTimetableNotice('')
        setTimetableError('')
        setTimetableDialog({ mode: 'create', projectId: displayProject.id })
      }} onClose={() => setAddChoiceOpen(false)} />}
      {timetableDialog?.mode === 'copy' ? <TimetableCopyForm key={`copy:${timetableDialog.timetableId}`} source={timetableDialog.source} defaultDate={timetableDialog.defaultDate} error={timetableError} submitting={Boolean(pendingTimetableCopy)} onSubmit={submitTimetableCopy} onClose={() => { if (pendingTimetableCopy) return; setTimetableDialog(null); setTimetableError('') }} /> : timetableDialog && <TimetableForm key={`${timetableDialog.mode}:${timetableDialog.timetableId ?? timetableDialog.projectId}`} mode={timetableDialog.mode} timetable={appData.timetables?.find((item) => item.id === timetableDialog.timetableId && item.projectId === timetableDialog.projectId)} error={timetableError} onSubmit={submitTimetable} onClose={() => { const returnToAdd = timetableDialog.mode === 'create'; setTimetableDialog(null); setTimetableError(''); if (returnToAdd) setAddChoiceOpen(true) }} />}
      {storageStatus === 'saved' && lessonEditorOpen && !historicalProject && <LessonEditor key={activeTimetable?.id ?? activeProject?.id} data={appData} setData={setAppData} timetableId={activeTimetable?.id} lessonId={selectedLessonId} occurrenceDate={selectedLessonDate} occurrenceOverrideId={selectedLessonOverrideId} dragIntent={lessonDragIntent} onOpenSettings={() => { lessonEditorFromAddRef.current = false; setLessonEditorOpen(false); setModal('settings') }} onClose={() => { setLessonEditorOpen(false); if (lessonEditorFromAddRef.current) setAddChoiceOpen(true); lessonEditorFromAddRef.current = false }} onSaved={(projectId) => { lessonEditorFromAddRef.current = false; if (projectId !== appData.activeProjectId) switchProject(projectId) }} />}
    </div>
  )
}

function AddChoiceDialog({ canAddLesson, addLessonReason, canCreateTimetable, createTimetableReason, onAddLesson, onCreateTimetable, onClose }: {
  canAddLesson: boolean
  addLessonReason: string
  canCreateTimetable: boolean
  createTimetableReason: string
  onAddLesson: () => void
  onCreateTimetable: () => void
  onClose: () => void
}) {
  return <Modal title="新增" subtitle="選擇要加入目前專案的內容。" onClose={onClose}>
    <div className="add-choice-dialog">
      <nav className="settings-menu" aria-label="新增項目">
        <button type="button" className="settings-menu-item" onClick={onAddLesson} disabled={!canAddLesson} autoFocus={canAddLesson}><span><strong>新增固定課程</strong><small>{canAddLesson ? '使用目前的專案與教師課表。' : addLessonReason}</small></span></button>
        <button type="button" className="settings-menu-item" onClick={onCreateTimetable} disabled={!canCreateTimetable} autoFocus={!canAddLesson && canCreateTimetable}><span><strong>建立空白課表</strong><small>{canCreateTimetable ? '只建立一份不含課程與異動的新教師課表。' : createTimetableReason}</small></span></button>
      </nav>
      <div className="form-actions add-choice-actions"><button type="button" onClick={onClose} autoFocus={!canAddLesson && !canCreateTimetable}>取消</button></div>
    </div>
  </Modal>
}

function StorageSafetyNotice({ status, controls }: { status: StorageStatus; controls: StorageControls }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const isConflict = status === 'conflict'
  const legacyConflict = isConflict && controls.conflictSource === 'legacy'
  const message = status === 'read-error'
    ? '無法讀取已儲存的資料。原始內容仍保留，系統已暫停寫入。'
    : status === 'write-error'
      ? '資料寫入失敗。請先匯出備份，再檢查瀏覽器儲存空間。'
      : legacyConflict
        ? '舊版分頁更新了 v6 資料，本頁已暫停 v7 寫入。請先關閉舊版分頁並匯出核對；兩個版本無法自動合併。'
        : '其他分頁已更新資料，本分頁仍有尚未寫入的變更。已暫停自動儲存以避免覆寫。'

  return <section className="storage-notice" role="alert">
    <div><strong>{isConflict ? '偵測到多分頁資料衝突' : '資料儲存需要處理'}</strong><p>{message}</p></div>
    <div className="storage-notice-actions">
      {controls.rawBackup !== null && <button type="button" onClick={() => downloadRawData(controls.rawBackup!)}>匯出原始 JSON</button>}
      {isConflict ? <>{!legacyConflict && <button type="button" onClick={controls.acceptExternal}>採用其他分頁版本</button>}<button type="button" className="danger-outline" onClick={controls.keepLocal}>{legacyConflict ? '已核對，保留本頁 v7' : '保留本分頁版本'}</button></> : !confirmReset ? <button type="button" className="danger-outline" onClick={() => setConfirmReset(true)}>重設資料</button> : <div className="reset-confirm"><span>確定重設？原始資料將被取代。</span><button type="button" onClick={() => setConfirmReset(false)}>取消</button><button type="button" className="danger-outline" onClick={() => { controls.reset(); setConfirmReset(false) }}>再次確認重設</button></div>}
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

function SubjectPanel({ data, onColorChange }: { data: AppData; onColorChange: (subjectId: string, color: string) => void }) {
  return <div className="manage-grid"><section className="panel manage-panel"><div className="panel-heading"><div><h2>科目</h2><p>以顏色快速辨識課程。</p></div></div>{data.subjects.map((s) => <div className="manage-row" key={s.id}><i style={{ background: s.color }} /><div><strong>{s.name}</strong><span>{data.courses.filter((c) => c.subjectId === s.id).length} 門課</span></div><input aria-label={`${s.name} 顏色`} type="color" value={s.color} onChange={(e) => onColorChange(s.id, e.target.value)} /></div>)}</section>
    <section className="panel manage-panel"><div className="panel-heading"><div><h2>班級</h2><p>班級與預設教室分開管理。</p></div></div>{data.classes.map((c) => <div className="manage-row" key={c.id}><div className="class-avatar">{c.name.slice(-2,-1)}</div><div><strong>{c.name}</strong><span>{c.room || '未設定教室'}</span></div></div>)}</section></div>
}

function EventsPanel({ data, onDelete, onAdd }: { data: AppData; onDelete: (eventId: string) => void; onAdd: () => void }) {
  const events = [...data.events].sort((a,b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
  return <section className="panel events-panel"><div className="panel-heading"><div><h2>會議與活動</h2><p>一次性行程獨立於固定課表。</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} />新增活動</button></div>{events.map((e) => <div className="event-row" key={e.id}><div className="event-date"><strong>{e.date.slice(5).replace('-', '/')}</strong><span>{e.startTime}</span></div><i style={{ background: e.color }} /><div><strong>{e.title}</strong><span>{e.location || '未設定地點'}・{e.startTime}–{e.endTime}</span></div><button onClick={() => { if (window.confirm(`確定刪除「${e.title}」？此操作無法復原。`)) onDelete(e.id) }}>刪除</button></div>)}</section>
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { AddChoiceDialog } from './components/AddChoiceDialog'
import { FormalAcademicSettingsV9 } from './components/FormalAcademicSettingsV9'
import { LessonEditor } from './components/LessonEditor'
import { CourseResourceManagerDialog } from './components/CourseResourceManager'
import { FirstUseView, ProjectLifecycleView, type ProjectLifecycleViewData } from './components/ProjectLifecycleView'
import { MultiSchoolSchedule } from './components/MultiSchoolSchedule'
import { OverviewCalendar } from './components/OverviewCalendar'
import { Sidebar } from './components/Sidebar'
import { TimetableControls, TimetableForm, TimetableInfoDialog } from './components/TimetableControls'
import { Topbar } from './components/Topbar'
import { toFormalV9HostPort } from './formalRuntime'
import type { ProjectLifecycleActions } from './formalV7ProjectTimetableActions'
import type { FormalProjectTimetableV9Result, FormalProjectTimetableV9Selection } from './formalProjectTimetableV9'
import { useFormalAcademicSettingsV9Adapter } from './hooks/useFormalAcademicSettingsV9Adapter'
import { useFormalClassManagementV9Adapter } from './hooks/useFormalClassManagementV9Adapter'
import { useFormalLessonManagementV9Adapter,
  type FormalLessonEditorV9Session } from './hooks/useFormalLessonManagementV9Adapter'
import { useFormalProjectTimetableV9Adapter } from './hooks/useFormalProjectTimetableV9Adapter'
import { useFormalSubjectManagementV9Adapter } from './hooks/useFormalSubjectManagementV9Adapter'
import type { StorageStatus } from './hooks/useLocalStorage'
import { addDays, startOfWeek, toDateKey } from './lib/date'
import { toScheduleDisplayDays, toScheduleDisplayEvents } from './lib/scheduleDisplay'
import { resolveV9WeekResult, selectV9HeaderWeekPatternResult,
  selectV9ResolvedEventsResult, type V9ReadStatus } from './lib/scheduleV9'
import type { TimetableDetails } from './data/timetablesV6'
import type { Timetable } from './types'
import type { AppDataV9 } from './types/v9'

type Management = ReturnType<typeof useFormalProjectTimetableV9Adapter>
type Actions = NonNullable<Management['actions']>
type ResourceMode = 'subjects' | 'classes'
type WorkspacePage = 'dashboard' | 'timetable'
type TimetableDialog = {
  mode: 'create' | 'edit'
  projectId: string
  source?: Timetable
  defaultDate: string
  actions: Actions['timetable']
  impact: { lessons: number; overrides: number; oneOffLessons: number }
}
type LifecycleDialog = { initialPage: 'root' | 'blank' | 'term'; data: ProjectLifecycleViewData;
  actions: ProjectLifecycleActions; deletionMessage: (id: string) => string }
type PendingTerm = { projectId: string; raw: string; revision: number; attemptId: string }
type SubjectPort = ReturnType<typeof useFormalSubjectManagementV9Adapter>
type ClassPort = ReturnType<typeof useFormalClassManagementV9Adapter>
type AcademicPort = ReturnType<typeof useFormalAcademicSettingsV9Adapter>
type LessonPort = ReturnType<typeof useFormalLessonManagementV9Adapter>
type FormalWorkspaceSource = {
  kind: 'formal'
  management: Management
  subjectPort: SubjectPort
  classPort: ClassPort
  academicPort: AcademicPort
  lessonPort: LessonPort
}
type PreviewWorkspaceSource = { kind: 'preview' }

export interface FormalV9WorkspaceProps {
  data: AppDataV9
  selection: FormalProjectTimetableV9Selection
  onProjectChange: (projectId: string) => void
  onTimetableChange: (timetableId: string) => void
  source: FormalWorkspaceSource | PreviewWorkspaceSource
  initialWeekStart?: Date
}

function lifecycleActions(actions: Actions, onDeleted?: () => void,
  onCreated?: (result: FormalProjectTimetableV9Result) => void): ProjectLifecycleActions {
  return {
    runtime: 'v9', creationMode: 'empty-v9', copyRequiresSourceEffectiveDate: true,
    createProject: async (input) => { const result = await actions.project.createEmptyFromName(input); onCreated?.(result) },
    configureTerm: async (input) => { await actions.project.configureTerm(input) },
    copyProject: async (input) => { await actions.project.copy(input) },
    archiveProject: async (id) => { await actions.project.archive(id) },
    reactivateProject: async (id) => { await actions.project.reactivate(id) },
    deleteProject: async (id) => { await actions.project.delete(id); onDeleted?.() },
  }
}
function deletionMessage(snapshot: ProjectLifecycleViewData, actions: Actions, id: string) {
  const target = snapshot.projects.find((item) => item.id === id)
  const impact = actions.project.deletionImpact(id)
  return `永久刪除「${target?.name ?? ''}」？\n目前有 ${impact.timetables} 份教師課表、${impact.subjects} 個科目、${impact.classes} 個班級、${impact.recurringLessons} 筆固定課程、${impact.oneOffLessons} 筆單日課程、${impact.events} 筆事件及 ${impact.teachingProgress} 筆進度。\n僅能刪除無教學依賴的空白專案，不會級聯刪除其他資料。`
}

const V9_WORKSPACE_UNAVAILABLE = { events: '此功能尚未接入正式 V9 資料路徑。' } as const

/** Formal V9 management tree mounted by the verified formal Runtime Gate. */
export function FormalV9Composition() {
  // This adapter owns the one existing V9 Host; resource adapters share its port.
  const management = useFormalProjectTimetableV9Adapter()
  const { host, controller, actions } = management
  const selection = controller?.selection ?? management.selection
  const data = host.data
  const project = data?.projects.find((item) => item.id === selection.projectId)
  const [unitSelection, setUnitSelection] = useState<{ projectId: string | null; id: string | null }>({ projectId: null, id: null })
  const units = useMemo(() => data?.teachingUnits.filter((item) => item.projectId === project?.id) ?? [],
    [data, project?.id])
  const sameProject = unitSelection.projectId === project?.id
  const unit = sameProject && unitSelection.id === null ? undefined
    : (sameProject ? units.find((item) => item.id === unitSelection.id) : undefined) ?? units[0]
  const managementScope = { ...selection, teachingUnitId: unit?.id ?? null }
  const port = useMemo(() => toFormalV9HostPort(host), [host])
  const selectUnit = (next: typeof managementScope) => {
    if (next.projectId !== selection.projectId || next.timetableId !== selection.timetableId) return
    if (next.teachingUnitId !== null && !units.some((item) => item.id === next.teachingUnitId)) return
    setUnitSelection({ projectId: next.projectId, id: next.teachingUnitId })
  }
  const subjectPort = useFormalSubjectManagementV9Adapter(port, managementScope, selectUnit)
  const classPort = useFormalClassManagementV9Adapter(port, managementScope, (next) => {
    selectUnit({ ...selection, teachingUnitId: next.teachingUnitId, projectId: next.projectId })
  })
  const selectAcademicUnit = useCallback((next: typeof managementScope) => {
    if (next.projectId !== selection.projectId || next.timetableId !== selection.timetableId) return
    setUnitSelection({ projectId: next.projectId, id: next.teachingUnitId })
  }, [selection.projectId, selection.timetableId])
  const academicPort = useFormalAcademicSettingsV9Adapter(port, managementScope, selectAcademicUnit)
  const lessonPort = useFormalLessonManagementV9Adapter(port, selection)
  if (!data) return null
  return <FormalV9Workspace data={data} selection={selection}
    onProjectChange={(id) => actions?.selectProject(id)}
    onTimetableChange={(id) => actions?.selectTimetable(id)}
    source={{ kind: 'formal', management, subjectPort, classPort, academicPort, lessonPort }} />
}

/** Shared V9 shell. Preview callers provide only memory data and selection callbacks. */
export function FormalV9Workspace({ data, selection, onProjectChange, onTimetableChange, source,
  initialWeekStart }: FormalV9WorkspaceProps) {
  const formal = source.kind === 'formal' ? source : null
  const host = formal?.management.host ?? null
  const controller = formal?.management.controller ?? null
  const actions = formal?.management.actions ?? null
  const subjectPort = formal?.subjectPort ?? null
  const classPort = formal?.classPort ?? null
  const academicPort = formal?.academicPort ?? null
  const lessonPort = formal?.lessonPort ?? null
  const project = data.projects.find((item) => item.id === selection.projectId)
  const timetables = data.timetables.filter((item) => item.projectId === project?.id)
  const timetable = timetables.find((item) => item.id === selection.timetableId)
  const units = useMemo(() => data.teachingUnits.filter((item) => item.projectId === project?.id),
    [data, project?.id])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(initialWeekStart ?? new Date()))
  const [activePage, setActivePage] = useState<WorkspacePage>('dashboard')
  const [headerUnitSelection, setHeaderUnitSelection] = useState<{
    projectId: string | null; timetableId: string | null; teachingUnitId: string | null
  }>({ projectId: null, timetableId: null, teachingUnitId: null })
  const [resource, setResource] = useState<ResourceMode | null>(null)
  const [lifecycle, setLifecycle] = useState<LifecycleDialog | null>(null)
  const [pendingTerm, setPendingTerm] = useState<PendingTerm | null>(null)
  const [tableDialog, setTableDialog] = useState<TimetableDialog | null>(null)
  const [addChoiceOpen, setAddChoiceOpen] = useState(false)
  const [lessonEditor, setLessonEditor] = useState<FormalLessonEditorV9Session | null>(null)
  const [tableError, setTableError] = useState('')
  const [tableNotice, setTableNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const subjectTrigger = useRef<HTMLButtonElement>(null)
  const classTrigger = useRef<HTMLButtonElement>(null)
  const lessonResourceCreated = useRef<((id: string) => void) | null>(null)
  const modalTrigger = useRef<HTMLElement | null>(null)
  const modalReturnSelector = useRef('')
  const restoreModalFocus = useRef(false)
  const pending = Boolean(host?.pending || submitting || subjectPort?.pending || classPort?.pending
    || academicPort?.pending || lessonPort?.pending)
  const hostWritable = Boolean(host?.status === 'active' && host.writable)
  const writable = hostWritable && !pending
  const modalOpen = Boolean(resource || lifecycle || tableDialog || addChoiceOpen || lessonEditor)
  const status: StorageStatus = source.kind === 'preview' ? 'conflict'
    : host?.status === 'conflict' ? 'conflict'
      : host?.status === 'write-error' ? 'write-error' : writable ? 'saved' : 'read-error'
  const storageLabel = pending ? '正在確認儲存至此裝置…'
    : writable ? '已儲存至此裝置'
      : source.kind === 'preview' ? '資料目前為唯讀，已暫停寫入'
        : host?.status === 'conflict' ? '偵測到多分頁衝突'
          : host?.status === 'active' && !host.errorCode ? '正在驗證資料寫入資格…' : '資料目前為唯讀，已暫停寫入'
  const headerTeachingUnitId = activePage === 'timetable'
    && headerUnitSelection.projectId === selection.projectId
    && headerUnitSelection.timetableId === selection.timetableId
    && units.some((item) => item.id === headerUnitSelection.teachingUnitId)
    ? headerUnitSelection.teachingUnitId : null
  const readScope = useMemo(() => ({ ...selection, teachingUnitId: headerTeachingUnitId }),
    [headerTeachingUnitId, selection])
  const calendarDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index - 1)),
    [weekStart])
  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const weekResult = useMemo(() => data ? resolveV9WeekResult(data, readScope, calendarDates)
    : { status: 'invalid-document' as const, value: calendarDates.map((date) => ({ date, lessons: [] })) },
  [calendarDates, data, readScope])
  const eventResult = useMemo(() => data ? selectV9ResolvedEventsResult(data, readScope)
    : { status: 'invalid-document' as const, value: [] }, [data, readScope])
  const headerResult = useMemo(() => data ? selectV9HeaderWeekPatternResult(data, readScope, weekStart)
    : { status: 'invalid-document' as const, value: null }, [data, readScope, weekStart])
  const calendarReadStatus: V9ReadStatus = weekResult.status === 'ready' ? eventResult.status : weekResult.status
  const displayDays = useMemo(() => toScheduleDisplayDays(weekResult.value), [weekResult.value])
  const displayEvents = useMemo(() => toScheduleDisplayEvents(eventResult.value), [eventResult.value])
  const displaySchools = useMemo(() => data?.schools.filter((item) => item.projectId === project?.id)
    .map(({ id, name }) => ({ id, name })) ?? [], [data, project?.id])
  const displayUnits = useMemo(() => units.map(({ id, schoolId, name, schoolLevel }) =>
    ({ id, schoolId, name, schoolLevel })), [units])
  const selectHeaderUnit = useCallback((teachingUnitId: string | null) => {
    if (teachingUnitId !== null && !units.some((item) => item.id === teachingUnitId)) return
    setHeaderUnitSelection((current) => current.projectId === selection.projectId
      && current.timetableId === selection.timetableId && current.teachingUnitId === teachingUnitId
      ? current : { projectId: selection.projectId, timetableId: selection.timetableId, teachingUnitId })
  }, [selection.projectId, selection.timetableId, units])
  const viewData: ProjectLifecycleViewData | null = useMemo(() => data ? { projects: data.projects,
    activeProjectId: selection.projectId, teachingUnits: data.teachingUnits,
    migrationWarnings: data.migrationWarnings } : null, [data, selection.projectId])
  const queueCreatedTerm = (result: FormalProjectTimetableV9Result) => {
    const projectId = result.selection.projectId
    if (!projectId || projectId !== result.document.activeProjectId
      || result.document.projects.find((item) => item.id === projectId)?.term !== null) return
    setPendingTerm({ projectId, raw: result.receipt.raw, revision: result.receipt.revision,
      attemptId: result.receipt.attemptId })
  }
  const projectActions = actions ? lifecycleActions(actions, undefined, queueCreatedTerm) : null
  const clearFeedback = () => {
    subjectPort?.clearFeedback(); classPort?.clearFeedback(); academicPort?.clearFeedback(); setTableNotice('')
  }
  const closeLifecycle = () => { restoreModalFocus.current = true; setLifecycle(null) }
  const closeTimetable = () => { restoreModalFocus.current = true; setTableDialog(null) }
  useEffect(() => {
    if (lifecycle || tableDialog || !restoreModalFocus.current) return
    restoreModalFocus.current = false
    const original = modalTrigger.current
    const target = original?.isConnected ? original : document.querySelector<HTMLElement>(modalReturnSelector.current)
    if (target && !target.matches(':disabled')) target.focus()
    else document.querySelector<HTMLElement>('.brand-toggle')?.focus()
  }, [lifecycle, tableDialog])
  useEffect(() => {
    if (!pendingTerm || !host || host.revision < pendingTerm.revision || lifecycle || modalOpen || pending) return
    const valid = host.revision === pendingTerm.revision
      && host.receipt?.revision === pendingTerm.revision
      && host.receipt.raw === pendingTerm.raw
      && host.receipt.attemptId === pendingTerm.attemptId
      && JSON.stringify(data) === pendingTerm.raw
      && selection.projectId === pendingTerm.projectId
      && data.projects.find((item) => item.id === pendingTerm.projectId)?.term === null
    setPendingTerm(null)
    if (!valid || !actions || !viewData) return
    modalReturnSelector.current = '.sidebar [aria-label="專案設定"]'
    modalTrigger.current = document.querySelector<HTMLElement>('.topbar-add > button')
    setLifecycle({ initialPage: 'term', data: viewData,
      actions: lifecycleActions(actions, closeLifecycle),
      deletionMessage: (id) => deletionMessage(viewData, actions, id) })
  }, [pendingTerm, data, host, selection.projectId, lifecycle, modalOpen, pending, actions, viewData])
  const openLifecycle = (initialPage: 'root' | 'blank') => {
    if (!actions || !controller || !viewData || modalOpen || pending) return
    clearFeedback()
    modalReturnSelector.current = initialPage === 'blank' ? '.topbar-add > button' : '.sidebar [aria-label="專案設定"]'
    modalTrigger.current = document.querySelector<HTMLElement>(modalReturnSelector.current)
    const snapshot = viewData
    setLifecycle({ initialPage, data: snapshot, actions: lifecycleActions(actions, closeLifecycle, queueCreatedTerm),
      deletionMessage: (id) => deletionMessage(snapshot, actions, id) })
  }
  const openTimetable = (mode: 'create' | 'edit') => {
    if (!actions || !project || !writable || modalOpen || (mode === 'edit' && !timetable)) return
    modalReturnSelector.current = mode === 'create' ? '.topbar-add > button' : '.timetable-control-row > button'
    modalTrigger.current = mode === 'create' ? document.querySelector<HTMLElement>('.topbar-add > button')
      : document.activeElement instanceof HTMLElement ? document.activeElement : null
    const impact = timetable ? actions.timetable.deletionImpact(project.id, timetable.id) : null
    setTableError('')
    setTableNotice('')
    setTableDialog({ mode, projectId: project.id, source: mode === 'edit' ? timetable : undefined, defaultDate: toDateKey(new Date()),
      actions: actions.timetable, impact: { lessons: impact?.recurringLessons ?? 0,
        overrides: impact?.changes ?? 0, oneOffLessons: impact?.oneOffLessons ?? 0 } })
  }
  const writeTimetable = async (operation: () => Promise<unknown>, message: string) => {
    if (!writable || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    setTableError('')
    setTableNotice('')
    try {
      await operation()
      setTableNotice(message)
      closeTimetable()
    } catch (cause) { setTableError(cause instanceof Error ? cause.message : '課表尚未確認儲存，草稿已保留。') }
    finally { submittingRef.current = false; setSubmitting(false) }
  }
  const submitTimetable = (details: TimetableDetails) => {
    if (!tableDialog) return
    if (!details.teacherName?.trim()) { setTableError('請填寫授課教師姓名。'); return }
    const draft = { name: details.name, teacherName: details.teacherName }
    void writeTimetable(() => tableDialog.mode === 'create'
      ? tableDialog.actions.create(tableDialog.projectId, draft)
      : tableDialog.actions.update(tableDialog.projectId, tableDialog.source!.id, draft), '已儲存課表資訊。')
  }
  const closeResource = () => {
    const fromLessonEditor = Boolean(lessonResourceCreated.current)
    lessonResourceCreated.current = null
    const trigger = resource === 'subjects' ? subjectTrigger : classTrigger
    setResource(null)
    if (!fromLessonEditor) trigger.current?.focus()
  }
  const canAddLesson = Boolean(source.kind === 'formal' && writable && project?.term && timetable
    && lessonPort?.open(null))
  const openAddChoice = () => {
    if (!canAddLesson || modalOpen || pending) return
    setAddChoiceOpen(true)
  }
  const openLesson = (lessonId: string | null) => {
    if (!lessonPort || !writable || pending) return
    const session = lessonPort.open(lessonId)
    if (!session) return
    setAddChoiceOpen(false)
    setLessonEditor(session)
  }

  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
    <Sidebar activePage={activePage} onNavigate={(page) => {
      if (modalOpen || pending) return
      if (page === 'subjects' || page === 'classes') { clearFeedback(); setResource(page) }
      if (page === 'dashboard' || page === 'timetable') {
        clearFeedback(); setResource(null); setActivePage(page)
        if (page === 'dashboard') setHeaderUnitSelection({ projectId: selection.projectId,
          timetableId: selection.timetableId, teachingUnitId: null })
      }
      if (page === 'settings') openLifecycle('root')
    }} open={sidebarOpen} onOpen={() => setSidebarOpen(true)} onClose={() => setSidebarOpen(false)}
      collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} storageStatus={status} storageLabel={storageLabel}
      projects={data.projects} activeProjectId={selection.projectId} projectSelectionDisabled={modalOpen || pending}
      onProjectChange={(id) => { if (modalOpen || pending) return; clearFeedback(); onProjectChange(id) }}
      workspaceUnavailableReasons={V9_WORKSPACE_UNAVAILABLE}
      canManageResources={Boolean(project) && writable} resourceMode={resource}
      subjectCount={subjectPort?.view?.configuredSubjects.length ?? 0} classCount={classPort?.classes.length ?? 0}
      subjectManagerButtonRef={subjectTrigger} classManagerButtonRef={classTrigger} />
    <main className={`main-area ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
      <Topbar weekStart={weekStart} onWeekChange={(offset) => setWeekStart(addDays(weekStart, offset))}
        onToday={() => setWeekStart(startOfWeek(initialWeekStart ?? new Date()))}
        onMenu={() => setSidebarOpen(true)} readOnly={!hostWritable}
        addActions={source.kind === 'preview' ? [] : [{ id: 'project', label: '新增專案', onSelect: () => openLifecycle('blank'), disabled: modalOpen || pending },
          { id: 'timetable', label: '新增空白課表', onSelect: () => openTimetable('create'),
            disabled: !project || modalOpen || pending, reason: !project ? '請先建立課表專案。' : undefined }]} />
      {viewData && (!project && projectActions
        ? <FirstUseView data={viewData} actions={projectActions} pending={pending} readOnly={!writable} protectDrafts />
        : project ? <div className="content"><section className="page-heading">
          <div><h1>{activePage === 'dashboard' ? '總覽' : '課表'}</h1></div><div className="page-heading-side">
            {timetables.length > 0 && <TimetableControls timetables={timetables} selected={timetable}
              canManage={hostWritable} selectionDisabled={modalOpen || pending} notice={tableNotice}
              onSelect={(id) => { if (modalOpen || pending) return; clearFeedback(); onTimetableChange(id) }}
              onEdit={() => openTimetable('edit')} />}
            {activePage === 'timetable' && headerResult.status === 'ready' && headerResult.value
              && <div className="week-pill"><strong>{headerResult.value} 週</strong></div>}
          </div>
        </section>
        {activePage === 'dashboard' && <section className="panel overview-panel">
          <div className="panel-heading"><div><h2>本週行事曆</h2><p>課程、會議與活動依實際日期和時間排列，包含週末與已取消課程。</p></div>
            {source.kind === 'formal' && timetable && <button className="primary-button" data-course-add
              onClick={openAddChoice} disabled={!canAddLesson}><Plus size={16} />新增課程</button>}</div>
          <OverviewCalendar mode="resolved" weekStart={weekStart} readStatus={calendarReadStatus}
            days={displayDays} events={displayEvents}
            onLessonClick={source.kind === 'formal' && writable ? (id) => openLesson(id) : undefined} />
        </section>}
        {activePage === 'timetable' && <section className="panel timetable-panel">
          <div className="panel-heading"><div><h2>跨校週課表</h2><p>依各校學制的實際節次與輪週設定逐日整合。</p></div>
            {source.kind === 'formal' && timetable && <button className="primary-button" data-course-add
              onClick={openAddChoice} disabled={!canAddLesson}><Plus size={16} />新增課程</button>}</div>
          <MultiSchoolSchedule key={timetable?.id ?? project.id} mode="resolved" weekDays={weekDays}
            readStatus={weekResult.status} days={displayDays} schools={displaySchools}
            teachingUnits={displayUnits} onHeaderTeachingUnitChange={selectHeaderUnit}
            onLessonClick={source.kind === 'formal' && writable ? (id) => openLesson(id) : undefined} />
        </section>}
        </div> : null)}
    </main>
    {lifecycle && academicPort && <ProjectLifecycleView {...lifecycle} pending={pending} readOnly={!writable} protectDrafts
      onClose={closeLifecycle} renderAcademicSettings={(page) =>
        <FormalAcademicSettingsV9 port={academicPort} page={page} />} />}
    {tableDialog?.mode === 'create' && <TimetableForm error={tableError} onSubmit={submitTimetable}
      submitting={pending} readOnly={!writable} protectDrafts onClose={closeTimetable} />}
    {tableDialog?.mode === 'edit' && tableDialog.source && <TimetableInfoDialog timetable={tableDialog.source}
      defaultDate={tableDialog.defaultDate} error={tableError} submitting={pending} readOnly={!writable}
      copyMode="settings" deleteMode="guarded" deleteImpact={tableDialog.impact} onEdit={submitTimetable}
      onCopy={(input) => { void writeTimetable(() => tableDialog.actions.copySettings(tableDialog.projectId,
        tableDialog.source!.id, input), '已複製並儲存課表設定。') }}
      onDelete={() => { void writeTimetable(() => tableDialog.actions.delete(tableDialog.projectId,
        tableDialog.source!.id), '已刪除並儲存課表。') }} onClose={closeTimetable} />}
    {addChoiceOpen && <AddChoiceDialog initialFocus={null} canAddLesson={canAddLesson}
      addLessonReason="請先完成目前專案、教師課表與課程基本資料。" canAddOneOff={false}
      addOneOffReason="此功能尚未接入正式 V9 資料路徑。" onAddLesson={() => openLesson(null)}
      onAddOneOff={() => undefined} onClose={() => setAddChoiceOpen(false)} />}
    {lessonEditor && <LessonEditor key={`${lessonEditor.lessonId ?? 'new'}:${selection.projectId}:${selection.timetableId}`}
      data={lessonEditor.data} fixedLessonPort={lessonEditor.port} timetableId={selection.timetableId ?? undefined}
      lessonId={lessonEditor.lessonId} storageStatus={writable ? 'saved' : 'conflict'}
      onManageResource={(mode, context, onCreated) => {
        if (!subjectPort || !classPort || pending) return
        lessonResourceCreated.current = onCreated
        if (mode === 'subjects') subjectPort.selectTeachingUnit(context.teachingUnitId)
        else classPort.selectTeachingUnit(context.teachingUnitId)
        setResource(mode)
      }} onClose={() => { if (!lessonPort?.pending && !resource) setLessonEditor(null) }}
      onSaved={() => setLessonEditor(null)} />}
    {resource === 'subjects' && subjectPort && <CourseResourceManagerDialog mode="subjects" subjectPort={subjectPort}
      onCreated={(_, id) => lessonResourceCreated.current?.(id)} onClose={closeResource} />}
    {resource === 'classes' && classPort && <CourseResourceManagerDialog mode="classes" classPort={classPort}
      onCreated={(_, id) => lessonResourceCreated.current?.(id)} onClose={closeResource} />}
  </div>
}

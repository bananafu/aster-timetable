import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormalAcademicSettingsV9 } from './components/FormalAcademicSettingsV9'
import { CourseResourceManagerDialog } from './components/CourseResourceManager'
import { FirstUseView, ProjectLifecycleView, type ProjectLifecycleViewData } from './components/ProjectLifecycleView'
import { Sidebar } from './components/Sidebar'
import { TimetableControls, TimetableForm, TimetableInfoDialog } from './components/TimetableControls'
import { Topbar } from './components/Topbar'
import { toFormalV9HostPort } from './formalRuntime'
import type { ProjectLifecycleActions } from './formalV7ProjectTimetableActions'
import { useFormalAcademicSettingsV9Adapter } from './hooks/useFormalAcademicSettingsV9Adapter'
import { useFormalClassManagementV9Adapter } from './hooks/useFormalClassManagementV9Adapter'
import { useFormalProjectTimetableV9Adapter } from './hooks/useFormalProjectTimetableV9Adapter'
import { useFormalSubjectManagementV9Adapter } from './hooks/useFormalSubjectManagementV9Adapter'
import type { StorageStatus } from './hooks/useLocalStorage'
import { addDays, startOfWeek, toDateKey } from './lib/date'
import type { TimetableDetails } from './data/timetablesV6'
import type { Timetable } from './types'

type Management = ReturnType<typeof useFormalProjectTimetableV9Adapter>
type Actions = NonNullable<Management['actions']>
type ResourceMode = 'subjects' | 'classes'
type TimetableDialog = {
  mode: 'create' | 'edit'
  projectId: string
  source?: Timetable
  defaultDate: string
  actions: Actions['timetable']
  impact: { lessons: number; overrides: number; oneOffLessons: number }
}
type LifecycleDialog = { initialPage: 'root' | 'blank'; data: ProjectLifecycleViewData;
  actions: ProjectLifecycleActions; deletionMessage: (id: string) => string }

function lifecycleActions(actions: Actions, onDeleted?: () => void): ProjectLifecycleActions {
  return {
    runtime: 'v9', creationMode: 'empty-v9', copyRequiresSourceEffectiveDate: true,
    createProject: async (input) => { await actions.project.createEmptyFromName(input) },
    copyProject: async (input) => { await actions.project.copy(input) },
    archiveProject: async (id) => { await actions.project.archive(id) },
    reactivateProject: async (id) => { await actions.project.reactivate(id) },
    deleteProject: async (id) => { await actions.project.delete(id); onDeleted?.() },
  }
}

/** Formal management tree. Stage 0 deliberately does not mount this composition yet. */
export function FormalV9Composition() {
  // This adapter owns the one existing V9 Host; resource adapters share its port.
  const management = useFormalProjectTimetableV9Adapter()
  const { host, controller, actions } = management
  const selection = controller?.selection ?? management.selection
  const data = host.data
  const project = data?.projects.find((item) => item.id === selection.projectId)
  const timetables = data?.timetables.filter((item) => item.projectId === project?.id) ?? []
  const timetable = timetables.find((item) => item.id === selection.timetableId)
  const [unitSelection, setUnitSelection] = useState<{ projectId: string | null; id: string | null }>({ projectId: null, id: null })
  const units = data?.teachingUnits.filter((item) => item.projectId === project?.id) ?? []
  const sameProject = unitSelection.projectId === project?.id
  const unit = sameProject && unitSelection.id === null ? undefined
    : (sameProject ? units.find((item) => item.id === unitSelection.id) : undefined) ?? units[0]
  const scope = { ...selection, teachingUnitId: unit?.id ?? null }
  const port = useMemo(() => toFormalV9HostPort(host), [host])
  const selectUnit = (next: typeof scope) => {
    if (next.projectId !== selection.projectId || next.timetableId !== selection.timetableId) return
    if (next.teachingUnitId !== null && !units.some((item) => item.id === next.teachingUnitId)) return
    setUnitSelection({ projectId: next.projectId, id: next.teachingUnitId })
  }
  const subjectPort = useFormalSubjectManagementV9Adapter(port, scope, selectUnit)
  const classPort = useFormalClassManagementV9Adapter(port, scope, (next) => {
    selectUnit({ ...selection, teachingUnitId: next.teachingUnitId, projectId: next.projectId })
  })
  const selectAcademicUnit = useCallback((next: typeof scope) => {
    if (next.projectId !== selection.projectId || next.timetableId !== selection.timetableId) return
    setUnitSelection({ projectId: next.projectId, id: next.teachingUnitId })
  }, [selection.projectId, selection.timetableId])
  const academicPort = useFormalAcademicSettingsV9Adapter(port, scope, selectAcademicUnit)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [resource, setResource] = useState<ResourceMode | null>(null)
  const [lifecycle, setLifecycle] = useState<LifecycleDialog | null>(null)
  const [tableDialog, setTableDialog] = useState<TimetableDialog | null>(null)
  const [tableError, setTableError] = useState('')
  const [tableNotice, setTableNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const subjectTrigger = useRef<HTMLButtonElement>(null)
  const classTrigger = useRef<HTMLButtonElement>(null)
  const modalTrigger = useRef<HTMLElement | null>(null)
  const modalReturnSelector = useRef('')
  const restoreModalFocus = useRef(false)
  const pending = host.pending || submitting || subjectPort.pending || classPort.pending || academicPort.pending
  const hostWritable = host.status === 'active' && host.writable
  const writable = hostWritable && !pending
  const modalOpen = Boolean(resource || lifecycle || tableDialog)
  const status: StorageStatus = host.status === 'conflict' ? 'conflict'
    : host.status === 'write-error' ? 'write-error' : writable ? 'saved' : 'read-error'
  const storageLabel = pending ? '正在確認儲存至此裝置…'
    : writable ? '已儲存至此裝置'
      : host.status === 'conflict' ? '偵測到多分頁衝突'
        : host.status === 'active' && !host.errorCode ? '正在驗證資料寫入資格…' : '資料目前為唯讀，已暫停寫入'
  const viewData: ProjectLifecycleViewData | null = data ? { projects: data.projects,
    activeProjectId: selection.projectId, teachingUnits: data.teachingUnits,
    migrationWarnings: data.migrationWarnings } : null
  const projectActions = actions ? lifecycleActions(actions) : null
  const clearFeedback = () => {
    subjectPort.clearFeedback(); classPort.clearFeedback(); academicPort.clearFeedback(); setTableNotice('')
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
  const openLifecycle = (initialPage: 'root' | 'blank') => {
    if (!actions || !controller || !viewData || modalOpen || pending) return
    clearFeedback()
    modalReturnSelector.current = initialPage === 'blank' ? '.topbar-add > button' : '.sidebar [aria-label="專案設定"]'
    modalTrigger.current = document.querySelector<HTMLElement>(modalReturnSelector.current)
    const snapshot = viewData
    setLifecycle({ initialPage, data: snapshot, actions: lifecycleActions(actions, closeLifecycle), deletionMessage: (id) => {
      const target = snapshot.projects.find((item) => item.id === id)
      const impact = actions.project.deletionImpact(id)
      return `永久刪除「${target?.name ?? ''}」？\n目前有 ${impact.timetables} 份教師課表、${impact.subjects} 個科目、${impact.classes} 個班級、${impact.recurringLessons} 筆固定課程、${impact.oneOffLessons} 筆單日課程、${impact.events} 筆事件及 ${impact.teachingProgress} 筆進度。\n僅能刪除無教學依賴的空白專案，不會級聯刪除其他資料。`
    } })
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
    const trigger = resource === 'subjects' ? subjectTrigger : classTrigger
    setResource(null)
    trigger.current?.focus()
  }

  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
    <Sidebar activePage="dashboard" onNavigate={(page) => {
      if (modalOpen || pending) return
      if (page === 'subjects' || page === 'classes') { clearFeedback(); setResource(page) }
      if (page === 'settings') openLifecycle('root')
    }} open={sidebarOpen} onOpen={() => setSidebarOpen(true)} onClose={() => setSidebarOpen(false)}
      collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} storageStatus={status} storageLabel={storageLabel}
      projects={data?.projects ?? []} activeProjectId={selection.projectId} projectSelectionDisabled={modalOpen || pending}
      onProjectChange={(id) => { if (modalOpen || pending) return; clearFeedback(); actions?.selectProject(id) }}
      workspaceUnavailableReason="此功能尚未接入正式 V9 資料路徑。"
      canManageResources={Boolean(project) && writable} resourceMode={resource}
      subjectCount={subjectPort.view?.configuredSubjects.length ?? 0} classCount={classPort.classes.length}
      subjectManagerButtonRef={subjectTrigger} classManagerButtonRef={classTrigger} />
    <main className={`main-area ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
      <Topbar weekStart={weekStart} onWeekChange={(offset) => setWeekStart(addDays(weekStart, offset))}
        onToday={() => setWeekStart(startOfWeek(new Date()))} onMenu={() => setSidebarOpen(true)} readOnly={!hostWritable}
        addActions={[{ id: 'project', label: '新增專案', onSelect: () => openLifecycle('blank'), disabled: modalOpen || pending },
          { id: 'timetable', label: '新增空白課表', onSelect: () => openTimetable('create'),
            disabled: !project || modalOpen || pending, reason: !project ? '請先建立課表專案。' : undefined }]} />
      {viewData && projectActions && (!project
        ? <FirstUseView data={viewData} actions={projectActions} pending={pending} readOnly={!writable} protectDrafts />
        : <div className="content"><section className="page-heading">
          <div><h1>總覽</h1></div><div className="page-heading-side">
            {timetables.length > 0 && <TimetableControls timetables={timetables} selected={timetable}
              canManage={hostWritable} selectionDisabled={modalOpen || pending} notice={tableNotice}
              onSelect={(id) => { if (modalOpen || pending) return; clearFeedback(); actions?.selectTimetable(id) }}
              onEdit={() => openTimetable('edit')} />}
          </div>
        </section></div>)}
    </main>
    {lifecycle && <ProjectLifecycleView {...lifecycle} pending={pending} readOnly={!writable} protectDrafts
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
    {resource === 'subjects' && <CourseResourceManagerDialog mode="subjects" subjectPort={subjectPort}
      onClose={closeResource} />}
    {resource === 'classes' && <CourseResourceManagerDialog mode="classes" classPort={classPort}
      onClose={closeResource} />}
  </div>
}

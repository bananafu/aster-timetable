import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { BookOpenCheck, CalendarClock, CalendarDays, CalendarPlus, Clock3, MapPin, Plus } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { Modal } from './components/Modal'
import { MultiSchoolSchedule } from './components/MultiSchoolSchedule'
import { OverviewCalendar } from './components/OverviewCalendar'
import { FirstUse, ProjectLifecycleModal } from './components/ProjectLifecycle'
import { LessonEditor } from './components/LessonEditor'
import { OneOffLessonEditor } from './components/OneOffLessonEditor'
import { TimetableControls, TimetableInfoDialog, TimetableForm, type TimetableCopyDetails } from './components/TimetableControls'
import { CourseResourceManagerDialog } from './components/CourseResourceManager'
import { projectToLegacyView, switchActiveProject } from './data/projectRuntime'
import { copyTimetable, createTimetable, updateTimetable, type TimetableDetails } from './data/timetablesV6'
import { deleteTimetable } from './data/deleteTimetableV7'
import { selectDisplayProject, selectProjectSubjectsForLevel } from './data/subjectSelectorsV8'
import { isCompatibleAppDataV7 } from './data/validators/v7'
import { useAppDataV4 } from './hooks/useAppDataV4'
import { useOneOffPersistence } from './hooks/useOneOffPersistence'
import { useResourceManagementSession } from './hooks/useResourceManagementSession'
import { type StorageControls, type StorageStatus } from './hooks/useLocalStorage'
import { addDays, getWeekInfo, startOfWeek, toDateKey } from './lib/date'
import { getNextUpcomingEvent } from './lib/schedule'
import { classifyEventTerm, getTermForDate } from './lib/academic'
import { getTodayTeachingSummaryV4, type TodayTeachingSummaryV4 } from './lib/scheduleV4'
import type { LessonDragIntent } from './lib/lessonDrag'
import { type AppData, type AppDataV4, type CalendarEvent, type ModalKind, type Timetable } from './types'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

type TimetableDialog = {
  mode: 'create'
  projectId: string
} | {
  mode: 'edit'
  projectId: string
  timetableId: string
  source: Timetable
  original: TimetableDetails
  sourceFingerprint: string
  deleteFingerprint: string
  deleteImpact: ReturnType<typeof timetableDeleteImpact>
  defaultDate: string
}

type ResourceMode = 'classes' | 'subjects'
type ResourceDialogSource = 'sidebar' | 'lesson-editor' | 'one-off-editor'
type ResourceDialogState = { mode: ResourceMode; source: ResourceDialogSource }
type AddChoiceFocus = 'lesson' | 'one-off' | null
type OneOffEditorState = { projectId: string; timetableId: string; date?: string; id?: string; source: 'add-choice' | 'schedule' }

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

function timetableDeleteImpact(data: AppDataV4, projectId: string, timetableId: string) {
  return {
    lessons: data.recurringLessons.filter((item) => item.projectId === projectId && item.timetableId === timetableId).length,
    overrides: data.overrides.filter((item) => item.projectId === projectId && item.timetableId === timetableId).length,
    oneOffLessons: (data.oneOffLessons ?? []).filter((item) => item.projectId === projectId && item.timetableId === timetableId).length,
  }
}

function timetableDeleteFingerprint(data: AppDataV4, projectId: string, timetableId: string): string | null {
  const project = data.projects.find((item) => item.id === projectId)
  const timetable = data.timetables?.find((item) => item.id === timetableId && item.projectId === projectId)
  if (!project || !timetable) return null
  const lessons = data.recurringLessons.filter((item) => item.timetableId === timetableId)
  const overrides = data.overrides.filter((item) => item.timetableId === timetableId)
  const lessonIds = new Set(lessons.map((item) => item.id))
  const overrideIds = new Set(overrides.map((item) => item.id))
  return JSON.stringify({ project, timetable, lessons, overrides,
    oneOffLessons: (data.oneOffLessons ?? []).filter((item) => item.timetableId === timetableId),
    warnings: data.migrationWarnings.filter((item) => (item.entityType === 'lesson' && lessonIds.has(item.entityId))
      || (item.entityType === 'override' && overrideIds.has(item.entityId))) })
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
  const resourceSession = useResourceManagementSession(appData, setAppData, storageStatus, storagePersistence)
  const oneOffWrites = useOneOffPersistence(appData, setAppData, storageStatus, storagePersistence)
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
    const hasProjectRuntime = appData.schools.some((school) => school.projectId === appData.activeProjectId)
      && appData.teachingUnits.some((unit) => unit.projectId === appData.activeProjectId)
    if (!hasProjectRuntime) return EMPTY_LEGACY_DATA
    const view = projectToLegacyView(appData, appData.activeProjectId, activeTimetableId ?? undefined)
    return activeTimetableCandidate && !activeTimetableId ? { ...view, courses: [], overrides: [] } : view
  }, [appData, activeTimetableCandidate, activeTimetableId])
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [activePage, setActivePage] = useState('dashboard')
  const [modal, setModal] = useState<ModalKind>(null)
  const [projectLifecycleInitialPage, setProjectLifecycleInitialPage] = useState<'root' | 'blank'>('root')
  const [addChoiceOpen, setAddChoiceOpen] = useState(false)
  const [addChoiceFocus, setAddChoiceFocus] = useState<AddChoiceFocus>(null)
  const [resourceDialog, setResourceDialog] = useState<ResourceDialogState | null>(null)
  const [settingsReturnResource, setSettingsReturnResource] = useState<ResourceDialogState | null>(null)
  const [lessonEditorOpen, setLessonEditorOpen] = useState(false)
  const [oneOffEditor, setOneOffEditor] = useState<OneOffEditorState | null>(null)
  const [oneOffNotice, setOneOffNotice] = useState('')
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null)
  const [selectedLessonDate, setSelectedLessonDate] = useState<string | null>(null)
  const [selectedLessonOverrideId, setSelectedLessonOverrideId] = useState<string | null>(null)
  const [lessonDragIntent, setLessonDragIntent] = useState<LessonDragIntent | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  const [historicalProjectId, setHistoricalProjectId] = useState<string | null>(null)
  const [timetableDialog, setTimetableDialog] = useState<TimetableDialog | null>(null)
  const [timetableError, setTimetableError] = useState('')
  const [timetableNotice, setTimetableNotice] = useState('')
  const [pendingTimetableCopy, setPendingTimetableCopy] = useState<{ projectId: string; timetableId: string; startedRevision: number } | null>(null)
  const [pendingTimetableEdit, setPendingTimetableEdit] = useState<{ projectId: string; timetableId: string; details: TimetableDetails; startedRevision: number } | null>(null)
  const [pendingTimetableDelete, setPendingTimetableDelete] = useState<{ projectId: string; timetableId: string; name: string; expectedData: string; startedRevision: number } | null>(null)
  const copySubmittingRef = useRef(false)
  const editSubmittingRef = useRef(false)
  const deleteSubmittingRef = useRef(false)
  const lessonEditorFromAddRef = useRef(false)
  const resourceCreatedRef = useRef<((id: string) => void) | null>(null)
  const sidebarSubjectManagerButtonRef = useRef<HTMLButtonElement>(null)
  const sidebarClassManagerButtonRef = useRef<HTMLButtonElement>(null)
  const restoreSidebarResourceFocusRef = useRef<ResourceMode | null>(null)

  useEffect(() => {
    if (!resourceDialog && restoreSidebarResourceFocusRef.current) {
      const mode = restoreSidebarResourceFocusRef.current
      restoreSidebarResourceFocusRef.current = null
      ;(mode === 'subjects' ? sidebarSubjectManagerButtonRef.current : sidebarClassManagerButtonRef.current)?.focus()
    }
  }, [resourceDialog])
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setSelectedLessonOverrideId(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    setOneOffEditor(null)
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
    setSelectedLessonOverrideId(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    setTimetableDialog(null)
    setTimetableError('')
    setTimetableNotice(`已複製並儲存「${persistedCopy.name}」。`)
    copySubmittingRef.current = false
    setPendingTimetableCopy(null)
  }, [appData.timetables, pendingTimetableCopy, storagePersistence, storageStatus])
  useEffect(() => {
    if (!pendingTimetableEdit) return
    if (storageStatus === 'conflict' || storageStatus === 'write-error' || storageStatus === 'read-error') {
      setTimetableError(storageStatus === 'conflict' ? '其他分頁已更新資料，課表資訊尚未儲存。請先處理多分頁衝突。' : '課表資訊尚未成功寫入此裝置，請先處理儲存問題。')
      return
    }
    if (storageStatus !== 'saved' || storagePersistence.pending || storagePersistence.revision <= pendingTimetableEdit.startedRevision) return
    const saved = appData.timetables?.find((item) => item.id === pendingTimetableEdit.timetableId && item.projectId === pendingTimetableEdit.projectId)
    editSubmittingRef.current = false
    setPendingTimetableEdit(null)
    if (!saved || saved.name !== pendingTimetableEdit.details.name.trim() || saved.teacherName !== pendingTimetableEdit.details.teacherName?.trim()) {
      setTimetableError('課表資訊與預期結果不同，請重新確認。')
      return
    }
    setTimetableDialog(null)
    setTimetableError('')
    setTimetableNotice(`已儲存「${saved.name}」的課表資訊。`)
  }, [appData.timetables, pendingTimetableEdit, storagePersistence, storageStatus])
  useEffect(() => {
    if (!pendingTimetableDelete) return
    if (storageStatus === 'conflict' || storageStatus === 'write-error' || storageStatus === 'read-error') {
      deleteSubmittingRef.current = false
      setPendingTimetableDelete(null)
      setTimetableError(storageStatus === 'conflict'
        ? '其他分頁已更新資料，刪除尚未確認儲存。請先處理多分頁衝突並重新檢查課表。'
        : '課表刪除尚未成功寫入此裝置。請先處理儲存問題，勿將記憶體中的結果視為已永久刪除。')
      return
    }
    if (storageStatus !== 'saved' || storagePersistence.pending || storagePersistence.revision <= pendingTimetableDelete.startedRevision) return
    deleteSubmittingRef.current = false
    setPendingTimetableDelete(null)
    if (JSON.stringify(appData) !== pendingTimetableDelete.expectedData
      || appData.timetables?.some((item) => item.id === pendingTimetableDelete.timetableId)) {
      setTimetableError('持久化資料與預期刪除結果不同，請重新檢查課表。')
      return
    }
    if (appData.activeProjectId === pendingTimetableDelete.projectId) {
      setTimetableSelection({ projectId: pendingTimetableDelete.projectId,
        timetableId: appData.timetables?.find((item) => item.projectId === pendingTimetableDelete.projectId)?.id ?? null })
    }
    setTimetableDialog(null)
    setTimetableError('')
    setTimetableNotice(`已刪除並儲存「${pendingTimetableDelete.name}」。`)
  }, [appData, pendingTimetableDelete, storagePersistence.pending, storagePersistence.revision, storageStatus])
  const weekDays = useMemo(() => Array.from({ length: 5 }, (_, index) => addDays(weekStart, index)), [weekStart])
  const activeProject = appData.projects.find((project) => project.id === appData.activeProjectId)
  const historicalProject = appData.projects.find((project) => project.id === historicalProjectId && project.archivedAt)
  const displayProject = selectDisplayProject(appData, historicalProjectId)
  const displayTimetables = appData.timetables?.filter((item) => item.projectId === displayProject?.id) ?? []
  const displayTimetableCandidate = timetableSelection.projectId === displayProject?.id
    ? timetableSelection.timetableId : displayTimetables[0]?.id ?? null
  const displayTimetable = displayTimetables.find((item) => item.id === displayTimetableCandidate)
  const weekTerms = weekDays.map((date) => getTermForDate(data, date)).filter((term, index, terms) => term && terms.findIndex((item) => item?.id === term.id) === index)
  const displayedTerm = weekTerms.length === 1 ? weekTerms[0] : undefined
  const weekInfo = displayedTerm ? getWeekInfo(weekDays.find((date) => getTermForDate(data, date)?.id === displayedTerm.id) ?? weekStart, displayedTerm) : null
  const isMixedWeek = weekTerms.length > 1 || weekDays.some((date) => !getTermForDate(data, date))
  const activeTimetable = appData.timetables?.find((item) => item.projectId === activeProject?.id && item.id === activeTimetableId)
  const canCreateTimetable = Boolean(displayProject && !historicalProject && !displayProject.archivedAt
    && storageStatus === 'saved' && !pendingTimetableDelete)
  const createTimetableUnavailableReason = pendingTimetableDelete
    ? '課表刪除仍在儲存，請稍後再建立新課表。'
    : storageStatus !== 'saved'
    ? '資料目前無法安全寫入，請先處理儲存狀態。'
    : historicalProject || displayProject?.archivedAt
      ? '封存專案為唯讀，不能建立課表。'
      : !displayProject
        ? '請先建立課表專案。'
        : ''
  const canAddLesson = canCreateTimetable && Boolean(activeTimetable?.teacherName?.trim()) && !activeTimetable?.teacherNamePending
  const canAddOneOff = Boolean(displayProject && displayTimetable && !historicalProject && !displayProject.archivedAt
    && storageStatus === 'saved' && !storagePersistence.pending && !oneOffWrites.pending)
  const canManageResources = Boolean(displayProject && !historicalProject && !displayProject.archivedAt
    && storageStatus === 'saved' && !storagePersistence.pending)
  const missingTimetableReason = displayTimetables.length === 0 ? '請先建立教師課表。' : '請先選擇教師課表。'
  const addLessonUnavailableReason = createTimetableUnavailableReason || (!activeTimetable
    ? missingTimetableReason
    : activeTimetable.teacherNamePending || !activeTimetable.teacherName?.trim()
      ? '目前課表的授課教師姓名尚待補齊。'
      : '')
  const currentResourceUnit = appData.teachingUnits.find((item) => item.id === resourceSession.view.unitId
    && item.projectId === appData.activeProjectId)
  const selectedSubjectCount = currentResourceUnit
    ? selectProjectSubjectsForLevel(appData, appData.activeProjectId, currentResourceUnit.schoolLevel).length : 0
  const activeProjectUnitIds = new Set(appData.teachingUnits.filter((item) => item.projectId === appData.activeProjectId).map((item) => item.id))
  const activeClassCount = appData.classes.filter((item) => item.projectId === appData.activeProjectId
    && activeProjectUnitIds.has(item.teachingUnitId)).length
  const todaySummary = activeProject && (appData.schemaVersion < 6 || activeTimetable)
    ? getTodayTeachingSummaryV4(appData, activeProject.id, now, activeTimetable?.id)
    : { count: 0, state: 'idle' as const }
  const upcomingEvent = getNextUpcomingEvent(data.events, now)

  const chooseTimetable = (projectId: string, timetableId: string) => {
    if (!appData.timetables?.some((item) => item.id === timetableId && item.projectId === projectId)) return
    setTimetableSelection({ projectId, timetableId })
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setSelectedLessonOverrideId(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    setOneOffEditor(null)
    setOneOffNotice('')
    lessonEditorFromAddRef.current = false
  }

  const openAddChoice = () => {
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setSelectedLessonOverrideId(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    setOneOffEditor(null)
    lessonEditorFromAddRef.current = false
    setAddChoiceFocus(null)
    setAddChoiceOpen(true)
  }

  const openOneOff = (date?: string, id?: string, source: OneOffEditorState['source'] = 'schedule') => {
    if (!canAddOneOff || !displayProject || !displayTimetable) return
    setAddChoiceOpen(false)
    setLessonEditorOpen(false)
    setOneOffNotice('')
    setOneOffEditor({ projectId: displayProject.id, timetableId: displayTimetable.id, date, id, source })
  }

  const openNewProject = () => {
    if (historicalProject || storageStatus !== 'saved') return
    setSettingsReturnResource(null)
    setProjectLifecycleInitialPage('blank')
    setModal('settings')
  }

  const openBlankTimetable = () => {
    if (!canCreateTimetable || !displayProject || pendingTimetableDelete || deleteSubmittingRef.current) return
    setTimetableNotice('')
    setTimetableError('')
    setTimetableDialog({ mode: 'create', projectId: displayProject.id })
  }

  const viewArchivedProject = (projectId: string) => {
    setSettingsReturnResource(null)
    setHistoricalProjectId(projectId)
    setTimetableSelection({ projectId, timetableId: appData.timetables?.find((item) => item.projectId === projectId)?.id ?? null })
    setSelectedLessonId(null)
    setSelectedLessonDate(null)
    setSelectedLessonOverrideId(null)
    setLessonDragIntent(null)
    setLessonEditorOpen(false)
    setOneOffEditor(null)
    setOneOffNotice('')
    setTimetableError('')
    setTimetableNotice('')
    setTimetableDialog(null)
    lessonEditorFromAddRef.current = false
    setAddChoiceOpen(false)
    setActivePage('timetable')
  }

  const submitTimetable = (details: TimetableDetails) => {
    if (!timetableDialog || timetableDialog.projectId !== displayProject?.id || historicalProject || storageStatus !== 'saved') {
      setTimetableError('目前專案無法修改課表資訊。'); return
    }
    try {
      if (timetableDialog.mode === 'create') {
        const id = uid()
        setAppData((current) => createTimetable(current, timetableDialog.projectId, details, id))
        setTimetableSelection({ projectId: timetableDialog.projectId, timetableId: id })
        setSelectedLessonId(null)
        setSelectedLessonDate(null)
        setSelectedLessonOverrideId(null)
        setLessonDragIntent(null)
        setLessonEditorOpen(false)
      } else {
        if (!timetableDialog.timetableId) throw new Error('Timetable does not exist')
        const latest = appData.timetables?.find((item) => item.id === timetableDialog.timetableId && item.projectId === timetableDialog.projectId)
        if (!latest || latest.name !== timetableDialog.original?.name || latest.teacherName !== timetableDialog.original?.teacherName) {
          setTimetableError('課表資訊已變更，請關閉後重新開啟編輯。'); return
        }
        if (editSubmittingRef.current) return
        editSubmittingRef.current = true
        setPendingTimetableEdit({ projectId: timetableDialog.projectId, timetableId: timetableDialog.timetableId, details, startedRevision: storagePersistence.revision })
        setTimetableNotice('')
        setAppData((current) => {
          const currentItem = current.timetables?.find((item) => item.id === timetableDialog.timetableId && item.projectId === timetableDialog.projectId)
          if (!currentItem || currentItem.name !== timetableDialog.original.name || currentItem.teacherName !== timetableDialog.original.teacherName) throw new Error('Timetable changed')
          return updateTimetable(current, timetableDialog.timetableId, details)
        })
        return
      }
      setTimetableDialog(null)
      setTimetableError('')
    } catch (reason) {
      editSubmittingRef.current = false
      setPendingTimetableEdit(null)
      setTimetableError(reason instanceof Error && reason.message.includes('read-only')
        ? '封存或不存在的專案不可修改課表。' : '課表名稱與授課教師姓名不正確，或課表資料已變更。')
    }
  }

  const submitTimetableCopy = (details: TimetableCopyDetails) => {
    if (copySubmittingRef.current) return
    if (!timetableDialog || timetableDialog.mode !== 'edit' || timetableDialog.projectId !== displayProject?.id || historicalProject || storageStatus !== 'saved') {
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
      const id = uid()
      setPendingTimetableCopy({ projectId: timetableDialog.projectId, timetableId: id, startedRevision: storagePersistence.revision })
      setTimetableError('')
      setTimetableNotice('')
      setAppData((current) => {
        if (timetableCopySourceFingerprint(current, timetableDialog.projectId, timetableDialog.timetableId) !== timetableDialog.sourceFingerprint) throw new Error('Source changed')
        return copyTimetable(current, { projectId: timetableDialog.projectId, sourceTimetableId: timetableDialog.timetableId, baseDate: details.baseDate, name: details.name, teacherName: details.teacherName }, (() => { let first = true; return () => { if (first) { first = false; return id } return uid() } })())
      })
    } catch (reason) {
      copySubmittingRef.current = false
      setPendingTimetableCopy(null)
      const message = reason instanceof Error ? reason.message : ''
      setTimetableError(message.includes('Base date')
        ? '請輸入真實有效的基準日期。'
        : message.includes('name') || message.includes('teacher')
          ? '課表名稱與授課教師姓名不可空白。'
          : '課表資料已變更或不符合安全規則，未建立副本。')
    }
  }

  const submitTimetableDelete = () => {
    if (deleteSubmittingRef.current) return
    if (!timetableDialog || timetableDialog.mode !== 'edit' || historicalProject || storageStatus !== 'saved'
      || storagePersistence.pending || timetableDialog.projectId !== appData.activeProjectId
      || timetableDialog.projectId !== displayProject?.id || timetableDialog.timetableId !== displayTimetable?.id) {
      setTimetableError('目前專案或課表已切換，或資料尚未完成儲存；請重新確認後再刪除。')
      return
    }
    if (timetableDeleteFingerprint(appData, timetableDialog.projectId, timetableDialog.timetableId) !== timetableDialog.deleteFingerprint) {
      setTimetableError('課表內容已變更，請關閉視窗後重新檢視刪除範圍。')
      return
    }
    try {
      deleteSubmittingRef.current = true
      let expectedData = ''
      setTimetableError('')
      setTimetableNotice('')
      setAppData((current) => {
        if (!isCompatibleAppDataV7(current) || current.activeProjectId !== timetableDialog.projectId
          || timetableDeleteFingerprint(current, timetableDialog.projectId, timetableDialog.timetableId) !== timetableDialog.deleteFingerprint) {
          throw new Error('課表或資料已變更，請重新開啟刪除確認。')
        }
        const next = deleteTimetable(current, timetableDialog.projectId, timetableDialog.timetableId)
        expectedData = JSON.stringify(next)
        return next
      })
      if (!expectedData) throw new Error('刪除未通過安全更新驗證。')
      setPendingTimetableDelete({ projectId: timetableDialog.projectId, timetableId: timetableDialog.timetableId,
        name: timetableDialog.source.name, expectedData, startedRevision: storagePersistence.revision })
    } catch (reason) {
      deleteSubmittingRef.current = false
      setPendingTimetableDelete(null)
      setTimetableError(reason instanceof Error ? reason.message : '無法安全刪除課表，請重新確認。')
    }
  }

  const switchProject = (projectId: string) => {
    const project = appData.projects.find((item) => item.id === projectId && !item.archivedAt)
    if (!project) return
    const applySwitch = () => {
      setResourceDialog(null)
      setSettingsReturnResource(null)
      setAppData((current) => switchActiveProject(current, projectId))
      setHistoricalProjectId(null)
      setTimetableSelection({ projectId, timetableId: appData.timetables?.find((item) => item.projectId === projectId)?.id ?? null })
      setSelectedLessonId(null)
      setSelectedLessonDate(null)
      setSelectedLessonOverrideId(null)
      setLessonDragIntent(null)
      setLessonEditorOpen(false)
      setOneOffEditor(null)
      setOneOffNotice('')
      setTimetableError('')
      setTimetableNotice('')
      lessonEditorFromAddRef.current = false
      setAddChoiceOpen(false)
      setTimetableDialog(null)
      setModal(null)
    }
    if (resourceDialog) resourceSession.requestTransition(applySwitch)
    else applySwitch()
  }

  const closeResourceManager = () => {
    if (!resourceDialog) return
    const { mode, source } = resourceDialog
    if (source === 'sidebar') restoreSidebarResourceFocusRef.current = mode
    if (source === 'lesson-editor' || source === 'one-off-editor') resourceCreatedRef.current = null
    setResourceDialog(null)
  }

  const openResourceManagerFromEditor = (source: 'lesson-editor' | 'one-off-editor', mode: ResourceMode,
    context: { projectId: string; teachingUnitId: string }, onCreated: (id: string) => void) => {
    const unit = appData.teachingUnits.find((item) => item.id === context.teachingUnitId && item.projectId === context.projectId)
    if (!unit || context.projectId !== appData.activeProjectId || storageStatus !== 'saved' || storagePersistence.pending) return
    resourceSession.requestTransition(() => {
      resourceSession.setView({ projectId: context.projectId, schoolId: unit.schoolId, unitId: unit.id, showClassCreate: false })
      resourceCreatedRef.current = onCreated
      setResourceDialog({ mode, source })
    })
  }

  const openSettingsFromResourceManager = () => {
    if (!resourceDialog) return
    setSettingsReturnResource(resourceDialog)
    setResourceDialog(null)
    setProjectLifecycleInitialPage('root')
    setModal('settings')
  }

  const closeProjectSettings = () => {
    const returning = settingsReturnResource
    setModal(null)
    setProjectLifecycleInitialPage('root')
    setSettingsReturnResource(null)
    if (returning) setResourceDialog(returning)
  }

  const openProjectSettings = () => {
    setSettingsReturnResource(null)
    setProjectLifecycleInitialPage('root')
    setModal('settings')
  }

  const navigateFromSidebar = (page: string) => {
    const navigate = () => {
      setResourceDialog(null)
      if (page === 'classes' || page === 'subjects') {
        if (canManageResources) setResourceDialog({ mode: page, source: 'sidebar' })
        return
      }
      if (page === 'settings') {
        openProjectSettings()
        return
      }
      setHistoricalProjectId(null)
      setActivePage(page)
    }
    if (resourceDialog) resourceSession.requestTransition(navigate)
    else navigate()
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
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
      <Sidebar activePage={activePage} onNavigate={navigateFromSidebar} open={sidebarOpen} onOpen={() => setSidebarOpen(true)} onClose={() => setSidebarOpen(false)} storageStatus={storageStatus} projects={appData.projects} activeProjectId={appData.activeProjectId} onProjectChange={switchProject} canManageResources={canManageResources} resourceMode={resourceDialog?.source === 'sidebar' ? resourceDialog.mode : null} subjectCount={selectedSubjectCount} classCount={activeClassCount} collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} subjectManagerButtonRef={sidebarSubjectManagerButtonRef} classManagerButtonRef={sidebarClassManagerButtonRef} />
      <main className={`main-area ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
        {storageStatus !== 'read-error' && <Topbar weekStart={weekStart} onWeekChange={(days) => setWeekStart(addDays(weekStart, days))} onToday={() => setWeekStart(startOfWeek(new Date()))}
          addActions={[{ id: 'project', label: '新增專案', onSelect: openNewProject },
            { id: 'timetable', label: '新增空白課表', onSelect: openBlankTimetable,
              disabled: !canCreateTimetable, reason: createTimetableUnavailableReason }]}
          onMenu={() => setSidebarOpen(true)} readOnly={Boolean(historicalProject) || storageStatus !== 'saved'} />}
        {storageStatus !== 'saved' && <StorageSafetyNotice status={storageStatus} controls={storageControls} />}
        {storageStatus === 'read-error' ? <section className="content"><div className="panel blocked-editor"><h1>資料尚未載入</h1><p>為避免在不完整資料上編輯，目前已鎖定課表。請先匯出原始 JSON，或經二次確認後重設。</p></div></section> : !displayProject ? <FirstUse data={appData} setData={setAppData} onViewArchived={viewArchivedProject} /> : <>
        <div className="content">
          {historicalProject && <section className="history-mode" role="status"><div><strong>歷史專案・唯讀</strong><span>目前查看「{historicalProject.name}」，不會修改此專案。</span></div><button onClick={() => { setHistoricalProjectId(null); setTimetableSelection({ projectId: appData.activeProjectId, timetableId: appData.timetables?.find((item) => item.projectId === appData.activeProjectId)?.id ?? null }) }}>返回目前專案</button></section>}
          {appData.migrationWarnings.length > 0 && <section className="migration-summary" role="status"><strong>有 {appData.migrationWarnings.length} 筆資料需要確認</strong><span>未歸屬資料已保留，且不會自動套用至課表。</span></section>}
          <section className="page-heading">
            <div><h1>{activePage === 'dashboard' ? '總覽' : activePage === 'timetable' ? '課表' : '會議與活動'}</h1>{activePage !== 'dashboard' && <p>{historicalProject ? '封存專案僅供查看。' : '所有資料都會自動儲存在這台裝置。'}</p>}</div>
            <div className="page-heading-side">
              {(activePage === 'timetable' || activePage === 'dashboard') && displayTimetables.length > 0 && <TimetableControls timetables={displayTimetables} selected={displayTimetable} canManage={!historicalProject && storageStatus === 'saved'} notice={timetableNotice} onSelect={(id) => { setTimetableNotice(''); chooseTimetable(displayProject.id, id) }} onEdit={() => { if (!displayTimetable) return; const sourceFingerprint = timetableCopySourceFingerprint(appData, displayProject.id, displayTimetable.id); const deleteFingerprint = timetableDeleteFingerprint(appData, displayProject.id, displayTimetable.id); if (!sourceFingerprint || !deleteFingerprint) return; setTimetableNotice(''); setTimetableError(''); setTimetableDialog({ mode: 'edit', projectId: displayProject.id, timetableId: displayTimetable.id, source: displayTimetable, original: { name: displayTimetable.name, teacherName: displayTimetable.teacherName }, sourceFingerprint, deleteFingerprint, deleteImpact: timetableDeleteImpact(appData, displayProject.id, displayTimetable.id), defaultDate: toDateKey(new Date()) }) }} />}
              <div className="week-pill">{activePage === 'timetable' ? <><span>多校檢視</span><strong>實際時間</strong></> : <><span>{isMixedWeek ? '跨學期週' : weekInfo ? `第 ${weekInfo.number} 週` : '學期外'}</span><strong>{isMixedWeek ? '逐日' : weekInfo?.pattern ? `${weekInfo.pattern} 週` : '—'}</strong></>}</div>
            </div>
          </section>

          {activePage === 'dashboard' && <DashboardCards summary={todaySummary} event={upcomingEvent} />}

          {activePage === 'dashboard' && <section className="panel overview-panel">
            <div className="panel-heading">
              <div><h2>本週行事曆</h2><p>課程、會議與活動依實際日期和時間排列，包含週末與已取消課程。</p>{oneOffNotice && <p role="status">{oneOffNotice}</p>}</div>
              {!historicalProject && displayTimetable && <button className="primary-button" data-course-add onClick={openAddChoice}><Plus size={16} />新增課程</button>}
            </div>
            <OverviewCalendar data={appData} weekStart={weekStart} projectId={displayProject.id} timetableId={displayTimetable?.id} onLessonClick={historicalProject ? undefined : (lessonId, date, overrideId) => { lessonEditorFromAddRef.current = false; setSelectedLessonId(lessonId); setSelectedLessonDate(date); setSelectedLessonOverrideId(overrideId ?? null); setLessonDragIntent(null); setLessonEditorOpen(true) }} onOneOffClick={canAddOneOff ? (id) => openOneOff(undefined, id) : undefined} />
          </section>}

          {activePage === 'events' ? (
            <EventsPanel data={data} onDelete={(eventId) => setAppData((current) => ({ ...current, events: current.events.filter((item) => item.id !== eventId) }))} onAdd={() => setModal('event')} />
          ) : displayTimetables.length === 0 ? (
            <section className="panel timetable-empty-project"><h2>{storagePersistence.pending || storageStatus !== 'saved' ? '課表變更尚未確認儲存' : '這個專案尚無教師課表'}</h2><p>{storagePersistence.pending || storageStatus !== 'saved' ? '目前畫面反映記憶體中的資料；請先確認儲存狀態，勿將其視為永久刪除。' : '專案與學校、學制設定已保留。仍可管理科目與班級；建立空白課表後即可新增固定課程或單日課程。'}</p>{timetableNotice && <p role="status">{timetableNotice}</p>}<div>{!historicalProject && <button type="button" data-course-add onClick={openAddChoice}>新增課程</button>}<button type="button" className="primary-button" onClick={openBlankTimetable} disabled={!canCreateTimetable || storagePersistence.pending || Boolean(pendingTimetableDelete)}>新增空白課表</button><button type="button" onClick={openProjectSettings}>專案設定</button></div></section>
          ) : activePage === 'timetable' ? (
            <section className="panel timetable-panel">
              <div className="panel-heading">
                <div><h2>跨校週課表</h2><p>依各校學制的實際節次與輪週設定逐日整合；點選課程可編輯。</p>{oneOffNotice && <p role="status">{oneOffNotice}</p>}</div>
                {!historicalProject && displayTimetable && <button className="primary-button" data-course-add onClick={openAddChoice}><Plus size={16} />新增課程</button>}
              </div>
              <MultiSchoolSchedule key={displayTimetable?.id ?? displayProject.id} data={appData} weekDays={weekDays} projectId={displayProject.id} timetableId={displayTimetable?.id} onLessonClick={historicalProject ? undefined : (lessonId, date, overrideId) => { lessonEditorFromAddRef.current = false; setSelectedLessonId(lessonId); setSelectedLessonDate(date); setSelectedLessonOverrideId(overrideId ?? null); setLessonDragIntent(null); setLessonEditorOpen(true) }} onLessonDrop={historicalProject ? undefined : (intent) => { lessonEditorFromAddRef.current = false; setSelectedLessonId(intent.lessonId); setSelectedLessonDate(intent.sourceDate); setSelectedLessonOverrideId(null); setLessonDragIntent(intent); setLessonEditorOpen(true) }} onOneOffClick={canAddOneOff ? (id) => openOneOff(undefined, id) : undefined} />
            </section>
          ) : null}
        </div>
        </>}
      </main>

      {storageStatus !== 'read-error' && <>{modal === 'event' && <EventForm onSubmit={handleAddEvent} onClose={() => setModal(null)} defaultDate={toDateKey(new Date())} />}
      {modal === 'settings' && <ProjectLifecycleModal data={appData} setData={setAppData} initialPage={projectLifecycleInitialPage} storageStatus={storageStatus} storagePersistence={storagePersistence} readOnly={Boolean(historicalProject)} onClose={closeProjectSettings} onViewArchived={viewArchivedProject} />}</>}
      {addChoiceOpen && <AddChoiceDialog initialFocus={addChoiceFocus} canAddLesson={canAddLesson} addLessonReason={addLessonUnavailableReason} canAddOneOff={canAddOneOff} addOneOffReason={createTimetableUnavailableReason || (!displayTimetable ? missingTimetableReason : '目前資料仍在儲存，請稍後再試。')} onAddOneOff={() => openOneOff(toDateKey(new Date()), undefined, 'add-choice')} onAddLesson={() => {
        if (!canAddLesson) return
        setAddChoiceOpen(false)
        lessonEditorFromAddRef.current = true
        setSelectedLessonOverrideId(null)
        setLessonEditorOpen(true)
      }} onClose={() => { setAddChoiceOpen(false); setAddChoiceFocus(null) }} />}
      {timetableDialog?.mode === 'edit' ? <TimetableInfoDialog key={`timetable-info:${timetableDialog.timetableId}`} timetable={timetableDialog.source} defaultDate={timetableDialog.defaultDate} error={timetableError} submitting={Boolean(pendingTimetableCopy || pendingTimetableEdit || pendingTimetableDelete)} deleteImpact={timetableDialog.deleteImpact} onEdit={submitTimetable} onCopy={submitTimetableCopy} onDelete={submitTimetableDelete} onClose={() => { setTimetableDialog(null); setTimetableError('') }} /> : timetableDialog && <TimetableForm key={`create:${timetableDialog.projectId}`} error={timetableError} onSubmit={submitTimetable} onClose={() => { setTimetableDialog(null); setTimetableError('') }} />}
      {lessonEditorOpen && !historicalProject && <LessonEditor key={`lesson-editor:${activeTimetable?.id ?? activeProject?.id}`} data={appData} setData={setAppData} storageStatus={storageStatus} storagePersistence={storagePersistence} timetableId={activeTimetable?.id} lessonId={selectedLessonId} occurrenceDate={selectedLessonDate} occurrenceOverrideId={selectedLessonOverrideId} dragIntent={lessonDragIntent} onOpenSettings={() => { lessonEditorFromAddRef.current = false; setLessonEditorOpen(false); openProjectSettings() }} onManageResource={(mode, context, onCreated) => openResourceManagerFromEditor('lesson-editor', mode, context, onCreated)} onClose={() => { if (resourceDialog?.source === 'lesson-editor') return; const returnToChoice = lessonEditorFromAddRef.current; setLessonEditorOpen(false); lessonEditorFromAddRef.current = false; if (returnToChoice) { setAddChoiceFocus('lesson'); setAddChoiceOpen(true) } }} onSaved={(projectId) => { lessonEditorFromAddRef.current = false; if (projectId !== appData.activeProjectId) switchProject(projectId) }} />}
      {oneOffEditor && !isCompatibleAppDataV7(appData) && <Modal title="單日課程暫停編輯" onClose={() => { const returnToChoice = oneOffEditor.source === 'add-choice'; setOneOffEditor(null); if (returnToChoice) { setAddChoiceFocus('one-off'); setAddChoiceOpen(true) } }}><div className="form-grid"><p className="full one-off-error" role="alert">目前資料不是有效的 AppDataV7，無法安全寫入單日課程。請先處理儲存狀態。</p><div className="full form-actions"><button type="button" onClick={() => { const returnToChoice = oneOffEditor.source === 'add-choice'; setOneOffEditor(null); if (returnToChoice) { setAddChoiceFocus('one-off'); setAddChoiceOpen(true) } }}>關閉</button></div></div></Modal>}
      {oneOffEditor && isCompatibleAppDataV7(appData) && <OneOffLessonEditor key={`${oneOffEditor.timetableId}:${oneOffEditor.id ?? oneOffEditor.date ?? 'new'}`} data={appData} projectId={oneOffEditor.projectId} timetableId={oneOffEditor.timetableId} oneOffLessonId={oneOffEditor.id} initialDate={oneOffEditor.date} onManageResource={(mode, context, onCreated) => openResourceManagerFromEditor('one-off-editor', mode, context, onCreated)} onClose={() => { if (resourceDialog?.source === 'one-off-editor' || oneOffWrites.pending) return; const returnToChoice = oneOffEditor.source === 'add-choice'; setOneOffEditor(null); if (returnToChoice) { setAddChoiceFocus('one-off'); setAddChoiceOpen(true) } }} onSave={async (request) => {
        if (historicalProject || oneOffEditor.projectId !== displayProject?.id || oneOffEditor.timetableId !== displayTimetable?.id) throw new Error('目前課表已切換，請重新開啟單日課程。')
        await oneOffWrites.save(oneOffEditor, request)
        setOneOffNotice(request.id ? '單日課程已儲存。' : '單日課程已新增並儲存。')
        setOneOffEditor(null)
      }} onDelete={async (id) => {
        if (historicalProject || oneOffEditor.projectId !== displayProject?.id || oneOffEditor.timetableId !== displayTimetable?.id) throw new Error('目前課表已切換，請重新開啟單日課程。')
        await oneOffWrites.remove(oneOffEditor, id)
        setOneOffNotice('單日課程已刪除並儲存。')
        setOneOffEditor(null)
      }} />}
      {resourceDialog && <CourseResourceManagerDialog key={`${resourceDialog.source}:${resourceDialog.mode}`} data={appData} setData={setAppData} mode={resourceDialog.mode} storageStatus={storageStatus} storagePersistence={storagePersistence} storageControls={storageControls} session={resourceSession} readOnly={Boolean(historicalProject)} onOpenSettings={openSettingsFromResourceManager} onCreated={(mode, id) => { if (mode === resourceDialog.mode) resourceCreatedRef.current?.(id) }} onClose={closeResourceManager} />}
    </div>
  )
}

function AddChoiceDialog({ initialFocus, canAddLesson, addLessonReason, canAddOneOff, addOneOffReason, onAddLesson, onAddOneOff, onClose }: {
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
          <button ref={lessonButton} type="button" className="settings-menu-item" onClick={onAddLesson} disabled={!canAddLesson}><BookOpenCheck aria-hidden="true" /><span><strong>新增固定課程</strong><small>{canAddLesson ? '使用目前的專案與教師課表。' : addLessonReason}</small></span></button>
          <button ref={oneOffButton} type="button" className="settings-menu-item" onClick={onAddOneOff} disabled={!canAddOneOff}><CalendarPlus aria-hidden="true" /><span><strong>新增單日課程</strong><small>{canAddOneOff ? '只在指定日期加入目前教師課表。' : addOneOffReason}</small></span></button>
        </section>
      </nav>
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

function EventsPanel({ data, onDelete, onAdd }: { data: AppData; onDelete: (eventId: string) => void; onAdd: () => void }) {
  const events = [...data.events].sort((a,b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
  return <section className="panel events-panel"><div className="panel-heading"><div><h2>會議與活動</h2><p>一次性行程獨立於固定課表。</p></div><button className="primary-button" onClick={onAdd}><Plus size={17} />新增活動</button></div>{events.map((e) => <div className="event-row" key={e.id}><div className="event-date"><strong>{e.date.slice(5).replace('-', '/')}</strong><span>{e.startTime}</span></div><i style={{ background: e.color }} /><div><strong>{e.title}</strong><span>{e.location || '未設定地點'}・{e.startTime}–{e.endTime}</span></div><button onClick={() => { if (window.confirm(`確定刪除「${e.title}」？此操作無法復原。`)) onDelete(e.id) }}>刪除</button></div>)}</section>
}

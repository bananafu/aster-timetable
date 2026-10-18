import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { cancelLessonOnDate, endLessonFromDate, moveLessonOnDate, permanentlySwapLessons, permanentlyUpdateLesson, replaceLessonOnDate, revokeLessonOverride, swapLessonOccurrences } from '../data/lessonChangesV4'
import { addLessonV4, deleteLessonV4, updateLessonV4, type LessonDraftV4 } from '../data/lessonsV4'
import { fromDateKey, toDateKey } from '../lib/date'
import { getMoveTargetConflicts, resolveProjectDay } from '../lib/scheduleV4'
import type { LessonDragIntent } from '../lib/lessonDrag'
import { classDisplayName } from '../lib/classes'
import { subjectAppliesToLevel, subjectsForLevel } from '../lib/subjects'
import { addSubjectForLevel } from '../data/subjectsV5'
import type { AppDataV4, DayOfWeek, WeekPattern } from '../types'
import { Modal } from './Modal'
import { SubjectCombobox } from './SubjectCombobox'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
type ChangeMode = 'basic' | 'cancel' | 'move' | 'replace' | 'swap' | 'permanent' | 'permanent-swap' | 'end'
type ChangeScope = 'basic' | 'single' | 'permanent'
const dayLabel: Record<DayOfWeek, string> = { 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五' }
const statusLabel = { regular: '固定課程', cancelled: '單日取消', replaced: '單日替換', moved: '單日移動' } as const
const levelLabel = { 'junior-high': '國中部', 'senior-high': '高中部', other: '其他' } as const
const hasDuplicateLevel = (unit: AppDataV4['teachingUnits'][number], units: AppDataV4['teachingUnits']) => units.filter((item) => item.schoolId === unit.schoolId && item.schoolLevel === unit.schoolLevel).length > 1
const unitLabel = (unit: AppDataV4['teachingUnits'][number], units: AppDataV4['teachingUnits']) => {
  if (!hasDuplicateLevel(unit, units)) return unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]
  return `${unit.schoolLevel === 'other' ? unit.name : levelLabel[unit.schoolLevel]}（重複設定，請先處理）`
}

export interface LessonEditorContext { projectId?: string; teachingUnitId?: string; day?: DayOfWeek; periodId?: number }
interface Props {
  data: AppDataV4
  setData: Dispatch<SetStateAction<AppDataV4>>
  timetableId?: string
  lessonId?: string | null
  occurrenceDate?: string | null
  occurrenceOverrideId?: string | null
  dragIntent?: LessonDragIntent | null
  context?: LessonEditorContext
  onOpenSettings?: () => void
  onClose: () => void
  onSaved: (projectId: string) => void
}

function messageFor(error: unknown) {
  if (!(error instanceof Error)) return '無法儲存課程，請確認欄位內容。'
  if (error.message.startsWith('請先')) return error.message
  if (error.message.includes('occupied')) return '目標時間已有課程。請改用交換、勾選保留衝堂，或取消操作。'
  if (error.message.includes('matching real-time')) return '跨校交換需要雙方學制設定都有完全相同起訖時間的節次。'
  if (error.message.includes('already has an override')) return '這堂課在指定日期已有異動，請先處理既有異動。'
  if (error.message.includes('across teaching units')) return '永久版本必須保留原學制；請在原學制內修改，或改用僅此日期的移動／交換。'
  if (error.message.includes('Versioned lessons')) return '此課程已有歷史版本，不能直接刪除；請改用「從指定日期起／結束課程」。'
  if (error.message.includes('does not occur') || error.message.includes('outside')) return '指定日期沒有這堂課，請選擇實際上課日期。'
  if (error.message.includes('conflict')) return '異動會造成課程版本衝突，請調整日期、節次或輪週。'
  if (error.message.includes('overrides') || error.message.includes('Future')) return '此課程仍有相關單日異動，為保護歷史資料，目前不能刪除或結束。'
  if (error.message.includes('Historical')) return '過去版本僅供檢視，不可直接修改。請編輯目前版本或建立新的永久版本。'
  if (error.message.includes('read-only')) return '封存專案為唯讀，請先重新啟用後再修改。'
  if (error.message.includes('Class does not belong')) return '請選擇屬於目前學制的班級；若尚無班級，請先前往專案設定建立班級名單。'
  if (error.message.includes('Period does not belong')) return '請選擇目前學制課堂時間表中的節次。'
  if (error.message.includes('School and teaching unit')) return '所選學校與學制不相符，請重新選擇。'
  return '課程資料未通過驗證，請確認日期、歸屬、班級與節次。'
}

export function LessonEditor({ data, setData, timetableId: selectedTimetableId, lessonId, occurrenceDate, occurrenceOverrideId, dragIntent, context, onOpenSettings, onClose, onSaved }: Props) {
  const lesson = lessonId ? data.recurringLessons.find((item) => item.id === lessonId) : undefined
  const initialProjectId = lesson?.projectId ?? context?.projectId ?? data.activeProjectId ?? data.projects.find((item) => !item.archivedAt)?.id ?? ''
  const requestedInitialUnit = data.teachingUnits.find((item) => item.id === (lesson?.teachingUnitId ?? context?.teachingUnitId))
  const fallbackSchoolId = data.schools.find((item) => item.projectId === initialProjectId)?.id ?? ''
  const fallbackInitialUnit = data.teachingUnits.find((item) => item.projectId === initialProjectId && item.schoolId === fallbackSchoolId && !hasDuplicateLevel(item, data.teachingUnits))
  const initialUnit = requestedInitialUnit ?? fallbackInitialUnit
  const initialSchoolId = initialUnit?.schoolId ?? fallbackSchoolId
  const [projectId, setProjectId] = useState(initialProjectId)
  const [timetableId, setTimetableId] = useState(() => selectedTimetableId
    ?? (data.timetables?.filter((item) => item.projectId === initialProjectId).length === 1
      ? data.timetables?.find((item) => item.projectId === initialProjectId)?.id : undefined))
  const [schoolId, setSchoolId] = useState(initialSchoolId)
  const [teachingUnitId, setTeachingUnitId] = useState(initialUnit?.id ?? '')
  const [subjectId, setSubjectId] = useState(lesson?.subjectId ?? '')
  const [classId, setClassId] = useState(lesson?.classId ?? data.classes.find((item) => item.teachingUnitId === initialUnit?.id)?.id ?? '')
  const [day, setDay] = useState<DayOfWeek>(lesson?.day ?? context?.day ?? 1)
  const [periodId, setPeriodId] = useState(lesson?.periodId ?? context?.periodId ?? initialUnit?.periods[0]?.id ?? 0)
  const [weekPattern, setWeekPattern] = useState<WeekPattern>(lesson?.weekPattern ?? 'every')
  const [room, setRoom] = useState(lesson?.room ?? '')
  const [mode, setMode] = useState<ChangeMode>(dragIntent ? 'move' : 'basic')
  const [changeDate, setChangeDate] = useState(dragIntent?.sourceDate ?? occurrenceDate ?? lesson?.effectiveStart ?? toDateKey(new Date()))
  const [targetDate, setTargetDate] = useState(dragIntent?.targetDate ?? occurrenceDate ?? lesson?.effectiveStart ?? toDateKey(new Date()))
  const [targetPeriodId, setTargetPeriodId] = useState(dragIntent?.targetPeriodId ?? lesson?.periodId ?? initialUnit?.periods[0]?.id ?? 0)
  const [swapLessonId, setSwapLessonId] = useState('')
  const [allowConflict, setAllowConflict] = useState(false)
  const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [showSubjectCreate, setShowSubjectCreate] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ data: AppDataV4; source: AppDataV4; summary: string; details: string[]; warnings: string[] } | null>(null)

  const projects = data.projects.filter((item) => !item.archivedAt)
  const schools = useMemo(() => data.schools.filter((item) => item.projectId === projectId), [data.schools, projectId])
  const units = useMemo(() => data.teachingUnits.filter((item) => item.projectId === projectId && item.schoolId === schoolId), [data.teachingUnits, projectId, schoolId])
  const ambiguousLevels = [...new Set(units.filter((item) => hasDuplicateLevel(item, data.teachingUnits)).map((item) => levelLabel[item.schoolLevel]))]
  const unit = data.teachingUnits.find((item) => item.id === teachingUnitId)
  const availableSubjects = subjectsForLevel(data.subjects, unit?.schoolLevel)
  const selectedSubjectValid = Boolean(unit && availableSubjects.some((item) => item.id === subjectId))
  const previousReplacement = editingOverrideId ? data.overrides.find((item) => item.id === editingOverrideId)?.replacement : undefined
  const preservedLegacySubject = Boolean(lesson && unit?.id === lesson.teachingUnitId &&
    (subjectId === lesson.subjectId || (mode === 'replace' && subjectId === previousReplacement?.subjectId)))
  const classes = data.classes.filter((item) => item.projectId === projectId && item.teachingUnitId === teachingUnitId)
  const periods = [...(unit?.periods ?? [])].sort((left, right) => left.order - right.order)
  const safeLesson = lesson && (data.schemaVersion < 6 || lesson.timetableId === timetableId)
  const occurrence = safeLesson && occurrenceDate ? resolveProjectDay(data, lesson.projectId, fromDateKey(occurrenceDate), { timetableId })
    .find((item) => item.kind === 'recurring' && item.id === lesson.id && (occurrenceOverrideId == null || item.overrideId === occurrenceOverrideId)) : undefined
  const activeOverride = occurrence?.overrideId ? data.overrides.find((item) => item.id === occurrence.overrideId) : undefined
  const changeBase = useMemo(() => {
    if (!editingOverrideId) return data
    try { return revokeLessonOverride(data, editingOverrideId, timetableId) } catch { return data }
  }, [data, editingOverrideId, timetableId])
  const swapDate = dragIntent ? targetDate : changeDate
  const candidates = safeLesson ? resolveProjectDay(changeBase, lesson.projectId, fromDateKey(swapDate), { timetableId }).filter((item) => item.kind === 'recurring' && item.id !== lesson.id && item.status !== 'cancelled') : []
  const lessonUnit = lesson ? data.teachingUnits.find((item) => item.id === lesson.teachingUnitId) : undefined
  const lessonSchool = lessonUnit ? data.schools.find((item) => item.id === lessonUnit.schoolId) : undefined
  const lessonSubject = lesson ? data.subjects.find((item) => item.id === lesson.subjectId) : undefined
  const lessonClass = lesson ? data.classes.find((item) => item.id === lesson.classId) : undefined
  const lessonPeriod = lessonUnit?.periods.find((item) => item.id === lesson?.periodId)
  const lessonVersions = lesson ? data.recurringLessons.filter((item) => item.seriesId === lesson.seriesId).sort((left, right) => left.effectiveStart.localeCompare(right.effectiveStart)) : []
  const relatedOverrides = lesson ? data.overrides.filter((item) => item.originalLessonId === lesson.id) : []
  const historicalVersion = lesson ? lessonVersions.some((item) => item.effectiveStart > lesson.effectiveStart) : false
  const scope: ChangeScope = mode === 'basic' ? 'basic' : ['cancel', 'move', 'replace', 'swap'].includes(mode) ? 'single' : 'permanent'
  const draft: LessonDraftV4 = { projectId, timetableId, schoolId, teachingUnitId, subjectId, classId, day, periodId, weekPattern, room }
  const resetPreview = () => { setPreview(null); setError('') }

  const selectProject = (nextProjectId: string) => {
    const nextSchool = data.schools.find((item) => item.projectId === nextProjectId)
    const nextUnit = data.teachingUnits.find((item) => item.projectId === nextProjectId && item.schoolId === nextSchool?.id && !hasDuplicateLevel(item, data.teachingUnits))
    setProjectId(nextProjectId); setSchoolId(nextSchool?.id ?? ''); setTeachingUnitId(nextUnit?.id ?? '')
    const nextTimetables = data.timetables?.filter((item) => item.projectId === nextProjectId) ?? []
    setTimetableId(nextTimetables.length === 1 ? nextTimetables[0].id : undefined)
    setSwapLessonId(''); setEditingOverrideId(null)
    if (!nextUnit || !data.subjects.some((item) => item.id === subjectId && subjectAppliesToLevel(item, nextUnit.schoolLevel))) setSubjectId('')
    setClassId('')
    setPeriodId(0); setTargetPeriodId(0); setWeekPattern('every'); resetPreview()
  }
  const selectSchool = (nextSchoolId: string) => {
    const nextUnit = data.teachingUnits.find((item) => item.projectId === projectId && item.schoolId === nextSchoolId && !hasDuplicateLevel(item, data.teachingUnits))
    setSchoolId(nextSchoolId); setTeachingUnitId(nextUnit?.id ?? ''); setClassId('')
    if (!nextUnit || !data.subjects.some((item) => item.id === subjectId && subjectAppliesToLevel(item, nextUnit.schoolLevel))) setSubjectId('')
    setPeriodId(0); setTargetPeriodId(0); setWeekPattern('every'); resetPreview()
  }
  const selectUnit = (nextUnitId: string) => {
    setTeachingUnitId(nextUnitId); setClassId('')
    const nextUnit = data.teachingUnits.find((item) => item.id === nextUnitId)
    if (!nextUnit || !data.subjects.some((item) => item.id === subjectId && subjectAppliesToLevel(item, nextUnit.schoolLevel))) setSubjectId('')
    setPeriodId(0); setTargetPeriodId(0); setWeekPattern('every'); resetPreview()
  }

  const buildChange = () => {
    if (!lesson) throw new Error('Lesson does not exist')
    if (data.schemaVersion >= 6 && lesson.timetableId !== timetableId) throw new Error('Lesson does not belong to the selected timetable')
    if (dragIntent && (dragIntent.projectId !== lesson.projectId || (dragIntent.timetableId ?? undefined) !== timetableId || dragIntent.lessonId !== lesson.id)) throw new Error('Drag intent does not belong to the selected timetable')
    const original = `${changeDate}・${dayLabel[lesson.day]}・${lessonPeriod?.label ?? lesson.periodId} ${lessonPeriod?.startTime ?? ''}–${lessonPeriod?.endTime ?? ''}`
    if (mode === 'cancel') return { data: cancelLessonOnDate(changeBase, lesson.id, changeDate, uid, timetableId), summary: '僅取消指定日期', details: [`原位置：${original}`, '其他日期與固定版本不變'], warnings: [] }
    if (mode === 'move') {
      const targetPeriod = lessonUnit?.periods.find((item) => item.id === targetPeriodId)
      const sourceOccurrence = resolveProjectDay(changeBase, lesson.projectId, fromDateKey(changeDate), { timetableId })
        .find((item) => item.kind === 'recurring' && item.id === lesson.id && item.status !== 'cancelled')
      const collisions = targetPeriod && sourceOccurrence
        ? getMoveTargetConflicts(changeBase, sourceOccurrence, { date: targetDate, startTime: targetPeriod.startTime, endTime: targetPeriod.endTime }) : []
      return { data: moveLessonOnDate(changeBase, lesson.id, changeDate, { date: targetDate, periodId: targetPeriodId }, allowConflict, uid, timetableId), summary: '僅移動指定日期', details: [`原位置：${original}（將留白）`, `目標位置：${targetDate}・${targetPeriod?.label ?? targetPeriodId} ${targetPeriod?.startTime ?? ''}–${targetPeriod?.endTime ?? ''}`], warnings: collisions.map((item) => `可能衝堂：${item.subjectName}・${item.className}（${item.schoolName}）`) }
    }
    if (mode === 'replace') { const replacementClass = data.classes.find((item) => item.id === classId); const priorReplace = editingOverrideId && data.overrides.find((item) => item.id === editingOverrideId)?.action === 'replace' ? editingOverrideId : undefined; return { data: replaceLessonOnDate(priorReplace ? data : changeBase, lesson.id, changeDate, { subjectId, classId, room }, uid, priorReplace, timetableId), summary: '僅替換指定日期內容', details: [`位置不變：${original}`, `替換為：${data.subjects.find((item) => item.id === subjectId)?.name ?? subjectId}・${replacementClass ? classDisplayName(replacementClass) : classId}`], warnings: ['School 與 TeachingUnit 身分維持不變'] } }
    const partner = candidates.find((item) => item.id === swapLessonId)
    if (mode === 'swap') return { data: swapLessonOccurrences(changeBase, lesson.id, changeDate, swapLessonId, swapDate, uid, timetableId), summary: '僅交換指定日期', details: [`課程 A：${original}`, `課程 B：${swapDate}・${partner?.startTime ?? ''}–${partner?.endTime ?? ''}・${partner?.subjectName ?? swapLessonId}・${partner?.className ?? ''}`], warnings: partner?.schoolId !== lessonSchool?.id ? ['跨校交換會依雙方實際時間映射各自節次，不會混用 periodId'] : [] }
    const futureOverrides = relatedOverrides.filter((item) => item.date >= changeDate).length
    if (mode === 'permanent') return { data: permanentlyUpdateLesson(data, lesson.id, changeDate, draft, uid), summary: '從指定日期起永久修改', details: [`生效日期：${changeDate}`, `新時段：${dayLabel[day]}・${periods.find((item) => item.id === periodId)?.label ?? periodId}`, '舊版本將在生效日前一日結束'], warnings: futureOverrides ? [`${futureOverrides} 筆生效日後 override 會安全改指向新版本`] : [] }
    if (mode === 'permanent-swap') return { data: permanentlySwapLessons(data, lesson.id, swapLessonId, changeDate, uid, timetableId), summary: '從指定日期起永久交換', details: [`生效日期：${changeDate}`, `交換對象：${partner?.subjectName ?? swapLessonId}・${partner?.className ?? ''}`], warnings: ['雙方都會建立新版本；生效日前歷史不變', ...(partner?.schoolId !== lessonSchool?.id ? ['跨校交換必須有相同實際起訖時間的安全節次映射'] : [])] }
    if (mode === 'end') return { data: endLessonFromDate(data, lesson.id, changeDate, timetableId), summary: '從指定日期起結束課程', details: [`結束日期：${changeDate}`, '生效日前的歷史課表仍保留'], warnings: futureOverrides ? [`仍有 ${futureOverrides} 筆未處理 override，操作將被阻止`] : [] }
    throw new Error('Unsupported change')
  }
  const beginOverrideEdit = () => {
    if (!activeOverride) return
    setEditingOverrideId(activeOverride.id)
    setChangeDate(activeOverride.date)
    if (activeOverride.groupId) {
      const partnerOverride = data.overrides.find((item) => item.groupId === activeOverride.groupId && item.id !== activeOverride.id)
      setMode('swap'); setSwapLessonId(partnerOverride?.originalLessonId ?? '')
    } else if (activeOverride.action === 'replace') {
      setMode('replace'); setSubjectId(activeOverride.replacement?.subjectId ?? lesson?.subjectId ?? '')
      setClassId(activeOverride.replacement?.classId ?? lesson?.classId ?? ''); setRoom(activeOverride.replacement?.room ?? lesson?.room ?? '')
    } else if (activeOverride.action === 'move') {
      setMode('move'); setTargetDate(activeOverride.target?.date ?? activeOverride.date); setTargetPeriodId(activeOverride.target?.periodId ?? activeOverride.periodId)
    } else setMode('cancel')
    resetPreview()
  }
  const previewOverrideRevoke = () => {
    if (!activeOverride) return
    try {
      const grouped = activeOverride.groupId ? data.overrides.filter((item) => item.groupId === activeOverride.groupId) : [activeOverride]
      setPreview({
        data: revokeLessonOverride(data, activeOverride.id, timetableId), source: data, summary: activeOverride.groupId ? '撤銷單日交換' : `撤銷${statusLabel[occurrence?.status ?? 'regular']}`,
        details: [`受影響日期：${activeOverride.date}`, activeOverride.action === 'move' ? `異動目標：${activeOverride.target?.date}・節次 ${activeOverride.target?.periodId}` : '恢復該日期原本的固定課表'],
        warnings: activeOverride.groupId ? [`將原子撤銷交換群組中的 ${grouped.length} 筆關聯異動，雙方課程一併恢復`] : [],
      })
      setEditingOverrideId(null); setError('')
    } catch (reason) { setError(messageFor(reason)); setPreview(null) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      if (data.schemaVersion >= 6 && (!timetableId || !data.timetables?.some((item) => item.id === timetableId && item.projectId === projectId))) throw new Error('請先選擇教師課表。')
      if (lesson && (lesson.projectId !== projectId || (data.schemaVersion >= 6 && lesson.timetableId !== timetableId))) throw new Error('Lesson does not belong to the selected timetable')
      if (!lesson || mode === 'basic') {
        if (!unit) throw new Error('請先選擇學校中的學制。')
        if (!selectedSubjectValid && !preservedLegacySubject) throw new Error('請先選擇有效科目。')
        if (!classes.length || !classId) throw new Error('請先前往專案設定建立班級名單，再選擇班級。')
        if (!periods.length || !periodId) throw new Error('目前學制尚未設定可用節次，請先前往專案設定。')
        const next = lesson ? updateLessonV4(data, lesson.id, draft) : addLessonV4(data, draft, uid)
        setData(next); onSaved(projectId); onClose(); return
      }
      setPreview({ ...buildChange(), source: data })
    } catch (reason) { setError(messageFor(reason)); setPreview(null) }
  }
  const confirmChange = () => {
    if (!preview) return
    if (preview.source !== data || (data.schemaVersion >= 6 && (!timetableId || !data.timetables?.some((item) => item.id === timetableId && item.projectId === projectId) || lesson?.timetableId !== timetableId))) {
      setPreview(null); setError('課表或資料已變更，請重新預覽異動。'); return
    }
    setData(preview.data); onSaved(projectId); onClose()
  }
  const remove = () => {
    if (!lesson || !window.confirm(`確定刪除這筆固定課程？\n${lesson.id}\n若要保留歷史，請改用「從此日期起結束」。`)) return
    try { setData(deleteLessonV4(data, lesson.id, timetableId)); onClose() } catch (reason) { setError(messageFor(reason)) }
  }
  const addSubject = () => {
    if (!unit) { setError('請先選擇學校與學制。'); return }
    try {
      const id = uid()
      const next = addSubjectForLevel(data, newSubjectName, unit.schoolLevel, id)
      setData(next); setSubjectId(id); setNewSubjectName(''); setShowSubjectCreate(false); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '科目無法新增。') }
  }
  const needsContent = !historicalVersion && (mode === 'basic' || mode === 'replace' || mode === 'permanent')
  const needsSwap = mode === 'swap' || mode === 'permanent-swap'
  const missingSetup = needsContent && (!unit || classes.length === 0 || periods.length === 0)
  const missingSelection = needsContent && (!classId || !periodId || (!selectedSubjectValid && !preservedLegacySubject))

  return <Modal title={lesson ? '編輯課程' : '新增固定課程'} subtitle={lesson ? '清楚區分僅此日期與永久版本；異動須預覽確認後才寫入。' : '選擇學校與學制後建立固定課程。'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {dragIntent && <p className="lesson-drag-intent full" role="status">拖曳只建立操作意圖，尚未修改資料。預設僅移動 {dragIntent.sourceDate} 的課程至 {dragIntent.targetDate}・{dragIntent.targetStartTime}–{dragIntent.targetEndTime}。{dragIntent.conflictLessonIds.length > 0 && '目標已有課程，請選擇交換、保留衝堂或取消。'}</p>}
    {lesson && <><section className="lesson-context full" aria-label="目前課程資訊"><div><span>學校／學制</span><strong>{lessonSchool?.name}・{lessonUnit?.schoolLevel === 'junior-high' ? '國中部' : lessonUnit?.schoolLevel === 'senior-high' ? '高中部' : lessonUnit?.name}</strong></div><div><span>科目／班級</span><strong>{occurrence?.subjectName ?? lessonSubject?.name}・{occurrence?.className ?? (lessonClass ? classDisplayName(lessonClass) : '')}</strong></div><div><span>日期／週型</span><strong>{occurrenceDate ?? '未指定日期'}・{lesson.weekPattern === 'every' ? '每週' : `${lesson.weekPattern} 週`}</strong></div><div><span>節次／實際時間</span><strong>{occurrence?.periodLabel ?? lessonPeriod?.label}・{occurrence?.startTime ?? lessonPeriod?.startTime}–{occurrence?.endTime ?? lessonPeriod?.endTime}</strong></div><p><span className={`lesson-status ${occurrence?.status ?? 'regular'}`}>{statusLabel[occurrence?.status ?? 'regular']}</span>{occurrence?.note && <em>{occurrence.note}</em>}</p></section>
    {activeOverride && !historicalVersion && <section className="lesson-override-manager full" aria-label="現有單日異動"><div><span>此日期已有異動</span><strong>{activeOverride.groupId ? '單日交換' : statusLabel[occurrence?.status ?? 'regular']}</strong><small>{activeOverride.date}{activeOverride.target ? ` → ${activeOverride.target.date}・節次 ${activeOverride.target.periodId}` : ''}</small></div><div><button type="button" onClick={beginOverrideEdit}>修改此異動</button><button type="button" className="danger-button" onClick={previewOverrideRevoke}>撤銷異動</button></div></section>}
    {editingOverrideId && <p className="lesson-editing-override full" role="status">正在改寫既有單日異動；確認後會以新異動取代原紀錄，不會建立重複 override。</p>}
    {historicalVersion ? <p className="lesson-risk-warning full" role="status">目前選取的是已結束的歷史版本，只能查看，不可直接修改或新增異動。</p> : <nav className="lesson-scope-switch full" aria-label="課程編輯範圍"><button type="button" className={scope === 'basic' ? 'active' : ''} aria-pressed={scope === 'basic'} onClick={() => { setMode('basic'); resetPreview() }}>固定版本資料<small>直接修正目前版本</small></button><button type="button" className={scope === 'single' ? 'active' : ''} aria-pressed={scope === 'single'} onClick={() => { setMode('cancel'); resetPreview() }}>僅此日期<small>不影響其他週</small></button><button type="button" className={scope === 'permanent' ? 'active' : ''} aria-pressed={scope === 'permanent'} onClick={() => { setMode('permanent'); resetPreview() }}>從指定日期起<small>建立新歷史版本</small></button></nav>}
    {!historicalVersion && scope !== 'basic' && <label className="full">異動方式<select aria-label="課程異動類型" value={mode} onChange={(event) => { setMode(event.target.value as ChangeMode); resetPreview() }}>{scope === 'single' ? <><option value="cancel">取消課程</option><option value="move">移動課程</option><option value="replace">替換內容</option><option value="swap">交換兩堂課</option></> : <><option value="permanent">永久修改</option><option value="permanent-swap">永久交換</option><option value="end">結束課程</option></>}</select></label>}
    {relatedOverrides.length > 0 && <p className="lesson-risk-warning full" role="status">此版本已有 {relatedOverrides.length} 筆單日異動。新增同日異動、結束課程或版本切分時會驗證引用，無法安全處理便會阻止寫入。</p>}</>}
    {lesson && mode !== 'basic' && <label className="full">指定／生效日期<input aria-label="異動日期" type="date" value={changeDate} onChange={(event) => { setChangeDate(event.target.value); setTargetDate(event.target.value); setSwapLessonId(''); resetPreview() }} required /></label>}
    {mode === 'move' && <><label>移至日期<input aria-label="移至日期" type="date" value={targetDate} onChange={(event) => { setTargetDate(event.target.value); resetPreview() }} required /></label><label>移至節次<select aria-label="移至節次" value={targetPeriodId} onChange={(event) => { setTargetPeriodId(Number(event.target.value)); resetPreview() }}>{periods.map((period) => <option key={period.id} value={period.id}>{period.label}（{period.startTime}–{period.endTime}）</option>)}</select></label><label className="full checkbox-row"><input type="checkbox" checked={allowConflict} onChange={(event) => { setAllowConflict(event.target.checked); resetPreview() }} />目標已有課程時仍保留雙方並顯示衝堂警告</label></>}
    {needsSwap && <label className="full">交換對象<select aria-label="交換課程" value={swapLessonId} onChange={(event) => { setSwapLessonId(event.target.value); resetPreview() }} required><option value="">請選擇 {swapDate} 的課程</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.startTime} {item.subjectName}・{item.className}（{item.schoolName}）</option>)}</select></label>}
    {needsContent && <>
      <label className="full">課表專案<select aria-label="課程專案" value={projectId} onChange={(event) => selectProject(event.target.value)} disabled={Boolean(lesson)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>學校<select aria-label="課程學校" value={schoolId} onChange={(event) => selectSchool(event.target.value)} disabled={mode === 'replace' || (Boolean(lesson) && mode === 'permanent')}>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
      <label>學制<select aria-label="課程學制" value={teachingUnitId} onChange={(event) => selectUnit(event.target.value)} disabled={Boolean(lesson) && mode === 'permanent'}><option value="">請選擇學制</option>{units.map((item) => <option key={item.id} value={item.id} disabled={hasDuplicateLevel(item, data.teachingUnits) && item.id !== lesson?.teachingUnitId}>{unitLabel(item, data.teachingUnits)}</option>)}</select></label>
      {lesson && mode === 'permanent' && <p className="lesson-risk-warning full">永久版本必須保留原學制；學校與學制已鎖定。單日移動或交換仍可使用各自學制的合法節次。</p>}
      {ambiguousLevels.length > 0 && <p className="form-warning full" role="alert">同一學校有重複的{ambiguousLevels.join('、')}設定；不會自動選取或重新指派，請先在專案設定確認舊資料。</p>}
      {!unit ? <p className="lesson-setup-empty">請先選擇學校與學制，才能選擇或新增科目。</p> : <><SubjectCombobox subjects={data.subjects} schoolLevel={unit.schoolLevel} value={subjectId} onChange={(nextSubjectId) => { setSubjectId(nextSubjectId); resetPreview() }} onCreateRequest={() => setShowSubjectCreate(true)} />{!selectedSubjectValid && subjectId && <p className="lesson-setup-empty">既有科目不適用目前學制；原課程仍保留，可修改其他欄位。若要更換科目，請選擇適用科目。</p>}{availableSubjects.length === 0 && <p className="lesson-setup-empty">目前學制尚無適用科目，可建立科目或前往專案設定。</p>}{showSubjectCreate && <div className="lesson-subject-create"><label>新科目<input aria-label="新科目名稱" value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} /></label><button type="button" onClick={addSubject}>建立科目</button>{onOpenSettings && <button type="button" onClick={onOpenSettings}>前往專案設定</button>}</div>}</>}
      <label>班級<select aria-label="課程班級" value={classId} onChange={(event) => { setClassId(event.target.value); resetPreview() }} disabled={!unit || classes.length === 0}><option value="">請選擇班級</option>{classes.map((item) => <option key={item.id} value={item.id}>{classDisplayName(item)}</option>)}</select></label>
      {mode !== 'replace' && <><label>星期<select aria-label="課程星期" value={day} onChange={(event) => { setDay(Number(event.target.value) as DayOfWeek); resetPreview() }}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>週{'一二三四五'[value - 1]}</option>)}</select></label><label>節次<select aria-label="課程節次" value={periodId} onChange={(event) => { setPeriodId(Number(event.target.value)); resetPreview() }} disabled={!unit || periods.length === 0}><option value={0}>請選擇節次</option>{periods.map((period) => <option key={period.id} value={period.id}>{period.label}（{period.startTime}–{period.endTime}）</option>)}</select></label><label>輪週<select aria-label="課程輪週" value={weekPattern} onChange={(event) => { setWeekPattern(event.target.value as WeekPattern); resetPreview() }}><option value="every">每週</option>{unit?.weekCycle.enabled && <><option value="A">A 週</option><option value="B">B 週</option></>}</select></label></>}
      <label>教室<input value={room} onChange={(event) => { setRoom(event.target.value); resetPreview() }} placeholder="依班級預設" /></label>
      {missingSetup && <div className="lesson-setup-empty full" role="status"><strong>尚未完成課程基本資料</strong><p>{!unit ? ambiguousLevels.length > 0 ? '所選學校有重複學制設定，無法安全預選。' : '所選學校尚未建立學制。' : classes.length === 0 ? '此學制尚未建立班級名單。' : '此學制尚未建立節次時間表。'}</p>{onOpenSettings && <button type="button" onClick={onOpenSettings}>前往專案設定</button>}</div>}
    </>}
    {preview && <section className="lesson-change-preview full" role="status" aria-label="異動預覽"><header><strong>異動預覽・{preview.summary}</strong><span>尚未寫入</span></header>{preview.details.map((item) => <p key={item}>{item}</p>)}{preview.warnings.map((item) => <p className="warning" key={item}>{item}</p>)}<small>確認後才會寫入 AppData v4；取消可安全放棄此次預覽。</small></section>}
    {lesson && <details className="lesson-version-history full"><summary>課程版本歷史（{lessonVersions.length}）</summary><p>歷史版本僅供檢視，不可直接回寫。</p><ol>{lessonVersions.map((version) => { const versionUnit = data.teachingUnits.find((item) => item.id === version.teachingUnitId); const versionPeriod = versionUnit?.periods.find((item) => item.id === version.periodId); const versionClass = data.classes.find((item) => item.id === version.classId); return <li key={version.id} className={version.id === lesson.id ? 'current' : ''}><div><strong>{version.effectiveStart} — {version.effectiveEnd ?? '持續中'}</strong>{version.id === lesson.id && <em>目前選取</em>}</div><span>{data.subjects.find((item) => item.id === version.subjectId)?.name}・{versionClass ? classDisplayName(versionClass) : ''}</span><small>{dayLabel[version.day]}・{versionPeriod?.label}・{versionPeriod?.startTime}–{versionPeriod?.endTime}・{version.weekPattern === 'every' ? '每週' : `${version.weekPattern} 週`}</small></li> })}</ol></details>}
    {error && <p className="form-error full" role="alert">{error}</p>}
    {!historicalVersion && lesson && mode === 'basic' && lessonVersions.length > 1 && <p className="lesson-risk-warning full">此課程已有歷史版本，不能直接刪除；請選擇「從指定日期起」→「結束課程」，保留既有歷史。</p>}
    <div className="form-actions full">{!historicalVersion && lesson && mode === 'basic' && lessonVersions.length === 1 && <button type="button" className="danger-button" onClick={remove}>刪除固定課程</button>}<button type="button" onClick={onClose}>{historicalVersion ? '關閉' : '取消'}</button>{!historicalVersion && (preview ? <button type="button" className="primary-button" onClick={confirmChange}>確認套用</button> : <button type="submit" className="primary-button" disabled={(needsSwap && !swapLessonId) || missingSetup || missingSelection}>{lesson && mode !== 'basic' ? '預覽異動' : '儲存'}</button>)}</div>
  </form></Modal>
}

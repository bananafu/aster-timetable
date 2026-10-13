import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { cancelLessonOnDate, endLessonFromDate, moveLessonOnDate, permanentlySwapLessons, permanentlyUpdateLesson, replaceLessonOnDate, revokeLessonOverride, swapLessonOccurrences } from '../data/lessonChangesV4'
import { addLessonV4, deleteLessonV4, updateLessonV4, type LessonDraftV4 } from '../data/lessonsV4'
import { fromDateKey, toDateKey } from '../lib/date'
import { resolveProjectDay } from '../lib/scheduleV4'
import type { LessonDragIntent } from '../lib/lessonDrag'
import type { AppDataV4, DayOfWeek, WeekPattern } from '../types'
import { Modal } from './Modal'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
type ChangeMode = 'basic' | 'cancel' | 'move' | 'replace' | 'swap' | 'permanent' | 'permanent-swap' | 'end'
type ChangeScope = 'basic' | 'single' | 'permanent'
const dayLabel: Record<DayOfWeek, string> = { 1: '週一', 2: '週二', 3: '週三', 4: '週四', 5: '週五' }
const statusLabel = { regular: '固定課程', cancelled: '單日取消', replaced: '單日替換', moved: '單日移動' } as const

export interface LessonEditorContext { projectId?: string; teachingUnitId?: string; day?: DayOfWeek; periodId?: number }
interface Props {
  data: AppDataV4
  setData: Dispatch<SetStateAction<AppDataV4>>
  lessonId?: string | null
  occurrenceDate?: string | null
  dragIntent?: LessonDragIntent | null
  context?: LessonEditorContext
  onClose: () => void
  onSaved: (projectId: string) => void
}

function messageFor(error: unknown) {
  if (!(error instanceof Error)) return '無法儲存課程，請確認欄位內容。'
  if (error.message.includes('occupied')) return '目標時間已有課程。請改用交換、勾選保留衝堂，或取消操作。'
  if (error.message.includes('matching real-time')) return '跨校交換需要雙方任教單位都有完全相同起訖時間的節次。'
  if (error.message.includes('already has an override')) return '這堂課在指定日期已有異動，請先處理既有異動。'
  if (error.message.includes('does not occur') || error.message.includes('outside')) return '指定日期沒有這堂課，請選擇實際上課日期。'
  if (error.message.includes('conflict')) return '異動會造成課程版本衝突，請調整日期、節次或輪週。'
  if (error.message.includes('overrides') || error.message.includes('Future')) return '此課程仍有相關單日異動，為保護歷史資料，目前不能刪除或結束。'
  if (error.message.includes('Historical')) return '過去版本僅供檢視，不可直接修改。請編輯目前版本或建立新的永久版本。'
  if (error.message.includes('read-only')) return '封存專案為唯讀，請先重新啟用後再修改。'
  return '課程資料未通過驗證，請確認日期、歸屬、班級與節次。'
}

export function LessonEditor({ data, setData, lessonId, occurrenceDate, dragIntent, context, onClose, onSaved }: Props) {
  const lesson = lessonId ? data.recurringLessons.find((item) => item.id === lessonId) : undefined
  const initialProjectId = lesson?.projectId ?? context?.projectId ?? data.activeProjectId ?? data.projects.find((item) => !item.archivedAt)?.id ?? ''
  const initialUnit = data.teachingUnits.find((item) => item.id === (lesson?.teachingUnitId ?? context?.teachingUnitId)) ?? data.teachingUnits.find((item) => item.projectId === initialProjectId)
  const initialSchoolId = initialUnit?.schoolId ?? data.schools.find((item) => item.projectId === initialProjectId)?.id ?? ''
  const [projectId, setProjectId] = useState(initialProjectId)
  const [schoolId, setSchoolId] = useState(initialSchoolId)
  const [teachingUnitId, setTeachingUnitId] = useState(initialUnit?.id ?? '')
  const [subjectId, setSubjectId] = useState(lesson?.subjectId ?? data.subjects[0]?.id ?? '')
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
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ data: AppDataV4; summary: string; details: string[]; warnings: string[] } | null>(null)

  const projects = data.projects.filter((item) => !item.archivedAt)
  const schools = useMemo(() => data.schools.filter((item) => item.projectId === projectId), [data.schools, projectId])
  const units = useMemo(() => data.teachingUnits.filter((item) => item.projectId === projectId && item.schoolId === schoolId), [data.teachingUnits, projectId, schoolId])
  const unit = data.teachingUnits.find((item) => item.id === teachingUnitId)
  const classes = data.classes.filter((item) => item.projectId === projectId && item.teachingUnitId === teachingUnitId)
  const periods = [...(unit?.periods ?? [])].sort((left, right) => left.order - right.order)
  const occurrence = lesson && occurrenceDate ? resolveProjectDay(data, lesson.projectId, fromDateKey(occurrenceDate)).find((item) => item.id === lesson.id) : undefined
  const activeOverride = occurrence?.overrideId ? data.overrides.find((item) => item.id === occurrence.overrideId) : undefined
  const changeBase = useMemo(() => {
    if (!editingOverrideId) return data
    try { return revokeLessonOverride(data, editingOverrideId) } catch { return data }
  }, [data, editingOverrideId])
  const swapDate = dragIntent ? targetDate : changeDate
  const candidates = lesson ? resolveProjectDay(changeBase, lesson.projectId, fromDateKey(swapDate)).filter((item) => item.id !== lesson.id && item.status !== 'cancelled') : []
  const lessonUnit = lesson ? data.teachingUnits.find((item) => item.id === lesson.teachingUnitId) : undefined
  const lessonSchool = lessonUnit ? data.schools.find((item) => item.id === lessonUnit.schoolId) : undefined
  const lessonSubject = lesson ? data.subjects.find((item) => item.id === lesson.subjectId) : undefined
  const lessonClass = lesson ? data.classes.find((item) => item.id === lesson.classId) : undefined
  const lessonPeriod = lessonUnit?.periods.find((item) => item.id === lesson?.periodId)
  const lessonVersions = lesson ? data.recurringLessons.filter((item) => item.seriesId === lesson.seriesId).sort((left, right) => left.effectiveStart.localeCompare(right.effectiveStart)) : []
  const relatedOverrides = lesson ? data.overrides.filter((item) => item.originalLessonId === lesson.id) : []
  const historicalVersion = lesson ? lessonVersions.some((item) => item.effectiveStart > lesson.effectiveStart) : false
  const scope: ChangeScope = mode === 'basic' ? 'basic' : ['cancel', 'move', 'replace', 'swap'].includes(mode) ? 'single' : 'permanent'
  const draft: LessonDraftV4 = { projectId, schoolId, teachingUnitId, subjectId, classId, day, periodId, weekPattern, room }
  const resetPreview = () => { setPreview(null); setError('') }

  const selectProject = (nextProjectId: string) => {
    const nextSchool = data.schools.find((item) => item.projectId === nextProjectId)
    const nextUnit = data.teachingUnits.find((item) => item.projectId === nextProjectId && item.schoolId === nextSchool?.id)
    setProjectId(nextProjectId); setSchoolId(nextSchool?.id ?? ''); setTeachingUnitId(nextUnit?.id ?? '')
    setClassId(data.classes.find((item) => item.projectId === nextProjectId && item.teachingUnitId === nextUnit?.id)?.id ?? '')
    setPeriodId(nextUnit?.periods[0]?.id ?? 0); setTargetPeriodId(nextUnit?.periods[0]?.id ?? 0); setWeekPattern('every'); resetPreview()
  }
  const selectSchool = (nextSchoolId: string) => {
    const nextUnit = data.teachingUnits.find((item) => item.projectId === projectId && item.schoolId === nextSchoolId)
    setSchoolId(nextSchoolId); setTeachingUnitId(nextUnit?.id ?? ''); setClassId(data.classes.find((item) => item.teachingUnitId === nextUnit?.id)?.id ?? '')
    setPeriodId(nextUnit?.periods[0]?.id ?? 0); setTargetPeriodId(nextUnit?.periods[0]?.id ?? 0); setWeekPattern('every'); resetPreview()
  }
  const selectUnit = (nextUnitId: string) => {
    const nextUnit = data.teachingUnits.find((item) => item.id === nextUnitId)
    setTeachingUnitId(nextUnitId); setClassId(data.classes.find((item) => item.teachingUnitId === nextUnitId)?.id ?? '')
    setPeriodId(nextUnit?.periods[0]?.id ?? 0); setTargetPeriodId(nextUnit?.periods[0]?.id ?? 0); setWeekPattern('every'); resetPreview()
  }

  const buildChange = () => {
    if (!lesson) throw new Error('Lesson does not exist')
    const original = `${changeDate}・${dayLabel[lesson.day]}・${lessonPeriod?.label ?? lesson.periodId} ${lessonPeriod?.startTime ?? ''}–${lessonPeriod?.endTime ?? ''}`
    if (mode === 'cancel') return { data: cancelLessonOnDate(changeBase, lesson.id, changeDate, uid), summary: '僅取消指定日期', details: [`原位置：${original}`, '其他日期與固定版本不變'], warnings: [] }
    if (mode === 'move') {
      const targetPeriod = lessonUnit?.periods.find((item) => item.id === targetPeriodId)
      const collisions = targetPeriod ? resolveProjectDay(changeBase, lesson.projectId, fromDateKey(targetDate)).filter((item) => item.status !== 'cancelled' && item.id !== lesson.id && item.startTime < targetPeriod.endTime && targetPeriod.startTime < item.endTime) : []
      return { data: moveLessonOnDate(changeBase, lesson.id, changeDate, { date: targetDate, periodId: targetPeriodId }, allowConflict, uid), summary: '僅移動指定日期', details: [`原位置：${original}（將留白）`, `目標位置：${targetDate}・${targetPeriod?.label ?? targetPeriodId} ${targetPeriod?.startTime ?? ''}–${targetPeriod?.endTime ?? ''}`], warnings: collisions.map((item) => `可能衝堂：${item.subjectName}・${item.className}（${item.schoolName}）`) }
    }
    if (mode === 'replace') return { data: replaceLessonOnDate(changeBase, lesson.id, changeDate, { subjectId, classId, room }, uid), summary: '僅替換指定日期內容', details: [`位置不變：${original}`, `替換為：${data.subjects.find((item) => item.id === subjectId)?.name ?? subjectId}・${data.classes.find((item) => item.id === classId)?.name ?? classId}`], warnings: ['School 與 TeachingUnit 身分維持不變'] }
    const partner = candidates.find((item) => item.id === swapLessonId)
    if (mode === 'swap') return { data: swapLessonOccurrences(changeBase, lesson.id, changeDate, swapLessonId, swapDate, uid), summary: '僅交換指定日期', details: [`課程 A：${original}`, `課程 B：${swapDate}・${partner?.startTime ?? ''}–${partner?.endTime ?? ''}・${partner?.subjectName ?? swapLessonId}・${partner?.className ?? ''}`], warnings: partner?.schoolId !== lessonSchool?.id ? ['跨校交換會依雙方實際時間映射各自節次，不會混用 periodId'] : [] }
    const futureOverrides = relatedOverrides.filter((item) => item.date >= changeDate).length
    if (mode === 'permanent') return { data: permanentlyUpdateLesson(data, lesson.id, changeDate, draft, uid), summary: '從指定日期起永久修改', details: [`生效日期：${changeDate}`, `新時段：${dayLabel[day]}・${periods.find((item) => item.id === periodId)?.label ?? periodId}`, '舊版本將在生效日前一日結束'], warnings: futureOverrides ? [`${futureOverrides} 筆生效日後 override 會安全改指向新版本`] : [] }
    if (mode === 'permanent-swap') return { data: permanentlySwapLessons(data, lesson.id, swapLessonId, changeDate, uid), summary: '從指定日期起永久交換', details: [`生效日期：${changeDate}`, `交換對象：${partner?.subjectName ?? swapLessonId}・${partner?.className ?? ''}`], warnings: ['雙方都會建立新版本；生效日前歷史不變', ...(partner?.schoolId !== lessonSchool?.id ? ['跨校交換必須有相同實際起訖時間的安全節次映射'] : [])] }
    if (mode === 'end') return { data: endLessonFromDate(data, lesson.id, changeDate), summary: '從指定日期起結束課程', details: [`結束日期：${changeDate}`, '生效日前的歷史課表仍保留'], warnings: futureOverrides ? [`仍有 ${futureOverrides} 筆未處理 override，操作將被阻止`] : [] }
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
        data: revokeLessonOverride(data, activeOverride.id), summary: activeOverride.groupId ? '撤銷單日交換' : `撤銷${statusLabel[occurrence?.status ?? 'regular']}`,
        details: [`受影響日期：${activeOverride.date}`, activeOverride.action === 'move' ? `異動目標：${activeOverride.target?.date}・節次 ${activeOverride.target?.periodId}` : '恢復該日期原本的固定課表'],
        warnings: activeOverride.groupId ? [`將原子撤銷交換群組中的 ${grouped.length} 筆關聯異動，雙方課程一併恢復`] : [],
      })
      setEditingOverrideId(null); setError('')
    } catch (reason) { setError(messageFor(reason)); setPreview(null) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('')
    try {
      if (!lesson || mode === 'basic') {
        const next = lesson ? updateLessonV4(data, lesson.id, draft) : addLessonV4(data, draft, uid)
        setData(next); onSaved(projectId); onClose(); return
      }
      setPreview(buildChange())
    } catch (reason) { setError(messageFor(reason)); setPreview(null) }
  }
  const confirmChange = () => {
    if (!preview) return
    setData(preview.data); onSaved(projectId); onClose()
  }
  const remove = () => {
    if (!lesson || !window.confirm(`確定刪除這筆固定課程？\n${lesson.id}\n若要保留歷史，請改用「從此日期起結束」。`)) return
    try { setData(deleteLessonV4(data, lesson.id)); onClose() } catch (reason) { setError(messageFor(reason)) }
  }
  const addSubject = () => {
    const name = newSubjectName.trim(); if (!name) { setError('請輸入科目名稱。'); return }
    const id = uid(); setData((current) => ({ ...current, subjects: [...current.subjects, { id, name, shortName: name.slice(0, 2), color: '#A66D52', origin: 'user' }] }))
    setSubjectId(id); setNewSubjectName(''); setError('')
  }
  const needsContent = !historicalVersion && (mode === 'basic' || mode === 'replace' || mode === 'permanent')
  const needsSwap = mode === 'swap' || mode === 'permanent-swap'

  return <Modal title={lesson ? '編輯課程' : '新增固定課程'} subtitle={lesson ? '清楚區分僅此日期與永久版本；異動須預覽確認後才寫入。' : '直接寫入 AppData v4。'} onClose={onClose}><form className="form-grid" onSubmit={submit}>
    {dragIntent && <p className="lesson-drag-intent full" role="status">拖曳只建立操作意圖，尚未修改資料。預設僅移動 {dragIntent.sourceDate} 的課程至 {dragIntent.targetDate}・{dragIntent.targetStartTime}–{dragIntent.targetEndTime}。{dragIntent.conflictLessonIds.length > 0 && '目標已有課程，請選擇交換、保留衝堂或取消。'}</p>}
    {lesson && <><section className="lesson-context full" aria-label="目前課程資訊"><div><span>學校／任教單位</span><strong>{lessonSchool?.name}・{lessonUnit?.name}</strong></div><div><span>科目／班級</span><strong>{occurrence?.subjectName ?? lessonSubject?.name}・{occurrence?.className ?? lessonClass?.name}</strong></div><div><span>日期／週型</span><strong>{occurrenceDate ?? '未指定日期'}・{lesson.weekPattern === 'every' ? '每週' : `${lesson.weekPattern} 週`}</strong></div><div><span>節次／實際時間</span><strong>{occurrence?.periodLabel ?? lessonPeriod?.label}・{occurrence?.startTime ?? lessonPeriod?.startTime}–{occurrence?.endTime ?? lessonPeriod?.endTime}</strong></div><p><span className={`lesson-status ${occurrence?.status ?? 'regular'}`}>{statusLabel[occurrence?.status ?? 'regular']}</span>{occurrence?.note && <em>{occurrence.note}</em>}</p></section>
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
      <label>學校<select aria-label="課程學校" value={schoolId} onChange={(event) => selectSchool(event.target.value)} disabled={mode === 'replace'}>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
      <label>任教單位<select aria-label="課程任教單位" value={teachingUnitId} onChange={(event) => selectUnit(event.target.value)} disabled={mode === 'replace'}>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {data.subjects.length > 0 ? <label>科目<select aria-label="課程科目" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); resetPreview() }}>{data.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label> : <div className="lesson-subject-create"><label>新科目<input aria-label="新科目名稱" value={newSubjectName} onChange={(event) => setNewSubjectName(event.target.value)} /></label><button type="button" onClick={addSubject}>建立科目</button></div>}
      <label>班級<select aria-label="課程班級" value={classId} onChange={(event) => { setClassId(event.target.value); resetPreview() }}>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {mode !== 'replace' && <><label>星期<select aria-label="課程星期" value={day} onChange={(event) => { setDay(Number(event.target.value) as DayOfWeek); resetPreview() }}>{[1,2,3,4,5].map((value) => <option key={value} value={value}>週{'一二三四五'[value - 1]}</option>)}</select></label><label>節次<select aria-label="課程節次" value={periodId} onChange={(event) => { setPeriodId(Number(event.target.value)); resetPreview() }}>{periods.map((period) => <option key={period.id} value={period.id}>{period.label}（{period.startTime}–{period.endTime}）</option>)}</select></label><label>輪週<select aria-label="課程輪週" value={weekPattern} onChange={(event) => { setWeekPattern(event.target.value as WeekPattern); resetPreview() }}><option value="every">每週</option>{unit?.weekCycle.enabled && <><option value="A">A 週</option><option value="B">B 週</option></>}</select></label></>}
      <label>教室<input value={room} onChange={(event) => { setRoom(event.target.value); resetPreview() }} placeholder="依班級預設" /></label>
    </>}
    {preview && <section className="lesson-change-preview full" role="status" aria-label="異動預覽"><header><strong>異動預覽・{preview.summary}</strong><span>尚未寫入</span></header>{preview.details.map((item) => <p key={item}>{item}</p>)}{preview.warnings.map((item) => <p className="warning" key={item}>{item}</p>)}<small>確認後才會寫入 AppData v4；取消可安全放棄此次預覽。</small></section>}
    {lesson && <details className="lesson-version-history full"><summary>課程版本歷史（{lessonVersions.length}）</summary><p>歷史版本僅供檢視，不可直接回寫。</p><ol>{lessonVersions.map((version) => { const versionUnit = data.teachingUnits.find((item) => item.id === version.teachingUnitId); const versionPeriod = versionUnit?.periods.find((item) => item.id === version.periodId); return <li key={version.id} className={version.id === lesson.id ? 'current' : ''}><div><strong>{version.effectiveStart} — {version.effectiveEnd ?? '持續中'}</strong>{version.id === lesson.id && <em>目前選取</em>}</div><span>{data.subjects.find((item) => item.id === version.subjectId)?.name}・{data.classes.find((item) => item.id === version.classId)?.name}</span><small>{dayLabel[version.day]}・{versionPeriod?.label}・{versionPeriod?.startTime}–{versionPeriod?.endTime}・{version.weekPattern === 'every' ? '每週' : `${version.weekPattern} 週`}</small></li> })}</ol></details>}
    {error && <p className="form-error full" role="alert">{error}</p>}
    <div className="form-actions full">{!historicalVersion && lesson && mode === 'basic' && <button type="button" className="danger-button" onClick={remove}>刪除固定課程</button>}<button type="button" onClick={onClose}>{historicalVersion ? '關閉' : '取消'}</button>{!historicalVersion && (preview ? <button type="button" className="primary-button" onClick={confirmChange}>確認套用</button> : <button type="submit" className="primary-button" disabled={needsSwap && !swapLessonId}>{lesson && mode !== 'basic' ? '預覽異動' : '儲存'}</button>)}</div>
  </form></Modal>
}

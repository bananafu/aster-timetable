import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { addClass } from '../data/academicSettingsV4'
import { addSubjectForLevel } from '../data/subjectsV5'
import { isCompatibleAppDataV7 } from '../data/validators/v7'
import { gradesForLevel, gradeLabel } from '../lib/classes'
import type { StoragePersistence, StorageStatus } from '../hooks/useLocalStorage'
import type { AppDataV4, TeachingUnit } from '../types'

type Kind = 'class' | 'subject'

interface Props {
  kind: Kind
  data: AppDataV4
  setData: Dispatch<SetStateAction<AppDataV4>>
  projectId: string
  unit: TeachingUnit
  storageStatus: StorageStatus
  storagePersistence: StoragePersistence
  onCreated: (id: string) => void
  onCancel: () => void
}

export function LessonResourceCreator({ kind, data, setData, projectId, unit, storageStatus, storagePersistence, onCreated, onCancel }: Props) {
  const [grade, setGrade] = useState(() => gradesForLevel(unit.schoolLevel)[0])
  const [classNumber, setClassNumber] = useState('')
  const [name, setName] = useState('')
  const [room, setRoom] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ id: string; revision: number } | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const firstFieldRef = useRef<HTMLInputElement | null>(null)
  const grades = gradesForLevel(unit.schoolLevel)

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null
    firstFieldRef.current?.focus()
    return () => {
      if (triggerRef.current?.isConnected) triggerRef.current.focus()
      else document.querySelector<HTMLElement>(kind === 'class' ? '[aria-label="課程班級"], [aria-label="班級"]' : '[aria-label="展開科目選單"], [aria-label="科目"]')?.focus()
    }
  }, [kind])

  useEffect(() => {
    if (!pending) return
    if (storageStatus === 'conflict' || storageStatus === 'write-error' || storageStatus === 'read-error') {
      setError(storageStatus === 'conflict' ? '其他分頁已更新資料；新增尚未確認儲存。請先處理資料衝突。' : '新增資料尚未成功寫入此裝置；請先處理儲存問題。')
      setPending(null)
      return
    }
    if (storageStatus !== 'saved' || storagePersistence.pending || storagePersistence.revision <= pending.revision) return
    const exists = kind === 'class'
      ? data.classes.some((item) => item.id === pending.id && item.projectId === projectId && item.teachingUnitId === unit.id)
      : data.subjects.some((item) => item.id === pending.id && item.applicableSchoolLevels?.includes(unit.schoolLevel))
    if (exists) onCreated(pending.id)
    else setError('資料在儲存期間已變更，請重新檢查後再試。')
    setPending(null)
  }, [data.classes, data.subjects, kind, onCreated, pending, projectId, storagePersistence.pending, storagePersistence.revision, storageStatus, unit.id, unit.schoolLevel])

  const create = () => {
    if (pending || storageStatus !== 'saved' || storagePersistence.pending) {
      setError('資料尚未完成儲存，請先處理儲存狀態。')
      return
    }
    try {
      if (!isCompatibleAppDataV7(data) || data.activeProjectId !== projectId || data.projects.find((item) => item.id === projectId)?.archivedAt
        || !data.teachingUnits.some((item) => item.id === unit.id && item.projectId === projectId)) throw new Error('目前專案或學制已變更，請重新確認。')
      const id = crypto.randomUUID()
      const next = kind === 'class'
        ? addClass(data, projectId, grades.length
          ? { teachingUnitId: unit.id, grade, classNumber: Number(classNumber), room }
          : { teachingUnitId: unit.id, name, room }, id)
        : addSubjectForLevel(data, name, unit.schoolLevel, id)
      setError('')
      setPending({ id, revision: storagePersistence.revision })
      setData(next)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法建立資料。') }
  }

  return <div className="lesson-resource-create" role="group" aria-label={kind === 'class' ? '新增班級' : '新增科目'} onKeyDown={(event) => { if (event.key === 'Escape' && !pending) { event.stopPropagation(); onCancel() } }}>
    {kind === 'class' && grades.length > 0 ? <>
      <label>年級<select value={grade} onChange={(event) => setGrade(Number(event.target.value))} disabled={Boolean(pending)}>{grades.map((value) => <option key={value} value={value}>{gradeLabel(unit.schoolLevel, value)}</option>)}</select></label>
      <label>班號<input ref={firstFieldRef} aria-label="新班級班號" type="number" min="1" step="1" value={classNumber} onChange={(event) => setClassNumber(event.target.value)} disabled={Boolean(pending)} /></label>
    </> : <label>{kind === 'class' ? '班級名稱' : '科目名稱'}<input ref={firstFieldRef} aria-label={kind === 'class' ? '新班級名稱' : '新科目名稱'} value={name} onChange={(event) => setName(event.target.value)} disabled={Boolean(pending)} /></label>}
    {kind === 'class' && <label>教室（選填）<input aria-label="新班級教室" value={room} onChange={(event) => setRoom(event.target.value)} disabled={Boolean(pending)} /></label>}
    {error && <p role="alert">{error}</p>}
    <div className="lesson-resource-actions"><button type="button" onClick={onCancel} disabled={Boolean(pending)}>取消</button><button type="button" className="primary-button" onClick={create} disabled={Boolean(pending)}>{pending ? '儲存中…' : kind === 'class' ? '建立班級' : '建立科目'}</button></div>
  </div>
}

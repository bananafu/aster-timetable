import { useState, type Dispatch, type SetStateAction } from 'react'
import type { AppDataV8, EventOwnershipIssueReasonV8 } from '../types'
import {
  confirmEventOwnershipV8,
  eventRepairErrorMessage,
  getEventRepairViewV8,
} from '../data/eventRepairManagementAdapter'
import type { EventRepairCaseV8 } from '../data/eventRepairV8'
import { useEventRepairSession, type EventRepairSession } from '../hooks/useEventRepairSession'
import type { StoragePersistence, StorageStatus } from '../hooks/useLocalStorage'

export interface EventRepairManagerV8Props {
  data: AppDataV8
  setData: Dispatch<SetStateAction<AppDataV8>>
  storageStatus: StorageStatus
  storagePersistence: StoragePersistence
}

const reasonLabel: Record<EventOwnershipIssueReasonV8, string> = {
  'unassigned-project': '尚未確認事件所屬專案。',
  'missing-teaching-unit': '原本的學校與學制已不存在或無法確認。',
  'missing-timetable': '原本的專案尚未建立教師課表。',
  'ambiguous-timetable': '專案中有多份教師課表，需要確認所屬老師。',
  'requires-confirmation': '課表選項已變更，需要重新確認所屬老師。',
}

interface Selection {
  projectId: string
  teachingUnitId: string
  timetableId: string
}

function initialSelection(item: EventRepairCaseV8): Selection {
  const project = item.event.projectId
    ? item.projects.find((candidate) => candidate.project.id === item.event.projectId)
    : undefined
  const unit = project && item.event.teachingUnitId
    ? project.teachingUnits.find((candidate) => candidate.id === item.event.teachingUnitId)
    : undefined
  return {
    projectId: project?.project.id ?? '',
    teachingUnitId: unit?.id ?? '',
    timetableId: '',
  }
}

function EventRepairCard({ item, session }: { item: EventRepairCaseV8; session: EventRepairSession }) {
  const [selection, setSelection] = useState<Selection>(() => initialSelection(item))
  const selectedProject = item.projects.find((candidate) => candidate.project.id === selection.projectId)
  const canSubmit = Boolean(selectedProject && selection.teachingUnitId && selection.timetableId)
  const noLegalProject = item.projects.length === 0
  const noTeachingUnit = selectedProject ? selectedProject.teachingUnits.length === 0 : false
  const noTimetable = selectedProject ? selectedProject.timetables.length === 0 : false

  const confirm = () => {
    if (!canSubmit) {
      session.clearMessage()
      return
    }
    session.submit(
      (current) => confirmEventOwnershipV8(current, { eventId: item.event.id, ...selection }),
      `已儲存事件「${item.event.title}」的課表歸屬。`,
      eventRepairErrorMessage,
    )
  }

  return <article className="event-repair-card">
    <header>
      <div>
        <h3>{item.event.title}</h3>
        <p>{item.event.date}・{item.event.startTime}–{item.event.endTime}</p>
      </div>
      <span>待確認</span>
    </header>
    {item.event.location && <p className="event-repair-detail">地點：{item.event.location}</p>}
    {item.event.notes && <p className="event-repair-detail">內容：{item.event.notes}</p>}
    <p className="event-repair-reason">{reasonLabel[item.event.ownershipIssue.reason]}</p>

    {noLegalProject ? <p className="form-error" role="alert">目前沒有可安全指派的專案，請先恢復可用的專案、學校與教師課表。</p> : <div className="event-repair-fields">
      <label>專案
        <select aria-label={`事件「${item.event.title}」所屬專案`} value={selection.projectId} disabled={session.locked} onChange={(event) => {
          setSelection({ projectId: event.target.value, teachingUnitId: '', timetableId: '' })
          session.clearMessage()
        }}>
          <option value="">請選擇專案</option>
          {item.projects.map((candidate) => <option key={candidate.project.id} value={candidate.project.id}>
            {candidate.project.name}
          </option>)}
        </select>
      </label>
      <label>學校與學制
        <select aria-label={`事件「${item.event.title}」學校與學制`} value={selection.teachingUnitId}
          disabled={session.locked || !selectedProject} onChange={(event) => {
            setSelection((current) => ({ ...current, teachingUnitId: event.target.value }))
            session.clearMessage()
          }}>
          <option value="">請選擇學校與學制</option>
          {selectedProject?.teachingUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
        </select>
      </label>
      <label>教師課表
        <select aria-label={`事件「${item.event.title}」所屬課表`} value={selection.timetableId}
          disabled={session.locked || !selectedProject || noTimetable} onChange={(event) => {
            setSelection((current) => ({ ...current, timetableId: event.target.value }))
            session.clearMessage()
          }}>
          <option value="">請選擇教師課表</option>
          {selectedProject?.timetables.map((timetable) => <option key={timetable.id} value={timetable.id}>
            {timetable.teacherName ? `${timetable.teacherName}・${timetable.name}` : timetable.name}
          </option>)}
        </select>
      </label>
    </div>}
    {noTeachingUnit && <p className="form-error" role="alert">這個專案目前沒有可用的學校與學制，無法安全確認事件歸屬。</p>}
    {noTimetable && <p className="form-error" role="alert">這個專案目前沒有可用的教師課表，請先建立課表後再確認。</p>}
    <div className="event-repair-actions">
      <button type="button" className="primary-button" disabled={session.locked || !canSubmit} onClick={confirm}>
        確認歸屬
      </button>
    </div>
  </article>
}

export function EventRepairManagerV8({
  data,
  setData,
  storageStatus,
  storagePersistence,
}: EventRepairManagerV8Props) {
  const session = useEventRepairSession({ data, setData, storageStatus, storagePersistence })
  const visibleData = session.operation && session.operation.status !== 'persisted'
    ? session.operation.before
    : data
  const view = getEventRepairViewV8(visibleData)

  return <section className="event-repair-manager" aria-label="待確認事件歸屬">
    <header className="event-repair-heading">
      <div>
        <h2>待確認事件</h2>
        <p>確認事件屬於哪一位老師的課表後，才會顯示在正常課表中。</p>
      </div>
      <strong aria-label={`待確認事件 ${view.pendingCount} 筆`}>{view.pendingCount}</strong>
    </header>

    {view.pendingCount === 0
      ? <p className="resource-list-empty">目前沒有待確認的事件。</p>
      : <div className="event-repair-list">{view.cases.map((item) => <EventRepairCard
        key={item.event.id}
        item={item}
        session={session}
      />)}</div>}

    {session.locked && !session.error && <p role="status" className="event-repair-status">正在確認事件歸屬是否已儲存…</p>}
    {session.error && <p role="alert" className="form-error">{session.error}</p>}
    {session.success && <p role="status" className="form-success">{session.success}</p>}
  </section>
}

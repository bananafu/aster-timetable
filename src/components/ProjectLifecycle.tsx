import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { createFormalV7ProjectLifecycleActions, type ProjectLifecycleActions } from '../formalV7ProjectTimetableActions'
import { createExampleAppDataV4 } from '../hooks/useAppDataV4'
import type { StoragePersistence, StorageStatus } from '../hooks/useLocalStorage'
import { addDays, fromDateKey, startOfWeek } from '../lib/date'
import type { AppDataV4 } from '../types'
import { AcademicSettingsV4 } from './AcademicSettingsV4'
import { MultiSchoolSchedule } from './MultiSchoolSchedule'
import { FirstUseView, ProjectLifecycleView } from './ProjectLifecycleView'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
type V7Props = { data: AppDataV4; setData: Dispatch<SetStateAction<AppDataV4>>;
  onViewArchived: (id: string) => void; actions?: ProjectLifecycleActions }

export function FirstUse({ data, setData, onViewArchived,
  actions = createFormalV7ProjectLifecycleActions(data, setData, uid) }: V7Props) {
  const example = useMemo(createExampleAppDataV4, [])
  const exampleWeek = useMemo(() => Array.from({ length: 5 }, (_, index) =>
    addDays(startOfWeek(fromDateKey(example.teachingUnits[0].startDate)), index)), [example])
  return <FirstUseView data={data} actions={actions} onViewArchived={onViewArchived}
    example={<MultiSchoolSchedule data={example} weekDays={exampleWeek} />} />
}

export function ProjectLifecycleModal({ data, setData, initialPage = 'root', onClose, onViewArchived,
  storageStatus = 'saved', storagePersistence = { pending: false, revision: 0 }, readOnly = false,
  actions = createFormalV7ProjectLifecycleActions(data, setData, uid) }: V7Props & {
  initialPage?: 'root' | 'blank'; onClose: () => void; storageStatus?: StorageStatus;
  storagePersistence?: StoragePersistence; readOnly?: boolean
}) {
  const deletionMessage = (projectId: string) => {
    const project = data.projects.find((item) => item.id === projectId)!
    const count = (rows: { projectId: string | null }[]) => rows.filter((item) => item.projectId === projectId).length
    return `永久刪除「${project.name}」？\n將刪除 ${count(data.timetables ?? [])} 份教師課表、${count(data.schools)} 所學校、${count(data.teachingUnits)} 個學制設定、${count(data.classes)} 個班級、${count(data.recurringLessons)} 筆固定課程、${count(data.oneOffLessons ?? [])} 筆單日課程、${count(data.events)} 筆事件及 ${count(data.overrides)} 筆異動。\n其他專案與全域科目不受影響。`
  }
  return <ProjectLifecycleView data={data} initialPage={initialPage} actions={actions} onClose={onClose}
    onViewArchived={onViewArchived} readOnly={readOnly} deletionMessage={deletionMessage}
    renderAcademicSettings={(page) => <AcademicSettingsV4 data={data} setData={setData} page={page}
      storageStatus={storageStatus} storagePersistence={storagePersistence} readOnly={readOnly} />} />
}

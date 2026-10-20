import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ClassDraft } from '../data/academicSettingsV4'
import type { SubjectDraft } from '../data/subjectsV5'
import type { AppDataV4, ProjectClass, Subject, TeachingUnit } from '../types'
import type { StoragePersistence, StorageStatus } from './useLocalStorage'

type DraftValue = string | ClassDraft | SubjectDraft
type Resource = Subject | ProjectClass
export interface ResourceContext { projectId: string; teachingUnitId?: string }
export interface ResourceDraft extends ResourceContext {
  kind: 'subject' | 'class' | 'subject-create' | 'class-create'
  source: Resource | null
  unitSnapshot?: TeachingUnit
  initial: DraftValue
  value: DraftValue
  submittedTargetId?: string
}
export type ResourceOperationType = 'create-subject' | 'update-subject' | 'delete-subject' | 'remove-subject-level'
  | 'create-class' | 'update-class' | 'delete-class'
interface Submission extends ResourceContext {
  type: ResourceOperationType
  targetId: string
  draftKeys: string[]
  source?: Resource
  success: string
}
interface ResourceOperation extends Submission {
  status: 'submitted' | 'pending' | 'blocked' | 'unconfirmed' | 'persisted'
  startedRevision: number
  before: AppDataV4
  expected: AppDataV4
  expectedResult: string
  drafts: Record<string, ResourceDraft>
  message: string
}
interface View {
  projectId: string | null
  schoolId: string
  unitId: string
  showAllSubjects: boolean
  showClassCreate: boolean
}

// Compare editable values without treating checkbox order or omitted optional keys as edits.
function comparable(value: unknown): string {
  return JSON.stringify(value, (key, item) => {
    if (key === 'applicableSchoolLevels' && Array.isArray(item)) return [...item].sort()
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const fields = Object.entries(item).filter(([field]) => !(field === 'name' && !('id' in item)
        && 'teachingUnitId' in item && item.grade !== undefined && item.classNumber !== undefined))
      return Object.fromEntries(fields.sort(([a], [b]) => a.localeCompare(b)))
    }
    return item
  })
}

function initialView(data: AppDataV4): View {
  const schoolId = data.schools.find((school) => school.projectId === data.activeProjectId)?.id ?? ''
  const units = data.teachingUnits.filter((unit) => unit.projectId === data.activeProjectId && unit.schoolId === schoolId)
  const duplicate = units.some((unit) => units.some((other) => unit.id !== other.id && unit.schoolLevel === other.schoolLevel))
  return { projectId: data.activeProjectId, schoolId, unitId: duplicate ? '' : units[0]?.id ?? '', showAllSubjects: false, showClassCreate: false }
}

function creationReview(data: AppDataV4, draft: ResourceDraft): string {
  const target = (draft.kind === 'class-create' ? data.classes : data.subjects).find((item) => item.id === draft.submittedTargetId)
  return `原新增 ID：${draft.submittedTargetId}。${target ? `目前文件包含原 ID「${target.name}」` : '目前文件未包含原 ID'}；這不代表原操作已在本頁持久化成功。`
}

/** UI-only session. All writes and recovery remain owned by the existing storage hook. */
export function useResourceManagementSession(data: AppDataV4, setData: Dispatch<SetStateAction<AppDataV4>>,
  storageStatus: StorageStatus = 'saved', persistence?: StoragePersistence) {
  const [state, setState] = useState(() => ({ view: initialView(data), drafts: {} as Record<string, ResourceDraft>, operation: null as ResourceOperation | null, error: '' }))
  const stateRef = useRef(state)
  const currentRef = useRef({ data, storageStatus, persistence })
  currentRef.current = { data, storageStatus, persistence }
  const change = (update: (current: typeof state) => typeof state) => {
    const next = update(stateRef.current)
    stateRef.current = next
    setState(next)
  }
  const dirtyKeys = Object.keys(state.drafts)
  const operation = state.operation
  const locked = Boolean(operation && ['submitted', 'pending', 'blocked'].includes(operation.status)) || Boolean(persistence?.pending)
  const error = state.error || (operation?.status === 'blocked' || operation?.status === 'unconfirmed' ? operation.message : '')
  const unconfirmedCreations = !locked && storageStatus === 'saved' ? Object.entries(state.drafts)
    .filter(([, draft]) => draft.submittedTargetId)
    .map(([key, draft]) => ({ key, kind: draft.kind, message: creationReview(data, draft) })) : []

  useEffect(() => {
    const current = stateRef.current
    const op = current.operation
    if (!op || op.status === 'persisted' || op.status === 'unconfirmed') return
    let status: ResourceOperation['status'] = 'submitted'
    let message = ''
    if (storageStatus !== 'saved') {
      status = 'blocked'
      message = storageStatus === 'conflict' ? '跨分頁資料衝突；本次操作尚未確認儲存，草稿與操作紀錄已保留。'
        : '資料尚未成功寫入此裝置；草稿與操作紀錄已保留，請先處理儲存問題。'
    } else if (data !== op.before && data !== op.expected) {
      status = 'unconfirmed'
      message = op.type === 'remove-subject-level' ? '科目資料在儲存期間已變更，無法確認解除結果；草稿已保留。'
        : '資料在儲存期間已被替換，無法確認本次操作；草稿已保留，請重新確認。'
    } else if (persistence && !persistence.pending && persistence.revision > op.startedRevision) {
      status = data === op.expected && JSON.stringify(data) === op.expectedResult ? 'persisted' : 'unconfirmed'
      message = status === 'persisted' ? op.success : '持久化結果與預期不同；無法確認本次操作，草稿已保留。'
    } else if (persistence?.pending || data === op.expected) status = 'pending'
    if (status === op.status && message === op.message) return
    const drafts = { ...current.drafts }
    if (status === 'persisted') op.draftKeys.forEach((key) => { delete drafts[key] })
    const next = { ...current, drafts, error: status === 'persisted' ? '' : current.error, view: status === 'persisted' && op.type === 'create-class'
      ? { ...current.view, showClassCreate: false } : current.view, operation: { ...op, status, message } }
    stateRef.current = next
    setState(next)
  }, [data, storageStatus, persistence, operation])

  // A pristine session may follow a new project. Dirty/unfinished sessions never reset on props.
  useEffect(() => {
    const current = stateRef.current
    if (current.view.projectId === data.activeProjectId || Object.keys(current.drafts).length
      || (current.operation && current.operation.status !== 'persisted' && current.operation.status !== 'unconfirmed')) return
    const next = { ...current, view: initialView(data) }
    stateRef.current = next
    setState(next)
  }, [data, state.drafts, state.operation])

  const fail = (message: string) => change((current) => ({ ...current, error: message }))
  const requestTransition = (action: () => void, keys = Object.keys(stateRef.current.drafts)) => {
    const current = stateRef.current
    if (currentRef.current.persistence?.pending || (current.operation && ['submitted', 'pending', 'blocked'].includes(current.operation.status))) {
      fail('已提交的操作尚未確認持久化，不能捨棄或離開。請先完成儲存或處理復原。')
      return false
    }
    const affected = keys.filter((key) => current.drafts[key])
    const submitted = affected.filter((key) => current.drafts[key].submittedTargetId)
    const reviews = submitted.map((key) => creationReview(currentRef.current.data, current.drafts[key]))
    if (affected.length && !window.confirm(['尚有未儲存的科目或班級草稿，確定捨棄受影響的草稿？', ...reviews,
      ...(submitted.length ? ['結束未確認新增只會清除相關輸入，不會更動目前文件中的資源，也不會認定本地儲存成功。'] : [])].join('\n'))) return false
    change((latest) => {
      const drafts = { ...latest.drafts }
      affected.forEach((key) => { delete drafts[key] })
      const op = latest.operation
      return { ...latest, drafts, error: '', operation: op?.status === 'unconfirmed' && submitted.some((key) => op.draftKeys.includes(key))
        ? { ...op, message: '已結束這次未確認新增並清除輸入；未更動現有資源，也未認定本地儲存成功。' } : op }
    })
    action()
    return true
  }
  const submit = (request: Submission, operation: (current: AppDataV4) => AppDataV4) => {
    const latest = currentRef.current
    const current = stateRef.current
    if (latest.storageStatus !== 'saved' || latest.persistence?.pending
      || (current.operation && ['submitted', 'pending', 'blocked'].includes(current.operation.status))) {
      fail('資料尚未完成儲存或仍待復原，不能重複提交。')
      return false
    }
    if (request.type === 'create-class' || request.type === 'create-subject') {
      const bound = request.draftKeys.map((key) => current.drafts[key]).find((draft) => draft?.submittedTargetId)
      if (bound) {
        fail(`${creationReview(latest.data, bound)}請先核對並結束這次未確認新增，不能直接再次新增。`)
        return false
      }
    }
    try {
      const apply = (base: AppDataV4) => {
        if (base.activeProjectId !== request.projectId || !base.projects.some((project) => project.id === request.projectId && !project.archivedAt)) {
          throw new Error('目前專案已切換、封存或刪除；草稿已保留。')
        }
        if (request.teachingUnitId && !base.teachingUnits.some((unit) => unit.id === request.teachingUnitId && unit.projectId === request.projectId)) {
          throw new Error('原學制已刪除或變更；草稿已保留，不能回寫。')
        }
        for (const key of request.draftKeys) {
          const unit = current.drafts[key]?.unitSnapshot
          if (unit && comparable(base.teachingUnits.find((item) => item.id === unit.id)) !== comparable(unit)) {
            throw new Error('草稿所屬學制已變更或刪除；內容已保留，請先重新確認。')
          }
        }
        const resources = request.type.endsWith('class') ? base.classes : base.subjects
        const source = request.source
        const originalDraft = request.draftKeys.map((key) => current.drafts[key]).find((draft) => draft?.source)?.source
        if (source && (!resources.some((item) => item.id === source.id && comparable(item) === comparable(source))
          || (originalDraft && comparable(source) !== comparable(originalDraft)))) {
          throw new Error('來源資料已變更或刪除；草稿已保留，請先確認最新資料，不能直接回寫。')
        }
        return operation(base)
      }
      const expected = apply(latest.data)
      const record: ResourceOperation = { ...request, status: 'submitted', startedRevision: latest.persistence?.revision ?? 0,
        before: latest.data, expected, expectedResult: JSON.stringify(expected), drafts: { ...current.drafts }, message: '' }
      // Install the latch synchronously, before invoking the functional updater.
      change((value) => {
        const drafts = { ...value.drafts }
        if (request.type === 'create-class' || request.type === 'create-subject') request.draftKeys.forEach((key) => {
          if (drafts[key]) drafts[key] = { ...drafts[key], submittedTargetId: request.targetId }
        })
        return { ...value, drafts, operation: record, error: '' }
      })
      setData((base) => {
        const result = apply(base)
        record.before = base
        record.expected = result
        record.expectedResult = JSON.stringify(result)
        return result
      })
      return true
    } catch (cause) {
      change((value) => ({ ...value, drafts: current.drafts, operation: current.operation, error: cause instanceof Error ? cause.message : '操作未通過驗證，草稿已保留。' }))
      return false
    }
  }

  return {
    view: state.view, drafts: state.drafts, dirtyKeys, operation, locked, error, unconfirmedCreations,
    status: operation && operation.status !== 'persisted' ? operation.status : dirtyKeys.length ? 'dirty' : operation ? 'persisted' : 'clean',
    success: operation?.status === 'persisted' && data === operation.expected && storageStatus === 'saved'
      && persistence && !persistence.pending && persistence.revision > operation.startedRevision ? operation.message : '',
    setView: (update: Partial<View>) => change((current) => ({ ...current, view: { ...current.view, ...update } })),
    draft: <T extends DraftValue>(key: string, initial: T): T => (state.drafts[key]?.value as T | undefined) ?? initial,
    edit: (key: string, entry: ResourceDraft) => change((current) => {
      if (currentRef.current.persistence?.pending || (current.operation && ['submitted', 'pending', 'blocked'].includes(current.operation.status))) return current
      const previous = current.drafts[key]
      if (previous?.submittedTargetId) return current
      const next = previous ? { ...previous, value: entry.value } : entry
      const drafts = { ...current.drafts }
      if (comparable(next.initial) === comparable(next.value)) delete drafts[key]
      else drafts[key] = next
      return { ...current, drafts, error: '' }
    }),
    requestTransition, submit, fail,
    adoptExternal: (action: () => void) => {
      // The storage hook may reject adoption. Only observed data replacement invalidates the receipt.
      change((current) => ({ ...current, error: '' }))
      action()
    },
  }
}

export type ResourceManagementSession = ReturnType<typeof useResourceManagementSession>

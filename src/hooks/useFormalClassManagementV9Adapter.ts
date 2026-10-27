import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClassV8Error, type ClassV8Draft } from '../data/classesV8'
import { createFormalClassManagementV9Controller, FormalClassManagementV9Error,
  presentFormalClassManagementV9,
  type FormalClassManagementV9Result, type FormalClassManagementV9Selection } from '../formalClassManagementV9'
import type { FormalV9HostPort } from '../formalRuntime'
import type { ProjectClass, School, TeachingUnit } from '../types'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

function operationError(cause: unknown): string {
  if (!(cause instanceof Error)) return '班級操作未通過驗證，原本資料與草稿均已保留。'
  if (cause instanceof FormalClassManagementV9Error) {
    if (cause.code === 'duplicate-submit') return '已有班級操作正在寫入，不能重複提交。'
    if (cause.code === 'stale-document') return '班級資料已更新；本次操作未寫入，草稿已保留。'
    if (cause.code === 'scope-mismatch') return 'Project 或任教單位已切換，舊操作不能寫入目前範圍。'
    if (cause.code === 'not-writable') return 'V9 Host 目前不可寫入，班級草稿已保留。'
    if (cause.code === 'receipt-mismatch') return 'Host receipt 無法確認班級已持久化；不會顯示成功。'
    return cause.message
  }
  if (cause instanceof ClassV8Error) {
    const labels: Partial<Record<ClassV8Error['code'], string>> = {
      'invalid-project': 'Project 不存在、已封存或不可編輯。',
      'invalid-unit': '任教單位不屬於目前 Project。',
      'invalid-class': '班級不屬於目前 Project。',
      'invalid-draft': '年級、班號、名稱或教室資料不符合目前學制規則。',
      'invalid-id': '新班級 ID 不合法。',
      'id-collision': '新班級 ID 已被其他資料使用。',
      duplicate: '目前任教單位已存在相同年級與班號。',
      referenced: '班級仍被課程、異動、單日課程或教學進度引用。',
      'confirmation-required': '永久刪除班級需要明確確認。',
      'unsafe-update': '班級變更未通過資料安全檢查。',
      'invalid-data': 'V9 文件未通過班級資料驗證。',
    }
    return labels[cause.code] ?? cause.message
  }
  return cause.message
}

export interface FormalClassManagementV9UiPort {
  runtime: 'v9'
  selection: FormalClassManagementV9Selection
  view: ReturnType<typeof presentFormalClassManagementV9> | null
  schools: School[]
  teachingUnits: TeachingUnit[]
  classes: ProjectClass[]
  pending: boolean
  writable: boolean
  error: string
  success: string
  selectTeachingUnit: (teachingUnitId: string | null) => void
  clearFeedback: () => void
  actions: {
    create: (draft: ClassV8Draft) => Promise<FormalClassManagementV9Result>
    update: (classId: string, draft: ClassV8Draft) => Promise<FormalClassManagementV9Result>
    impact: ReturnType<typeof createFormalClassManagementV9Controller>['actions']['impact']
    delete: (classId: string) => Promise<FormalClassManagementV9Result>
  }
}

interface ConfirmedSnapshot {
  document: FormalClassManagementV9Result['document']
  revision: number
  raw: string
}

/** Maps the existing formal Class UI callbacks to the S2-4 V9 controller without mounting Runtime. */
export function useFormalClassManagementV9Adapter(host: FormalV9HostPort,
  selection: FormalClassManagementV9Selection,
  onSelectionChange: (selection: FormalClassManagementV9Selection) => void,
  createId: () => string = uid): FormalClassManagementV9UiPort {
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const [confirmed, setConfirmed] = useState<ConfirmedSnapshot | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!confirmed || host.revision < confirmed.revision) return
    if (host.revision === confirmed.revision && host.document
      && JSON.stringify(host.document) !== confirmed.raw) {
      setSuccess('')
      setError('Host 最新 snapshot 與已確認 receipt 不一致；已停止沿用該操作結果。')
    }
    setConfirmed(null)
  }, [confirmed, host.document, host.revision])

  const effectiveDocument = confirmed?.document ?? host.document
  const effectiveRevision = confirmed?.revision ?? host.revision
  const effectiveHost = useMemo<FormalV9HostPort>(() => ({ ...host,
    document: effectiveDocument, revision: effectiveRevision,
    pending: host.pending || submitting,
  }), [effectiveDocument, effectiveRevision, host, submitting])
  const controller = useMemo(() => effectiveDocument
    ? createFormalClassManagementV9Controller(effectiveHost, createId, selection,
      () => selectionRef.current)
    : null, [createId, effectiveDocument, effectiveHost, selection])
  const view = useMemo(() => effectiveDocument
    ? presentFormalClassManagementV9(effectiveDocument, selection, effectiveHost) : null,
  [effectiveDocument, effectiveHost, selection])

  const execute = useCallback(async (operation: (current: NonNullable<typeof controller>) =>
  Promise<FormalClassManagementV9Result>, message: string) => {
    if (!controller) throw new Error('V9 班級資料目前無法使用。')
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const result = await operation(controller)
      setConfirmed({ document: result.document, revision: result.receipt.revision,
        raw: result.receipt.raw })
      setSuccess(message)
      return result
    } catch (cause) {
      setError(operationError(cause))
      throw cause
    } finally {
      setSubmitting(false)
    }
  }, [controller])

  const actions = useMemo<FormalClassManagementV9UiPort['actions']>(() => ({
    create: (draft) => execute((current) => current.actions.create(draft),
      '已儲存：已新增班級。'),
    update: (classId, draft) => execute((current) => current.actions.update(classId, draft),
      '已儲存：已更新班級。'),
    impact: (classId) => {
      if (!controller) throw new Error('V9 班級資料目前無法使用。')
      return controller.actions.impact(classId)
    },
    delete: (classId) => execute((current) => current.actions.delete(classId),
      '已儲存：已刪除班級。'),
  }), [controller, execute])

  return {
    runtime: 'v9', selection, view,
    schools: view?.schools ?? [], teachingUnits: view?.teachingUnits ?? [],
    classes: view?.classes ?? [], pending: host.pending || submitting,
    writable: Boolean(view?.actions.create.enabled), error, success,
    selectTeachingUnit: (teachingUnitId) => onSelectionChange({ ...selection, teachingUnitId }),
    clearFeedback: () => { setError(''); setSuccess('') }, actions,
  }
}

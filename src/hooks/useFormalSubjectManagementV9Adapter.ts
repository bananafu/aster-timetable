import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SubjectDraftV9, TeacherSubjectV9Error,
  TeacherSubjectV9Reference } from '../data/teacherSubjectsV9'
import { createFormalSubjectManagementV9Controller, presentFormalSubjectManagementV9,
  type FormalSubjectManagementV9Result, type FormalSubjectManagementV9Selection } from '../formalSubjectManagementV9'
import type { FormalV9HostPort } from '../formalRuntime'
import type { School, TeachingUnit } from '../types'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

const referenceLabel: Record<TeacherSubjectV9Reference['kind'], string> = {
  lesson: '固定課程', change: '課程異動', 'one-off': '單日課程', progress: '教學進度',
}

function operationError(cause: unknown): string {
  if (!(cause instanceof Error)) return '操作未通過驗證，原本的科目資料與草稿均已保留。'
  const details = (cause as TeacherSubjectV9Error).details
  const references = details?.references ?? details?.impact?.deletion.references ?? []
  const configurations = details?.configurations ?? details?.impact?.deletion.configurations ?? []
  const reasons = references.slice(0, 3).map((reference) => {
    const flags = [reference.historical ? '歷史版本' : '', reference.archived ? '封存 Project' : '',
      reference.scope === 'unknown' ? '歸屬無法判定' : ''].filter(Boolean)
    return `${flags.length ? `${flags.join('、')} ` : ''}${referenceLabel[reference.kind]}「${reference.id}」`
  })
  if (references.length > 3) reasons.push(`另有 ${references.length - 3} 筆引用`)
  if (configurations.length) reasons.push(`${configurations.length} 筆任教單位配置`)
  return reasons.length ? `${cause.message} 阻擋原因：${reasons.join('；')}。請先處理引用或配置後再試。`
    : cause.message
}

export interface FormalSubjectManagementV9UiPort {
  runtime: 'v9'
  selection: FormalSubjectManagementV9Selection
  view: ReturnType<typeof presentFormalSubjectManagementV9> | null
  schools: School[]
  teachingUnits: TeachingUnit[]
  pending: boolean
  writable: boolean
  error: string
  success: string
  selectTeachingUnit: (teachingUnitId: string | null) => void
  clearFeedback: () => void
  actions: {
    createCustom: (draft: SubjectDraftV9) => Promise<FormalSubjectManagementV9Result>
    createAndConfigureFromCatalog: (catalogKey: string) => Promise<FormalSubjectManagementV9Result>
    update: (subjectId: string, draft: SubjectDraftV9) => Promise<FormalSubjectManagementV9Result>
    configure: (subjectId: string, confirmLevelExtension?: boolean) => Promise<FormalSubjectManagementV9Result>
    unconfigure: (subjectId: string) => Promise<FormalSubjectManagementV9Result>
    impact: ReturnType<typeof createFormalSubjectManagementV9Controller>['actions']['impact']
    delete: (subjectId: string) => Promise<FormalSubjectManagementV9Result>
  }
}

interface ConfirmedSnapshot {
  document: FormalSubjectManagementV9Result['document']
  revision: number
  raw: string
}

/**
 * Unmounted production adapter. It exposes the established Subject manager with a V9-only action
 * port while Stage 0 continues to keep the production V9 Runtime disabled.
 */
export function useFormalSubjectManagementV9Adapter(host: FormalV9HostPort,
  selection: FormalSubjectManagementV9Selection,
  onSelectionChange: (selection: FormalSubjectManagementV9Selection) => void,
  createId: () => string = uid): FormalSubjectManagementV9UiPort {
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
    ? createFormalSubjectManagementV9Controller(effectiveHost, createId, selection,
      () => selectionRef.current)
    : null, [createId, effectiveDocument, effectiveHost, selection])
  const view = useMemo(() => effectiveDocument
    ? presentFormalSubjectManagementV9(effectiveDocument, selection, effectiveHost) : null,
  [effectiveDocument, effectiveHost, selection])

  const execute = useCallback(async (operation: (current: NonNullable<typeof controller>) =>
  Promise<FormalSubjectManagementV9Result>, message: string) => {
    if (!controller) throw new Error('V9 科目資料目前無法使用。')
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

  const actions = useMemo<FormalSubjectManagementV9UiPort['actions']>(() => ({
    createCustom: (draft) => execute((current) => current.actions.createCustom(draft),
      '已儲存：已新增科目。'),
    createAndConfigureFromCatalog: (catalogKey) => execute(
      (current) => current.actions.createAndConfigureFromCatalog(catalogKey),
      '已儲存：已加入預設科目。'),
    update: (subjectId, draft) => execute((current) => current.actions.update(subjectId, draft),
      '已儲存：已更新科目。'),
    configure: (subjectId, confirmLevelExtension) => execute(
      (current) => current.actions.configure(subjectId, confirmLevelExtension),
      '已儲存：已配置科目到目前任教單位。'),
    unconfigure: (subjectId) => execute((current) => current.actions.unconfigure(subjectId),
      '已儲存：已解除目前任教單位的科目配置；科目本身仍保留。'),
    impact: (subjectId) => {
      if (!controller) throw new Error('V9 科目資料目前無法使用。')
      return controller.actions.impact(subjectId)
    },
    delete: (subjectId) => execute((current) => current.actions.delete(subjectId),
      '已儲存：已永久刪除科目。'),
  }), [controller, execute])

  const schools = useMemo(() => effectiveDocument && selection.projectId
    ? effectiveDocument.schools.filter((school) => school.projectId === selection.projectId)
      .map((school) => ({ ...school })) : [], [effectiveDocument, selection.projectId])
  const teachingUnits = useMemo(() => view?.teachingUnits.map((unit) => ({ ...unit,
    periods: unit.periods.map((period) => ({ ...period })), weekCycle: { ...unit.weekCycle },
  })) ?? [], [view])

  return {
    runtime: 'v9', selection, view, schools, teachingUnits,
    pending: host.pending || submitting, writable: Boolean(view?.actions.createCustom.enabled),
    error, success,
    selectTeachingUnit: (teachingUnitId) => onSelectionChange({ ...selection, teachingUnitId }),
    clearFeedback: () => { setError(''); setSuccess('') }, actions,
  }
}

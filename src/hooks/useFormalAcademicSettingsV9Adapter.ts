import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SchoolV8Draft, TeachingUnitV8Draft } from '../data/academicSettingsV8'
import { createFormalAcademicSettingsV9Controller, FormalAcademicSettingsV9Error,
  presentFormalAcademicSettingsV9, type FormalAcademicSettingsV9Result,
  type FormalAcademicSettingsV9Selection, type FormalTeachingUnitV9Input } from '../formalAcademicSettingsV9'
import type { FormalV9HostPort } from '../formalRuntime'

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

function operationError(cause: unknown) {
  if (!(cause instanceof Error)) return '設定未通過驗證，原本資料與草稿均已保留。'
  if (!(cause instanceof FormalAcademicSettingsV9Error)) return cause.message
  if (cause.code === 'duplicate-submit') return '已有學校或學制操作正在寫入，不能重複提交。'
  if (cause.code === 'stale-document') return '設定資料已更新；本次操作未寫入，草稿已保留。'
  if (cause.code === 'scope-mismatch') return 'Project、課表或學制選取已切換，舊操作不能寫入目前範圍。'
  if (cause.code === 'not-writable') return 'V9 Host 目前不可寫入，設定草稿已保留。'
  if (cause.code === 'receipt-mismatch') return 'Host receipt 無法確認設定已持久化；不會顯示成功。'
  return cause.message
}

interface ConfirmedSnapshot {
  document: FormalAcademicSettingsV9Result['document']
  revision: number
  raw: string
}

export function useFormalAcademicSettingsV9Adapter(host: FormalV9HostPort,
  selection: FormalAcademicSettingsV9Selection,
  onSelectionChange: (selection: FormalAcademicSettingsV9Selection) => void,
  createId: () => string = uid) {
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
    ? createFormalAcademicSettingsV9Controller(effectiveHost, createId, selection,
      () => selectionRef.current) : null,
  [createId, effectiveDocument, effectiveHost, selection])
  const view = useMemo(() => effectiveDocument
    ? presentFormalAcademicSettingsV9(effectiveDocument, selection, effectiveHost) : null,
  [effectiveDocument, effectiveHost, selection])

  const execute = useCallback(async (operation: (current: NonNullable<typeof controller>) =>
  Promise<FormalAcademicSettingsV9Result>, message: string) => {
    if (!controller) throw new Error('V9 學校與學制資料目前無法使用。')
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const result = await operation(controller)
      setConfirmed({ document: result.document, revision: result.receipt.revision, raw: result.receipt.raw })
      onSelectionChange(result.selection)
      setSuccess(message)
      return result
    } catch (cause) {
      setError(operationError(cause))
      throw cause
    } finally {
      setSubmitting(false)
    }
  }, [controller, onSelectionChange])

  const actions = useMemo(() => ({
    createSchool: (draft: SchoolV8Draft) => execute((current) => current.actions.createSchool(draft),
      '已儲存：已新增學校。'),
    createSchoolWithTeachingUnit: (school: SchoolV8Draft, input: FormalTeachingUnitV9Input) =>
      execute((current) => current.actions.createSchoolWithTeachingUnit(school, input),
        '已儲存：已新增學校與學制。'),
    updateSchool: (schoolId: string, draft: SchoolV8Draft) => execute(
      (current) => current.actions.updateSchool(schoolId, draft), '已儲存：已更新學校。'),
    createTeachingUnit: (schoolId: string, input: FormalTeachingUnitV9Input) => execute(
      (current) => current.actions.createTeachingUnit(schoolId, input), '已儲存：已新增學制。'),
    updateTeachingUnit: (teachingUnitId: string, draft: TeachingUnitV8Draft) => execute(
      (current) => current.actions.updateTeachingUnit(teachingUnitId, draft), '已儲存：已更新學制設定。'),
  }), [execute])

  return { runtime: 'v9' as const, selection, view,
    schools: view?.schools ?? [], teachingUnits: view?.teachingUnits ?? [],
    pending: host.pending || submitting, writable: Boolean(view?.writable), error, success, actions,
    clearFeedback: () => { setError(''); setSuccess('') },
  }
}

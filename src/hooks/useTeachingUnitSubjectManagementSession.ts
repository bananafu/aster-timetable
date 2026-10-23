import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AppDataV8 } from '../types'
import type { StoragePersistence, StorageStatus } from './useLocalStorage'

type OperationStatus = 'submitted' | 'pending' | 'blocked' | 'unconfirmed' | 'persisted'

interface Operation {
  status: OperationStatus
  before: AppDataV8
  expected: AppDataV8
  expectedResult: string
  startedRevision: number
  success: string
  message: string
  onPersisted?: () => void
}

interface Options {
  data: AppDataV8
  setData: Dispatch<SetStateAction<AppDataV8>>
  storageStatus: StorageStatus
  storagePersistence: StoragePersistence & { receipt?: { raw: string; revision: number } | null }
}

/**
 * V8-only UI transaction latch. It never writes storage itself: the future V8
 * host owns persistence and supplies the same revision receipt used by the V7 UI.
 */
export function useTeachingUnitSubjectManagementSession({
  data,
  setData,
  storageStatus,
  storagePersistence,
}: Options) {
  const [operation, setOperation] = useState<Operation | null>(null)
  const [localError, setLocalError] = useState('')
  const currentRef = useRef({ data, storageStatus, storagePersistence })
  currentRef.current = { data, storageStatus, storagePersistence }

  useEffect(() => {
    if (!operation || operation.status === 'persisted' || operation.status === 'unconfirmed') return
    let status: OperationStatus = 'submitted'
    let message = ''
    if (storageStatus !== 'saved') {
      status = 'blocked'
      message = storageStatus === 'conflict'
        ? '資料已在其他分頁變更；本次科目操作尚未確認儲存，輸入內容已保留。'
        : '科目資料尚未成功寫入此裝置，輸入內容已保留。'
    } else if (data !== operation.before && data !== operation.expected
      && JSON.stringify(data) !== operation.expectedResult) {
      status = 'unconfirmed'
      message = '科目資料在儲存期間已變更，無法確認本次操作；輸入內容已保留。'
    } else if (!storagePersistence.pending && storagePersistence.revision > operation.startedRevision) {
      const receiptValid = !('receipt' in storagePersistence)
        || (storagePersistence.receipt?.revision === storagePersistence.revision
          && storagePersistence.receipt.raw === operation.expectedResult)
      status = JSON.stringify(data) === operation.expectedResult && receiptValid ? 'persisted' : 'unconfirmed'
      message = status === 'persisted' ? operation.success : '儲存結果與預期不同，輸入內容已保留。'
    } else if (storagePersistence.pending || data === operation.expected
      || JSON.stringify(data) === operation.expectedResult) {
      status = 'pending'
    }
    if (status === operation.status && message === operation.message) return
    if (status === 'persisted') operation.onPersisted?.()
    setOperation({ ...operation, status, message })
  }, [data, operation, storagePersistence, storageStatus])

  const locked = Boolean(operation && ['submitted', 'pending', 'blocked'].includes(operation.status))
    || storagePersistence.pending
  const error = localError || (operation?.status === 'blocked' || operation?.status === 'unconfirmed'
    ? operation.message
    : '')
  const success = operation?.status === 'persisted' ? operation.message : ''

  const fail = (message: string) => setLocalError(message)
  const submit = (
    update: (current: AppDataV8) => AppDataV8,
    successMessage: string,
    onPersisted?: () => void,
    errorMessage?: (cause: unknown) => string,
  ): boolean => {
    const latest = currentRef.current
    if (latest.storageStatus !== 'saved' || latest.storagePersistence.pending || locked) {
      fail('資料尚未完成儲存或仍待復原，暫時不能提交新的科目操作。')
      return false
    }
    try {
      const expected = update(latest.data)
      const record: Operation = {
        status: 'submitted',
        before: latest.data,
        expected,
        expectedResult: JSON.stringify(expected),
        startedRevision: latest.storagePersistence.revision,
        success: successMessage,
        message: '',
        onPersisted,
      }
      setLocalError('')
      setOperation(record)
      setData((base) => {
        const result = update(base)
        record.before = base
        record.expected = result
        record.expectedResult = JSON.stringify(result)
        return result
      })
      return true
    } catch (cause) {
      fail(errorMessage?.(cause)
        ?? (cause instanceof Error ? cause.message : '科目操作未通過驗證，輸入內容已保留。'))
      return false
    }
  }

  return {
    operation,
    locked,
    error,
    success,
    fail,
    submit,
    clearMessage: () => setLocalError(''),
  }
}

export type TeachingUnitSubjectManagementSession = ReturnType<typeof useTeachingUnitSubjectManagementSession>

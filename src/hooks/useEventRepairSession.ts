import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { AppDataV8 } from '../types'
import type { StoragePersistence, StorageStatus } from './useLocalStorage'

type EventRepairOperationStatus = 'submitted' | 'pending' | 'blocked' | 'unconfirmed' | 'persisted'

interface EventRepairOperation {
  status: EventRepairOperationStatus
  before: AppDataV8
  expected: AppDataV8
  expectedResult: string
  startedRevision: number
  success: string
  message: string
}

interface EventRepairSessionOptions {
  data: AppDataV8
  setData: Dispatch<SetStateAction<AppDataV8>>
  storageStatus: StorageStatus
  storagePersistence: StoragePersistence
}

/**
 * V8-only persistence receipt latch. The future V8 host owns storage; this hook
 * only submits an atomic candidate document and waits for a revision receipt.
 */
export function useEventRepairSession({
  data,
  setData,
  storageStatus,
  storagePersistence,
}: EventRepairSessionOptions) {
  const [operation, setOperation] = useState<EventRepairOperation | null>(null)
  const [localError, setLocalError] = useState('')
  const currentRef = useRef({ data, storageStatus, storagePersistence })
  currentRef.current = { data, storageStatus, storagePersistence }

  useEffect(() => {
    if (!operation || operation.status === 'persisted' || operation.status === 'unconfirmed') return
    let status: EventRepairOperationStatus = 'submitted'
    let message = ''
    if (storageStatus !== 'saved') {
      status = 'blocked'
      message = storageStatus === 'conflict'
        ? '資料已在其他分頁變更；本次事件歸屬尚未確認儲存，選擇已保留。'
        : '事件歸屬尚未成功寫入此裝置，選擇已保留。'
    } else if (data !== operation.before && data !== operation.expected
      && JSON.stringify(data) !== operation.expectedResult) {
      status = 'unconfirmed'
      message = '事件資料在儲存期間已變更，無法確認本次操作；選擇已保留。'
    } else if (!storagePersistence.pending && storagePersistence.revision > operation.startedRevision) {
      status = JSON.stringify(data) === operation.expectedResult ? 'persisted' : 'unconfirmed'
      message = status === 'persisted'
        ? operation.success
        : '儲存結果與預期不同，選擇已保留。'
    } else if (storagePersistence.pending || data === operation.expected
      || JSON.stringify(data) === operation.expectedResult) {
      status = 'pending'
    }
    if (status === operation.status && message === operation.message) return
    setOperation({ ...operation, status, message })
  }, [data, operation, storagePersistence, storageStatus])

  const locked = Boolean(operation && ['submitted', 'pending', 'blocked'].includes(operation.status))
    || storagePersistence.pending
  const error = localError || (operation?.status === 'blocked' || operation?.status === 'unconfirmed'
    ? operation.message
    : '')
  const success = operation?.status === 'persisted' ? operation.message : ''

  const submit = (
    update: (current: AppDataV8) => AppDataV8,
    successMessage: string,
    errorMessage: (cause: unknown) => string,
  ): boolean => {
    const latest = currentRef.current
    if (latest.storageStatus !== 'saved' || latest.storagePersistence.pending || locked) {
      setLocalError('資料尚未完成儲存或仍待復原，暫時不能確認新的事件歸屬。')
      return false
    }
    try {
      const expected = update(latest.data)
      const record: EventRepairOperation = {
        status: 'submitted',
        before: latest.data,
        expected,
        expectedResult: JSON.stringify(expected),
        startedRevision: latest.storagePersistence.revision,
        success: successMessage,
        message: '',
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
      setLocalError(errorMessage(cause))
      return false
    }
  }

  return {
    operation,
    locked,
    error,
    success,
    submit,
    clearMessage: () => setLocalError(''),
  }
}

export type EventRepairSession = ReturnType<typeof useEventRepairSession>

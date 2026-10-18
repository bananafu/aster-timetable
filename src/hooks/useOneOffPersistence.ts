import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createOneOffLesson, deleteOneOffLesson, updateOneOffLesson, type OneOffLessonDraft } from '../data/oneOffLessonsV7'
import { isCompatibleAppDataV7 } from '../data/validators/v7'
import type { AppDataV4, AppDataV7 } from '../types'
import type { StoragePersistence, StorageStatus } from './useLocalStorage'

interface Context { projectId: string; timetableId: string }
interface OneOffSaveRequest { draft: OneOffLessonDraft; id?: string; allowConflict: boolean }
interface PendingOperation {
  revision: number
  expectedLessons: string
  resolve: () => void
  reject: (error: Error) => void
}

/** Coordinates existing v7 CRUD and the storage hook's confirmed local revision. */
export function useOneOffPersistence(data: AppDataV4, setData: Dispatch<SetStateAction<AppDataV4>>, status: StorageStatus, persistence: StoragePersistence) {
  const [pending, setPending] = useState<PendingOperation | null>(null)
  const pendingRef = useRef<PendingOperation | null>(null)

  useEffect(() => {
    if (!pending) return
    let failure = ''
    if (status === 'conflict') failure = '其他分頁已更新資料；本次單日課程變更尚未儲存。請先處理跨分頁衝突。'
    else if (status === 'write-error' || status === 'read-error') failure = '單日課程尚未成功儲存至此裝置；請先處理儲存問題。'
    else if (status === 'saved' && !persistence.pending && persistence.revision > pending.revision) {
      if (data.schemaVersion === 7 && JSON.stringify(data.oneOffLessons) === pending.expectedLessons) {
        pending.resolve()
        pendingRef.current = null
        setPending(null)
        return
      }
      failure = '資料在儲存期間已變更；無法確認這次單日課程操作，請重新檢查課表。'
    }
    if (failure) {
      pending.reject(new Error(failure))
      pendingRef.current = null
      setPending(null)
    }
  }, [data, pending, persistence.pending, persistence.revision, status])

  const transact = (context: Context, operation: (current: AppDataV7) => AppDataV7): Promise<void> => {
    if (pendingRef.current) return Promise.reject(new Error('上一筆單日課程變更仍在儲存中。'))
    if (status !== 'saved' || persistence.pending) return Promise.reject(new Error('資料尚未完成儲存或發生衝突，請先處理儲存狀態。'))
    let expectedLessons = ''
    try {
      setData((current) => {
        if (!isCompatibleAppDataV7(current)) throw new Error('目前資料不是有效的 AppDataV7，無法寫入單日課程。')
        if (!current.timetables.some((item) => item.id === context.timetableId && item.projectId === context.projectId)) {
          throw new Error('教師課表已變更，請重新選擇。')
        }
        if (current.projects.find((item) => item.id === context.projectId)?.archivedAt) throw new Error('封存專案為唯讀。')
        const next = operation(current)
        expectedLessons = JSON.stringify(next.oneOffLessons)
        return next
      })
    } catch (cause) { return Promise.reject(cause instanceof Error ? cause : new Error('單日課程操作失敗。')) }
    if (!expectedLessons) return Promise.reject(new Error('單日課程未通過安全更新驗證。'))
    return new Promise<void>((resolve, reject) => {
      const record = { revision: persistence.revision, expectedLessons, resolve, reject }
      pendingRef.current = record
      setPending(record)
    })
  }

  const save = (context: Context, request: OneOffSaveRequest) => transact(context, (current) => {
    if (request.draft.projectId !== context.projectId || request.draft.timetableId !== context.timetableId) {
      throw new Error('單日課程不屬於目前專案與教師課表。')
    }
    return request.id
      ? updateOneOffLesson(current, request.id, request.draft, request.allowConflict)
      : createOneOffLesson(current, request.draft, () => crypto.randomUUID(), request.allowConflict)
  })

  const remove = (context: Context, id: string) => transact(context, (current) => {
    const target = current.oneOffLessons.find((item) => item.id === id)
    if (!target || target.projectId !== context.projectId || target.timetableId !== context.timetableId) {
      throw new Error('單日課程不屬於目前教師課表，或已被刪除。')
    }
    return deleteOneOffLesson(current, id)
  })

  return { save, remove, pending: Boolean(pending) }
}

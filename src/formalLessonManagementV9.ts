import type { AppDataV9 } from './types/v9'
import type { FormalV9HostPort } from './formalRuntime'
import { isCompatibleAppDataV9 } from './data/validators/v9'
import { fingerprintV7Raw } from './data/activationV8'
import { V9_AUTO_BACKUP_PREFIX, type V9HighRiskOperation } from './data/storageV9'
import { cancelOccurrenceV9, createRecurringLessonV9, deleteRecurringLessonV9,
  getRecurringLessonV9Impact, moveOccurrenceV9,
  permanentlyUpdateLessonV9, replaceOccurrenceV9, revokeOccurrenceOverrideV9, updateRecurringLessonV9,
  type LessonV9Scope, type RecurringLessonV9Draft } from './data/lessonMutationsV9'

export type FormalLessonV9ErrorCode = 'invalid-document' | 'invalid-scope' | 'not-writable'
  | 'duplicate-submit' | 'stale-document' | 'invalid-result' | 'receipt-mismatch' | 'backup-required'
export class FormalLessonV9Error extends Error {
  constructor(readonly code: FormalLessonV9ErrorCode, message: string) {
    super(message); this.name = 'FormalLessonV9Error'
  }
}
const fail = (code: FormalLessonV9ErrorCode, message: string): never => { throw new FormalLessonV9Error(code, message) }
export type FormalLessonV9Result = {
  document: AppDataV9
  receipt: NonNullable<FormalV9HostPort['receipt']>
  selection: LessonV9Scope
  affectedId: string
}
export interface FormalLessonV9Actions {
  createRecurring: (draft: RecurringLessonV9Draft) => Promise<FormalLessonV9Result>
  updateRecurring: (lessonId: string, draft: RecurringLessonV9Draft) => Promise<FormalLessonV9Result>
  impactRecurring: (lessonId: string) => ReturnType<typeof getRecurringLessonV9Impact>
  deleteRecurring: (lessonId: string, confirmed: true) => Promise<FormalLessonV9Result>
  cancelOccurrence: (lessonId: string, date: string) => Promise<FormalLessonV9Result>
  moveOccurrence: (lessonId: string, date: string,
    target: { date: string; periodId: number }) => Promise<FormalLessonV9Result>
  replaceOccurrence: (lessonId: string, date: string,
    replacement: { subjectId: string; classId: string; room?: string }) => Promise<FormalLessonV9Result>
  revokeOccurrenceOverride: (overrideId: string) => Promise<FormalLessonV9Result>
  permanentlyUpdateFromDate: (lessonId: string, date: string,
    draft: RecurringLessonV9Draft) => Promise<FormalLessonV9Result>
}

/** Unmounted action port. The selection reader invalidates callbacks captured before a context switch. */
export function createFormalLessonManagementV9Controller(host: FormalV9HostPort,
  createId: () => string, selection: LessonV9Scope,
  readCurrentSelection: () => LessonV9Scope = () => selection): FormalLessonV9Actions {
  if (!host.document || !isCompatibleAppDataV9(host.document)) fail('invalid-document', 'V9 document is invalid.')
  const initial = host.document!
  const captured = { ...selection }
  const initialRaw = JSON.stringify(initial)
  const initialRevision = host.revision
  let submitting = false
  const requireSelection = () => {
    const current = readCurrentSelection()
    if (current.projectId !== captured.projectId || current.timetableId !== captured.timetableId
      || current.teachingUnitId !== captured.teachingUnitId) fail('invalid-scope', 'Lesson selection changed.')
  }
  const commit = async (produce: (current: AppDataV9) => AppDataV9, affected: () => string,
    highRiskOperation?: V9HighRiskOperation) => {
    requireSelection()
    if (submitting || host.pending) fail('duplicate-submit', 'A V9 write is already in progress.')
    if (host.status !== 'active' || !host.writable) fail('not-writable', 'V9 Host is read-only.')
    if (host.revision !== initialRevision || !host.document || JSON.stringify(host.document) !== initialRaw) {
      fail('stale-document', 'V9 document or revision changed before submission.')
    }
    if (highRiskOperation && !host.updateHighRisk) fail('backup-required', 'V9 Host has no verified pre-mutation backup capability.')
    let next: AppDataV9 | null = null
    submitting = true
    try {
      const produceChecked = (current: AppDataV9) => {
        requireSelection()
        if (JSON.stringify(current) !== initialRaw) fail('stale-document', 'V9 document changed during submission.')
        const produced = produce(current)
        if (!isCompatibleAppDataV9(produced)) fail('invalid-result', 'Lesson operation produced invalid V9 data.')
        next = produced
        return produced
      }
      const receipt = highRiskOperation
        ? await host.updateHighRisk!(produceChecked, highRiskOperation)
        : await host.update(produceChecked)
      const confirmed = next as AppDataV9 | null
      if (!confirmed || receipt.raw !== JSON.stringify(confirmed)
        || receipt.revision !== initialRevision + 1 || !receipt.attemptId) {
        fail('receipt-mismatch', 'V9 Host receipt does not confirm the Lesson write.')
      }
      if (highRiskOperation) {
        const backup = receipt.preMutationBackup
        if (!backup || backup.operation !== highRiskOperation || backup.revision !== initialRevision
          || backup.rawDocument !== initialRaw || !receipt.mutationAttemptId
          || backup.mutationAttemptId !== receipt.mutationAttemptId
          || backup.key !== `${V9_AUTO_BACKUP_PREFIX}${receipt.mutationAttemptId}`
          || backup.digest !== await fingerprintV7Raw(initialRaw)) {
          fail('receipt-mismatch', 'V9 Host did not confirm this operation pre-mutation backup.')
        }
      }
      requireSelection()
      return { document: confirmed as AppDataV9, receipt, selection: { ...captured }, affectedId: affected() }
    } finally { submitting = false }
  }
  return {
    createRecurring: (draft) => {
      let id = ''
      return commit((current) => { id = createId(); return createRecurringLessonV9(current, captured, draft, id) }, () => id)
    },
    updateRecurring: (id, draft) => commit((current) => updateRecurringLessonV9(current, captured, id, draft), () => id),
    impactRecurring: (id) => { requireSelection(); return getRecurringLessonV9Impact(initial, captured, id) },
    deleteRecurring: (id, confirmed) => {
      requireSelection()
      if (confirmed !== true) fail('invalid-scope', 'Deletion requires explicit confirmation.')
      return commit((current) => deleteRecurringLessonV9(current, captured, id, true),
        () => id, 'delete-recurring-lesson')
    },
    cancelOccurrence: (id, date) => {
      let overrideId = ''
      return commit((current) => { overrideId = createId(); return cancelOccurrenceV9(current, captured, id, date, overrideId) }, () => overrideId)
    },
    moveOccurrence: (id, date, target) => {
      let overrideId = ''
      return commit((current) => { overrideId = createId(); return moveOccurrenceV9(current, captured, id, date, target, overrideId) }, () => overrideId)
    },
    replaceOccurrence: (id, date, replacement) => {
      let overrideId = ''
      return commit((current) => { overrideId = createId(); return replaceOccurrenceV9(current, captured, id, date, replacement, overrideId) }, () => overrideId)
    },
    revokeOccurrenceOverride: (id) => commit((current) => revokeOccurrenceOverrideV9(current, captured, id), () => id),
    permanentlyUpdateFromDate: (id, date, draft) => {
      let newId = ''
      return commit((current) => {
        newId = createId()
        return permanentlyUpdateLessonV9(current, captured, id, date, draft, newId)
      }, () => newId, 'permanently-update-lesson')
    },
  }
}

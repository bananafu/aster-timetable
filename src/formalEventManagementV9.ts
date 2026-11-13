import { createEventV9, updateEventV9, type EventV9Draft,
  type EventV9Scope } from './data/eventMutationsV9'
import { isCompatibleAppDataV9 } from './data/validators/v9'
import type { FormalV9HostPort } from './formalRuntime'
import type { AppDataV9 } from './types/v9'

export type FormalEventV9ErrorCode = 'invalid-document' | 'invalid-scope' | 'not-writable'
  | 'duplicate-submit' | 'stale-document' | 'invalid-result' | 'receipt-mismatch'
export class FormalEventV9Error extends Error {
  constructor(readonly code: FormalEventV9ErrorCode, message: string) {
    super(message); this.name = 'FormalEventV9Error'
  }
}
const fail = (code: FormalEventV9ErrorCode, message: string): never => {
  throw new FormalEventV9Error(code, message)
}
export type FormalEventV9Result = {
  document: AppDataV9
  receipt: NonNullable<FormalV9HostPort['receipt']>
  selection: EventV9Scope
  affectedId: string
}

/** Uses the existing formal Host transaction; captured callbacks fail after selection or revision changes. */
export function createFormalEventManagementV9Controller(host: FormalV9HostPort,
  createId: () => string, selection: EventV9Scope,
  readCurrentSelection: () => EventV9Scope = () => selection) {
  if (!host.document || !isCompatibleAppDataV9(host.document)) {
    fail('invalid-document', 'V9 document is invalid.')
  }
  const initial = host.document!
  const captured = { ...selection }
  const initialRaw = JSON.stringify(initial)
  const initialRevision = host.revision
  let submitting = false

  const requireSelection = () => {
    const current = readCurrentSelection()
    if (current.projectId !== captured.projectId || current.timetableId !== captured.timetableId) {
      fail('invalid-scope', 'Event selection changed.')
    }
  }
  const commit = async (produce: (current: AppDataV9) => AppDataV9,
    affected: () => string): Promise<FormalEventV9Result> => {
    requireSelection()
    if (submitting || host.pending) fail('duplicate-submit', 'A V9 write is already in progress.')
    if (host.status !== 'active' || !host.writable) fail('not-writable', 'V9 Host is read-only.')
    if (host.revision !== initialRevision || !host.document || JSON.stringify(host.document) !== initialRaw) {
      fail('stale-document', 'V9 document or revision changed before submission.')
    }
    let next: AppDataV9 | null = null
    submitting = true
    try {
      const receipt = await host.update((current) => {
        requireSelection()
        if (JSON.stringify(current) !== initialRaw) fail('stale-document', 'V9 document changed during submission.')
        const produced = produce(current)
        if (!isCompatibleAppDataV9(produced)) fail('invalid-result', 'Event operation produced invalid V9 data.')
        next = produced
        return produced
      })
      requireSelection()
      const confirmed = next as AppDataV9 | null
      if (!confirmed || receipt.raw !== JSON.stringify(confirmed)
        || receipt.revision !== initialRevision + 1 || !receipt.attemptId) {
        return fail('receipt-mismatch', 'V9 Host receipt does not confirm the Event write.')
      }
      return { document: confirmed, receipt, selection: { ...captured }, affectedId: affected() }
    } finally { submitting = false }
  }

  return {
    selection: captured,
    createMeeting: (draft: Omit<EventV9Draft, 'type'>) => {
      let id = ''
      return commit((current) => {
        id = createId()
        return createEventV9(current, captured, { ...draft, type: 'meeting' }, id)
      }, () => id)
    },
    createActivity: (draft: Omit<EventV9Draft, 'type'>) => {
      let id = ''
      return commit((current) => {
        id = createId()
        return createEventV9(current, captured, { ...draft, type: 'activity' }, id)
      }, () => id)
    },
    updateMeeting: (eventId: string, draft: Omit<EventV9Draft, 'type'>) => commit((current) =>
      updateEventV9(current, captured, eventId, { ...draft, type: 'meeting' }), () => eventId),
    updateActivity: (eventId: string, draft: Omit<EventV9Draft, 'type'>) => commit((current) =>
      updateEventV9(current, captured, eventId, { ...draft, type: 'activity' }), () => eventId),
  }
}

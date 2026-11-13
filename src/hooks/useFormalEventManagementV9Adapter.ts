import { useCallback, useRef, useState } from 'react'
import type { EventV9Draft, EventV9Scope } from '../data/eventMutationsV9'
import { createFormalEventManagementV9Controller, FormalEventV9Error,
  type FormalEventV9Result } from '../formalEventManagementV9'
import type { FormalV9HostPort } from '../formalRuntime'

const uid = () => crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (value) => {
  const random = Math.floor(Math.random() * 16)
  return (value === 'x' ? random : (random & 0x3) | 0x8).toString(16)
})
type Draft = Omit<EventV9Draft, 'type'>
type Controller = ReturnType<typeof createFormalEventManagementV9Controller>

/** Data-only adapter; no Event UI is mounted in R5-B1. */
export function useFormalEventManagementV9Adapter(host: FormalV9HostPort,
  selection: EventV9Scope, createId: () => string = uid) {
  const hostRef = useRef(host)
  hostRef.current = host
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const submittingRef = useRef(false)
  const [pending, setPending] = useState(false)

  const submit = useCallback(async (captured: EventV9Scope,
    operation: (controller: Controller) => Promise<FormalEventV9Result>) => {
    if (submittingRef.current || hostRef.current.pending) {
      throw new FormalEventV9Error('duplicate-submit', 'A V9 write is already in progress.')
    }
    const controller = createFormalEventManagementV9Controller(hostRef.current, createId,
      captured, () => selectionRef.current)
    submittingRef.current = true
    setPending(true)
    try { return await operation(controller) }
    finally { submittingRef.current = false; setPending(false) }
  }, [createId])

  const captured = { projectId: selection.projectId, timetableId: selection.timetableId }
  return {
    pending: pending || host.pending,
    writable: host.status === 'active' && host.writable && !pending && !host.pending
      && !!selection.projectId && !!selection.timetableId,
    createMeeting: (draft: Draft) => submit(captured, (controller) => controller.createMeeting(draft)),
    createActivity: (draft: Draft) => submit(captured, (controller) => controller.createActivity(draft)),
    updateMeeting: (eventId: string, draft: Draft) => submit(captured,
      (controller) => controller.updateMeeting(eventId, draft)),
    updateActivity: (eventId: string, draft: Draft) => submit(captured,
      (controller) => controller.updateActivity(eventId, draft)),
  }
}

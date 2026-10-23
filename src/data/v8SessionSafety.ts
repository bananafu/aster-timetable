export const V8_SESSION_CHANNEL = 'toki-v8-session-v1'
export const V8_SESSION_PROTOCOL = 1
export type V8SessionMessage = { protocol: 1; type: 'hello' | 'ack' | 'close-request' | 'reload-request' | 'closing';
  sessionId: string; targetId: string | null; sentAt: string }
export type V8SessionIssue = 'web-locks-unavailable' | 'web-locks-request-failed' | 'coordination-unavailable'
  | 'modern-tab-present' | 'modern-tab-unresponsive' | 'identity-collision' | 'legacy-tabs-unverifiable'
export interface V8SessionSafetyResult {
  readiness: 'blocked' | 'verified'
  webLocks: 'available' | 'unavailable' | 'request-failed'
  coordination: 'available' | 'unavailable'
  modernSessions: { id: string; responsive: boolean; stale: boolean }[]
  issues: V8SessionIssue[]
}

/** Capability probing never treats an available API as a held cutover lock. */
export async function inspectV8BrowserCapability(
  environment: { locks?: Pick<LockManager, 'request'>; BroadcastChannel?: typeof BroadcastChannel },
): Promise<Pick<V8SessionSafetyResult, 'webLocks' | 'coordination'>> {
  const coordination = environment.BroadcastChannel ? 'available' : 'unavailable'
  if (!environment.locks?.request) return { webLocks: 'unavailable', coordination }
  try {
    const held = await environment.locks.request('toki-v8-capability-probe', { ifAvailable: true }, (lock) => !!lock)
    return { webLocks: held ? 'available' : 'request-failed', coordination }
  } catch { return { webLocks: 'request-failed', coordination } }
}

/** No browser protocol can prove that non-cooperating, already-loaded V7 tabs are absent. */
export function assessV8SessionSafety(
  capability: Pick<V8SessionSafetyResult, 'webLocks' | 'coordination'>,
  modernSessions: V8SessionSafetyResult['modernSessions'], collision = false,
): V8SessionSafetyResult {
  const issues: V8SessionIssue[] = ['legacy-tabs-unverifiable']
  if (capability.webLocks === 'unavailable') issues.push('web-locks-unavailable')
  if (capability.webLocks === 'request-failed') issues.push('web-locks-request-failed')
  if (capability.coordination === 'unavailable') issues.push('coordination-unavailable')
  if (modernSessions.some((session) => !session.stale)) issues.push('modern-tab-present')
  if (modernSessions.some((session) => !session.responsive || session.stale)) issues.push('modern-tab-unresponsive')
  if (collision) issues.push('identity-collision')
  return { readiness: 'blocked', ...capability, modernSessions, issues }
}

export interface V8SessionCoordinator {
  readonly sessionId: string
  snapshot: (now?: number) => V8SessionSafetyResult
  requestOtherTabsToClose: () => void
  requestOtherTabsToReload: () => void
  close: () => void
}

/** Ephemeral BroadcastChannel presence only; never an exclusion lock or legacy-tab proof. */
export function createV8SessionCoordinator(
  channel: { postMessage: (message: V8SessionMessage) => void; close: () => void;
    addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
    removeEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void },
  capability: Pick<V8SessionSafetyResult, 'webLocks' | 'coordination'>,
  sessionId: string = crypto.randomUUID(),
  now: () => number = Date.now,
): V8SessionCoordinator {
  const peers = new Map<string, { seen: number; responsive: boolean }>()
  let collision = false
  let closed = false
  const send = (type: V8SessionMessage['type'], targetId: string | null = null) => {
    if (!closed) channel.postMessage({ protocol: V8_SESSION_PROTOCOL, type, sessionId, targetId,
      sentAt: new Date(now()).toISOString() } satisfies V8SessionMessage)
  }
  const receive = (event: MessageEvent) => {
    const message = event.data as Partial<V8SessionMessage>
    if (closed || message.protocol !== V8_SESSION_PROTOCOL || typeof message.sessionId !== 'string'
      || !['hello', 'ack', 'close-request', 'reload-request', 'closing'].includes(message.type ?? '')) return
    if (message.sessionId === sessionId) { collision = true; return }
    if (message.type === 'closing') { peers.delete(message.sessionId); return }
    peers.set(message.sessionId, { seen: now(), responsive: message.type === 'ack' })
    if (message.type === 'hello' || message.type === 'close-request' || message.type === 'reload-request') send('ack', message.sessionId)
  }
  channel.addEventListener('message', receive)
  send('hello')
  return {
    sessionId,
    snapshot: (at = now()) => assessV8SessionSafety(capability, [...peers].map(([id, peer]) => ({
      id, responsive: peer.responsive, stale: at - peer.seen > 30_000,
    })), collision),
    requestOtherTabsToClose: () => send('close-request'),
    requestOtherTabsToReload: () => send('reload-request'),
    close: () => { if (!closed) { send('closing'); closed = true; channel.removeEventListener('message', receive); channel.close() } },
  }
}

export function openV8SessionCoordinator(
  capability: Pick<V8SessionSafetyResult, 'webLocks' | 'coordination'>,
): V8SessionCoordinator | null {
  if (typeof BroadcastChannel === 'undefined' || capability.coordination !== 'available') return null
  try { return createV8SessionCoordinator(new BroadcastChannel(V8_SESSION_CHANNEL), capability) }
  catch { return null }
}

/** Production cutover gate: blocked until a future mechanism can verify legacy writers are quiescent. */
export async function inspectCutoverSessionReadiness(): Promise<V8SessionSafetyResult> {
  const capability = await inspectV8BrowserCapability({
    locks: typeof navigator === 'undefined' ? undefined : navigator.locks,
    BroadcastChannel: typeof BroadcastChannel === 'undefined' ? undefined : BroadcastChannel,
  })
  return assessV8SessionSafety(capability, [])
}

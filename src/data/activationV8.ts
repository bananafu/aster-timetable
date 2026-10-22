import { APP_DATA_V7_KEY } from './storageV7'

export const APP_DATA_V8_ACTIVATION_KEY = 'aster-timetable-data-v8-activation'
export const V8_ACTIVATION_METADATA_VERSION = 1

export type V8ActivationStatus = 'active' | 'rolled-back'

/**
 * Immutable cutover evidence for a future R2-B activation.
 *
 * R2-A only defines and reads this contract. It never creates or updates the
 * record, so a later V7 write cannot silently become a new cutover baseline.
 */
export interface V8ActivationMetadata {
  metadataVersion: typeof V8_ACTIVATION_METADATA_VERSION
  sourceV7Fingerprint: `sha256:${string}`
  sourceV7Key: typeof APP_DATA_V7_KEY
  v8ActivationRevision: number
  activatedAt: string
  status: V8ActivationStatus
}

export interface V8ActivationMetadataLoadResult {
  value: V8ActivationMetadata | null
  raw: string | null
  issue: 'none' | 'corrupt' | 'read-failure'
}

type ReadStorage = Pick<Storage, 'getItem'>

const canonicalUtcTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

export function isV8ActivationMetadata(value: unknown): value is V8ActivationMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return Object.keys(candidate).length === 6
    && candidate.metadataVersion === V8_ACTIVATION_METADATA_VERSION
    && typeof candidate.sourceV7Fingerprint === 'string'
    && /^sha256:[0-9a-f]{64}$/.test(candidate.sourceV7Fingerprint)
    && candidate.sourceV7Key === APP_DATA_V7_KEY
    && Number.isSafeInteger(candidate.v8ActivationRevision)
    && (candidate.v8ActivationRevision as number) >= 1
    && canonicalUtcTimestamp(candidate.activatedAt)
    && (candidate.status === 'active' || candidate.status === 'rolled-back')
}

export function loadV8ActivationMetadata(storage: ReadStorage): V8ActivationMetadataLoadResult {
  let raw: string | null = null
  try {
    raw = storage.getItem(APP_DATA_V8_ACTIVATION_KEY)
    if (raw === null) return { value: null, raw: null, issue: 'none' }
    const parsed: unknown = JSON.parse(raw)
    if (!isV8ActivationMetadata(parsed)) return { value: null, raw, issue: 'corrupt' }
    return { value: parsed, raw, issue: 'none' }
  } catch {
    return { value: null, raw, issue: raw === null ? 'read-failure' : 'corrupt' }
  }
}

export async function fingerprintV7Raw(raw: string): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex}`
}

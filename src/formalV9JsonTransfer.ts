import { fingerprintV7Raw } from './data/activationV8'
import { parseAppDataV9Raw, type V9ConfirmedExportSnapshot,
  type V9PersistenceReceipt } from './data/storageV9'
import { isCompatibleAppDataV9 } from './data/validators/v9'
import type { V9HostStatus } from './hooks/useAppDataV9'
import type { AppDataV9 } from './types/v9'

export type V9JsonDataSummary = {
  projects: number
  timetables: number
  recurringLessons: number
  oneOffLessons: number
  events: number
}

export type V9JsonImportCandidate = {
  fileName: string
  raw: string
  digest: `sha256:${string}`
  identity: string
  schemaVersion: 9
  document: AppDataV9
  summary: V9JsonDataSummary
}

export type PreparedV9JsonImport = {
  candidate: V9JsonImportCandidate
  current: V9JsonDataSummary
  baseline: V9ConfirmedExportSnapshot
}

export type V9JsonTransferErrorCode = 'not-ready' | 'invalid-json' | 'unsupported-version'
  | 'invalid-document' | 'stale-preview' | 'confirmation-required' | 'duplicate-submit'
  | 'receipt-mismatch'

export class V9JsonTransferError extends Error {
  constructor(readonly code: V9JsonTransferErrorCode, message: string) {
    super(message)
    this.name = 'V9JsonTransferError'
  }
}

export type V9JsonTransferHostPort = {
  readonly document: AppDataV9 | null
  readonly status: V9HostStatus
  readonly writable: boolean
  readonly pending: boolean
  readonly revision: number
  createConfirmedExportSnapshot: () => Promise<V9ConfirmedExportSnapshot>
  replaceDocumentFromValidatedImport: (input: {
    raw: string
    digest: `sha256:${string}`
  }) => Promise<V9PersistenceReceipt>
}

const fail = (code: V9JsonTransferErrorCode, message: string): never => {
  throw new V9JsonTransferError(code, message)
}

export function summarizeAppDataV9(document: AppDataV9): V9JsonDataSummary {
  return Object.freeze({ projects: document.projects.length, timetables: document.timetables.length,
    recurringLessons: document.recurringLessons.length, oneOffLessons: document.oneOffLessons.length,
    events: document.events.length })
}

/** Pure validation plus SHA-256 identity; never repairs, migrates, merges, or assigns IDs. */
export async function parseV9JsonImportCandidate(fileName: string,
  raw: string): Promise<V9JsonImportCandidate> {
  let untrusted: unknown
  try { untrusted = JSON.parse(raw) }
  catch { return fail('invalid-json', '選取的檔案不是有效的 JSON。') }
  if (!untrusted || typeof untrusted !== 'object' || Array.isArray(untrusted)
    || !('schemaVersion' in untrusted)) {
    return fail('invalid-document', 'JSON 不包含可辨識的 Toki V9 資料。')
  }
  if ((untrusted as { schemaVersion?: unknown }).schemaVersion !== 9) {
    return fail('unsupported-version', '僅接受完整的 Toki V9 JSON；舊版資料不會自動遷移。')
  }
  let document: AppDataV9
  try { document = parseAppDataV9Raw(raw) }
  catch { return fail('invalid-document', 'V9 JSON 的結構、引用或資料歸屬不完整。') }
  if (!isCompatibleAppDataV9(document)) {
    return fail('invalid-document', 'V9 JSON 的結構、引用或資料歸屬不完整。')
  }
  const digest = await fingerprintV7Raw(raw)
  return Object.freeze({ fileName, raw, digest, identity: `${digest}:${raw.length}`,
    schemaVersion: 9 as const, document, summary: summarizeAppDataV9(document) })
}

const ready = (host: V9JsonTransferHostPort) => host.status === 'active'
  && host.writable && !host.pending && host.document !== null

export function createFormalV9JsonTransferController(host: V9JsonTransferHostPort) {
  let submitting = false
  const verifiedSnapshot = async () => {
    if (!ready(host)) fail('not-ready', 'V9 Host 尚未完成可寫入證據確認。')
    return host.createConfirmedExportSnapshot()
  }
  return Object.freeze({
    exportVerified: verifiedSnapshot,
    prepareImport: async (fileName: string, raw: string): Promise<PreparedV9JsonImport> => {
      const candidate = await parseV9JsonImportCandidate(fileName, raw)
      const baseline = await verifiedSnapshot()
      return Object.freeze({ candidate, baseline,
        current: summarizeAppDataV9(parseAppDataV9Raw(baseline.raw)) })
    },
    confirmImport: async (prepared: PreparedV9JsonImport, candidateIdentity: string,
      acknowledged: boolean) => {
      if (submitting) fail('duplicate-submit', '匯入正在確認中。')
      if (!acknowledged) fail('confirmation-required', '必須先確認了解目前資料將被替換。')
      if (candidateIdentity !== prepared.candidate.identity) {
        fail('stale-preview', '匯入檔案已變更，請重新檢查預覽。')
      }
      submitting = true
      try {
        const current = await verifiedSnapshot()
        if (current.revision !== prepared.baseline.revision
          || current.digest !== prepared.baseline.digest || current.raw !== prepared.baseline.raw) {
          fail('stale-preview', '目前資料已變更，請重新檢查匯入預覽。')
        }
        const receipt = await host.replaceDocumentFromValidatedImport({
          raw: prepared.candidate.raw, digest: prepared.candidate.digest,
        })
        if (receipt.raw !== prepared.candidate.raw || receipt.revision !== current.revision + 1
          || receipt.preMutationBackup?.operation !== 'import-json'
          || receipt.preMutationBackup.rawDocument !== current.raw
          || receipt.preMutationBackup.digest !== current.digest
          || receipt.preMutationBackup.revision !== current.revision
          || receipt.mutationAttemptId !== receipt.preMutationBackup.mutationAttemptId) {
          fail('receipt-mismatch', '匯入完成證據不一致。')
        }
        return Object.freeze({ receipt, activeProjectId: prepared.candidate.document.activeProjectId })
      } finally {
        submitting = false
      }
    },
  })
}

const pad = (value: number) => String(value).padStart(2, '0')

export function createV9BackupFileName(now = new Date()): string {
  return `toki-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`
}

export function createVerifiedV9JsonDownload(snapshot: V9ConfirmedExportSnapshot,
  now = new Date()) {
  return { fileName: createV9BackupFileName(now),
    blob: new Blob([snapshot.raw], { type: 'application/json' }) }
}

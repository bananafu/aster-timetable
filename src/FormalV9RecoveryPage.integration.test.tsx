// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormalAppEntry } from './DevAppEntry'
import { fingerprintV7Raw, V8_BOOTSTRAP_KEY } from './data/activationV8'
import { activateTimetableSubjectsV9 } from './data/activateSubjectV9'
import { bootstrapEmptyV8 } from './data/bootstrapV8'
import { initializeFreshV9 } from './data/initializeFreshV9'
import { createBlankProject } from './data/projectRuntimeV8'
import { buildSubjectMigrationCandidateV9, type SubjectMigrationDecisionV9 } from './data/subjectMigrationCandidateV9'
import { APP_DATA_V8_KEY, createEmptyAppDataV8, persistAppDataV8 } from './data/storageV8'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_BACKUP_PREFIX } from './data/storageV9'
import { createSubject } from './data/subjectsV8'
import { createTeacherTimetableV8 } from './data/timetablesV8'
import * as formalRuntime from './formalRuntime'

const v9Mount = vi.hoisted(() => vi.fn())
vi.mock('./App', () => ({ default: () => <div>V7 Host</div> }))
vi.mock('./FormalV9Composition', () => ({ FormalV9Composition: () => {
  v9Mount(); return <div>V9 Host</div>
} }))

const time = '2026-11-02T01:00:00.000Z'
const lock = () => vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown,
  operation: (lock: unknown) => Promise<unknown>) => operation({}) } })

async function validV8(withSubject = false) {
  const bootstrap = await bootstrapEmptyV8(localStorage, { attemptId: 'v8-source', createdAt: time })
  if (!bootstrap.ok) throw new Error(bootstrap.code)
  let data = createEmptyAppDataV8()
  if (withSubject) {
    let serial = 0
    data = createBlankProject(data, { name: 'Project A', academicYear: 115, semester: 'first',
      startDate: '2026-08-01', endDate: '2027-01-31' }, () => `fixture-${++serial}`)
    data = createTeacherTimetableV8(data, data.activeProjectId!,
      { name: '甲課表', teacherName: '甲' }, 'teacher-a')
    data = createSubject(data, data.activeProjectId!, { name: '數學', shortName: '數', color: '#647C88',
      applicableSchoolLevels: ['senior-high'] }, 'subject-a')
    const saved = persistAppDataV8(localStorage, createEmptyAppDataV8(), data,
      { raw: bootstrap.receipt.raw, legacyGuardRaw: null, revision: 0 }, 0)
    const metadata = JSON.parse(localStorage.getItem(V8_BOOTSTRAP_KEY)!)
    localStorage.setItem(V8_BOOTSTRAP_KEY, JSON.stringify({ ...metadata,
      currentDigest: await fingerprintV7Raw(saved.raw), documentRevision: saved.revision }))
  }
  return { data, raw: localStorage.getItem(APP_DATA_V8_KEY)! }
}

async function interrupted(target: 'document' | 'metadata') {
  const { data, raw } = await validV8()
  const original = Storage.prototype.setItem
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if ((target === 'document' && key === APP_DATA_V9_KEY)
      || (target === 'metadata' && key === V9_ACTIVATION_KEY)) throw new Error('interrupted')
    return original.call(this, key, value)
  })
  const result = await activateTimetableSubjectsV9(localStorage, {
    attemptId: target === 'document' ? 'resume-attempt' : 'orphan-attempt', createdAt: time,
    expectedV8Raw: raw, candidate: { ...data, schemaVersion: 9, subjects: [] }, decisions: [],
    confirmedExternalV8Digest: await fingerprintV7Raw(raw), userConfirmedExternalBackup: true,
  })
  spy.mockRestore()
  expect(result.ok).toBe(false)
}

beforeEach(() => {
  localStorage.clear()
  v9Mount.mockClear()
  lock()
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('formal full-page V9 recovery', () => {
  it('routes verified V8 to recovery and requires snapshot export plus external confirmation', async () => {
    const { raw } = await validV8(true)
    const writes = vi.spyOn(Storage.prototype, 'setItem')
    render(<FormalAppEntry />)
    expect(await screen.findByRole('main')).toBeTruthy()
    expect(screen.getByRole('region', { name: '科目歸屬決策' })).toBeTruthy()
    expect(screen.queryByText('V9 Host')).toBeNull()
    const activate = screen.getByRole('button', { name: '確認轉換並啟用獨立科目庫' }) as HTMLButtonElement
    expect(activate.disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox', { name: '數學 歸屬教師' }), { target: { value: 'teacher-a' } })
    expect(activate.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '匯出 v8-source 原始 JSON' }))
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
    expect(await blob.text()).toBe(raw)
    expect(writes.mock.calls.some(([key]) => key === APP_DATA_V9_KEY)).toBe(false)
    expect(activate.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /我已自行確認此快照/ }))
    expect(activate.disabled).toBe(false)
    fireEvent.click(activate)
    expect(await screen.findByText('V9 Host')).toBeTruthy()
    expect(screen.queryByRole('main')).toBeNull()
    expect(localStorage.getItem(APP_DATA_V8_KEY)).toBe(raw)
    expect(v9Mount).toHaveBeenCalled()
  })

  it('invalidates decisions and confirmation on a cross-tab storage event', async () => {
    await validV8(true)
    render(<FormalAppEntry />)
    await screen.findByRole('main')
    fireEvent.change(screen.getByRole('combobox', { name: '數學 歸屬教師' }), { target: { value: 'teacher-a' } })
    fireEvent.click(screen.getByRole('button', { name: '匯出 v8-source 原始 JSON' }))
    await screen.findByText(/已準備此快照的原始 V8 JSON/)
    fireEvent.click(screen.getByRole('checkbox', { name: /我已自行確認此快照/ }))
    expect((screen.getByRole('button', { name: '確認轉換並啟用獨立科目庫' }) as HTMLButtonElement).disabled).toBe(false)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V8_KEY })))
    await screen.findByRole('main')
    expect((screen.getByRole('combobox', { name: '數學 歸屬教師' }) as HTMLSelectElement).value).toBe('')
    expect((screen.getByRole('checkbox', { name: /我已自行確認此快照/ }) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: '確認轉換並啟用獨立科目庫' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('rejects a source changed after export without writing V9', async () => {
    const { raw } = await validV8()
    render(<FormalAppEntry />)
    await screen.findByRole('main')
    fireEvent.click(screen.getByRole('button', { name: '匯出 v8-source 原始 JSON' }))
    await screen.findByText(/已準備此快照的原始 V8 JSON/)
    fireEvent.click(screen.getByRole('checkbox', { name: /我已自行確認此快照/ }))
    localStorage.setItem(APP_DATA_V8_KEY, `${raw} `)
    fireEvent.click(screen.getByRole('button', { name: '確認轉換並啟用獨立科目庫' }))
    expect((await screen.findByRole('alert')).textContent).toContain('資料快照已變更')
    expect(localStorage.getItem(APP_DATA_V9_KEY)).toBeNull()
    expect(screen.queryByText('V9 Host')).toBeNull()
  })

  it.each(['document', 'metadata'] as const)('explicitly resumes verified %s interruption', async (target) => {
    await interrupted(target)
    render(<FormalAppEntry />)
    const main = await screen.findByRole('main')
    expect(main.textContent).toContain(target === 'document' ? '已驗證中斷' : '已驗證唯一')
    const resume = screen.getByRole('button', { name: '確認續接復原' }) as HTMLButtonElement
    expect(resume.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: /我確認續接/ }))
    fireEvent.click(resume)
    expect(await screen.findByText('V9 Host')).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V9_KEY)).not.toBeNull()
  })

  it('shows the existing reviewed ownership decisions on a verified resume', async () => {
    const { data, raw } = await validV8(true)
    const decisions: SubjectMigrationDecisionV9[] = [{ sourceSubjectId: 'subject-a',
      owners: [{ timetableId: 'teacher-a', subjectId: 'subject-a' }], relations: [] }]
    const candidate = buildSubjectMigrationCandidateV9(data, decisions)
    if (!candidate.ok) throw new Error('fixture candidate failed')
    const original = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V9_KEY) throw new Error('interrupted')
      return original.call(this, key, value)
    })
    expect((await activateTimetableSubjectsV9(localStorage, { attemptId: 'reviewed', createdAt: time,
      expectedV8Raw: raw, candidate: candidate.candidate, decisions,
      confirmedExternalV8Digest: await fingerprintV7Raw(raw), userConfirmedExternalBackup: true })).ok).toBe(false)
    spy.mockRestore()
    render(<FormalAppEntry />)
    expect((await screen.findByRole('region', { name: '既有遷移決策' })).textContent).toContain('數學：甲課表')
  })

  it('keeps interrupted Fresh initialization export-only', async () => {
    const original = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V9_KEY) throw new Error('interrupted')
      return original.call(this, key, value)
    })
    expect((await initializeFreshV9(localStorage, { attemptId: 'fresh-interrupted', createdAt: time })).ok).toBe(false)
    spy.mockRestore()
    render(<FormalAppEntry />)
    expect((await screen.findByRole('main')).textContent).toContain('無法安全續接')
    expect(screen.queryByRole('button', { name: '確認續接復原' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /匯出 .* 原始 JSON/ }).length).toBeGreaterThan(0)
    expect(v9Mount).not.toHaveBeenCalled()
  })

  it('blocks multiple orphan backups and preserves exact export evidence', async () => {
    await interrupted('metadata')
    const backupKey = `${V9_BACKUP_PREFIX}another`
    localStorage.setItem(backupKey, '{partial}')
    render(<FormalAppEntry />)
    expect((await screen.findByRole('main')).textContent).toContain('多份候選備份')
    expect(screen.queryByRole('button', { name: '確認續接復原' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /匯出 .* 原始 JSON/ }).length).toBeGreaterThan(0)
    expect(localStorage.getItem(backupKey)).toBe('{partial}')
    expect(v9Mount).not.toHaveBeenCalled()
  })

  it('blocks tampered backup and shows no mutation action', async () => {
    await interrupted('document')
    const backupKey = `${V9_BACKUP_PREFIX}resume-attempt`
    localStorage.setItem(backupKey, JSON.stringify({ ...JSON.parse(localStorage.getItem(backupKey)!),
      candidateRaw: '{}' }))
    render(<FormalAppEntry />)
    expect((await screen.findByRole('main')).textContent).toContain('無法安全續接')
    expect(screen.queryByRole('button', { name: '確認續接復原' })).toBeNull()
    expect(v9Mount).not.toHaveBeenCalled()
  })

  it('keeps recovery visible when the post-service Runtime Gate blocks V9', async () => {
    await validV8()
    const original = formalRuntime.inspectFormalRuntime
    let activeChecks = 0
    vi.spyOn(formalRuntime, 'inspectFormalRuntime').mockImplementation(async (storage) => {
      const result = await original(storage)
      if (result.runtime === 'v9' && ++activeChecks === 2) {
        return { runtime: 'blocked-v9', v9Status: 'invalid-evidence' }
      }
      return result
    })
    render(<FormalAppEntry />)
    await screen.findByRole('main')
    fireEvent.click(screen.getByRole('button', { name: '匯出 v8-source 原始 JSON' }))
    await screen.findByText(/已準備此快照的原始 V8 JSON/)
    fireEvent.click(screen.getByRole('checkbox', { name: /我已自行確認此快照/ }))
    fireEvent.click(screen.getByRole('button', { name: '確認轉換並啟用獨立科目庫' }))
    expect((await screen.findByRole('alert')).textContent).toContain('正式驗證仍阻擋')
    expect(screen.getByRole('main')).toBeTruthy()
    expect(screen.queryByText('V9 Host')).toBeNull()
    expect(activeChecks).toBeGreaterThanOrEqual(2)
  })

  it('shows read failure without export or write action', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    render(<FormalAppEntry />)
    expect((await screen.findByRole('main')).textContent).toContain('無法讀取儲存資料')
    expect(screen.queryByRole('button', { name: /匯出|轉換|復原/ })).toBeNull()
    expect(v9Mount).not.toHaveBeenCalled()
  })
})

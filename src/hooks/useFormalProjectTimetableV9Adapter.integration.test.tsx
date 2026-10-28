// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProjectV9 } from '../data/managementV9'
import { createEmptyAppDataV8 } from '../data/storageV8'
import type { V9Host } from './useAppDataV9'
import { useFormalProjectTimetableV9Adapter } from './useFormalProjectTimetableV9Adapter'
import { useAppDataV4 } from './useAppDataV4'

let host: V9Host
vi.mock('./useAppDataV9', () => ({ useAppDataV9: () => host }))
vi.mock('./useAppDataV4', () => ({ useAppDataV4: vi.fn(() => { throw new Error('V7 Host must not mount') }) }))

beforeEach(() => {
  host = {
    data: { ...createEmptyAppDataV8(), schemaVersion: 9, subjects: [] }, status: 'active', writable: true,
    pending: false, revision: 0, receipt: null, errorCode: null,
    update: vi.fn(async (produce) => {
      const next = produce(host.data!)
      const receipt = { raw: JSON.stringify(next), revision: host.revision + 1, attemptId: 'adapter' }
      host = { ...host, data: next, revision: receipt.revision, receipt }
      return receipt
    }),
    exportLocalJson: () => null, exportStoredJson: () => null,
    exportActivationJson: () => null, exportBackupJson: () => null, adoptExternal: async () => false,
  }
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('formal V9 Project React adapter', () => {
  it('mounts and creates a name-only Project through one V9 write, selecting it after receipt', async () => {
    const { result } = renderHook(useFormalProjectTimetableV9Adapter)
    expect(result.current.selection).toEqual({ projectId: null, timetableId: null })
    await act(async () => { await result.current.actions!.project.createEmptyFromName({ name: '名稱專案' }) })
    expect(host.update).toHaveBeenCalledTimes(1)
    expect(result.current.selection).toEqual({ projectId: host.data!.projects[0].id, timetableId: null })
    expect(host.data!.projects[0]).toMatchObject({ name: '名稱專案', term: null })
    for (const key of ['schools', 'teachingUnits', 'timetables', 'subjects', 'classes',
      'recurringLessons', 'oneOffLessons', 'overrides', 'events', 'teachingProgress'] as const) {
      expect(host.data![key], key).toEqual([])
    }
    expect(useAppDataV4).not.toHaveBeenCalled()
  })

  it('exposes independent term configuration and preserves the selected Project after receipt', async () => {
    host.data = createEmptyProjectV9(host.data!, { name: '未設定' }, 'blank')
    const { result } = renderHook(useFormalProjectTimetableV9Adapter)
    expect(result.current.selection).toEqual({ projectId: 'blank', timetableId: null })
    await act(async () => {
      await result.current.actions!.project.configureTerm({ academicYear: 116, semester: 'first' })
    })
    expect(host.update).toHaveBeenCalledTimes(1)
    expect(host.data!.projects[0].term)
      .toEqual({ academicYear: 116, semester: 'first', customLabel: undefined })
    expect(result.current.selection).toEqual({ projectId: 'blank', timetableId: null })
    expect(useAppDataV4).not.toHaveBeenCalled()
  })

  it('does not report term configuration success when the receipt does not match', async () => {
    host.data = createEmptyProjectV9(host.data!, { name: '未設定' }, 'blank')
    host.update = vi.fn(async (produce) => ({
      raw: JSON.stringify(produce(host.data!)), revision: 9, attemptId: 'mismatch',
    }))
    const { result } = renderHook(useFormalProjectTimetableV9Adapter)
    await act(async () => {
      await expect(result.current.actions!.project.configureTerm({ academicYear: 116, semester: 'first' }))
        .rejects.toMatchObject({ code: 'receipt-mismatch' })
    })
    expect(host.data!.projects[0].term).toBeNull()
    expect(result.current.selection).toEqual({ projectId: 'blank', timetableId: null })
  })

  it('keeps captured callbacks sensitive to live Project selection, revision and writability', async () => {
    host.data = createEmptyProjectV9(createEmptyProjectV9(host.data!, { name: '甲' }, 'a'), { name: '乙' }, 'b')
    const { result, rerender } = renderHook(useFormalProjectTimetableV9Adapter)
    const old = result.current.actions!
    act(() => old.selectProject('a'))
    await expect(old.project.createEmptyFromName({ name: '舊範圍' })).rejects.toMatchObject({ code: 'scope-mismatch' })
    const stale = result.current.actions!
    host = { ...host, revision: 1 }
    rerender()
    await expect(stale.project.createEmptyFromName({ name: '舊版本' })).rejects.toMatchObject({ code: 'stale-document' })
    const revoked = result.current.actions!
    host = { ...host, writable: false, status: 'conflict' }
    rerender()
    await expect(revoked.project.createEmptyFromName({ name: '已撤銷' })).rejects.toMatchObject({ code: 'not-writable' })
    expect(host.update).not.toHaveBeenCalled()
    expect(result.current.selection.projectId).toBe('a')
  })

  it.each(['pending', 'readonly', 'conflict', 'receipt'] as const)('fails closed for %s', async (state) => {
    if (state === 'pending') host.pending = true
    if (state === 'readonly') host.writable = false
    if (state === 'conflict') host.status = 'conflict'
    if (state === 'receipt') host.update = vi.fn(async (produce) => ({
      raw: JSON.stringify(produce(host.data!)), revision: 5, attemptId: 'mismatch',
    }))
    const { result } = renderHook(useFormalProjectTimetableV9Adapter)
    await act(async () => {
      await expect(result.current.actions!.project.createEmptyFromName({ name: '不應成功' })).rejects.toThrow()
    })
    expect(result.current.selection).toEqual({ projectId: null, timetableId: null })
    expect(host.data!.projects).toEqual([])
    expect(host.update).toHaveBeenCalledTimes(state === 'receipt' ? 1 : 0)
  })
})

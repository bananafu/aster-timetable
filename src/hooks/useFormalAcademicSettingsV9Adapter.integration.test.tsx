// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyProjectV9 } from '../data/managementV9'
import { createEmptyAppDataV8 } from '../data/storageV8'
import type { FormalAcademicSettingsV9Selection } from '../formalAcademicSettingsV9'
import type { FormalV9HostPort } from '../formalRuntime'
import type { AppDataV9 } from '../types/v9'
import { useFormalAcademicSettingsV9Adapter } from './useFormalAcademicSettingsV9Adapter'

afterEach(cleanup)

describe('formal V9 academic settings React adapter', () => {
  it('updates again after a receipt-confirmed School/TeachingUnit creation', async () => {
    let document: AppDataV9 = createEmptyProjectV9(
      { ...createEmptyAppDataV8(), schemaVersion: 9, subjects: [] }, { name: '空白' }, 'project-a')
    let revision = 0
    const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
      const next = produce(document)
      document = next
      revision += 1
      return { raw: JSON.stringify(next), revision, attemptId: `academic-${revision}` }
    })
    const port = () => ({
      get document() { return document }, status: 'active' as const, writable: true, pending: false,
      receipt: null, get revision() { return revision }, errorCode: null, update,
    }) satisfies FormalV9HostPort
    let selected: FormalAcademicSettingsV9Selection = {
      projectId: 'project-a', timetableId: null, teachingUnitId: null,
    }
    const onSelectionChange = vi.fn((next: FormalAcademicSettingsV9Selection) => { selected = next })
    const createIds = (() => { const values = ['school-a', 'unit-a']; return () => values.shift() ?? 'unused' })()
    const { result, rerender } = renderHook(({ host, selection }) =>
      useFormalAcademicSettingsV9Adapter(host, selection, onSelectionChange, createIds), {
      initialProps: { host: port(), selection: selected },
    })

    await act(async () => { await result.current.actions.createSchoolWithTeachingUnit(
      { name: '甲校', color: '#718B6C' },
      { schoolLevel: 'senior-high', startDate: '2027-08-01', endDate: '2028-01-31' }) })
    rerender({ host: port(), selection: selected })
    await act(async () => { await result.current.actions.updateSchool('school-a',
      { name: '甲校更新', color: '#123456' }) })

    expect(update).toHaveBeenCalledTimes(2)
    expect(document.schools[0]).toMatchObject({ name: '甲校更新', color: '#123456' })
    expect(result.current.success).toBe('已儲存：已更新學校。')
  })
})

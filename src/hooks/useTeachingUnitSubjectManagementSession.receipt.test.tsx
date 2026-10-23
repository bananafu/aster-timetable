// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { createBlankProject } from '../data/projectRuntimeV8'
import { createSubject } from '../data/subjectsV8'
import { useTeachingUnitSubjectManagementSession } from './useTeachingUnitSubjectManagementSession'

const base = () => {
  let id = 0
  return createBlankProject(createEmptyAppDataV8(), { name: 'A', academicYear: 115,
    semester: 'first', startDate: '2026-08-01', endDate: '2027-01-31' }, () => `id-${++id}`)
}
const draft = { name: '地球科學', shortName: '地科', color: '#345678',
  applicableSchoolLevels: ['senior-high' as const] }
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('V8 Subject Host receipt boundary', () => {
  it.each([
    { receiptRevision: 2, receiptRaw: 'expected' },
    { receiptRevision: 1, receiptRaw: 'wrong' },
    { receiptRevision: 1, receiptRaw: 'expected' },
  ])('requires the matching raw and revision: %j', ({ receiptRevision, receiptRaw }) => {
    const initial = base()
    const expected = createSubject(initial, initial.activeProjectId!, draft, 'subject-a')
    const setData = vi.fn()
    const { result, rerender } = renderHook((props: { data: typeof initial; persistence: {
      pending: boolean; revision: number; receipt: { raw: string; revision: number } | null } }) =>
      useTeachingUnitSubjectManagementSession({ data: props.data, setData,
        storageStatus: 'saved', storagePersistence: props.persistence }), {
      initialProps: { data: initial, persistence: { pending: false, revision: 0,
        receipt: null as { raw: string; revision: number } | null } },
    })
    act(() => { expect(result.current.submit(() => expected, '已保存')).toBe(true) })
    const raw = receiptRaw === 'expected' ? JSON.stringify(expected) : receiptRaw
    rerender({ data: expected, persistence: { pending: false, revision: 1,
      receipt: { raw, revision: receiptRevision } } })
    if (receiptRevision === 1 && receiptRaw === 'expected') {
      expect(result.current.success).toBe('已保存')
    } else {
      expect(result.current.success).toBe('')
      expect(result.current.error).toContain('儲存結果與預期不同')
    }
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import type { ProjectLifecycleActions } from '../formalV7ProjectTimetableActions'
import { ProjectLifecycleModal } from './ProjectLifecycle'
import { TimetableInfoDialog } from './TimetableControls'

const data = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(
  migrateV3ToV4(structuredClone(initialData)),
)))

type V9ProjectActions = Extract<ProjectLifecycleActions, { creationMode: 'empty-v9' }>
const v9ProjectActions = (overrides: Partial<V9ProjectActions> = {}): V9ProjectActions => ({
  runtime: 'v9', creationMode: 'empty-v9', copyRequiresSourceEffectiveDate: true,
  createProject: vi.fn(), copyProject: vi.fn(), archiveProject: vi.fn(), reactivateProject: vi.fn(),
  deleteProject: vi.fn(), ...overrides,
})

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('Production Integration Stage 1B UI contracts', () => {
  it('keeps the approved V9 ordinary-Project form name-only and preserves its draft on rejection', async () => {
    const source = data()
    const createProject = vi.fn().mockRejectedValue(new Error('host-rejected'))
    const onClose = vi.fn()
    render(<ProjectLifecycleModal data={source} setData={vi.fn()} actions={v9ProjectActions({ createProject })}
      initialPage="blank" onClose={onClose} onViewArchived={vi.fn()} />)

    expect(screen.getByLabelText('專案名稱')).toBeTruthy()
    expect(screen.queryByLabelText('授課教師姓名')).toBeNull()
    expect(screen.queryByLabelText('學年度')).toBeNull()
    expect(screen.queryByLabelText('起始日')).toBeNull()
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '完全空白專案' } })
    fireEvent.submit(screen.getByText('建立並切換').closest('form')!)

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('請確認空白專案名稱'))
    expect(createProject).toHaveBeenCalledWith({ name: '完全空白專案' })
    expect((screen.getByLabelText('專案名稱') as HTMLInputElement).value).toBe('完全空白專案')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('requires an explicit source-effective date and keeps the copy modal open after rejection', async () => {
    const source = data()
    const copyProject = vi.fn().mockRejectedValue(new Error('host-rejected'))
    const onClose = vi.fn()
    render(<ProjectLifecycleModal data={source} setData={vi.fn()} actions={v9ProjectActions({ copyProject })}
      onClose={onClose} onViewArchived={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /複製為新學期/ }))

    expect(screen.getByLabelText('來源有效日期')).toBeTruthy()
    fireEvent.submit(screen.getByText('複製並切換').closest('form')!)
    expect(copyProject).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('來源有效日期')

    fireEvent.change(screen.getByLabelText('來源有效日期'), { target: { value: '2026-09-01' } })
    fireEvent.change(screen.getByLabelText('專案名稱'), { target: { value: '下一學期' } })
    fireEvent.submit(screen.getByText('複製並切換').closest('form')!)
    await waitFor(() => expect(copyProject).toHaveBeenCalledTimes(1))
    expect(copyProject.mock.calls[0][0].units[0].sourceEffectiveDate).toBe('2026-09-01')
    expect((screen.getByLabelText('專案名稱') as HTMLInputElement).value).toBe('下一學期')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('uses the approved settings-only Timetable copy wording without changing the V7 default', () => {
    const timetable = data().timetables[0]
    const common = { timetable, defaultDate: '2026-09-01', error: '', submitting: false,
      deleteImpact: { lessons: 0, overrides: 0, oneOffLessons: 0 }, onEdit: vi.fn(), onCopy: vi.fn(),
      onDelete: vi.fn(), onClose: vi.fn() }
    const v9 = render(<TimetableInfoDialog {...common} copyMode="settings" />)
    expect(screen.getByRole('heading', { name: '只複製課表設定' })).toBeTruthy()
    expect(screen.getByText('只複製課表設定；不複製固定課程、單日課程、課程異動或 Event。')).toBeTruthy()
    v9.unmount()

    render(<TimetableInfoDialog {...common} />)
    expect(screen.getByText('依基準日期複製有效的固定課程版本與 A／B 週配置；不複製單日異動或單日課程。')).toBeTruthy()
  })
})

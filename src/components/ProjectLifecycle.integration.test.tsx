// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { createOneOffLesson } from '../data/oneOffLessonsV7'
import { ProjectLifecycleModal } from './ProjectLifecycle'

afterEach(cleanup)

describe('ProjectLifecycleModal hierarchical settings', () => {
  it('一般新增與複製為新學期維持不同入口與表單語意', () => {
    const data = migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
    const first = render(<ProjectLifecycleModal data={data} setData={vi.fn()} initialPage="blank" onClose={vi.fn()} onViewArchived={vi.fn()} />)
    expect(screen.getByText('使用固定預設，不沿用目前專案的學校、節次、班級或課程。')).toBeTruthy()
    expect(screen.queryByLabelText('來源專案')).toBeNull()
    first.unmount()

    render(<ProjectLifecycleModal data={data} setData={vi.fn()} onClose={vi.fn()} onViewArchived={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /複製為新學期/ }))
    expect(screen.getByLabelText('來源專案')).toBeTruthy()
    expect(screen.getByText('複製學校、學制設定、節次、班級與固定課程；不複製事件、取消或單日異動。')).toBeTruthy()
    expect(screen.getByRole('button', { name: /複製並切換/ })).toBeTruthy()
  })

  it('母層只顯示直接子項目，進入學校管理後才顯示孫項目', () => {
    const data = migrateV3ToV4(structuredClone(initialData))
    render(<ProjectLifecycleModal data={data} setData={vi.fn()} onClose={vi.fn()} onViewArchived={vi.fn()} />)
    expect(screen.getByRole('button', { name: /學校與學制管理/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /建立新專案|管理科目|管理班級/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /建立空白課表/ })).toBeNull()
    expect(screen.queryByText('課堂時間表')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /學校與學制管理/ }))
    expect(screen.getByRole('button', { name: /課堂時間表/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /班級管理|科目管理/ })).toBeNull()
    expect(screen.queryByLabelText('學校')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /課堂時間表/ }))
    expect(screen.getByLabelText('學校')).toBeTruthy()
    expect(screen.getByLabelText('目前學制')).toBeTruthy()
    expect(screen.getByRole('button', { name: /返回上一層/ })).toBeTruthy()
  })

  it('切換學校後學制會重新對應該校資料', () => {
    const data = migrateV3ToV4(structuredClone(initialData))
    const projectId = data.activeProjectId!
    data.schools.push({ id: 'school-2', projectId, name: '第二校', color: '#718B6C' })
    data.teachingUnits.push({ ...structuredClone(data.teachingUnits[0]), id: 'unit-2', schoolId: 'school-2', name: '國中部', schoolLevel: 'junior-high', periods: structuredClone(data.teachingUnits[0].periods) })
    render(<ProjectLifecycleModal data={data} setData={vi.fn()} onClose={vi.fn()} onViewArchived={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /學校與學制管理/ }))
    fireEvent.click(screen.getByRole('button', { name: /課堂時間表/ }))
    fireEvent.change(screen.getByLabelText('學校'), { target: { value: 'school-2' } })
    const level = screen.getByLabelText('目前學制') as HTMLSelectElement
    expect(level.value).toBe('unit-2')
    expect([...level.options].map((option) => option.text)).toEqual(['國中部'])
  })

  it('刪除專案確認訊息包含會一起移除的單日課程數', () => {
    const base = migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
    const data = createOneOffLesson(base, {
      projectId: base.projects[0].id, timetableId: base.timetables[0].id,
      teachingUnitId: base.teachingUnits[0].id, classId: base.classes[0].id,
      subjectId: base.subjects[0].id, date: '2026-09-06', purpose: 'extra',
      time: { mode: 'custom', startTime: '09:30', endTime: '11:00' },
    }, () => '00000000-0000-4000-8000-000000000001')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<ProjectLifecycleModal data={data} setData={vi.fn()} onClose={vi.fn()} onViewArchived={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /歷史與專案管理/ }))
    fireEvent.click(screen.getByRole('button', { name: '刪除' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('1 筆單日課程'))
    confirm.mockRestore()
  })
})

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClassV9 } from '../data/managementV9'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9,
  createTeacherTimetableV9, createTeachingUnitV9 } from '../data/teacherSubjectsV9'
import type { FormalClassManagementV9Selection } from '../formalClassManagementV9'
import type { FormalV9HostPort } from '../formalRuntime'
import { useFormalClassManagementV9Adapter,
  type FormalClassManagementV9UiPort } from '../hooks/useFormalClassManagementV9Adapter'
import type { AppDataV9 } from '../types/v9'
import { CourseResourceManager, CourseResourceManagerDialog } from './CourseResourceManager'

const empty = (): AppDataV9 => ({ ...createEmptyAppDataV8(), schemaVersion: 9 }) as AppDataV9
const projectInput = (name: string, semester: 'first' | 'second' = 'first') => ({
  name, academicYear: 116, semester, startDate: semester === 'first' ? '2027-08-01' : '2028-02-01',
  endDate: semester === 'first' ? '2028-01-31' : '2028-07-31',
})
const idFactory = (prefix: string) => {
  let serial = 0
  return () => `${prefix}-${++serial}`
}

function fixture() {
  const id = idFactory('fixture')
  let data = createBlankProjectV9(empty(), projectInput('Project A'), id)
  const projectA = data.activeProjectId!
  const seniorA = data.teachingUnits.find((item) => item.projectId === projectA)!
  data = createTeachingUnitV9(data, projectA, {
    schoolId: seniorA.schoolId, name: '國中部', schoolLevel: 'junior-high',
    startDate: seniorA.startDate, endDate: seniorA.endDate, periods: seniorA.periods,
    weekCycle: seniorA.weekCycle,
  }, 'junior-a')
  data = createTeacherTimetableV9(data, projectA, { name: '甲課表', teacherName: '甲' }, 'teacher-a')
  data = createTeacherTimetableV9(data, projectA, { name: '乙課表', teacherName: '乙' }, 'teacher-b')
  data = createBlankProjectV9(data, projectInput('Project B', 'second'), id)
  const projectB = data.activeProjectId!
  const seniorB = data.teachingUnits.find((item) => item.projectId === projectB)!
  data = createTeacherTimetableV9(data, projectB, { name: '丙課表', teacherName: '丙' }, 'teacher-c')
  const selection: FormalClassManagementV9Selection = {
    projectId: projectA, teachingUnitId: seniorA.id,
  }
  return { data, projectA, projectB, seniorA,
    juniorA: data.teachingUnits.find((item) => item.id === 'junior-a')!, seniorB,
    selection }
}

interface HostOptions {
  status?: FormalV9HostPort['status']
  writable?: boolean
  pending?: boolean
  reject?: Error
  receiptMismatch?: boolean
}

function hostFixture(initial: AppDataV9, options: HostOptions = {}) {
  let document = initial
  let revision = 0
  const update = vi.fn(async (produce: (current: AppDataV9) => AppDataV9) => {
    if (options.reject) throw options.reject
    const next = produce(document)
    const receipt = { raw: JSON.stringify(next),
      revision: revision + (options.receiptMismatch ? 2 : 1), attemptId: 'class-ui-s2-4' }
    if (!options.receiptMismatch) { document = next; revision += 1 }
    return receipt
  })
  const host = {
    get document() { return document }, status: options.status ?? 'active',
    writable: options.writable ?? true, pending: options.pending ?? false,
    receipt: null, get revision() { return revision }, errorCode: null, update,
  } satisfies FormalV9HostPort
  return { host, document: () => document, update }
}

let latestPort: FormalClassManagementV9UiPort | null = null

function Harness({ host, initialSelection, dialog = false }: {
  host: FormalV9HostPort
  initialSelection: FormalClassManagementV9Selection
  dialog?: boolean
}) {
  const [selection, setSelection] = useState(initialSelection)
  const [teacher, setTeacher] = useState('teacher-a')
  const createId = useState(() => idFactory('ui-class'))[0]
  const port = useFormalClassManagementV9Adapter(host, selection, setSelection, createId)
  latestPort = port
  return <>
    <output data-testid="teacher">{teacher}</output>
    <button type="button" onClick={() => setTeacher((value) => value === 'teacher-a'
      ? 'teacher-b' : 'teacher-a')}>切換教師</button>
    <button type="button" onClick={() => setSelection({ ...selection,
      teachingUnitId: 'junior-a' })}>切換國中部</button>
    {dialog
      ? <CourseResourceManagerDialog mode="classes" classPort={port} onClose={vi.fn()} />
      : <CourseResourceManager mode="classes" classPort={port} />}
  </>
}

function openCreate() {
  fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
  return screen.getByRole('form', { name: '新增班級表單' })
}

beforeEach(() => {
  latestPort = null
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('CourseResourceManager V9 Class action port', () => {
  it('只顯示目前 Project＋TeachingUnit，切換教師不複製或改變班級', () => {
    const source = fixture()
    let data = createClassV9(source.data, source.projectA,
      { teachingUnitId: source.seniorA.id, grade: 1, classNumber: 1 }, 'senior-class')
    data = createClassV9(data, source.projectA,
      { teachingUnitId: source.juniorA.id, grade: 7, classNumber: 1 }, 'junior-class')
    data = createClassV9(data, source.projectB,
      { teachingUnitId: source.seniorB.id, grade: 1, classNumber: 1 }, 'project-b-class')
    const host = hostFixture(data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    expect(screen.getByRole('button', { name: '編輯班級 101' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '編輯班級 701' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '切換教師' }))
    expect(screen.getByTestId('teacher').textContent).toBe('teacher-b')
    expect(screen.getByRole('button', { name: '編輯班級 101' })).toBeTruthy()
    expect(host.document().classes).toHaveLength(3)
  })

  it('新增班級成功後保持 Modal 開啟並可繼續新增', async () => {
    const source = fixture()
    const host = hostFixture(source.data)
    render(<Harness host={host.host} initialSelection={source.selection} dialog />)
    openCreate()
    fireEvent.change(screen.getByLabelText('新班級班號'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('新班級教室'), { target: { value: 'A303' } })
    fireEvent.click(screen.getByRole('button', { name: '新增班級' }))
    await waitFor(() => expect(host.document().classes).toContainEqual(expect.objectContaining({
      name: '103', room: 'A303', projectId: source.projectA,
      teachingUnitId: source.seniorA.id,
    })))
    expect(screen.getByRole('dialog', { name: '管理班級' })).toBeTruthy()
    expect(screen.getByRole('form', { name: '新增班級表單' })).toBeTruthy()
    expect((screen.getByLabelText('新班級教室') as HTMLInputElement).value).toBe('')
  })

  it('在既有編輯表單更新班級並保留 Project 與 TeachingUnit ownership', async () => {
    const source = fixture()
    const data = createClassV9(source.data, source.projectA,
      { teachingUnitId: source.seniorA.id, grade: 1, classNumber: 1 }, 'class-a')
    const host = hostFixture(data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    fireEvent.click(screen.getByRole('button', { name: '編輯班級 101' }))
    const form = screen.getByRole('form', { name: '管理班級 101' })
    fireEvent.change(within(form).getByLabelText('班級班號'), { target: { value: '2' } })
    fireEvent.change(within(form).getByLabelText('班級教室'), { target: { value: 'B202' } })
    fireEvent.click(within(form).getByRole('button', { name: '儲存班級' }))
    await waitFor(() => expect(host.document().classes.find((item) => item.id === 'class-a'))
      .toMatchObject({ name: '102', room: 'B202', projectId: source.projectA,
        teachingUnitId: source.seniorA.id }))
  })

  it('無引用班級可由既有編輯表單安全刪除', async () => {
    const source = fixture()
    const data = createClassV9(source.data, source.projectA,
      { teachingUnitId: source.seniorA.id, grade: 1, classNumber: 1 }, 'class-a')
    const host = hostFixture(data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    fireEvent.click(screen.getByRole('button', { name: '編輯班級 101' }))
    fireEvent.click(screen.getByRole('button', { name: '刪除班級' }))
    await waitFor(() => expect(host.document().classes.some((item) => item.id === 'class-a')).toBe(false))
    expect(screen.getByText('目前學制尚無班級。')).toBeTruthy()
  })

  it('有固定課程引用時阻擋刪除並在班級附近顯示原因', async () => {
    const source = fixture()
    const subject = { name: '數學', shortName: '數', color: '#647C88',
      applicableSchoolLevels: ['senior-high' as const] }
    let data = createTeacherSubjectV9(source.data, source.projectA, 'teacher-a', subject, 'subject-a')
    data = configureTeacherSubjectV9(data, source.projectA, 'teacher-a', source.seniorA.id,
      'subject-a', 'relation-a')
    data = createClassV9(data, source.projectA,
      { teachingUnitId: source.seniorA.id, grade: 1, classNumber: 1 }, 'class-a')
    data = { ...data, recurringLessons: [{
      id: 'lesson-a', seriesId: 'series-a', projectId: source.projectA, timetableId: 'teacher-a',
      teachingUnitId: source.seniorA.id, subjectId: 'subject-a', classId: 'class-a', day: 1,
      periodId: source.seniorA.periods[0].id, weekPattern: 'every',
      effectiveStart: source.seniorA.startDate, effectiveEnd: source.seniorA.endDate,
    }] }
    const host = hostFixture(data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    fireEvent.click(screen.getByRole('button', { name: '編輯班級 101' }))
    fireEvent.click(screen.getByRole('button', { name: '刪除班級' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some((item) =>
      item.textContent?.includes('1 筆固定課程'))).toBe(true))
    expect(host.document().classes).toContainEqual(expect.objectContaining({ id: 'class-a' }))
  })

  it.each([
    ['pending', { pending: true }],
    ['readonly', { writable: false }],
    ['conflict', { status: 'conflict' as const }],
  ])('%s Host 不允許 Class UI 寫入', (_name, options) => {
    const source = fixture()
    const host = hostFixture(source.data, options)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    expect((screen.getByRole('button', { name: '＋ 新增班級' }) as HTMLButtonElement).disabled)
      .toBe(true)
    expect(host.update).not.toHaveBeenCalled()
  })

  it.each([
    ['reject', { reject: new Error('storage rejected') }],
    ['receipt mismatch', { receiptMismatch: true }],
  ])('%s 不誤報成功並保留 Modal 與班級草稿', async (_name, options) => {
    const source = fixture()
    const host = hostFixture(source.data, options)
    render(<Harness host={host.host} initialSelection={source.selection} dialog />)
    openCreate()
    fireEvent.change(screen.getByLabelText('新班級班號'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('新班級教室'), { target: { value: '保留教室' } })
    fireEvent.click(screen.getByRole('button', { name: '新增班級' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/^已儲存：/)).toBeNull()
    expect((screen.getByLabelText('新班級教室') as HTMLInputElement).value).toBe('保留教室')
    expect(screen.getByRole('dialog', { name: '管理班級' })).toBeTruthy()
    expect(host.document().classes).toHaveLength(0)
  })

  it('TeachingUnit scope 切換後舊 adapter callback 被拒絕', async () => {
    const source = fixture()
    const host = hostFixture(source.data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    const oldCreate = latestPort!.actions.create
    fireEvent.click(screen.getByRole('button', { name: '切換國中部' }))
    await waitFor(() => expect(latestPort?.selection.teachingUnitId).toBe('junior-a'))
    await act(async () => {
      await expect(oldCreate({ teachingUnitId: source.seniorA.id, grade: 1, classNumber: 1 }))
        .rejects.toMatchObject({ code: 'scope-mismatch' })
    })
    expect(host.document().classes).toHaveLength(0)
  })
})

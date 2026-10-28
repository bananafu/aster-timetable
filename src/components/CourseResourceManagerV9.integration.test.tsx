// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClassV9 } from '../data/managementV9'
import { createEmptyAppDataV8 } from '../data/storageV8'
import { configureTeacherSubjectV9, createBlankProjectV9, createTeacherSubjectV9,
  createTeacherTimetableV9, createTeachingUnitV9 } from '../data/teacherSubjectsV9'
import type { FormalSubjectManagementV9Selection } from '../formalSubjectManagementV9'
import type { FormalV9HostPort } from '../formalRuntime'
import { useFormalSubjectManagementV9Adapter,
  type FormalSubjectManagementV9UiPort } from '../hooks/useFormalSubjectManagementV9Adapter'
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
const math = { name: '數學', shortName: '數', color: '#647C88',
  applicableSchoolLevels: ['junior-high', 'senior-high'] as const }

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
  const selection = { projectId: projectA, timetableId: 'teacher-a',
    teachingUnitId: seniorA.id } satisfies FormalSubjectManagementV9Selection
  return { data, projectA, projectB, seniorA,
    juniorA: data.teachingUnits.find((item) => item.id === 'junior-a')!, seniorB, selection }
}

function addSubject(data: AppDataV9, projectId: string, timetableId: string,
  subjectId: string, name = '數學', levels = [...math.applicableSchoolLevels]) {
  return createTeacherSubjectV9(data, projectId, timetableId, {
    name, shortName: name === '數學' ? '數' : name.slice(0, 2), color: '#647C88',
    applicableSchoolLevels: [...levels],
  }, subjectId)
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
      revision: revision + (options.receiptMismatch ? 2 : 1), attemptId: 's2-3' }
    if (!options.receiptMismatch) {
      document = next
      revision += 1
    }
    return receipt
  })
  const host = {
    get document() { return document }, status: options.status ?? 'active',
    writable: options.writable ?? true, pending: options.pending ?? false,
    receipt: null, get revision() { return revision }, errorCode: null, update,
  } satisfies FormalV9HostPort
  return { host, document: () => document, update }
}

let latestPort: FormalSubjectManagementV9UiPort | null = null

function Harness({ host, initialSelection, dialog = false }: {
  host: FormalV9HostPort
  initialSelection: FormalSubjectManagementV9Selection
  dialog?: boolean
}) {
  const [selection, setSelection] = useState(initialSelection)
  const createId = useState(() => idFactory('ui'))[0]
  const port = useFormalSubjectManagementV9Adapter(host, selection, setSelection, createId)
  latestPort = port
  return <>
    <button type="button" onClick={() => setSelection({ ...selection, timetableId: 'teacher-b' })}>
      切換乙教師
    </button>
    {dialog
      ? <CourseResourceManagerDialog mode="subjects" subjectPort={port} onClose={vi.fn()} />
      : <CourseResourceManager mode="subjects" subjectPort={port} />}
  </>
}

beforeEach(() => {
  latestPort = null
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('CourseResourceManager V9 action port', () => {
  it('只顯示目前教師與 Project 的同名 Subject，切換教師立即更新 scope', async () => {
    const source = fixture()
    let data = addSubject(source.data, source.projectA, 'teacher-a', 'math-a')
    data = addSubject(data, source.projectA, 'teacher-b', 'math-b')
    data = addSubject(data, source.projectB, 'teacher-c', 'math-c')
    data = configureTeacherSubjectV9(data, source.projectA, 'teacher-a', source.seniorA.id,
      'math-a', 'relation-a')
    data = configureTeacherSubjectV9(data, source.projectA, 'teacher-b', source.seniorA.id,
      'math-b', 'relation-b')
    const host = hostFixture(data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    expect(screen.getByRole('button', { name: '編輯科目 數學' })).toBeTruthy()
    expect(latestPort?.view?.subjects.map((item) => item.id)).toEqual(['math-a'])
    fireEvent.click(screen.getByRole('button', { name: '切換乙教師' }))
    await waitFor(() => expect(latestPort?.view?.subjects.map((item) => item.id)).toEqual(['math-b']))
  })

  it('科目標籤 × 只解除目前任教單位配置，並以 ＋ 重新配置既有 Subject', async () => {
    const source = fixture()
    let data = addSubject(source.data, source.projectA, 'teacher-a', 'chinese-a', '國語文')
    data = configureTeacherSubjectV9(data, source.projectA, 'teacher-a', source.seniorA.id,
      'chinese-a', 'relation-senior')
    data = configureTeacherSubjectV9(data, source.projectA, 'teacher-a', source.juniorA.id,
      'chinese-a', 'relation-junior')
    const host = hostFixture(data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    expect(screen.getByRole('button', { name: '編輯科目 國語文' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', {
      name: '解除科目「國語文」的目前任教單位配置',
    }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '編輯科目 國語文' })).toBeNull())
    expect(host.document().subjects.filter((item) => item.name === '國語文'))
      .toEqual([expect.objectContaining({ id: 'chinese-a' })])
    expect(host.document().teachingUnitSubjects).toContainEqual(expect.objectContaining({
      id: 'relation-junior', teachingUnitId: source.juniorA.id, subjectId: 'chinese-a',
    }))
    expect(host.document().teachingUnitSubjects.some((item) =>
      item.teachingUnitId === source.seniorA.id && item.subjectId === 'chinese-a')).toBe(false)
    expect(window.confirm).not.toHaveBeenCalled()

    const add = screen.getByRole('button', { name: '加入預設科目 國語文' })
    expect(add.textContent).toBe('＋')
    fireEvent.click(add)
    await waitFor(() => expect(screen.getByRole('button', { name: '編輯科目 國語文' })).toBeTruthy())
    expect(host.document().subjects.filter((item) => item.name === '國語文'))
      .toEqual([expect.objectContaining({ id: 'chinese-a' })])
    expect(host.document().teachingUnitSubjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'relation-junior', teachingUnitId: source.juniorA.id,
        subjectId: 'chinese-a' }),
      expect.objectContaining({ teachingUnitId: source.seniorA.id, subjectId: 'chinese-a' }),
    ]))
    expect(host.document().teachingUnitSubjects).toHaveLength(2)
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('自訂新增只建立 Subject、保留 Modal 並重設表單供連續新增', async () => {
    const source = fixture()
    const host = hostFixture(source.data)
    render(<Harness host={host.host} initialSelection={source.selection} dialog />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增科目' }))
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '專題研究' } })
    fireEvent.change(screen.getByLabelText('新科目簡稱'), { target: { value: '專題' } })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))
    await waitFor(() => expect(host.document().subjects).toContainEqual(expect.objectContaining({
      name: '專題研究', timetableId: 'teacher-a',
    })))
    expect(host.document().teachingUnitSubjects).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('')
  })

  it('預設目錄以單次 Host update 建立並配置，且接著顯示已加入', async () => {
    const source = fixture()
    const host = hostFixture(source.data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '數學' } })
    fireEvent.click(screen.getByRole('button', { name: '加入預設科目 數學' }))
    await waitFor(() => expect(host.document().subjects.some((item) => item.name === '數學')).toBe(true))
    const subject = host.document().subjects.find((item) => item.name === '數學')!
    expect(host.document().teachingUnitSubjects).toContainEqual(expect.objectContaining({
      subjectId: subject.id, teachingUnitId: source.seniorA.id,
    }))
    expect(host.update).toHaveBeenCalledTimes(1)
    expect(screen.getByText('已加入')).toBeTruthy()
  })

  it('既有未配置 Subject 可配置，缺學制則先取得明確確認', async () => {
    const source = fixture()
    let data = addSubject(source.data, source.projectA, 'teacher-a', 'math-a')
    const host = hostFixture(data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '數學' } })
    const configure = screen.getByRole('button', { name: '加入預設科目 數學' })
    expect(configure.textContent).toBe('＋')
    fireEvent.click(configure)
    await waitFor(() => expect(host.document().teachingUnitSubjects).toHaveLength(1))

    cleanup()
    data = addSubject(source.data, source.projectA, 'teacher-a', 'math-junior', '數學', ['junior-high'])
    const missingLevelHost = hostFixture(data)
    render(<Harness host={missingLevelHost.host} initialSelection={source.selection} />)
    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '數學' } })
    fireEvent.click(screen.getByRole('button', { name: '將既有科目 數學 加入此學制並配置' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('擴充為適用高中部'))
    await waitFor(() => expect(missingLevelHost.document().teachingUnitSubjects).toHaveLength(1))
    expect(missingLevelHost.document().subjects.find((item) => item.id === 'math-junior')
      ?.applicableSchoolLevels).toEqual(['junior-high', 'senior-high'])
  })

  it('有引用時在科目附近顯示具體阻擋原因並保留資料', async () => {
    const source = fixture()
    let data = createClassV9(source.data, source.projectA,
      { teachingUnitId: source.seniorA.id, grade: 1, classNumber: 1 }, 'class-a')
    data = addSubject(data, source.projectA, 'teacher-a', 'math-a')
    data = configureTeacherSubjectV9(data, source.projectA, 'teacher-a', source.seniorA.id,
      'math-a', 'relation-a')
    data = { ...data, recurringLessons: [{
      id: 'lesson-a', seriesId: 'series-a', projectId: source.projectA, timetableId: 'teacher-a',
      teachingUnitId: source.seniorA.id, subjectId: 'math-a', classId: 'class-a', day: 1,
      periodId: source.seniorA.periods[0].id, weekPattern: 'every',
      effectiveStart: source.seniorA.startDate, effectiveEnd: source.seniorA.endDate,
    }] }
    const host = hostFixture(data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    fireEvent.click(screen.getByRole('button', {
      name: '解除科目「數學」的目前任教單位配置',
    }))
    await waitFor(() => expect(screen.getAllByRole('alert')
      .some((item) => item.textContent?.includes('固定課程「lesson-a」'))).toBe(true))
    expect(host.document().teachingUnitSubjects).toContainEqual(expect.objectContaining({ id: 'relation-a' }))
  })

  it.each([
    ['Host reject', { reject: new Error('storage rejected') }],
    ['receipt mismatch', { receiptMismatch: true }],
  ])('%s 時解除配置不會讓標籤假消失', async (_name, options) => {
    const source = fixture()
    let data = addSubject(source.data, source.projectA, 'teacher-a', 'math-a')
    data = configureTeacherSubjectV9(data, source.projectA, 'teacher-a', source.seniorA.id,
      'math-a', 'relation-a')
    const host = hostFixture(data, options)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    fireEvent.click(screen.getByRole('button', {
      name: '解除科目「數學」的目前任教單位配置',
    }))
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: '編輯科目 數學' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加入預設科目 數學' })).toBeNull()
    expect(host.document().teachingUnitSubjects).toContainEqual(expect.objectContaining({
      id: 'relation-a', teachingUnitId: source.seniorA.id, subjectId: 'math-a',
    }))
    expect(screen.queryByText(/^已儲存：/)).toBeNull()
  })

  it('未配置 Subject 保留原 ID 並只在預設目錄提供重新配置 ＋', () => {
    const source = fixture()
    const data = addSubject(source.data, source.projectA, 'teacher-a', 'old-math')
    const host = hostFixture(data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    expect(screen.queryByRole('button', { name: '編輯科目 數學' })).toBeNull()
    expect(screen.getByRole('button', { name: '加入預設科目 數學' }).textContent).toBe('＋')
    expect(host.document().subjects.filter((item) => item.name === '數學'))
      .toEqual([expect.objectContaining({ id: 'old-math' })])
    expect(host.update).not.toHaveBeenCalled()
  })

  it.each([
    ['pending', { pending: true }],
    ['readonly', { writable: false }],
    ['conflict', { status: 'conflict' as const }],
  ])('%s Host 不允許 UI 寫入', (_name, options) => {
    const source = fixture()
    const host = hostFixture(source.data, options)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    expect((screen.getByRole('button', { name: '＋ 新增科目' }) as HTMLButtonElement).disabled)
      .toBe(true)
    expect(host.update).not.toHaveBeenCalled()
  })

  it.each([
    ['reject', { reject: new Error('storage rejected') }],
    ['receipt mismatch', { receiptMismatch: true }],
  ])('%s 不誤報成功，並保留 Modal 草稿', async (_name, options) => {
    const source = fixture()
    const host = hostFixture(source.data, options)
    render(<Harness host={host.host} initialSelection={source.selection} dialog />)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增科目' }))
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '保留草稿' } })
    fireEvent.change(screen.getByLabelText('新科目簡稱'), { target: { value: '保留' } })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(/^已儲存：/)).toBeNull()
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('保留草稿')
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    expect(host.document().subjects.some((item) => item.name === '保留草稿')).toBe(false)
  })

  it('目錄寫入失敗時保留搜尋內容與管理畫面', async () => {
    const source = fixture()
    const host = hostFixture(source.data, { reject: new Error('storage rejected') })
    render(<Harness host={host.host} initialSelection={source.selection} dialog />)
    fireEvent.change(screen.getByLabelText('搜尋科目'), { target: { value: '數學' } })
    fireEvent.click(screen.getByRole('button', { name: '加入預設科目 數學' }))
    await waitFor(() => expect(screen.getAllByRole('alert').some((item) =>
      item.textContent?.includes('storage rejected'))).toBe(true))
    expect((screen.getByLabelText('搜尋科目') as HTMLInputElement).value).toBe('數學')
    expect(screen.getByRole('dialog', { name: '管理科目' })).toBeTruthy()
    expect(host.document().subjects).toHaveLength(0)
  })

  it('scope 切換後舊 adapter callback 被拒絕且不修改另一教師資料', async () => {
    const source = fixture()
    const host = hostFixture(source.data)
    render(<Harness host={host.host} initialSelection={source.selection} />)
    const oldCreate = latestPort!.actions.createCustom
    fireEvent.click(screen.getByRole('button', { name: '切換乙教師' }))
    await waitFor(() => expect(latestPort?.selection.timetableId).toBe('teacher-b'))
    await act(async () => {
      await expect(oldCreate({ name: '舊 callback', shortName: '舊', color: '#123456',
        applicableSchoolLevels: ['senior-high'] })).rejects.toMatchObject({ code: 'scope-mismatch' })
    })
    expect(host.document().subjects).toHaveLength(0)
  })
})

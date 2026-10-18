// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankProject } from '../data/projectRuntime'
import { APP_DATA_V6_KEY } from '../data/storageV6'
import { createInitialAppDataV6, useAppDataV4 } from '../hooks/useAppDataV4'
import { AcademicSettingsV4 } from './AcademicSettingsV4'
import { LessonEditor } from './LessonEditor'

function setup() {
  let index = 0
  return createBlankProject(createInitialAppDataV6(), {
    name: '教師專案', teacherName: '林老師', academicYear: 115, semester: 'first',
    startDate: '2026-08-31', endDate: '2027-01-20',
  }, () => `setup-${++index}`, '2026-08-01T00:00:00.000Z')
}

function Harness({ readOnly = false, showLesson = false, allowMutation = false }: { readOnly?: boolean; showLesson?: boolean; allowMutation?: boolean }) {
  const [data, setData, status, , persistence] = useAppDataV4()
  return <><output data-testid="storage-status">{status}</output><output data-testid="subject-count">{data.subjects.length}</output>
    {allowMutation && <button onClick={() => setData((current) => ({ ...current, subjects: [...current.subjects, { id: 'outside-change', name: '外部新增', shortName: '外增', color: '#123456', applicableSchoolLevels: ['junior-high'] }] }))}>其他更新</button>}
    <AcademicSettingsV4 data={data} setData={setData} page="subjects" storageStatus={status} storagePersistence={persistence} readOnly={readOnly} />
    {showLesson && <LessonEditor data={data} setData={setData} onClose={vi.fn()} onSaved={vi.fn()} />}
  </>
}

function openPreview() {
  fireEvent.click(screen.getByRole('button', { name: '檢視補齊' }))
  fireEvent.click(screen.getByRole('button', { name: '產生衝突預覽' }))
}

describe('subject catalog settings and storage integration', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(setup()))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    localStorage.removeItem(APP_DATA_V6_KEY)
  })

  it('shows an explicit global preview, persists once, then exposes installed Subject IDs to LessonEditor', () => {
    render(<Harness showLesson />)
    openPreview()
    expect(screen.getByText(/新增後，其他專案也可使用/)).toBeTruthy()
    expect(screen.getByText(/可安全新增 29 筆/)).toBeTruthy()
    expect((screen.getByLabelText('班會') as HTMLInputElement).checked).toBe(false)
    expect(screen.getByLabelText('科目補齊預覽').textContent).not.toContain('班會')

    fireEvent.click(screen.getByRole('button', { name: '確認安裝安全項目（29）' }))
    expect(screen.getByTestId('subject-count').textContent).toBe('29')
    expect(screen.getByText('正在儲存預設科目…')).toBeTruthy()
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('storage-status').textContent).toBe('saved')
    expect(screen.getByText(/已儲存 29 筆預設科目/)).toBeTruthy()
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    expect(stored.subjects).toHaveLength(29)

    const input = screen.getByRole('combobox', { name: '課程科目' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '物理' } })
    const option = screen.getByRole('option', { name: /物理/ })
    fireEvent.click(option)
    expect((input as HTMLInputElement).value).toBe('物理')
    expect(stored.subjects.some((subject: { id: string; name: string }) => subject.name === '物理' && !subject.id.startsWith('core.'))).toBe(true)
  })

  it('installs optional entries only after they are explicitly selected', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '檢視補齊' }))
    fireEvent.click(screen.getByLabelText('班會'))
    fireEvent.click(screen.getByRole('button', { name: '產生衝突預覽' }))
    expect(screen.getByText(/可安全新增 30 筆/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '確認安裝安全項目（30）' }))
    act(() => vi.advanceTimersByTime(200))
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).subjects.some((subject: { name: string }) => subject.name === '班會')).toBe(true)
  })

  it('keeps review items visible while installing only safe items', () => {
    const data = setup()
    data.subjects.push({ id: 'legacy-chinese', name: '國文', shortName: '國', color: '#123456', applicableSchoolLevels: ['senior-high'] })
    localStorage.setItem(APP_DATA_V6_KEY, JSON.stringify(data))
    render(<Harness />)
    openPreview()
    expect(screen.getByText(/需人工確認 1 筆/)).toBeTruthy()
    expect(screen.getByLabelText('科目補齊預覽').textContent).toContain('既有 Subject 名稱符合 catalog 同義名稱')
    fireEvent.click(screen.getByRole('button', { name: '確認安裝安全項目（28）' }))
    act(() => vi.advanceTimersByTime(200))
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    expect(stored.subjects).toHaveLength(29)
    expect(stored.subjects.find((subject: { id: string }) => subject.id === 'legacy-chinese')).toMatchObject({ name: '國文', color: '#123456' })
    expect(stored.subjects.some((subject: { name: string }) => subject.name === '國語文')).toBe(false)
  })

  it('requires a new preview when data changes after preview', () => {
    render(<Harness allowMutation />)
    openPreview()
    fireEvent.click(screen.getByRole('button', { name: '其他更新' }))
    act(() => vi.advanceTimersByTime(200))
    fireEvent.click(screen.getByRole('button', { name: '確認安裝安全項目（29）' }))
    expect(screen.getByText(/科目庫或專案資料已變更，請重新預覽/)).toBeTruthy()
    expect(JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!).subjects).toHaveLength(1)
  })

  it('reports storage write failure without claiming success', () => {
    const original = localStorage.getItem(APP_DATA_V6_KEY)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })
    render(<Harness />)
    openPreview()
    fireEvent.click(screen.getByRole('button', { name: '確認安裝安全項目（29）' }))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('storage-status').textContent).toBe('write-error')
    expect(screen.getByText(/科目補齊寫入失敗/)).toBeTruthy()
    expect(screen.queryByText(/已儲存 29 筆/)).toBeNull()
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(original)
  })

  it('reports cross-tab conflicts and does not overwrite the external version', () => {
    const original = JSON.parse(localStorage.getItem(APP_DATA_V6_KEY)!)
    render(<Harness />)
    openPreview()
    fireEvent.click(screen.getByRole('button', { name: '確認安裝安全項目（29）' }))
    const external = { ...original, projects: original.projects.map((project: { name: string }) => ({ ...project, name: '其他分頁' })) }
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V6_KEY, externalRaw)
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: APP_DATA_V6_KEY, newValue: externalRaw, storageArea: localStorage })))
    act(() => vi.advanceTimersByTime(200))
    expect(screen.getByTestId('storage-status').textContent).toBe('conflict')
    expect(screen.getByText(/跨分頁資料衝突；本次補齊未確認儲存/)).toBeTruthy()
    expect(localStorage.getItem(APP_DATA_V6_KEY)).toBe(externalRaw)
  })

  it('blocks installation from an archived view', () => {
    render(<Harness readOnly />)
    fireEvent.click(screen.getByRole('button', { name: '檢視補齊' }))
    expect((screen.getByRole('button', { name: '產生衝突預覽' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('封存或沒有使用中專案時不可補齊。')).toBeTruthy()
  })
})

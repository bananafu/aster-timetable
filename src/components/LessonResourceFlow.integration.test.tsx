// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { initialData } from '../data/seed'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { isCompatibleAppDataV7 } from '../data/validators/v7'
import { useAppDataV4 } from '../hooks/useAppDataV4'
import type { AppDataV7 } from '../types'
import { LessonEditor } from './LessonEditor'
import { OneOffLessonEditor } from './OneOffLessonEditor'

type Mode = 'fixed' | 'one-off'
const base = (): AppDataV7 => {
  const data = migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))
  data.recurringLessons = []
  data.overrides = []
  data.oneOffLessons = []
  return data
}

function Harness({ mode }: { mode: Mode }) {
  const [data, setData, status, , persistence] = useAppDataV4()
  return <><output data-testid="storage-state">{status}</output>{mode === 'fixed'
    ? <LessonEditor data={data} setData={setData} storageStatus={status} storagePersistence={persistence} timetableId={data.timetables?.[0]?.id} onClose={vi.fn()} onSaved={vi.fn()} />
    : isCompatibleAppDataV7(data) && <OneOffLessonEditor data={data} setData={setData} storageStatus={status} storagePersistence={persistence} projectId={data.projects[0].id} timetableId={data.timetables[0].id} initialDate="2026-09-08" onSave={vi.fn()} onClose={vi.fn()} />}</>
}

function start(data: AppDataV7, mode: Mode) {
  expect(isCompatibleAppDataV7(data)).toBe(true)
  localStorage.setItem(APP_DATA_V7_KEY, JSON.stringify(data))
  render(<Harness mode={mode} />)
  if (mode === 'one-off') {
    fireEvent.change(screen.getByLabelText('學校'), { target: { value: data.schools[0].id } })
    fireEvent.change(screen.getByLabelText('學制'), { target: { value: data.teachingUnits[0].id } })
  }
}

function createClass() {
  fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
  const group = screen.getByRole('group', { name: '新增班級' })
  const number = within(group).queryByLabelText('新班級班號')
  if (number) fireEvent.change(number, { target: { value: '9' } })
  else fireEvent.change(within(group).getByLabelText('新班級名稱'), { target: { value: '新班級' } })
  fireEvent.click(within(group).getByRole('button', { name: '建立班級' }))
}

function createSubject(name = '閱讀策略') {
  fireEvent.click(screen.getByRole('button', { name: '＋ 新增科目' }))
  const group = screen.getByRole('group', { name: '新增科目' })
  fireEvent.change(within(group).getByLabelText('新科目名稱'), { target: { value: name } })
  fireEvent.click(within(group).getByRole('button', { name: '建立科目' }))
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

describe('lesson editor inline resource creation', () => {
  it.each<Mode>(['fixed', 'one-off'])('%s creates a missing class and preserves lesson fields without creating a lesson', async (mode) => {
    const data = base()
    data.classes = []
    start(data, mode)
    expect(screen.getByText('目前學制尚未建立班級')).toBeTruthy()
    if (mode === 'fixed') {
      fireEvent.change(screen.getByLabelText('課程星期'), { target: { value: '3' } })
      fireEvent.change(screen.getByLabelText('課程輪週'), { target: { value: 'B' } })
      fireEvent.change(screen.getByLabelText('課程節次'), { target: { value: String(data.teachingUnits[0].periods[1].id) } })
      fireEvent.change(screen.getByPlaceholderText('依班級預設'), { target: { value: '自訂教室' } })
    } else {
      fireEvent.change(screen.getByLabelText('教室（選填）'), { target: { value: '自訂教室' } })
      fireEvent.change(screen.getByLabelText('時間模式'), { target: { value: 'custom' } })
    }
    createClass()
    await waitFor(() => expect(screen.queryByRole('group', { name: '新增班級' })).toBeNull())
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV7
    expect(stored.classes).toHaveLength(1)
    expect(stored.recurringLessons).toEqual([])
    expect(stored.oneOffLessons).toEqual([])
    expect((screen.getByLabelText(mode === 'fixed' ? '課程班級' : '班級') as HTMLSelectElement).value).toBe(stored.classes[0].id)
    if (mode === 'fixed') {
      expect((screen.getByLabelText('課程星期') as HTMLSelectElement).value).toBe('3')
      expect((screen.getByLabelText('課程輪週') as HTMLSelectElement).value).toBe('B')
      expect((screen.getByLabelText('課程節次') as HTMLSelectElement).value).toBe(String(data.teachingUnits[0].periods[1].id))
      expect((screen.getByPlaceholderText('依班級預設') as HTMLInputElement).value).toBe('自訂教室')
    } else {
      expect((screen.getByLabelText('指定日期') as HTMLInputElement).value).toBe('2026-09-08')
      expect((screen.getByLabelText('時間模式') as HTMLSelectElement).value).toBe('custom')
      expect((screen.getByLabelText('教室（選填）') as HTMLInputElement).value).toBe('自訂教室')
    }
  })

  it.each<Mode>(['fixed', 'one-off'])('%s creates a missing subject with the current level', async (mode) => {
    const data = base()
    data.subjects = []
    start(data, mode)
    expect(screen.getByText('目前學制尚未建立科目')).toBeTruthy()
    createSubject()
    await waitFor(() => expect(screen.queryByRole('group', { name: '新增科目' })).toBeNull())
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV7
    expect(stored.subjects).toHaveLength(1)
    expect(stored.subjects[0]).toMatchObject({ name: '閱讀策略', applicableSchoolLevels: [data.teachingUnits[0].schoolLevel] })
    expect(stored.recurringLessons).toEqual([])
    expect(stored.oneOffLessons).toEqual([])
    if (mode === 'fixed') await waitFor(() => expect((screen.getByLabelText('課程科目') as HTMLInputElement).value).toBe('閱讀策略'))
    else expect((screen.getByLabelText('科目') as HTMLSelectElement).value).toBe(stored.subjects[0].id)
  })

  it.each<Mode>(['fixed', 'one-off'])('%s keeps the other empty-state entry after creating one resource', async (mode) => {
    const data = base()
    data.classes = []
    data.subjects = []
    start(data, mode)
    expect(screen.getByRole('button', { name: '＋ 新增班級' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '＋ 新增科目' })).toBeTruthy()
    createClass()
    await waitFor(() => expect(screen.queryByRole('group', { name: '新增班級' })).toBeNull())
    expect(screen.getByRole('button', { name: '＋ 新增科目' })).toBeTruthy()
    createSubject()
    await waitFor(() => expect(screen.queryByRole('group', { name: '新增科目' })).toBeNull())
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V7_KEY)!) as AppDataV7
    expect(stored.classes).toHaveLength(1)
    expect(stored.subjects).toHaveLength(1)
    expect(stored.recurringLessons).toEqual([])
    expect(stored.oneOffLessons).toEqual([])
  })

  it('cancelling inline creation leaves storage and the fixed lesson draft unchanged', () => {
    const data = base()
    data.classes = []
    start(data, 'fixed')
    fireEvent.change(screen.getByLabelText('課程星期'), { target: { value: '4' } })
    const before = localStorage.getItem(APP_DATA_V7_KEY)
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增班級' }))
    fireEvent.click(within(screen.getByRole('group', { name: '新增班級' })).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('group', { name: '新增班級' })).toBeNull()
    expect((screen.getByLabelText('課程星期') as HTMLSelectElement).value).toBe('4')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(before)
  })

  it('Escape cancels inline creation and returns keyboard focus to its trigger', () => {
    const data = base()
    data.classes = []
    start(data, 'one-off')
    const trigger = screen.getByRole('button', { name: '＋ 新增班級' })
    trigger.focus()
    fireEvent.click(trigger)
    const group = screen.getByRole('group', { name: '新增班級' })
    const input = within(group).queryByLabelText('新班級班號') ?? within(group).getByLabelText('新班級名稱')
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: '新增班級' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(JSON.stringify(data))
  })

  it('does not close or claim success when storage writes fail', async () => {
    const data = base()
    data.subjects = []
    start(data, 'one-off')
    const original = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === APP_DATA_V7_KEY) throw new Error('quota')
      return original.call(this, key, value)
    })
    createSubject()
    await waitFor(() => expect(screen.getByTestId('storage-state').textContent).toBe('write-error'))
    expect(screen.getByRole('group', { name: '新增科目' })).toBeTruthy()
    await waitFor(() => expect(within(screen.getByRole('group', { name: '新增科目' })).getByRole('alert').textContent).toContain('尚未成功寫入'))
    expect(screen.getByRole('dialog', { name: '新增單日課程' })).toBeTruthy()
    expect(screen.queryByText('已建立科目')).toBeNull()
  })

  it('keeps the fixed lesson draft on a cross-tab conflict', async () => {
    const data = base()
    data.classes = []
    start(data, 'fixed')
    fireEvent.change(screen.getByLabelText('課程星期'), { target: { value: '5' } })
    const originalRaw = localStorage.getItem(APP_DATA_V7_KEY)!
    createClass()
    const external = { ...data, migrationWarnings: ['external'] }
    const externalRaw = JSON.stringify(external)
    localStorage.setItem(APP_DATA_V7_KEY, externalRaw)
    fireEvent(window, new StorageEvent('storage', { key: APP_DATA_V7_KEY, oldValue: originalRaw, newValue: externalRaw, storageArea: localStorage }))
    await waitFor(() => expect(screen.getByTestId('storage-state').textContent).toBe('conflict'))
    expect(screen.getByRole('group', { name: '新增班級' })).toBeTruthy()
    expect((screen.getByLabelText('課程星期') as HTMLSelectElement).value).toBe('5')
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(externalRaw)
  })
})

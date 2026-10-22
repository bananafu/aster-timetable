// @vitest-environment jsdom

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AppDataV8 } from '../types'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { migrateV7ToV8 } from '../data/migrationsV8'
import { configureSubjectForTeachingUnit, createSubjectForTeachingUnit } from '../data/subjectsV8'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import { APP_DATA_V8_KEY, loadAppDataV8 } from '../data/storageV8'
import { isCompatibleAppDataV8, isSafeAppDataV8Update } from '../data/validators/v8'
import { useLocalStorage, type StorageStatus } from '../hooks/useLocalStorage'
import { TeachingUnitSubjectManagerV8 } from './TeachingUnitSubjectManagerV8'

const base = () => migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))

function fixture(): AppDataV8 {
  const data = base()
  const projectId = data.projects[0].id
  const source = data.teachingUnits[0]
  const schools = [
    { id: 'school-a', projectId, name: 'A 校', color: '#123456' },
    { id: 'school-b', projectId, name: 'B 校', color: '#654321' },
  ]
  const units = [
    { ...structuredClone(source), id: 'a-junior', schoolId: 'school-a', name: 'A 國中部', schoolLevel: 'junior-high' as const },
    { ...structuredClone(source), id: 'a-senior', schoolId: 'school-a', name: 'A 高中部', schoolLevel: 'senior-high' as const },
    { ...structuredClone(source), id: 'b-senior', schoolId: 'school-b', name: 'B 高中部', schoolLevel: 'senior-high' as const },
  ]
  const scoped = { ...data, schools: [...schools, ...data.schools], teachingUnits: [...units, ...data.teachingUnits] }
  return createSubjectForTeachingUnit(scoped, projectId, 'a-junior', {
    name: '國語文', shortName: '國語', color: '#A66D52',
    applicableSchoolLevels: ['junior-high', 'senior-high'],
  }, 'shared-chinese', 'relation-a-junior-chinese')
}

interface HarnessProps {
  initial?: AppDataV8
  failPersistence?: boolean
  onComplete?: () => void
}

function Harness({ initial = fixture(), failPersistence = false, onComplete }: HarnessProps) {
  const [data, setData] = useState(initial)
  const [status, setStatus] = useState<StorageStatus>('saved')
  const [persistence, setPersistence] = useState({ pending: false, revision: 0 })
  const ids = useRef(['new-subject', 'new-relation', 'relation-2', 'relation-3', 'relation-4'])
  const setDataWithReceipt: Dispatch<SetStateAction<AppDataV8>> = useCallback((update) => {
    setData(update)
    setPersistence((current) => ({ ...current, pending: true }))
  }, [])

  useEffect(() => {
    if (!persistence.pending) return
    if (failPersistence) {
      setStatus('write-error')
      return
    }
    const timer = window.setTimeout(() => setPersistence((current) => ({
      pending: false,
      revision: current.revision + 1,
    })), 0)
    return () => window.clearTimeout(timer)
  }, [failPersistence, persistence.pending])

  return <>
    <TeachingUnitSubjectManagerV8
      data={data}
      setData={setDataWithReceipt}
      storageStatus={status}
      storagePersistence={persistence}
      createId={() => ids.current.shift() ?? `id-${ids.current.length}`}
      onComplete={onComplete}
    />
    <output data-testid="document">{JSON.stringify(data)}</output>
  </>
}

function selectSchool(name: string) {
  fireEvent.change(screen.getByLabelText('學校'), { target: { value: name } })
}

function documentValue(): AppDataV8 {
  return JSON.parse(screen.getByTestId('document').textContent ?? '') as AppDataV8
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('TeachingUnitSubjectManagerV8', () => {
  it('updates the configured list when switching schools and school levels', () => {
    render(<Harness />)
    expect(within(screen.getByLabelText('已啟用科目')).getByText('國語文')).toBeTruthy()

    selectSchool('school-b')
    expect(within(screen.getByLabelText('已啟用科目')).queryByText('國語文')).toBeNull()
    expect(within(screen.getByLabelText('可啟用科目')).getByText('國語文')).toBeTruthy()

    selectSchool('school-a')
    fireEvent.change(screen.getByLabelText('學制'), { target: { value: 'a-senior' } })
    expect(within(screen.getByLabelText('已啟用科目')).queryByText('國語文')).toBeNull()
    expect(within(screen.getByLabelText('可啟用科目')).getByText('國語文')).toBeTruthy()
  })

  it('enables an applicable same-name Subject without confirmation and stays open', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    render(<Harness />)
    selectSchool('school-b')

    fireEvent.click(screen.getByRole('button', { name: '啟用科目「國語文」' }))

    await waitFor(() => expect(screen.getByText('已儲存：已在目前學校與學制啟用「國語文」。')).toBeTruthy())
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByLabelText('依學校與學制管理科目')).toBeTruthy()
    expect(documentValue().subjects.filter((subject) => subject.name === '國語文')).toHaveLength(1)
    expect(documentValue().teachingUnitSubjects.some((relation) => relation.teachingUnitId === 'b-senior'
      && relation.subjectId === 'shared-chinese')).toBe(true)
  })

  it('creates continuously, clears fields only after persistence, and completes with 建立', async () => {
    const onComplete = vi.fn()
    render(<Harness onComplete={onComplete} />)
    selectSchool('school-b')
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '地球科學' } })
    fireEvent.change(screen.getByLabelText('新科目簡稱'), { target: { value: '地科' } })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))

    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('地球科學')
    await waitFor(() => expect(screen.getByText('已儲存：已新增並啟用「地球科學」。')).toBeTruthy())
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('新科目簡稱') as HTMLInputElement).value).toBe('')
    expect(within(screen.getByLabelText('已啟用科目')).getByText('地球科學')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '建立' }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('removes only the current TeachingUnit configuration', async () => {
    const current = fixture()
    const projectId = current.projects[0].id
    const configured = configureSubjectForTeachingUnit(
      current, projectId, 'b-senior', 'shared-chinese', 'relation-b-senior-chinese',
    )
    render(<Harness initial={configured} />)
    selectSchool('school-b')
    fireEvent.click(screen.getByRole('button', { name: '移除科目「國語文」' }))
    await waitFor(() => expect(screen.getByText('已儲存：已從目前學校與學制移除「國語文」。')).toBeTruthy())

    expect(documentValue().teachingUnitSubjects.some((relation) => relation.teachingUnitId === 'b-senior'
      && relation.subjectId === 'shared-chinese')).toBe(false)
    expect(documentValue().teachingUnitSubjects.some((relation) => relation.teachingUnitId === 'a-junior'
      && relation.subjectId === 'shared-chinese')).toBe(true)
  })

  it('blocks referenced removal with a clear message and preserves the configuration', () => {
    const current = fixture()
    const projectId = current.projects[0].id
    const sourceLesson = current.recurringLessons[0]
    const referenced: AppDataV8 = {
      ...current,
      classes: [...current.classes, {
        id: 'class-a-junior', projectId, teachingUnitId: 'a-junior', name: '701', grade: 7, classNumber: 1,
      }],
      recurringLessons: [...current.recurringLessons, {
        ...sourceLesson,
        id: 'lesson-a-junior', seriesId: 'series-a-junior', teachingUnitId: 'a-junior',
        classId: 'class-a-junior', subjectId: 'shared-chinese',
      }],
    }
    render(<Harness initial={referenced} />)

    fireEvent.click(screen.getByRole('button', { name: '移除科目「國語文」' }))

    expect(screen.getByRole('alert').textContent).toBe('這個科目仍有課程使用，請先調整相關課程。')
    expect(documentValue().teachingUnitSubjects.some((relation) => relation.id === 'relation-a-junior-chinese')).toBe(true)
  })

  it('keeps custom input when validation fails', () => {
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '另一個科目' } })
    fireEvent.change(screen.getByLabelText('新科目簡稱'), { target: { value: '國語' } })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))

    expect(screen.getByRole('alert').textContent).toBe('已有其他科目使用相同簡稱，請修改簡稱後再試。')
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('另一個科目')
    expect((screen.getByLabelText('新科目簡稱') as HTMLInputElement).value).toBe('國語')
  })

  it('keeps custom input when persistence fails', async () => {
    render(<Harness failPersistence />)
    selectSchool('school-b')
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '地球科學' } })
    fireEvent.change(screen.getByLabelText('新科目簡稱'), { target: { value: '地科' } })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('科目資料尚未成功寫入此裝置，輸入內容已保留。'))
    expect((screen.getByLabelText('新科目名稱') as HTMLInputElement).value).toBe('地球科學')
    expect((screen.getByLabelText('新科目簡稱') as HTMLInputElement).value).toBe('地科')
    expect(screen.queryByText('已儲存：已新增並啟用「地球科學」。')).toBeNull()
  })

  it('edits shared display metadata without changing TeachingUnit configurations', async () => {
    const initial = fixture()
    const relationSnapshot = structuredClone(initial.teachingUnitSubjects)
    render(<Harness initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: '編輯科目「國語文」' }))
    fireEvent.change(screen.getByLabelText('編輯科目名稱'), { target: { value: '國語文校訂' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存科目' }))

    await waitFor(() => expect(screen.getByText('已儲存：已更新科目「國語文校訂」。')).toBeTruthy())
    expect(documentValue().subjects.find((subject) => subject.id === 'shared-chinese')?.name).toBe('國語文校訂')
    expect(documentValue().teachingUnitSubjects).toEqual(relationSnapshot)
    expect(screen.getByRole('form', { name: '新增科目表單' })).toBeTruthy()
  })

  it('asks before extending applicability and does not enable another TeachingUnit', async () => {
    const data = fixture()
    const projectId = data.projects[0].id
    const juniorOnly = createSubjectForTeachingUnit(data, projectId, 'a-junior', {
      name: '校訂閱讀', shortName: '校閱', color: '#123456', applicableSchoolLevels: ['junior-high'],
    }, 'school-reading', 'relation-a-junior-reading')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Harness initial={juniorOnly} />)
    selectSchool('school-b')
    fireEvent.change(screen.getByLabelText('新科目名稱'), { target: { value: '校訂閱讀' } })
    fireEvent.change(screen.getByLabelText('新科目簡稱'), { target: { value: '校閱' } })
    fireEvent.click(screen.getByRole('button', { name: '新增科目' }))

    await waitFor(() => expect(documentValue().subjects.find((subject) => subject.id === 'school-reading')
      ?.applicableSchoolLevels).toEqual(['junior-high', 'senior-high']))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(documentValue().teachingUnitSubjects.some((relation) => relation.teachingUnitId === 'a-senior'
      && relation.subjectId === 'school-reading')).toBe(false)
    expect(documentValue().teachingUnitSubjects.some((relation) => relation.teachingUnitId === 'b-senior'
      && relation.subjectId === 'school-reading')).toBe(true)
  })
})

function StorageHarness({ initial }: { initial: AppDataV8 }) {
  const [data, setData, status, , persistence] = useLocalStorage(APP_DATA_V8_KEY, initial, {
    validate: isCompatibleAppDataV8,
    validateUpdate: isSafeAppDataV8Update,
    legacyGuardKey: APP_DATA_V7_KEY,
    loader: (storage, _key, initialValue) => loadAppDataV8(storage, initialValue),
  })
  const ids = useRef(['storage-relation'])
  return <TeachingUnitSubjectManagerV8
    data={data}
    setData={setData}
    storageStatus={status}
    storagePersistence={persistence}
    createId={() => ids.current.shift() ?? 'unexpected-id'}
  />
}

describe('TeachingUnitSubjectManagerV8 persistence boundary', () => {
  it('writes only the V8 key and never reports success before the V8 receipt', async () => {
    const initial = fixture()
    const legacyRaw = 'legacy-v7-sentinel'
    localStorage.setItem(APP_DATA_V8_KEY, JSON.stringify(initial))
    localStorage.setItem(APP_DATA_V7_KEY, legacyRaw)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<StorageHarness initial={initial} />)
    selectSchool('school-b')

    fireEvent.click(screen.getByRole('button', { name: '啟用科目「國語文」' }))
    expect(screen.queryByText('已儲存：已在目前學校與學制啟用「國語文」。')).toBeNull()

    await waitFor(() => expect(screen.getByText('已儲存：已在目前學校與學制啟用「國語文」。')).toBeTruthy())
    expect(setItem.mock.calls.some(([key]) => key === APP_DATA_V7_KEY)).toBe(false)
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe(legacyRaw)
    const stored = JSON.parse(localStorage.getItem(APP_DATA_V8_KEY)!) as AppDataV8
    expect(stored.teachingUnitSubjects.some((relation) => relation.teachingUnitId === 'b-senior'
      && relation.subjectId === 'shared-chinese')).toBe(true)
  })
})

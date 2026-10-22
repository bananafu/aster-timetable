// @vitest-environment jsdom

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppDataV7, AppDataV8, CalendarEventV4 } from '../types'
import { initialData } from '../data/seed'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { migrateV7ToV8 } from '../data/migrationsV8'
import { selectResolvedEventsForTimetable } from '../data/eventSelectorsV8'
import { APP_DATA_V7_KEY } from '../data/storageV7'
import type { StorageStatus } from '../hooks/useLocalStorage'
import { EventRepairManagerV8 } from './EventRepairManagerV8'

const legacy = () => migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData)))))

function eventFor(data: AppDataV7): CalendarEventV4 {
  const project = data.projects[0]
  const unit = data.teachingUnits.find((item) => item.projectId === project.id)!
  return {
    id: 'repair-event', projectId: project.id, teachingUnitId: unit.id,
    title: '教學研究會', type: 'meeting', date: unit.startDate,
    startTime: '09:00', endTime: '10:00', location: '會議室',
    notes: '討論課程內容', color: '#123456', origin: 'user',
  }
}

function fixture(withTimetables = true): AppDataV8 {
  const data = legacy()
  data.events = [eventFor(data)]
  if (withTimetables) {
    const first = data.timetables[0]
    data.timetables.push({
      ...first, id: 'teacher-b', name: '王老師課表', teacherName: '王老師', teacherNamePending: undefined,
    })
  } else {
    data.timetables = []
    data.recurringLessons = []
    data.overrides = []
    data.oneOffLessons = []
  }
  return migrateV7ToV8(data)
}

function Harness({ fail = false, stale = false, initial = fixture() }: {
  fail?: boolean
  stale?: boolean
  initial?: AppDataV8
}) {
  const [data, setData] = useState(initial)
  const [status, setStatus] = useState<StorageStatus>('saved')
  const [persistence, setPersistence] = useState({ pending: false, revision: 0 })
  const setDataWithReceipt: Dispatch<SetStateAction<AppDataV8>> = useCallback((update) => {
    setData(update)
    setPersistence((current) => ({ ...current, pending: true }))
  }, [])

  useEffect(() => {
    if (!persistence.pending) return
    if (fail) {
      setStatus('write-error')
      return
    }
    if (stale) {
      setData((current) => ({
        ...current,
        projects: current.projects.map((project, index) => index === 0
          ? { ...project, name: `${project.name}（其他分頁）` }
          : project),
      }))
      setPersistence((current) => ({ ...current, pending: false }))
      return
    }
    const timer = window.setTimeout(() => setPersistence((current) => ({
      pending: false,
      revision: current.revision + 1,
    })), 0)
    return () => window.clearTimeout(timer)
  }, [fail, persistence.pending, stale])

  return <>
    <EventRepairManagerV8
      data={data}
      setData={setDataWithReceipt}
      storageStatus={status}
      storagePersistence={persistence}
    />
    <output data-testid="document">{JSON.stringify(data)}</output>
  </>
}

const documentValue = () => JSON.parse(screen.getByTestId('document').textContent ?? '') as AppDataV8
const timetableSelect = () => screen.getByLabelText('事件「教學研究會」所屬課表') as HTMLSelectElement

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('EventRepairManagerV8', () => {
  it('shows pending Event details and never preselects the first Timetable', () => {
    render(<Harness />)

    expect(screen.getByLabelText('待確認事件 1 筆')).toBeTruthy()
    expect(screen.getByText('教學研究會')).toBeTruthy()
    expect(screen.getByText('地點：會議室')).toBeTruthy()
    expect(screen.getByText('內容：討論課程內容')).toBeTruthy()
    expect(screen.getByText('專案中有多份教師課表，需要確認所屬老師。')).toBeTruthy()
    expect(timetableSelect().value).toBe('')
    expect(screen.getByRole('button', { name: '確認歸屬' })).toHaveProperty('disabled', true)
  })

  it('removes the Event only after a persistence receipt and exposes it only to the selected teacher', async () => {
    localStorage.setItem(APP_DATA_V7_KEY, 'preserve-v7')
    render(<Harness />)
    fireEvent.change(timetableSelect(), { target: { value: 'teacher-b' } })
    fireEvent.click(screen.getByRole('button', { name: '確認歸屬' }))

    expect(screen.getByText('教學研究會')).toBeTruthy()
    expect(screen.queryByText(/已儲存事件/)).toBeNull()
    await waitFor(() => expect(screen.getByText('已儲存事件「教學研究會」的課表歸屬。')).toBeTruthy())
    expect(screen.getByText('目前沒有待確認的事件。')).toBeTruthy()

    const data = documentValue()
    expect(selectResolvedEventsForTimetable(data, data.projects[0].id, 'teacher-b').map((item) => item.id)).toEqual(['repair-event'])
    expect(selectResolvedEventsForTimetable(data, data.projects[0].id, data.timetables[0].id)).toEqual([])
    expect(localStorage.getItem(APP_DATA_V7_KEY)).toBe('preserve-v7')
  })

  it('keeps the Event and selected Timetable visible when persistence fails', async () => {
    render(<Harness fail />)
    fireEvent.change(timetableSelect(), { target: { value: 'teacher-b' } })
    fireEvent.click(screen.getByRole('button', { name: '確認歸屬' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('尚未成功寫入'))
    expect(screen.getByText('教學研究會')).toBeTruthy()
    expect(timetableSelect().value).toBe('teacher-b')
    expect(screen.queryByText(/已儲存事件/)).toBeNull()
  })

  it('does not overwrite stale data and retains the selection for review', async () => {
    render(<Harness stale />)
    fireEvent.change(timetableSelect(), { target: { value: 'teacher-b' } })
    fireEvent.click(screen.getByRole('button', { name: '確認歸屬' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('儲存期間已變更'))
    expect(screen.getByText('教學研究會')).toBeTruthy()
    expect(timetableSelect().value).toBe('teacher-b')
    expect(screen.queryByText(/已儲存事件/)).toBeNull()
    expect(documentValue().projects[0].name).toContain('其他分頁')
  })

  it('shows a clear blocker when no legal Timetable exists', () => {
    render(<Harness initial={fixture(false)} />)

    expect(screen.getByText('這個專案目前沒有可用的教師課表，請先建立課表後再確認。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '確認歸屬' })).toHaveProperty('disabled', true)
  })
})

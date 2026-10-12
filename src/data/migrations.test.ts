import { describe, expect, it } from 'vitest'
import { initialData } from './seed'
import { clearDemoRecords, migrateAppData } from './migrations'
import type { AppData } from '../types'

describe('demo data migration and clearing', () => {
  it('only tags exact legacy seed matches', () => {
    const legacy = JSON.parse(JSON.stringify(initialData)) as AppData
    legacy.subjects = legacy.subjects.map((subject) => ({ id: subject.id, name: subject.name, shortName: subject.shortName, color: subject.color }))
    legacy.subjects[0].color = '#123456'
    const migrated = migrateAppData(legacy)
    expect(migrated.subjects[0].origin).toBeUndefined()
    expect(migrated.subjects[1].origin).toBe('demo')
  })

  it('clears marked demo records but preserves user records and their dependencies', () => {
    const data = {
      ...initialData,
      courses: [...initialData.courses, { id: 'user-course', subjectId: 'chinese', classId: '201', day: 2 as const, periodId: 8, weekPattern: 'every' as const, origin: 'user' as const }],
      events: [...initialData.events, { id: 'user-event', title: '我的會議', type: 'meeting' as const, date: '2026-10-01', startTime: '10:00', endTime: '11:00', color: '#000', origin: 'user' as const }],
    }
    const cleared = clearDemoRecords(data)
    expect(cleared.courses.map((course) => course.id)).toEqual(['user-course'])
    expect(cleared.events.map((event) => event.id)).toEqual(['user-event'])
    expect(cleared.subjects.some((subject) => subject.id === 'chinese')).toBe(true)
    expect(cleared.classes.some((schoolClass) => schoolClass.id === '201')).toBe(true)
    expect(cleared.subjects.some((subject) => subject.id === 'history')).toBe(false)
  })

  it('preserves a demo subject after it is formally changed to user data', () => {
    const changed = {
      ...initialData,
      subjects: initialData.subjects.map((subject) => subject.id === 'chinese' ? { ...subject, color: '#123456', origin: 'user' as const } : subject),
    }
    const cleared = clearDemoRecords(changed)
    expect(cleared.subjects.find((subject) => subject.id === 'chinese')).toMatchObject({ color: '#123456', origin: 'user' })
  })
})

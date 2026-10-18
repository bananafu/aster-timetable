import { describe, expect, it } from 'vitest'
import type { AppData } from '../types'
import { initialData } from './seed'
import { isAppData, type LegacyAppDataV1 } from './migrations'
import { migrateV1ToV4, migrateV3ToV4 } from './migrationsV4'
import { isAppDataV4 } from './validators/v4'

const copyV3 = (): AppData => structuredClone(initialData)

function legacyData(): LegacyAppDataV1 {
  const source = copyV3()
  return {
    subjects: source.subjects,
    classes: source.classes,
    periods: source.academicTerms[0].periods.map(({ id, label, startTime, endTime }) => ({ id, label, startTime, endTime })),
    courses: source.courses.map((course) => ({ id: course.id, subjectId: course.subjectId, classId: course.classId, day: course.day, periodId: course.periodId, weekPattern: course.weekPattern, room: course.room, origin: course.origin })),
    events: [{ id: 'legacy-event', title: '舊活動', type: 'activity', date: source.academicTerms[0].startDate, startTime: '10:00', endTime: '11:00', color: '#563F2E' }],
    overrides: [{ id: 'legacy-override', date: source.academicTerms[0].startDate, periodId: 1, action: 'cancel', originalCourseId: source.courses[0].id }],
    semester: { name: source.academicTerms[0].name, startDate: source.academicTerms[0].startDate, endDate: source.academicTerms[0].endDate, firstWeekPattern: 'A' },
  }
}

describe('v3 → v4 migration', () => {
  it('保留所有主要實體內容並建立正確歸屬', () => {
    const source = copyV3()
    source.events.push({ id: 'event-safe', termId: source.activeTermId, title: '會議', type: 'meeting', date: source.academicTerms[0].startDate, startTime: '09:00', endTime: '10:00', color: '#563F2E' })
    source.overrides.push({ id: 'override-safe', termId: source.activeTermId, date: source.academicTerms[0].startDate, periodId: 1, action: 'cancel', originalCourseId: source.courses[0].id })
    expect(isAppData(source)).toBe(true)

    const result = migrateV3ToV4(source)
    expect(isAppDataV4(result)).toBe(true)
    expect(result.projects).toHaveLength(source.academicTerms.length)
    expect(result.schools).toHaveLength(source.academicTerms.length)
    expect(result.teachingUnits).toHaveLength(source.academicTerms.length)
    expect(result.subjects).toEqual(source.subjects)
    expect(result.recurringLessons.map((item) => item.id)).toEqual(source.courses.map((item) => item.id))
    expect(result.events.map((item) => item.id)).toEqual(source.events.map((item) => item.id))
    expect(result.overrides.map((item) => item.id)).toEqual(source.overrides.map((item) => item.id))
    source.courses.forEach((course) => expect(result.recurringLessons.find((item) => item.id === course.id)).toMatchObject({
      subjectId: course.subjectId, day: course.day, periodId: course.periodId, weekPattern: course.weekPattern, room: course.room, origin: course.origin,
    }))
    expect(result.classes).toHaveLength(source.classes.length * source.academicTerms.length)
    expect(result.classes.map(({ name, room, origin }) => ({ name, room, origin }))).toEqual(source.classes.map(({ name, room, origin }) => ({ name, room, origin })))
  })

  it('每個 AcademicTerm 建立獨立 project 並正確映射 active 與 archived 狀態', () => {
    const source = copyV3()
    const first = source.academicTerms[0]
    first.archivedAt = '2027-02-01T00:00:00.000Z'
    const second = { ...structuredClone(first), id: 'term-2027-2', name: '115 學年度第二學期', startDate: '2027-02-10', endDate: '2027-06-30', archivedAt: undefined, createdAt: '2027-02-01T00:00:00.000Z' }
    source.academicTerms.push(second)
    source.activeTermId = second.id
    const result = migrateV3ToV4(source)
    expect(result.projects).toHaveLength(2)
    expect(result.projects[0].archivedAt).toBe(first.archivedAt)
    expect(result.projects.find((item) => item.id === result.activeProjectId)?.archivedAt).toBeUndefined()
  })

  it('使用既有 project name；沒有時採用已確認的 fallback 且不使用 UI 品牌', () => {
    const source = copyV3() as AppData & { projectName?: string }
    expect(migrateV3ToV4(source).projects[0].name).toBe(`原有課表・${source.academicTerms[0].name}`)
    source.projectName = 'Shibanana Fuの課表'
    expect(migrateV3ToV4(source).projects[0].name).toBe('Shibanana Fuの課表')
  })

  it('保留未歸屬事件與異動並產生警告，但不讓它們參與 project 排課', () => {
    const source = copyV3()
    source.events.push({ id: 'orphan-event', termId: null, title: '未分類活動', type: 'activity', date: '2027-03-01', startTime: '09:00', endTime: '10:00', color: '#563F2E' })
    source.overrides.push({ id: 'orphan-override', termId: null, date: '2027-03-01', periodId: 1, action: 'cancel', originalCourseId: 'unknown' })
    const result = migrateV3ToV4(source)
    expect(result.events.find((item) => item.id === 'orphan-event')).toMatchObject({ projectId: null, teachingUnitId: null })
    expect(result.overrides.find((item) => item.id === 'orphan-override')).toMatchObject({ projectId: null, teachingUnitId: null, originalLessonId: 'unknown' })
    expect(result.migrationWarnings.filter((item) => ['orphan-event', 'orphan-override'].includes(item.entityId))).toHaveLength(2)
  })

  it('將無法驗證節次或 replacement 引用的異動安全降級為未歸屬資料', () => {
    const source = copyV3()
    source.overrides.push({ id: 'unsafe-replacement', termId: source.activeTermId, date: source.academicTerms[0].startDate, periodId: 999, action: 'replace', replacement: { subjectId: 'missing', classId: 'missing' } })
    const result = migrateV3ToV4(source)
    expect(result.overrides.find((item) => item.id === 'unsafe-replacement')).toMatchObject({
      projectId: null, teachingUnitId: null, periodId: 999, replacement: { subjectId: 'missing', classId: 'missing' },
    })
    expect(result.migrationWarnings.some((item) => item.entityId === 'unsafe-replacement')).toBe(true)
  })

  it('結果可重複預測且不修改 v3 輸入', () => {
    const source = copyV3()
    const original = structuredClone(source)
    expect(migrateV3ToV4(source)).toEqual(migrateV3ToV4(source))
    expect(source).toEqual(original)
  })
})

describe('v1 → v3 → v4 migration', () => {
  it('透過既有安全 v3 migration 保留 v1 實體', () => {
    const source = legacyData()
    const result = migrateV1ToV4(source)
    expect(isAppDataV4(result)).toBe(true)
    expect(result.subjects.map((item) => item.id)).toEqual(source.subjects.map((item) => item.id))
    expect(result.recurringLessons.map((item) => item.id)).toEqual(source.courses.map((item) => item.id))
    expect(result.events.map((item) => item.id)).toEqual(source.events.map((item) => item.id))
    expect(result.overrides.map((item) => item.id)).toEqual(source.overrides.map((item) => item.id))
  })
})

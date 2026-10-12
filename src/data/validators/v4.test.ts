import { describe, expect, it } from 'vitest'
import type { AppDataV4 } from '../../types'
import { isAppDataV4 } from './v4'

const validData = (): AppDataV4 => ({
  schemaVersion: 4,
  activeProjectId: 'project-1',
  projects: [{ id: 'project-1', name: '原有課表・115 學年度第一學期', term: { academicYear: 115, semester: 'first' }, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }],
  schools: [{ id: 'school-1', projectId: 'project-1', name: '第一所學校', color: '#A5A051' }],
  teachingUnits: [{ id: 'unit-1', projectId: 'project-1', schoolId: 'school-1', name: '日間部', schoolLevel: 'senior-high', startDate: '2026-08-31', endDate: '2027-01-20', timezone: 'Asia/Taipei', periods: [{ id: 10, order: 1, label: '第一節', startTime: '08:10', endTime: '09:00' }], weekCycle: { enabled: true, anchorDate: '2026-09-02', anchorPattern: 'A' } }],
  subjects: [{ id: 'subject-1', name: '國文', shortName: '國', color: '#956C58' }],
  classes: [{ id: 'class-1', projectId: 'project-1', teachingUnitId: 'unit-1', name: '一年一班' }],
  recurringLessons: [{ id: 'lesson-v1', seriesId: 'lesson-series', projectId: 'project-1', teachingUnitId: 'unit-1', subjectId: 'subject-1', classId: 'class-1', day: 1, periodId: 10, weekPattern: 'A', effectiveStart: '2026-08-31', effectiveEnd: '2026-10-04' }, { id: 'lesson-v2', seriesId: 'lesson-series', projectId: 'project-1', teachingUnitId: 'unit-1', subjectId: 'subject-1', classId: 'class-1', day: 2, periodId: 10, weekPattern: 'A', effectiveStart: '2026-10-05' }],
  events: [{ id: 'event-1', projectId: null, title: '跨校活動', type: 'activity', date: '2026-10-10', startTime: '10:00', endTime: '11:00', color: '#563F2E' }],
  overrides: [{ id: 'override-1', projectId: 'project-1', teachingUnitId: 'unit-1', date: '2026-09-07', periodId: 10, action: 'cancel', originalLessonId: 'lesson-v1' }, { id: 'orphan', projectId: null, teachingUnitId: null, date: '2027-03-01', periodId: 10, action: 'cancel' }],
  migrationWarnings: [{ id: 'warning-1', entityType: 'override', entityId: 'orphan', message: '無法安全歸屬' }],
})

describe('AppData v4 validator', () => {
  it('接受多專案架構的有效資料及未歸屬事件與異動', () => expect(isAppDataV4(validData())).toBe(true))

  it('允許相同學年度與學期存在不同名稱的專案', () => {
    const data = validData()
    data.projects.push({ ...data.projects[0], id: 'project-2', name: '另一份課表' })
    expect(isAppDataV4(data)).toBe(true)
  })

  it('結構缺漏或型別錯誤時回傳 false 而不拋出例外', () => {
    expect(() => isAppDataV4({ schemaVersion: 4, projects: [{ id: 'broken' }] })).not.toThrow()
    expect(isAppDataV4({ schemaVersion: 4, projects: [{ id: 'broken' }] })).toBe(false)
  })

  it('拒絕重複 ID 及無效 activeProjectId', () => {
    const duplicate = validData(); duplicate.schools.push({ ...duplicate.schools[0] })
    expect(isAppDataV4(duplicate)).toBe(false)
    expect(isAppDataV4({ ...validData(), activeProjectId: 'missing' })).toBe(false)
  })

  it('拒絕跨 project 的 school、unit、class 與 lesson 引用', () => {
    const data = validData(); data.classes[0] = { ...data.classes[0], projectId: 'other' }
    expect(isAppDataV4(data)).toBe(false)
  })

  it('拒絕重複節次 ID、order 及重疊時間', () => {
    const duplicate = validData(); duplicate.teachingUnits[0].periods.push({ id: 10, order: 2, label: '第二節', startTime: '09:10', endTime: '10:00' })
    expect(isAppDataV4(duplicate)).toBe(false)
    const overlap = validData(); overlap.teachingUnits[0].periods.push({ id: 20, order: 2, label: '第二節', startTime: '08:50', endTime: '09:40' })
    expect(isAppDataV4(overlap)).toBe(false)
  })

  it('拒絕停用輪週後仍存在 A/B 課程', () => {
    const data = validData(); data.teachingUnits[0].weekCycle.enabled = false
    expect(isAppDataV4(data)).toBe(false)
  })

  it('拒絕課程有效期間超出 teaching unit 或版本重疊', () => {
    const outside = validData(); outside.recurringLessons[0].effectiveStart = '2026-08-30'
    expect(isAppDataV4(outside)).toBe(false)
    const overlap = validData(); overlap.recurringLessons[0].effectiveEnd = '2026-10-05'
    expect(isAppDataV4(overlap)).toBe(false)
    const gap = validData(); gap.recurringLessons[1].effectiveStart = '2026-10-06'
    expect(isAppDataV4(gap)).toBe(false)
  })

  it('允許相鄰節次與相鄰課程版本邊界', () => {
    const data = validData(); data.teachingUnits[0].periods.push({ id: 20, order: 2, label: '第二節', startTime: '09:00', endTime: '09:50' })
    expect(isAppDataV4(data)).toBe(true)
  })

  it('拒絕無效日期、時間及 replacement 引用', () => {
    const badTime = validData(); badTime.events[0].endTime = '09:00'
    expect(isAppDataV4(badTime)).toBe(false)
    const badReplacement = validData(); badReplacement.overrides[0] = { ...badReplacement.overrides[0], action: 'replace', replacement: { subjectId: 'missing', classId: 'class-1' } }
    expect(isAppDataV4(badReplacement)).toBe(false)
    const badOrphan = validData(); badOrphan.overrides[1].action = 'unknown' as 'cancel'
    expect(isAppDataV4(badOrphan)).toBe(false)
  })
})

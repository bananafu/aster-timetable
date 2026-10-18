import { describe, expect, it } from 'vitest'
import type { AppDataV4 } from '../../types'
import { isAppDataV4, isCompatibleAppDataV4, isSafeAppDataV4Update } from './v4'

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

  it('相容讀取只放寬既有節次的時間粒度，不放寬時間格式或範圍', () => {
    const legacy = validData(); legacy.teachingUnits[0].periods[0].startTime = '08:03'
    expect(isAppDataV4(legacy)).toBe(false)
    expect(isCompatibleAppDataV4(legacy)).toBe(true)
    const brokenFormat = validData(); brokenFormat.teachingUnits[0].periods[0].startTime = '8:03'
    expect(isCompatibleAppDataV4(brokenFormat)).toBe(false)
    const brokenRange = validData(); brokenRange.teachingUnits[0].periods[0].endTime = '08:00'
    expect(isCompatibleAppDataV4(brokenRange)).toBe(false)
  })

  it('安全更新只保留相同 project、unit、period 的既有異常時間', () => {
    const current = validData(); current.teachingUnits[0].periods.push({ id: 20, order: 2, label: '舊第二節', startTime: '09:03', endTime: '09:58' })
    const unrelated = structuredClone(current); unrelated.projects[0].name = '更新名稱'
    expect(isSafeAppDataV4Update(current, unrelated)).toBe(true)

    const added = structuredClone(current); added.teachingUnits[0].periods.push({ id: 30, order: 3, label: '第三節', startTime: '10:03', endTime: '10:58' })
    expect(isSafeAppDataV4Update(current, added)).toBe(false)

    const changedLegacy = structuredClone(current); changedLegacy.teachingUnits[0].periods[1].startTime = '09:04'
    expect(isSafeAppDataV4Update(current, changedLegacy)).toBe(false)

    const valid = validData(); const changedValid = structuredClone(valid); changedValid.teachingUnits[0].periods[0].startTime = '08:03'
    expect(isSafeAppDataV4Update(valid, changedValid)).toBe(false)

    const removed = structuredClone(current); removed.teachingUnits[0].periods = removed.teachingUnits[0].periods.filter((period) => period.id !== 20)
    expect(isSafeAppDataV4Update(current, removed)).toBe(true)
    expect(isSafeAppDataV4Update(removed, current)).toBe(false)
  })

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

  it('接受舊 name-only 班級並驗證結構化班級的年級、班號及唯一性', () => {
    const legacy = validData()
    expect(isAppDataV4(legacy)).toBe(true)
    const structured = validData()
    structured.classes[0] = { ...structured.classes[0], name: '103', grade: 1, classNumber: 3 }
    expect(isAppDataV4(structured)).toBe(true)
    structured.classes.push({ ...structured.classes[0], id: 'duplicate-class' })
    expect(isAppDataV4(structured)).toBe(false)
    const invalidGrade = validData()
    invalidGrade.classes[0] = { ...invalidGrade.classes[0], name: '703', grade: 7, classNumber: 3 }
    expect(isAppDataV4(invalidGrade)).toBe(false)
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

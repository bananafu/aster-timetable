import type { AppData, SchoolPeriod } from '../types'

export const defaultPeriods: SchoolPeriod[] = [
  { id: 1, order: 1, label: '第 1 節', startTime: '08:10', endTime: '09:00' },
  { id: 2, order: 2, label: '第 2 節', startTime: '09:10', endTime: '10:00' },
  { id: 3, order: 3, label: '第 3 節', startTime: '10:10', endTime: '11:00' },
  { id: 4, order: 4, label: '第 4 節', startTime: '11:10', endTime: '12:00' },
  { id: 5, order: 5, label: '第 5 節', startTime: '13:10', endTime: '14:00' },
  { id: 6, order: 6, label: '第 6 節', startTime: '14:10', endTime: '15:00' },
  { id: 7, order: 7, label: '第 7 節', startTime: '15:10', endTime: '16:00' },
  { id: 8, order: 8, label: '第 8 節', startTime: '16:10', endTime: '17:00' },
]

const termId = 'term-2026-1'

export const initialData: AppData = {
  schemaVersion: 3,
  school: { id: 'primary-school', name: '我的學校', timezone: 'Asia/Taipei', defaultPeriods },
  academicTerms: [{
    id: termId,
    name: '115 學年度第一學期',
    startDate: '2026-08-31',
    endDate: '2027-01-20',
    weekCycle: { enabled: true, anchorDate: '2026-08-31', anchorPattern: 'A' },
    periods: defaultPeriods.map((period) => ({ ...period })),
    createdAt: '2026-08-31T00:00:00.000Z',
  }],
  activeTermId: termId,
  subjects: [
    { id: 'chinese', name: '國文', shortName: '國', color: '#A66D52', origin: 'demo' },
    { id: 'history', name: '歷史', shortName: '歷', color: '#718B6C', origin: 'demo' },
    { id: 'civics', name: '公民與社會', shortName: '公', color: '#6C8299', origin: 'demo' },
    { id: 'reading', name: '閱讀素養', shortName: '閱', color: '#9B7C9D', origin: 'demo' },
  ],
  classes: [
    { id: '201', name: '二年 1 班', room: '201 教室', origin: 'demo' },
    { id: '203', name: '二年 3 班', room: '203 教室', origin: 'demo' },
    { id: '105', name: '一年 5 班', room: '105 教室', origin: 'demo' },
    { id: 'club', name: '校刊社', room: '圖書館', origin: 'demo' },
  ],
  courses: [
    { id: 'c1', termId, subjectId: 'chinese', classId: '201', day: 1, periodId: 1, weekPattern: 'every', origin: 'demo' },
    { id: 'c2', termId, subjectId: 'history', classId: '203', day: 1, periodId: 3, weekPattern: 'every', origin: 'demo' },
    { id: 'c3', termId, subjectId: 'civics', classId: '105', day: 1, periodId: 6, weekPattern: 'A', origin: 'demo' },
    { id: 'c4', termId, subjectId: 'reading', classId: 'club', day: 1, periodId: 6, weekPattern: 'B', origin: 'demo' },
    { id: 'c5', termId, subjectId: 'chinese', classId: '203', day: 2, periodId: 2, weekPattern: 'every', origin: 'demo' },
    { id: 'c6', termId, subjectId: 'history', classId: '201', day: 2, periodId: 5, weekPattern: 'every', origin: 'demo' },
    { id: 'c7', termId, subjectId: 'reading', classId: 'club', day: 2, periodId: 7, weekPattern: 'every', origin: 'demo' },
    { id: 'c8', termId, subjectId: 'civics', classId: '105', day: 3, periodId: 1, weekPattern: 'every', origin: 'demo' },
    { id: 'c9', termId, subjectId: 'chinese', classId: '201', day: 3, periodId: 4, weekPattern: 'every', origin: 'demo' },
    { id: 'c10', termId, subjectId: 'history', classId: '203', day: 3, periodId: 6, weekPattern: 'every', origin: 'demo' },
    { id: 'c11', termId, subjectId: 'history', classId: '201', day: 4, periodId: 2, weekPattern: 'every', origin: 'demo' },
    { id: 'c12', termId, subjectId: 'chinese', classId: '203', day: 4, periodId: 5, weekPattern: 'every', origin: 'demo' },
    { id: 'c13', termId, subjectId: 'reading', classId: 'club', day: 4, periodId: 7, weekPattern: 'A', origin: 'demo' },
    { id: 'c14', termId, subjectId: 'civics', classId: '105', day: 5, periodId: 1, weekPattern: 'every', origin: 'demo' },
    { id: 'c15', termId, subjectId: 'chinese', classId: '201', day: 5, periodId: 3, weekPattern: 'every', origin: 'demo' },
  ],
  events: [],
  overrides: [],
  migrationWarnings: [],
}

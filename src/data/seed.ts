import type { AppData } from '../types'

const today = new Date()
const monday = new Date(today)
const day = today.getDay()
monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
const toDateKey = (date: Date) => date.toLocaleDateString('sv-SE')
const dateAt = (offset: number) => {
  const date = new Date(monday)
  date.setDate(monday.getDate() + offset)
  return toDateKey(date)
}

export const initialData: AppData = {
  semester: {
    name: '115 學年度第一學期',
    startDate: '2026-08-31',
    endDate: '2027-01-20',
    firstWeekPattern: 'A',
  },
  periods: [
    { id: 1, label: '第 1 節', startTime: '08:10', endTime: '09:00' },
    { id: 2, label: '第 2 節', startTime: '09:10', endTime: '10:00' },
    { id: 3, label: '第 3 節', startTime: '10:10', endTime: '11:00' },
    { id: 4, label: '第 4 節', startTime: '11:10', endTime: '12:00' },
    { id: 5, label: '第 5 節', startTime: '13:10', endTime: '14:00' },
    { id: 6, label: '第 6 節', startTime: '14:10', endTime: '15:00' },
    { id: 7, label: '第 7 節', startTime: '15:10', endTime: '16:00' },
    { id: 8, label: '第 8 節', startTime: '16:10', endTime: '17:00' },
  ],
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
    { id: 'c1', subjectId: 'chinese', classId: '201', day: 1, periodId: 1, weekPattern: 'every', origin: 'demo' },
    { id: 'c2', subjectId: 'history', classId: '203', day: 1, periodId: 3, weekPattern: 'every', origin: 'demo' },
    { id: 'c3', subjectId: 'civics', classId: '105', day: 1, periodId: 6, weekPattern: 'A', origin: 'demo' },
    { id: 'c4', subjectId: 'reading', classId: 'club', day: 1, periodId: 6, weekPattern: 'B', origin: 'demo' },
    { id: 'c5', subjectId: 'chinese', classId: '203', day: 2, periodId: 2, weekPattern: 'every', origin: 'demo' },
    { id: 'c6', subjectId: 'history', classId: '201', day: 2, periodId: 5, weekPattern: 'every', origin: 'demo' },
    { id: 'c7', subjectId: 'reading', classId: 'club', day: 2, periodId: 7, weekPattern: 'every', origin: 'demo' },
    { id: 'c8', subjectId: 'civics', classId: '105', day: 3, periodId: 1, weekPattern: 'every', origin: 'demo' },
    { id: 'c9', subjectId: 'chinese', classId: '201', day: 3, periodId: 4, weekPattern: 'every', origin: 'demo' },
    { id: 'c10', subjectId: 'history', classId: '203', day: 3, periodId: 6, weekPattern: 'every', origin: 'demo' },
    { id: 'c11', subjectId: 'history', classId: '201', day: 4, periodId: 2, weekPattern: 'every', origin: 'demo' },
    { id: 'c12', subjectId: 'chinese', classId: '203', day: 4, periodId: 5, weekPattern: 'every', origin: 'demo' },
    { id: 'c13', subjectId: 'reading', classId: 'club', day: 4, periodId: 7, weekPattern: 'A', origin: 'demo' },
    { id: 'c14', subjectId: 'civics', classId: '105', day: 5, periodId: 1, weekPattern: 'every', origin: 'demo' },
    { id: 'c15', subjectId: 'chinese', classId: '201', day: 5, periodId: 3, weekPattern: 'every', origin: 'demo' },
  ],
  events: [
    { id: 'e1', title: '國文科教學研究會', type: 'meeting', date: dateAt(1), startTime: '12:20', endTime: '13:00', location: '會議室二', color: '#6C8299', origin: 'demo' },
    { id: 'e2', title: '校慶籌備會議', type: 'meeting', date: dateAt(3), startTime: '16:10', endTime: '17:00', location: '行政大樓', color: '#A66D52', origin: 'demo' },
  ],
  overrides: [],
}

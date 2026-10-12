import { describe, expect, it } from 'vitest'
import { initialData } from '../data/seed'
import type { AppData, CalendarEvent, Course } from '../types'
import { canDisableWeekCycle, classifyEventTerm, getSafeOverrideTerm, getTermForDate, reclassifyEvents, validatePeriods } from './academic'
import { getWeekInfo } from './date'
import { findCourseConflict, getNextUpcomingEvent, getTodayTeachingSummary, resolveSlot } from './schedule'
import { getDayPeriods, hasUniformWeekStructure } from './weekLayout'
import { addDays, startOfWeek } from './date'

const term = initialData.academicTerms[0]

describe('A/B 週計算', () => {
  it('正規化任意基準日並支援跨月、跨年與負週差', () => {
    const anchored = { ...term, weekCycle: { enabled: true, anchorDate: '2027-01-01', anchorPattern: 'B' as const } }
    expect(getWeekInfo(new Date(2027,0,1), anchored).pattern).toBe('B')
    expect(getWeekInfo(new Date(2027,0,4), anchored).pattern).toBe('A')
    expect(getWeekInfo(new Date(2026,11,21), anchored).pattern).toBe('A')
  })
  it('停用輪週時不產生週型，且有 A/B 課程時不可停用', () => {
    expect(getWeekInfo(new Date(2026,8,1), { ...term, weekCycle: { ...term.weekCycle, enabled:false } }).pattern).toBeNull()
    expect(canDisableWeekCycle(term.id, initialData.courses)).toBe(false)
  })
})

describe('學期隔離、衝突與單日異動', () => {
  const base: Course = { id:'base',termId:term.id,subjectId:'chinese',classId:'201',day:1,periodId:1,weekPattern:'A' }
  it('A/B 可共用，同學期 EVERY 衝突，不同學期不衝突，編輯排除自身', () => {
    expect(findCourseConflict([base],{termId:term.id,day:1,periodId:1,weekPattern:'B'})).toBeUndefined()
    expect(findCourseConflict([base],{termId:term.id,day:1,periodId:1,weekPattern:'every'})?.id).toBe('base')
    expect(findCourseConflict([base],{termId:'other',day:1,periodId:1,weekPattern:'A'})).toBeUndefined()
    expect(findCourseConflict([base],{termId:term.id,day:1,periodId:1,weekPattern:'A'},'base')).toBeUndefined()
  })
  it('調課與取消只作用指定日期且不改固定課程', () => {
    const replaced: AppData={...initialData,overrides:[{id:'o',termId:term.id,date:'2026-08-31',periodId:1,action:'replace',originalCourseId:'c1',replacement:{subjectId:'history',classId:'203'}}]}
    expect(resolveSlot(replaced,new Date(2026,7,31),1).subjectId).toBe('history')
    expect(replaced.courses.find((item)=>item.id==='c1')?.subjectId).toBe('chinese')
    const cancelled: AppData={...initialData,overrides:[{id:'o',termId:term.id,date:'2026-08-31',periodId:1,action:'cancel',originalCourseId:'c1'}]}
    expect(resolveSlot(cancelled,new Date(2026,7,31),1).status).toBe('cancelled')
    expect(resolveSlot(cancelled,new Date(2026,8,7),1).status).toBe('regular')
  })
  it('學期外不顯示課程，歷史日期使用日期所屬學期', () => {
    expect(resolveSlot(initialData,new Date(2026,7,28),1).status).toBe('empty')
    expect(getTermForDate(initialData,'2026-08-31')?.id).toBe(term.id)
  })
  it('節次重排不改 ID，刪除引用中的 ID 會被拒絕', () => {
    const reordered=term.periods.map((item,index)=>({...item,order:term.periods.length-index}))
    expect(reordered.map((item)=>item.id)).toEqual(term.periods.map((item)=>item.id))
    expect(validatePeriods(term.periods.filter((item)=>item.id!==1),new Set([1]))).toContain('仍被課程引用')
  })
  it('termId null 的異動保留但不會取消任何學期課程', () => {
    const data: AppData={...initialData,overrides:[{id:'orphan',termId:null,date:'2026-08-31',periodId:1,action:'cancel',originalCourseId:'c1'}]}
    expect(data.overrides[0].termId).toBeNull()
    expect(resolveSlot(data,new Date(2026,7,31),1).status).toBe('regular')
  })
  it('只有日期、學期、節次與原課程一致時才能重新歸屬',()=>{
    const valid={id:'orphan',termId:null,date:'2026-08-31',periodId:1,action:'cancel' as const,originalCourseId:'c1'}
    expect(getSafeOverrideTerm(initialData,valid)?.id).toBe(term.id)
    expect(getSafeOverrideTerm(initialData,{...valid,originalCourseId:'missing'})).toBeUndefined()
    expect(getSafeOverrideTerm(initialData,{...valid,periodId:999})).toBeUndefined()
    expect(getSafeOverrideTerm(initialData,{...valid,date:'2027-03-01'})).toBeUndefined()
  })
})

describe('跨學期週逐日節次',()=>{
  const week=startOfWeek(new Date(2026,7,31))
  const days=Array.from({length:5},(_,index)=>addDays(week,index))
  const first={...term,id:'first',name:'前學期',startDate:'2026-09-01',endDate:'2026-09-02',periods:[{id:1,order:1,label:'第一節',startTime:'08:00',endTime:'08:50'}]}
  const second={...term,id:'second',name:'後學期',startDate:'2026-09-03',endDate:'2026-09-04',periods:[{id:20,order:2,label:'下午課',startTime:'13:00',endTime:'13:50'},{id:10,order:1,label:'晨間課',startTime:'07:30',endTime:'08:20'}]}
  const data: AppData={...initialData,academicTerms:[first,second],activeTermId:'first',courses:[
    {...initialData.courses[4],id:'first-course',termId:'first',day:2,periodId:1},
    {...initialData.courses[10],id:'second-course',termId:'second',day:4,periodId:10},
  ],overrides:[]}
  it('週中開始、結束及同週兩學期時不使用星期一節次',()=>{
    expect(hasUniformWeekStructure(data,days)).toBe(false)
    expect(getDayPeriods(data,days[0])).toEqual([])
    expect(getDayPeriods(data,days[1]).map((item)=>item.id)).toEqual([1])
    expect(getDayPeriods(data,days[3]).map((item)=>item.id)).toEqual([10,20])
    expect(resolveSlot(data,days[1],1).course?.id).toBe('first-course')
    expect(resolveSlot(data,days[3],10).course?.id).toBe('second-course')
  })
  it('完整單一學期週維持共用矩陣模式',()=>{
    expect(hasUniformWeekStructure(initialData,Array.from({length:5},(_,index)=>addDays(startOfWeek(new Date(2026,7,31)),index)))).toBe(true)
  })
})

describe('今日課程與事件', () => {
  it('判斷目前課程、下一節與結束狀態', () => {
    expect(getTodayTeachingSummary(initialData,new Date(2026,7,31,8,30)).state).toBe('current')
    expect(getTodayTeachingSummary(initialData,new Date(2026,7,31,18,0)).state).toBe('finished')
    expect(getTodayTeachingSummary(initialData,new Date(2027,1,1,8,30)).state).toBe('outside-semester')
  })
  it('termId null 的活動仍按日期顯示，日期改變可重新分類', () => {
    const event: CalendarEvent={id:'e',termId:null,title:'活動',type:'activity',date:'2026-09-01',startTime:'10:00',endTime:'11:00',color:'#000'}
    expect(getNextUpcomingEvent([event],new Date(2026,8,1,9,0))?.id).toBe('e')
    expect(classifyEventTerm(event,initialData.academicTerms)).toBe(term.id)
    expect(reclassifyEvents([{...event,date:'2027-03-01'}],initialData.academicTerms)[0].termId).toBeNull()
  })
})

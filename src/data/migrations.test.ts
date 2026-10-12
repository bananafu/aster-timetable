import { describe, expect, it } from 'vitest'
import { clearDemoRecords, isAppData, isLegacyAppDataV1, migrateV1ToV3, type LegacyAppDataV1 } from './migrations'
import { initialData } from './seed'

const legacy = (): LegacyAppDataV1 => ({
  subjects: initialData.subjects.map((item)=>({...item})), classes:initialData.classes.map((item)=>({...item})),
  periods:initialData.academicTerms[0].periods.map((period)=>({ id:period.id,label:period.label,startTime:period.startTime,endTime:period.endTime })),
  courses:initialData.courses.map((course)=>({ id:course.id,subjectId:course.subjectId,classId:course.classId,day:course.day,periodId:course.periodId,weekPattern:course.weekPattern,room:course.room,origin:course.origin })), events:[
    {id:'inside',title:'會議',type:'meeting',date:'2026-09-01',startTime:'10:00',endTime:'11:00',color:'#000',origin:'demo'},
    {id:'outside',title:'跨期活動',type:'activity',date:'2027-03-01',startTime:'10:00',endTime:'11:00',color:'#000'},
  ], overrides:[{id:'safe',date:'2026-08-31',periodId:1,action:'cancel',originalCourseId:'c1',origin:'demo'},{id:'unknown',date:'2027-03-01',periodId:1,action:'cancel'}],
  semester:{name:'115 學年度第一學期',startDate:'2026-08-31',endDate:'2027-01-20',firstWeekPattern:'A'},
})

describe('v1 → v3 migration',()=>{
  it('遷移前後完整驗證且結果可重複預測',()=>{
    const source=legacy(); expect(isLegacyAppDataV1(source)).toBe(true)
    const first=migrateV1ToV3(source); const second=migrateV1ToV3(source)
    expect(isAppData(first)).toBe(true); expect(second).toEqual(first)
    expect(first.courses.every((item)=>item.termId===first.activeTermId)).toBe(true)
    expect(first.subjects.map((item)=>item.id)).toEqual(source.subjects.map((item)=>item.id))
    expect(first.classes.map((item)=>item.id)).toEqual(source.classes.map((item)=>item.id))
    expect(first.courses.map((item)=>item.id)).toEqual(source.courses.map((item)=>item.id))
    expect(first.events.map((item)=>item.id)).toEqual(source.events.map((item)=>item.id))
    expect(first.overrides.map((item)=>item.id)).toEqual(source.overrides.map((item)=>item.id))
    expect(first.subjects).toEqual(source.subjects)
    expect(first.classes).toEqual(source.classes)
    expect(first.courses).toEqual(source.courses.map((item)=>({...item,termId:first.activeTermId})))
    expect(first.events).toEqual(source.events.map((item)=>({...item,termId:item.date>='2026-08-31'&&item.date<='2027-01-20'?first.activeTermId:null})))
    expect(first.overrides).toEqual(source.overrides.map((item)=>({...item,termId:item.id==='safe'?first.activeTermId:null})))
    expect(JSON.stringify(source)).toBe(JSON.stringify(legacy()))
  })
  it('termId null 的異動保留於 JSON 但不參與排課',()=>{
    const result=migrateV1ToV3(legacy())
    const orphan=result.overrides.find((item)=>item.id==='unknown')
    expect(orphan?.termId).toBeNull()
    expect(JSON.parse(JSON.stringify(result)).overrides).toContainEqual(orphan)
  })
  it('保留並警告無法安全歸屬的事件、異動與示範標記',()=>{
    const result=migrateV1ToV3(legacy())
    expect(result.events.find((item)=>item.id==='outside')?.termId).toBeNull()
    expect(result.overrides.find((item)=>item.id==='unknown')?.termId).toBeNull()
    expect(result.migrationWarnings).toHaveLength(2)
    expect(result.events.find((item)=>item.id==='inside')?.origin).toBe('demo')
  })
  it('activeTermId 不可指向封存學期，切換本身不改封存狀態',()=>{
    const valid=migrateV1ToV3(legacy())
    expect(isAppData({...valid,academicTerms:valid.academicTerms.map((term)=>({...term,archivedAt:'2027-02-01T00:00:00.000Z'}))})).toBe(false)
    const second={...valid.academicTerms[0],id:'second',name:'第二學期',startDate:'2027-02-01',endDate:'2027-06-30',archivedAt:undefined}
    const switched={...valid,academicTerms:[valid.academicTerms[0],second],activeTermId:'second'}
    expect(switched.academicTerms[0].archivedAt).toBeUndefined()
    expect(isAppData(switched)).toBe(true)
  })
})

describe('示範資料安全清除',()=>{
  it('正式修改後轉為使用者資料並保留',()=>{
    const changed={...initialData,subjects:initialData.subjects.map((item)=>item.id==='chinese'?{...item,color:'#123456',origin:'user' as const}:item)}
    expect(clearDemoRecords(changed).subjects.find((item)=>item.id==='chinese')).toMatchObject({color:'#123456',origin:'user'})
  })
  it('只清除有 demo 標記的紀錄並保留使用者依賴',()=>{
    const userCourse={...initialData.courses[0],id:'user-course',origin:'user' as const}
    const result=clearDemoRecords({...initialData,courses:[...initialData.courses,userCourse]})
    expect(result.courses.map((item)=>item.id)).toEqual(['user-course'])
    expect(result.subjects.some((item)=>item.id==='chinese')).toBe(true)
  })
})

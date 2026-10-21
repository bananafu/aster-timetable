// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelLessonOnDate, moveLessonOnDate, permanentlyUpdateLesson } from '../data/lessonChangesV4'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { initialData } from '../data/seed'
import { addClass, addSchool, addTeachingUnit } from '../data/academicSettingsV4'
import { LessonEditor } from './LessonEditor'

afterEach(cleanup)

function setup() {
  return migrateV3ToV4(structuredClone(initialData))
}

describe('LessonEditor integrated experience', () => {
  it('唯一的國中高中學制只顯示學制名稱，other 使用原自訂名稱', () => {
    const data = migrateV4ToV5(setup())
    data.teachingUnits[0].schoolLevel = 'senior-high'
    data.teachingUnits[0].name = '不應顯示的舊名稱'
    const otherSchool = { id: 'other-school', projectId: data.activeProjectId!, name: '實驗校', color: '#718B6C' }
    data.schools.push(otherSchool)
    data.teachingUnits.push({ ...structuredClone(data.teachingUnits[0]), id: 'other-unit', schoolId: otherSchool.id, schoolLevel: 'other', name: '雙語實驗課程' })
    render(<LessonEditor data={data} setData={vi.fn()} onClose={vi.fn()} onSaved={vi.fn()} />)
    const level = screen.getByLabelText('課程學制') as HTMLSelectElement
    expect([...level.options].map((option) => option.text)).toContain('高中部')
    expect([...level.options].map((option) => option.text)).not.toContain('高中部・不應顯示的舊名稱')
    fireEvent.change(screen.getByLabelText('課程學校'), { target: { value: otherSchool.id } })
    expect([...level.options].map((option) => option.text)).toContain('雙語實驗課程')
  })

  it('學制切換後清除不適用科目，空狀態可開啟目前學制科目管理', () => {
    const base = migrateV4ToV5(setup())
    base.teachingUnits[0].schoolLevel = 'senior-high'
    base.subjects = base.subjects.map((subject, index) => ({ ...subject, name: index === 0 ? '高中科目' : subject.name, applicableSchoolLevels: ['senior-high'] }))
    const unit = { ...base.teachingUnits[0], id: 'unit-j', schoolLevel: 'junior-high' as const }
    base.teachingUnits.push(unit)
    const onManageResource = vi.fn()
    render(<LessonEditor data={base} setData={vi.fn()} onManageResource={onManageResource} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect((screen.getByLabelText('課程科目') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('課程學制'), { target: { value: 'unit-j' } })
    expect((screen.getByLabelText('課程科目') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('目前學制尚未建立科目')).toBeTruthy()
    expect((screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.focus(screen.getByLabelText('課程科目'))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    expect(onManageResource).toHaveBeenCalledWith('subjects', {
      projectId: base.activeProjectId,
      teachingUnitId: 'unit-j',
    }, expect.any(Function))
  })

  it('既有不適用科目仍顯示課程脈絡，且不會靜默改選', () => {
    const data = migrateV4ToV5(setup())
    data.subjects.find((item) => item.id === 'chinese')!.applicableSchoolLevels = ['junior-high']
    const setData = vi.fn()
    render(<LessonEditor data={data} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByLabelText('目前課程資訊').textContent).toContain('國文')
    expect(screen.getByText('既有科目不適用目前學制；原課程仍保留，可修改其他欄位。若要更換科目，請選擇適用科目。')).toBeTruthy()
    expect((screen.getByLabelText('課程科目') as HTMLInputElement).value).toBe('國文')
    expect((screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(screen.getByPlaceholderText('依班級預設'), { target: { value: '保留原科目' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect((setData.mock.calls[0][0] as typeof data).recurringLessons.find((item) => item.id === 'c1'))
      .toMatchObject({ subjectId: 'chinese', room: '保留原科目' })
  })

  it('新增課程科目初始為空，選取後以既有 Subject ID 儲存', () => {
    const data = setup()
    const setData = vi.fn()
    render(<LessonEditor data={data} setData={setData} onClose={vi.fn()} onSaved={vi.fn()} />)
    const subject = screen.getByLabelText('課程科目') as HTMLInputElement
    expect(subject.value).toBe('')
    expect((screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.focus(subject)
    fireEvent.click(screen.getByText('歷史').closest('[role=option]')!)
    fireEvent.change(screen.getByLabelText('課程星期'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('課程節次'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))

    const result = setData.mock.calls[0][0] as ReturnType<typeof setup>
    expect(result.recurringLessons.at(-1)?.subjectId).toBe('history')
  })

  it('開啟科目管理時保留已選科目與其他課程欄位', () => {
    const data = setup()
    const setData = vi.fn()
    const onManageResource = vi.fn()
    render(<LessonEditor data={data} setData={setData} onManageResource={onManageResource} onClose={vi.fn()} onSaved={vi.fn()} />)
    const subject = screen.getByLabelText('課程科目') as HTMLInputElement
    fireEvent.focus(subject)
    fireEvent.click(screen.getByText('歷史').closest('[role=option]')!)
    fireEvent.change(screen.getByPlaceholderText('依班級預設'), { target: { value: '專科教室' } })

    fireEvent.click(subject)
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))

    expect(setData).not.toHaveBeenCalled()
    expect(onManageResource).toHaveBeenCalledTimes(1)
    expect(subject.value).toBe('歷史')
    expect((screen.getByPlaceholderText('依班級預設') as HTMLInputElement).value).toBe('專科教室')
  })

  it('科目管理建立完成回呼會選取新科目', () => {
    const data = setup()
    const onManageResource = vi.fn((_mode, _context, onCreated: (id: string) => void) => onCreated('reading'))
    render(<LessonEditor data={data} setData={vi.fn()} onManageResource={onManageResource} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('課程科目'))
    fireEvent.click(screen.getByRole('button', { name: '管理科目' }))
    expect((screen.getByLabelText('課程科目') as HTMLInputElement).value).toBe('閱讀素養')
  })

  it('未選學制時不顯示全域科目選單或新增入口', () => {
    const data = migrateV4ToV5(setup())
    data.teachingUnits = []
    render(<LessonEditor data={data} setData={vi.fn()} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('請先選擇學校與學制，才能選擇或管理科目。')).toBeTruthy()
    expect(screen.queryByLabelText('課程科目')).toBeNull()
    expect(screen.queryByRole('button', { name: '建立科目' })).toBeNull()
  })

  it('切換學制時保留仍適用的舊版科目，並清除不適用科目', () => {
    const data = setup()
    const firstUnit = data.teachingUnits[0]
    firstUnit.schoolLevel = 'senior-high'
    data.teachingUnits.push({ ...structuredClone(firstUnit), id: 'junior-unit', schoolLevel: 'junior-high' })
    data.subjects.push({ id: 'senior-only', name: '高中限定', shortName: '高限', color: '#123456', applicableSchoolLevels: ['senior-high'] })
    render(<LessonEditor data={data} setData={vi.fn()} onClose={vi.fn()} onSaved={vi.fn()} />)
    const input = screen.getByLabelText('課程科目') as HTMLInputElement

    fireEvent.focus(input)
    fireEvent.click(screen.getByText('歷史').closest('[role=option]')!)
    fireEvent.change(screen.getByLabelText('課程學制'), { target: { value: 'junior-unit' } })
    expect(input.value).toBe('歷史')

    fireEvent.change(screen.getByLabelText('課程學制'), { target: { value: firstUnit.id } })
    fireEvent.click(input)
    fireEvent.click(screen.getByText('高中限定').closest('[role=option]')!)
    fireEvent.change(screen.getByLabelText('課程學制'), { target: { value: 'junior-unit' } })
    expect(input.value).toBe('')
  })
  it('顯示點擊日期的完整課程脈絡與 A/B 狀態', () => {
    const data = setup()
    render(<LessonEditor data={data} setData={vi.fn()} lessonId="c3" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByLabelText('目前課程資訊').textContent).toContain('我的學校')
    expect(screen.getByLabelText('目前課程資訊').textContent).toContain('公民與社會')
    expect(screen.getByLabelText('目前課程資訊').textContent).toContain('2026-09-07・A 週')
    expect(screen.getByLabelText('目前課程資訊').textContent).toContain('第 6 節・14:10–15:00')
  })

  it('單日移動先顯示原位置與目標位置，確認前不寫入', () => {
    const data = setup()
    const setData = vi.fn()
    render(<LessonEditor data={data} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /僅此日期/ }))
    fireEvent.change(screen.getByLabelText('課程異動類型'), { target: { value: 'move' } })
    fireEvent.change(screen.getByLabelText('移至節次'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    expect(setData).not.toHaveBeenCalled()
    const preview = screen.getByLabelText('異動預覽')
    expect(preview.textContent).toContain('原位置：2026-09-07・週一・第 1 節 08:10–09:00（將留白）')
    expect(preview.textContent).toContain('目標位置：2026-09-07・第 8 節 16:10–17:00')
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    expect(setData).toHaveBeenCalledTimes(1)
  })

  it('跨週移動至同課原有 occurrence 時先阻止，明確允許後預覽與寫入皆提示衝堂', () => {
    const data = setup()
    const setData = vi.fn()
    render(<LessonEditor data={data} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /僅此日期/ }))
    fireEvent.change(screen.getByLabelText('課程異動類型'), { target: { value: 'move' } })
    fireEvent.change(screen.getByLabelText('移至日期'), { target: { value: '2026-09-14' } })
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    expect(screen.getByRole('alert').textContent).toContain('目標時間已有課程')
    expect(setData).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('目標已有課程時仍保留雙方並顯示衝堂警告'))
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    expect(screen.getByLabelText('異動預覽').textContent).toContain('可能衝堂：國文')
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    const result = setData.mock.calls[0][0] as ReturnType<typeof setup>
    expect(result.overrides.at(-1)).toMatchObject({ action: 'move', originalLessonId: 'c1', date: '2026-09-07', target: { date: '2026-09-14', periodId: 1 } })
  })

  it('版本歷史呈現生效範圍且不提供過去版本回寫入口', () => {
    const data = setup()
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    const unit = data.teachingUnits.find((item) => item.id === lesson.teachingUnitId)!
    const school = data.schools.find((item) => item.id === unit.schoolId)!
    const versioned = permanentlyUpdateLesson(data, lesson.id, '2026-09-14', {
      projectId: lesson.projectId, schoolId: school.id, teachingUnitId: unit.id, subjectId: lesson.subjectId,
      classId: lesson.classId, day: lesson.day, periodId: 2, weekPattern: lesson.weekPattern, room: lesson.room,
    }, () => 'c1-v2')
    const setData = vi.fn()
    render(<LessonEditor data={versioned} setData={setData} lessonId="c1-v2" occurrenceDate="2026-09-14" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByText('課程版本歷史（2）'))
    expect(screen.getByText('2026-08-31 — 2026-09-13')).toBeTruthy()
    expect(screen.getByText('2026-09-14 — 2027-01-20')).toBeTruthy()
    expect(screen.getByText('歷史版本僅供檢視，不可直接回寫。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /回復|修改歷史/ })).toBeNull()
    expect(screen.getByText(/此課程已有歷史版本，不能直接刪除/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '刪除固定課程' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /從指定日期起/ }))
    expect(screen.getByRole('option', { name: '結束課程' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('課程異動類型'), { target: { value: 'end' } })
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    expect(screen.getByLabelText('異動預覽').textContent).toContain('從指定日期起結束課程')
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    const ended = setData.mock.calls[0][0] as ReturnType<typeof setup>
    expect(ended.recurringLessons.some((item) => item.id === 'c1-v2')).toBe(false)
    expect(ended.recurringLessons.find((item) => item.id === 'c1')?.effectiveEnd).toBe('2026-09-13')
  })

  it('單版本固定課程仍可使用原有刪除功能', () => {
    const setData = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<LessonEditor data={setup()} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '刪除固定課程' }))
    expect((setData.mock.calls[0][0] as ReturnType<typeof setup>).recurringLessons.some((item) => item.id === 'c1')).toBe(false)
    confirm.mockRestore()
  })

  it('永久修改鎖定原學校與學制，單日異動仍維持可用', () => {
    const original = setup()
    const unit = original.teachingUnits[0]
    const data = addTeachingUnit(original, unit.schoolId, { name: '國中部', schoolLevel: 'junior-high', startDate: '2026-09-01', endDate: '2027-01-15', weekCycle: { enabled: false, anchorDate: '2026-09-01', anchorPattern: 'A' } }, 'junior-unit')
    render(<LessonEditor data={data} setData={vi.fn()} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /從指定日期起/ }))
    expect((screen.getByLabelText('課程學校') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByLabelText('課程學制') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByText(/永久版本必須保留原學制/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /僅此日期/ }))
    expect(screen.getByRole('option', { name: '移動課程' })).toBeTruthy()
  })

  it('同一天同課程的週末異動可依 override ID 編輯正確 occurrence', () => {
    const first = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-12', periodId: 1 }, false, () => 'first-weekend')
    const data = moveLessonOnDate(first, 'c1', '2026-09-14', { date: '2026-09-12', periodId: 8 }, false, () => 'second-weekend')
    const setData = vi.fn()
    render(<LessonEditor data={data} setData={setData} lessonId="c1" occurrenceDate="2026-09-12" occurrenceOverrideId="second-weekend" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByLabelText('現有單日異動').textContent).toContain('2026-09-14 → 2026-09-12・節次 8')
    fireEvent.click(screen.getByRole('button', { name: '修改此異動' }))
    expect((screen.getByLabelText('異動日期') as HTMLInputElement).value).toBe('2026-09-14')
    fireEvent.change(screen.getByLabelText('課程異動類型'), { target: { value: 'cancel' } })
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    const result = setData.mock.calls[0][0] as ReturnType<typeof setup>
    expect(result.overrides).toHaveLength(2)
    expect(result.overrides.find((item) => item.id === 'first-weekend')?.action).toBe('move')
    expect(result.overrides.some((item) => item.id === 'second-weekend')).toBe(false)
    expect(result.overrides.find((item) => item.date === '2026-09-14')?.action).toBe('cancel')
  })

  it('從歷史日期開啟已結束版本時只提供唯讀檢視', () => {
    const data = setup()
    const lesson = data.recurringLessons.find((item) => item.id === 'c1')!
    lesson.effectiveEnd = '2026-09-13'
    data.recurringLessons.push({ ...lesson, id: 'c1-v2', effectiveStart: '2026-09-14', effectiveEnd: '2027-01-20' })
    render(<LessonEditor data={data} setData={vi.fn()} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('目前選取的是已結束的歷史版本，只能查看，不可直接修改或新增異動。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '儲存' })).toBeNull()
    expect(screen.getByRole('button', { name: '關閉' })).toBeTruthy()
  })

  it('資料層仍阻止封存 Project 的課程寫入', () => {
    const data = setup()
    data.projects[0].archivedAt = '2026-10-01T00:00:00.000Z'
    data.activeProjectId = null
    const setData = vi.fn()
    render(<LessonEditor data={data} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('依班級預設'), { target: { value: '不可寫入' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    expect(setData).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('封存專案為唯讀')
  })

  it('Escape 可安全取消編輯器且不寫入', () => {
    const data = setup()
    const setData = vi.fn()
    const onClose = vi.fn()
    render(<LessonEditor data={data} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(setData).not.toHaveBeenCalled()
  })

  it('科目選單開啟時 Escape 只關閉選單，不會連帶關閉編輯器', () => {
    const onClose = vi.fn()
    render(<LessonEditor data={setup()} setData={vi.fn()} onClose={onClose} onSaved={vi.fn()} />)
    const subject = screen.getByLabelText('課程科目')
    fireEvent.focus(subject)
    expect(subject.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(subject, { key: 'Escape' })
    expect(subject.getAttribute('aria-expanded')).toBe('false')
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('顯示並預覽撤銷現有移動，確認後原子移除 override', () => {
    const moved = moveLessonOnDate(setup(), 'c1', '2026-09-07', { date: '2026-09-07', periodId: 8 }, false, () => 'move-existing')
    const setData = vi.fn()
    render(<LessonEditor data={moved} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByLabelText('現有單日異動').textContent).toContain('單日移動')
    fireEvent.click(screen.getByRole('button', { name: '撤銷異動' }))
    expect(setData).not.toHaveBeenCalled()
    expect(screen.getByLabelText('異動預覽').textContent).toContain('撤銷單日移動')
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    expect((setData.mock.calls[0][0] as ReturnType<typeof setup>).overrides).toHaveLength(0)
  })

  it('修改既有異動時以新紀錄取代舊紀錄', () => {
    const cancelled = cancelLessonOnDate(setup(), 'c1', '2026-09-07', () => 'cancel-existing')
    const setData = vi.fn()
    render(<LessonEditor data={cancelled} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '修改此異動' }))
    expect(screen.getByText(/正在改寫既有單日異動/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('課程異動類型'), { target: { value: 'move' } })
    fireEvent.change(screen.getByLabelText('移至節次'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    const result = setData.mock.calls[0][0] as ReturnType<typeof setup>
    expect(result.overrides).toHaveLength(1)
    expect(result.overrides[0]).toMatchObject({ action: 'move', originalLessonId: 'c1', target: { periodId: 8 } })
    expect(result.overrides[0].id).not.toBe('cancel-existing')
  })

  it('拖曳意圖預設為僅此日期，確認前不寫入', () => {
    const data = setup(); const setData = vi.fn()
    render(<LessonEditor data={data} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" dragIntent={{ lessonId: 'c1', projectId: data.activeProjectId!, timetableId: null, sourceDate: '2026-09-07', targetDate: '2026-09-08', targetPeriodId: 8, targetStartTime: '16:10', targetEndTime: '17:00', conflictLessonIds: [] }} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText(/拖曳只建立操作意圖/).textContent).toContain('預設僅移動 2026-09-07')
    expect((screen.getByLabelText('課程異動類型') as HTMLSelectElement).value).toBe('move')
    expect((screen.getByLabelText('移至日期') as HTMLInputElement).value).toBe('2026-09-08')
    expect((screen.getByLabelText('移至節次') as HTMLSelectElement).value).toBe('8')
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    expect(setData).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    expect(setData).toHaveBeenCalledTimes(1)
  })

  it('拖到其他日期的既有課程時可預覽並原子交換', () => {
    const data = setup(); const setData = vi.fn()
    render(<LessonEditor data={data} setData={setData} lessonId="c1" occurrenceDate="2026-09-07" dragIntent={{ lessonId: 'c1', projectId: data.activeProjectId!, timetableId: null, sourceDate: '2026-09-07', targetDate: '2026-09-08', targetPeriodId: 2, targetStartTime: '09:10', targetEndTime: '10:00', conflictLessonIds: ['c5'] }} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('課程異動類型'), { target: { value: 'swap' } })
    expect(screen.getByRole('option', { name: /09:10 國文/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('交換課程'), { target: { value: 'c5' } })
    fireEvent.click(screen.getByRole('button', { name: '預覽異動' }))
    expect(setData).not.toHaveBeenCalled()
    expect(screen.getByLabelText('異動預覽').textContent).toContain('2026-09-08')
    fireEvent.click(screen.getByRole('button', { name: '確認套用' }))
    const result = setData.mock.calls[0][0] as ReturnType<typeof setup>
    expect(result.overrides).toHaveLength(2)
    expect(new Set(result.overrides.map((item) => item.groupId)).size).toBe(1)
    expect(result.overrides.map((item) => [item.originalLessonId, item.date, item.target?.date])).toEqual([
      ['c1', '2026-09-07', '2026-09-08'],
      ['c5', '2026-09-08', '2026-09-07'],
    ])
  })

  it('依學校與學制更新班級和節次，切換後清除失效選擇', () => {
    const original = setup(); const projectId = original.activeProjectId!; const firstSchool = original.schools[0]
    let data = addTeachingUnit(original, firstSchool.id, { name: '國中部', schoolLevel: 'junior-high', startDate: '2026-09-01', endDate: '2027-01-15', weekCycle: { enabled: true, anchorDate: '2026-09-01', anchorPattern: 'A' } }, 'junior-unit')
    data = addClass(data, projectId, { teachingUnitId: 'junior-unit', grade: 7, classNumber: 9 }, 'class-709')
    data = addSchool(data, projectId, { name: '第二校', color: '#718B6C' }, 'school-2')
    data = addTeachingUnit(data, 'school-2', { name: '第二校高中部', schoolLevel: 'senior-high', startDate: '2026-09-01', endDate: '2027-01-15', weekCycle: { enabled: false, anchorDate: '2026-09-01', anchorPattern: 'A' } }, 'school-2-senior')
    data = addClass(data, projectId, { teachingUnitId: 'school-2-senior', grade: 1, classNumber: 3 }, 'class-103')
    render(<LessonEditor data={data} setData={vi.fn()} onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('課程學制'), { target: { value: 'junior-unit' } })
    expect((screen.getByLabelText('課程班級') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('課程節次') as HTMLSelectElement).value).toBe('0')
    expect(screen.getByRole('option', { name: '709' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: '二年 1 班' })).toBeNull()
    const subjectInput = screen.getByLabelText('課程科目') as HTMLInputElement
    fireEvent.focus(subjectInput)
    fireEvent.click(screen.getByText('歷史').closest('[role=option]')!)
    fireEvent.change(screen.getByLabelText('課程班級'), { target: { value: 'class-709' } })
    fireEvent.change(screen.getByLabelText('課程節次'), { target: { value: '1' } })

    fireEvent.change(screen.getByLabelText('課程學校'), { target: { value: 'school-2' } })
    expect((screen.getByLabelText('課程學制') as HTMLSelectElement).value).toBe('school-2-senior')
    expect((screen.getByLabelText('課程班級') as HTMLSelectElement).value).toBe('')
    expect((screen.getByLabelText('課程節次') as HTMLSelectElement).value).toBe('0')
    expect(subjectInput.value).toBe('歷史')
    expect(screen.getByRole('option', { name: '103' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: '709' })).toBeNull()
  })

  it('沒有班級或節次時顯示具體空狀態並停用儲存', () => {
    const withoutClasses = setup(); const unitId = withoutClasses.teachingUnits[0].id
    withoutClasses.classes = withoutClasses.classes.filter((item) => item.teachingUnitId !== unitId)
    const onOpenSettings = vi.fn()
    const onManageResource = vi.fn()
    const first = render(<LessonEditor data={withoutClasses} setData={vi.fn()} onOpenSettings={onOpenSettings} onManageResource={onManageResource} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('目前學制尚未建立班級')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '管理班級' }))
    expect(onManageResource).toHaveBeenCalledWith('classes', {
      projectId: withoutClasses.activeProjectId,
      teachingUnitId: unitId,
    }, expect.any(Function))
    expect((screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onOpenSettings).not.toHaveBeenCalled()
    first.unmount()

    const withoutPeriods = setup()
    withoutPeriods.teachingUnits[0] = { ...withoutPeriods.teachingUnits[0], periods: [] }
    render(<LessonEditor data={withoutPeriods} setData={vi.fn()} onOpenSettings={vi.fn()} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('此學制尚未建立節次時間表。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '儲存' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

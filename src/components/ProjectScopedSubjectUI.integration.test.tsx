// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateV3ToV4 } from '../data/migrationsV4'
import { migrateV4ToV5 } from '../data/migrationsV5'
import { migrateV5ToV6 } from '../data/migrationsV6'
import { migrateV6ToV7 } from '../data/migrationsV7'
import { migrateV7ToV8 } from '../data/migrationsV8'
import { createBlankProject } from '../data/projectRuntimeV8'
import { initialData } from '../data/seed'
import { createSubject } from '../data/subjectsV8'
import type { AppDataV8 } from '../types'
import { CourseResourceManager } from './CourseResourceManager'
import { LessonEditor } from './LessonEditor'
import { OneOffLessonEditor } from './OneOffLessonEditor'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function fixture(): AppDataV8 {
  const source = migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))
  const ids = ['project-b', 'school-b', 'unit-b', 'timetable-b']
  const blank = createBlankProject(source, {
    name: 'Project B', teacherName: 'Teacher B', academicYear: 116, semester: 'first',
    startDate: '2027-08-30', endDate: '2028-01-19',
  }, () => ids.shift()!, '2027-08-01T00:00:00.000Z')
  return createSubject(blank, 'project-b', {
    name: 'Project B 專用科目', shortName: 'B科', color: '#123456', applicableSchoolLevels: ['senior-high'],
  }, 'subject-b')
}

describe('Project-scoped Subject UI compatibility', () => {
  it('LessonEditor only offers Subjects owned by the selected V8 Project', () => {
    const data = fixture()
    render(<LessonEditor
      data={data}
      setData={vi.fn()}
      timetableId="timetable-b"
      context={{ projectId: 'project-b', teachingUnitId: 'unit-b' }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />)

    fireEvent.focus(screen.getByLabelText('課程科目'))
    const options = within(screen.getByRole('listbox', { name: '可選科目' }))
    expect(options.getByRole('option', { name: /Project B 專用科目/ })).toBeTruthy()
    expect(options.queryByRole('option', { name: /國文/ })).toBeNull()
  })

  it('OneOffLessonEditor only offers Subjects owned by its explicit V8 Project', () => {
    const data = fixture()
    render(<OneOffLessonEditor
      data={data as never}
      projectId="project-b"
      timetableId="timetable-b"
      initialDate="2027-09-01"
      initialTeachingUnitId="unit-b"
      onSave={vi.fn()}
      onClose={vi.fn()}
    />)

    const subjects = screen.getByLabelText('科目') as HTMLSelectElement
    expect(subjects.textContent).toContain('Project B 專用科目')
    expect(subjects.textContent).not.toContain('國文')
  })

  it('CourseResourceManager reads the selected V8 Project Subject library', () => {
    const data = fixture()
    render(<CourseResourceManager data={data} setData={vi.fn()} mode="subjects" readOnly />)

    expect(screen.getByRole('button', { name: '編輯科目 Project B 專用科目' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '編輯科目 國文' })).toBeNull()
  })
})

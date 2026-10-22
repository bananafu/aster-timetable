import { describe, expect, it } from 'vitest'
import type { AppDataV8 } from '../types'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { migrateV6ToV7 } from './migrationsV7'
import { migrateV7ToV8 } from './migrationsV8'
import { DEFAULT_SUBJECT_CATALOG } from './defaultSubjects'
import { createSubjectForTeachingUnit, SubjectV8ManagementError } from './subjectsV8'
import {
  addSubjectDraftToTeachingUnit,
  configureExistingSubjectForTeachingUnit,
  getTeachingUnitSubjectView,
  removeConfiguredSubjectFromTeachingUnit,
  teachingUnitSubjectErrorMessage,
} from './teachingUnitSubjectManagementAdapter'
import { isCompatibleAppDataV8 } from './validators/v8'

const base = () => migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))

function fixture(): AppDataV8 {
  const data = base()
  const projectId = data.projects[0].id
  const source = data.teachingUnits[0]
  return {
    ...data,
    schools: [
      ...data.schools,
      { id: 'school-a', projectId, name: 'A 校', color: '#123456' },
      { id: 'school-b', projectId, name: 'B 校', color: '#654321' },
    ],
    teachingUnits: [
      ...data.teachingUnits,
      { ...structuredClone(source), id: 'a-junior', schoolId: 'school-a', name: 'A 國中部', schoolLevel: 'junior-high' },
      { ...structuredClone(source), id: 'a-senior', schoolId: 'school-a', name: 'A 高中部', schoolLevel: 'senior-high' },
      { ...structuredClone(source), id: 'b-senior', schoolId: 'school-b', name: 'B 高中部', schoolLevel: 'senior-high' },
    ],
  }
}

function withChinese(): AppDataV8 {
  const data = fixture()
  return createSubjectForTeachingUnit(data, data.projects[0].id, 'a-junior', {
    name: '國語文', shortName: '國語', color: '#A66D52',
    applicableSchoolLevels: ['junior-high', 'senior-high'],
  }, 'shared-chinese', 'relation-a-junior-chinese')
}

describe('TeachingUnit-scoped Subject management adapter', () => {
  it('keeps schools and school levels independent while sharing one Subject definition', () => {
    const current = withChinese()
    const projectId = current.projects[0].id

    expect(getTeachingUnitSubjectView(current, projectId, 'a-junior').configured.map((item) => item.id))
      .toEqual(['shared-chinese'])
    expect(getTeachingUnitSubjectView(current, projectId, 'a-senior').configured).toEqual([])
    expect(getTeachingUnitSubjectView(current, projectId, 'b-senior').configured).toEqual([])

    const high = configureExistingSubjectForTeachingUnit(
      current, projectId, 'a-senior', 'shared-chinese', 'relation-a-senior-chinese',
    ).data
    expect(getTeachingUnitSubjectView(high, projectId, 'a-junior').configured.map((item) => item.id))
      .toEqual(['shared-chinese'])
    expect(getTeachingUnitSubjectView(high, projectId, 'a-senior').configured.map((item) => item.id))
      .toEqual(['shared-chinese'])
    expect(getTeachingUnitSubjectView(high, projectId, 'b-senior').configured).toEqual([])
  })

  it('reuses an applicable same-name Subject without confirmation or duplication', () => {
    const current = withChinese()
    const projectId = current.projects[0].id
    const snapshot = structuredClone(current)
    const result = addSubjectDraftToTeachingUnit(current, projectId, 'b-senior', {
      name: ' 國語文 ', shortName: '不同輸入不應覆寫', color: '#000000', applicableSchoolLevels: ['senior-high'],
    }, { subjectId: 'unused-subject-id', relationId: 'relation-b-senior-chinese' })

    expect(result).toMatchObject({ status: 'updated', kind: 'configured', subjectId: 'shared-chinese' })
    if (result.status !== 'updated') throw new Error('Expected an updated result')
    expect(result.data.subjects.filter((item) => item.name === '國語文')).toHaveLength(1)
    expect(result.data.subjects.find((item) => item.id === 'shared-chinese')?.shortName).toBe('國語')
    expect(getTeachingUnitSubjectView(result.data, projectId, 'b-senior').configured.map((item) => item.id))
      .toEqual(['shared-chinese'])
    expect(current).toEqual(snapshot)
  })

  it('requires confirmation before extending applicability and preserves other configurations', () => {
    const data = fixture()
    const projectId = data.projects[0].id
    const juniorOnly = createSubjectForTeachingUnit(data, projectId, 'a-junior', {
      name: '校訂閱讀', shortName: '校閱', color: '#123456', applicableSchoolLevels: ['junior-high'],
    }, 'school-reading', 'relation-a-junior-reading')
    const ids = { subjectId: 'unused-new-subject', relationId: 'relation-b-senior-reading' }
    const draft = { name: '校訂閱讀', shortName: '校閱', color: '#123456', applicableSchoolLevels: ['senior-high' as const] }

    const preview = addSubjectDraftToTeachingUnit(juniorOnly, projectId, 'b-senior', draft, ids)
    expect(preview).toMatchObject({
      status: 'requires-applicability-confirmation',
      subject: { id: 'school-reading' },
      schoolLevel: 'senior-high',
    })
    const confirmed = addSubjectDraftToTeachingUnit(juniorOnly, projectId, 'b-senior', draft, ids, true)
    expect(confirmed).toMatchObject({ status: 'updated', kind: 'extended-applicability', subjectId: 'school-reading' })
    if (confirmed.status !== 'updated') throw new Error('Expected an updated result')
    expect(confirmed.data.subjects.find((item) => item.id === 'school-reading')?.applicableSchoolLevels)
      .toEqual(['junior-high', 'senior-high'])
    expect(getTeachingUnitSubjectView(confirmed.data, projectId, 'a-junior').configured.map((item) => item.id))
      .toContain('school-reading')
    expect(getTeachingUnitSubjectView(confirmed.data, projectId, 'a-senior').configured.map((item) => item.id))
      .not.toContain('school-reading')
    expect(getTeachingUnitSubjectView(confirmed.data, projectId, 'b-senior').configured.map((item) => item.id))
      .toContain('school-reading')
  })

  it('removes only the selected TeachingUnit configuration', () => {
    const first = withChinese()
    const projectId = first.projects[0].id
    const both = configureExistingSubjectForTeachingUnit(
      first, projectId, 'b-senior', 'shared-chinese', 'relation-b-senior-chinese',
    ).data
    const removed = removeConfiguredSubjectFromTeachingUnit(both, projectId, 'a-junior', 'shared-chinese')

    expect(getTeachingUnitSubjectView(removed, projectId, 'a-junior').configured).toEqual([])
    expect(getTeachingUnitSubjectView(removed, projectId, 'b-senior').configured.map((item) => item.id))
      .toEqual(['shared-chinese'])
    expect(removed.subjects.some((item) => item.id === 'shared-chinese')).toBe(true)
  })

  it('blocks removal while the TeachingUnit still has a course reference', () => {
    const current = withChinese()
    const projectId = current.projects[0].id
    const sourceLesson = current.recurringLessons[0]
    const referenced: AppDataV8 = {
      ...current,
      classes: [...current.classes, {
        id: 'class-a-junior', projectId, teachingUnitId: 'a-junior', name: '701', grade: 7, classNumber: 1,
      }],
      recurringLessons: [...current.recurringLessons, {
        ...sourceLesson,
        id: 'lesson-a-junior', seriesId: 'series-a-junior', teachingUnitId: 'a-junior',
        classId: 'class-a-junior', subjectId: 'shared-chinese',
      }],
    }
    expect(isCompatibleAppDataV8(referenced)).toBe(true)

    let error: unknown
    try {
      removeConfiguredSubjectFromTeachingUnit(referenced, projectId, 'a-junior', 'shared-chinese')
    } catch (cause) { error = cause }
    expect(error).toBeInstanceOf(SubjectV8ManagementError)
    expect(error).toMatchObject({ code: 'configuration-referenced' })
    expect(teachingUnitSubjectErrorMessage(error)).toBe('這個科目仍有課程使用，請先調整相關課程。')
  })

  it('keeps short-name collisions explicit instead of merging Subjects', () => {
    const current = withChinese()
    const projectId = current.projects[0].id
    let error: unknown
    try {
      addSubjectDraftToTeachingUnit(current, projectId, 'a-senior', {
        name: '另一個科目', shortName: '國語', color: '#123456', applicableSchoolLevels: ['senior-high'],
      }, { subjectId: 'conflicting-subject', relationId: 'conflicting-relation' })
    } catch (cause) { error = cause }

    expect(error).toMatchObject({ code: 'duplicate-short-name' })
    expect(teachingUnitSubjectErrorMessage(error)).toBe('已有其他科目使用相同簡稱，請修改簡稱後再試。')
  })

  it('reports catalog alias conflicts without automatically merging Subjects', () => {
    const current = withChinese()
    const projectId = current.projects[0].id
    let error: unknown
    try {
      addSubjectDraftToTeachingUnit(current, projectId, 'a-junior', {
        name: '歷史科', shortName: '新歷', color: '#123456', applicableSchoolLevels: ['junior-high'],
      }, { subjectId: 'alias-subject', relationId: 'alias-relation' }, false, DEFAULT_SUBJECT_CATALOG)
    } catch (cause) { error = cause }

    expect(error).toMatchObject({ code: 'alias-conflict' })
    expect(teachingUnitSubjectErrorMessage(error))
      .toBe('輸入名稱與既有科目的同義名稱相符，請確認要使用哪一個科目；系統不會自動合併。')
    expect(current.subjects.some((subject) => subject.id === 'alias-subject')).toBe(false)
  })
})

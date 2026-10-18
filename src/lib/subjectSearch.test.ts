import { describe, expect, it } from 'vitest'
import { DEFAULT_SUBJECT_CATALOG, type SubjectCatalogEntry } from '../data/defaultSubjects'
import type { Subject } from '../types'
import { normalizeSubjectText, searchExistingSubjects, searchSubjectCatalog } from './subjectSearch'

const entry = (catalogKey: string, name: string, shortName: string, aliases: string[] = [], zhuyinAliases: string[] = []): SubjectCatalogEntry => ({
  catalogKey,
  name,
  shortName,
  color: '#123456',
  applicableSchoolLevels: ['junior-high'],
  aliases,
  zhuyinAliases,
})

describe('subject catalog search', () => {
  it.each(['理', '理化', 'ㄌㄧˇ', 'ㄌㄧˇㄏㄨㄚˋ'])('finds 理化 using %s', (query) => {
    expect(searchSubjectCatalog(DEFAULT_SUBJECT_CATALOG, 'junior-high', query)[0]?.name).toBe('理化')
  })

  it('strictly filters the selected school level', () => {
    expect(searchSubjectCatalog(DEFAULT_SUBJECT_CATALOG, 'senior-high', '理化')).toEqual([])
    expect(searchSubjectCatalog(DEFAULT_SUBJECT_CATALOG, 'junior-high', '物理')).toEqual([])
    expect(searchSubjectCatalog(DEFAULT_SUBJECT_CATALOG, 'senior-high', '物理').map((item) => item.name)).toEqual(['物理'])
  })

  it('sorts exact, prefix and contains matches stably across names, short names and aliases', () => {
    const entries = [
      entry('core.contains', '自然理化', '自然'),
      entry('core.prefix', '理化實驗', '實驗'),
      entry('core.exact', '科學', '理'),
      entry('core.alias', '自然科學', '科', ['理論']),
    ]
    expect(searchSubjectCatalog(entries, 'junior-high', '理').map((item) => item.catalogKey))
      .toEqual(['core.exact', 'core.prefix', 'core.alias', 'core.contains'])
    expect(searchSubjectCatalog(entries, 'junior-high', '科').map((item) => item.catalogKey))
      .toEqual(['core.alias', 'core.exact'])
  })

  it('normalizes trim, case and NFC without attempting phonetic conversion', () => {
    const entries = [entry('core.normalized', 'Café', 'CF', ['École'])]
    expect(normalizeSubjectText('  CAFE\u0301  ')).toBe('café')
    expect(searchSubjectCatalog(entries, 'junior-high', ' cafe\u0301 ')[0]?.catalogKey).toBe('core.normalized')
    expect(searchSubjectCatalog(entries, 'junior-high', 'éco')[0]?.catalogKey).toBe('core.normalized')
  })
})

describe('existing subject search', () => {
  const subjects: Subject[] = [
    { id: 'junior-id', name: '理化', shortName: '理', color: '#111111', applicableSchoolLevels: ['junior-high'] },
    { id: 'senior-id', name: '物理', shortName: '物', color: '#222222', applicableSchoolLevels: ['senior-high'] },
    { id: 'legacy-id', name: '舊科目', shortName: '舊', color: '#333333' },
  ]

  it('preserves IDs and applies legacy level compatibility', () => {
    expect(searchExistingSubjects(subjects, 'junior-high', '理').map((subject) => subject.id)).toEqual(['junior-id'])
    expect(searchExistingSubjects(subjects, 'senior-high', '理').map((subject) => subject.id)).toEqual(['senior-id'])
    expect(searchExistingSubjects(subjects, 'senior-high', '舊')[0]).toBe(subjects[2])
    expect(subjects.map((subject) => subject.id)).toEqual(['junior-id', 'senior-id', 'legacy-id'])
  })

  it('uses catalog aliases only for one unambiguous existing-subject match', () => {
    const catalog = [
      entry('core.chemistry', '理化', '理', ['理化科'], ['ㄌㄧˇㄏㄨㄚˋ', 'ㄌㄧˇ']),
    ]
    expect(searchExistingSubjects(subjects, 'junior-high', 'ㄌㄧˇ', catalog).map((subject) => subject.id))
      .toEqual(['junior-id'])

    const ambiguousCatalog = [
      ...catalog,
      entry('core.ambiguous', '自然科學', '自', ['理化'], ['ㄌㄧˇ']),
    ]
    expect(searchExistingSubjects(subjects, 'junior-high', 'ㄌㄧˇ', ambiguousCatalog)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import type { Subject } from '../types'
import { DEFAULT_SUBJECT_CATALOG, type SubjectCatalogEntry } from './defaultSubjects'
import { analyzeSubjectCatalog } from './subjectCatalogAnalysis'

const core = (name: string) => {
  const found = DEFAULT_SUBJECT_CATALOG.find((entry) => entry.name === name)
  if (!found) throw new Error(`Missing test catalog entry: ${name}`)
  return found
}

const subject = (id: string, name: string, shortName: string, levels?: Subject['applicableSchoolLevels']): Subject => ({
  id,
  name,
  shortName,
  color: '#ABCDEF',
  ...(levels ? { applicableSchoolLevels: levels } : {}),
})

describe('read-only subject catalog analysis', () => {
  it('distinguishes safe additions, applicable subjects and missing applicability', () => {
    const entries = [core('國語文'), core('理化'), core('數學')]
    const subjects = [
      subject('existing-chinese', '國語文', '國', ['junior-high']),
      subject('existing-chemistry', '理化', '理', ['senior-high']),
    ]
    const report = analyzeSubjectCatalog(subjects, 'junior-high', entries)
    expect(report.items.map((item) => [item.name, item.status])).toEqual([
      ['國語文', 'exists-applicable'],
      ['理化', 'exists-missing-level'],
      ['數學', 'safe-to-add'],
    ])
    expect(report.counts['exists-applicable']).toBe(1)
    expect(report.counts['exists-missing-level']).toBe(1)
    expect(report.counts['safe-to-add']).toBe(1)
    expect(report.hasConflicts).toBe(true)
  })

  it('requires review for duplicate same-name IDs and alias matches', () => {
    const duplicate = analyzeSubjectCatalog([
      subject('chinese-a', '國語文', '國甲', ['junior-high']),
      subject('chinese-b', ' 國語文 ', '國乙', ['junior-high']),
    ], 'junior-high', [core('國語文')])
    expect(duplicate.items[0]).toMatchObject({ status: 'same-name-review', existingSubjectIds: ['chinese-a', 'chinese-b'] })

    const alias = analyzeSubjectCatalog([
      subject('legacy-chinese', '國文', '國', ['junior-high']),
    ], 'junior-high', [core('國語文')])
    expect(alias.items[0]).toMatchObject({ status: 'alias-match-review', existingSubjectIds: ['legacy-chinese'] })
  })

  it('reports short-name, catalogKey/ID and invalid catalog conflicts independently', () => {
    expect(analyzeSubjectCatalog([
      subject('another', '數理', '理', ['junior-high']),
    ], 'junior-high', [core('理化')]).items[0]).toMatchObject({ status: 'short-name-conflict', existingSubjectIds: ['another'] })

    expect(analyzeSubjectCatalog([
      subject('core.physical-science', '既有科目', '既', ['junior-high']),
    ], 'junior-high', [core('理化')]).items[0]).toMatchObject({ status: 'catalog-key-id-conflict' })

    const invalid = {
      ...core('理化'),
      catalogKey: 'unsafe id',
      applicableSchoolLevels: ['junior-high', 'other-value'],
    } as unknown as SubjectCatalogEntry
    expect(analyzeSubjectCatalog([], 'junior-high', [invalid]).items[0]).toMatchObject({ status: 'invalid-catalog-entry' })
  })

  it('treats legacy subjects without applicability as available at every level', () => {
    const report = analyzeSubjectCatalog([subject('legacy-math', '數學', '數')], 'senior-high', [core('數學')])
    expect(report.items[0]).toMatchObject({ status: 'exists-applicable', existingSubjectIds: ['legacy-math'] })
  })

  it('is deterministic and does not mutate subjects, colors, IDs or external references', () => {
    const data = {
      subjects: [subject('existing-chinese', '國語文', '國', ['junior-high'])],
      recurringLessons: [{ id: 'lesson-1', subjectId: 'existing-chinese' }],
      overrides: [{ id: 'override-1', replacement: { subjectId: 'existing-chinese' } }],
    }
    const before = structuredClone(data)
    const first = analyzeSubjectCatalog(data.subjects, 'junior-high', [core('國語文'), core('理化')])
    const second = analyzeSubjectCatalog(data.subjects, 'junior-high', [core('國語文'), core('理化')])

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(data).toEqual(before)
    expect(data.subjects[0]).toMatchObject({ id: 'existing-chinese', color: '#ABCDEF' })
    expect(data.recurringLessons[0].subjectId).toBe('existing-chinese')
    expect(data.overrides[0].replacement.subjectId).toBe('existing-chinese')
  })

  it('does not include entries outside the selected level', () => {
    const report = analyzeSubjectCatalog([], 'junior-high', [core('理化'), core('物理')])
    expect(report.items.map((item) => item.name)).toEqual(['理化'])
  })
})

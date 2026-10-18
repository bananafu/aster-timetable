import { describe, expect, it } from 'vitest'
import { subjectsForLevel } from './subjects'
import type { Subject } from '../types'

describe('subject availability', () => {
  it('filters junior, senior, shared, other and legacy subjects consistently', () => {
    const subjects: Subject[] = [
      { id: 'j', name: 'Junior', shortName: 'J', color: '#000000', applicableSchoolLevels: ['junior-high'] },
      { id: 's', name: 'Senior', shortName: 'S', color: '#000000', applicableSchoolLevels: ['senior-high'] },
      { id: 'both', name: 'Both', shortName: 'B', color: '#000000', applicableSchoolLevels: ['junior-high', 'senior-high'] },
      { id: 'other', name: 'Other', shortName: 'O', color: '#000000', applicableSchoolLevels: ['other'] },
      { id: 'old', name: 'Old', shortName: 'L', color: '#000000' },
    ]
    expect(subjectsForLevel(subjects, 'junior-high').map((item) => item.id)).toEqual(['j', 'both', 'old'])
    expect(subjectsForLevel(subjects, 'senior-high').map((item) => item.id)).toEqual(['s', 'both', 'old'])
    expect(subjectsForLevel(subjects, 'other').map((item) => item.id)).toEqual(['other', 'old'])
    expect(subjectsForLevel(subjects)).toEqual([])
  })
})

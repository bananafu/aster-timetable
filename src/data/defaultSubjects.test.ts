import { describe, expect, it } from 'vitest'
import { SCHOOL_LEVELS, type SchoolLevel } from '../types'
import { DEFAULT_SUBJECT_CATALOG, OPTIONAL_SUBJECT_CATALOG } from './defaultSubjects'

const normalized = (value: string) => value.trim().normalize('NFC').toLocaleLowerCase('zh-TW')
const appliesTo = (levels: readonly SchoolLevel[], level: SchoolLevel) => levels.includes(level)

describe('default subject catalog', () => {
  it('uses unique stable keys, names and short names with valid fields', () => {
    const entries = [...DEFAULT_SUBJECT_CATALOG, ...OPTIONAL_SUBJECT_CATALOG]
    expect(new Set(entries.map((entry) => entry.catalogKey)).size).toBe(entries.length)
    expect(new Set(entries.map((entry) => normalized(entry.name))).size).toBe(entries.length)
    expect(new Set(entries.map((entry) => normalized(entry.shortName))).size).toBe(entries.length)

    for (const entry of entries) {
      expect(entry.catalogKey).toMatch(/^(?:core|optional)\.[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(entry.name.trim()).toBe(entry.name)
      expect(entry.shortName.trim()).toBe(entry.shortName)
      expect(entry.color).toMatch(/^#[0-9A-F]{6}$/)
      expect(entry.applicableSchoolLevels.length).toBeGreaterThan(0)
      expect(new Set(entry.applicableSchoolLevels).size).toBe(entry.applicableSchoolLevels.length)
      expect(entry.applicableSchoolLevels.every((level) => SCHOOL_LEVELS.includes(level))).toBe(true)
      expect(entry.aliases.every((alias) => alias.trim().length > 0)).toBe(true)
      expect(entry.zhuyinAliases.every((alias) => alias.trim().length > 0)).toBe(true)
    }
  })

  it('keeps shared subjects as one entry and optional courses outside the core catalog', () => {
    const junior = DEFAULT_SUBJECT_CATALOG.filter((entry) => appliesTo(entry.applicableSchoolLevels, 'junior-high'))
    const senior = DEFAULT_SUBJECT_CATALOG.filter((entry) => appliesTo(entry.applicableSchoolLevels, 'senior-high'))
    const shared = DEFAULT_SUBJECT_CATALOG.filter((entry) => entry.applicableSchoolLevels.length === 2)

    expect(DEFAULT_SUBJECT_CATALOG).toHaveLength(29)
    expect(junior).toHaveLength(20)
    expect(senior).toHaveLength(23)
    expect(shared).toHaveLength(14)
    expect(DEFAULT_SUBJECT_CATALOG.filter((entry) => entry.name === '國語文')).toHaveLength(1)
    expect(DEFAULT_SUBJECT_CATALOG.find((entry) => entry.name === '國語文')?.applicableSchoolLevels)
      .toEqual(['junior-high', 'senior-high'])

    expect(OPTIONAL_SUBJECT_CATALOG).toHaveLength(5)
    expect(OPTIONAL_SUBJECT_CATALOG.map((entry) => entry.name))
      .toEqual(['班會', '社團', '自習', '彈性學習', '校訂課程'])
    const coreNames = new Set<string>(DEFAULT_SUBJECT_CATALOG.map((entry) => entry.name))
    expect(OPTIONAL_SUBJECT_CATALOG.some((entry) => coreNames.has(entry.name))).toBe(false)
  })

  it('keeps level-specific science subjects separate', () => {
    expect(DEFAULT_SUBJECT_CATALOG.find((entry) => entry.name === '理化')?.applicableSchoolLevels).toEqual(['junior-high'])
    expect(DEFAULT_SUBJECT_CATALOG.find((entry) => entry.name === '物理')?.applicableSchoolLevels).toEqual(['senior-high'])
    expect(DEFAULT_SUBJECT_CATALOG.find((entry) => entry.name === '化學')?.applicableSchoolLevels).toEqual(['senior-high'])
  })
})

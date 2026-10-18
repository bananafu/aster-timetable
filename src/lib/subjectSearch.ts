import type { SubjectCatalogEntry } from '../data/defaultSubjects'
import type { SchoolLevel, Subject } from '../types'
import { subjectAppliesToLevel } from './subjects'

export function normalizeSubjectText(value: string): string {
  return value.trim().normalize('NFC').toLocaleLowerCase('zh-TW')
}

type Ranked<T> = { item: T; index: number; rank: number }

function matchRank(query: string, values: readonly string[]): number | null {
  if (!query) return 3
  const normalized = values.map(normalizeSubjectText).filter(Boolean)
  if (normalized.some((value) => value === query)) return 0
  if (normalized.some((value) => value.startsWith(query))) return 1
  if (normalized.some((value) => value.includes(query))) return 2
  return null
}

function stableSearch<T>(items: readonly T[], query: string, values: (item: T) => readonly string[]): T[] {
  const needle = normalizeSubjectText(query)
  return items.flatMap((item, index): Ranked<T>[] => {
    const rank = matchRank(needle, values(item))
    return rank === null ? [] : [{ item, index, rank }]
  }).sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ item }) => item)
}

export function searchSubjectCatalog(entries: readonly SubjectCatalogEntry[], schoolLevel: SchoolLevel, query: string): SubjectCatalogEntry[] {
  return stableSearch(entries.filter((entry) => entry.applicableSchoolLevels.includes(schoolLevel)), query,
    (entry) => [entry.name, entry.shortName, ...entry.aliases, ...entry.zhuyinAliases])
}

function matchingCatalogEntry(subject: Subject, schoolLevel: SchoolLevel, entries: readonly SubjectCatalogEntry[]): SubjectCatalogEntry | undefined {
  const subjectName = normalizeSubjectText(subject.name)
  const matches = entries.filter((entry) => entry.applicableSchoolLevels.includes(schoolLevel)
    && [entry.name, ...entry.aliases].some((value) => normalizeSubjectText(value) === subjectName))
  return matches.length === 1 ? matches[0] : undefined
}

export function searchExistingSubjects(subjects: readonly Subject[], schoolLevel: SchoolLevel, query: string, catalog: readonly SubjectCatalogEntry[] = []): Subject[] {
  return stableSearch(subjects.filter((subject) => subjectAppliesToLevel(subject, schoolLevel)), query,
    (subject) => {
      const match = matchingCatalogEntry(subject, schoolLevel, catalog)
      return match
        ? [subject.name, subject.shortName, match.name, match.shortName, ...match.aliases, ...match.zhuyinAliases]
        : [subject.name, subject.shortName]
    })
}


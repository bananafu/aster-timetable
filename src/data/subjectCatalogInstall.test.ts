import { describe, expect, it } from 'vitest'
import { createInitialAppDataV6 } from '../hooks/useAppDataV4'
import { createBlankProject } from './projectRuntime'
import { DEFAULT_SUBJECT_CATALOG, OPTIONAL_SUBJECT_CATALOG } from './defaultSubjects'
import { initialData } from './seed'
import { migrateV3ToV4 } from './migrationsV4'
import { migrateV4ToV5 } from './migrationsV5'
import { migrateV5ToV6 } from './migrationsV6'
import { installSafeSubjectCatalog, previewSubjectCatalogInstall, type CatalogSchoolLevel } from './subjectCatalogInstall'
import { isCompatibleAppDataV6 } from './validators/v6'

function setup() {
  let index = 0
  return createBlankProject(createInitialAppDataV6(), {
    name: '教師專案', teacherName: '林老師', academicYear: 115, semester: 'first',
    startDate: '2026-08-31', endDate: '2027-01-20',
  }, () => `setup-${++index}`, '2026-08-01T00:00:00.000Z')
}

const ids = () => { let index = 0; return () => `subject-${++index}` }
const install = (levels: CatalogSchoolLevel[], optionalKeys: string[] = []) => {
  const data = setup()
  const preview = previewSubjectCatalogInstall(data, levels, optionalKeys)
  return { data, preview, result: installSafeSubjectCatalog(data, preview, ids()) }
}

describe('safe subject catalog installation', () => {
  it('previews and installs an empty library for each level with one shared ID', () => {
    for (const [levels, count] of [[['junior-high'], 20], [['senior-high'], 23], [['junior-high', 'senior-high'], 29]] as const) {
      const { data, preview, result } = install([...levels], [])
      expect(preview.counts).toEqual({ 'safe-to-add': count, 'exists-applicable': 0, 'needs-review': 0 })
      expect(result.data.subjects).toHaveLength(count)
      expect(result.addedSubjectIds).toHaveLength(count)
      expect(isCompatibleAppDataV6(result.data)).toBe(true)
      expect(data.subjects).toEqual([])
      expect(result.data.subjects.some((subject) => subject.id.startsWith('core.'))).toBe(false)
    }
    const both = install(['junior-high', 'senior-high']).result.data
    expect(both.subjects.filter((subject) => subject.name === '國語文')).toHaveLength(1)
    expect(both.subjects.find((subject) => subject.name === '國語文')?.applicableSchoolLevels).toEqual(['junior-high', 'senior-high'])
    expect(both.subjects.find((subject) => subject.name === '理化')?.applicableSchoolLevels).toEqual(['junior-high'])
    expect(both.subjects.find((subject) => subject.name === '物理')?.applicableSchoolLevels).toEqual(['senior-high'])
  })

  it('leaves optional entries out until selected', () => {
    const ordinary = install(['junior-high', 'senior-high']).result.data
    expect(ordinary.subjects.some((subject) => subject.name === '班會')).toBe(false)
    const selected = install(['junior-high', 'senior-high'], [OPTIONAL_SUBJECT_CATALOG[0].catalogKey]).result.data
    expect(selected.subjects.filter((subject) => subject.name === '班會')).toHaveLength(1)
    expect(selected.subjects).toHaveLength(DEFAULT_SUBJECT_CATALOG.length + 1)
  })

  it('is idempotent after a fresh preview and preserves existing ID, color and references', () => {
    const first = install(['junior-high', 'senior-high']).result.data
    const original = first.subjects.find((subject) => subject.name === '國語文')!
    const before = structuredClone(first)
    const secondPreview = previewSubjectCatalogInstall(first, ['junior-high', 'senior-high'])
    const second = installSafeSubjectCatalog(first, secondPreview, ids())
    expect(second.addedSubjectIds).toEqual([])
    expect(second.data).toBe(first)
    expect(first).toEqual(before)
    expect(first.subjects.find((subject) => subject.name === '國語文')).toMatchObject({ id: original.id, color: original.color })
  })

  it('reports conflicting existing names, aliases, missing levels and short names while adding only safe items', () => {
    const data = setup()
    data.subjects.push(
      { id: 'existing-math', name: '數學', shortName: '數', color: '#111111', applicableSchoolLevels: ['junior-high'] },
      { id: 'existing-chinese', name: '國文', shortName: '國', color: '#222222', applicableSchoolLevels: ['junior-high'] },
      { id: 'existing-short', name: '實驗課', shortName: '理', color: '#333333', applicableSchoolLevels: ['junior-high'] },
    )
    const before = structuredClone(data)
    const preview = previewSubjectCatalogInstall(data, ['junior-high', 'senior-high'])
    expect(preview.items.find((item) => item.name === '數學')).toMatchObject({ status: 'needs-review', existingSubjectIds: ['existing-math'] })
    expect(preview.items.find((item) => item.name === '國語文')).toMatchObject({ status: 'needs-review', existingSubjectIds: ['existing-chinese'] })
    expect(preview.items.find((item) => item.name === '理化')).toMatchObject({ status: 'needs-review', existingSubjectIds: ['existing-short'] })
    const result = installSafeSubjectCatalog(data, preview, ids())
    expect(result.data.subjects.find((subject) => subject.id === 'existing-math')).toEqual(before.subjects[0])
    expect(result.data.subjects.find((subject) => subject.id === 'existing-chinese')).toEqual(before.subjects[1])
    expect(result.data.subjects.find((subject) => subject.id === 'existing-short')).toEqual(before.subjects[2])
    expect(result.data.subjects.some((subject) => subject.name === '數學')).toBe(true)
    expect(result.data.subjects.some((subject) => subject.name === '理化')).toBe(false)
    expect(data).toEqual(before)
  })

  it('rejects stale data and aborts a batch when a generated ID or validator fails', () => {
    const data = setup()
    const preview = previewSubjectCatalogInstall(data, ['junior-high'])
    const changed = { ...data, subjects: [{ id: 'new-conflict', name: '理化', shortName: '理', color: '#123456', applicableSchoolLevels: ['junior-high' as const] }] }
    expect(() => installSafeSubjectCatalog(changed, preview, ids())).toThrow(/重新預覽/)
    expect(changed.subjects).toHaveLength(1)

    const before = structuredClone(data)
    let calls = 0
    expect(() => installSafeSubjectCatalog(data, preview, () => ++calls === 2 ? 'core.physical-science' : `subject-${calls}`)).toThrow(/整批未寫入/)
    expect(data).toEqual(before)
    expect(() => installSafeSubjectCatalog(data, preview, () => 'duplicate-id')).toThrow(/整批未寫入/)
    expect(data).toEqual(before)

    const invalid = structuredClone(data)
    invalid.teachingUnits[0].schoolId = 'missing-school'
    const invalidPreview = previewSubjectCatalogInstall(invalid, ['junior-high'])
    const invalidBefore = structuredClone(invalid)
    expect(() => installSafeSubjectCatalog(invalid, invalidPreview, ids())).toThrow(/未通過驗證/)
    expect(invalid).toEqual(invalidBefore)
  })

  it('does not install when the active project is archived', () => {
    const data = setup()
    const preview = previewSubjectCatalogInstall(data, ['senior-high'])
    const archived = { ...data, projects: data.projects.map((project) => ({ ...project, archivedAt: '2027-02-01T00:00:00.000Z' })) }
    expect(() => installSafeSubjectCatalog(archived, preview, ids())).toThrow(/封存專案/)
    expect(archived.subjects).toEqual([])
  })

  it('preserves existing lessons, overrides and existing Subject metadata in a migrated library', () => {
    const data = migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))
    const before = structuredClone(data)
    const preview = previewSubjectCatalogInstall(data, ['junior-high', 'senior-high'])
    expect(preview.counts['needs-review']).toBeGreaterThan(0)
    const result = installSafeSubjectCatalog(data, preview, ids())
    expect(result.data.recurringLessons).toEqual(before.recurringLessons)
    expect(result.data.overrides).toEqual(before.overrides)
    expect(result.data.subjects.slice(0, before.subjects.length)).toEqual(before.subjects)
    expect(data).toEqual(before)
  })
})

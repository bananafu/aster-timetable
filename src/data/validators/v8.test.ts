import { describe, expect, it } from 'vitest'
import type { AppDataV8, TeachingProgress, TeachingProgressContent } from '../../types'
import { deleteProject } from '../projectRuntime'
import { initialData } from '../seed'
import { migrateV3ToV4 } from '../migrationsV4'
import { migrateV4ToV5 } from '../migrationsV5'
import { migrateV5ToV6 } from '../migrationsV6'
import { migrateV6ToV7 } from '../migrationsV7'
import { migrateV7ToV8 } from '../migrationsV8'
import {
  isCompatibleAppDataV8,
  isSafeAppDataV8Update,
  isTeachingProgressRestore,
  TEACHING_PROGRESS_TEXT_LIMITS,
} from './v8'

const progressId = '123e4567-e89b-42d3-a456-426614174000'
const secondProgressId = '223e4567-e89b-42d3-a456-426614174001'
const createdAt = '2026-10-20T01:00:00.000Z'
const updatedAt = '2026-10-20T02:00:00.000Z'
const laterAt = '2026-10-20T03:00:00.000Z'

const base = () => migrateV7ToV8(migrateV6ToV7(migrateV5ToV6(migrateV4ToV5(migrateV3ToV4(structuredClone(initialData))))))

function progressFor(data: AppDataV8, change: Partial<TeachingProgress> = {}): TeachingProgress {
  const lesson = data.recurringLessons[0]
  return {
    id: progressId,
    projectId: lesson.projectId,
    timetableId: lesson.timetableId,
    teachingUnitId: lesson.teachingUnitId,
    classId: lesson.classId,
    subjectId: lesson.subjectId,
    content: { chapter: '第一章', unit: '第一單元', note: '已完成例題。' },
    previousProgress: null,
    createdAt,
    updatedAt: createdAt,
    ...change,
  }
}

function withProgress(change: Partial<TeachingProgress> = {}): AppDataV8 {
  const data = base()
  return { ...data, teachingProgress: [progressFor(data, change)] }
}

function edit(current: AppDataV8, content: TeachingProgressContent = { chapter: '第二章', unit: '', note: '開始新內容。' }): AppDataV8 {
  const before = current.teachingProgress[0]
  return { ...current, teachingProgress: [{
    ...before,
    content,
    previousProgress: { content: structuredClone(before.content), updatedAt: before.updatedAt },
    updatedAt,
  }] }
}

describe('AppDataV8 compatibility', () => {
  it('accepts a valid migrated document and a fully scoped progress record', () => {
    const migrated = base()
    expect(isCompatibleAppDataV8(migrated)).toBe(true)
    expect(isCompatibleAppDataV8(withProgress())).toBe(true)
  })

  it('requires schema v8, the progress collection, valid v7 data, and exact progress fields', () => {
    const data = withProgress()
    expect(isCompatibleAppDataV8({ ...data, schemaVersion: 7 })).toBe(false)
    expect(isCompatibleAppDataV8({ ...data, teachingProgress: undefined })).toBe(false)
    expect(isCompatibleAppDataV8({ ...data, recurringLessons: [{ ...data.recurringLessons[0], classId: 'missing' }] })).toBe(false)
    expect(isCompatibleAppDataV8({ ...data, teachingProgress: [{ ...data.teachingProgress[0], extra: true }] })).toBe(false)
    expect(isCompatibleAppDataV8({ ...data, teachingProgress: [{
      ...data.teachingProgress[0], content: { ...data.teachingProgress[0].content, extra: true },
    }] })).toBe(false)
  })

  it('requires UUID v4 progress IDs and rejects collisions with every existing entity ID', () => {
    const data = withProgress()
    expect(isCompatibleAppDataV8({ ...data, teachingProgress: [{ ...data.teachingProgress[0], id: 'not-a-uuid' }] })).toBe(false)
    const unit = data.teachingUnits.find((item) => item.id === data.teachingProgress[0].teachingUnitId)!
    const collision = { ...data, oneOffLessons: [...data.oneOffLessons, {
      id: progressId,
      projectId: data.teachingProgress[0].projectId,
      timetableId: data.teachingProgress[0].timetableId,
      teachingUnitId: unit.id,
      classId: data.teachingProgress[0].classId,
      subjectId: data.teachingProgress[0].subjectId,
      date: unit.startDate,
      purpose: 'extra' as const,
      time: { mode: 'period' as const, periodId: unit.periods[0].id },
    }] }
    expect(isCompatibleAppDataV8(collision)).toBe(false)
  })

  it('rejects duplicate project/timetable/unit/class/subject scopes', () => {
    const data = withProgress()
    expect(isCompatibleAppDataV8({ ...data, teachingProgress: [
      data.teachingProgress[0], { ...data.teachingProgress[0], id: secondProgressId },
    ] })).toBe(false)
  })

  it('requires every scope reference to exist and belong to the same scope', () => {
    const data = withProgress()
    for (const field of ['projectId', 'timetableId', 'teachingUnitId', 'classId', 'subjectId'] as const) {
      expect(isCompatibleAppDataV8({ ...data, teachingProgress: [{
        ...data.teachingProgress[0], [field]: `missing-${field}`,
      }] })).toBe(false)
    }
    const unit = data.teachingUnits.find((item) => item.id === data.teachingProgress[0].teachingUnitId)!
    const otherUnit = { ...structuredClone(unit), id: 'other-unit', name: 'Other unit' }
    expect(isCompatibleAppDataV8({
      ...data,
      teachingUnits: [...data.teachingUnits, otherUnit],
      teachingProgress: [{ ...data.teachingProgress[0], teachingUnitId: otherUnit.id }],
    })).toBe(false)
    const otherLevel = unit.schoolLevel === 'junior-high' ? 'senior-high' : 'junior-high'
    const otherSubject = {
      id: 'other-subject', projectId: data.teachingProgress[0].projectId,
      name: 'Other', shortName: 'Other', color: '#000000', applicableSchoolLevels: [otherLevel],
    }
    expect(isCompatibleAppDataV8({
      ...data,
      subjects: [...data.subjects, otherSubject],
      teachingProgress: [{ ...data.teachingProgress[0], subjectId: otherSubject.id }],
    })).toBe(false)
    const secondProject = { ...structuredClone(data.projects[0]), id: 'second-project', name: 'Second project' }
    const secondTimetable = { ...structuredClone(data.timetables[0]), id: 'second-timetable', projectId: secondProject.id }
    expect(isCompatibleAppDataV8({
      ...data,
      projects: [...data.projects, secondProject],
      timetables: [...data.timetables, secondTimetable],
      teachingProgress: [{ ...data.teachingProgress[0], timetableId: secondTimetable.id }],
    })).toBe(false)
  })

  it('requires Subject ownership, project-scoped names, and globally collision-free Subject IDs', () => {
    const data = base()
    const subject = data.subjects[0]
    const secondProject = { ...data.projects[0], id: 'second-project', name: 'Second project' }
    const independent = { ...subject, id: 'second-project-subject', projectId: secondProject.id }
    const sameNameInAnotherProject = {
      ...data,
      projects: [...data.projects, secondProject],
      subjects: [...data.subjects, independent],
    }
    expect(isCompatibleAppDataV8(sameNameInAnotherProject)).toBe(true)
    expect(isSafeAppDataV8Update(data, sameNameInAnotherProject)).toBe(true)

    expect(isCompatibleAppDataV8({
      ...data,
      subjects: [...data.subjects, { ...subject, id: 'duplicate-subject' }],
    })).toBe(false)
    expect(isCompatibleAppDataV8({
      ...data,
      subjects: data.subjects.map((item, index) => index === 0 ? { ...item, projectId: 'missing-project' } : item),
    })).toBe(false)
    expect(isCompatibleAppDataV8({
      ...data,
      subjects: [...data.subjects, {
        ...subject, id: data.classes[0].id, name: 'Collision', shortName: 'Collision',
      }],
    })).toBe(false)
    expect(isCompatibleAppDataV8({
      ...sameNameInAnotherProject,
      recurringLessons: data.recurringLessons.map((lesson, index) => index === 0
        ? { ...lesson, subjectId: independent.id }
        : lesson),
    })).toBe(false)
  })

  it('enforces NFC, trimmed code-point limits, and non-empty content', () => {
    const data = withProgress()
    const invalidContents: TeachingProgressContent[] = [
      { chapter: '', unit: '', note: '' },
      { chapter: ' 第一章', unit: '', note: '' },
      { chapter: 'e\u0301', unit: '', note: '' },
      { chapter: '章'.repeat(TEACHING_PROGRESS_TEXT_LIMITS.chapter + 1), unit: '', note: '' },
      { chapter: '', unit: '單'.repeat(TEACHING_PROGRESS_TEXT_LIMITS.unit + 1), note: '' },
      { chapter: '', unit: '', note: '註'.repeat(TEACHING_PROGRESS_TEXT_LIMITS.note + 1) },
    ]
    for (const content of invalidContents) {
      expect(isCompatibleAppDataV8({ ...data, teachingProgress: [{ ...data.teachingProgress[0], content }] })).toBe(false)
    }
    expect(isCompatibleAppDataV8({ ...data, teachingProgress: [{
      ...data.teachingProgress[0], content: { chapter: '😀'.repeat(120), unit: '', note: '' },
    }] })).toBe(true)
  })

  it('requires canonical UTC timestamps and a strictly ordered valid snapshot', () => {
    const data = withProgress({ updatedAt, previousProgress: {
      content: { chapter: '舊章節', unit: '', note: '' }, updatedAt: createdAt,
    } })
    expect(isCompatibleAppDataV8(data)).toBe(true)
    for (const value of ['2026-10-20T02:00:00Z', '2026-10-20T10:00:00.000+08:00', 'invalid']) {
      expect(isCompatibleAppDataV8({ ...data, teachingProgress: [{ ...data.teachingProgress[0], updatedAt: value }] })).toBe(false)
    }
    expect(isCompatibleAppDataV8(withProgress({ createdAt: updatedAt, updatedAt: createdAt }))).toBe(false)
    expect(isCompatibleAppDataV8(withProgress({ updatedAt, previousProgress: {
      content: { chapter: '舊章節', unit: '', note: '' }, updatedAt,
    } }))).toBe(false)
    expect(isCompatibleAppDataV8(withProgress({ updatedAt, previousProgress: {
      content: { chapter: '', unit: '', note: '' }, updatedAt: createdAt,
    } }))).toBe(false)
  })
})

describe('AppDataV8 safe updates', () => {
  it('allows a new record only in an editable project with null history and equal initial timestamps', () => {
    const current = base()
    const added = { ...current, teachingProgress: [progressFor(current)] }
    expect(isSafeAppDataV8Update(current, added)).toBe(true)
    expect(isSafeAppDataV8Update(current, { ...added, teachingProgress: [{
      ...added.teachingProgress[0], previousProgress: {
        content: { chapter: '舊內容', unit: '', note: '' }, updatedAt: createdAt,
      }, updatedAt,
    }] })).toBe(false)
    expect(isSafeAppDataV8Update(current, { ...added, teachingProgress: [{
      ...added.teachingProgress[0], updatedAt,
    }] })).toBe(false)
    const archived = {
      ...current,
      activeProjectId: null,
      projects: current.projects.map((item) => ({ ...item, archivedAt: updatedAt, updatedAt })),
    }
    expect(isCompatibleAppDataV8({ ...archived, teachingProgress: [progressFor(archived)] })).toBe(true)
    expect(isSafeAppDataV8Update(archived, { ...archived, teachingProgress: [progressFor(archived)] })).toBe(false)
  })

  it('requires immutable identity/scope/createdAt and an exact previous snapshot for edits', () => {
    const current = withProgress()
    const next = edit(current)
    expect(isSafeAppDataV8Update(current, next)).toBe(true)
    expect(isSafeAppDataV8Update(current, { ...next, teachingProgress: [{ ...next.teachingProgress[0], classId: 'missing' }] })).toBe(false)
    expect(isSafeAppDataV8Update(current, { ...next, teachingProgress: [{ ...next.teachingProgress[0], createdAt: '2026-10-20T00:30:00.000Z' }] })).toBe(false)
    expect(isSafeAppDataV8Update(current, { ...next, teachingProgress: [{
      ...next.teachingProgress[0], previousProgress: { ...next.teachingProgress[0].previousProgress!, updatedAt: '2026-10-20T01:30:00.000Z' },
    }] })).toBe(false)
    expect(isSafeAppDataV8Update(current, { ...next, teachingProgress: [{ ...next.teachingProgress[0], updatedAt: createdAt }] })).toBe(false)
  })

  it('accepts a restore transition and exposes an intent check for the future domain operation', () => {
    const current = withProgress({
      content: { chapter: '目前內容', unit: '', note: '' },
      previousProgress: { content: { chapter: '前次內容', unit: '', note: '' }, updatedAt },
      updatedAt: laterAt,
    })
    const restored = { ...current.teachingProgress[0],
      content: structuredClone(current.teachingProgress[0].previousProgress!.content),
      previousProgress: { content: structuredClone(current.teachingProgress[0].content), updatedAt: laterAt },
      updatedAt: '2026-10-20T04:00:00.000Z',
    }
    const next = { ...current, teachingProgress: [restored] }
    expect(isTeachingProgressRestore(current.teachingProgress[0], restored)).toBe(true)
    expect(isSafeAppDataV8Update(current, next)).toBe(true)
    expect(isTeachingProgressRestore(current.teachingProgress[0], edit(current).teachingProgress[0])).toBe(false)
  })

  it('allows a no-op and explicit clear, but rejects timestamp, snapshot, and same-scope replacement tricks', () => {
    const current = withProgress()
    expect(isSafeAppDataV8Update(current, current)).toBe(true)
    expect(isSafeAppDataV8Update(current, { ...current, teachingProgress: [{
      ...current.teachingProgress[0], updatedAt,
    }] })).toBe(false)
    expect(isSafeAppDataV8Update(current, { ...current, teachingProgress: [] })).toBe(true)
    expect(isSafeAppDataV8Update(current, { ...current, teachingProgress: [{
      ...current.teachingProgress[0], id: secondProgressId,
    }] })).toBe(false)
  })

  it('keeps archived project progress and snapshots byte-for-byte unchanged', () => {
    const source = withProgress()
    const current = {
      ...source,
      activeProjectId: null,
      projects: source.projects.map((item) => ({ ...item, archivedAt: updatedAt, updatedAt })),
    }
    expect(isCompatibleAppDataV8(current)).toBe(true)
    expect(isSafeAppDataV8Update(current, current)).toBe(true)
    expect(isSafeAppDataV8Update(current, edit(current))).toBe(false)
    expect(isSafeAppDataV8Update(current, { ...current, teachingProgress: [] })).toBe(false)
  })

  it('blocks deleting progress together with its subject, class, or teaching unit', () => {
    const subjectData = base()
    const unit = subjectData.teachingUnits[0]
    const subject = {
      id: 'progress-only-subject', projectId: unit.projectId,
      name: 'Progress only', shortName: 'Progress', color: '#000000', applicableSchoolLevels: [unit.schoolLevel],
    }
    const subjectCurrent = {
      ...subjectData,
      subjects: [...subjectData.subjects, subject],
      teachingProgress: [progressFor(subjectData, { subjectId: subject.id })],
    }
    expect(isCompatibleAppDataV8(subjectCurrent)).toBe(true)
    expect(isSafeAppDataV8Update(subjectCurrent, {
      ...subjectCurrent, subjects: subjectData.subjects, teachingProgress: [],
    })).toBe(false)

    const classData = base()
    const schoolClass = { id: 'progress-only-class', projectId: unit.projectId, teachingUnitId: unit.id, name: 'Progress only' }
    const classCurrent = {
      ...classData,
      classes: [...classData.classes, schoolClass],
      teachingProgress: [progressFor(classData, { classId: schoolClass.id })],
    }
    expect(isCompatibleAppDataV8(classCurrent)).toBe(true)
    expect(isSafeAppDataV8Update(classCurrent, {
      ...classCurrent, classes: classData.classes, teachingProgress: [],
    })).toBe(false)

    const unitData = base()
    const orphanUnit = { ...structuredClone(unitData.teachingUnits[0]), id: 'progress-only-unit', name: 'Progress only' }
    const orphanClass = { id: 'progress-unit-class', projectId: orphanUnit.projectId, teachingUnitId: orphanUnit.id, name: 'Progress only' }
    const unitCurrent = {
      ...unitData,
      teachingUnits: [...unitData.teachingUnits, orphanUnit],
      classes: [...unitData.classes, orphanClass],
      teachingProgress: [progressFor(unitData, { teachingUnitId: orphanUnit.id, classId: orphanClass.id })],
    }
    expect(isCompatibleAppDataV8(unitCurrent)).toBe(true)
    expect(isSafeAppDataV8Update(unitCurrent, {
      ...unitCurrent, teachingUnits: unitData.teachingUnits, classes: unitData.classes, teachingProgress: [],
    })).toBe(false)
  })

  it('allows validated atomic timetable and project deletion cascades', () => {
    const current = withProgress()
    const timetableId = current.teachingProgress[0].timetableId
    const lessonIds = new Set(current.recurringLessons.filter((item) => item.timetableId === timetableId).map((item) => item.id))
    const timetableDeleted: AppDataV8 = {
      ...current,
      timetables: current.timetables.filter((item) => item.id !== timetableId),
      recurringLessons: current.recurringLessons.filter((item) => item.timetableId !== timetableId),
      overrides: current.overrides.filter((item) => item.timetableId !== timetableId),
      oneOffLessons: current.oneOffLessons.filter((item) => item.timetableId !== timetableId),
      migrationWarnings: current.migrationWarnings.filter((item) => !(item.entityType === 'lesson' && lessonIds.has(item.entityId))),
      teachingProgress: [],
    }
    expect(isCompatibleAppDataV8(timetableDeleted)).toBe(true)
    expect(isSafeAppDataV8Update(current, timetableDeleted)).toBe(true)
    expect(isSafeAppDataV8Update(current, {
      ...timetableDeleted,
      subjects: timetableDeleted.subjects.filter((item) => item.id !== current.teachingProgress[0].subjectId),
    })).toBe(false)

    const projectId = current.teachingProgress[0].projectId
    const projectDeleted = {
      ...(deleteProject(current, projectId) as AppDataV8),
      subjects: current.subjects.filter((item) => item.projectId !== projectId),
      teachingProgress: [],
    }
    expect(isCompatibleAppDataV8(projectDeleted)).toBe(true)
    expect(isSafeAppDataV8Update(current, projectDeleted)).toBe(true)
  })

  it('protects Subject ownership, archived Projects, and delete-and-unlink batches', () => {
    const baseData = base()
    const projectId = baseData.projects[0].id
    const addedSubject = {
      id: 'unreferenced-subject', projectId, name: 'Unreferenced', shortName: 'Unused',
      color: '#000000', applicableSchoolLevels: [baseData.teachingUnits[0].schoolLevel],
    }
    const current = { ...baseData, subjects: [...baseData.subjects, addedSubject] }
    expect(isSafeAppDataV8Update(baseData, current)).toBe(true)

    const secondProject = { ...baseData.projects[0], id: 'second-project', name: 'Second project' }
    expect(isCompatibleAppDataV8({
      ...current,
      projects: [...current.projects, secondProject],
      subjects: current.subjects.map((item) => item.id === addedSubject.id
        ? { ...item, projectId: secondProject.id }
        : item),
    })).toBe(true)
    expect(isSafeAppDataV8Update(current, {
      ...current,
      projects: [...current.projects, secondProject],
      subjects: current.subjects.map((item) => item.id === addedSubject.id
        ? { ...item, projectId: secondProject.id }
        : item),
    })).toBe(false)

    const archived = {
      ...current,
      activeProjectId: null,
      projects: current.projects.map((project) => ({ ...project, archivedAt: updatedAt, updatedAt })),
    }
    expect(isCompatibleAppDataV8(archived)).toBe(true)
    expect(isSafeAppDataV8Update(archived, {
      ...archived,
      subjects: archived.subjects.map((subject) => subject.id === addedSubject.id
        ? { ...subject, name: 'Changed while archived' }
        : subject),
    })).toBe(false)

    const referencedId = baseData.recurringLessons[0].subjectId
    const withoutReferences = {
      ...baseData,
      recurringLessons: baseData.recurringLessons.filter((lesson) => lesson.subjectId !== referencedId),
      overrides: baseData.overrides.filter((override) => override.replacement?.subjectId !== referencedId),
      oneOffLessons: baseData.oneOffLessons.filter((lesson) => lesson.subjectId !== referencedId),
      subjects: baseData.subjects.filter((subject) => subject.id !== referencedId),
    }
    expect(isCompatibleAppDataV8(withoutReferences)).toBe(true)
    expect(isSafeAppDataV8Update(baseData, withoutReferences)).toBe(false)
  })
})

import { expect, test as base, type Browser, type Locator, type Page } from '@playwright/test'

export const FORMAL_V9_PATH = '?runtime=formal'
export const APP_DATA_V9_KEY = 'aster-timetable-data-v9'
export const V9_ACTIVATION_KEY = 'aster-timetable-data-v9-activation-v1'
export const V9_AUTO_BACKUP_PREFIX = 'toki-v9-auto-backup:'

export const FORMAL_V9_FIXTURE_IDS = {
  project: 'browser-smoke-project',
  school: 'browser-smoke-school',
  teachingUnit: 'browser-smoke-unit',
  timetable: 'browser-smoke-timetable',
  subject: 'browser-smoke-subject',
  subjectRelation: 'browser-smoke-subject-relation',
  schoolClass: 'browser-smoke-class',
  recurringLesson: 'browser-smoke-recurring-lesson',
  swapPartner: 'browser-smoke-swap-partner',
} as const

interface FormalV9BrowserFixtures {
  formalPage: Page
}

export const test = base.extend<FormalV9BrowserFixtures>({
  formalPage: async ({ browser }, provide, testInfo) => {
    const startedAt = performance.now()
    const context = await browser.newContext()
    await context.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,
      (route) => route.abort('blockedbyclient'))
    const page = await context.newPage()
    testInfo.annotations.push({
      type: 'formal-page-fixture-ms',
      description: String(Math.round(performance.now() - startedAt)),
    })
    await provide(page)
    await context.close()
  },
})

export { expect }

export interface FormalV9FixtureEvidence {
  initialRevision: number
  fixtureRevision: number
  activationAttemptId: string
  fixtureReceiptAttemptId: string
  periodIds: number[]
  periods: Array<{ id: number; startTime: string; endTime: string }>
  validDocument: boolean
  writeEvidenceValid: boolean
  runtime: string
  v9Status: string | null
}

export async function proveBrowserContextIsolation(browser: Browser, formalPage: Page): Promise<void> {
  expect(browser.browserType().name()).toBe('chromium')
  await formalPage.goto(FORMAL_V9_PATH, { waitUntil: 'domcontentloaded' })
  const tokiKeys = await formalPage.evaluate(() => Array.from(
    { length: localStorage.length }, (_, index) => localStorage.key(index),
  ).filter((key) => key?.startsWith('aster-timetable-') || key?.startsWith('toki-v9-')))
  expect(tokiKeys).toEqual([])
}

export async function initializeFormalV9ThroughProductionEntry(page: Page): Promise<void> {
  await expect(page.getByRole('dialog', { name: '開始使用 Toki' })).toBeVisible()
  await page.getByRole('button', { name: '建立', exact: true }).click()
  await expect(page.getByText('已儲存至此裝置', { exact: true })).toHaveText('已儲存至此裝置')
  await expect(page.getByRole('heading', { name: '建立你的第一份課表' })).toBeVisible()
}

export interface FormalV9FixtureOptions {
  startDate?: string
  endDate?: string
  anchorDate?: string
  anchorPattern?: 'A' | 'B'
}

export async function createFormalV9BrowserFixture(page: Page,
  options: FormalV9FixtureOptions = {}): Promise<FormalV9FixtureEvidence> {
  return page.evaluate(async ({ ids, fixtureOptions }) => {
    const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
    const [storage, management, subjects, lessons, academic, validators, runtime] = await Promise.all([
      import(moduleUrl('data/storageV9.ts')),
      import(moduleUrl('data/managementV9.ts')),
      import(moduleUrl('data/teacherSubjectsV9.ts')),
      import(moduleUrl('data/lessonMutationsV9.ts')),
      import(moduleUrl('data/academicSettingsV4.ts')),
      import(moduleUrl('data/validators/v9.ts')),
      import(moduleUrl('formalRuntime.ts')),
    ])
    const loaded = storage.loadAppDataV9(localStorage)
    if (loaded.status !== 'active' || !loaded.document || !loaded.metadata
      || !loaded.rawDocument || !loaded.rawMetadata) throw new Error(`fresh-runtime-${loaded.status}`)

    const initialRevision = loaded.metadata.documentRevision
    const now = new Date().toISOString()
    const periods = academic.createDefaultPeriods('senior-high')
    let next = management.createEmptyProjectV9(loaded.document,
      { name: 'Browser Smoke 專案' }, ids.project, now)
    next = management.createSchoolV9(next, ids.project,
      { name: 'Browser Smoke 高中', color: '#647C88' }, ids.school)
    next = management.createTeachingUnitV9(next, ids.project, {
      schoolId: ids.school,
      name: 'Browser Smoke 高中部',
      schoolLevel: 'senior-high',
      startDate: fixtureOptions.startDate ?? '2020-01-01',
      endDate: fixtureOptions.endDate ?? '2035-12-31',
      periods,
      weekCycle: { enabled: true, anchorDate: fixtureOptions.anchorDate ?? '2020-01-06',
        anchorPattern: fixtureOptions.anchorPattern ?? 'A' },
    }, ids.teachingUnit)
    next = subjects.createTeacherTimetableV9(next, ids.project,
      { name: 'Browser Smoke 課表', teacherName: 'Browser Smoke 教師' }, ids.timetable)
    next = subjects.createTeacherSubjectV9(next, ids.project, ids.timetable, {
      name: 'Browser Smoke 數學', shortName: '煙數', color: '#647C88',
      applicableSchoolLevels: ['senior-high'],
    }, ids.subject)
    next = subjects.configureTeacherSubjectV9(next, ids.project, ids.timetable,
      ids.teachingUnit, ids.subject, ids.subjectRelation)
    next = management.createClassV9(next, ids.project,
      { teachingUnitId: ids.teachingUnit, name: 'Browser Smoke 101' }, ids.schoolClass)
    next = management.configureProjectTermV9(next, ids.project,
      { academicYear: 115, semester: 'first' }, now)
    next = lessons.createRecurringLessonV9(next, {
      projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit,
    }, {
      projectId: ids.project,
      timetableId: ids.timetable,
      teachingUnitId: ids.teachingUnit,
      subjectId: ids.subject,
      classId: ids.schoolClass,
      day: 1,
      periodId: periods[0].id,
      weekPattern: 'A',
      effectiveStart: '2020-01-01',
      room: 'Smoke-A',
    }, ids.recurringLesson)
    if (!validators.isCompatibleAppDataV9(next)) throw new Error('fixture-validator-rejected')

    const receipt = await storage.persistAppDataV9(localStorage, loaded.document, next, {
      raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata, revision: loaded.metadata.documentRevision,
    })
    const decision = await runtime.inspectFormalRuntime(localStorage)
    return {
      initialRevision,
      fixtureRevision: receipt.revision,
      activationAttemptId: loaded.metadata.attemptId,
      fixtureReceiptAttemptId: receipt.attemptId,
      periodIds: periods.map((period: { id: number }) => period.id),
      periods: periods.map((period: { id: number; startTime: string; endTime: string }) => ({
        id: period.id, startTime: period.startTime, endTime: period.endTime,
      })),
      validDocument: validators.isCompatibleAppDataV9(next),
      writeEvidenceValid: await storage.checkV9WriteEvidence(localStorage, receipt.raw,
        localStorage.getItem(storage.V9_ACTIVATION_KEY) ?? ''),
      runtime: decision.runtime,
      v9Status: 'v9Status' in decision ? decision.v9Status : null,
    }
  }, { ids: FORMAL_V9_FIXTURE_IDS, fixtureOptions: options })
}

export async function seedFormalV9SwapPartner(page: Page, day: 1 | 2,
  weekPattern: 'every' | 'A' | 'B' = 'every') {
  return page.evaluate(async ({ ids, partnerDay, partnerWeekPattern }) => {
    const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
    const [storage, lessons, validators, runtime] = await Promise.all([
      import(moduleUrl('data/storageV9.ts')),
      import(moduleUrl('data/lessonMutationsV9.ts')),
      import(moduleUrl('data/validators/v9.ts')),
      import(moduleUrl('formalRuntime.ts')),
    ])
    const loaded = storage.loadAppDataV9(localStorage)
    if (loaded.status !== 'active' || !loaded.document || !loaded.metadata
      || !loaded.rawDocument || !loaded.rawMetadata) throw new Error(`swap-runtime-${loaded.status}`)
    const periods = loaded.document.teachingUnits
      .find((item: { id: string }) => item.id === ids.teachingUnit)!.periods
    const scope = { projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit }
    const next = lessons.createRecurringLessonV9(loaded.document, scope, {
      ...scope, subjectId: ids.subject, classId: ids.schoolClass, day: partnerDay,
      periodId: periods[1].id, weekPattern: partnerWeekPattern,
      effectiveStart: '2020-01-01', room: 'Swap-B',
    }, ids.swapPartner)
    if (!validators.isCompatibleAppDataV9(next)) throw new Error('swap-fixture-validator-rejected')
    const receipt = await storage.persistAppDataV9(localStorage, loaded.document, next, {
      raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata, revision: loaded.metadata.documentRevision,
    })
    const decision = await runtime.inspectFormalRuntime(localStorage)
    return { revision: receipt.revision, attemptId: receipt.attemptId,
      writeEvidenceValid: await storage.checkV9WriteEvidence(localStorage, receipt.raw,
        localStorage.getItem(storage.V9_ACTIVATION_KEY) ?? ''),
      runtime: decision.runtime, v9Status: 'v9Status' in decision ? decision.v9Status : null }
  }, { ids: FORMAL_V9_FIXTURE_IDS, partnerDay: day, partnerWeekPattern: weekPattern })
}

export async function seedFormalV9SwapOneOffBlocker(page: Page, date: string) {
  return page.evaluate(async ({ ids, blockerDate }) => {
    const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
    const [storage, lessons, validators] = await Promise.all([
      import(moduleUrl('data/storageV9.ts')),
      import(moduleUrl('data/lessonMutationsV9.ts')),
      import(moduleUrl('data/validators/v9.ts')),
    ])
    const loaded = storage.loadAppDataV9(localStorage)
    if (loaded.status !== 'active' || !loaded.document || !loaded.metadata
      || !loaded.rawDocument || !loaded.rawMetadata) throw new Error(`swap-one-off-runtime-${loaded.status}`)
    const periods = loaded.document.teachingUnits
      .find((item: { id: string }) => item.id === ids.teachingUnit)!.periods
    const scope = { projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit }
    const next = lessons.createOneOffLessonV9(loaded.document, scope, {
      ...scope, subjectId: ids.subject, classId: ids.schoolClass, date: blockerDate,
      purpose: 'extra', time: { mode: 'period', periodId: periods[1].id }, room: 'Swap-OneOff',
    }, '33333333-3333-4333-8333-333333333333', true)
    if (!validators.isCompatibleAppDataV9(next)) throw new Error('swap-one-off-validator-rejected')
    const receipt = await storage.persistAppDataV9(localStorage, loaded.document, next, {
      raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata, revision: loaded.metadata.documentRevision,
    })
    return { revision: receipt.revision,
      writeEvidenceValid: await storage.checkV9WriteEvidence(localStorage, receipt.raw,
        localStorage.getItem(storage.V9_ACTIVATION_KEY) ?? '') }
  }, { ids: FORMAL_V9_FIXTURE_IDS, blockerDate: date })
}

export interface ConflictMatrixDates {
  monday: string
  tuesday: string
  wednesday: string
  thursday: string
  friday: string
}

export async function seedFormalV9ConflictMatrix(page: Page, dates: ConflictMatrixDates) {
  return page.evaluate(async ({ ids, scenarioDates }) => {
    const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
    const [storage, lessons, validators, runtime] = await Promise.all([
      import(moduleUrl('data/storageV9.ts')),
      import(moduleUrl('data/lessonMutationsV9.ts')),
      import(moduleUrl('data/validators/v9.ts')),
      import(moduleUrl('formalRuntime.ts')),
    ])
    const loaded = storage.loadAppDataV9(localStorage)
    if (loaded.status !== 'active' || !loaded.document || !loaded.metadata
      || !loaded.rawDocument || !loaded.rawMetadata) throw new Error(`conflict-runtime-${loaded.status}`)
    const scope = { projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit }
    const common = { projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit,
      subjectId: ids.subject, classId: ids.schoolClass, weekPattern: 'every' as const,
      effectiveStart: '2020-01-01' }
    let next = lessons.createRecurringLessonV9(loaded.document, scope,
      { ...common, day: 2, periodId: loaded.document.teachingUnits
        .find((item: { id: string }) => item.id === ids.teachingUnit)!.periods[0].id }, 'browser-every-fixed')
    next = lessons.createRecurringLessonV9(next, scope,
      { ...common, day: 3, periodId: next.teachingUnits
        .find((item: { id: string }) => item.id === ids.teachingUnit)!.periods[0].id }, 'browser-moved-source')
    next = lessons.createRecurringLessonV9(next, scope,
      { ...common, day: 4, periodId: next.teachingUnits
        .find((item: { id: string }) => item.id === ids.teachingUnit)!.periods[0].id }, 'browser-cancelled-source')
    const periods = next.teachingUnits.find((item: { id: string }) => item.id === ids.teachingUnit)!.periods
    next = lessons.moveOccurrenceV9(next, scope, 'browser-moved-source', scenarioDates.wednesday,
      { date: scenarioDates.wednesday, periodId: periods[1].id }, 'browser-move-override')
    next = lessons.cancelOccurrenceV9(next, scope, 'browser-cancelled-source', scenarioDates.thursday,
      'browser-cancel-override')
    next = lessons.createOneOffLessonV9(next, scope, {
      projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit,
      subjectId: ids.subject, classId: ids.schoolClass, date: scenarioDates.friday,
      purpose: 'extra', time: { mode: 'period', periodId: periods[0].id }, room: 'Existing-OneOff',
    }, '22222222-2222-4222-8222-222222222222')
    next = { ...next, events: [...next.events,
      { id: 'browser-meeting', projectId: ids.project, timetableId: ids.timetable,
        teachingUnitId: ids.teachingUnit, ownershipStatus: 'resolved' as const,
        title: 'Browser Meeting', type: 'meeting' as const, date: scenarioDates.friday,
        startTime: '12:00', endTime: '13:00', color: '#647C88' },
      { id: 'browser-activity', projectId: ids.project, timetableId: ids.timetable,
        teachingUnitId: ids.teachingUnit, ownershipStatus: 'resolved' as const,
        title: 'Browser Activity', type: 'activity' as const, date: scenarioDates.friday,
        startTime: '12:30', endTime: '13:30', color: '#647C88' },
    ] }
    if (!validators.isCompatibleAppDataV9(next)) throw new Error('conflict-fixture-validator-rejected')
    const receipt = await storage.persistAppDataV9(localStorage, loaded.document, next, {
      raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata, revision: loaded.metadata.documentRevision,
    })
    const decision = await runtime.inspectFormalRuntime(localStorage)
    return { revision: receipt.revision, attemptId: receipt.attemptId,
      writeEvidenceValid: await storage.checkV9WriteEvidence(localStorage, receipt.raw,
        localStorage.getItem(storage.V9_ACTIVATION_KEY) ?? ''),
      runtime: decision.runtime, v9Status: 'v9Status' in decision ? decision.v9Status : null }
  }, { ids: FORMAL_V9_FIXTURE_IDS, scenarioDates: dates })
}

export interface OneOffDraftInput {
  date: string
  purpose: 'extra' | 'make-up' | 'substitute'
  mode: 'period' | 'custom'
  periodId?: number
  startTime?: string
  endTime?: string
  room?: string
}

export async function openOneOffDraft(page: Page, input: OneOffDraftInput): Promise<Locator> {
  await page.getByRole('button', { name: '新增課程' }).click()
  await page.getByRole('button', { name: /新增單日課程/ }).click()
  const dialog = page.getByRole('dialog', { name: '新增單日課程' })
  await dialog.getByRole('combobox', { name: '用途', exact: true }).selectOption(input.purpose)
  await dialog.getByLabel('指定日期', { exact: true }).fill(input.date)
  await dialog.getByRole('combobox', { name: '學校', exact: true })
    .selectOption(FORMAL_V9_FIXTURE_IDS.school)
  await dialog.getByRole('combobox', { name: '學制', exact: true })
    .selectOption(FORMAL_V9_FIXTURE_IDS.teachingUnit)
  await dialog.getByRole('combobox', { name: '班級', exact: true })
    .selectOption(FORMAL_V9_FIXTURE_IDS.schoolClass)
  await dialog.getByRole('combobox', { name: '科目', exact: true })
    .selectOption(FORMAL_V9_FIXTURE_IDS.subject)
  await dialog.getByRole('combobox', { name: '時間模式', exact: true }).selectOption(input.mode)
  if (input.mode === 'period') {
    await dialog.getByRole('combobox', { name: '節次', exact: true }).selectOption(String(input.periodId))
  } else {
    const [startHour, startMinute] = input.startTime!.split(':')
    const [endHour, endMinute] = input.endTime!.split(':')
    await dialog.getByRole('combobox', { name: '開始小時', exact: true }).selectOption(startHour)
    await dialog.getByRole('combobox', { name: '開始分鐘', exact: true }).selectOption(startMinute)
    await dialog.getByRole('combobox', { name: '結束小時', exact: true }).selectOption(endHour)
    await dialog.getByRole('combobox', { name: '結束分鐘', exact: true }).selectOption(endMinute)
  }
  if (input.room) await dialog.getByLabel('教室（選填）', { exact: true }).fill(input.room)
  return dialog
}

export async function readFormalV9Evidence(page: Page) {
  return page.evaluate(async () => {
    const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
    const [storage, runtime, validators] = await Promise.all([
      import(moduleUrl('data/storageV9.ts')),
      import(moduleUrl('formalRuntime.ts')),
      import(moduleUrl('data/validators/v9.ts')),
    ])
    const loaded = storage.loadAppDataV9(localStorage)
    const decision = await runtime.inspectFormalRuntime(localStorage)
    return {
      document: loaded.document,
      rawDocument: loaded.rawDocument,
      rawMetadata: loaded.rawMetadata,
      revision: loaded.metadata?.documentRevision ?? null,
      attemptId: loaded.metadata?.attemptId ?? null,
      validDocument: validators.isCompatibleAppDataV9(loaded.document),
      writeEvidenceValid: !!loaded.rawDocument && !!loaded.rawMetadata
        && await storage.checkV9WriteEvidence(localStorage, loaded.rawDocument, loaded.rawMetadata),
      runtime: decision.runtime,
      v9Status: 'v9Status' in decision ? decision.v9Status : null,
    }
  })
}

export async function reloadFormalV9(page: Page) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('已儲存至此裝置', { exact: true })).toHaveText('已儲存至此裝置')
  const evidence = await readFormalV9Evidence(page)
  expect(evidence).toMatchObject({
    validDocument: true,
    writeEvidenceValid: true,
    runtime: 'v9',
    v9Status: 'active',
  })
  return evidence
}

export async function seedFormalV9BoundaryMatrix(page: Page, input: {
  bDate: string
  boundaryStart: string
}) {
  return page.evaluate(async ({ ids, boundary }) => {
    const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
    const [storage, lessons, subjects, validators, runtime] = await Promise.all([
      import(moduleUrl('data/storageV9.ts')),
      import(moduleUrl('data/lessonMutationsV9.ts')),
      import(moduleUrl('data/teacherSubjectsV9.ts')),
      import(moduleUrl('data/validators/v9.ts')),
      import(moduleUrl('formalRuntime.ts')),
    ])
    const loaded = storage.loadAppDataV9(localStorage)
    if (loaded.status !== 'active' || !loaded.document || !loaded.metadata
      || !loaded.rawDocument || !loaded.rawMetadata) throw new Error(`boundary-runtime-${loaded.status}`)
    const scope = { projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit }
    const periods = loaded.document.teachingUnits
      .find((item: { id: string }) => item.id === ids.teachingUnit)!.periods
    let next = lessons.createRecurringLessonV9(loaded.document, scope, {
      projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit,
      subjectId: ids.subject, classId: ids.schoolClass, day: 2, periodId: periods[0].id,
      weekPattern: 'every', effectiveStart: '2020-01-01', room: 'Every-Boundary',
    }, 'browser-boundary-every')
    next = lessons.createRecurringLessonV9(next, scope, {
      projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit,
      subjectId: ids.subject, classId: ids.schoolClass, day: 2, periodId: periods[1].id,
      weekPattern: 'B', effectiveStart: '2020-01-01', room: 'B-Boundary',
    }, 'browser-boundary-b')
    next = subjects.createTeacherTimetableV9(next, ids.project,
      { name: 'Browser Other 課表', teacherName: 'Browser Other 教師' }, 'browser-other-timetable')
    next = subjects.createTeacherSubjectV9(next, ids.project, 'browser-other-timetable', {
      name: 'Browser Other 科目', shortName: '他科', color: '#A66D52',
      applicableSchoolLevels: ['senior-high'],
    }, 'browser-other-subject')
    next = subjects.configureTeacherSubjectV9(next, ids.project, 'browser-other-timetable', ids.teachingUnit,
      'browser-other-subject', 'browser-other-subject-relation')
    next = lessons.createRecurringLessonV9(next, {
      projectId: ids.project, timetableId: 'browser-other-timetable', teachingUnitId: ids.teachingUnit,
    }, {
      projectId: ids.project, timetableId: 'browser-other-timetable', teachingUnitId: ids.teachingUnit,
      subjectId: 'browser-other-subject', classId: ids.schoolClass, day: 4, periodId: periods[1].id,
      weekPattern: 'every', effectiveStart: boundary.boundaryStart, room: 'Other-Timetable',
    }, 'browser-other-recurring')
    if (!validators.isCompatibleAppDataV9(next)) throw new Error('boundary-fixture-validator-rejected')
    const receipt = await storage.persistAppDataV9(localStorage, loaded.document, next, {
      raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata, revision: loaded.metadata.documentRevision,
    })
    const decision = await runtime.inspectFormalRuntime(localStorage)
    return { revision: receipt.revision, attemptId: receipt.attemptId,
      writeEvidenceValid: await storage.checkV9WriteEvidence(localStorage, receipt.raw,
        localStorage.getItem(storage.V9_ACTIVATION_KEY) ?? ''),
      runtime: decision.runtime, v9Status: 'v9Status' in decision ? decision.v9Status : null,
      bDate: boundary.bDate }
  }, { ids: FORMAL_V9_FIXTURE_IDS, boundary: input })
}

export async function seedFormalV9PermanentOverride(page: Page, futureDate: string) {
  return page.evaluate(async ({ ids, overrideDate }) => {
    const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
    const [storage, lessons, validators, runtime] = await Promise.all([
      import(moduleUrl('data/storageV9.ts')),
      import(moduleUrl('data/lessonMutationsV9.ts')),
      import(moduleUrl('data/validators/v9.ts')),
      import(moduleUrl('formalRuntime.ts')),
    ])
    const loaded = storage.loadAppDataV9(localStorage)
    if (loaded.status !== 'active' || !loaded.document || !loaded.metadata
      || !loaded.rawDocument || !loaded.rawMetadata) throw new Error(`permanent-runtime-${loaded.status}`)
    const scope = { projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit }
    const next = lessons.replaceOccurrenceV9(loaded.document, scope, ids.recurringLesson, overrideDate, {
      subjectId: ids.subject, classId: ids.schoolClass, room: 'Future-Override',
    }, 'browser-future-override')
    if (!validators.isCompatibleAppDataV9(next)) throw new Error('permanent-fixture-validator-rejected')
    const receipt = await storage.persistAppDataV9(localStorage, loaded.document, next, {
      raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata, revision: loaded.metadata.documentRevision,
    })
    const decision = await runtime.inspectFormalRuntime(localStorage)
    return { revision: receipt.revision, attemptId: receipt.attemptId,
      writeEvidenceValid: await storage.checkV9WriteEvidence(localStorage, receipt.raw,
        localStorage.getItem(storage.V9_ACTIVATION_KEY) ?? ''),
      runtime: decision.runtime, v9Status: 'v9Status' in decision ? decision.v9Status : null }
  }, { ids: FORMAL_V9_FIXTURE_IDS, overrideDate: futureDate })
}

export async function seedFormalV8RecoveryFixture(page: Page) {
  return page.evaluate(async () => {
    const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
    const [bootstrap, storageV8, recovery] = await Promise.all([
      import(moduleUrl('data/bootstrapV8.ts')),
      import(moduleUrl('data/storageV8.ts')),
      import(moduleUrl('formalV9Recovery.ts')),
    ])
    const result = await bootstrap.bootstrapEmptyV8(localStorage, {
      attemptId: 'browser-recovery-v8', createdAt: new Date().toISOString(),
    })
    if (!result.ok) throw new Error(`recovery-bootstrap-${result.code}`)
    const snapshot = await recovery.inspectFormalV9Recovery(localStorage)
    return {
      raw: localStorage.getItem(storageV8.APP_DATA_V8_KEY),
      revision: result.receipt.documentRevision,
      snapshotKind: snapshot.kind,
      evidenceIdentity: snapshot.evidenceIdentity,
    }
  })
}

export async function advanceFormalV8RecoveryRevision(page: Page) {
  return page.evaluate(async () => {
    const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
    const [activation, fingerprint, storageV8, projects, recovery] = await Promise.all([
      import(moduleUrl('data/activationV8.ts')),
      import(moduleUrl('data/activationV8.ts')),
      import(moduleUrl('data/storageV8.ts')),
      import(moduleUrl('data/projectRuntimeV8.ts')),
      import(moduleUrl('formalV9Recovery.ts')),
    ])
    const raw = localStorage.getItem(storageV8.APP_DATA_V8_KEY)
    const loadedMetadata = activation.loadV8BootstrapMetadata(localStorage)
    if (!raw || !loadedMetadata.value || !loadedMetadata.raw || loadedMetadata.value.status !== 'active') {
      throw new Error('recovery-revision-evidence-missing')
    }
    const current = storageV8.parseAppDataV8Raw(raw)
    let serial = 0
    const next = projects.createBlankProject(current, {
      name: 'Recovery Revision 專案', academicYear: 115, semester: 'first',
      startDate: '2026-08-01', endDate: '2027-01-31',
    }, () => `recovery-revision-${++serial}`)
    const confirmation = storageV8.persistAppDataV8(localStorage, current, next, {
      raw, legacyGuardRaw: null, revision: loadedMetadata.value.documentRevision,
    }, loadedMetadata.value.documentRevision)
    const currentDigest = await fingerprint.fingerprintV7Raw(confirmation.raw)
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(loadedMetadata.value.updatedAt) + 1)).toISOString()
    const metadata = { ...loadedMetadata.value, currentDigest,
      documentRevision: confirmation.revision, updatedAt }
    if (!activation.isV8BootstrapMetadata(metadata)) throw new Error('recovery-revision-metadata-invalid')
    const metadataRaw = JSON.stringify(metadata)
    localStorage.setItem(activation.V8_BOOTSTRAP_KEY, metadataRaw)
    if (localStorage.getItem(activation.V8_BOOTSTRAP_KEY) !== metadataRaw) {
      throw new Error('recovery-revision-metadata-unconfirmed')
    }
    const snapshot = await recovery.inspectFormalV9Recovery(localStorage)
    return { raw: confirmation.raw, revision: confirmation.revision,
      snapshotKind: snapshot.kind, evidenceIdentity: snapshot.evidenceIdentity }
  })
}

export async function inspectRecoveryIdentity(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/aster-timetable/src/formalV9Recovery.ts'
    const recovery = await import(modulePath)
    const snapshot = await recovery.inspectFormalV9Recovery(localStorage)
    return { kind: snapshot.kind, evidenceIdentity: snapshot.evidenceIdentity }
  })
}

export function dateKeyAtStartOfBrowserWeek(offsetDays: number): string {
  const today = new Date()
  const mondayOffset = (today.getDay() + 6) % 7
  const target = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset + offsetDays, 12)
  const year = target.getFullYear()
  const month = String(target.getMonth() + 1).padStart(2, '0')
  const day = String(target.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

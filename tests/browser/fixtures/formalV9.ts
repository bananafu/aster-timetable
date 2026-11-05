import { expect, test as base, type Browser, type Page } from '@playwright/test'

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
} as const

interface FormalV9BrowserFixtures {
  formalPage: Page
}

export const test = base.extend<FormalV9BrowserFixtures>({
  formalPage: async ({ browser }, provide) => {
    const context = await browser.newContext()
    await context.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,
      (route) => route.abort('blockedbyclient'))
    const page = await context.newPage()
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
  validDocument: boolean
  writeEvidenceValid: boolean
  runtime: string
  v9Status: string | null
}

export async function proveBrowserContextIsolation(browser: Browser, formalPage: Page): Promise<void> {
  expect(browser.browserType().name()).toBe('chromium')
  const probeContext = await browser.newContext()
  await probeContext.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,
    (route) => route.abort('blockedbyclient'))
  const probePage = await probeContext.newPage()
  await probePage.goto(FORMAL_V9_PATH, { waitUntil: 'domcontentloaded' })
  await probePage.evaluate(() => localStorage.setItem('toki-browser-smoke-context-probe', 'isolated'))

  await formalPage.goto(FORMAL_V9_PATH, { waitUntil: 'domcontentloaded' })
  await expect.poll(() => formalPage.evaluate(() => localStorage.getItem('toki-browser-smoke-context-probe')))
    .toBeNull()
  expect(formalPage.context()).not.toBe(probeContext)
  await probeContext.close()

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

export async function createFormalV9BrowserFixture(page: Page): Promise<FormalV9FixtureEvidence> {
  return page.evaluate(async ({ ids }) => {
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
      startDate: '2020-01-01',
      endDate: '2035-12-31',
      periods,
      weekCycle: { enabled: true, anchorDate: '2020-01-06', anchorPattern: 'A' },
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
      validDocument: validators.isCompatibleAppDataV9(next),
      writeEvidenceValid: await storage.checkV9WriteEvidence(localStorage, receipt.raw,
        localStorage.getItem(storage.V9_ACTIVATION_KEY) ?? ''),
      runtime: decision.runtime,
      v9Status: 'v9Status' in decision ? decision.v9Status : null,
    }
  }, { ids: FORMAL_V9_FIXTURE_IDS })
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

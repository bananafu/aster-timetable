import type { Page } from '@playwright/test'
import {
  APP_DATA_V9_KEY,
  createFormalV9BrowserFixture,
  dateKeyAtStartOfBrowserWeek,
  expect,
  FORMAL_V9_FIXTURE_IDS,
  FORMAL_V9_PATH,
  initializeFormalV9ThroughProductionEntry,
  openOneOffDraft,
  proveBrowserContextIsolation,
  readFormalV9Evidence,
  reloadFormalV9,
  seedFormalV9PermanentOverride,
  seedFormalV9SwapOneOffBlocker,
  seedFormalV9SwapPartner,
  test,
  V9_ACTIVATION_KEY,
  V9_AUTO_BACKUP_PREFIX,
} from './fixtures/formalV9'

function addDays(key: string, days: number) {
  const date = new Date(`${key}T12:00:00`)
  date.setDate(date.getDate() + days)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function setupPermanentSwap(page: Page) {
  await initializeFormalV9ThroughProductionEntry(page)
  const monday = dateKeyAtStartOfBrowserWeek(0)
  const fixture = await createFormalV9BrowserFixture(page, { anchorDate: monday, anchorPattern: 'A' })
  const seeded = await seedFormalV9SwapPartner(page, 2, 'B')
  await reloadFormalV9(page)
  return { monday, effectiveDate: addDays(monday, 2), fixture, seeded }
}

async function openPermanentSwap(page: Page, effectiveDate: string) {
  await page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).first().click()
  const editor = page.getByRole('dialog', { name: '編輯課程' })
  await editor.getByRole('button', { name: /從指定日期起/ }).click()
  await editor.getByLabel('課程異動類型').selectOption('permanent-swap')
  await editor.getByLabel('異動日期').fill(effectiveDate)
  await editor.getByLabel('交換課程').selectOption(FORMAL_V9_FIXTURE_IDS.swapPartner)
  return editor
}

test('Formal V9 permanent A/B swap reloads with history, future resolution, backup, and active Runtime Gate',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    const { monday, effectiveDate, seeded } = await setupPermanentSwap(page)
    const editor = await openPermanentSwap(page, effectiveDate)
    const before = await page.evaluate(({ dataKey, activationKey }) => ({
      raw: localStorage.getItem(dataKey),
      revision: JSON.parse(localStorage.getItem(activationKey) ?? 'null')?.documentRevision,
      attemptId: JSON.parse(localStorage.getItem(activationKey) ?? 'null')?.attemptId,
    }), { dataKey: APP_DATA_V9_KEY, activationKey: V9_ACTIVATION_KEY })
    await editor.getByRole('button', { name: '預覽異動' }).click()
    await expect(editor.getByLabel('異動預覽')).toContainText('從指定日期起永久交換')
    expect((await readFormalV9Evidence(page)).revision).toBe(before.revision)
    await editor.getByRole('button', { name: '確認套用' }).click()
    await expect(editor).toBeHidden()

    const result = await page.evaluate(async ({ ids, dates, dataKey, activationKey, backupPrefix }) => {
      const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
      const [storage, runtime, validators, schedule, dateLib] = await Promise.all([
        import(moduleUrl('data/storageV9.ts')),
        import(moduleUrl('formalRuntime.ts')),
        import(moduleUrl('data/validators/v9.ts')),
        import(moduleUrl('lib/scheduleV9.ts')),
        import(moduleUrl('lib/date.ts')),
      ])
      const raw = localStorage.getItem(dataKey)
      const metadataRaw = localStorage.getItem(activationKey)
      const data = JSON.parse(raw ?? 'null')
      const metadata = JSON.parse(metadataRaw ?? 'null')
      const scope = { projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit }
      const versions = data.recurringLessons.filter((item: { seriesId: string }) =>
        item.seriesId === ids.recurringLesson || item.seriesId === ids.swapPartner)
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => Boolean(key?.startsWith(backupPrefix)))
      const decision = await runtime.inspectFormalRuntime(localStorage)
      return {
        versions,
        historicalA: schedule.resolveV9Day(data, scope, dateLib.fromDateKey(dates.historicalA)),
        historicalB: schedule.resolveV9Day(data, scope, dateLib.fromDateKey(dates.historicalB)),
        futureA: schedule.resolveV9Day(data, scope, dateLib.fromDateKey(dates.futureA)),
        futureB: schedule.resolveV9Day(data, scope, dateLib.fromDateKey(dates.futureB)),
        revision: metadata.documentRevision,
        attemptId: metadata.attemptId,
        backups: keys.map((key) => ({ key, record: JSON.parse(localStorage.getItem(key) ?? 'null') })),
        validDocument: validators.isCompatibleAppDataV9(data),
        writeEvidenceValid: raw !== null && metadataRaw !== null
          && await storage.checkV9WriteEvidence(localStorage, raw, metadataRaw),
        runtime: decision.runtime,
        v9Status: 'v9Status' in decision ? decision.v9Status : null,
      }
    }, { ids: FORMAL_V9_FIXTURE_IDS, dataKey: APP_DATA_V9_KEY, activationKey: V9_ACTIVATION_KEY,
      backupPrefix: V9_AUTO_BACKUP_PREFIX, dates: {
        historicalA: addDays(monday, -14), historicalB: addDays(monday, -6),
        futureA: addDays(monday, 15), futureB: addDays(monday, 7),
      } })
    expect(result).toMatchObject({ revision: before.revision + 1, attemptId: before.attemptId,
      validDocument: true, writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(result.versions).toMatchObject([
      { id: FORMAL_V9_FIXTURE_IDS.recurringLesson, day: 1, weekPattern: 'A',
        effectiveEnd: addDays(effectiveDate, -1) },
      { seriesId: FORMAL_V9_FIXTURE_IDS.recurringLesson, day: 2, weekPattern: 'A',
        effectiveStart: effectiveDate },
      { id: FORMAL_V9_FIXTURE_IDS.swapPartner, day: 2, weekPattern: 'B',
        effectiveEnd: addDays(effectiveDate, -1) },
      { seriesId: FORMAL_V9_FIXTURE_IDS.swapPartner, day: 1, weekPattern: 'B',
        effectiveStart: effectiveDate },
    ])
    expect(result.historicalA).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: FORMAL_V9_FIXTURE_IDS.recurringLesson, room: 'Smoke-A' }),
    ]))
    expect(result.historicalB).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: FORMAL_V9_FIXTURE_IDS.swapPartner, room: 'Swap-B' }),
    ]))
    expect(result.futureA).toEqual(expect.arrayContaining([
      expect.objectContaining({ seriesId: FORMAL_V9_FIXTURE_IDS.recurringLesson, room: 'Smoke-A' }),
    ]))
    expect(result.futureB).toEqual(expect.arrayContaining([
      expect.objectContaining({ seriesId: FORMAL_V9_FIXTURE_IDS.swapPartner, room: 'Swap-B' }),
    ]))
    expect(result.backups).toHaveLength(1)
    expect(result.backups[0]).toMatchObject({
      key: `${V9_AUTO_BACKUP_PREFIX}${result.backups[0].record.mutationAttemptId}`,
      record: { operation: 'permanently-swap-lessons', revision: before.revision, rawDocument: before.raw },
    })

    await reloadFormalV9(page)
    expect(await readFormalV9Evidence(page)).toMatchObject({ revision: seeded.revision + 1,
      attemptId: before.attemptId, validDocument: true, writeEvidenceValid: true,
      runtime: 'v9', v9Status: 'active' })
  })

test('Formal V9 permanent swap safely rebinds a future override to the new version and weekday',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    const { monday, effectiveDate } = await setupPermanentSwap(page)
    const oldOverrideDate = addDays(monday, 14)
    const mappedOverrideDate = addDays(monday, 15)
    const seeded = await seedFormalV9PermanentOverride(page, oldOverrideDate)
    await reloadFormalV9(page)
    const editor = await openPermanentSwap(page, effectiveDate)
    await editor.getByRole('button', { name: '預覽異動' }).click()
    expect((await readFormalV9Evidence(page)).revision).toBe(seeded.revision)
    await editor.getByRole('button', { name: '確認套用' }).click()
    await expect(editor).toBeHidden()
    const evidence = await readFormalV9Evidence(page)
    const nextFirst = evidence.document?.recurringLessons.find((item) =>
      item.seriesId === FORMAL_V9_FIXTURE_IDS.recurringLesson && item.effectiveStart === effectiveDate)
    expect(evidence.document?.overrides).toMatchObject([{ id: 'browser-future-override',
      originalLessonId: nextFirst?.id, date: mappedOverrideDate, periodId: 2,
      replacement: { room: 'Future-Override' } }])
    expect(evidence).toMatchObject({ revision: seeded.revision + 1, validDocument: true,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
  })

test('Formal V9 permanent-swap preview rejects an unsafe future override rebind without writing',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    const { monday, effectiveDate } = await setupPermanentSwap(page)
    await seedFormalV9PermanentOverride(page, addDays(monday, 14))
    const blocker = await seedFormalV9SwapOneOffBlocker(page, addDays(monday, 15))
    await reloadFormalV9(page)
    const editor = await openPermanentSwap(page, effectiveDate)
    await editor.getByRole('button', { name: '預覽異動' }).click()
    await expect(editor.getByRole('alert').first()).toBeVisible()
    await expect(editor.getByLabel('異動預覽')).toBeHidden()
    const evidence = await readFormalV9Evidence(page)
    expect(evidence.revision).toBe(blocker.revision)
    expect(evidence.document?.recurringLessons).toHaveLength(2)
    const backupKeys = await page.evaluate((prefix) => Array.from(
      { length: localStorage.length }, (_, index) => localStorage.key(index),
    ).filter((key) => key?.startsWith(prefix)), V9_AUTO_BACKUP_PREFIX)
    expect(backupKeys).toEqual([])
  })

test('Formal V9 permanent swap keeps the editor and document when pre-backup persistence fails',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    const { effectiveDate, seeded } = await setupPermanentSwap(page)
    const editor = await openPermanentSwap(page, effectiveDate)
    await editor.getByRole('button', { name: '預覽異動' }).click()
    await page.evaluate((prefix) => {
      const original = Storage.prototype.setItem
      ;(window as unknown as { restorePermanentSwapSetItem: () => void }).restorePermanentSwapSetItem = () => {
        Storage.prototype.setItem = original
      }
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.startsWith(prefix)) throw new Error('backup quota')
        return original.call(this, key, value)
      }
    }, V9_AUTO_BACKUP_PREFIX)
    await editor.getByRole('button', { name: '確認套用' }).click()
    await expect(editor.getByRole('alert').first()).toBeVisible()
    await expect(editor).toBeVisible()
    const evidence = await readFormalV9Evidence(page)
    expect(evidence.revision).toBe(seeded.revision)
    expect(evidence.document?.recurringLessons).toHaveLength(2)
    expect(await page.evaluate((prefix) => Array.from(
      { length: localStorage.length }, (_, index) => localStorage.key(index),
    ).filter((key) => key?.startsWith(prefix)), V9_AUTO_BACKUP_PREFIX)).toEqual([])
    await page.evaluate(() => (window as unknown as { restorePermanentSwapSetItem: () => void })
      .restorePermanentSwapSetItem())
  })

test('Formal V9 stale permanent-swap editor cannot overwrite a newer verified page mutation',
  async ({ browser, formalPage: firstPage }) => {
    await proveBrowserContextIsolation(browser, firstPage)
    const { effectiveDate, fixture, seeded } = await setupPermanentSwap(firstPage)
    const staleEditor = await openPermanentSwap(firstPage, effectiveDate)
    await staleEditor.getByRole('button', { name: '預覽異動' }).click()

    const secondPage = await firstPage.context().newPage()
    await secondPage.goto(FORMAL_V9_PATH, { waitUntil: 'domcontentloaded' })
    const freshDialog = await openOneOffDraft(secondPage, { date: dateKeyAtStartOfBrowserWeek(4),
      purpose: 'extra', mode: 'period', periodId: fixture.periodIds[2], room: 'Permanent-Swap-Stale-Guard' })
    await freshDialog.getByRole('button', { name: '送出新增' }).click()
    await expect(freshDialog).toBeHidden()
    await expect(staleEditor.getByRole('button', { name: '確認套用' })).toBeDisabled()
    const evidence = await readFormalV9Evidence(firstPage)
    expect(evidence).toMatchObject({ revision: seeded.revision + 1,
      validDocument: true, writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(evidence.document?.recurringLessons).toHaveLength(2)
    expect(evidence.document?.oneOffLessons).toMatchObject([{ room: 'Permanent-Swap-Stale-Guard' }])
    expect(await firstPage.evaluate((prefix) => Array.from(
      { length: localStorage.length }, (_, index) => localStorage.key(index),
    ).filter((key) => key?.startsWith(prefix)), V9_AUTO_BACKUP_PREFIX)).toEqual([])
    await secondPage.close()
  })

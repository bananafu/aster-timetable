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

test('Formal V9 permanent end reloads with history, verified backup, and active Runtime Gate',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    const endDate = dateKeyAtStartOfBrowserWeek(0)
    const historicalDate = addDays(endDate, -14)
    const fixture = await createFormalV9BrowserFixture(page, {
      anchorDate: endDate, anchorPattern: 'A',
    })
    await reloadFormalV9(page)

    await page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).click()
    const editor = page.getByRole('dialog', { name: '編輯課程' })
    await editor.getByRole('button', { name: /從指定日期起/ }).click()
    await editor.getByLabel('課程異動類型').selectOption('end')
    const before = await page.evaluate(({ dataKey, activationKey }) => ({
      raw: localStorage.getItem(dataKey),
      revision: JSON.parse(localStorage.getItem(activationKey) ?? 'null')?.documentRevision,
      attemptId: JSON.parse(localStorage.getItem(activationKey) ?? 'null')?.attemptId,
    }), { dataKey: APP_DATA_V9_KEY, activationKey: V9_ACTIVATION_KEY })
    await editor.getByRole('button', { name: '預覽異動' }).click()
    await expect(editor.getByLabel('異動預覽')).toContainText('從指定日期起結束課程')
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
      const data = raw ? JSON.parse(raw) : null
      const metadata = metadataRaw ? JSON.parse(metadataRaw) : null
      const scope = { projectId: ids.project, timetableId: ids.timetable, teachingUnitId: ids.teachingUnit }
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => Boolean(key?.startsWith(backupPrefix)))
      const backups = keys.map((key) => ({ key, record: JSON.parse(localStorage.getItem(key) ?? 'null') }))
      const decision = await runtime.inspectFormalRuntime(localStorage)
      return {
        lesson: data.recurringLessons.find((item: { id: string }) => item.id === ids.recurringLesson),
        historicalDay: schedule.resolveV9Day(data, scope, dateLib.fromDateKey(dates.historicalDate)),
        endedDay: schedule.resolveV9Day(data, scope, dateLib.fromDateKey(dates.endDate)),
        revision: metadata.documentRevision,
        attemptId: metadata.attemptId,
        backups,
        validDocument: validators.isCompatibleAppDataV9(data),
        writeEvidenceValid: raw !== null && metadataRaw !== null
          && await storage.checkV9WriteEvidence(localStorage, raw, metadataRaw),
        runtime: decision.runtime,
        v9Status: 'v9Status' in decision ? decision.v9Status : null,
      }
    }, { ids: FORMAL_V9_FIXTURE_IDS, dates: { historicalDate, endDate }, dataKey: APP_DATA_V9_KEY,
      activationKey: V9_ACTIVATION_KEY, backupPrefix: V9_AUTO_BACKUP_PREFIX })
    expect(result).toMatchObject({ revision: before.revision + 1, attemptId: before.attemptId,
      validDocument: true, writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(result.lesson).toMatchObject({ id: FORMAL_V9_FIXTURE_IDS.recurringLesson,
      effectiveEnd: addDays(endDate, -1) })
    expect(result.historicalDay).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: FORMAL_V9_FIXTURE_IDS.recurringLesson, room: 'Smoke-A' }),
    ]))
    expect(result.endedDay).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: FORMAL_V9_FIXTURE_IDS.recurringLesson }),
    ]))
    expect(result.backups).toHaveLength(1)
    expect(result.backups[0]).toMatchObject({
      key: `${V9_AUTO_BACKUP_PREFIX}${result.backups[0].record.mutationAttemptId}`,
      record: { operation: 'permanently-end-lesson', revision: before.revision, rawDocument: before.raw },
    })

    await reloadFormalV9(page)
    const reloaded = await readFormalV9Evidence(page)
    expect(reloaded).toMatchObject({ revision: fixture.fixtureRevision + 1,
      attemptId: before.attemptId, validDocument: true, writeEvidenceValid: true,
      runtime: 'v9', v9Status: 'active' })
    expect(reloaded.document?.recurringLessons.find((item) => item.id === FORMAL_V9_FIXTURE_IDS.recurringLesson))
      .toMatchObject({ effectiveEnd: addDays(endDate, -1) })
  })

test('Formal V9 permanent-end preview rejects a future override without revision or backup',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    const endDate = dateKeyAtStartOfBrowserWeek(0)
    const futureDate = addDays(endDate, 14)
    await createFormalV9BrowserFixture(page, { anchorDate: endDate, anchorPattern: 'A' })
    const seeded = await seedFormalV9PermanentOverride(page, futureDate)
    await reloadFormalV9(page)

    await page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).click()
    const editor = page.getByRole('dialog', { name: '編輯課程' })
    await editor.getByRole('button', { name: /從指定日期起/ }).click()
    await editor.getByLabel('課程異動類型').selectOption('end')
    await editor.getByRole('button', { name: '預覽異動' }).click()
    await expect(editor.getByRole('alert')).toBeVisible()
    await expect(editor.getByLabel('異動預覽')).toBeHidden()
    const evidence = await readFormalV9Evidence(page)
    expect(evidence.revision).toBe(seeded.revision)
    expect(evidence.document?.overrides).toMatchObject([
      { id: 'browser-future-override', originalLessonId: FORMAL_V9_FIXTURE_IDS.recurringLesson,
        date: futureDate },
    ])
    const backupKeys = await page.evaluate((prefix) => Array.from(
      { length: localStorage.length }, (_, index) => localStorage.key(index),
    ).filter((key) => key?.startsWith(prefix)), V9_AUTO_BACKUP_PREFIX)
    expect(backupKeys).toEqual([])
  })

test('Formal V9 stale permanent-end editor cannot overwrite a newer verified page mutation',
  async ({ browser, formalPage: firstPage }) => {
    await proveBrowserContextIsolation(browser, firstPage)
    await initializeFormalV9ThroughProductionEntry(firstPage)
    const endDate = dateKeyAtStartOfBrowserWeek(0)
    const fixture = await createFormalV9BrowserFixture(firstPage, { anchorDate: endDate, anchorPattern: 'A' })
    await reloadFormalV9(firstPage)

    await firstPage.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).click()
    const staleEditor = firstPage.getByRole('dialog', { name: '編輯課程' })
    await staleEditor.getByRole('button', { name: /從指定日期起/ }).click()
    await staleEditor.getByLabel('課程異動類型').selectOption('end')
    await staleEditor.getByRole('button', { name: '預覽異動' }).click()

    const secondPage = await firstPage.context().newPage()
    await secondPage.goto(FORMAL_V9_PATH, { waitUntil: 'domcontentloaded' })
    const freshDialog = await openOneOffDraft(secondPage, { date: dateKeyAtStartOfBrowserWeek(2),
      purpose: 'extra', mode: 'period', periodId: fixture.periodIds[2], room: 'Permanent-End-Stale-Guard' })
    await freshDialog.getByRole('button', { name: '送出新增' }).click()
    await expect(freshDialog).toBeHidden()
    await expect(staleEditor.getByRole('button', { name: '確認套用' })).toBeDisabled()

    const evidence = await readFormalV9Evidence(firstPage)
    expect(evidence).toMatchObject({ revision: fixture.fixtureRevision + 1,
      validDocument: true, writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(evidence.document?.recurringLessons.find((item) => item.id === FORMAL_V9_FIXTURE_IDS.recurringLesson))
      .toMatchObject({ effectiveEnd: '2035-12-31' })
    expect(evidence.document?.oneOffLessons).toMatchObject([{ room: 'Permanent-End-Stale-Guard' }])
    const backupKeys = await firstPage.evaluate((prefix) => Array.from(
      { length: localStorage.length }, (_, index) => localStorage.key(index),
    ).filter((key) => key?.startsWith(prefix)), V9_AUTO_BACKUP_PREFIX)
    expect(backupKeys).toEqual([])
    await secondPage.close()
  })

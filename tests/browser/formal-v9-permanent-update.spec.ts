import {
  APP_DATA_V9_KEY,
  createFormalV9BrowserFixture,
  dateKeyAtStartOfBrowserWeek,
  expect,
  FORMAL_V9_FIXTURE_IDS,
  initializeFormalV9ThroughProductionEntry,
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

test('D permanent update preserves history, rebinds future override, and writes high-risk backup',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    const effectiveDate = dateKeyAtStartOfBrowserWeek(0)
    const oldDate = addDays(effectiveDate, -14)
    const futureDate = addDays(effectiveDate, 14)
    const fixture = await createFormalV9BrowserFixture(page, {
      anchorDate: effectiveDate, anchorPattern: 'A',
    })
    const seeded = await seedFormalV9PermanentOverride(page, futureDate)
    expect(seeded).toMatchObject({ revision: fixture.fixtureRevision + 1,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    await reloadFormalV9(page)

    await page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).click()
    const editor = page.getByRole('dialog', { name: '編輯課程' })
    await editor.getByRole('button', { name: /從指定日期起/ }).click()
    await editor.getByPlaceholder('依班級預設').fill('Permanent-New')
    const before = await page.evaluate(({ dataKey, activationKey }) => ({
      raw: localStorage.getItem(dataKey),
      revision: JSON.parse(localStorage.getItem(activationKey) ?? 'null')?.documentRevision,
      attemptId: JSON.parse(localStorage.getItem(activationKey) ?? 'null')?.attemptId,
    }), { dataKey: APP_DATA_V9_KEY, activationKey: V9_ACTIVATION_KEY })
    await editor.getByRole('button', { name: '預覽異動' }).click()
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
      const versions = data.recurringLessons.filter((item: { seriesId: string }) =>
        item.seriesId === ids.recurringLesson)
      const futureOverride = data.overrides.find((item: { id: string }) => item.id === 'browser-future-override')
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => Boolean(key?.startsWith(backupPrefix)))
      const backups = keys.map((key) => ({ key, record: JSON.parse(localStorage.getItem(key) ?? 'null') }))
      const decision = await runtime.inspectFormalRuntime(localStorage)
      return {
        versions,
        futureOverride,
        oldDay: schedule.resolveV9Day(data, scope, dateLib.fromDateKey(dates.oldDate)),
        newDay: schedule.resolveV9Day(data, scope, dateLib.fromDateKey(dates.effectiveDate)),
        revision: metadata.documentRevision,
        attemptId: metadata.attemptId,
        backups,
        validDocument: validators.isCompatibleAppDataV9(data),
        writeEvidenceValid: raw !== null && metadataRaw !== null
          && await storage.checkV9WriteEvidence(localStorage, raw, metadataRaw),
        runtime: decision.runtime,
        v9Status: 'v9Status' in decision ? decision.v9Status : null,
      }
    }, { ids: FORMAL_V9_FIXTURE_IDS, dates: { oldDate, effectiveDate }, dataKey: APP_DATA_V9_KEY,
      activationKey: V9_ACTIVATION_KEY, backupPrefix: V9_AUTO_BACKUP_PREFIX })
    expect(result).toMatchObject({ revision: before.revision + 1, attemptId: before.attemptId,
      validDocument: true, writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(result.versions).toHaveLength(2)
    const oldVersion = result.versions.find((item: { id: string }) => item.id === FORMAL_V9_FIXTURE_IDS.recurringLesson)
    const newVersion = result.versions.find((item: { id: string }) => item.id !== FORMAL_V9_FIXTURE_IDS.recurringLesson)
    expect(oldVersion).toMatchObject({ effectiveEnd: addDays(effectiveDate, -1), room: 'Smoke-A' })
    expect(newVersion).toMatchObject({ effectiveStart: effectiveDate, room: 'Permanent-New' })
    expect(result.oldDay).toEqual(expect.arrayContaining([expect.objectContaining({ id: oldVersion.id, room: 'Smoke-A' })]))
    expect(result.newDay).toEqual(expect.arrayContaining([expect.objectContaining({ id: newVersion.id,
      room: 'Permanent-New' })]))
    expect(result.futureOverride).toMatchObject({ originalLessonId: newVersion.id, date: futureDate })
    expect(result.backups).toHaveLength(1)
    expect(result.backups[0]).toMatchObject({
      key: `${V9_AUTO_BACKUP_PREFIX}${result.backups[0].record.mutationAttemptId}`,
      record: { operation: 'permanently-update-lesson', revision: before.revision, rawDocument: before.raw },
    })

    await reloadFormalV9(page)
    const reloaded = await readFormalV9Evidence(page)
    expect(reloaded).toMatchObject({ revision: before.revision + 1, attemptId: before.attemptId,
      validDocument: true, writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(reloaded.document?.overrides.find((item: { id: string }) => item.id === 'browser-future-override'))
      .toMatchObject({ originalLessonId: newVersion.id })
  })

import {
  createFormalV9BrowserFixture,
  expect,
  initializeFormalV9ThroughProductionEntry,
  proveBrowserContextIsolation,
  reloadFormalV9,
  test,
} from './fixtures/formalV9'

test('Formal V9 week pill follows the visible units and recurring lesson after reload',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    const monday = await page.evaluate(() => {
      const date = new Date()
      date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
      const part = (value: number) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`
    })
    const fixture = await createFormalV9BrowserFixture(page, { anchorDate: monday, anchorPattern: 'A' })
    expect(fixture).toMatchObject({ validDocument: true, writeEvidenceValid: true,
      runtime: 'v9', v9Status: 'active' })
    await reloadFormalV9(page)
    await page.getByRole('button', { name: '我的課表' }).click()
    const labels = page.locator('.week-pill strong')
    await expect(labels).toHaveText(['A 週'])
    await expect(page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ })).toHaveCount(1)

    const seeded = await page.evaluate(async (anchorDate) => {
      const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
      const [storage, management, academic, validators] = await Promise.all([
        import(moduleUrl('data/storageV9.ts')),
        import(moduleUrl('data/managementV9.ts')),
        import(moduleUrl('data/academicSettingsV4.ts')),
        import(moduleUrl('data/validators/v9.ts')),
      ])
      const loaded = storage.loadAppDataV9(localStorage)
      if (loaded.status !== 'active' || !loaded.document || !loaded.metadata
        || !loaded.rawDocument || !loaded.rawMetadata) throw new Error(`week-label-runtime-${loaded.status}`)
      const next = management.createTeachingUnitV9(loaded.document, 'browser-smoke-project', {
        schoolId: 'browser-smoke-school', name: 'Browser Smoke 國中部', schoolLevel: 'junior-high',
        startDate: '2020-01-01', endDate: '2035-12-31',
        periods: academic.createDefaultPeriods('junior-high'),
        weekCycle: { enabled: true, anchorDate, anchorPattern: 'B' },
      }, 'browser-smoke-second-unit')
      if (!validators.isCompatibleAppDataV9(next)) throw new Error('week-label-fixture-validator-rejected')
      const receipt = await storage.persistAppDataV9(localStorage, loaded.document, next, {
        raw: loaded.rawDocument, metadataRaw: loaded.rawMetadata, revision: loaded.metadata.documentRevision,
      })
      return storage.checkV9WriteEvidence(localStorage, receipt.raw,
        localStorage.getItem(storage.V9_ACTIVATION_KEY) ?? '')
    }, monday)
    expect(seeded).toBe(true)
    await reloadFormalV9(page)
    await page.getByRole('button', { name: '我的課表' }).click()
    await expect(labels).toHaveText(['A 週', 'B 週'])
    await expect(page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ })).toHaveCount(1)

    await page.getByRole('tab', { name: '各校課表' }).click()
    await page.getByLabel('篩選學制').selectOption('browser-smoke-second-unit')
    await expect(labels).toHaveText(['B 週'])
    await page.getByLabel('篩選學制').selectOption('browser-smoke-unit')
    await expect(labels).toHaveText(['A 週'])
    await page.getByRole('tab', { name: '總課表' }).click()
    await expect(labels).toHaveText(['A 週', 'B 週'])
    await page.getByRole('button', { name: '下一週' }).click()
    await expect(labels).toHaveText(['A 週', 'B 週'])
    await expect(page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ })).toHaveCount(0)
  })

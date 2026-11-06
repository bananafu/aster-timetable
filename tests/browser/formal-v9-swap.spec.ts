import {
  createFormalV9BrowserFixture,
  dateKeyAtStartOfBrowserWeek,
  expect,
  FORMAL_V9_PATH,
  FORMAL_V9_FIXTURE_IDS,
  initializeFormalV9ThroughProductionEntry,
  openOneOffDraft,
  proveBrowserContextIsolation,
  readFormalV9Evidence,
  seedFormalV9SwapOneOffBlocker,
  seedFormalV9SwapPartner,
  test,
} from './fixtures/formalV9'

async function setupSwap(page: Parameters<typeof createFormalV9BrowserFixture>[0], day: 1 | 2,
  partnerWeekPattern: 'every' | 'A' | 'B' = 'every') {
  await initializeFormalV9ThroughProductionEntry(page)
  const monday = dateKeyAtStartOfBrowserWeek(0)
  const fixture = await createFormalV9BrowserFixture(page, { anchorDate: monday, anchorPattern: 'A' })
  const seeded = await seedFormalV9SwapPartner(page, day, partnerWeekPattern)
  expect(fixture).toMatchObject({ validDocument: true, writeEvidenceValid: true,
    runtime: 'v9', v9Status: 'active' })
  expect(fixture.fixtureReceiptAttemptId).toBe(fixture.activationAttemptId)
  expect(seeded).toMatchObject({ revision: fixture.fixtureRevision + 1,
    writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('已儲存至此裝置', { exact: true })).toHaveText('已儲存至此裝置')
  return { monday, seeded, fixture }
}

test('Formal V9 existing LessonEditor swaps A to B across weeks, reloads, and revokes the complete group',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    const { monday, seeded } = await setupSwap(page, 1, 'B')
    const nextMonday = dateKeyAtStartOfBrowserWeek(7)
    await page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).first().click()
    const dialog = page.getByRole('dialog', { name: '編輯課程' })
    await dialog.getByRole('button', { name: /僅此日期/ }).click()
    await dialog.getByLabel('課程異動類型').selectOption('swap')
    await dialog.getByLabel('移至日期').fill(nextMonday)
    await dialog.getByLabel('交換課程').selectOption(FORMAL_V9_FIXTURE_IDS.swapPartner)
    await dialog.getByRole('button', { name: '預覽異動' }).click()
    await expect(dialog.getByLabel('異動預覽')).toContainText(nextMonday)
    expect((await readFormalV9Evidence(page)).revision).toBe(seeded.revision)
    await dialog.getByRole('button', { name: '確認套用' }).click()
    await expect(dialog).toBeHidden()

    let evidence = await readFormalV9Evidence(page)
    expect(evidence).toMatchObject({ revision: seeded.revision + 1, validDocument: true,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(evidence.document?.overrides.map((item) => [item.originalLessonId, item.date,
      item.target?.date, item.groupId])).toEqual([
      [FORMAL_V9_FIXTURE_IDS.recurringLesson, monday, nextMonday, expect.any(String)],
      [FORMAL_V9_FIXTURE_IDS.swapPartner, nextMonday, monday, expect.any(String)],
    ])
    expect(evidence.document?.overrides[0].groupId).toBe(evidence.document?.overrides[1].groupId)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '下一週' }).click()
    await expect(page.getByText('調入', { exact: true }).first()).toBeVisible()
    await page.getByText('調入', { exact: true }).first().click()
    const grouped = page.getByRole('dialog', { name: '編輯課程' })
    await expect(grouped.getByLabel('現有單日異動')).toContainText('單日交換')
    await grouped.getByRole('button', { name: '撤銷異動' }).click()
    expect((await readFormalV9Evidence(page)).revision).toBe(seeded.revision + 1)
    await grouped.getByRole('button', { name: '確認套用' }).click()
    await expect(grouped).toBeHidden()

    evidence = await readFormalV9Evidence(page)
    expect(evidence).toMatchObject({ revision: seeded.revision + 2, validDocument: true,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(evidence.document?.overrides).toEqual([])
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).first())
      .toBeVisible()
    await page.getByRole('button', { name: '下一週' }).click()
    await expect(page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).first())
      .toBeVisible()
  })

test('Formal V9 existing LessonEditor swaps B to A across weeks in one revision',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    const { monday, seeded } = await setupSwap(page, 1, 'B')
    const nextMonday = dateKeyAtStartOfBrowserWeek(7)
    await page.getByRole('button', { name: '下一週' }).click()
    await page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).first().click()
    const dialog = page.getByRole('dialog', { name: '編輯課程' })
    await dialog.getByRole('button', { name: /僅此日期/ }).click()
    await dialog.getByLabel('課程異動類型').selectOption('swap')
    await dialog.getByLabel('移至日期').fill(monday)
    await dialog.getByLabel('交換課程').selectOption(FORMAL_V9_FIXTURE_IDS.recurringLesson)
    await dialog.getByRole('button', { name: '預覽異動' }).click()
    expect((await readFormalV9Evidence(page)).revision).toBe(seeded.revision)
    await dialog.getByRole('button', { name: '確認套用' }).click()
    await expect(dialog).toBeHidden()
    const evidence = await readFormalV9Evidence(page)
    expect(evidence).toMatchObject({ revision: seeded.revision + 1, validDocument: true,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(evidence.document?.overrides.map((item) => [item.originalLessonId, item.date,
      item.target?.date])).toEqual([
      [FORMAL_V9_FIXTURE_IDS.swapPartner, nextMonday, monday],
      [FORMAL_V9_FIXTURE_IDS.recurringLesson, monday, nextMonday],
    ])
  })

test('Formal V9 same-day swap persists and grouped revoke removes both overrides in one revision',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    const { seeded } = await setupSwap(page, 1)
    await page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).first().click()
    const dialog = page.getByRole('dialog', { name: '編輯課程' })
    await dialog.getByRole('button', { name: /僅此日期/ }).click()
    await dialog.getByLabel('課程異動類型').selectOption('swap')
    await dialog.getByLabel('交換課程').selectOption(FORMAL_V9_FIXTURE_IDS.swapPartner)
    await dialog.getByRole('button', { name: '預覽異動' }).click()
    expect((await readFormalV9Evidence(page)).revision).toBe(seeded.revision)
    await dialog.getByRole('button', { name: '確認套用' }).click()
    await expect(dialog).toBeHidden()
    let evidence = await readFormalV9Evidence(page)
    expect(evidence).toMatchObject({ revision: seeded.revision + 1, validDocument: true,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(evidence.document?.overrides).toHaveLength(2)
    expect(new Set(evidence.document?.overrides.map((item) => item.groupId)).size).toBe(1)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('調入', { exact: true }).first().click()
    const grouped = page.getByRole('dialog', { name: '編輯課程' })
    await expect(grouped.getByLabel('現有單日異動')).toContainText('單日交換')
    await grouped.getByRole('button', { name: '撤銷異動' }).click()
    expect((await readFormalV9Evidence(page)).revision).toBe(seeded.revision + 1)
    await grouped.getByRole('button', { name: '確認套用' }).click()
    await expect(grouped).toBeHidden()
    evidence = await readFormalV9Evidence(page)
    expect(evidence).toMatchObject({ revision: seeded.revision + 2, validDocument: true,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(evidence.document?.overrides).toEqual([])
  })

test('Formal V9 resolved week drag creates a cross-date swap intent and persists both sides atomically',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    const { monday, seeded } = await setupSwap(page, 2)
    const tuesday = dateKeyAtStartOfBrowserWeek(1)
    await page.getByRole('button', { name: '我的課表' }).click()
    const source = page.getByLabel(`${monday} 課表`)
      .getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ })
    const target = page.getByLabel(`${tuesday} 課表`)
      .getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ })
    await source.dragTo(target)
    const dialog = page.getByRole('dialog', { name: '編輯課程' })
    await expect(dialog.getByLabel('移至日期')).toHaveValue(tuesday)
    await dialog.getByLabel('課程異動類型').selectOption('swap')
    await dialog.getByLabel('交換課程').selectOption(FORMAL_V9_FIXTURE_IDS.swapPartner)
    await dialog.getByRole('button', { name: '預覽異動' }).click()
    await expect(dialog.getByLabel('異動預覽')).toContainText(tuesday)
    expect((await readFormalV9Evidence(page)).revision).toBe(seeded.revision)
    await dialog.getByRole('button', { name: '確認套用' }).click()
    await expect(dialog).toBeHidden()
    const evidence = await readFormalV9Evidence(page)
    expect(evidence).toMatchObject({ revision: seeded.revision + 1, validDocument: true,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(evidence.document?.overrides.map((item) => [item.originalLessonId, item.date, item.target?.date]))
      .toEqual([
        [FORMAL_V9_FIXTURE_IDS.recurringLesson, monday, tuesday],
        [FORMAL_V9_FIXTURE_IDS.swapPartner, tuesday, monday],
      ])
  })

test('Formal V9 swap preview rejects an overlapping OneOff without a revision or partial group',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    const { seeded } = await setupSwap(page, 1, 'B')
    const nextMonday = dateKeyAtStartOfBrowserWeek(7)
    const blocker = await seedFormalV9SwapOneOffBlocker(page, nextMonday)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).first().click()
    const dialog = page.getByRole('dialog', { name: '編輯課程' })
    await dialog.getByRole('button', { name: /僅此日期/ }).click()
    await dialog.getByLabel('課程異動類型').selectOption('swap')
    await dialog.getByLabel('移至日期').fill(nextMonday)
    await dialog.getByLabel('交換課程').selectOption(FORMAL_V9_FIXTURE_IDS.swapPartner)
    await dialog.getByRole('button', { name: '預覽異動' }).click()
    await expect(dialog.getByLabel('異動預覽')).toBeHidden()
    await expect(dialog.getByRole('alert')).toBeVisible()
    const evidence = await readFormalV9Evidence(page)
    expect(evidence.revision).toBe(blocker.revision)
    expect(evidence.document?.overrides).toEqual([])
    expect(blocker.writeEvidenceValid).toBe(true)
    expect(blocker.revision).toBe(seeded.revision + 1)
  })

test('Formal V9 stale swap editor cannot overwrite a verified mutation from another page',
  async ({ browser, formalPage: firstPage }) => {
    await proveBrowserContextIsolation(browser, firstPage)
    const { seeded, fixture } = await setupSwap(firstPage, 1, 'B')
    const nextMonday = dateKeyAtStartOfBrowserWeek(7)
    await firstPage.getByRole('button', { name: /編輯 Browser Smoke 數學・Browser Smoke 101/ }).first().click()
    const staleDialog = firstPage.getByRole('dialog', { name: '編輯課程' })
    await staleDialog.getByRole('button', { name: /僅此日期/ }).click()
    await staleDialog.getByLabel('課程異動類型').selectOption('swap')
    await staleDialog.getByLabel('移至日期').fill(nextMonday)
    await staleDialog.getByLabel('交換課程').selectOption(FORMAL_V9_FIXTURE_IDS.swapPartner)
    await staleDialog.getByRole('button', { name: '預覽異動' }).click()

    const secondPage = await firstPage.context().newPage()
    await secondPage.goto(FORMAL_V9_PATH, { waitUntil: 'domcontentloaded' })
    await expect(secondPage.getByText('已儲存至此裝置', { exact: true })).toHaveText('已儲存至此裝置')
    const freshDialog = await openOneOffDraft(secondPage, { date: dateKeyAtStartOfBrowserWeek(2),
      purpose: 'extra', mode: 'period', periodId: fixture.periodIds[2], room: 'Other-Page' })
    await freshDialog.getByRole('button', { name: '送出新增' }).click()
    await expect(freshDialog).toBeHidden()
    await expect(staleDialog.getByRole('button', { name: '確認套用' })).toBeDisabled()
    const evidence = await readFormalV9Evidence(firstPage)
    expect(evidence.revision).toBe(seeded.revision + 1)
    expect(evidence.document?.overrides).toEqual([])
    expect(evidence.document?.oneOffLessons).toHaveLength(1)
    await secondPage.close()
  })

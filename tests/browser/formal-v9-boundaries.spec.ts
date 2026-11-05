import {
  createFormalV9BrowserFixture,
  dateKeyAtStartOfBrowserWeek,
  expect,
  initializeFormalV9ThroughProductionEntry,
  openOneOffDraft,
  proveBrowserContextIsolation,
  readFormalV9Evidence,
  seedFormalV9BoundaryMatrix,
  test,
} from './fixtures/formalV9'

async function closeDraft(dialog: Awaited<ReturnType<typeof openOneOffDraft>>) {
  await dialog.getByRole('button', { name: '關閉', exact: true }).click()
  await expect(dialog).toBeHidden()
}

test('C1 EVERY, active A, and active B occurrences follow the TeachingUnit anchor',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    const monday = dateKeyAtStartOfBrowserWeek(0)
    const fixture = await createFormalV9BrowserFixture(page, { anchorDate: monday, anchorPattern: 'A' })
    const seeded = await seedFormalV9BoundaryMatrix(page, {
      bDate: dateKeyAtStartOfBrowserWeek(8), boundaryStart: '2026-12-31',
    })
    expect(seeded).toMatchObject({ writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    await page.reload({ waitUntil: 'domcontentloaded' })

    for (const draft of [
      { date: monday, periodId: fixture.periodIds[0], room: 'A-Conflict' },
      { date: dateKeyAtStartOfBrowserWeek(1), periodId: fixture.periodIds[0], room: 'Every-Conflict' },
      { date: dateKeyAtStartOfBrowserWeek(8), periodId: fixture.periodIds[1], room: 'B-Conflict' },
    ]) {
      const dialog = await openOneOffDraft(page, { ...draft, purpose: 'extra', mode: 'period' })
      await expect(dialog.getByRole('status').filter({ hasText: /此時段已有 1 堂課/ })).toBeVisible()
      await expect(dialog.getByRole('button', { name: '送出新增' })).toBeDisabled()
      await closeDraft(dialog)
    }

    const inactiveA = await openOneOffDraft(page, { date: dateKeyAtStartOfBrowserWeek(7), purpose: 'extra',
      mode: 'period', periodId: fixture.periodIds[0], room: 'Inactive-A-Free' })
    await expect(inactiveA.getByRole('status').filter({ hasText: /此時段已有/ })).toHaveCount(0)
    await expect(inactiveA.getByRole('button', { name: '送出新增' })).toBeEnabled()
    await closeDraft(inactiveA)
  })

test('C2 boundary dates persist across year, outside dates reject, and other Timetable stays isolated',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    const startDate = '2026-12-31'
    const endDate = '2027-01-01'
    const fixture = await createFormalV9BrowserFixture(page, {
      startDate, endDate, anchorDate: '2026-12-28', anchorPattern: 'A',
    })
    const seeded = await seedFormalV9BoundaryMatrix(page, { bDate: '2027-01-05', boundaryStart: startDate })
    expect(seeded).toMatchObject({ writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    await page.reload({ waitUntil: 'domcontentloaded' })

    for (const outside of ['2026-12-30', '2027-01-02']) {
      const dialog = await openOneOffDraft(page, { date: outside, purpose: 'extra', mode: 'period',
        periodId: fixture.periodIds[1], room: `Outside-${outside}` })
      await expect(dialog.getByRole('alert')).toContainText('日期須位於此學制的學期範圍')
      await expect(dialog.getByRole('button', { name: '送出新增' })).toBeDisabled()
      await closeDraft(dialog)
    }

    const firstDay = await openOneOffDraft(page, { date: startDate, purpose: 'extra', mode: 'period',
      periodId: fixture.periodIds[1], room: 'Boundary-Cross-Year' })
    await expect(firstDay.getByRole('status').filter({ hasText: /此時段已有/ })).toHaveCount(0)
    await firstDay.getByRole('button', { name: '送出新增' }).click()
    await expect(firstDay).toBeHidden()
    const afterCreate = await readFormalV9Evidence(page)
    expect(afterCreate).toMatchObject({ revision: seeded.revision + 1, validDocument: true,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(afterCreate.document?.oneOffLessons).toMatchObject([{ date: startDate, room: 'Boundary-Cross-Year' }])

    const currentMonday = new Date(`${dateKeyAtStartOfBrowserWeek(0)}T12:00:00`)
    const targetMonday = new Date('2026-12-28T12:00:00')
    const weekSteps = Math.round((targetMonday.getTime() - currentMonday.getTime()) / (7 * 24 * 60 * 60 * 1000))
    const direction = weekSteps >= 0 ? '下一週' : '上一週'
    for (let index = 0; index < Math.abs(weekSteps); index += 1) {
      await page.getByRole('button', { name: direction }).click()
    }
    await page.getByRole('button', { name: /編輯單日課程/ }).click()
    const edit = page.getByRole('dialog', { name: '編輯單日課程' })
    await edit.getByLabel('指定日期', { exact: true }).fill(endDate)
    await edit.getByRole('button', { name: '送出修改' }).click()
    await expect(edit).toBeHidden()

    await page.reload({ waitUntil: 'domcontentloaded' })
    const reloaded = await readFormalV9Evidence(page)
    expect(reloaded).toMatchObject({ revision: seeded.revision + 2, validDocument: true,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(reloaded.document?.oneOffLessons).toMatchObject([{ date: endDate, room: 'Boundary-Cross-Year' }])
  })

import {
  createFormalV9BrowserFixture,
  dateKeyAtStartOfBrowserWeek,
  expect,
  initializeFormalV9ThroughProductionEntry,
  openOneOffDraft,
  proveBrowserContextIsolation,
  readFormalV9Evidence,
  seedFormalV9ConflictMatrix,
  test,
  type ConflictMatrixDates,
} from './fixtures/formalV9'

async function prepare(browser: Parameters<typeof proveBrowserContextIsolation>[0],
  page: Parameters<typeof proveBrowserContextIsolation>[1]) {
  await proveBrowserContextIsolation(browser, page)
  await initializeFormalV9ThroughProductionEntry(page)
  const dates: ConflictMatrixDates = {
    monday: dateKeyAtStartOfBrowserWeek(0),
    tuesday: dateKeyAtStartOfBrowserWeek(1),
    wednesday: dateKeyAtStartOfBrowserWeek(2),
    thursday: dateKeyAtStartOfBrowserWeek(3),
    friday: dateKeyAtStartOfBrowserWeek(4),
  }
  const fixture = await createFormalV9BrowserFixture(page, { anchorDate: dates.monday, anchorPattern: 'A' })
  const seeded = await seedFormalV9ConflictMatrix(page, dates)
  expect(seeded).toMatchObject({ writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  return { dates, fixture, seeded }
}

async function allowConflictAndSave(dialog: Awaited<ReturnType<typeof openOneOffDraft>>) {
  const conflict = dialog.getByRole('status').filter({ hasText: /此時段已有/ })
  await expect(conflict).toBeVisible()
  const submit = dialog.getByRole('button', { name: '送出新增' })
  await expect(submit).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /明確允許衝堂/ }).check()
  await expect(submit).toBeEnabled()
  await submit.click()
  await expect(dialog).toBeHidden()
}

async function expectPersisted(page: Parameters<typeof readFormalV9Evidence>[0],
  previousRevision: number, room: string) {
  const evidence = await readFormalV9Evidence(page)
  expect(evidence).toMatchObject({ revision: previousRevision + 1, validDocument: true,
    writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
  expect(evidence.document?.oneOffLessons.some((item: { room?: string }) => item.room === room)).toBe(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const reloaded = await readFormalV9Evidence(page)
  expect(reloaded.document?.oneOffLessons.some((item: { room?: string }) => item.room === room)).toBe(true)
  return reloaded
}

test('A1 fixed Lesson conflict defaults to reject and explicit extra/period allowance persists',
  async ({ browser, formalPage: page }) => {
    const { dates, fixture, seeded } = await prepare(browser, page)
    const dialog = await openOneOffDraft(page, { date: dates.tuesday, purpose: 'extra', mode: 'period',
      periodId: fixture.periodIds[0], room: 'Allowed-Fixed' })
    await allowConflictAndSave(dialog)
    await expectPersisted(page, seeded.revision, 'Allowed-Fixed')
  })

test('A2 moved source is free while moved target blocks make-up/custom until explicit allowance',
  async ({ browser, formalPage: page }) => {
    const { dates, fixture, seeded } = await prepare(browser, page)
    const first = fixture.periods[0]
    const second = fixture.periods[1]
    const sourceDialog = await openOneOffDraft(page, { date: dates.wednesday, purpose: 'make-up', mode: 'custom',
      startTime: first.startTime, endTime: first.endTime, room: 'Moved-Source-Free' })
    await expect(sourceDialog.getByRole('status').filter({ hasText: /此時段已有/ })).toHaveCount(0)
    await expect(sourceDialog.getByRole('button', { name: '送出新增' })).toBeEnabled()
    await sourceDialog.getByRole('button', { name: '送出新增' }).click()
    await expect(sourceDialog).toBeHidden()
    const afterSource = await expectPersisted(page, seeded.revision, 'Moved-Source-Free')

    const targetDialog = await openOneOffDraft(page, { date: dates.wednesday, purpose: 'make-up', mode: 'custom',
      startTime: second.startTime, endTime: second.endTime, room: 'Allowed-Moved-Target' })
    await allowConflictAndSave(targetDialog)
    await expectPersisted(page, afterSource.revision as number, 'Allowed-Moved-Target')
  })

test('A3 existing OneOff blocks substitute/period until explicit allowance and reload keeps both',
  async ({ browser, formalPage: page }) => {
    const { dates, fixture, seeded } = await prepare(browser, page)
    const dialog = await openOneOffDraft(page, { date: dates.friday, purpose: 'substitute', mode: 'period',
      periodId: fixture.periodIds[0], room: 'Allowed-OneOff' })
    await allowConflictAndSave(dialog)
    const evidence = await expectPersisted(page, seeded.revision, 'Allowed-OneOff')
    expect(evidence.document?.oneOffLessons.filter((item: { date: string }) => item.date === dates.friday)).toHaveLength(2)
  })

test('A4 cancelled source and overlapping Meeting/Activity do not block OneOff submit',
  async ({ browser, formalPage: page }) => {
    const { dates, fixture, seeded } = await prepare(browser, page)
    const cancelled = await openOneOffDraft(page, { date: dates.thursday, purpose: 'extra', mode: 'period',
      periodId: fixture.periodIds[0], room: 'Cancelled-Free' })
    await expect(cancelled.getByRole('status').filter({ hasText: /此時段已有/ })).toHaveCount(0)
    await cancelled.getByRole('button', { name: '送出新增' }).click()
    await expect(cancelled).toBeHidden()
    const afterCancelled = await expectPersisted(page, seeded.revision, 'Cancelled-Free')

    const events = await openOneOffDraft(page, { date: dates.friday, purpose: 'substitute', mode: 'custom',
      startTime: '12:15', endTime: '12:45', room: 'Events-Nonblocking' })
    await expect(events.getByRole('status').filter({ hasText: /此時段已有/ })).toHaveCount(0)
    await expect(events.getByRole('button', { name: '送出新增' })).toBeEnabled()
    await events.getByRole('button', { name: '送出新增' }).click()
    await expect(events).toBeHidden()
    await expectPersisted(page, afterCancelled.revision as number, 'Events-Nonblocking')
  })

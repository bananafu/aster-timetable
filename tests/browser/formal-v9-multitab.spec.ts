import {
  createFormalV9BrowserFixture,
  dateKeyAtStartOfBrowserWeek,
  expect,
  initializeFormalV9ThroughProductionEntry,
  openOneOffDraft,
  proveBrowserContextIsolation,
  readFormalV9Evidence,
  test,
} from './fixtures/formalV9'

test('B stale editor fails closed after another page commits a verified V9 revision',
  async ({ browser, formalPage: firstPage }) => {
    await proveBrowserContextIsolation(browser, firstPage)
    await initializeFormalV9ThroughProductionEntry(firstPage)
    const monday = dateKeyAtStartOfBrowserWeek(0)
    const fixture = await createFormalV9BrowserFixture(firstPage, { anchorDate: monday, anchorPattern: 'A' })
    await firstPage.reload({ waitUntil: 'domcontentloaded' })

    const staleDialog = await openOneOffDraft(firstPage, {
      date: dateKeyAtStartOfBrowserWeek(1), purpose: 'extra', mode: 'period',
      periodId: fixture.periodIds[1], room: 'Stale-Draft-Must-Stay',
    })
    await expect(staleDialog.getByRole('button', { name: '送出新增' })).toBeEnabled()

    const secondPage = await firstPage.context().newPage()
    expect(secondPage.context()).toBe(firstPage.context())
    await secondPage.goto('?runtime=formal', { waitUntil: 'domcontentloaded' })
    await expect(secondPage.getByRole('heading', { name: '本週行事曆' })).toBeVisible()
    const freshDialog = await openOneOffDraft(secondPage, {
      date: dateKeyAtStartOfBrowserWeek(2), purpose: 'substitute', mode: 'period',
      periodId: fixture.periodIds[2], room: 'Second-Page-Write',
    })
    await freshDialog.getByRole('button', { name: '送出新增' }).click()
    await expect(freshDialog).toBeHidden()
    const afterSecondPage = await readFormalV9Evidence(secondPage)
    expect(afterSecondPage).toMatchObject({ revision: fixture.fixtureRevision + 1,
      validDocument: true, writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(afterSecondPage.document?.oneOffLessons).toHaveLength(1)

    await staleDialog.getByRole('button', { name: '送出新增' }).click()
    await expect(staleDialog.getByRole('alert')).toHaveText('V9 Host is read-only.')
    await expect(staleDialog).toBeVisible()
    await expect(staleDialog.getByLabel('教室（選填）', { exact: true })).toHaveValue('Stale-Draft-Must-Stay')

    const afterStaleAttempt = await readFormalV9Evidence(firstPage)
    expect(afterStaleAttempt).toMatchObject({ revision: fixture.fixtureRevision + 1,
      validDocument: true, writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(afterStaleAttempt.document?.oneOffLessons).toHaveLength(1)
    expect(afterStaleAttempt.document?.oneOffLessons[0]).toMatchObject({ room: 'Second-Page-Write' })

    await firstPage.reload({ waitUntil: 'domcontentloaded' })
    const reloaded = await readFormalV9Evidence(firstPage)
    expect(reloaded).toMatchObject({ revision: fixture.fixtureRevision + 1,
      validDocument: true, writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(reloaded.document?.oneOffLessons).toHaveLength(1)
    expect(reloaded.document?.oneOffLessons[0]).toMatchObject({ room: 'Second-Page-Write' })
    await secondPage.close()
  })

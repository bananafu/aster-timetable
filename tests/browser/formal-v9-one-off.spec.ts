import {
  APP_DATA_V9_KEY,
  createFormalV9BrowserFixture,
  dateKeyAtStartOfBrowserWeek,
  expect,
  FORMAL_V9_FIXTURE_IDS,
  initializeFormalV9ThroughProductionEntry,
  proveBrowserContextIsolation,
  reloadFormalV9,
  test,
  V9_ACTIVATION_KEY,
  V9_AUTO_BACKUP_PREFIX,
} from './fixtures/formalV9'

test('Formal V9 OneOff CRUD survives reload and delete creates verified backup evidence',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)

    const fixture = await createFormalV9BrowserFixture(page)
    expect(fixture).toMatchObject({
      initialRevision: 0,
      fixtureRevision: 1,
      validDocument: true,
      writeEvidenceValid: true,
      runtime: 'v9',
      v9Status: 'active',
    })
    expect(fixture.fixtureReceiptAttemptId).toBe(fixture.activationAttemptId)

    await reloadFormalV9(page)
    await expect(page.getByText('已儲存至此裝置', { exact: true })).toHaveText('已儲存至此裝置')
    await expect(page.getByRole('heading', { name: '本週行事曆' })).toBeVisible()

    const createDate = dateKeyAtStartOfBrowserWeek(1)
    const editDate = dateKeyAtStartOfBrowserWeek(2)
    await page.getByRole('button', { name: '新增課程' }).click()
    await page.getByRole('button', { name: /新增單日課程/ }).click()
    const createDialog = page.getByRole('dialog', { name: '新增單日課程' })
    await createDialog.getByLabel('指定日期', { exact: true }).fill(createDate)
    await createDialog.getByRole('combobox', { name: '學校', exact: true })
      .selectOption(FORMAL_V9_FIXTURE_IDS.school)
    await createDialog.getByRole('combobox', { name: '學制', exact: true })
      .selectOption(FORMAL_V9_FIXTURE_IDS.teachingUnit)
    await createDialog.getByRole('combobox', { name: '班級', exact: true })
      .selectOption(FORMAL_V9_FIXTURE_IDS.schoolClass)
    await createDialog.getByRole('combobox', { name: '科目', exact: true })
      .selectOption(FORMAL_V9_FIXTURE_IDS.subject)
    await createDialog.getByRole('combobox', { name: '節次', exact: true })
      .selectOption(String(fixture.periodIds[1]))
    await createDialog.getByLabel('教室（選填）', { exact: true }).fill('Smoke-Create')
    await createDialog.getByRole('button', { name: '送出新增' }).click()
    await expect(createDialog).toBeHidden()

    const created = await page.evaluate(({ dataKey }) => {
      const data = JSON.parse(localStorage.getItem(dataKey) ?? 'null')
      return data?.oneOffLessons?.[0] ?? null
    }, { dataKey: APP_DATA_V9_KEY })
    expect(created).toMatchObject({
      projectId: FORMAL_V9_FIXTURE_IDS.project,
      timetableId: FORMAL_V9_FIXTURE_IDS.timetable,
      teachingUnitId: FORMAL_V9_FIXTURE_IDS.teachingUnit,
      subjectId: FORMAL_V9_FIXTURE_IDS.subject,
      classId: FORMAL_V9_FIXTURE_IDS.schoolClass,
      date: createDate,
      purpose: 'extra',
      room: 'Smoke-Create',
      time: { mode: 'period', periodId: fixture.periodIds[1] },
    })

    await reloadFormalV9(page)
    await expect(page.getByText('已儲存至此裝置', { exact: true })).toHaveText('已儲存至此裝置')
    await page.getByRole('button', { name: /編輯單日課程/ }).click()
    const editDialog = page.getByRole('dialog', { name: '編輯單日課程' })
    await editDialog.getByRole('combobox', { name: '用途', exact: true }).selectOption('substitute')
    await editDialog.getByLabel('指定日期', { exact: true }).fill(editDate)
    await editDialog.getByLabel('教室（選填）', { exact: true }).fill('Smoke-Edit')
    await editDialog.getByRole('button', { name: '送出修改' }).click()
    await expect(editDialog).toBeHidden()

    await reloadFormalV9(page)
    await expect(page.getByText('已儲存至此裝置', { exact: true })).toHaveText('已儲存至此裝置')
    const edited = await page.evaluate(({ dataKey, id }) => {
      const data = JSON.parse(localStorage.getItem(dataKey) ?? 'null')
      return data?.oneOffLessons?.find((item: { id: string }) => item.id === id) ?? null
    }, { dataKey: APP_DATA_V9_KEY, id: created.id as string })
    expect(edited).toMatchObject({ id: created.id, date: editDate, purpose: 'substitute', room: 'Smoke-Edit' })

    await page.getByRole('button', { name: /編輯單日課程/ }).click()
    const beforeDelete = await page.evaluate(({ dataKey, activationKey }) => ({
      raw: localStorage.getItem(dataKey),
      revision: JSON.parse(localStorage.getItem(activationKey) ?? 'null')?.documentRevision,
      attemptId: JSON.parse(localStorage.getItem(activationKey) ?? 'null')?.attemptId,
    }), { dataKey: APP_DATA_V9_KEY, activationKey: V9_ACTIVATION_KEY })
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('dialog', { name: '編輯單日課程' })
      .getByRole('button', { name: '刪除單日課程' }).click()
    await expect(page.getByRole('dialog', { name: '編輯單日課程' })).toBeHidden()

    const deletion = await page.evaluate(async ({ dataKey, activationKey, backupPrefix }) => {
      const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
      const [storage, runtime, validators] = await Promise.all([
        import(moduleUrl('data/storageV9.ts')),
        import(moduleUrl('formalRuntime.ts')),
        import(moduleUrl('data/validators/v9.ts')),
      ])
      const raw = localStorage.getItem(dataKey)
      const metadataRaw = localStorage.getItem(activationKey)
      const data = raw ? JSON.parse(raw) : null
      const metadata = metadataRaw ? JSON.parse(metadataRaw) : null
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key): key is string => Boolean(key?.startsWith(backupPrefix)))
      const backups = keys.map((key) => ({ key, record: JSON.parse(localStorage.getItem(key) ?? 'null') }))
      const decision = await runtime.inspectFormalRuntime(localStorage)
      return {
        remainingOneOffs: data?.oneOffLessons?.length,
        validDocument: validators.isCompatibleAppDataV9(data),
        revision: metadata?.documentRevision,
        attemptId: metadata?.attemptId,
        backups,
        writeEvidenceValid: raw !== null && metadataRaw !== null
          && await storage.checkV9WriteEvidence(localStorage, raw, metadataRaw),
        runtime: decision.runtime,
        v9Status: 'v9Status' in decision ? decision.v9Status : null,
      }
    }, { dataKey: APP_DATA_V9_KEY, activationKey: V9_ACTIVATION_KEY, backupPrefix: V9_AUTO_BACKUP_PREFIX })
    expect(deletion).toMatchObject({
      remainingOneOffs: 0,
      validDocument: true,
      revision: beforeDelete.revision + 1,
      attemptId: beforeDelete.attemptId,
      writeEvidenceValid: true,
      runtime: 'v9',
      v9Status: 'active',
    })
    expect(deletion.backups).toHaveLength(1)
    expect(deletion.backups[0]).toMatchObject({
      key: `${V9_AUTO_BACKUP_PREFIX}${deletion.backups[0].record.mutationAttemptId}`,
      record: {
        schemaVersion: 1,
        kind: 'v9-pre-mutation-backup',
        operation: 'delete-one-off-lesson',
        revision: beforeDelete.revision,
        rawDocument: beforeDelete.raw,
      },
    })

    await reloadFormalV9(page)
    await expect(page.getByText('已儲存至此裝置', { exact: true })).toHaveText('已儲存至此裝置')
    await expect(page.getByRole('button', { name: /編輯單日課程/ })).toHaveCount(0)
    const finalRuntime = await page.evaluate(async () => {
      const modulePath = '/aster-timetable/src/formalRuntime.ts'
      const runtime = await import(modulePath)
      return runtime.inspectFormalRuntime(localStorage)
    })
    expect(finalRuntime).toEqual({ runtime: 'v9', v9Status: 'active' })
  })

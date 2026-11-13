import {
  APP_DATA_V9_KEY,
  createFormalV9BrowserFixture,
  expect,
  initializeFormalV9ThroughProductionEntry,
  proveBrowserContextIsolation,
  reloadFormalV9,
  test,
} from './fixtures/formalV9'

test('Formal V9 AddChoice reuses resource managers and returns to the four-entry menu',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    const fixture = await createFormalV9BrowserFixture(page)
    expect(fixture).toMatchObject({ validDocument: true, writeEvidenceValid: true,
      runtime: 'v9', v9Status: 'active' })
    await reloadFormalV9(page)

    const addTrigger = page.getByRole('button', { name: '新增課程' })
    await addTrigger.click()
    let choice = page.getByRole('dialog', { name: '新增課程' })
    await expect(choice.getByRole('button', { name: /新增固定課程/ })).toBeVisible()
    await expect(choice.getByRole('button', { name: /新增單日課程/ })).toBeVisible()
    await expect(choice.getByRole('button', { name: /管理科目/ })).toBeVisible()
    await expect(choice.getByRole('button', { name: /管理班級/ })).toBeVisible()
    await expect(choice).not.toContainText('任教單位')

    await choice.getByRole('button', { name: /管理科目/ }).click()
    const subjectManager = page.getByRole('dialog', { name: '管理科目' })
    await expect(subjectManager).toBeVisible()
    await expect(subjectManager).not.toContainText('任教單位')
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await subjectManager.getByRole('button', { name: '關閉對話框' }).click()
    choice = page.getByRole('dialog', { name: '新增課程' })
    await expect(choice).toBeVisible()
    await expect(choice.getByRole('button', { name: /管理科目/ })).toBeFocused()

    await choice.getByRole('button', { name: /管理班級/ }).click()
    const classManager = page.getByRole('dialog', { name: '管理班級' })
    await expect(classManager).not.toContainText('任教單位')
    await classManager.getByRole('button', { name: '＋ 新增班級' }).click()
    const form = classManager.getByRole('form', { name: '新增班級表單' })
    await form.getByLabel('新班級班號').fill('2')
    await form.getByRole('button', { name: '新增班級' }).click()
    await expect(classManager.getByText('已儲存：已新增班級。')).toBeVisible()
    await expect(classManager).toBeVisible()
    await classManager.getByRole('button', { name: '關閉對話框' }).click()
    choice = page.getByRole('dialog', { name: '新增課程' })
    await expect(choice).toBeVisible()
    await expect(choice.getByRole('button', { name: /管理班級/ })).toBeFocused()

    await choice.getByRole('button', { name: '關閉對話框' }).click()
    await expect(choice).toBeHidden()
    await expect(page.getByRole('heading', { name: '本週行事曆' })).toBeVisible()
    await expect(addTrigger).toBeFocused()

    const createdClass = await page.evaluate((dataKey) => {
      const data = JSON.parse(localStorage.getItem(dataKey) ?? 'null')
      return data?.classes?.find((item: { name: string }) => item.name === '102') ?? null
    }, APP_DATA_V9_KEY)
    expect(createdClass).toMatchObject({ name: '102' })

    await reloadFormalV9(page)
    await expect(page.getByText('已儲存至此裝置', { exact: true })).toHaveText('已儲存至此裝置')
    await expect(page.getByRole('button', { name: '管理班級，2 個有效班級' })).toBeVisible()
    await page.getByRole('button', { name: '新增課程' }).click()
    choice = page.getByRole('dialog', { name: '新增課程' })
    await expect(choice.getByRole('button', { name: /新增固定課程|新增單日課程|管理科目|管理班級/ }))
      .toHaveCount(4)
  })

import { readFile } from 'node:fs/promises'
import {
  advanceFormalV8RecoveryRevision,
  APP_DATA_V9_KEY,
  expect,
  inspectRecoveryIdentity,
  proveBrowserContextIsolation,
  seedFormalV8RecoveryFixture,
  test,
} from './fixtures/formalV9'

test('E Recovery exports exact raw and invalidates snapshot state after a verified cross-page revision',
  async ({ browser, formalPage: firstPage }) => {
    await proveBrowserContextIsolation(browser, firstPage)
    const seeded = await seedFormalV8RecoveryFixture(firstPage)
    expect(seeded).toMatchObject({ revision: 0, snapshotKind: 'migration-ready' })
    expect(seeded.raw).not.toBeNull()
    expect(seeded.evidenceIdentity).toBeTruthy()

    await firstPage.reload({ waitUntil: 'domcontentloaded' })
    await expect(firstPage.getByRole('main')).toBeVisible()
    await expect(firstPage.getByText(/已驗證原始 V8 資料/)).toBeVisible()
    const exportButton = firstPage.getByRole('button', { name: '匯出 v8-source 原始 JSON' })
    await exportButton.focus()
    await expect(exportButton).toBeFocused()
    const downloadPromise = firstPage.waitForEvent('download')
    await exportButton.click()
    const download = await downloadPromise
    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()
    expect(await readFile(downloadPath!, 'utf8')).toBe(seeded.raw)
    await expect(exportButton).toBeFocused()
    await expect(firstPage.getByText(/已準備此快照的原始 V8 JSON/)).toBeVisible()
    const confirmation = firstPage.getByRole('checkbox', { name: /我已自行確認此快照/ })
    await confirmation.check()
    await expect(firstPage.getByRole('button', { name: '確認轉換並啟用獨立科目庫' })).toBeEnabled()

    const secondPage = await firstPage.context().newPage()
    expect(secondPage.context()).toBe(firstPage.context())
    await secondPage.goto('?runtime=formal', { waitUntil: 'domcontentloaded' })
    await expect(secondPage.getByRole('main')).toBeVisible()
    const advanced = await advanceFormalV8RecoveryRevision(secondPage)
    expect(advanced).toMatchObject({ revision: 1, snapshotKind: 'migration-ready' })
    expect(advanced.evidenceIdentity).not.toBe(seeded.evidenceIdentity)

    await expect(firstPage.getByRole('main')).toBeVisible()
    await expect(firstPage.getByText(/已準備此快照的原始 V8 JSON/)).toHaveCount(0)
    await expect(firstPage.getByRole('checkbox', { name: /我已自行確認此快照/ })).not.toBeChecked()
    await expect(firstPage.getByRole('button', { name: '確認轉換並啟用獨立科目庫' })).toBeDisabled()
    const refreshed = await inspectRecoveryIdentity(firstPage)
    expect(refreshed).toEqual({ kind: 'migration-ready', evidenceIdentity: advanced.evidenceIdentity })
    expect(await firstPage.evaluate((key) => localStorage.getItem(key), APP_DATA_V9_KEY)).toBeNull()
    await secondPage.close()
  })

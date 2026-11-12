import type { Page } from '@playwright/test'
import { APP_DATA_V9_KEY, V9_ACTIVATION_KEY, V9_AUTO_BACKUP_PREFIX,
  createFormalV9BrowserFixture, expect, initializeFormalV9ThroughProductionEntry,
  proveBrowserContextIsolation, readFormalV9Evidence, reloadFormalV9, test } from './fixtures/formalV9'

async function openDataManagement(page: Page) {
  await page.getByRole('button', { name: '專案設定' }).click()
  await page.getByRole('button', { name: /資料管理/ }).click()
  await expect(page.getByText('目前位置：專案管理 / 資料管理')).toBeVisible()
}

async function candidateRaw(page: Page, id: string, name: string) {
  return page.evaluate(async ({ projectId, projectName }) => {
    const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
    const [storage, management] = await Promise.all([
      import(moduleUrl('data/storageV9.ts')), import(moduleUrl('data/managementV9.ts')),
    ])
    const document = management.createEmptyProjectV9(storage.createEmptyAppDataV9(),
      { name: projectName }, projectId, '2026-11-12T02:00:00.000Z')
    return JSON.stringify(document, null, 2)
  }, { projectId: id, projectName: name })
}

async function selectJson(page: Page, name: string, raw: string) {
  await page.getByLabel('選擇 JSON 檔案').setInputFiles({ name, mimeType: 'application/json',
    buffer: Buffer.from(raw) })
}

test('verified JSON export downloads exact confirmed raw with the product filename',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    await createFormalV9BrowserFixture(page)
    await reloadFormalV9(page)
    const before = await readFormalV9Evidence(page)
    await openDataManagement(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'), page.getByRole('button', { name: '匯出 JSON' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^toki-backup-\d{4}-\d{2}-\d{2}-\d{6}\.json$/)
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString('utf8')).toBe(before.rawDocument)
  })

test('validated preview does not write, confirmed replacement survives reload, and malformed JSON is rejected',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    const fixture = await createFormalV9BrowserFixture(page)
    await reloadFormalV9(page)
    await openDataManagement(page)
    const before = await readFormalV9Evidence(page)
    await selectJson(page, 'bad.json', '{bad')
    await expect(page.getByRole('alert')).toContainText('有效的 JSON')
    expect((await readFormalV9Evidence(page)).rawDocument).toBe(before.rawDocument)

    const raw = await candidateRaw(page, 'replacement-project', 'Replacement Project')
    await selectJson(page, 'replacement.json', raw)
    await expect(page.getByText('replacement.json')).toBeVisible()
    await expect(page.getByRole('row', { name: 'Project 1 1' })).toBeVisible()
    expect((await readFormalV9Evidence(page)).rawDocument).toBe(before.rawDocument)
    await expect(page.getByRole('button', { name: '確認匯入' })).toBeDisabled()
    await page.getByRole('checkbox', { name: '我了解目前資料將被替換' }).check()
    await page.getByRole('button', { name: '確認匯入' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    const imported = await readFormalV9Evidence(page)
    expect(imported).toMatchObject({ rawDocument: raw, revision: fixture.fixtureRevision + 1,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
    expect(imported.document?.projects.map((item: { id: string }) => item.id))
      .toEqual(['replacement-project'])
    await reloadFormalV9(page)
    expect(await readFormalV9Evidence(page)).toMatchObject({ rawDocument: raw,
      writeEvidenceValid: true, runtime: 'v9', v9Status: 'active' })
  })

test('backup failure and a stale tab both block JSON replacement while retaining preview evidence',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    await createFormalV9BrowserFixture(page)
    await reloadFormalV9(page)
    await openDataManagement(page)
    const raw = await candidateRaw(page, 'must-not-import', 'Must Not Import')
    await selectJson(page, 'blocked.json', raw)
    const before = await readFormalV9Evidence(page)
    await page.evaluate((prefix) => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key.startsWith(prefix)) throw new Error('backup quota')
        return original.call(this, key, value)
      }
    }, V9_AUTO_BACKUP_PREFIX)
    await page.getByRole('checkbox', { name: '我了解目前資料將被替換' }).check()
    await page.getByRole('button', { name: '確認匯入' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByText('blocked.json')).toBeVisible()
    expect((await readFormalV9Evidence(page)).rawDocument).toBe(before.rawDocument)

    await reloadFormalV9(page)
    await openDataManagement(page)
    const staleRaw = await candidateRaw(page, 'stale-import', 'Stale Import')
    await selectJson(page, 'stale.json', staleRaw)
    const second = await page.context().newPage()
    await second.goto('?runtime=formal', { waitUntil: 'domcontentloaded' })
    await expect(second.getByRole('heading', { name: '本週行事曆' })).toBeVisible()
    await second.evaluate(async () => {
      const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
      const [storage, management] = await Promise.all([
        import(moduleUrl('data/storageV9.ts')), import(moduleUrl('data/managementV9.ts')),
      ])
      const loaded = storage.loadAppDataV9(localStorage)
      const next = management.createEmptyProjectV9(loaded.document!, { name: 'Other Tab' },
        'other-tab', '2026-11-12T02:10:00.000Z')
      await storage.persistAppDataV9(localStorage, loaded.document!, next, {
        raw: loaded.rawDocument!, metadataRaw: loaded.rawMetadata!,
        revision: loaded.metadata!.documentRevision,
      })
    })
    await expect(page.getByRole('button', { name: '確認匯入' })).toBeDisabled()
    const afterOtherTab = await readFormalV9Evidence(second)
    expect(afterOtherTab.document?.projects.some((item: { id: string }) => item.id === 'stale-import')).toBe(false)
    await second.close()
  })

test('metadata write failure reloads blocked Recovery with exact document, metadata and import backup evidence',
  async ({ browser, formalPage: page }) => {
    await proveBrowserContextIsolation(browser, page)
    await initializeFormalV9ThroughProductionEntry(page)
    await createFormalV9BrowserFixture(page)
    await reloadFormalV9(page)
    await openDataManagement(page)
    const raw = await candidateRaw(page, 'partial-import', 'Partial Import')
    await selectJson(page, 'partial.json', raw)
    const before = await readFormalV9Evidence(page)
    await page.evaluate(({ documentKey, activationKey, candidate }) => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === activationKey && localStorage.getItem(documentKey) === candidate) {
          throw new Error('metadata quota')
        }
        return original.call(this, key, value)
      }
    }, { documentKey: APP_DATA_V9_KEY, activationKey: V9_ACTIVATION_KEY, candidate: raw })
    await page.getByRole('checkbox', { name: '我了解目前資料將被替換' }).check()
    await page.getByRole('button', { name: '確認匯入' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '資料復原' })).toBeVisible()
    await expect(page.getByText(/目前資料無法安全續接/)).toBeVisible()
    const evidence = await page.evaluate(async ({ documentKey, activationKey, autoPrefix }) => {
      const moduleUrl = (path: string) => `/aster-timetable/src/${path}`
      const recovery = await import(moduleUrl('formalV9Recovery.ts'))
      const snapshot = await recovery.inspectFormalV9Recovery(localStorage)
      const port = recovery.createFormalV9RecoveryExportPort(snapshot)
      const backupKey = port.entries.find((item: { key: string }) => item.key.startsWith(autoPrefix))?.key
      return { kind: snapshot.kind, capabilities: snapshot.capabilities,
        documentRaw: port.readExact(documentKey), metadataRaw: port.readExact(activationKey),
        backupRaw: backupKey ? port.readExact(backupKey) : null }
    }, { documentKey: APP_DATA_V9_KEY, activationKey: V9_ACTIVATION_KEY,
      autoPrefix: V9_AUTO_BACKUP_PREFIX })
    expect(evidence).toMatchObject({ kind: 'export-only', documentRaw: raw,
      metadataRaw: before.rawMetadata,
      capabilities: { activate: false, resume: false, resumeOrphan: false, export: true } })
    expect(JSON.parse(evidence.backupRaw!)).toMatchObject({ operation: 'import-json',
      rawDocument: before.rawDocument, revision: before.revision })
  })

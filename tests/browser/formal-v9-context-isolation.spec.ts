import {
  FORMAL_V9_PATH,
  expect,
  test,
} from './fixtures/formalV9'

test('disposable Chromium contexts keep test-origin storage isolated', async ({ browser }) => {
  expect(browser.browserType().name()).toBe('chromium')
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  await Promise.all([firstContext, secondContext].map((context) => context.route(
    /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//,
    (route) => route.abort('blockedbyclient'),
  )))
  try {
    const [firstPage, secondPage] = await Promise.all([
      firstContext.newPage(),
      secondContext.newPage(),
    ])
    await Promise.all([
      firstPage.goto(FORMAL_V9_PATH, { waitUntil: 'domcontentloaded' }),
      secondPage.goto(FORMAL_V9_PATH, { waitUntil: 'domcontentloaded' }),
    ])
    await firstPage.evaluate(() => localStorage.setItem('toki-browser-smoke-context-probe', 'isolated'))
    await expect.poll(() => secondPage.evaluate(
      () => localStorage.getItem('toki-browser-smoke-context-probe'),
    )).toBeNull()
    const tokiKeys = await secondPage.evaluate(() => Array.from(
      { length: localStorage.length }, (_, index) => localStorage.key(index),
    ).filter((key) => key?.startsWith('aster-timetable-') || key?.startsWith('toki-v9-')))
    expect(tokiKeys).toEqual([])
  } finally {
    await Promise.all([firstContext.close(), secondContext.close()])
  }
})

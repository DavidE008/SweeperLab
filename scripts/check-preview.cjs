const { chromium } = require('playwright');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ offline: true });
    await page.goto(pathToFileURL(resolve('preview/SweeperLab.html')).href);
    await page.getByText('Learn in 60 seconds', { exact: true }).click();
    await page.getByRole('button', { name: 'Square 2, covered' }).click();
    await page.getByText('Try another board', { exact: true }).click();
    await page.getByRole('button', { name: 'Square 4, covered' }).click();
    await page.getByText('Finish lesson', { exact: true }).click();
    await page.getByText('Close', { exact: true }).click();
    await page.getByRole('button', { name: 'Row 1, column 1, covered', exact: true }).click();
    await page.waitForFunction(() => {
      const value = localStorage.getItem('sweeperlab.session.v1');
      return value && JSON.parse(value).game?.clicks > 0;
    });
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

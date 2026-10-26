const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const directory = path.resolve('artifacts');
  await fs.mkdir(directory, { recursive: true });
  try {
    await page.goto('http://127.0.0.1:2022');
    await page.getByRole('button', { name: 'Ichigo, Main Kamen Rider', exact: true }).waitFor();
    await page.screenshot({ path: path.join(directory, 'desktop.png'), fullPage: true, animations: 'disabled' });
    console.log(JSON.stringify({ errors, title: await page.title(), tiles: await page.locator('.hex-key').count(), dimensions: await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })) }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(directory, 'mobile.png'), fullPage: true, animations: 'disabled' });
    console.log(JSON.stringify({ mobile: await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })) }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

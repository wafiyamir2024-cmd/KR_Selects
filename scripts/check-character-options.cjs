const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function installSpeechProbe(context) {
  await context.addInitScript(() => {
    localStorage.setItem('kr-arena-sound', 'on');
    window.spokenNames = [];
    const speech = { getVoices: () => [{ name: 'Test English', lang: 'en-US', localService: true }], addEventListener() {}, removeEventListener() {}, cancel() {}, speak(utterance) { window.spokenNames.push(utterance.text); } };
    Object.defineProperty(window, 'speechSynthesis', { value: speech, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(text) { this.text = text; } }, configurable: true });
  });
}

function expectedRoster(source) {
  return source.flatMap((group, groupIndex) => group.Characters.map((character, characterIndex) => ({
    ...character, id: `character-${groupIndex}-${characterIndex}`, series: group.Series,
    no: Number(group.No), subNo: Number(group['Sub No']), order: Number(character.Order),
  }))).sort((a, b) => a.no - b.no || a.subNo - b.subNo || a.order - b.order);
}

function expectedRows(roster) {
  const foundation = roster.filter(character => character.no === 0 && character.subNo === 0);
  const upper = roster.filter(character => character.no !== 0 || character.subNo !== 0);
  const rows = foundation.length ? [foundation] : [];
  for (let index = 0; index < upper.length; index += 40) rows.push(upper.slice(index, index + 40));
  return rows;
}

function rider(page, character) {
  return page.locator(`.lineup-character[data-id="${character.id}"]`);
}

async function assertSpoken(page, name) {
  await page.waitForFunction(expected => window.spokenNames.at(-1) === expected, name);
  assert.equal(await page.evaluate(() => window.spokenNames.at(-1)), name);
}

async function assertDetails(page, character) {
  await page.locator('#lineup-tooltip').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#lineup-tooltip strong').textContent(), character.Name);
  assert.equal(await page.locator('#lineup-tooltip span').textContent(), character.series);
  assert.equal(await page.locator('#lineup-hover-name').textContent(), character.Name);
  assert.equal(await rider(page, character).getAttribute('aria-label'), `${character.Name}, ${character.series}`);
}

async function assertRows(page, roster) {
  const expected = expectedRows(roster);
  const actual = await page.locator('.lineup-row').evaluateAll(rows => rows.map(row => ({
    index: Number(row.dataset.rowIndex), foundation: row.dataset.foundation === 'true', top: row.getBoundingClientRect().top,
    ids: [...row.querySelectorAll('.lineup-character')].map(button => button.dataset.id),
  })).sort((a, b) => a.index - b.index));
  assert.deepEqual(actual.map(row => row.ids), expected.map(row => row.map(character => character.id)), 'Size and pronunciation must preserve numeric sorting and row membership.');
  assert.equal(new Set(actual.flatMap(row => row.ids)).size, roster.length);
  for (let index = 1; index < actual.length; index++) assert.ok(actual[index].top < actual[index - 1].top, 'Rows must stack from bottom to top.');
  assert.equal(actual[0].foundation, expected[0].every(character => character.no === 0 && character.subNo === 0));
}

async function assertArtworkFits(page) {
  const geometry = await page.evaluate(() => {
    const scroll = document.querySelector('#lineup-scroll');
    const canvas = document.querySelector('#lineup-canvas');
    const canvasBounds = canvas.getBoundingClientRect();
    const scrollBounds = scroll.getBoundingClientRect();
    const left = scrollBounds.left + scroll.clientLeft;
    const right = left + scroll.clientWidth;
    return {
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      horizontalOverflow: scroll.scrollWidth > scroll.clientWidth,
      horizontalPosition: scroll.scrollLeft,
      clipped: [...document.querySelectorAll('.lineup-image')].filter(image => !image.hidden).flatMap(image => {
        const rect = image.getBoundingClientRect();
        return rect.left < left - 1 || rect.right > right + 1 || rect.top < canvasBounds.top - 1 || rect.bottom > canvasBounds.bottom + 1
          ? [{ name: image.alt, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, canvas: { top: canvasBounds.top, bottom: canvasBounds.bottom }, limits: { left, right } }] : [];
      }),
    };
  });
  assert.deepEqual(geometry, { documentOverflow: false, horizontalOverflow: false, horizontalPosition: 0, clipped: [] }, 'Oversized artwork, including the top and edge riders, must fit the poster canvas without horizontal scrolling.');
}

async function assertScale(page, character, baseline, expected) {
  const dimension = async value => rider(page, value).locator('.lineup-image').evaluate(image => {
    const bounds = image.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  const base = await dimension(baseline);
  const actual = await dimension(character);
  assert.ok(base.width > 0 && base.height > 0);
  for (const axis of ['width', 'height']) assert.ok(Math.abs(actual[axis] / base[axis] - expected) < 0.015, `${character.Name}: expected ${expected}x ${axis}, got ${actual[axis] / base[axis]}.`);
}

async function capture(page, filename) {
  await page.waitForFunction(() => {
    const clip = document.querySelector('#lineup-scroll').getBoundingClientRect();
    return [...document.querySelectorAll('.lineup-image')].every(image => {
      const bounds = image.getBoundingClientRect();
      return bounds.bottom <= clip.top || bounds.top >= clip.bottom || image.complete;
    });
  }, undefined, { timeout: 30000 });
  await page.locator('.lineup-image').evaluateAll(async images => {
    await Promise.all(images.filter(image => image.complete && image.naturalWidth).map(image => image.decode().catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: path.resolve('artifacts', filename), fullPage: true, animations: 'disabled' });
}

function makeFixture() {
  const foundation = Array.from({ length: 44 }, (_, index) => ({ Name: `Foundation ${String(index).padStart(3, '0')}`, Order: String(index), Image: 'ichigo.png' }));
  Object.assign(foundation[0], { Name: 'Left Giant', Size: 3 });
  Object.assign(foundation[1], { Name: 'Default Rider' });
  Object.assign(foundation[2], { Name: 'Explicit One', Size: 1 });
  Object.assign(foundation[3], { Name: 'Triple Rider', Size: 3, P: '  Triple Spoken  ' });
  Object.assign(foundation[4], { Name: 'String Triple', Size: '3' });
  Object.assign(foundation[5], { Name: 'String Fraction', Size: '1.5' });
  Object.assign(foundation[6], { Name: 'Zero Size', Size: 0, P: '   ' });
  Object.assign(foundation[7], { Name: 'Negative Size', Size: -2 });
  Object.assign(foundation[8], { Name: 'Invalid Size', Size: 'large' });
  Object.assign(foundation[9], { Name: 'Infinite Size', Size: 'Infinity' });
  Object.assign(foundation[10], { Name: 'Empty Size', Size: ' ' });
  Object.assign(foundation[11], { Name: 'Null Size', Size: null, P: null });
  Object.assign(foundation[12], { Name: 'Boolean Size', Size: true });
  Object.assign(foundation[43], { Name: 'Right Giant', Size: 3 });
  const upper = Array.from({ length: 81 }, (_, index) => ({ Name: `Upper ${String(index).padStart(3, '0')}`, Order: String(index), Image: 'ichigo.png', ...(index === 0 || index === 39 || index === 80 ? { Size: 3 } : {}) }));
  return [
    { No: '2', 'Sub No': '1', Series: 'Upper era', Characters: upper.reverse() },
    { No: '0', 'Sub No': '0', Series: 'Foundation era', Characters: foundation.reverse() },
  ];
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, reducedMotion: 'reduce' });
  await installSpeechProbe(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await fs.mkdir(path.resolve('artifacts'), { recursive: true });
  try {
    const response = page.waitForResponse(result => new URL(result.url()).pathname === '/data.json' && result.request().method() === 'GET');
    await page.goto('http://127.0.0.1:2022');
    const current = expectedRoster(await (await response).json());
    const zx = current.find(character => character.Name === 'ZX');
    const giant = current.find(character => character.Name.replace(/\s/g, '').toLowerCase() === 'shininggillsagito');
    const baseline = current.find(character => character.Name === 'Ichigo');
    assert.ok(zx && giant && baseline, 'The current-data check requires ZX, Ichigo, and Shining Gills Agito.');
    await page.getByRole('searchbox', { name: 'Search characters' }).fill(zx.Name);
    await page.locator(`.hex-key[data-id="${zx.id}"]`).click();
    await assertSpoken(page, 'Zet Cross');
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), 'ZX');
    assert.equal(await page.locator(`.hex-key[data-id="${zx.id}"] .hex-name`).textContent(), 'ZX');
    await page.locator('#lineup-tab').click();
    await rider(page, zx).click();
    await assertSpoken(page, 'Zet Cross');
    await assertDetails(page, zx);
    await assertRows(page, current);
    await assertScale(page, giant, baseline, 3);
    await rider(page, giant).focus();
    await assertDetails(page, giant);
    await assertArtworkFits(page);
    await capture(page, 'character-options-desktop.png');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await rider(page, giant).waitFor();
    await rider(page, giant).focus();
    await assertScale(page, giant, baseline, 3);
    await assertArtworkFits(page);
    await capture(page, 'character-options-mobile.png');
    console.log('PASS: current ZX speaks Zet Cross while visible labels remain ZX; current Shining Gills Agito is 3x on desktop and mobile, with full artwork inside the poster.');

    const fixture = makeFixture();
    const roster = expectedRoster(fixture);
    const byName = name => roster.find(character => character.Name === name);
    const normal = byName('Default Rider');
    await page.route('**/data.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }));
    await page.setViewportSize({ width: 1536, height: 1024 });
    await page.goto('http://127.0.0.1:2022/#select');
    await page.reload();
    await page.locator('.hex-key').first().waitFor();
    for (const [name, spoken] of [['Triple Rider', 'Triple Spoken'], ['Default Rider', 'Default Rider'], ['Zero Size', 'Zero Size'], ['Null Size', 'Null Size']]) {
      const character = byName(name);
      await page.getByRole('searchbox', { name: 'Search characters' }).fill(name);
      await page.locator(`.hex-key[data-id="${character.id}"]`).click();
      await assertSpoken(page, spoken);
      assert.equal(await page.locator('#player-1 .fighter-name').textContent(), name);
    }
    await page.locator('#lineup-tab').click();
    const expectedScales = { 'Left Giant': 3, 'Explicit One': 1, 'Triple Rider': 3, 'String Triple': 3, 'String Fraction': 1.5, 'Zero Size': 1, 'Negative Size': 1, 'Invalid Size': 1, 'Infinite Size': 1, 'Empty Size': 1, 'Null Size': 1, 'Boolean Size': 1, 'Right Giant': 3, 'Upper 000': 3, 'Upper 039': 3, 'Upper 080': 3 };
    for (const width of [1536, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
      await page.reload();
      await rider(page, normal).waitFor();
      await assertRows(page, roster);
      assert.deepEqual(await page.locator('.lineup-row').evaluateAll(rows => rows.map(row => row.children.length)), [44, 40, 40, 1]);
      for (const [name, size] of Object.entries(expectedScales)) await assertScale(page, byName(name), normal, size);
      await assertArtworkFits(page);
      for (const name of ['Left Giant', 'Right Giant', 'Upper 080']) {
        await rider(page, byName(name)).hover();
        await assertDetails(page, byName(name));
        await assertScale(page, byName(name), normal, 3);
        await assertArtworkFits(page);
      }
      for (const name of ['Upper 010', 'Upper 050', 'Upper 010']) {
        await rider(page, byName(name)).hover();
        await assertDetails(page, byName(name));
      }
      await rider(page, byName('Triple Rider')).click();
      await assertSpoken(page, 'Triple Spoken');
      await assertDetails(page, byName('Triple Rider'));
      await rider(page, normal).click();
      await assertSpoken(page, 'Default Rider');
      await assertDetails(page, normal);
      await assertArtworkFits(page);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: numeric/default/invalid Size multipliers, P/name fallbacks in both views, 125 unique sorted riders in 44/40/40/1 rows, edge/top fitting, and adjacent-row hover on desktop/mobile; no JavaScript errors.');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

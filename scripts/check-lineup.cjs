const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

function expectedRoster(source) {
  const numeric = value => value === null || value === undefined || value === '' || typeof value === 'boolean' || !String(value).trim() || !Number.isFinite(Number(value)) ? null : Number(value);
  const compare = (a, b) => a === null ? b === null ? 0 : 1 : b === null ? -1 : a - b;
  return source.flatMap((group, groupIndex) => (group.Characters || []).map((character, characterIndex) => ({
    id: `character-${groupIndex}-${characterIndex}`,
    name: character.Name,
    series: group.Series,
    no: numeric(group.No),
    subNo: numeric(group['Sub No']),
    order: numeric(character.Order),
  }))).sort((a, b) => compare(a.no, b.no) || compare(a.subNo, b.subNo) || compare(a.order, b.order));
}

function expectedRows(roster) {
  const foundation = roster.filter(character => character.no === 0 && character.subNo === 0);
  const remaining = roster.filter(character => character.no !== 0 || character.subNo !== 0);
  const rows = foundation.length ? [{ foundation: true, characters: foundation }] : [];
  for (let index = 0; index < remaining.length; index += 40) rows.push({ foundation: false, characters: remaining.slice(index, index + 40) });
  return rows;
}

async function assertLayout(page, roster) {
  const expected = expectedRows(roster);
  const actual = await page.locator('.lineup-row').evaluateAll(rows => rows.map(row => ({
    index: Number(row.dataset.rowIndex),
    foundation: row.dataset.foundation === 'true',
    top: row.getBoundingClientRect().top,
    characters: [...row.querySelectorAll('.lineup-character')].map(character => ({
      id: character.dataset.id,
      label: character.getAttribute('aria-label'),
      center: (character.getBoundingClientRect().left + character.getBoundingClientRect().right) / 2,
    })),
  })).sort((a, b) => a.index - b.index));
  assert.equal(actual.length, expected.length, 'The lineup must have only the required foundation and 40-rider rows.');
  assert.deepEqual(actual.map(row => row.index), expected.map((_, index) => index));
  for (let index = 0; index < expected.length; index++) {
    assert.equal(actual[index].foundation, expected[index].foundation);
    assert.deepEqual(actual[index].characters.map(character => character.id), expected[index].characters.map(character => character.id));
    assert.deepEqual(actual[index].characters.map(character => character.label), expected[index].characters.map(character => `${character.name}, ${character.series}`));
    if (!actual[index].foundation) assert.ok(actual[index].characters.length <= 40, 'Upper rows must contain at most 40 riders.');
    for (let column = 1; column < actual[index].characters.length; column++) {
      assert.ok(actual[index].characters[column].center > actual[index].characters[column - 1].center, 'Each row must read in sorted order from left to right, including enlarged riders.');
    }
    if (index > 0) assert.ok(actual[index].top < actual[index - 1].top, 'Increasing row indexes must move upward on the poster.');
  }
  const ids = actual.flatMap(row => row.characters.map(character => character.id));
  assert.equal(new Set(ids).size, roster.length, 'Every character must appear exactly once.');
  assert.deepEqual([...ids].sort(), roster.map(character => character.id).sort());
  await assertNoHorizontalOverflow(page);
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const view = document.querySelector('#lineup-view');
    const scroll = document.querySelector('#lineup-scroll');
    const canvas = document.querySelector('#lineup-canvas');
    const scrollBounds = scroll.getBoundingClientRect();
    const left = scrollBounds.left + scroll.clientLeft;
    const right = left + scroll.clientWidth;
    return {
      document: document.documentElement.scrollWidth > innerWidth,
      view: view.scrollWidth > view.clientWidth,
      viewScroll: view.scrollLeft,
      scroll: scroll.scrollWidth > scroll.clientWidth || scroll.scrollLeft !== 0,
      canvas: canvas.scrollWidth > canvas.clientWidth,
      clippedRider: [...view.querySelectorAll('.lineup-character')].some(character => {
        const bounds = character.getBoundingClientRect();
        return bounds.left < -1 || bounds.right > innerWidth + 1;
      }),
      clippedArtwork: [...view.querySelectorAll('.lineup-image')].filter(image => !image.hidden).some(image => {
        const bounds = image.getBoundingClientRect();
        return bounds.left < left - 1 || bounds.right > right + 1;
      }),
    };
  });
  assert.deepEqual(overflow, { document: false, view: false, viewScroll: 0, scroll: false, canvas: false, clippedRider: false, clippedArtwork: false }, 'The full lineup and overlapping artwork must fit horizontally on every screen.');
}

async function settleVisibleArtwork(page) {
  await page.waitForFunction(() => {
    const clip = document.querySelector('#lineup-scroll').getBoundingClientRect();
    return [...document.querySelectorAll('.lineup-image')].every(image => {
      const bounds = image.parentElement.getBoundingClientRect();
      return bounds.bottom <= clip.top || bounds.top >= clip.bottom || image.complete;
    });
  }, undefined, { timeout: 30000 });
  const status = await page.locator('.lineup-image').evaluateAll(async images => {
    const clip = document.querySelector('#lineup-scroll').getBoundingClientRect();
    const visible = images.filter(image => {
      const bounds = image.parentElement.getBoundingClientRect();
      return bounds.bottom > clip.top && bounds.top < clip.bottom;
    });
    await Promise.all(visible.filter(image => image.naturalWidth > 0).map(image => image.decode().catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      visible: visible.length,
      loaded: visible.filter(image => image.complete && image.naturalWidth > 0).length,
      broken: visible.filter(image => image.complete && image.naturalWidth === 0).length,
      pending: visible.filter(image => !image.complete).length,
    };
  });
  assert.equal(status.pending, 0, 'Visible artwork must finish loading before screenshots are captured.');
  console.log('Visible lineup artwork:', JSON.stringify(status));
}

async function assertCharacterDetails(page, character) {
  const tooltip = page.locator('#lineup-tooltip');
  await tooltip.waitFor({ state: 'visible' });
  assert.equal(await tooltip.getAttribute('role'), 'tooltip');
  assert.equal(await tooltip.locator('strong').textContent(), character.name);
  assert.equal(await tooltip.locator('span').textContent(), character.series);
  assert.equal(await page.locator('#lineup-hover-name').textContent(), character.name);
  assert.equal(await page.locator('#lineup-hover-series').textContent(), character.series);
  assert.ok(await tooltip.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
  }), 'The character tooltip must remain inside the viewport.');
}

function lineupCharacter(page, character) {
  return page.locator(`.lineup-character[data-id="${character.id}"]`);
}

function fixtureCharacters(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({
    Name: `${prefix} ${String(count - 1 - index).padStart(3, '0')}`,
    Order: String(count - 1 - index),
    Image: 'ichigo.png',
    Portrait: 'nigo.png',
  }));
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => localStorage.setItem('kr-arena-sound', 'off'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const artifactDir = path.resolve('artifacts');
  await fs.mkdir(artifactDir, { recursive: true });
  try {
    const currentData = page.waitForResponse(response => new URL(response.url()).pathname === '/data.json' && response.request().method() === 'GET');
    await page.goto('http://127.0.0.1:2022');
    const currentRoster = expectedRoster(await (await currentData).json());
    assert.ok(currentRoster.length >= 3, 'The current-data interaction check requires three riders.');
    const selected = currentRoster[2];
    await page.locator('#select-view .hex-key').first().waitFor();
    await page.getByRole('searchbox', { name: 'Search characters' }).fill(selected.name);
    await page.locator(`#select-view .hex-key[data-id="${selected.id}"]`).click();
    await page.getByRole('button', { name: 'CONFIRM RIDER', exact: true }).click();
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'LOCKED IN');
    await page.locator('#lineup-tab').click();
    await page.locator('#lineup-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#select-view').isVisible(), false);
    assert.equal(await page.locator('#lineup-tab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#select-tab').getAttribute('aria-selected'), 'false');
    await assertLayout(page, currentRoster);
    await lineupCharacter(page, currentRoster[0]).hover();
    await assertCharacterDetails(page, currentRoster[0]);
    await lineupCharacter(page, currentRoster[1]).click();
    await assertCharacterDetails(page, currentRoster[1]);
    await settleVisibleArtwork(page);
    await page.screenshot({ path: path.join(artifactDir, 'lineup-desktop.png'), fullPage: true, animations: 'disabled' });
    await page.locator('#select-tab').click();
    await page.locator('#select-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#lineup-view').isVisible(), false);
    assert.equal(await page.locator('#select-tab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), selected.name);
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'LOCKED IN');
    assert.equal(await page.getByRole('searchbox', { name: 'Search characters' }).inputValue(), selected.name);
    console.log('PASS: current-data lineup ordering, foundation, hover/click details, accessible tabs, and preserved selection/filter/lock state.');

    const fixture = [
      { No: '10', 'Sub No': '0', Series: 'Late era', Characters: fixtureCharacters('Late', 202) },
      { No: '2', 'Sub No': '2', Series: 'Middle era', Characters: fixtureCharacters('Middle', 101) },
      { No: '0', 'Sub No': '0', Series: 'Foundation era', Characters: fixtureCharacters('Foundation', 44) },
      { No: '2', 'Sub No': '1', Series: 'Early era', Characters: fixtureCharacters('Early', 260) },
      { No: '0', 'Sub No': '1', Series: 'Zero branch', Characters: fixtureCharacters('Zero', 43) },
    ];
    const fixtureRoster = expectedRoster(fixture);
    const rows = expectedRows(fixtureRoster);
    await page.route('**/data.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }));
    await page.goto('http://127.0.0.1:2022/#lineup');
    await page.reload();
    await page.locator('#lineup-view .lineup-character').first().waitFor();
    assert.equal(await page.locator('#select-view').isVisible(), false, 'The lineup hash must open the lineup directly.');
    assert.equal(await page.locator('.lineup-character').count(), 650);
    assert.equal(await page.locator('.lineup-row[data-foundation="true"] .lineup-character').count(), 44, 'The complete foundation must remain in one bottom row.');
    await assertLayout(page, fixtureRoster);
    assert.ok(await page.locator('.lineup-image').evaluateAll(images => images.length === 650 && images.every(image => new URL(image.src).pathname === '/images/ichigo.png' && getComputedStyle(image).objectFit === 'contain')), 'The lineup must use uncropped full-body Image artwork, never the Portrait field.');
    await lineupCharacter(page, rows[2].characters[4]).hover();
    await assertCharacterDetails(page, rows[2].characters[4]);
    await lineupCharacter(page, rows[1].characters[4]).hover();
    await assertCharacterDetails(page, rows[1].characters[4]);
    await lineupCharacter(page, rows[0].characters[2]).click();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.lineup-character:focus').getAttribute('data-id'), rows[0].characters[3].id);
    await assertCharacterDetails(page, rows[0].characters[3]);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('.lineup-character:focus').getAttribute('data-id'), rows[0].characters[2].id);
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('.lineup-character:focus').getAttribute('data-id'), rows[1].characters[2].id);
    await assertCharacterDetails(page, rows[1].characters[2]);
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('.lineup-character:focus').getAttribute('data-id'), rows[0].characters[2].id);
    await assertNoHorizontalOverflow(page);
    await settleVisibleArtwork(page);
    await page.screenshot({ path: path.join(artifactDir, 'lineup-650.png'), fullPage: true, animations: 'disabled' });
    console.log('PASS: 650 unique riders, numeric sorting, 44-rider foundation, upper rows capped at 40, upward stacking, full-body artwork, and directional keyboard details.');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.locator('#lineup-view .lineup-character').first().waitFor();
    await assertLayout(page, fixtureRoster);
    await lineupCharacter(page, rows[0].characters.at(-1)).click();
    await assertCharacterDetails(page, rows[0].characters.at(-1));
    await assertNoHorizontalOverflow(page);
    await settleVisibleArtwork(page);
    await page.screenshot({ path: path.join(artifactDir, 'lineup-mobile.png'), fullPage: true, animations: 'disabled' });
    console.log('PASS: 650-rider mobile poster and tooltip fit without horizontal overflow.');

    const noFoundation = [
      { No: '1', 'Sub No': '0', Series: 'Ordinary era', Characters: fixtureCharacters('Ordinary', 43) },
      { No: '0', 'Sub No': '2', Series: 'Other zero era', Characters: fixtureCharacters('Other', 2) },
    ];
    await page.unroute('**/data.json');
    await page.route('**/data.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(noFoundation) }));
    await page.reload();
    await page.locator('#lineup-view .lineup-character').first().waitFor();
    assert.equal(await page.locator('.lineup-row[data-foundation="true"]').count(), 0);
    await assertLayout(page, expectedRoster(noFoundation));
    assert.deepEqual(errors, []);
    console.log('PASS: absent foundation produces ordinary 40-rider rows without an empty reserved row; no JavaScript errors.');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

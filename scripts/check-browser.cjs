const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function installSpeechProbe(context) {
  await context.addInitScript(() => {
    window.spokenNames = [];
    const speech = { getVoices: () => [{ name: 'Test English', lang: 'en-US', localService: true }], addEventListener() {}, removeEventListener() {}, cancel() {}, speak(utterance) { window.spokenNames.push(utterance.text); } };
    Object.defineProperty(window, 'speechSynthesis', { value: speech, configurable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { constructor(text) { this.text = text; } }, configurable: true });
  });
}

async function assertFocusedRiderVisible(page) {
  assert.ok(await page.locator(':focus').evaluate(element => {
    if (!element.classList.contains('hex-key')) return false;
    const tile = element.getBoundingClientRect();
    const field = document.querySelector('#hex-field').getBoundingClientRect();
    return tile.top >= field.top - 1 && tile.bottom <= field.bottom + 1
      && tile.left >= field.left - 1 && tile.right <= field.right + 1;
  }), 'The focused rider must remain visible on both axes inside the scrolling roster.');
  assert.equal(await page.locator('#player-1 .fighter-name').textContent(), await page.locator(':focus .hex-name').textContent(), 'Pointer hover must not override keyboard selection after scrolling.');
  await assertNoHorizontalOverflow(page);
}

async function assertRosterAtOrigin(page, message) {
  assert.deepEqual(await page.locator('#hex-field').evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft })), { top: 0, left: 0 }, message);
  await assertNoHorizontalOverflow(page);
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const field = document.querySelector('#hex-field');
    const grid = document.querySelector('#hex-grid');
    const fieldBounds = field.getBoundingClientRect();
    const gridBounds = grid.getBoundingClientRect();
    const left = fieldBounds.left + field.clientLeft;
    const right = left + field.clientWidth;
    return {
      document: document.documentElement.scrollWidth > innerWidth,
      field: field.scrollWidth > field.clientWidth,
      grid: grid.scrollWidth > field.clientWidth || gridBounds.left < left - 1 || gridBounds.right > right + 1,
      clippedColumn: [...grid.querySelectorAll('.hex-key')].slice(0, 30).some(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.left < left - 1 || bounds.right > right + 1;
      }),
      scrollLeft: field.scrollLeft,
    };
  });
  if (overflow.document || overflow.field || overflow.grid || overflow.clippedColumn || overflow.scrollLeft) {
    console.error('Roster overflow geometry:', await page.evaluate(() => {
      const field = document.querySelector('#hex-field');
      const grid = document.querySelector('#hex-grid');
      const bounds = field.getBoundingClientRect();
      return {
        field: { left: bounds.left, right: bounds.right, clientWidth: field.clientWidth, scrollWidth: field.scrollWidth },
        grid: { left: grid.getBoundingClientRect().left, right: grid.getBoundingClientRect().right, width: grid.style.width, hexWidth: grid.style.getPropertyValue('--hex-width'), computedWidth: getComputedStyle(grid).width, maxWidth: getComputedStyle(grid).maxWidth, flex: getComputedStyle(grid).flex, transform: getComputedStyle(grid).transform, display: getComputedStyle(grid).display },
        edgeTiles: [grid.querySelector('.hex-key'), grid.querySelectorAll('.hex-key')[29]].filter(Boolean).map(element => ({ name: element.getAttribute('aria-label'), left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width, slotLeft: element.parentElement.style.left })),
      };
    }));
    console.error('Roster geometry after two frames:', await page.evaluate(async () => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const field = document.querySelector('#hex-field');
      const grid = document.querySelector('#hex-grid');
      return { clientWidth: field.clientWidth, scrollWidth: field.scrollWidth, gridWidth: grid.getBoundingClientRect().width, gridLeft: grid.getBoundingClientRect().left };
    }));
  }
  assert.deepEqual(overflow, { document: false, field: false, grid: false, clippedColumn: false, scrollLeft: 0 }, 'Every roster column must fit without horizontal scrolling or clipping.');
}

async function assertSinglePlayer(page) {
  assert.equal(await page.locator('#player-2, [data-player="1"], dialog, .match-vs').count(), 0, 'Only Player 1 should appear; there must be no opponent or matchup dialog.');
  assert.doesNotMatch(await page.locator('body').innerText(), /\b(?:PLAYER TWO|PLAYER 2|LOCAL VERSUS|MATCHUP)\b/i);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, reducedMotion: 'reduce' });
  await installSpeechProbe(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const artifactDir = path.resolve('artifacts');
  await fs.mkdir(artifactDir, { recursive: true });
  try {
    const source = JSON.parse(await fs.readFile(path.resolve('data.json'), 'utf8'));
    const expectedRiders = source.flatMap(group => group.Characters.map(character => ({
      name: character.Name, series: group.Series, no: Number(group.No), subNo: Number(group['Sub No']), order: Number(character.Order),
    }))).sort((a, b) => a.no - b.no || a.subNo - b.subNo || a.order - b.order);
    const expectedNames = expectedRiders.map(character => character.name);
    const cyborgNames = expectedRiders.filter(character => character.series === 'Cyborg 009').map(character => character.name);
    await page.goto('http://127.0.0.1:2022');
    const ichigo = page.getByRole('button', { name: 'Ichigo, Main Kamen Rider', exact: true });
    await ichigo.waitFor();
    assert.deepEqual(await page.locator('.hex-name').allTextContents(), expectedNames);
    assert.equal(await page.locator('#previous-page, #next-page, #page-label').count(), 0, 'The continuous roster must not expose pagination controls.');
    await assertSinglePlayer(page);
    await assertNoHorizontalOverflow(page);
    await page.locator('#player-1 .fighter-image').evaluate(image => image.decode());
    await page.screenshot({ path: path.join(artifactDir, 'desktop.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'V3, Main Kamen Rider', exact: true }).click();
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), 'V3');
    assert.equal(await page.evaluate(() => window.spokenNames.at(-1)), 'V3');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'LOCKED IN');
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), 'V3');
    assert.equal(await page.locator(':focus').getAttribute('aria-label'), 'V3, Main Kamen Rider');
    await page.getByRole('button', { name: 'CHANGE RIDER', exact: true }).waitFor();
    await assertSinglePlayer(page);
    await page.screenshot({ path: path.join(artifactDir, 'confirmed.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'CHANGE RIDER', exact: true }).click();
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'SELECTING');
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), 'V3');
    await page.getByRole('button', { name: 'CONFIRM RIDER', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'SELECTING');
    await page.getByRole('button', { name: 'CONFIRM RIDER', exact: true }).click();
    await page.getByRole('button', { name: 'Nigo, Main Kamen Rider', exact: true }).click();
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'SELECTING');
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), 'Nigo');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), 'Ichigo');

    await page.getByRole('searchbox', { name: 'Search characters' }).fill('Skull');
    assert.equal(await page.locator('.hex-key').count(), 1);
    await page.getByRole('button', { name: 'Skull Man, Kamen Rider', exact: true }).click();
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), 'Skull Man');
    await page.getByRole('searchbox', { name: 'Search characters' }).fill('no such rider');
    await page.getByRole('heading', { name: 'NO RIDERS FOUND' }).waitFor();
    await page.getByRole('button', { name: 'Show all riders' }).click();
    await page.getByRole('combobox', { name: 'Filter by series' }).selectOption('Cyborg 009');
    assert.deepEqual(await page.locator('.hex-name').allTextContents(), cyborgNames);
    assert.equal(await page.locator('.hex-slot').evaluateAll(elements => new Set(elements.map(element => element.offsetLeft)).size), Math.min(30, cyborgNames.length), 'A filtered roster should use exactly its occupied columns, up to 30.');
    await page.getByRole('button', { name: 'RANDOM', exact: true }).click();
    assert.ok(cyborgNames.includes(await page.locator('#player-1 .fighter-name').textContent()));
    await page.getByRole('button', { name: 'Mute voice and sound' }).click();
    const mutedAt = await page.evaluate(() => spokenNames.length);
    await page.getByRole('button', { name: '002, Cyborg 009', exact: true }).click();
    assert.equal(await page.evaluate(() => spokenNames.length), mutedAt);
    await page.getByRole('button', { name: 'Enable voice and sound' }).click();
    assert.equal(await page.evaluate(() => spokenNames.at(-1)), '002');
    console.log('PASS: sorted roster, click/speech, keyboard, Player 1 confirm/change/Escape, search, series, random, and mute; no opponent or matchup.');

    const fixtures = [
      { No: '10', 'Sub No': 0, Series: 'Later era', Characters: Array.from({ length: 325 }, (_, i) => ({ Name: `Later ${String(324 - i).padStart(3, '0')}`, Image: 'ichigo.png', Order: String(324 - i) })) },
      { No: '2', 'Sub No': 1, Series: 'Earlier era', Characters: Array.from({ length: 325 }, (_, i) => ({ Name: `Earlier ${String(324 - i).padStart(3, '0')}`, Image: 'ichigo.png', Order: String(324 - i) })) },
    ];
    await page.route('**/data.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixtures) }));
    await page.reload();
    await page.getByRole('button', { name: 'Earlier 000, Earlier era', exact: true }).waitFor();
    const earlierNames = Array.from({ length: 325 }, (_, i) => `Earlier ${String(i).padStart(3, '0')}`);
    const laterNames = Array.from({ length: 325 }, (_, i) => `Later ${String(i).padStart(3, '0')}`);
    assert.deepEqual(await page.locator('.hex-name').allTextContents(), [...earlierNames, ...laterNames]);
    assert.equal(await page.locator('.hex-key').count(), 650);
    assert.equal(await page.locator('#previous-page, #next-page, #page-label').count(), 0);
    assert.ok(await page.locator('#hex-field').evaluate(element => element.scrollHeight > element.clientHeight), 'A large roster must be scrollable.');
    const positions = await page.locator('.hex-slot').evaluateAll(elements => elements.map(element => ({ x: element.offsetLeft, y: element.offsetTop, width: element.getBoundingClientRect().width })));
    assert.equal(new Set(positions.map(position => position.x)).size, 30, 'The complete roster must have exactly 30 columns.');
    assert.equal(new Set(positions.slice(0, 30).map(position => position.x)).size, 30, 'The first 30 riders must occupy distinct columns.');
    assert.equal(positions[0].x, positions[30].x, 'Rider 31 must begin beneath rider 1.');
    assert.ok(positions[30].y > positions[0].y);
    assert.ok(Math.abs((positions[30].y - positions[0].y) - (positions[60].y - positions[30].y)) <= 1, 'Rows must advance by a consistent vertical stride, allowing pixel rounding.');
    assert.ok(positions.every(position => position.width > 0), 'All rider hexagons must have a visible width.');
    await assertNoHorizontalOverflow(page);
    await assertSinglePlayer(page);
    await assertRosterAtOrigin(page, 'A new roster should start at its accessible top-left corner.');
    assert.ok(await page.locator('.hex-key').first().evaluate(element => element.getBoundingClientRect().left >= document.querySelector('#hex-field').getBoundingClientRect().left - 1), 'The first column must not be clipped beyond the left scroll limit.');
    const continuousGrid = await page.locator('#hex-grid').elementHandle();
    const firstTile = await page.locator('.hex-key').first().elementHandle();

    await page.getByRole('button', { name: 'Earlier 029, Earlier era', exact: true }).click();
    await assertFocusedRiderVisible(page);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator(':focus .hex-name').textContent(), 'Earlier 030', 'ArrowRight must wrap from column 30 to the next row.');
    await assertFocusedRiderVisible(page);
    assert.equal(await page.locator('.hex-key').count(), 650);
    assert.ok(await firstTile.evaluate(element => element.isConnected), 'Crossing a row boundary must preserve the continuous grid.');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus .hex-name').textContent(), 'Earlier 030', 'ArrowDown must advance exactly 30 riders.');
    await assertFocusedRiderVisible(page);

    await page.keyboard.press('End');
    assert.equal(await page.locator(':focus .hex-name').textContent(), 'Later 324');
    await assertFocusedRiderVisible(page);
    assert.ok(await page.locator('#hex-field').evaluate(element => element.scrollTop > 0));
    await page.keyboard.press('Home');
    assert.equal(await page.locator(':focus .hex-name').textContent(), 'Earlier 000');
    await assertFocusedRiderVisible(page);
    const beforePageDown = await page.locator(':focus').evaluate(element => ({ top: element.parentElement.offsetTop, viewportHeight: document.querySelector('#hex-field').clientHeight }));
    await page.keyboard.press('PageDown');
    const pageDownDistance = await page.locator(':focus').evaluate(element => element.parentElement.offsetTop) - beforePageDown.top;
    assert.ok(pageDownDistance >= beforePageDown.viewportHeight * 0.5 && pageDownDistance <= beforePageDown.viewportHeight * 1.5, 'PageDown should move approximately one roster viewport within the same grid.');
    await assertFocusedRiderVisible(page);
    await page.keyboard.press('PageUp');
    assert.equal(await page.locator(':focus .hex-name').textContent(), 'Earlier 000');
    await assertFocusedRiderVisible(page);
    assert.ok(await continuousGrid.evaluate(element => element === document.querySelector('#hex-grid')));
    assert.ok(await firstTile.evaluate(element => element.isConnected));

    await page.getByRole('button', { name: 'Earlier 000, Earlier era', exact: true }).click();
    const scrollStepCount = await page.locator('#hex-field').evaluate(element => {
      const slots = document.querySelectorAll('.hex-slot');
      const rowHeight = slots[30].getBoundingClientRect().top - slots[0].getBoundingClientRect().top;
      return Math.ceil(element.clientHeight / rowHeight) + 1;
    });
    for (let i = 0; i < scrollStepCount; i++) await page.keyboard.press('ArrowDown');
    assert.ok(await page.locator('#hex-field').evaluate(element => element.scrollTop > 0));
    await assertFocusedRiderVisible(page);
    await page.screenshot({ path: path.join(artifactDir, 'large-roster.png'), fullPage: true });
    await page.keyboard.press('End');
    await page.getByRole('searchbox', { name: 'Search characters' }).fill('Later 324');
    assert.equal(await page.locator('.hex-key').count(), 1);
    await assertRosterAtOrigin(page, 'A search should return both roster scroll positions to the origin.');
    await page.getByRole('button', { name: 'Later 324, Later era', exact: true }).click();
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), 'Later 324');
    await page.getByRole('searchbox', { name: 'Search characters' }).fill('');
    assert.equal(await page.locator('.hex-key').count(), 650);
    await assertRosterAtOrigin(page, 'Clearing search should reset both axes of roster scrolling.');
    await page.getByRole('combobox', { name: 'Filter by series' }).selectOption('Later era');
    assert.equal(await page.locator('.hex-key').count(), 325);
    assert.deepEqual(await page.locator('.hex-name').allTextContents(), laterNames);
    await assertRosterAtOrigin(page, 'Changing series should reset both axes of roster scrolling.');
    await page.getByRole('button', { name: 'Later 000, Later era', exact: true }).click();
    await page.keyboard.press('End');
    assert.equal(await page.locator(':focus .hex-name').textContent(), 'Later 324');
    await assertFocusedRiderVisible(page);
    await page.getByRole('button', { name: 'RANDOM', exact: true }).click();
    assert.ok(laterNames.includes(await page.locator(':focus .hex-name').textContent()));
    assert.notEqual(await page.locator(':focus .hex-name').textContent(), 'Later 324');
    await assertFocusedRiderVisible(page);
    assert.equal(await page.locator('.hex-key').count(), 325);
    await page.getByRole('combobox', { name: 'Filter by series' }).selectOption('all');
    assert.equal(await page.locator('.hex-key').count(), 650);
    await assertRosterAtOrigin(page, 'Clearing the series filter should reset both axes of roster scrolling.');
    console.log('PASS: all 650 sorted riders fit 30 columns without horizontal overflow; row wrapping, 30-rider vertical navigation, Home/End, PageUp/PageDown, filtering, scroll resets, and visible selection.');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await page.getByRole('button', { name: 'Earlier 000, Earlier era', exact: true }).waitFor();
    assert.equal(await page.locator('.hex-key').count(), 650);
    assert.equal(await page.locator('.hex-slot').evaluateAll(elements => new Set(elements.map(element => element.offsetLeft)).size), 30);
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Earlier 000, Earlier era', exact: true }).click();
    await page.keyboard.press('End');
    assert.equal(await page.locator(':focus .hex-name').textContent(), 'Later 324');
    await assertFocusedRiderVisible(page);
    await page.keyboard.press('Home');
    assert.equal(await page.locator(':focus .hex-name').textContent(), 'Earlier 000');
    await assertFocusedRiderVisible(page);
    await page.getByRole('button', { name: 'RANDOM', exact: true }).click();
    await assertFocusedRiderVisible(page);
    await page.screenshot({ path: path.join(artifactDir, 'large-roster-mobile.png'), fullPage: true });
    console.log('PASS: all 650 riders also fit 30 columns on mobile, with vertical-only Home/End and random navigation.');

    await page.unroute('**/data.json');
    await page.reload();
    await ichigo.waitFor();
    await assertNoHorizontalOverflow(page);
    await assertSinglePlayer(page);
    assert.equal(await page.locator('.hex-slot').evaluateAll(elements => new Set(elements.map(element => element.offsetLeft)).size), Math.min(30, expectedNames.length));
    await page.screenshot({ path: path.join(artifactDir, 'mobile.png'), fullPage: true });
    await ichigo.click();
    await page.keyboard.press('End');
    assert.equal(await page.locator(':focus .hex-name').textContent(), expectedNames.at(-1));
    await assertFocusedRiderVisible(page);
    await page.keyboard.press('Home');
    assert.equal(await page.locator(':focus .hex-name').textContent(), expectedNames[0]);
    await assertFocusedRiderVisible(page);
    await page.getByRole('button', { name: '003, Cyborg 009', exact: true }).click();
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), '003');
    await page.getByRole('button', { name: 'CONFIRM RIDER', exact: true }).click();
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'LOCKED IN');
    await page.getByRole('button', { name: 'CHANGE RIDER', exact: true }).click();
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'SELECTING');
    await page.getByRole('button', { name: '002, Cyborg 009', exact: true }).click();
    await page.getByRole('button', { name: 'CONFIRM RIDER', exact: true }).click();
    assert.equal(await page.locator('#player-1 .fighter-name').textContent(), '002');
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'LOCKED IN');
    await assertSinglePlayer(page);
    await assertNoHorizontalOverflow(page);
    console.log('PASS: the mobile roster fits all columns and Player 1 can confirm and change riders on the same page.');

    await page.route('**/data.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ No: 0, 'Sub No': 0, Series: 'Missing artwork', Characters: [{ Name: 'Unknown Rider', Image: 'does-not-exist.png', Order: 1 }] }]) }));
    await page.reload();
    await page.getByRole('button', { name: 'Unknown Rider, Missing artwork', exact: true }).waitFor();
    await page.locator('#player-1 .image-unavailable').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.hex-fallback').textContent(), 'UN');
    await page.getByRole('button', { name: 'CONFIRM RIDER', exact: true }).click();
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'LOCKED IN');
    await page.getByRole('button', { name: 'CHANGE RIDER', exact: true }).click();
    assert.equal(await page.locator('#player-1 .player-state').textContent(), 'SELECTING');
    await assertSinglePlayer(page);
    await assertNoHorizontalOverflow(page);
    assert.deepEqual(errors, []);
    console.log('PASS: missing-artwork fallback, single-character confirm/change, and no JavaScript errors.');
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

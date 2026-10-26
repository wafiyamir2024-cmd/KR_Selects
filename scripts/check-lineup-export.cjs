const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

function markerColor(index) {
  return [32 + (index % 26) * 8, 48 + Math.floor(index / 26) * 7, 180];
}

function markerSvg(index) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="285" viewBox="0 0 100 285"><path fill="#bfc7d1" d="M48 65h4v220h-4z"/><path fill="rgb(${markerColor(index).join(',')})" d="M10 0h80v70H10z"/></svg>`;
}

function fixtureCharacter(index, order = index, extra = {}) {
  return { Name: `Export ${String(index).padStart(3, '0')}`, Order: String(order), Image: `export-test-${index}.svg`, ...extra };
}

function makeLargeFixture() {
  const characters = (first, count) => Array.from({ length: count }, (_, index) => fixtureCharacter(first + index, index)).reverse();
  return [
    { No: '10', 'Sub No': '0', Series: 'Late era', Characters: characters(447, 203) },
    { No: '2', 'Sub No': '2', Series: 'Middle era', Characters: characters(245, 202) },
    { No: '0', 'Sub No': '0', Series: 'Foundation era', Characters: characters(0, 44) },
    { No: '2', 'Sub No': '1', Series: 'Early era', Characters: characters(44, 201) },
  ];
}

function makeSizeFixture() {
  return [{ No: '0', 'Sub No': '0', Series: 'Size era', Characters: [fixtureCharacter(2, 2), fixtureCharacter(1, 1, { Size: 3 }), fixtureCharacter(0, 0)] }];
}

function makeMissingFixture() {
  return [{ No: 0, 'Sub No': 0, Series: 'Missing era', Characters: [fixtureCharacter(0, 0), fixtureCharacter(1, 1, { Name: 'Missing Rider', Image: 'export-test-missing.svg' })] }];
}

async function inspectPng(buffer, markerCount) {
  assert.deepEqual(buffer.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'The saved file must contain real PNG bytes.');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert.ok(width > 0 && width <= 3840 && height > 0 && height <= 8192, `Unexpected PNG dimensions: ${width}x${height}.`);
  assert.ok(width * height <= 16000000, 'Large exports must remain within the 16-megapixel budget.');
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width);
  assert.equal(info.height, height);
  const markers = Array.from({ length: markerCount }, () => ({ count: 0, sumX: 0, sumY: 0, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }));
  const colorIndexes = new Map(Array.from({ length: markerCount }, (_, index) => {
    const [red, green, blue] = markerColor(index);
    return [(red << 16) | (green << 8) | blue, index];
  }));
  let fallbackPixels = 0;
  for (let pixel = 0, offset = 0; offset < data.length; pixel++, offset += 4) {
    const color = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2];
    if (color === 0x8193a4 && data[offset + 3] === 255) fallbackPixels++;
    const index = colorIndexes.get(color);
    if (index === undefined || data[offset + 3] !== 255) continue;
    const marker = markers[index];
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    marker.count++;
    marker.sumX += x;
    marker.sumY += y;
    marker.minX = Math.min(marker.minX, x);
    marker.maxX = Math.max(marker.maxX, x);
    marker.minY = Math.min(marker.minY, y);
    marker.maxY = Math.max(marker.maxY, y);
  }
  for (const [index, marker] of markers.entries()) {
    assert.ok(marker.count >= 4, `Rider ${index} is missing from the exported artwork.`);
    marker.x = marker.sumX / marker.count;
    marker.y = marker.sumY / marker.count;
    marker.width = marker.maxX - marker.minX + 1;
    marker.height = marker.maxY - marker.minY + 1;
    assert.ok(marker.minX > 0 && marker.maxX < width - 1 && marker.minY > 0 && marker.maxY < height - 1, `Rider ${index} must not be clipped by a PNG edge.`);
  }
  assert.ok(data[0] < 50 && data[1] < 50 && data[2] < 50 && data[3] === 255, 'The PNG must have an opaque dark background.');
  return { width, height, markers, fallbackPixels };
}

function assertLargeOrdering(result) {
  const { markers } = result;
  assert.equal(markers.length, 650);
  const rows = [markers.slice(0, 44)];
  for (let index = 44; index < 650; index += 40) rows.push(markers.slice(index, index + 40));
  assert.equal(rows.length, 17);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    for (let column = 1; column < row.length; column++) {
      assert.ok(row[column].x > row[column - 1].x, 'PNG riders must retain ascending left-to-right order.');
      assert.ok(Math.abs(row[column].y - row[0].y) < 2, 'Riders in the same row must share their baseline.');
    }
    if (index > 0) assert.ok(row[0].y < rows[index - 1][0].y, 'PNG rows must stack upward from the foundation.');
  }
  assert.ok(markers[0].y > result.height * 0.75, 'The foundation must be near the bottom of the complete PNG.');
  assert.ok(markers[649].y < result.height * 0.25, 'The topmost offscreen row must appear near the top of the complete PNG.');
}

function assertTripleSize(result) {
  const [normal, giant] = result.markers;
  for (const dimension of ['width', 'height']) assert.ok(Math.abs(giant[dimension] / normal[dimension] - 3) < 0.08, `Size3 must produce a 3x ${dimension} in the exported image.`);
}

async function downloadPng(page, filename) {
  await page.locator('#lineup-download').evaluate(button => {
    window.exportDisabledChanges = [];
    window.exportButtonObserver?.disconnect();
    window.exportButtonObserver = new MutationObserver(records => window.exportDisabledChanges.push(...records.map(record => record.oldValue)));
    window.exportButtonObserver.observe(button, { attributes: true, attributeOldValue: true, attributeFilter: ['disabled'] });
  });
  const pending = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('#lineup-download').click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /^kr-arena-lineup-\d{4}-\d{2}-\d{2}\.png$/);
  assert.equal(await download.failure(), null);
  const target = path.resolve('artifacts', filename);
  await download.saveAs(target);
  await page.waitForFunction(() => !document.querySelector('#lineup-download').disabled);
  assert.ok(await page.evaluate(() => window.exportDisabledChanges.includes(null)), 'The download button must be disabled while its export is busy.');
  return fs.readFile(target);
}

async function uiState(page) {
  return page.evaluate(() => ({
    scrollTop: document.querySelector('#lineup-scroll').scrollTop,
    scrollLeft: document.querySelector('#lineup-scroll').scrollLeft,
    name: document.querySelector('#player-1 .fighter-name').textContent,
    lock: document.querySelector('#player-1 .player-state').textContent,
    search: document.querySelector('#roster-search').value,
    inspector: document.querySelector('#lineup-hover-name').textContent,
    hash: location.hash,
    rowIds: [...document.querySelectorAll('.lineup-character')].map(button => button.dataset.id),
  }));
}

async function browserChecks() {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, reducedMotion: 'reduce', acceptDownloads: true });
  await context.addInitScript(() => localStorage.setItem('kr-arena-sound', 'off'));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let source = makeLargeFixture();
  await context.route('**/data.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(source) }));
  await context.route('**/images/export-test-*.svg', route => {
    const match = new URL(route.request().url()).pathname.match(/export-test-(\d+)\.svg$/);
    return match ? route.fulfill({ contentType: 'image/svg+xml', body: markerSvg(Number(match[1])) }) : route.fulfill({ status: 404, body: 'Missing fixture artwork' });
  });
  await fs.mkdir(path.resolve('artifacts'), { recursive: true });
  try {
    await page.goto('http://127.0.0.1:2022');
    await page.getByRole('searchbox', { name: 'Search characters' }).fill('Export 010');
    await page.locator('.hex-key').first().click();
    await page.locator('#confirm-selection').click();
    await page.locator('#lineup-tab').click();
    await page.locator('.lineup-character').first().waitFor();
    assert.equal(await page.locator('.lineup-character').count(), 650);
    assert.ok(await page.locator('#lineup-scroll').evaluate(element => element.scrollHeight > element.clientHeight), 'The fixture must contain offscreen rows.');
    await page.locator('#lineup-scroll').evaluate(element => { element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) / 2); });
    const before = await uiState(page);
    const large = await inspectPng(await downloadPng(page, 'lineup-export-650.png'), 650);
    assertLargeOrdering(large);
    assert.deepEqual(await uiState(page), before, 'Exporting must preserve selection, lock, search, view, lineup rows, and scroll position.');
    console.log(`PASS: genuine ${large.width}x${large.height} PNG download includes all 650 colored riders in the correct rows; busy state and UI state are preserved.`);

    source = makeSizeFixture();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#lineup-count').textContent === '03' && !document.querySelector('#lineup-download').disabled);
    const scaled = await inspectPng(await downloadPng(page, 'lineup-export-size.png'), 3);
    assertTripleSize(scaled);
    console.log('PASS: Size3 is preserved in the PNG with no cropped marker edges.');

    source = makeMissingFixture();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#lineup-count').textContent === '02' && !document.querySelector('#lineup-download').disabled);
    const missing = await inspectPng(await downloadPng(page, 'lineup-export-missing.png'), 1);
    assert.ok(missing.fallbackPixels > 10, 'Missing artwork must draw a visible initials placeholder.');
    assert.match(await page.locator('#lineup-download-status').textContent(), /(?:1.*(?:missing|unavailable)|(?:missing|unavailable).*1)/i);
    console.log('PASS: unavailable artwork still produces a PNG and is reported in export status.');

    source = [];
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#lineup-empty h3').textContent === 'YOUR LINEUP STARTS HERE');
    assert.equal(await page.locator('#lineup-download').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: the download button is disabled for an empty lineup; no JavaScript errors.');
  } finally {
    await context.close();
    await browser.close();
  }
}

module.exports = { markerSvg, makeLargeFixture, makeSizeFixture, makeMissingFixture, inspectPng, assertLargeOrdering, assertTripleSize };
if (require.main === module) browserChecks().catch(error => { console.error(error); process.exitCode = 1; });

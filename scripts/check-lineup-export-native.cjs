const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createCanvas, Image } = require('@napi-rs/canvas');
const sharp = require('sharp');
const { markerSvg, makeLargeFixture, makeSizeFixture, makeMissingFixture, inspectPng, assertLargeOrdering, assertTripleSize } = require('./check-lineup-export.cjs');

// These adapters use the real native image decoder, Skia canvas, and PNG encoder.
// They replace browser resource loading only; no drawing or PNG output is mocked.
function FixtureImage() {
  const image = new Image();
  // Native callbacks require an undefined return value, unlike DOM callbacks.
  // Let the renderer's async handler finish normally without returning its Promise.
  let loaded;
  Object.defineProperty(image, 'onload', { get() { return loaded; }, set(callback) {
    loaded = typeof callback === 'function' ? (...args) => { callback(...args); } : callback;
  } });
  const source = Object.getOwnPropertyDescriptor(Image.prototype, 'src');
  Object.defineProperty(image, 'src', { get() { return source.get.call(image); }, set(value) {
    const match = String(value).match(/^\/images\/export-test-(\d+)\.svg$/);
    if (match) source.set.call(image, Buffer.from(markerSvg(Number(match[1]))));
    else if (String(value).startsWith('/images/')) {
      const root = path.resolve('images');
      const target = path.resolve(root, decodeURIComponent(String(value).slice('/images/'.length)));
      if (!target.startsWith(root + path.sep)) throw new Error('Image path is outside the workspace image folder.');
      // Skia rejects some original PNG encodings that libvips and browsers accept.
      // Decode and losslessly re-encode in memory; preserve all source pixels and files.
      fs.readFile(target).then(buffer => sharp(buffer).png({ compressionLevel: 0 }).toBuffer())
        .then(buffer => source.set.call(image, buffer), error => image.onerror?.(error));
    } else queueMicrotask(() => image.onerror?.(new Error('Fixture artwork is missing.')));
  } });
  image.removeAttribute = name => {
    if (name === 'src') source.set.call(image, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'));
  };
  return image;
}

(async () => {
  const { normalizeRoster } = await import(pathToFileURL(path.resolve('roster.js')).href);
  const { buildLineupRows } = await import(pathToFileURL(path.resolve('lineup-model.js')).href);
  const { createLineupPng } = await import(pathToFileURL(path.resolve('lineup-export.js')).href);
  const originalDocument = globalThis.document;
  const originalImage = globalThis.Image;
  globalThis.document = { createElement(tag) {
    assert.equal(tag, 'canvas', 'The standalone renderer should need only a detached canvas.');
    return createCanvas(300, 150);
  } };
  globalThis.Image = FixtureImage;
  await fs.mkdir(path.resolve('artifacts'), { recursive: true });
  const render = async (source, filename, markerCount) => {
    const rows = buildLineupRows(normalizeRoster(source));
    const snapshot = JSON.stringify(rows);
    const progress = [];
    const result = await createLineupPng(rows, { onProgress: value => progress.push(value) });
    assert.equal(JSON.stringify(rows), snapshot, 'Export must not mutate the roster or row data.');
    assert.equal(result.blob.type, 'image/png');
    const buffer = Buffer.from(await result.blob.arrayBuffer());
    await fs.writeFile(path.resolve('artifacts', filename), buffer);
    const png = await inspectPng(buffer, markerCount);
    assert.equal(png.width, result.width);
    assert.equal(png.height, result.height);
    const count = rows.reduce((total, row) => total + row.characters.length, 0);
    assert.deepEqual(progress[0], { completed: 0, total: count });
    assert.deepEqual(progress.at(-1), { completed: count, total: count });
    assert.ok(progress.every((value, index) => value.total === count && value.completed >= 0 && value.completed <= count && (index === 0 || value.completed >= progress[index - 1].completed)));
    return { ...png, missingCount: result.missingCount };
  };
  try {
    const large = await render(makeLargeFixture(), 'lineup-export-native-650.png', 650);
    assert.equal(large.missingCount, 0);
    assert.equal(large.width, 3840);
    assertLargeOrdering(large);
    console.log(`PASS: native PNG ${large.width}x${large.height} contains all 650 distinct head markers, including every offscreen row and the 44-rider bottom foundation, in numeric order.`);

    const scaled = await render(makeSizeFixture(), 'lineup-export-native-size.png', 3);
    assert.equal(scaled.missingCount, 0);
    assertTripleSize(scaled);
    console.log('PASS: Size3 triples actual exported marker width and height; all marker edges fit inside the PNG.');

    const missing = await render(makeMissingFixture(), 'lineup-export-native-missing.png', 1);
    assert.equal(missing.missingCount, 1);
    assert.ok(missing.fallbackPixels > 10, 'A failed image must leave a visible initials placeholder.');
    console.log('PASS: one missing image is counted, draws visible fallback initials, and does not prevent a valid PNG.');

    const huge = [{ No: 1, 'Sub No': 0, Series: 'Large future roster', Characters: Array.from({ length: 2000 }, (_, index) => ({ Name: `Future ${index}`, Order: index, Image: 'export-test-0.svg' })) }];
    const bounded = await render(huge, 'lineup-export-native-2000.png', 1);
    assert.equal(bounded.missingCount, 0);
    assert.ok(bounded.width < 3840, 'The 2000-rider poster must shrink to its pixel budget.');
    await assert.rejects(createLineupPng([]), /at least one rider/i);
    console.log(`PASS: 2000-rider PNG is bounded to ${bounded.width}x${bounded.height}; progress reaches completion, source rows stay unchanged, and empty exports reject clearly.`);

    const current = JSON.parse(await fs.readFile(path.resolve('data.json'), 'utf8'));
    const currentPng = await render(current, 'lineup-export-current.png', 0);
    console.log(`Current-data PNG: ${currentPng.width}x${currentPng.height}, ${currentPng.missingCount} missing artwork; artifacts/lineup-export-current.png.`);
    console.log('Native renderer checks only: browser download, disabled-button state, status text, and visible UI preservation are not verified by this script.');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

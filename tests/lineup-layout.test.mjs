import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLineupLayout } from '../lineup-layout.js';
import { buildLineupRows } from '../lineup-model.js';
import { normalizeRoster } from '../roster.js';

test('matches the existing screen geometry for a complete 40-rider row', () => {
  const rows = makeRows(0, 40);
  const layout = calculateLineupLayout(rows, 412);
  close(layout.width, 412);
  close(layout.cellWidth, 10);
  close(layout.bodyHeight, 28.5);
  close(layout.rowStep, 12.825);
  close(layout.topInset, 10.85);
  close(layout.height, 51.35);
  const [row] = layout.rows;
  close(row.left, 6);
  close(row.top, 10.85);
  close(row.width, 400);
  const first = row.characters[0];
  close(first.centerX, 11);
  close(first.baselineY, 39.35);
  close(first.headBand, 28.5);
  close(first.imageBox.x, 1);
  close(first.imageBox.y, 10.85);
  close(first.imageBox.width, 20);
  close(first.imageBox.height, 28.5);
  assert.equal(first.character, rows[0].characters[0]);
});

test('lays out all 650 records and every row beyond viewport height without changing inputs', () => {
  const rows = makeRows(50, 600);
  for (const row of rows) {
    row.characters.forEach(Object.freeze);
    Object.freeze(row.characters);
    Object.freeze(row);
  }
  Object.freeze(rows);
  const layout = calculateLineupLayout(rows, 2400);
  const allCharacters = layout.rows.flatMap((row) => row.characters);
  assert.equal(layout.rows.length, 16);
  assert.equal(allCharacters.length, 650);
  assert.equal(new Set(allCharacters.map(({ character }) => character.id)).size, 650);
  assert.ok(layout.height > 780, 'The full canvas must include rows beyond the screen scroll viewport.');
  layout.rows.forEach((row, index) => {
    assert.equal(row.index, rows[index].index);
    row.characters.forEach((placed, column) => {
      assert.equal(placed.character, rows[index].characters[column]);
      assert.equal(placed.column, column);
      close(placed.baselineY, row.top + layout.bodyHeight);
      close(placed.imageBox.y + placed.imageBox.height, placed.baselineY);
      if (column) assert.ok(placed.centerX > row.characters[column - 1].centerX);
    });
    if (index) close(layout.rows[index - 1].top - row.top, layout.rowStep);
  });
  close(layout.rows[0].characters[0].baselineY, layout.height - 12);
  close(layout.rows.at(-1).top, layout.topInset);
  assertFits(layout);
});

test('fits Size 3 artwork at the top and both edges including hover growth', () => {
  const roster = normalizeRoster([
    { No: 0, 'Sub No': 0, Series: 'Foundation', Characters: characters(44) },
    { No: 1, 'Sub No': 0, Series: 'Others', Characters: characters(80).map((character, index) => ({
      ...character,
      Size: index === 40 || index === 79 ? 3 : 1,
    })) },
  ]);
  const rows = buildLineupRows(roster);
  for (const width of [320, 1920]) {
    const layout = calculateLineupLayout(rows, width);
    const topRow = layout.rows.at(-1);
    const left = topRow.characters[0];
    const right = topRow.characters.at(-1);
    assert.equal(left.size, 3);
    assert.equal(right.size, 3);
    close(left.imageBox.height, 3 * layout.bodyHeight);
    close(left.imageBox.width, 6 * layout.cellWidth);
    close(left.centerX + right.centerX, width);
    close(left.baselineY, topRow.top + layout.bodyHeight);
    close(left.headBand, layout.bodyHeight * (1 - .55 / 3));
    assert.ok(left.headBand > topRow.characters[1].headBand);
    assertFits(layout);
  }
});

test('uses an unlimited foundation row to set the scale and centers shorter rows', () => {
  const layout = calculateLineupLayout(makeRows(87, 83), 1200);
  assert.deepEqual(layout.rows.map((row) => row.characters.length), [87, 40, 40, 3]);
  close(layout.cellWidth, 1200 / 88.2);
  for (const row of layout.rows) {
    close(row.left + row.width / 2, 600);
    assert.ok(row.width < layout.width);
  }
  assert.ok(layout.rows[0].width > layout.rows[1].width);
  close(layout.rows[0].characters[0].headBand, layout.bodyHeight);
  close(layout.rows[1].characters[0].headBand, layout.rowStep);
  assertFits(layout);
});

test('honors normalized numeric strings and default sizes while keeping foot baselines fixed', () => {
  const rows = buildLineupRows(normalizeRoster([{
    No: '0', 'Sub No': '0', Series: 'Foundation', Characters: [
      { Name: 'Large', Order: '3', Size: '3' },
      { Name: 'Small', Order: '1', Size: '0.75' },
      { Name: 'Normal', Order: '2', Size: 'invalid' },
      { Name: 'Zero', Order: '4', Size: 0 },
    ],
  }]));
  const layout = calculateLineupLayout(rows, 1200);
  const placed = layout.rows[0].characters;
  assert.deepEqual(placed.map(({ character }) => character.name), ['Small', 'Normal', 'Large', 'Zero']);
  assert.deepEqual(placed.map(({ size }) => size), [.75, 1, 3, 1]);
  for (const item of placed) {
    close(item.imageBox.width, 2 * layout.cellWidth * item.size);
    close(item.imageBox.height, layout.bodyHeight * item.size);
    close(item.imageBox.y + item.imageBox.height, placed[0].baselineY);
  }
  assertFits(layout);
});

test('supports an explicit hover allowance without scaling the exported image boxes', () => {
  const rows = makeRows(0, 40);
  const still = calculateLineupLayout(rows, 412, { hoverScale: 1 });
  const interactive = calculateLineupLayout(rows, 412);
  close(still.cellWidth, 412 / 41);
  assert.ok(still.cellWidth > interactive.cellWidth);
  close(still.rows[0].characters[0].imageBox.height, still.bodyHeight);
  close(interactive.rows[0].characters[0].imageBox.height, interactive.bodyHeight);
  assertFits(still, 1);
  assertFits(interactive);
});

test('returns zero-height geometry for empty data and clamps unusable widths', () => {
  assert.deepEqual(calculateLineupLayout([], 1000), {
    width: 1000, height: 0, cellWidth: 0, bodyHeight: 0, rowStep: 0, topInset: 0, rows: [],
  });
  const rows = makeRows(0, 1);
  for (const width of [0, -10, NaN, Infinity]) {
    const layout = calculateLineupLayout(rows, width);
    assert.equal(layout.width, 1);
    assert.ok(Number.isFinite(layout.height));
    assertFits(layout);
  }
});

function assertFits(layout, hoverScale = 1.1) {
  for (const row of layout.rows) {
    for (const placed of row.characters) {
      const hoveredWidth = placed.imageBox.width * hoverScale;
      const hoveredHeight = placed.imageBox.height * hoverScale;
      assert.ok(placed.centerX - hoveredWidth / 2 >= -1e-9, `${placed.character.name} exceeds the left edge.`);
      assert.ok(placed.centerX + hoveredWidth / 2 <= layout.width + 1e-9, `${placed.character.name} exceeds the right edge.`);
      assert.ok(placed.baselineY - hoveredHeight >= 8 - 1e-9, `${placed.character.name} exceeds the top allowance.`);
      assert.ok(placed.baselineY <= layout.height - 12 + 1e-9, `${placed.character.name} exceeds the bottom allowance.`);
    }
  }
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${actual} to match ${expected}.`);
}

function makeRows(foundationCount, otherCount) {
  return buildLineupRows(normalizeRoster([
    { No: 0, 'Sub No': 0, Series: 'Foundation', Characters: characters(foundationCount) },
    { No: 1, 'Sub No': 0, Series: 'Others', Characters: characters(otherCount) },
  ]));
}

function characters(count) {
  return Array.from({ length: count }, (_, index) => ({
    Name: `Rider ${index + 1}`, Image: 'rider.png', Order: index + 1, Size: 1,
  }));
}

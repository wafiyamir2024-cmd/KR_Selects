import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLineupRows } from '../lineup-model.js';
import { normalizeRoster } from '../roster.js';

test('places the foundation at the bottom and retains normalized numeric order across scrambled source groups', () => {
  const roster = normalizeRoster([
    { No: '10', 'Sub No': '0', Series: 'Ten', Characters: [{ Name: 'No ten', Order: '1' }] },
    { No: '0', 'Sub No': '0', Series: 'Foundation B', Characters: [{ Name: 'Foundation second', Order: '2' }] },
    { No: '2', 'Sub No': '10', Series: 'Two ten', Characters: [{ Name: 'Sub ten', Order: '1' }] },
    { No: '0', 'Sub No': '1', Series: 'Zero one', Characters: [{ Name: 'Above foundation', Order: '1' }] },
    { No: 0, 'Sub No': 0, Series: 'Foundation A', Characters: [{ Name: 'Foundation first', Order: 1 }] },
    { No: '2', 'Sub No': '2', Series: 'Two two', Characters: [
      { Name: 'Order ten', Order: '10' },
      { Name: 'Order two', Order: '2' },
    ] },
  ]);
  const rows = buildLineupRows(roster);
  assert.deepEqual(rows.map(({ index, isFoundation }) => ({ index, isFoundation })), [
    { index: 0, isFoundation: true },
    { index: 1, isFoundation: false },
  ]);
  assert.deepEqual(rows[0].characters.map(({ name }) => name), ['Foundation first', 'Foundation second']);
  assert.deepEqual(rows[1].characters.map(({ name }) => name), [
    'Above foundation', 'Order two', 'Order ten', 'Sub ten', 'No ten',
  ]);
});

test('keeps more than 40 foundation characters together and caps every following row at 40', () => {
  const roster = normalizeRoster([
    { No: 0, 'Sub No': 0, Series: 'Foundation', Characters: makeCharacters(87) },
    { No: 1, 'Sub No': 0, Series: 'Others', Characters: makeCharacters(83) },
  ]);
  const rows = buildLineupRows(roster);
  assert.deepEqual(rows.map(({ characters }) => characters.length), [87, 40, 40, 3]);
  assert.deepEqual(rows.map(({ index }) => index), [0, 1, 2, 3]);
  assert.ok(rows[0].isFoundation);
  assert.ok(rows[0].characters.every(({ no, subNo }) => no === 0 && subNo === 0));
  assert.ok(rows.slice(1).every((row) => !row.isFoundation && row.characters.length <= 40));
  assert.deepEqual(rows.flatMap(({ characters }) => characters), roster);
});

test('preserves all 650 unique records in order without changing the source roster', () => {
  const roster = normalizeRoster(Array.from({ length: 13 }, (_, index) => ({
    No: 12 - index,
    'Sub No': 0,
    Series: `Series ${index}`,
    Characters: makeCharacters(50),
  })));
  roster.forEach(Object.freeze);
  Object.freeze(roster);
  const rows = buildLineupRows(roster);
  const characters = rows.flatMap((row) => row.characters);
  assert.equal(rows.length, 16);
  assert.equal(rows[0].characters.length, 50);
  assert.equal(characters.length, 650);
  assert.equal(new Set(characters.map(({ id }) => id)).size, 650);
  assert.deepEqual(characters, roster);
  characters.forEach((character, index) => assert.equal(character, roster[index]));
  assert.deepEqual(rows.map(({ index }) => index), Array.from({ length: 16 }, (_, index) => index));
  assert.ok(rows.slice(1).every((row) => row.characters.length === 40 && !row.isFoundation));
});

test('omits an empty foundation and starts normal rows at bottom index zero', () => {
  const roster = normalizeRoster([
    { No: 0, 'Sub No': 1, Series: 'Zero one', Characters: makeCharacters(1) },
    { No: 1, 'Sub No': 0, Series: 'One zero', Characters: makeCharacters(39) },
    { No: null, 'Sub No': null, Series: 'Unknown', Characters: makeCharacters(1) },
  ]);
  const rows = buildLineupRows(roster);
  assert.deepEqual(rows.map(({ index, isFoundation, characters }) => ({ index, isFoundation, count: characters.length })), [
    { index: 0, isFoundation: false, count: 40 },
    { index: 1, isFoundation: false, count: 1 },
  ]);
  assert.deepEqual(rows.flatMap(({ characters }) => characters), roster);
});

test('returns one foundation-only row without adding a normal row', () => {
  const roster = normalizeRoster([{ No: 0, 'Sub No': 0, Series: 'Foundation', Characters: makeCharacters(45) }]);
  const rows = buildLineupRows(roster);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { index: 0, isFoundation: true, characters: roster });
});

test('returns no rows for an empty roster', () => {
  assert.deepEqual(buildLineupRows([]), []);
});

function makeCharacters(count) {
  return Array.from({ length: count }, (_, index) => ({
    Name: `Rider ${count - index}`,
    Image: 'rider.png',
    Order: count - index,
  }));
}

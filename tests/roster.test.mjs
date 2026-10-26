import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRoster, getImageUrl, normalizeRoster } from '../roster.js';

test('sorts numerically by No, Sub No, then Order, preserving ties', () => {
  const roster = normalizeRoster([
    { No: '10', 'Sub No': '1', Series: 'Later', Characters: [{ Name: 'Ten', Order: 1 }] },
    { No: '2', 'Sub No': '10', Series: 'Second', Characters: [{ Name: 'Sub ten', Order: 1 }] },
    { No: 2, 'Sub No': '2', Series: 'First', Characters: [
      { Name: 'Order ten', Order: '10' },
      { Name: 'First tie', Order: '2' },
      { Name: 'Second tie', Order: 2 },
      { Name: 'Missing order' },
    ] },
    { No: 0, 'Sub No': 0, Series: 'Origin', Characters: [{ Name: 'Zero', Order: 0 }] },
    { Series: 'Unknown', Characters: [{ Name: 'Missing number', Order: 1 }] },
  ]);
  assert.deepEqual(roster.map(({ name }) => name), [
    'Zero', 'First tie', 'Second tie', 'Order ten', 'Missing order', 'Sub ten', 'Ten', 'Missing number',
  ]);
  assert.deepEqual(roster.map(({ rosterIndex }) => rosterIndex), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('keeps all 650 characters in one sorted, filterable roster with unique IDs', () => {
  const source = Array.from({ length: 13 }, (_, groupIndex) => ({
    No: 13 - groupIndex,
    'Sub No': 0,
    Series: `Series ${groupIndex}`,
    Characters: Array.from({ length: 50 }, (_, characterIndex) => ({
      Name: `Fighter ${groupIndex}-${characterIndex}`,
      Image: 'fighter.png',
      Order: 50 - characterIndex,
    })),
  }));
  const roster = normalizeRoster(source);
  assert.equal(roster.length, 650);
  assert.equal(new Set(roster.map(({ id }) => id)).size, 650);
  const expectedNames = source.slice().reverse().flatMap((group) =>
    group.Characters.slice().reverse().map(({ Name }) => Name));
  assert.deepEqual(roster.map(({ name }) => name), expectedNames);
  assert.deepEqual(roster.map(({ rosterIndex }) => rosterIndex), Array.from({ length: 650 }, (_, index) => index));
  assert.deepEqual(filterRoster(roster), roster);
  assert.equal(filterRoster(roster, { query: 'fighter' }).length, 650);
  const seriesResults = filterRoster(roster, { series: 'Series 4' });
  assert.equal(seriesResults.length, 50);
  assert.deepEqual(seriesResults.map(({ name }) => name), source[4].Characters.slice().reverse().map(({ Name }) => Name));
  assert.equal(filterRoster(roster, { query: 'fighter 4-2', series: 'Series 4' }).length, 11);
  assert.equal(filterRoster(roster, { query: 'SERIES 12' }).length, 50);
});

test('preserves source fields, handles duplicate names and leaves input unchanged', () => {
  const source = [{ No: '1', 'Sub No': '0', Series: 'Riders', Characters: [
    { Name: 'Ichigo', Image: 'ichigo.png', Order: 1, P: 'Ichigo Rider', Size: '3', Portrait: 'face.png', FaceX: 40, Custom: { power: 7 } },
    { Name: 'Ichigo', Image: 'other.png', Order: 2 },
  ] }];
  const before = JSON.stringify(source);
  const [first, second] = normalizeRoster(source);
  assert.equal(first.FaceX, 40);
  assert.equal(first.Custom.power, 7);
  assert.equal(first.voiceName, 'Ichigo Rider');
  assert.equal(first.P, 'Ichigo Rider');
  assert.equal(first.Size, '3');
  assert.equal(first.size, 3);
  assert.equal(first.portrait, 'face.png');
  assert.equal(first.no, 1);
  assert.notEqual(first.id, second.id);
  assert.equal(second.voiceName, 'Ichigo');
  assert.equal(second.size, 1);
  assert.equal(JSON.stringify(source), before);
});

test('uses P for spoken names and falls back directly to the visible Name', () => {
  const roster = normalizeRoster([{ Characters: [
    { Name: 'ZX', P: ' Zet Cross ', VoiceName: 'Legacy pronunciation' },
    { Name: 'Ichigo', VoiceName: 'Legacy pronunciation' },
    { Name: 'Nigo', P: ' \t ', VoiceName: 'Legacy pronunciation' },
    { Name: 'V3', P: null, VoiceName: 'Legacy pronunciation' },
    { Name: ' X ', P: '' },
  ] }]);
  assert.deepEqual(roster.map(({ voiceName }) => voiceName), ['Zet Cross', 'Ichigo', 'Nigo', 'V3', 'X']);
  assert.deepEqual(roster.map(({ name }) => name), ['ZX', 'Ichigo', 'Nigo', 'V3', 'X']);
});

test('normalizes positive finite Size multipliers, including numeric strings', () => {
  const values = [3, 1, .5, '2', ' 2.5 ', '1e2'];
  const roster = normalizeRoster([{ Characters: values.map((Size, index) => ({ Name: `Rider ${index}`, Size })) }]);
  assert.deepEqual(roster.map(({ size }) => size), [3, 1, .5, 2, 2.5, 100]);
});

test('defaults missing, blank, invalid, and non-positive Size values to one', () => {
  const values = [undefined, null, '', ' \t ', 0, -1, NaN, Infinity, -Infinity, 'invalid', '0', '-3', 'Infinity', true, false, [], [3], {}];
  const roster = normalizeRoster([{ Characters: values.map((Size, index) => ({ Name: `Rider ${index}`, Size })) }]);
  assert.deepEqual(roster.map(({ size }) => size), values.map(() => 1));
});

test('handles an empty roster and numeric fields that are absent or invalid', () => {
  assert.deepEqual(normalizeRoster([]), []);
  assert.deepEqual(filterRoster([], { query: 'missing' }), []);
  const roster = normalizeRoster([{ No: '', 'Sub No': false, Characters: [{ Name: 'Unknown', Order: 'invalid' }] }]);
  assert.equal(roster[0].no, null);
  assert.equal(roster[0].subNo, null);
  assert.equal(roster[0].order, null);
  assert.throws(() => normalizeRoster({}), /array/);
});

test('builds escaped local image URLs and rejects traversal', () => {
  assert.equal(getImageUrl('Ichigo final #1.png'), '/images/Ichigo%20final%20%231.png');
  assert.equal(getImageUrl('images/riders/一号.png'), '/images/riders/%E4%B8%80%E5%8F%B7.png');
  assert.equal(getImageUrl('riders\\ichigo.png'), '/images/riders/ichigo.png');
  assert.equal(getImageUrl('../secret.png'), '');
  assert.equal(getImageUrl(''), '');
});

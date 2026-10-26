/**
 * Arrange an already normalized, sorted roster into rows from bottom to top.
 * Characters retain their ascending left-to-right order within each row.
 */
export function buildLineupRows(roster) {
  const foundation = [];
  const remaining = [];
  for (const character of roster) {
    if (character.no === 0 && character.subNo === 0) {
      foundation.push(character);
    } else {
      remaining.push(character);
    }
  }

  const rows = [];
  if (foundation.length) {
    rows.push({ index: 0, isFoundation: true, characters: foundation });
  }
  for (let start = 0; start < remaining.length; start += 40) {
    rows.push({
      index: rows.length,
      isFoundation: false,
      characters: remaining.slice(start, start + 40),
    });
  }
  return rows;
}

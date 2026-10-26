/** Flatten and sort the source data without changing its character records. */
export function normalizeRoster(data) {
  if (!Array.isArray(data)) {
    throw new TypeError('data.json must contain an array of character groups.');
  }

  const roster = [];
  data.forEach((group, groupIndex) => {
    if (!group || !Array.isArray(group.Characters)) return;
    group.Characters.forEach((character, characterIndex) => {
      if (!character || typeof character !== 'object' || Array.isArray(character)) return;
      const name = String(character.Name ?? '').trim() || 'Unknown character';
      roster.push({
        ...character,
        id: `character-${groupIndex}-${characterIndex}`,
        name,
        image: typeof character.Image === 'string' ? character.Image : '',
        portrait: character.Portrait ?? character['Portrait Image'] ?? '',
        voiceName: String(character.P ?? '').trim() || name,
        size: positiveSize(character.Size),
        series: String(group.Series ?? 'Uncategorized').trim() || 'Uncategorized',
        no: numericValue(group.No),
        subNo: numericValue(group['Sub No']),
        order: numericValue(character.Order),
        sourceIndex: roster.length,
      });
    });
  });

  roster.sort((a, b) => compareNumbers(a.no, b.no)
    || compareNumbers(a.subNo, b.subNo)
    || compareNumbers(a.order, b.order)
    || a.sourceIndex - b.sourceIndex);

  return roster.map((character, rosterIndex) => ({ ...character, rosterIndex }));
}

/** Search names/series and optionally restrict results to one exact series. */
export function filterRoster(roster, { query = '', series = 'all' } = {}) {
  const search = String(query ?? '').trim().toLocaleLowerCase();
  return roster.filter((character) => {
    const matchesSeries = !series || series === 'all' || character.series === series;
    const matchesSearch = !search
      || `${character.name} ${character.series}`.toLocaleLowerCase().includes(search);
    return matchesSeries && matchesSearch;
  });
}

/** Build a same-origin image URL, preserving folders and escaping filenames. */
export function getImageUrl(image) {
  if (typeof image !== 'string' || !image.trim()) return '';
  const path = image.trim().replaceAll('\\', '/').replace(/^\/+/, '').replace(/^images\//i, '');
  const segments = path.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return `/images/${segments.map(encodeURIComponent).join('/')}`;
}

function numericValue(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveSize(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 1;
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? size : 1;
}

function compareNumbers(a, b) {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a - b;
}

import { getImageUrl } from './roster.js';

/** Keep placeholder substitutions local to the lineup and its PNG export. */
export function getLineupArtwork(character) {
  const source = getImageUrl(character.image);
  const placeholder = source === '/images/NoName.png';
  return {
    source: placeholder ? getImageUrl('NoName 2.png') : source,
    label: placeholder ? character.name : '',
  };
}

/** Shared SVG/canvas lettering, in a 1000-unit-wide artwork coordinate system. */
export function layoutLineupName(context, name, artworkHeight) {
  const maxWidth = 320;
  const maxHeight = artworkHeight * .15;
  const words = String(name).trim().split(/\s+/u);
  let fontSize = 56;
  let lines;
  for (;;) {
    context.font = `700 ${fontSize}px Arial, sans-serif`;
    lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        if (line && context.measureText(line + character).width > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    if (lines.length * fontSize * 1.15 <= maxHeight || fontSize <= 1) break;
    fontSize *= .9;
  }
  return {
    lines, fontSize, lineHeight: fontSize * 1.15,
    x: 485, y: artworkHeight * .26 + fontSize,
    strokeWidth: fontSize * .12,
  };
}

export function paintLineupName(context, name, { x, y, width, height }) {
  context.save();
  context.translate(x, y);
  context.scale(width / 1000, width / 1000);
  const label = layoutLineupName(context, name, height * 1000 / width);
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  context.lineJoin = 'round';
  context.strokeStyle = '#111820';
  context.lineWidth = label.strokeWidth;
  context.fillStyle = '#ffffff';
  label.lines.forEach((line, index) => {
    const baseline = label.y + index * label.lineHeight;
    context.strokeText(line, label.x, baseline);
    context.fillText(line, label.x, baseline);
  });
  context.restore();
}

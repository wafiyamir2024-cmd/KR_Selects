/**
 * Calculate the complete lineup using normalized, bottom-first lineup rows.
 * All positions are canvas coordinates. Image boxes include each rider's Size;
 * hoverScale reserves room for interaction without enlarging the image boxes.
 */
export function calculateLineupLayout(rows, width, { hoverScale = 1.1 } = {}) {
  const available = Number.isFinite(width) ? Math.max(1, width) : 1;
  if (!rows.length) {
    return { width: available, height: 0, cellWidth: 0, bodyHeight: 0, rowStep: 0, topInset: 0, rows: [] };
  }

  const largestRow = Math.max(...rows.map((row) => row.characters.length));
  const columns = Math.max(40, largestRow);
  let widthUnits = columns + 1;
  for (const row of rows) {
    row.characters.forEach((character, column) => {
      const center = column - (row.characters.length - 1) / 2;
      widthUnits = Math.max(widthUnits, 2 * (Math.abs(center) + character.size * hoverScale));
    });
  }

  const cellWidth = available / widthUnits;
  const bodyHeight = cellWidth * 2.85;
  const rowStep = bodyHeight * .45;
  let highestArtwork = 0;
  for (const row of rows) {
    const rowTop = (rows.length - 1 - row.index) * rowStep;
    for (const character of row.characters) {
      highestArtwork = Math.min(highestArtwork, rowTop + bodyHeight * (1 - character.size * hoverScale));
    }
  }

  const topInset = Math.max(8, bodyHeight * .12, 8 - highestArtwork);
  const height = topInset + (rows.length - 1) * rowStep + bodyHeight + 12;
  const positionedRows = rows.map((row) => {
    const rowWidth = row.characters.length * cellWidth;
    const left = (available - rowWidth) / 2;
    const top = topInset + (rows.length - 1 - row.index) * rowStep;
    const baselineY = top + bodyHeight;
    return {
      index: row.index,
      left,
      top,
      width: rowWidth,
      height: bodyHeight,
      characters: row.characters.map((character, column) => {
        const centerX = left + (column + .5) * cellWidth;
        const size = character.size;
        const imageWidth = 2 * cellWidth * size;
        const imageHeight = bodyHeight * size;
        const headBand = row.index === 0
          ? bodyHeight
          : bodyHeight - (bodyHeight - rowStep) / Math.max(1, size);
        return {
          character,
          column,
          centerX,
          baselineY,
          size,
          headBand,
          imageBox: {
            x: centerX - imageWidth / 2,
            y: baselineY - imageHeight,
            width: imageWidth,
            height: imageHeight,
          },
        };
      }),
    };
  });

  return { width: available, height, cellWidth, bodyHeight, rowStep, topInset, rows: positionedRows };
}

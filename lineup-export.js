import { calculateLineupLayout } from './lineup-layout.js';
import { getLineupArtwork, paintLineupName } from './lineup-artwork.js';

const TARGET_WIDTH = 3840;
const MAX_PIXELS = 16_000_000;
const MAX_DIMENSION = 8192;
const PREFETCH = 4;
const CACHE_LIMIT = 8;

/** Render the entire crowd without reading or changing the visible lineup. */
export async function createLineupPng(rows, { onProgress } = {}) {
  if (!Array.isArray(rows) || !rows.some(row => row.characters?.length)) {
    throw new Error('Add at least one rider before downloading the lineup.');
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('PNG export needs a browser with canvas support.');
  }

  const padding = Math.round(TARGET_WIDTH * .02);
  const layout = calculateLineupLayout(rows, TARGET_WIDTH - padding * 2);
  const logicalHeight = Math.ceil(layout.height + padding * 2);
  if (!Number.isFinite(logicalHeight) || logicalHeight <= 0) {
    throw new Error('The lineup dimensions are too large to export. Check the character Size values.');
  }
  const entries = layout.rows.slice().sort((a, b) => b.index - a.index)
    .flatMap(row => row.characters.slice().sort((a, b) => a.column - b.column))
    .map(item => ({ ...item, ...getLineupArtwork(item.character) }));
  let scale = Math.min(1, MAX_DIMENSION / logicalHeight,
    Math.sqrt(MAX_PIXELS / (TARGET_WIDTH * logicalHeight)));

  for (let attempt = 0; attempt < 4; attempt++) {
    const width = Math.max(1, Math.floor(TARGET_WIDTH * scale));
    const height = Math.max(1, Math.floor(logicalHeight * scale));
    const canvas = document.createElement('canvas');
    const images = new ExportImages(entries);
    try {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas is unavailable.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.fillStyle = '#080b10';
      context.fillRect(0, 0, width, height);
      const drawingScale = Math.min(width / TARGET_WIDTH, height / logicalHeight);
      context.scale(drawingScale, drawingScale);
      paintFloor(context, TARGET_WIDTH, logicalHeight, padding);
      context.translate(padding, padding);

      const pending = new Map();
      const queue = index => {
        if (index < entries.length) pending.set(index, images.acquire(entries[index].source));
      };
      for (let index = 0; index < Math.min(PREFETCH, entries.length); index++) queue(index);
      let missingCount = 0;
      report(onProgress, 0, entries.length);
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const request = pending.get(index);
        const image = await request.promise;
        if (!paintCharacter(context, entry, image)) missingCount++;
        images.release(request);
        pending.delete(index);
        queue(index + PREFETCH);
        report(onProgress, index + 1, entries.length);
        if (index % 24 === 23) await new Promise(resolve => setTimeout(resolve, 0));
      }
      const blob = await encodePng(canvas);
      return { blob, width, height, missingCount };
    } catch (error) {
      if (attempt === 3) {
        throw new Error('The browser could not create the lineup PNG. Try again or use another browser.', { cause: error });
      }
      // Smaller canvases recover from device allocation and encoding limits.
      scale *= .75;
    } finally {
      images.dispose();
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

function paintFloor(context, width, height, padding) {
  const floorY = height - padding - 8;
  const glow = context.createRadialGradient(width / 2, floorY, 0, width / 2, floorY, width * .43);
  glow.addColorStop(0, 'rgba(42, 102, 128, .13)');
  glow.addColorStop(1, 'rgba(8, 11, 16, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  const line = context.createLinearGradient(padding, 0, width - padding, 0);
  line.addColorStop(0, 'rgba(88, 199, 239, 0)');
  line.addColorStop(.5, 'rgba(122, 184, 204, .35)');
  line.addColorStop(1, 'rgba(88, 199, 239, 0)');
  context.fillStyle = line;
  context.fillRect(padding, floorY, width - padding * 2, 1);
}

function paintCharacter(context, entry, image) {
  const box = entry.imageBox;
  const sourceWidth = image?.naturalWidth || image?.width || 0;
  const sourceHeight = image?.naturalHeight || image?.height || 0;
  if (sourceWidth > 0 && sourceHeight > 0) {
    const ratio = Math.min(box.width / sourceWidth, box.height / sourceHeight);
    const width = sourceWidth * ratio;
    const height = sourceHeight * ratio;
    try {
      const x = box.x + (box.width - width) / 2;
      const y = box.y + box.height - height;
      context.drawImage(image, x, y, width, height);
      if (entry.label) paintLineupName(context, entry.label, { x, y, width, height });
      return true;
    } catch { /* A failed image still gets a visible fallback. */ }
  }
  const fontSize = Math.max(4, Math.min(32, box.width * .3, box.height * .2));
  context.fillStyle = '#8193a4';
  context.font = `500 ${fontSize}px Arial, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'top';
  context.fillText(String(entry.character.name || '?').slice(0, 2).toUpperCase(),
    box.x + box.width / 2, box.y + Math.min(box.height * .18, fontSize * .6), Math.max(1, box.width * .8));
  return false;
}

function encodePng(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => blob && blob.size > 0 ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png');
    } catch (error) { reject(error); }
  });
}

function report(callback, completed, total) {
  try { callback?.({ completed, total }); } catch { /* Progress UI is optional. */ }
}

/** Four requests ahead, with a small reusable-image cache instead of a full-roster image array. */
class ExportImages {
  constructor(entries) {
    this.cache = new Map();
    this.failed = new Set();
    this.remaining = new Map();
    for (const { source } of entries) this.remaining.set(source, (this.remaining.get(source) || 0) + 1);
  }

  acquire(source) {
    if (!source || this.failed.has(source)) return { source, promise: Promise.resolve(null) };
    let entry = this.cache.get(source);
    if (!entry) {
      for (const [key, cached] of this.cache) {
        if (this.cache.size < CACHE_LIMIT) break;
        if (cached.users === 0) {
          cached.dispose();
          this.cache.delete(key);
        }
      }
      const request = loadImage(source);
      entry = { source, users: 0, dispose: request.dispose, promise: request.promise.then(image => {
        if (!image) this.failed.add(source);
        return image;
      }) };
    }
    // Map insertion order doubles as a least-recently-used cache order.
    this.cache.delete(source);
    this.cache.set(source, entry);
    entry.users++;
    return entry;
  }

  release(entry) {
    const remaining = (this.remaining.get(entry.source) || 1) - 1;
    this.remaining.set(entry.source, remaining);
    if (entry.users === undefined) return;
    entry.users--;
    if (remaining === 0) {
      entry.dispose();
      this.cache.delete(entry.source);
    }
  }

  dispose() {
    for (const entry of this.cache.values()) entry.dispose();
    this.cache.clear();
    this.failed.clear();
    this.remaining.clear();
  }
}

function loadImage(source) {
  const image = new Image();
  image.decoding = 'async';
  image.loading = 'eager';
  let settled = false;
  let timer;
  let resolveImage;
  const cleanHandlers = () => {
    clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
  };
  const finish = value => {
    if (settled) return;
    settled = true;
    cleanHandlers();
    resolveImage(value);
  };
  const promise = new Promise(resolve => { resolveImage = resolve; });
  image.onload = async () => {
    try { if (typeof image.decode === 'function') await image.decode(); } catch { /* Loaded dimensions remain usable. */ }
    finish((image.naturalWidth || image.width) > 0 && (image.naturalHeight || image.height) > 0 ? image : null);
  };
  image.onerror = () => finish(null);
  timer = setTimeout(() => { finish(null); image.removeAttribute?.('src'); }, 15_000);
  try { image.src = source; } catch { finish(null); }
  return { promise, dispose() { finish(null); cleanHandlers(); image.removeAttribute?.('src'); } };
}

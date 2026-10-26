import { buildLineupRows } from './lineup-model.js';
import { getLineupArtwork, layoutLineupName } from './lineup-artwork.js';
import { calculateLineupLayout } from './lineup-layout.js';
import { createLineupPng } from './lineup-export.js';

const HOVER_SCALE = 1.1;

/** A full-body crowd whose reading order starts in the bottom/front row. */
export class LineupView {
  constructor(panel, { onPreview, onInteraction } = {}) {
    this.panel = panel;
    this.scroll = panel.querySelector('#lineup-scroll');
    this.canvas = panel.querySelector('#lineup-canvas');
    this.empty = panel.querySelector('#lineup-empty');
    this.tooltip = document.querySelector('#lineup-tooltip');
    this.downloadButton = panel.querySelector('#lineup-download');
    this.downloadStatus = panel.querySelector('#lineup-download-status');
    this.isExporting = false;
    this.onPreview = onPreview;
    this.onInteraction = onInteraction;
    this.rows = [];
    this.items = new Map();
    this.rovingId = null;
    this.previewId = null;
    this.startAtBottom = true;
    this.frame = null;
    this.rowStep = 1;
    this.labelContext = document.createElement('canvas').getContext('2d');
    this.downloadButton.addEventListener('click', () => this.downloadPng());
    this.scroll.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const button = event.target.closest('.lineup-character');
      if (button && this.items.has(button.dataset.id)) this.preview(button.dataset.id, { pointer: event });
    });
    this.scroll.addEventListener('pointerleave', () => {
      if (!this.canvas.contains(document.activeElement)) this.hideTooltip();
    });
    this.scroll.addEventListener('scroll', () => {
      const item = this.items.get(this.previewId);
      if (item && document.activeElement === item.button) this.positionTooltip(item.button);
      else this.hideTooltip();
    }, { passive: true });
    this.canvas.addEventListener('keydown', (event) => this.handleKey(event));
    this.resize = new ResizeObserver(() => {
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(() => this.layout());
    });
    this.resize.observe(this.scroll);
  }

  render(roster) {
    this.hideTooltip();
    this.rows = buildLineupRows(roster);
    this.items.clear();
    this.rovingId = this.rows[0]?.characters[0]?.id ?? null;
    this.startAtBottom = true;
    this.downloadButton.disabled = this.isExporting || !roster.length;
    if (!this.isExporting) this.downloadStatus.hidden = true;
    this.panel.querySelector('#lineup-count').textContent = String(roster.length).padStart(2, '0');
    this.empty.hidden = roster.length > 0;
    this.empty.querySelector('h3').textContent = 'YOUR LINEUP STARTS HERE';
    this.empty.querySelector('p').textContent = 'Add characters to your roster to assemble the collection.';
    const fragment = document.createDocumentFragment();
    for (const row of this.rows) {
      const element = document.createElement('div');
      element.className = 'lineup-row';
      element.dataset.rowIndex = row.index;
      element.dataset.foundation = String(row.isFoundation);
      element.setAttribute('role', 'group');
      element.setAttribute('aria-label', row.isFoundation ? 'Front row: main riders' : `Row ${row.index + 1} from the bottom`);
      row.characters.forEach((character, column) => {
        const artwork = getLineupArtwork(character);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `lineup-character${row.isFoundation ? ' is-foundation' : ''}`;
        button.dataset.id = character.id;
        button.style.setProperty('--lineup-size', String(character.size));
        button.style.setProperty('--lineup-hover-scale', String(HOVER_SCALE));
        button.setAttribute('aria-label', `${character.name}, ${character.series}`);
        button.tabIndex = character.id === this.rovingId ? 0 : -1;
        button.style.zIndex = String(this.rows.length - row.index);
        const fallback = document.createElement('span');
        fallback.className = 'lineup-fallback';
        fallback.setAttribute('aria-hidden', 'true');
        fallback.textContent = character.name.slice(0, 2).toUpperCase();
        const image = document.createElement('img');
        image.className = 'lineup-image';
        image.alt = `${character.name}, full-body artwork`;
        image.loading = 'lazy';
        // Paint loaded artwork with its row so the crowd has no deferred gaps.
        image.decoding = 'sync';
        image.draggable = false;
        image.addEventListener('load', () => {
          fallback.hidden = true;
          if (artwork.label) this.addBodyName(button, image, artwork.label);
        });
        image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; });
        const source = artwork.source;
        if (source) image.src = source;
        else image.hidden = true;
        button.append(fallback, image);
        button.addEventListener('focus', () => {
          this.setRoving(character.id);
          this.preview(character.id);
        });
        button.addEventListener('blur', () => this.hideTooltip());
        button.addEventListener('click', () => {
          this.onInteraction?.();
          this.setRoving(character.id);
          this.preview(character.id, { immediate: true });
        });
        this.items.set(character.id, { character, row: row.index, column, button });
        element.append(button);
      });
      row.element = element;
      fragment.append(element);
    }
    this.canvas.replaceChildren(fragment);
    const legend = this.panel.querySelector('.lineup-legend > span:first-child');
    legend.hidden = !this.rows.some((row) => row.isFoundation);
    this.layout();
  }

  show() { this.layout(); }

  addBodyName(button, image, name) {
    if (!this.labelContext || button.querySelector('.lineup-body-name')) return;
    const height = image.naturalHeight * 1000 / image.naturalWidth;
    const label = layoutLineupName(this.labelContext, name, height);
    const namespace = 'http://www.w3.org/2000/svg';
    const overlay = document.createElementNS(namespace, 'svg');
    overlay.setAttribute('class', 'lineup-image lineup-body-name');
    overlay.setAttribute('viewBox', `0 0 1000 ${height}`);
    overlay.setAttribute('preserveAspectRatio', 'xMidYMax meet');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('focusable', 'false');
    label.lines.forEach((line, index) => {
      const text = document.createElementNS(namespace, 'text');
      text.setAttribute('x', String(label.x));
      text.setAttribute('y', String(label.y + index * label.lineHeight));
      text.setAttribute('font-size', String(label.fontSize));
      text.setAttribute('stroke-width', String(label.strokeWidth));
      text.textContent = line;
      overlay.append(text);
    });
    button.append(overlay);
  }

  hide() { this.hideTooltip(); }

  showError() {
    this.downloadButton.disabled = true;
    this.empty.hidden = false;
    this.empty.querySelector('h3').textContent = 'LINEUP COULD NOT BE LOADED';
    this.empty.querySelector('p').textContent = 'Check data.json, then reload the page.';
  }

  layout() {
    if (this.panel.hidden) return;
    if (!this.rows.length) {
      this.canvas.style.height = '0px';
      return;
    }
    const style = getComputedStyle(this.scroll);
    const available = Math.max(1, this.scroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    const layout = calculateLineupLayout(this.rows, available, { hoverScale: HOVER_SCALE });
    const { cellWidth, bodyHeight } = layout;
    this.rowStep = layout.rowStep;
    this.canvas.style.width = `${available}px`;
    this.canvas.style.height = `${layout.height}px`;
    this.canvas.style.setProperty('--lineup-cell-width', `${cellWidth}px`);
    this.canvas.style.setProperty('--lineup-body-height', `${bodyHeight}px`);
    for (const row of layout.rows) {
      const element = this.rows[row.index].element;
      element.style.left = `${row.left}px`;
      element.style.top = `${row.top}px`;
      element.style.width = `${row.width}px`;
      element.style.height = `${row.height}px`;
      row.characters.forEach(({ character, column, headBand }) => {
        const { button } = this.items.get(character.id);
        button.style.left = `${column * cellWidth}px`;
        button.style.width = `${cellWidth}px`;
        // Enlarged riders expose more of their body above the row in front.
        // Match the hit area to that visible section while keeping the feet fixed.
        button.style.height = `${headBand}px`;
      });
    }
    this.scroll.scrollLeft = 0;
    if (this.startAtBottom) {
      this.scroll.scrollTop = this.scroll.scrollHeight;
      this.startAtBottom = false;
    }
    if (this.previewId && !this.tooltip.hidden) this.positionTooltip(this.items.get(this.previewId).button);
  }

  async downloadPng() {
    if (this.isExporting || !this.rows.length) return;
    this.isExporting = true;
    this.downloadButton.disabled = true;
    this.downloadButton.setAttribute('aria-busy', 'true');
    const label = this.downloadButton.querySelector('span');
    label.textContent = 'PREPARING PNG';
    this.downloadStatus.hidden = false;
    this.downloadStatus.classList.remove('is-error');
    this.downloadStatus.textContent = 'Preparing your complete lineup…';
    // Keep the export tied to the roster at the time of the click.
    const rows = this.rows.map(({ index, isFoundation, characters }) => ({ index, isFoundation, characters: [...characters] }));
    let progressStep = -1;
    try {
      const { blob, width, height, missingCount } = await createLineupPng(rows, {
        onProgress: ({ completed, total }) => {
          const step = Math.floor(completed / total * 20);
          if (step === progressStep) return;
          progressStep = step;
          this.downloadStatus.textContent = completed === total ? 'Creating your PNG…' : `Preparing lineup: ${completed} / ${total} riders…`;
        },
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const today = new Date();
      const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
      link.href = url;
      link.download = `kr-arena-lineup-${date}.png`;
      link.hidden = true;
      document.body.append(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
      this.downloadStatus.textContent = `PNG download started · ${width} × ${height}px.${missingCount ? ` Missing artwork for ${missingCount} rider${missingCount === 1 ? '' : 's'}; placeholders included.` : ''}`;
    } catch (error) {
      this.downloadStatus.classList.add('is-error');
      this.downloadStatus.textContent = 'Could not create the PNG. Please try again.';
      console.error('Unable to export the lineup:', error);
    } finally {
      this.isExporting = false;
      this.downloadButton.disabled = !this.rows.length;
      this.downloadButton.removeAttribute('aria-busy');
      label.textContent = 'DOWNLOAD PNG';
    }
  }

  setRoving(id) {
    if (this.rovingId === id) return;
    const previous = this.items.get(this.rovingId);
    if (previous) previous.button.tabIndex = -1;
    this.rovingId = id;
    const current = this.items.get(id);
    if (current) current.button.tabIndex = 0;
  }

  preview(id, { pointer, immediate = false } = {}) {
    const item = this.items.get(id);
    if (!item || this.panel.hidden) return;
    const changed = this.previewId !== id;
    if (changed) this.hideTooltip();
    this.previewId = id;
    item.button.classList.add('is-previewed');
    item.button.setAttribute('aria-describedby', 'lineup-tooltip');
    this.tooltip.querySelector('strong').textContent = item.character.name;
    this.tooltip.querySelector('span').textContent = item.character.series;
    this.panel.querySelector('#lineup-hover-name').textContent = item.character.name;
    this.panel.querySelector('#lineup-hover-series').textContent = item.character.series;
    this.tooltip.hidden = false;
    this.positionTooltip(item.button, pointer);
    if (changed || immediate) this.onPreview?.(item.character, { immediate });
  }

  positionTooltip(button, pointer) {
    if (this.tooltip.hidden) return;
    const rect = button.getBoundingClientRect();
    const width = this.tooltip.offsetWidth;
    const height = this.tooltip.offsetHeight;
    const center = pointer ? pointer.clientX : rect.left + rect.width / 2;
    const anchorY = pointer ? pointer.clientY - 16 : rect.top - 10;
    const x = Math.max(8, Math.min(window.innerWidth - width - 8, center - width / 2));
    let y = anchorY - height;
    if (y < 8) y = Math.min(window.innerHeight - height - 8, pointer ? pointer.clientY + 20 : rect.bottom + 10);
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, y))}px`;
  }

  hideTooltip() {
    const previous = this.items.get(this.previewId);
    if (previous) {
      previous.button.classList.remove('is-previewed');
      previous.button.removeAttribute('aria-describedby');
    }
    this.previewId = null;
    this.tooltip.hidden = true;
  }

  handleKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const item = this.items.get(event.target.closest('.lineup-character')?.dataset.id);
    if (!item) return;
    if (event.key === 'Escape') { event.preventDefault(); this.hideTooltip(); return; }
    if (event.key === 'Enter' || event.key === ' ') { this.onInteraction?.(); return; }
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    this.onInteraction?.();
    let row = item.row;
    let column = item.column;
    const jump = Math.max(1, Math.floor(this.scroll.clientHeight / this.rowStep));
    if (event.key === 'ArrowLeft') column--;
    if (event.key === 'ArrowRight') column++;
    if (event.key === 'ArrowUp') row++;
    if (event.key === 'ArrowDown') row--;
    if (event.key === 'PageUp') row += jump;
    if (event.key === 'PageDown') row -= jump;
    if (event.key === 'Home') { row = 0; column = 0; }
    if (event.key === 'End') { row = this.rows.length - 1; column = this.rows[row].characters.length - 1; }
    row = Math.min(this.rows.length - 1, Math.max(0, row));
    column = Math.min(this.rows[row].characters.length - 1, Math.max(0, column));
    const next = this.items.get(this.rows[row].characters[column].id);
    this.setRoving(next.character.id);
    next.button.focus({ preventScroll: true });
    next.button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    this.preview(next.character.id);
  }
}

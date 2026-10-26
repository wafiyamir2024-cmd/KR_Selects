import { normalizeRoster, filterRoster, getImageUrl } from './roster.js';
import { SelectionAudio } from './audio.js';
import { LineupView } from './lineup.js';

const $ = (selector, parent = document) => parent.querySelector(selector);
const pad = (value) => String(value).padStart(2, '0');
const CHARACTERS_PER_ROW = 30;
const state = { roster: [], filtered: [], selected: null, locked: false, query: '', series: 'all', ready: false };
const grid = $('#hex-grid');
const field = $('#hex-field');
const panel = $('#player-1');
const selectView = $('#select-view');
const lineupPanel = $('#lineup-view');
const tiles = new Map();
let activeView = 'select';
let toastTimer;
let resizeFrame;
let columns = CHARACTERS_PER_ROW;
let rowHeight = 100;

const audio = new SelectionAudio({ onStateChange: ({ enabled, supported, unlocked, error }) => {
  const toggle = $('#sound-toggle');
  toggle.setAttribute('aria-pressed', String(enabled));
  toggle.setAttribute('aria-label', enabled ? 'Mute voice and sound' : 'Enable voice and sound');
  $('span', toggle).textContent = enabled ? 'SOUND ON' : 'SOUND OFF';
  $('#audio-note').textContent = !enabled ? 'VOICE & SOUND MUTED' : !supported || error ? 'VOICE UNAVAILABLE IN THIS BROWSER' : unlocked ? 'RIDER NAME ANNOUNCEMENTS ENABLED' : 'CLICK A RIDER TO HEAR THEIR NAME';
} });
try { if (localStorage.getItem('kr-arena-sound') === 'off') audio.setEnabled(false); } catch { /* Settings remain session-local. */ }
const lineup = new LineupView(lineupPanel, {
  onPreview: (character, options) => audio.select(character.voiceName, options),
  onInteraction: () => audio.unlock(),
});

function activateView(view, { updateHash = true } = {}) {
  activeView = view === 'lineup' ? 'lineup' : 'select';
  const isLineup = activeView === 'lineup';
  audio.cancel();
  clearTimeout(toastTimer);
  $('#toast').hidden = true;
  selectView.hidden = isLineup;
  lineupPanel.hidden = !isLineup;
  $('#select-controls').hidden = isLineup;
  $('#lineup-controls').hidden = !isLineup;
  for (const name of ['select', 'lineup']) {
    const tab = $(`#${name}-tab`);
    const selected = name === activeView;
    tab.setAttribute('aria-selected', String(selected));
    tab.classList.toggle('nav-active', selected);
    tab.tabIndex = selected ? 0 : -1;
  }
  $('#page-title').innerHTML = isLineup ? 'THE RIDER <em>LINEUP.</em>' : 'CHOOSE YOUR <em>RIDER.</em>';
  $('.arena-heading > p').textContent = isLineup ? 'Every era. Every legend. Together in one frame.' : 'Different eras. One arena. Make your choice.';
  $('.heading-index').innerHTML = isLineup ? 'COLLECTION ARCHIVE <b>ALL ERAS</b>' : 'SELECTION PROTOCOL <b>PLAYER 01</b>';
  document.title = isLineup ? 'KR Arena — Rider Lineup' : 'KR Arena — Character Select';
  if (isLineup) lineup.show();
  else { lineup.hide(); layoutGrid(); }
  if (updateHash) history.replaceState(null, '', `#${activeView}`);
}

for (const view of ['select', 'lineup']) {
  $(`#${view}-tab`).addEventListener('click', () => activateView(view));
}
$('.nav-tabs').addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'select' : event.key === 'End' ? 'lineup' : activeView === 'select' ? 'lineup' : 'select';
  activateView(next);
  $(`#${next}-tab`).focus();
});
window.addEventListener('hashchange', () => activateView(location.hash === '#lineup' ? 'lineup' : 'select', { updateHash: false }));

function announce(message) { $('#announcement').textContent = message; }
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3400);
}

function numberOption(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function createTile(character, index) {
  const slot = document.createElement('div');
  slot.className = 'hex-slot';
  // Keep the entrance short even when hundreds of riders share this grid.
  slot.style.setProperty('--tile-index', Math.min(index, 20));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hex-key';
  button.dataset.id = character.id;
  button.title = `${character.name} · ${character.series}`;
  button.setAttribute('aria-label', `${character.name}, ${character.series}`);
  button.setAttribute('aria-pressed', 'false');
  button.tabIndex = -1;

  const portrait = document.createElement('span');
  portrait.className = 'hex-portrait';
  const initials = document.createElement('span');
  initials.className = 'hex-fallback';
  initials.textContent = character.name.slice(0, 2).toUpperCase();
  const face = document.createElement('img');
  face.className = `hex-face${character.portrait ? ' is-portrait' : ''}`;
  face.alt = '';
  face.loading = 'lazy';
  face.decoding = 'async';
  face.draggable = false;
  face.style.setProperty('--face-x', `${numberOption(character.FaceX, 50, 0, 100)}%`);
  face.style.setProperty('--face-y', `${numberOption(character.FaceY, character.portrait ? 40 : 12, 0, 100)}%`);
  face.style.setProperty('--face-zoom', `${numberOption(character.FaceZoom, 2.6, .5, 8) * 100}%`);
  face.addEventListener('load', () => { initials.hidden = true; });
  face.addEventListener('error', () => {
    // A missing dedicated portrait can still use the full-body artwork.
    if (character.portrait && face.classList.contains('is-portrait') && getImageUrl(character.image)) {
      face.classList.remove('is-portrait');
      face.style.setProperty('--face-y', `${numberOption(character.FaceY, 12, 0, 100)}%`);
      face.src = getImageUrl(character.image);
    } else { face.hidden = true; initials.hidden = false; }
  });
  const source = getImageUrl(character.portrait || character.image);
  if (source) face.src = source;
  else face.hidden = true;

  const shade = document.createElement('span');
  shade.className = 'hex-shade';
  const name = document.createElement('span');
  name.className = 'hex-name';
  name.textContent = character.name;
  const marker = document.createElement('span');
  marker.className = 'hex-player-marker';
  marker.setAttribute('aria-hidden', 'true');
  portrait.append(initials, face, shade, name);
  button.append(portrait, marker);
  slot.append(button);
  button.addEventListener('click', () => {
    audio.unlock();
    state.locked = false;
    selectCharacter(character, { immediate: true });
  });
  button.addEventListener('focus', () => {
    if (!state.locked) selectCharacter(character);
  });
  tiles.set(character.id, { slot, button, marker });
  return slot;
}

function layoutGrid() {
  if (selectView.hidden) return;
  const compact = state.filtered.length > 15;
  field.classList.toggle('is-dense', compact);
  if (!state.filtered.length) {
    grid.style.width = '0px';
    grid.style.height = '0px';
    $('#scroll-hint').hidden = true;
    return;
  }
  const fieldStyle = getComputedStyle(field);
  const available = Math.max(1, field.clientWidth - parseFloat(fieldStyle.paddingLeft) - parseFloat(fieldStyle.paddingRight));
  const stepRatio = .79;
  columns = Math.min(state.filtered.length, CHARACTERS_PER_ROW);
  // Fit all 30 columns inside the viewport, including on narrow screens.
  const width = Math.floor(Math.min(116, available / (1 + (columns - 1) * stepRatio)) * 100) / 100;
  const height = width * .866;
  const rowStep = height + Math.min(7, Math.max(1, width * .06));
  rowHeight = rowStep;
  const colStep = width * stepRatio;
  let bottom = 0;
  state.filtered.forEach((character, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const top = row * rowStep + (col % 2 ? rowStep / 2 : 0);
    const { slot } = tiles.get(character.id);
    slot.style.left = `${col * colStep}px`;
    slot.style.top = `${top}px`;
    bottom = Math.max(bottom, top + height);
  });
  grid.style.setProperty('--hex-width', `${width}px`);
  grid.style.setProperty('--hex-height', `${height}px`);
  const inset = Math.min(1.5, width * .03);
  grid.style.setProperty('--hex-inset', `${inset}px`);
  grid.style.setProperty('--hex-selected-inset', `${inset + Math.min(.8, width * .015)}px`);
  grid.style.setProperty('--hex-name-size', `${Math.min(9, width * .14)}px`);
  grid.style.setProperty('--hex-marker-size', `${Math.min(8, width * .16)}px`);
  grid.style.setProperty('--hex-fallback-size', `${Math.min(24, width * .34)}px`);
  field.classList.toggle('portraits-only', width < 50);
  const gridWidth = width + (columns - 1) * colStep;
  grid.style.width = `${gridWidth}px`;
  grid.style.height = `${bottom}px`;
  const verticalScroll = bottom > field.clientHeight - parseFloat(fieldStyle.paddingTop) - parseFloat(fieldStyle.paddingBottom);
  $('#scroll-hint').hidden = !verticalScroll;
  $('#scroll-hint').textContent = 'SCROLL TO EXPLORE ↓';
  if (document.activeElement?.classList.contains('hex-key')) revealSelected();
}

function renderRoster() {
  state.filtered = filterRoster(state.roster, { query: state.query, series: state.series });
  tiles.clear();
  grid.replaceChildren(...state.filtered.map(createTile));
  field.scrollTop = 0;
  field.scrollLeft = 0;
  const message = $('#roster-message');
  message.replaceChildren();
  message.hidden = state.filtered.length > 0;
  if (!state.filtered.length) {
    const heading = document.createElement('h3');
    heading.textContent = state.roster.length ? 'NO RIDERS FOUND' : 'YOUR ROSTER STARTS HERE';
    const description = document.createElement('p');
    description.textContent = state.roster.length ? 'Try another name or explore a different series.' : 'Add characters to data.json to bring your arena to life.';
    message.append(heading, description);
    if (state.roster.length) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'reset-filters';
      reset.textContent = 'Show all riders';
      reset.addEventListener('click', clearFilters);
      message.append(reset);
    }
  }
  $('#filter-summary').textContent = state.series === 'all' ? 'ALL RIDERS' : state.series.toUpperCase();
  $('#roster-range').textContent = `${pad(state.filtered.length)} / ${pad(state.roster.length)} RIDERS`;
  $('#random-select').disabled = !state.filtered.length;
  layoutGrid();
  renderSelection();
}

function clearFilters() {
  state.query = '';
  state.series = 'all';
  $('#roster-search').value = '';
  $('#series-filter').value = 'all';
  renderRoster();
}

function updateFighterImage(panel, character) {
  const image = $('.fighter-image', panel);
  const missing = $('.image-unavailable', panel);
  const source = character ? getImageUrl(character.image) : '';
  image.alt = character ? `${character.name}, full-body artwork` : '';
  if (image.dataset.source === source) return;
  image.dataset.source = source;
  image.hidden = !source;
  missing.hidden = Boolean(source);
  image.onload = () => { image.hidden = false; missing.hidden = true; };
  image.onerror = () => { image.hidden = true; missing.hidden = false; };
  if (source) image.src = source;
  else image.removeAttribute('src');
}

function renderSelection() {
  const character = state.selected;
  panel.classList.toggle('is-active', !state.locked);
  panel.classList.toggle('is-locked', state.locked);
  $('.player-state', panel).textContent = state.locked ? 'LOCKED IN' : 'SELECTING';
  $('.player-tab', panel).setAttribute('aria-pressed', String(!state.locked));
  $('.stage-status-text', panel).textContent = state.locked ? 'RIDER CONFIRMED' : character ? 'RIDER SYSTEM · CONNECTED' : 'AWAITING RIDER';
  updateFighterImage(panel, character);
  $('.fighter-series', panel).textContent = character?.series || 'SELECT A CHARACTER';
  $('.fighter-name', panel).textContent = character?.name || '—';
  $('.fighter-index', panel).textContent = character ? `NO. ${String(character.rosterIndex + 1).padStart(3, '0')}` : 'NO. —';
  $('.fighter-class', panel).textContent = state.locked ? 'SELECTION CONFIRMED' : 'RIDER SELECT';
  const selectedId = character?.id;
  let foundFocus = false;
  for (const [id, { slot, button, marker }] of tiles) {
    const selected = id === selectedId;
    slot.classList.toggle('is-p1', selected);
    slot.classList.toggle('is-selected', selected);
    marker.textContent = selected ? '1P' : '';
    button.setAttribute('aria-pressed', String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected) foundFocus = true;
  }
  if (!foundFocus && tiles.size) tiles.values().next().value.button.tabIndex = 0;
  const confirm = $('#confirm-selection');
  confirm.disabled = !character;
  $('span', confirm).textContent = state.locked ? 'CHANGE RIDER' : 'CONFIRM RIDER';
  $('#turn-indicator').replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'status-dot';
  $('#turn-indicator').append(dot, state.locked ? 'PLAYER ONE IS READY' : 'PLAYER ONE IS SELECTING');
  $('#selection-hint').textContent = state.locked ? 'RIDER CONFIRMED · CLICK A RIDER TO CHANGE' : 'HOVER TO DISCOVER · CLICK TO SELECT';
}

function selectCharacter(character, { immediate = false, speak = true } = {}) {
  if (!character) return;
  const changed = state.selected?.id !== character.id;
  state.selected = character;
  renderSelection();
  if (speak && (changed || immediate)) audio.select(character.voiceName, { immediate });
  if (changed) announce(`Player 1: ${character.name}, ${character.series}.`);
}

function revealSelected() {
  const selected = state.selected;
  const slot = selected && tiles.get(selected.id)?.slot;
  if (!slot) return;
  const tileBounds = slot.getBoundingClientRect();
  const fieldBounds = field.getBoundingClientRect();
  if (tileBounds.top < fieldBounds.top + 12) field.scrollTop += tileBounds.top - fieldBounds.top - 12;
  else if (tileBounds.bottom > fieldBounds.bottom - 12) field.scrollTop += tileBounds.bottom - fieldBounds.bottom + 12;
}

function focusCharacter(character) {
  const button = character && tiles.get(character.id)?.button;
  if (!button) return;
  if (document.activeElement === button) selectCharacter(character);
  else button.focus({ preventScroll: true });
  button.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

function confirmSelection() {
  if (!state.selected) return;
  if (state.locked) { unlockSelection(); return; }
  audio.unlock();
  audio.confirm();
  state.locked = true;
  renderSelection();
  announce(`${state.selected.name} confirmed. Player one is ready.`);
  toast(`${state.selected.name} locked in.`);
}

function unlockSelection() {
  audio.cancel();
  if (!state.ready) return;
  state.locked = false;
  renderSelection();
  revealSelected();
  announce('Player one, choose your rider.');
}

function randomSelection() {
  if (!state.filtered.length) return;
  audio.unlock();
  state.locked = false;
  const currentId = state.selected?.id;
  const pool = state.filtered.length > 1 ? state.filtered.filter((character) => character.id !== currentId) : state.filtered;
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const character = pool[Math.floor((random[0] / 4294967296) * pool.length)];
  state.selected = character;
  renderSelection();
  audio.select(character.voiceName, { immediate: true });
  announce(`Random pick: ${character.name}.`);
  focusCharacter(character);
}

$('#roster-search').addEventListener('input', (event) => { state.query = event.target.value; renderRoster(); });
// Actual pointer movement previews riders; scrolling tiles beneath a stationary
// pointer must not override a selection made with the keyboard.
grid.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' || state.locked) return;
  const button = event.target.closest('.hex-key');
  const character = button && state.filtered.find((item) => item.id === button.dataset.id);
  if (character && state.selected?.id !== character.id) selectCharacter(character);
});
$('#series-filter').addEventListener('change', (event) => { state.series = event.target.value; renderRoster(); });
$('#confirm-selection').addEventListener('click', confirmSelection);
$('#random-select').addEventListener('click', randomSelection);
$('.player-tab', panel).addEventListener('click', unlockSelection);
$('#sound-toggle').addEventListener('click', () => {
  audio.setEnabled(!audio.enabled);
  try { localStorage.setItem('kr-arena-sound', audio.enabled ? 'on' : 'off'); } catch { /* Optional preference. */ }
  if (audio.enabled) { audio.unlock(); if (state.selected) audio.select(state.selected.voiceName, { immediate: true }); }
});
$('#fullscreen-toggle').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else toast('Fullscreen is not available in this browser.');
  } catch { toast('Fullscreen is not available in this window.'); }
});
document.addEventListener('fullscreenchange', () => { $('#fullscreen-toggle').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'); });
document.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
document.addEventListener('keydown', (event) => {
  if (activeView !== 'select' || event.target.closest?.('[role="tablist"]')) return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
  const target = event.target;
  const typing = target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
  if (typing) { if (event.key === 'Escape') { target.blur(); audio.cancel(); } return; }
  audio.unlock();
  if (event.key === '/') { event.preventDefault(); $('#roster-search').focus(); return; }
  if (event.key.toLowerCase() === 'r') { event.preventDefault(); randomSelection(); return; }
  if (event.key === 'Escape') { event.preventDefault(); unlockSelection(); return; }
  if (event.key === 'Enter' && (target === document.body || target.classList.contains('hex-key'))) { event.preventDefault(); confirmSelection(); return; }
  const jump = columns * Math.max(1, Math.floor((field.clientHeight - 40) / rowHeight));
  const directions = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns, PageUp: -jump, PageDown: jump };
  if (!(event.key in directions) && event.key !== 'Home' && event.key !== 'End') return;
  if (!state.filtered.length) return;
  if (target !== document.body && !target.classList.contains('hex-key')) return;
  event.preventDefault();
  state.locked = false;
  const index = state.filtered.findIndex((character) => character.id === (target.dataset?.id || state.selected?.id));
  let next = event.key === 'Home' ? 0 : event.key === 'End' ? state.filtered.length - 1 : (index < 0 ? 0 : index) + directions[event.key];
  next = Math.min(state.filtered.length - 1, Math.max(0, next));
  focusCharacter(state.filtered[next]);
});
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(layoutGrid);
}).observe(field);
window.addEventListener('pagehide', () => audio.cancel());

async function loadRoster() {
  try {
    const response = await fetch('/data.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Roster request failed (${response.status}).`);
    state.roster = normalizeRoster(await response.json());
    state.selected = state.roster[0] || null;
    const counts = new Map();
    for (const character of state.roster) counts.set(character.series, (counts.get(character.series) || 0) + 1);
    for (const [series, count] of counts) {
      const option = document.createElement('option');
      option.value = series;
      option.textContent = `${series} (${count})`;
      $('#series-filter').append(option);
    }
    $('#total-count').textContent = pad(state.roster.length);
    state.ready = true;
    renderRoster();
    lineup.render(state.roster);
  } catch (error) {
    lineup.showError();
    const message = $('#roster-message');
    message.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = 'ROSTER COULD NOT BE LOADED';
    const description = document.createElement('p');
    description.textContent = 'Check that data.json contains valid JSON, then reload the page.';
    const retry = document.createElement('button');
    retry.className = 'reset-filters';
    retry.textContent = 'Try again';
    retry.addEventListener('click', loadRoster);
    message.append(title, description, retry);
    message.hidden = false;
    $('#roster-range').textContent = 'CONNECTION INTERRUPTED';
    $('#confirm-selection').disabled = true;
    $('#random-select').disabled = true;
    console.error('Unable to load character roster:', error);
  }
}

activateView(location.hash === '#lineup' ? 'lineup' : 'select', { updateHash: false });
loadRoster();

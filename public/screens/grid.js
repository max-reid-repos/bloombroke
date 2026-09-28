// GRID: a board of up to 16 mini charts. Numbers first: each tile's current value is the
// biggest thing on it, its change over the range next to it, then a light line with its
// high and low marked (H 237.40, L 164.10). /api/grid (lib/grid.js) sends every tile of a
// board in one answer; the words it takes are in command-args.js (parseGrid).
//
//   GRID                   your last board, else the starter board
//   GRID NVDA AMD INTC 1Y  those tiles over 1Y
//   GRID STARTER           the starter board
//
// The range chips above the board switch every tile in place (the URL follows); STARTER
// brings the starter board back. A click or Enter opens a tile's own screen; arrows move
// between tiles; Delete removes
// one; / swaps its word; C copies the board's link; the + tile adds one. On a phone the
// tiles are one-line rows: a tap opens the row into the full tile, with OPEN. In a DESK
// panel (embed) the board alone fills the panel: no chips, no + tile, no note.
// Free for everyone. The link is the save: the whole board is in the URL. This browser
// keeps the last board (LAST_KEY); with Pro it syncs like DESK layouts (pro.js SYNC_DOCS).

import { esc, q, fmtNum, fmtPct, dirOf } from './markets.js';
import { PRESETS } from '../ranges.js';
import { GRID_LAST_KEY } from '../pro.js';
import {
  parseGrid as parse, gridCmd, gridItem, isGridStarter,
  GRID_MAX, GRID_RANGE, GRID_STARTER, GRID_RANGE_CHIPS, WEIRD_PERIODS,
} from '../command-args.js'; // the words it takes: read at startup (command-args.js)

export { parse };
// The command bar and the URL keep the clean form: the tokens (or STARTER).
export const toInput = (args) => gridCmd(args);

export const LAST_KEY = GRID_LAST_KEY;
export const RETRY_MS = 3000;
export const PHONE_MQ = '(max-width: 639px)';
export const NOTE_LINE = 'Prices may be delayed.';
// Errors the server asks us to try again once (lib/grid.js RETRY_ERRORS).
const RETRY = ['unavailable', 'pending'];

// ---- Layout ---------------------------------------------------------------------------

// Columns x rows by tile count (the + tile counts): 1x1, 2x1, 2x2, 3x2, 3x3, 4x3, 4x4.
export const LAYOUTS = [[1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4]];
export function layoutFor(n) {
  const hit = LAYOUTS.find(([c, r]) => c * r >= n) || LAYOUTS[LAYOUTS.length - 1];
  return { cols: hit[0], rows: hit[1] };
}

// ---- Numbers ----------------------------------------------------------------------------

export function fmtValue(v, decimals = 2, unit = '') {
  if (!Number.isFinite(v)) return '--';
  return `${fmtNum(v, decimals)}${unit}`;
}
// A WEIRD reading has no decimals of its own: as many as its size needs.
export const autoDecimals = (v) => (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 1 : 2);

// The labelled dots on a tile: the server's own (a GRAVEYARD stone), else the high and
// the low. -> [{ i, text, pos }], i an index into tile.points.
export function marksFor(tile) {
  const pts = tile?.points || [];
  if (pts.length < 2) return [];
  if (Array.isArray(tile.marks)) return tile.marks.filter((m) => pts[m.i]);
  let hi = 0;
  let lo = 0;
  pts.forEach((p, i) => { if (p.v > pts[hi].v) hi = i; if (p.v < pts[lo].v) lo = i; });
  if (hi === lo) return [];
  const d = Number.isInteger(tile.decimals) ? tile.decimals : null;
  const f = (v) => fmtValue(v, d ?? autoDecimals(v), tile.unit || '');
  return [{ i: hi, text: `H ${f(pts[hi].v)}`, pos: 'above' }, { i: lo, text: `L ${f(pts[lo].v)}`, pos: 'below' }];
}

// ---- The line and its labelled dots -------------------------------------------------------

// Labels are 10px mono (grid.css .gr-lab): about 6 px a character.
export const LABEL_CHAR_W = 6.1;
export const LABEL_PAD = 14; // room above and below the line for a label
const EDGE = 2;

// A label beside its dot, flipped to the other side near an edge, never outside the
// w x h box: -> { x, y, w } (x is its left edge, y its baseline). size: the font size in
// px (10 on the screen; the share card draws bigger), a character 0.61 of it.
export function placeLabel(dx, dy, text, pos, w, h, size = 10) {
  const k = size / 10;
  const lw = String(text).length * LABEL_CHAR_W * k;
  let x = dx + 5 * k;
  if (x + lw > w - EDGE) x = dx - 5 * k - lw;
  if (x < EDGE) x = Math.max(EDGE, Math.min(w - EDGE - lw, dx - lw / 2));
  let y = pos === 'above' ? dy - 5 * k : dy + 12 * k;
  y = Math.max(10 * k, Math.min(h - 3 * k, y)); // the glyphs' ascent and descent stay in
  return { x, y, w: lw };
}

// The line's geometry, shared with the share card (lib/og-grid.js): points -> { xy: [[x, y]],
// marks: [{ x, y, text, pos }] } in a w x h box, or null.
export function sparkGeometry(points, { w, h, marks = [], byTime = false, pad = LABEL_PAD } = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.v));
  if (pts.length < 2 || !(w > 8) || !(h > 8)) return null;
  const vs = pts.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = hi - lo || 1;
  const top = Math.min(pad, h / 3);
  const bottom = h - Math.min(pad, h / 3);
  const t0 = pts[0].t;
  const tSpan = pts[pts.length - 1].t - t0 || 1;
  const X = (p, i) => EDGE + (byTime ? (p.t - t0) / tSpan : i / (pts.length - 1)) * (w - EDGE * 2);
  const Y = (v) => bottom - ((v - lo) / span) * (bottom - top);
  return {
    xy: pts.map((p, i) => [X(p, i), Y(p.v)]),
    marks: marks.filter((m) => pts[m.i]).map((m) => ({ x: X(pts[m.i], m.i), y: Y(pts[m.i].v), text: m.text, pos: m.pos })),
  };
}

// points [{ t, v }] -> an SVG line w x h with its marks (marksFor). byTime: x by time (a
// stone's drawn cliff), else by index. dir: up, down or flat (the line's colour). No
// inline styles: the CSP blocks them, so every look is a class in grid.css.
export function gridSparkSvg(points, { w = 160, h = 60, marks = [], dir = 'flat', byTime = false, pad = LABEL_PAD, cls = '' } = {}) {
  const g = sparkGeometry(points, { w, h, marks, byTime, pad });
  if (!g) return '';
  const line = g.xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const dots = g.marks.map((m) => {
    const at = placeLabel(m.x, m.y, m.text, m.pos, w, h);
    return `<circle class="gr-dot" cx="${m.x.toFixed(1)}" cy="${m.y.toFixed(1)}" r="2.5"/><text class="gr-lab" x="${at.x.toFixed(1)}" y="${at.y.toFixed(1)}">${esc(m.text)}</text>`;
  }).join('');
  return `<svg class="gr-svg${cls ? ` ${cls}` : ''}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline class="gr-line ${dir}" points="${line}"/>${dots}</svg>`;
}

// ---- Tiles ------------------------------------------------------------------------------

// The command a tile opens: its chart over the range, the gauge, the stone, BBRK.
export function openCmd(item, range = GRID_RANGE) {
  if (!item) return null;
  switch (item.kind) {
    case 'market': return `${item.token} ${range}`;
    case 'cpi': return 'CPI';
    case 'weird': return WEIRD_PERIODS.includes(range) ? `${item.gauge} ${range}` : item.gauge;
    case 'rip': return `GRAVEYARD ${item.ticker}`;
    case 'bbrk': return 'BBRK';
    default: return null;
  }
}

const label = (item, tile) => tile?.label || String(item.token).replace(/^(W:|\$)/, '');

// What the tile says: { big, pill, pillDir, sub, msg } from the server's tile (or none yet).
export function tileFace(item, tile) {
  if (!tile) return { msg: 'LOADING...' };
  if (tile.error === 'not_found' || item.kind === 'unknown') return { msg: 'NO SUCH TICKER', suggest: tile.suggest || item.suggest || null };
  if (tile.error) return { msg: RETRY.includes(tile.error) ? 'LOADING...' : 'NO DATA' };
  switch (tile.kind) {
    case 'weird': return { big: tile.headline || '--', text: true, stale: Boolean(tile.stale) };
    case 'rip': return { big: Number.isFinite(tile.final) ? `$${fmtNum(tile.final, 2)}` : tile.what || 'GONE', pill: 'RIP', pillDir: 'rip' };
    case 'bbrk': return {
      big: Number.isInteger(tile.views7) ? fmtNum(tile.views7, 0) : '--', pill: '7D', pillDir: 'flat',
      sub: `page views this week · ${Number.isInteger(tile.here) ? fmtNum(tile.here, 0) : '--'} here now`,
      rowPill: `${Number.isInteger(tile.here) ? fmtNum(tile.here, 0) : '--'} here`,
    };
    default: return {
      big: fmtValue(tile.last, tile.decimals, tile.unit), pill: fmtPct(tile.changePct), pillDir: dirOf(tile.changePct), stale: Boolean(tile.stale),
    };
  }
}

// One tile: the desktop tile and the phone row are the same markup (grid.css shows one
// or the other). i: its place; open: the phone row is open; range: for OPEN.
export function tileHtml(item, tile, { i = 0, open = false, range = GRID_RANGE } = {}) {
  const f = tileFace(item, tile);
  const sym = label(item, tile);
  const name = tile?.name || '';
  const cmd = openCmd(item, range);
  const pill = f.pill ? `<span class="gr-pill num ${esc(f.pillDir || 'flat')}">${esc(f.pill)}</span>` : '';
  // CPI is monthly: under a year it shows a year, and says so.
  const own = tile?.kind === 'cpi' && !tile.error && tile.range && tile.range !== range ? `<span class="gr-rng">${esc(tile.range)}</span>` : '';
  const dym = f.suggest ? `<p class="gr-dym">Did you mean <button type="button" class="gr-swapto" data-swap="${esc(f.suggest)}">${esc(f.suggest)}</button>?</p>` : '';
  const hero = f.msg
    ? `<div class="gr-hero"><span class="gr-msg">${esc(f.msg)}</span></div>${dym}`
    : `<div class="gr-hero"><span class="gr-big num${f.text ? ' is-text' : ''}${f.stale ? ' is-stale' : ''}">${esc(f.big)}</span>${pill}${own}</div>${f.sub ? `<p class="gr-sub">${esc(f.sub)}</p>` : ''}`;
  const rowVal = f.msg ? `<span class="gr-val gr-msg">${esc(f.msg)}</span>` : `<span class="gr-val num${f.text ? ' is-text' : ''}">${esc(f.big)}</span>`;
  const rowChg = f.msg ? '' : f.rowPill ? `<span class="gr-chg num flat">${esc(f.rowPill)}</span>` : f.pill ? `<span class="gr-chg num ${esc(f.pillDir || 'flat')}">${esc(f.pill)}</span>` : '<span class="gr-chg"></span>';
  const openLink = cmd && !f.msg ? `<a class="gr-open code" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}">OPEN</a>` : '';
  const kind = tile?.kind && tile.kind !== 'unknown' ? tile.kind : item.kind;
  return `<div class="gr-tile is-${esc(kind)}${open ? ' is-open' : ''}" data-i="${i}" data-token="${esc(item.token)}" tabindex="0" aria-label="${esc(`${sym}${name ? `, ${name}` : ''}${cmd ? '. Enter opens it' : ''}`)}">
    <div class="gr-row" data-row><span class="gr-sym">${esc(sym)}</span><span class="gr-name">${esc(name)}</span><span class="gr-mini" aria-hidden="true"></span>${rowVal}${rowChg}</div>
    <div class="gr-full">${hero}<div class="gr-chart"></div>${openLink}</div>
    <button type="button" class="gr-x" data-x tabindex="-1" aria-label="Remove ${esc(sym)}">×</button>
  </div>`;
}

export function addTileHtml() {
  return `<div class="gr-tile gr-add" tabindex="-1">
    <span class="gr-add-plus" aria-hidden="true">+</span>
    <input class="gr-in" type="text" placeholder="ADD A TICKER" aria-label="Add a tile: a ticker, CPI, W:PIZZA, RIP:LEH" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done">
  </div>`;
}

// ---- The bar: range, STARTER, share ----------------------------------------------------------
export function rangeChips(range) {
  const list = GRID_RANGE_CHIPS.includes(range) ? GRID_RANGE_CHIPS : [...GRID_RANGE_CHIPS, range];
  return `<nav class="seg gr-ranges" aria-label="Range">${list.map((r) => `<button type="button" class="seg-item${r === range ? ' is-active' : ''}" data-range="${esc(r)}" aria-pressed="${r === range}">${esc(r)}</button>`).join('')}</nav>`;
}
// A small text button back to the starter board (none while the board is the starter).
export function starterButton(tokens) {
  return isGridStarter(tokens) ? '' : '<button type="button" class="gr-starter" data-starter>STARTER</button>';
}

// SHARE: the board's link, and a post on X that carries it.
// The post's text names only real tiles: a word that is no tile is left out of it.
export function shareLinks(tokens, range, origin) {
  const c = gridCmd({ tokens, range });
  const url = `${origin}/${q(c)}`;
  const real = tokens.filter((t) => gridItem(t)?.kind && gridItem(t).kind !== 'unknown');
  const words = gridCmd({ tokens: real, range }).replace(/^GRID ?/, '') || 'STARTER';
  const text = `My GRID on Bloombroke: ${words.length > 90 ? `${words.slice(0, 87)}...` : words}`;
  return { url, x: `https://x.com/intent/post?${new URLSearchParams({ text, url })}` };
}

// ---- The last board ------------------------------------------------------------------------

// Keep the board as this browser's last one; never from a DESK panel (it only shows).
export function saveLastBoard(store, board, { embed = false } = {}) {
  if (embed || !store) return false;
  store.set(LAST_KEY, { tokens: board.tokens, range: board.range });
  return true;
}

// A stored board, checked: { tokens, range } or null.
export function cleanBoard(b) {
  if (!b || !Array.isArray(b.tokens)) return null;
  const tokens = [...new Set(b.tokens.map((t) => gridItem(t)?.token).filter(Boolean))].slice(0, GRID_MAX);
  const range = PRESETS.includes(b.range) ? b.range : GRID_RANGE;
  return tokens.length ? { tokens, range } : null;
}

// ---- Keys (the GRAVEYARD scene's rule, screens/graveyard.js sceneKeys) ------------------------
// Keys typed in the command bar or any input are never taken: Esc in an empty command
// bar moves the focus to the board. onKey(ev) -> true when it used the key.
export function sceneKeys(scene, onKey, { doc = globalThis.document } = {}) {
  scene.tabIndex = -1;
  scene.dataset.ownFocus = '';
  const handler = (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const t = ev.target;
    if (t?.id === 'cmd') {
      const list = doc.getElementById?.('suggest');
      if (ev.key === 'Escape' && !t.value && !(list && !list.hidden) && !ev.defaultPrevented && scene.isConnected !== false) {
        ev.preventDefault();
        scene.focus?.({ preventScroll: true });
      }
      return;
    }
    if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (onKey(ev) === true) { ev.preventDefault(); ev.stopPropagation(); }
  };
  doc.addEventListener('keydown', handler, true);
  return () => doc.removeEventListener('keydown', handler, true);
}

// A key on the board -> what it does: move, open, remove, swap, copy, or null (not ours).
// inScene: the focus is inside the board; tileAt: the focused tile's place (-1: none).
// A DESK panel (embed) only shows its board: no remove, no swap.
export function boardKeyAction(key, { inScene = false, tileAt = -1, embed = false, phone = false, shift = false } = {}) {
  if (!inScene) return null;
  if (key.startsWith('Arrow')) return shift ? null : 'move';
  if (key === 'Enter' && tileAt >= 0) return phone ? 'toggle' : 'open';
  if ((key === 'Delete' || key === 'Backspace') && tileAt >= 0) return embed ? null : 'remove';
  if (key === '/' && tileAt >= 0) return embed ? null : 'swap';
  if ((key === 'c' || key === 'C') && !phone) return 'copy';
  return null;
}

// Arrow key -> the next index in a board of `cols` columns and n tiles.
export function stepIndex(cur, key, cols, n) {
  if (cur < 0) return 0;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[key];
  if (step === undefined) return cur;
  const next = cur + step;
  return next < 0 || next >= n ? cur : next;
}

// ---- The screen -----------------------------------------------------------------------------

async function getGrid(url, { signal } = {}) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) throw Object.assign(new Error(body?.message || 'Data is taking a break.'), { status: res.status });
  return body;
}

export function render(el, cmd, ctx) {
  const args = cmd.args?.items ? cmd.args : parse([]);
  const store = ctx.store;
  const phoneMq = typeof window === 'object' ? window.matchMedia?.(PHONE_MQ) : null;
  const phone = () => Boolean(phoneMq?.matches) && !ctx.embed; // a DESK panel keeps tiles
  const last = cleanBoard(store?.get(LAST_KEY, null));

  let range = args.range;
  let items;
  if (args.bare) {
    items = (last ? last.tokens : GRID_STARTER).map(gridItem).filter(Boolean);
    if (!args.rangeGiven && last) range = last.range;
  } else items = args.items.slice();

  const data = new Map(); // token -> the server's tile, for this range
  let openAt = -1; // the phone row that is open
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  ctx.onCleanup(() => { for (const id of timers) clearTimeout(id); });

  el.innerHTML = `<section class="panel panel-solo gr-panel${ctx.embed ? ' is-embed' : ''}">
    <header class="panel-head"><h2 class="panel-label">1) GRID</h2><span class="panel-meta gr-meta"></span></header>
    <div class="panel-body flush gr-body">
      <div class="gr-bar"><div class="gr-chips"></div><div class="gr-share"></div></div>
      <div class="gr-scene"><div class="gr-board"></div></div>
      <div class="gr-foot"></div>
      <div class="gr-toast" role="status" aria-live="polite"></div>
    </div>
  </section>`;
  const scene = el.querySelector('.gr-scene');
  const board = el.querySelector('.gr-board');
  const chipsEl = el.querySelector('.gr-chips');
  const shareEl = el.querySelector('.gr-share');
  const foot = el.querySelector('.gr-foot');
  const toastEl = el.querySelector('.gr-toast');
  const tokens = () => items.map((i) => i.token);
  const origin = typeof location === 'object' ? location.origin : 'https://bloombroke.com';

  // ---- drawing ----
  function drawBar() {
    const t = tokens();
    chipsEl.innerHTML = `${rangeChips(range)}${starterButton(t)}`;
    const links = shareLinks(t, range, origin);
    shareEl.innerHTML = `<button type="button" class="chip" data-copy>COPY LINK</button><a class="chip" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer">POST ON X</a>`;
  }
  function drawFoot() {
    foot.innerHTML = `<p class="gr-note">${esc(NOTE_LINE)}</p>`;
  }
  function drawCharts() {
    board.querySelectorAll('.gr-tile[data-i]').forEach((node) => {
      const item = items[Number(node.dataset.i)];
      const tile = item && data.get(item.token);
      const host = node.querySelector('.gr-chart');
      const mini = node.querySelector('.gr-mini');
      const pts = tile && !tile.error ? tile.points : null;
      const dir = tile?.kind === 'rip' ? 'down' : dirOf(tile?.changePct);
      if (host) {
        const w = Math.floor(host.clientWidth);
        const h = Math.floor(host.clientHeight);
        host.innerHTML = pts && w > 8 && h > 8 ? gridSparkSvg(pts, { w, h, marks: marksFor(tile), dir, byTime: Boolean(tile.xByTime) }) : '';
      }
      if (mini) mini.innerHTML = pts && phone() ? gridSparkSvg(pts, { w: 56, h: 16, dir, pad: 1, byTime: Boolean(tile.xByTime), cls: 'is-mini' }) : '';
    });
  }
  function drawBoard() {
    const had = document.activeElement;
    const focusAt = had && board.contains(had) ? (had.closest('.gr-tile')?.dataset.i ?? (had.closest('.gr-add') ? 'add' : null)) : null;
    const withAdd = !ctx.embed && items.length < GRID_MAX;
    const { cols, rows } = layoutFor(items.length + (withAdd ? 1 : 0));
    board.className = `gr-board gr-c${cols} gr-r${rows}`;
    board.innerHTML = items.map((it, i) => tileHtml(it, data.get(it.token), { i, open: i === openAt, range })).join('') + (withAdd ? addTileHtml() : '');
    drawCharts();
    if (focusAt === 'add') board.querySelector('.gr-in')?.focus({ preventScroll: true });
    else if (focusAt !== null) (board.querySelector(`.gr-tile[data-i="${focusAt}"]`) || board.querySelector('.gr-tile'))?.focus({ preventScroll: true });
  }
  function drawAll() { drawBar(); drawBoard(); drawFoot(); }

  let toastTimer = null;
  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 1600);
  }
  ctx.onCleanup(() => clearTimeout(toastTimer));

  // ---- the URL and the last board ----
  function saveLast() { saveLastBoard(store, { tokens: tokens(), range }, { embed: ctx.embed }); }
  function commit() {
    if (ctx.embed) return; // a DESK panel only shows its board
    const c = gridCmd({ tokens: tokens(), range });
    if (!ctx.embed) {
      try { window.history.replaceState({ ...(window.history.state || {}), c }, '', ctx.toQuery(c)); } catch { /* the URL stays as it was */ }
    }
    saveLast();
  }

  // ---- data ----
  let gen = 0; // a range switch drops answers for the old range
  let note = args.dropped ? `KEPT THE FIRST ${GRID_MAX} TILES` : ''; // the status line after a load
  async function load(list, { again = true } = {}) {
    if (!list.length) return;
    const my = gen;
    const r = range;
    let d;
    try {
      d = await getGrid(`/api/grid?${new URLSearchParams({ s: list.join(','), r })}`, { signal: ctx.signal });
    } catch (err) {
      if (err.name === 'AbortError' || my !== gen) return;
      ctx.status(err.status === 429 ? 'GRID: A LOT OF BOARDS. TRY AGAIN IN A MINUTE' : 'GRID: NO DATA', 'warn');
      for (const t of list) if (!data.get(t) || data.get(t).error) data.set(t, { token: t, error: 'unavailable' });
      if (again) later(() => load(list, { again: false }), RETRY_MS);
      else for (const t of list) if (data.get(t)?.error) data.set(t, { token: t, error: 'no_data' });
      drawBoard();
      return;
    }
    if (my !== gen) return;
    for (const t of d.tiles || []) {
      // A second try that failed keeps a tile it had, else says NO DATA.
      if (t.error && data.get(t.token) && !data.get(t.token).error) continue;
      data.set(t.token, !again && RETRY.includes(t.error) ? { ...t, error: 'no_data' } : t);
    }
    drawBoard();
    ctx.updated?.(d.updated, false);
    const failed = (d.tiles || []).filter((t) => RETRY.includes(t.error)).map((t) => t.token);
    if (again && failed.length) later(() => load(failed, { again: false }), RETRY_MS);
    ctx.status(note, note ? 'warn' : '');
  }
  const missing = () => tokens().filter((t) => !data.has(t));

  // ---- edits ----
  function tell(text) { note = ''; ctx.status(text, 'warn'); }
  // Is there room for one more tile?
  function room() {
    if (items.length >= GRID_MAX) { tell(`A BOARD HOLDS ${GRID_MAX} TILES`); return false; }
    return true;
  }
  function add(text) {
    if (ctx.embed) return false;
    const words = String(text).trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
    const added = [];
    for (const w of words) {
      const it = gridItem(w);
      if (!it) continue;
      if (items.some((x) => x.token === it.token)) { tell(`${it.token} IS ON THE BOARD`); continue; }
      if (!room()) break;
      items.push(it);
      added.push(it.token);
    }
    if (!added.length) return false;
    commit();
    drawAll();
    load(added);
    return true;
  }
  function swap(i, text) {
    if (ctx.embed) return false;
    const it = gridItem(String(text).trim().split(/[\s,]+/)[0]);
    if (!it || !items[i]) return false;
    if (it.token === items[i].token) return true;
    if (items.some((x, j) => j !== i && x.token === it.token)) { tell(`${it.token} IS ON THE BOARD`); return false; }
    items[i] = it;
    commit();
    drawAll();
    if (!data.has(it.token)) load([it.token]);
    return true;
  }
  function remove(i) {
    if (ctx.embed || !items[i]) return;
    items.splice(i, 1);
    if (openAt === i) openAt = -1; else if (openAt > i) openAt -= 1;
    commit();
    drawAll();
    const next = board.querySelector(`.gr-tile[data-i="${Math.min(i, items.length - 1)}"]`) || board.querySelector('.gr-in');
    next?.focus({ preventScroll: true });
  }
  function setBoard(list) {
    items = list.map(gridItem).filter(Boolean).slice(0, GRID_MAX);
    openAt = -1;
    commit();
    drawAll();
    load(missing());
  }
  function setRange(r) {
    if (r === range || !PRESETS.includes(r)) return;
    range = r;
    gen += 1;
    data.clear();
    commit();
    drawAll();
    load(tokens());
  }
  function openTile(i) {
    const c = openCmd(items[i], range);
    if (c) ctx.run(c);
  }
  function toggleRow(i) {
    openAt = openAt === i ? -1 : i;
    board.querySelectorAll('.gr-tile[data-i]').forEach((n) => n.classList.toggle('is-open', Number(n.dataset.i) === openAt));
    drawCharts();
  }
  async function copyLink() {
    const ok = await ctx.copy(shareLinks(tokens(), range, origin).url);
    if (ok) toast('Link copied');
    else tell('COPY THE LINK FROM THE ADDRESS BAR');
  }

  // "/": the tile's word turns into a small input, prefilled and selected. Enter swaps it.
  function startSwap(i) {
    const node = board.querySelector(`.gr-tile[data-i="${i}"]`);
    const sym = node?.querySelector('.gr-sym');
    if (!sym || node.querySelector('.gr-swap-in')) return;
    const input = document.createElement('input');
    input.className = 'gr-in gr-swap-in';
    input.type = 'text';
    input.maxLength = 24;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', `Swap ${sym.textContent} for another tile`);
    input.value = items[i]?.token || '';
    sym.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (!(ok && swap(i, input.value))) { drawBoard(); node.isConnected ? node.focus() : board.querySelector(`.gr-tile[data-i="${i}"]`)?.focus(); }
      else board.querySelector(`.gr-tile[data-i="${i}"]`)?.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(false));
  }

  // ---- events ----
  chipsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-starter')) setBoard(GRID_STARTER);
    else if (b.dataset.range) setRange(b.dataset.range);
  });
  shareEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-copy]')) { e.preventDefault(); copyLink(); }
  });
  board.addEventListener('click', (e) => {
    if (e.target.closest('.gr-open')) return; // a data-cmd link: the page runs it
    const node = e.target.closest('.gr-tile');
    if (!node) return;
    if (node.classList.contains('gr-add')) { node.querySelector('.gr-in')?.focus(); return; }
    const i = Number(node.dataset.i);
    if (ctx.embed && e.target.closest('[data-x], [data-swap]')) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.target.closest('[data-x]')) { e.preventDefault(); e.stopPropagation(); remove(i); return; }
    const to = e.target.closest('[data-swap]');
    if (to) { e.preventDefault(); e.stopPropagation(); swap(i, to.dataset.swap); return; }
    if (e.target.closest('input')) return;
    if (phone()) toggleRow(i);
    else openTile(i);
  });
  board.addEventListener('keydown', (e) => {
    const input = e.target.closest?.('.gr-add .gr-in');
    if (!input) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      if (add(input.value)) board.querySelector('.gr-add .gr-in')?.focus({ preventScroll: true });
    } else if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); input.value = ''; }
  });

  const stopKeys = sceneKeys(scene, (e) => {
    // Only with the focus inside the board: on the page itself the keys scroll as usual.
    const active = document.activeElement;
    const inScene = Boolean(active && scene.contains(active));
    const nodes = [...board.querySelectorAll('.gr-tile')];
    const cur = inScene ? nodes.indexOf(active.closest('.gr-tile')) : -1;
    const tileAt = cur >= 0 && nodes[cur].dataset.i !== undefined ? Number(nodes[cur].dataset.i) : -1;
    const act = boardKeyAction(e.key, { inScene, tileAt, embed: ctx.embed, phone: phone(), shift: e.shiftKey });
    if (act === 'move') {
      const cols = phone() ? 1 : (getComputedStyle(board).gridTemplateColumns.split(' ').filter(Boolean).length || 1);
      const next = nodes[stepIndex(cur, e.key, cols, nodes.length)];
      if (next?.classList.contains('gr-add')) next.querySelector('.gr-in')?.focus(); else next?.focus();
      return Boolean(next);
    }
    if (act === 'open') openTile(tileAt);
    else if (act === 'toggle') toggleRow(tileAt);
    else if (act === 'remove') remove(tileAt);
    else if (act === 'swap') startSwap(tileAt);
    else if (act === 'copy') copyLink();
    return Boolean(act);
  });
  ctx.onCleanup(stopKeys);

  // Charts are drawn at their real size: again when the board changes size.
  let raf = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawCharts); }) : null;
  ro?.observe(board);
  const onPhone = () => { openAt = -1; drawBoard(); };
  phoneMq?.addEventListener?.('change', onPhone);
  ctx.onCleanup(() => { ro?.disconnect(); cancelAnimationFrame(raf); phoneMq?.removeEventListener?.('change', onPhone); });

  // ---- first draw ----
  saveLast();
  drawAll();
  if (note) ctx.status(note, 'warn');
  load(tokens());
}

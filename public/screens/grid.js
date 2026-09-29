// GRID: a board of up to 16 mini charts. One tile template: the symbol and its short
// name, one number, its change as coloured text (never boxed), and a small line (or "no
// chart yet"). The high and the low are on hover (the tile's title) and in the full chart.
// /api/grid (lib/grid.js) sends every tile of a board in one answer; the words it takes
// are in command-args.js (parseGrid).
//
//   GRID                   your last board, else the starter board (1D)
//   GRID NVDA AMD INTC 1Y  those tiles over 1Y
//   GRID STARTER           the starter board
//
// Live: every TICK_MS one /api/quotes call for all the market tiles moves each tile's
// value, change and the end of its line (applyQuote); on 1D and 5D the board asks
// /api/grid again every REFETCH_MS for the real bars (1-minute on 1D, 5-minute on 5D).
// Both go through the shell's ctx.live (paused while the tab is hidden or a DESK panel
// is off screen), never two at once, and skip a turn after an error (guarded). BBRK's
// "here now" comes from /api/live, the top bar's own source: at once when the tile loads,
// then every minute. CPI, W: and RIP: tiles do not tick.
//
// The strip: the range chips switch every tile in place (the URL follows); STARTER brings
// the starter board back; COPY LINK and POST ON X are text links; + TILE and EDIT sit at
// its right end, like DESK's + PANEL and EDIT. + TILE goes to the + tile's input. EDIT
// shows every tile's x (remove), and a click on a tile swaps its word. A click or Enter
// opens a tile's own screen; arrows move between tiles; Alt+Arrows move the tile itself;
// Delete removes one; / swaps its word; C copies the board's link. On a phone the tiles
// are two to a row, the long name left out. "Prices may be delayed." is said once, in the
// panel's title strip. In a DESK panel (embed) the board alone fills the panel: no strip,
// no + tile, no note.
// Free for everyone. The link is the save: the whole board is in the URL. This browser
// keeps the last board (LAST_KEY); with Pro it syncs like DESK layouts (pro.js SYNC_DOCS).

import { esc, q, fmtNum, fmtPct, dirOf } from './markets.js';
import { PRESETS, nyToday } from '../ranges.js';
import { GRID_LAST_KEY } from '../pro.js';
import { HERE_MIN } from '../here-now.js';
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

// BBRK's "here now", by the top bar's rule (here-now.js): a number from HERE_MIN up; under
// it (most likely the viewer alone) said in words, never a bare 0; unknown: nothing.
export function hereWords(n) {
  if (!Number.isInteger(n) || n < 0) return '';
  return n >= HERE_MIN ? `${fmtNum(n, 0)} here now` : 'no one else here';
}

// What the tile says: { big, text, stale, pill, pillDir, chg, chgDir, msg } from the
// server's tile (or none yet). big: the one number; chg and chgDir: the change beside it,
// coloured text (up, down, flat); pill and pillDir: the same for the share card
// (lib/og-grid.js), which draws it boxed.
export function tileFace(item, tile) {
  if (!tile) return { msg: 'LOADING...' };
  if (tile.error === 'not_found' || item.kind === 'unknown') return { msg: 'NO SUCH TICKER', suggest: tile.suggest || item.suggest || null };
  if (tile.error) return { msg: RETRY.includes(tile.error) ? 'LOADING...' : 'NO DATA' };
  switch (tile.kind) {
    case 'weird': return { big: tile.hero || tile.headline || '--', text: true, stale: Boolean(tile.stale), chg: '', chgDir: 'flat' };
    case 'rip': {
      const paid = Number.isFinite(tile.final) && tile.final > 0;
      return { big: paid ? `$${fmtNum(tile.final, 2)}` : tile.what || 'GONE', text: !paid, pill: 'RIP', pillDir: 'rip', chg: 'RIP', chgDir: 'down' };
    }
    case 'bbrk': {
      const v = tile.views7;
      return {
        big: Number.isInteger(v) ? (v > 0 ? fmtNum(v, 0) : 'none yet') : '--', text: v === 0, pill: '7D', pillDir: 'flat',
        chg: hereWords(tile.here), chgDir: 'flat',
      };
    }
    default: {
      const pill = fmtPct(tile.changePct);
      const dir = dirOf(tile.changePct);
      return { big: fmtValue(tile.last, tile.decimals, tile.unit), pill, pillDir: dir, chg: Number.isFinite(tile.changePct) ? pill : '', chgDir: dir, stale: Boolean(tile.stale) };
    }
  }
}

// The tile's title (on hover): what the line holds that the tile does not print. A
// market or CPI tile: its high and its low; a stone: its marks; BBRK: what it counts.
export function hoverText(tile) {
  if (!tile || tile.error) return '';
  if (tile.kind === 'bbrk') return 'Page views this week. The line: visitors a day, the last 30 days.';
  if (tile.kind === 'weird') return tile.name || '';
  return marksFor(tile).map((m) => m.text.replace(/^H /, 'High ').replace(/^L /, 'Low ')).join(' · ');
}

// One tile, the same markup on every screen size (grid.css). i: its place; range: its
// command's range.
export function tileHtml(item, tile, { i = 0, range = GRID_RANGE } = {}) {
  const f = tileFace(item, tile);
  const sym = label(item, tile);
  const name = tile?.name || '';
  const cmd = openCmd(item, range);
  // CPI is monthly: under a year it shows a year, and says so.
  const own = tile?.kind === 'cpi' && !tile.error && tile.range && tile.range !== range ? `<span class="gr-rng">${esc(tile.range)}</span>` : '';
  const dym = f.suggest ? `<p class="gr-dym">Did you mean <button type="button" class="gr-swapto" data-swap="${esc(f.suggest)}">${esc(f.suggest)}</button>?</p>` : '';
  const chg = `<span class="gr-chg num ${esc(f.chgDir || 'flat')}">${esc(f.chg || '')}</span>`;
  const body = f.msg
    ? `<div class="gr-hero"><span class="gr-msg">${esc(f.msg)}</span></div>${dym}`
    : `<div class="gr-hero"><span class="gr-big num${f.text ? ' is-text' : ''}${f.stale ? ' is-stale' : ''}">${esc(f.big)}</span>${chg}${own}</div><div class="gr-chart"></div>`;
  const kind = tile?.kind && tile.kind !== 'unknown' ? tile.kind : item.kind;
  const hover = hoverText(tile);
  return `<div class="gr-tile is-${esc(kind)}" data-i="${i}" data-token="${esc(item.token)}" tabindex="0"${hover ? ` title="${esc(hover)}"` : ''} aria-label="${esc(`${sym}${name ? `, ${name}` : ''}${cmd ? '. Enter opens it' : ''}`)}">
    <div class="gr-head"><span class="gr-sym">${esc(sym)}</span><span class="gr-name">${esc(name)}</span></div>
    ${body}
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

// The strip's right end, DESK's words in DESK's place (desk.js: + PANEL, EDIT): + TILE
// goes to the + tile, EDIT shows every x and makes a click swap (DONE ends it).
export const NO_CHART = 'no chart yet';
export const EDIT_HINT = 'Click a tile to swap it, x removes it, Alt+Arrows move it.';
export function editButtons(editing = false) {
  return `<button type="button" class="desk-btn gr-add-btn" data-add>+ TILE</button><button type="button" class="desk-btn gr-edit" data-edit aria-pressed="${editing}">${editing ? 'DONE' : 'EDIT'}</button>`;
}
// COPY LINK and POST ON X: text links, not keys (no boxes).
export function shareHtml(links) {
  return `<button type="button" class="gr-link" data-copy>COPY LINK</button><span class="gr-dot-sep" aria-hidden="true">·</span><a class="gr-link" href="${esc(links.x)}" target="_blank" rel="noopener noreferrer">POST ON X</a>`;
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
    // Alt passes only with an arrow (Alt+Arrows move a tile, as on DESK).
    if (ev.metaKey || ev.ctrlKey || (ev.altKey && !String(ev.key).startsWith('Arrow'))) return;
    const t = ev.target;
    if (t?.id === 'cmd') {
      if (ev.altKey) return;
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

// A key on the board -> what it does: move, reorder, open, remove, swap, copy, or null
// (not ours). inScene: the focus is inside the board; tileAt: the focused tile's place
// (-1: none). A DESK panel (embed) only shows its board: no remove, no swap, no reorder.
export function boardKeyAction(key, { inScene = false, tileAt = -1, embed = false, phone = false, shift = false, alt = false } = {}) {
  if (!inScene) return null;
  if (key.startsWith('Arrow')) {
    if (alt) return !embed && !shift && tileAt >= 0 ? 'reorder' : null;
    return shift ? null : 'move';
  }
  if (alt) return null;
  if (key === 'Enter' && tileAt >= 0) return 'open';
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

// ---- Live: quote ticks, refetches -----------------------------------------------------------

// One /api/quotes call for the board's market tiles. The server keeps a quote 15 s, so a
// new one shows here within about 8 s.
export const TICK_MS = 8_000;
export const REFETCH_MS = 60_000; // /api/grid again, 1D and 5D only (the real bars)
export const HERE_MS = 60_000; // BBRK's here now (/api/live)
export const FLASH_MS = 700;
// The bar a tick fills: 1D draws 1-minute bars (lib/grid.js GRID_BARS), 5D 5-minute bars.
export const BUCKET_MS = { '1D': 60_000, '5D': 5 * 60_000 };
export const INTRADAY = ['1D', '5D'];
export const isIntraday = (range) => INTRADAY.includes(range);
const WEEK_MS = 7 * 86_400_000;

// The time a quote is for: its asOf read the way QUOTE reads it (screens/quote.js liveOf:
// a date and time, with its offset, "2026-09-28T10:12:35.937-0400"), never later than
// now; null when there is none or it does not read (unknown, never "now").
export function quoteTime(quote, now = Date.now()) {
  const s = typeof quote?.asOf === 'string' ? quote.asOf : '';
  const t = Date.parse(s);
  return Number.isFinite(t) && /T/.test(s) ? Math.min(t, now) : null;
}

// Where time t falls against the bar at lastT, for this range's bars: 1 a later bar, 0 the
// same bar, -1 an earlier one. 1D: 1-minute bars; 5D: 5-minute bars; up to 2Y: New York
// days; 5Y, 10Y: weeks; MAX: months.
export function barStep(lastT, t, range) {
  const cmp = (a, b) => (a > b ? 1 : a < b ? -1 : 0);
  const b = BUCKET_MS[range];
  if (b) return cmp(Math.floor(t / b), Math.floor(lastT / b));
  if (range === '5Y' || range === '10Y') return t - lastT >= WEEK_MS ? 1 : t < lastT ? -1 : 0;
  const day = (ms) => nyToday(new Date(ms));
  if (range === 'MAX') return cmp(day(t).slice(0, 7), day(lastT).slice(0, 7));
  return cmp(day(t), day(lastT));
}

// A market tile and a quote for it -> the tile moved to the quote, or null when nothing
// changed (or the tile does not tick). The value is the quote's; the line's last point
// takes it (a new point when the quote starts a new bar: a new minute on 1D, a new
// 5-minute bucket on 5D, a new day on the daily ranges); the high and the low follow.
// A quote older than the line's last bar is no news (null: the value never goes back);
// one with no time it can read only ever updates the last point, never adds one.
// The change: on 1D the quote's own day change (vs the previous close, as QUOTE shows);
// on longer ranges vs the first point of the range.
export function applyQuote(tile, quote, range, { now = Date.now() } = {}) {
  if (!tile || tile.error || tile.kind !== 'market' || !quote) return null;
  const v = quote.last;
  const pts = tile.points || [];
  if (!Number.isFinite(v) || pts.length < 2) return null;
  const t = quoteTime(quote, now);
  const end = pts[pts.length - 1];
  const step = t === null ? 0 : barStep(end.t, t, range);
  if (step < 0) return null;
  let points = pts;
  const bucket = BUCKET_MS[range];
  if (step > 0) points = [...pts, { t: bucket ? Math.floor(t / bucket) * bucket : t, v }];
  else if (step === 0 && end.v !== v) points = [...pts.slice(0, -1), { t: end.t, v }];
  const first = points[0].v;
  const own = first > 0 ? (v / first - 1) * 100 : null;
  const changePct = range === '1D' && Number.isFinite(quote.changePct) ? quote.changePct : Number.isFinite(own) ? own : tile.changePct ?? null;
  const stale = Boolean(quote.stale);
  if (points === pts && v === tile.last && changePct === tile.changePct && stale === Boolean(tile.stale)) return null;
  let hi = points[0];
  let lo = points[0];
  for (const p of points) { if (p.v > hi.v) hi = p; if (p.v < lo.v) lo = p; }
  const next = { ...tile, last: v, changePct, points, hi: { v: hi.v, t: hi.t }, lo: { v: lo.v, t: lo.t } };
  if (stale) next.stale = true; else delete next.stale;
  return next;
}

// The flash on a changed number: up or down for FLASH_MS, none when the value is the same
// or the viewer asked for less motion.
export function flashClass(prev, next, { reduced = false } = {}) {
  if (reduced || !Number.isFinite(prev) || !Number.isFinite(next) || prev === next) return '';
  return next > prev ? 'gr-flash-up' : 'gr-flash-down';
}

// fn -> run(): never two runs at once (a run while one is out is skipped: 'busy'), and a
// run that failed backs off: the next turn is skipped ('skipped'), the next two after a
// 429. -> 'ok' | 'busy' | 'skipped' | 'error' | 'aborted'.
export function guarded(fn) {
  let busy = false;
  let skip = 0;
  return async function run() {
    if (busy) return 'busy';
    if (skip > 0) { skip -= 1; return 'skipped'; }
    busy = true;
    try {
      await fn();
      return 'ok';
    } catch (err) {
      if (err?.name === 'AbortError') return 'aborted';
      skip = err?.status === 429 ? 2 : 1;
      return 'error';
    } finally {
      busy = false;
    }
  };
}

// The refetch backs off while nothing moves (a weekend, a night): after a refetch where
// every tile came back the same, the wait doubles, up to REFETCH_MAX_MS; anything new, or
// anything the viewer does, brings it back to REFETCH_MS.
export const REFETCH_MAX_MS = 10 * 60_000;
export const nextRefetchWait = (wait, outcome) => (outcome === 'same' ? Math.min(wait * 2, REFETCH_MAX_MS) : outcome === 'changed' ? REFETCH_MS : wait);

// The screen's timers, all through ctx.live (paused while hidden or off screen), set up
// once: the quote tick, the 1D/5D refetch (with its back-off) and BBRK's here now.
// refetch() -> 'changed' | 'same' | anything else (busy, skipped, error: the wait stays).
// Returns { poke() }: the viewer did something, the refetch wait is back to REFETCH_MS.
export function startLive(ctx, { tick, refetch, hereNow, intraday = () => false, hasBbrk = () => false }) {
  let wait = REFETCH_MS;
  let turns = 0; // REFETCH_MS turns since the last refetch
  ctx.live(tick, TICK_MS);
  ctx.live(async () => {
    if (!intraday()) return;
    turns += 1;
    if (turns * REFETCH_MS < wait) return;
    turns = 0;
    wait = nextRefetchWait(wait, await refetch());
  }, REFETCH_MS);
  ctx.live(() => { if (hasBbrk()) hereNow(); }, HERE_MS);
  return {
    poke() { wait = REFETCH_MS; turns = 0; },
    get wait() { return wait; },
  };
}

// The session a quote's time falls in, by the New York clock: its day, and whether a
// weekday's regular session (9:30) has begun. null for a quote with no time it can read.
const NY_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
export function sessionMark(quote) {
  const t = quoteTime(quote, Infinity);
  if (t === null) return null;
  const n = Object.fromEntries(NY_CLOCK.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const open = !['Sat', 'Sun'].includes(n.weekday) && Number(n.hour) * 60 + Number(n.minute) >= 570;
  return `${n.year}-${n.month}-${n.day}${open ? ' open' : ''}`;
}
// A new quote in a new New York day, or past 9:30 on a weekday: the refetch that backed
// off overnight comes back to every minute (startLive poke).
export function sessionMoved(prev, next) {
  const a = sessionMark(prev);
  const b = sessionMark(next);
  return a !== null && b !== null && a !== b;
}

// ---- The screen -----------------------------------------------------------------------------

export const FETCH_TIMEOUT_MS = 10_000;
const timeoutError = () => (typeof DOMException === 'function' ? new DOMException('The request timed out.', 'TimeoutError') : Object.assign(new Error('The request timed out.'), { name: 'TimeoutError' }));

// GET JSON, given up after timeoutMs (a hung request never holds a guard): the error has
// the answer's status (429...). AbortSignal.any and .timeout where the browser has both;
// else one AbortController with a timer, the timer and the listener on the screen's
// signal removed once the answer is in. native: false tries the second way (tests).
export async function getJSON(url, { signal, timeoutMs = FETCH_TIMEOUT_MS, fetchImpl = globalThis.fetch, native = true } = {}) {
  let sig;
  let done = () => {};
  if (native && typeof AbortSignal.timeout === 'function' && typeof AbortSignal.any === 'function') {
    sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  } else {
    const c = new AbortController();
    const onAbort = () => c.abort(signal.reason);
    const timer = setTimeout(() => c.abort(timeoutError()), timeoutMs);
    if (signal?.aborted) c.abort(signal.reason);
    else signal?.addEventListener('abort', onAbort, { once: true });
    sig = c.signal;
    done = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
  }
  try {
    const res = await fetchImpl(url, { signal: sig, headers: { Accept: 'application/json' } });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (!res.ok) throw Object.assign(new Error(body?.message || 'Data is taking a break.'), { status: res.status });
    return body;
  } finally {
    done();
  }
}

export function render(el, cmd, ctx) {
  const args = cmd.args?.items ? cmd.args : parse([]);
  const store = ctx.store;
  const phoneMq = typeof window === 'object' ? window.matchMedia?.(PHONE_MQ) : null;
  const phone = () => Boolean(phoneMq?.matches) && !ctx.embed; // a DESK panel keeps tiles
  const reducedMq = typeof window === 'object' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : null;
  const last = cleanBoard(store?.get(LAST_KEY, null));

  let range = args.range;
  let items;
  if (args.bare) {
    items = (last ? last.tokens : GRID_STARTER).map(gridItem).filter(Boolean);
    if (!args.rangeGiven && last) range = last.range;
  } else items = args.items.slice();

  const data = new Map(); // token -> the server's tile, for this range
  let editing = false; // EDIT: every x shows, a click swaps
  const timers = new Set();
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  ctx.onCleanup(() => { for (const id of timers) clearTimeout(id); });

  el.innerHTML = `<section class="panel panel-solo gr-panel${ctx.embed ? ' is-embed' : ''}">
    <header class="panel-head"><h2 class="panel-label">1) GRID</h2><span class="panel-meta gr-meta">${ctx.embed ? '' : esc(NOTE_LINE)}</span></header>
    <div class="panel-body flush gr-body">
      <div class="gr-bar"><div class="gr-chips"></div><span class="gr-hint">${esc(EDIT_HINT)}</span><div class="gr-share"></div></div>
      <div class="gr-scene"><div class="gr-board"></div></div>
      <div class="gr-toast" role="status" aria-live="polite"></div>
    </div>
  </section>`;
  const scene = el.querySelector('.gr-scene');
  const board = el.querySelector('.gr-board');
  const chipsEl = el.querySelector('.gr-chips');
  const shareEl = el.querySelector('.gr-share');
  const panelEl = el.querySelector('.gr-panel');
  const toastEl = el.querySelector('.gr-toast');
  const tokens = () => items.map((i) => i.token);
  const origin = typeof location === 'object' ? location.origin : 'https://bloombroke.com';

  // ---- drawing ----
  function drawBar() {
    const t = tokens();
    chipsEl.innerHTML = `${rangeChips(range)}${starterButton(t)}`;
    shareEl.innerHTML = `${shareHtml(shareLinks(t, range, origin))}${ctx.embed ? '' : editButtons(editing)}`;
  }
  // The small line, drawn at the chart box's size; a tile with no points says so.
  function drawTileCharts(node) {
    const item = items[Number(node.dataset.i)];
    const tile = item && data.get(item.token);
    const host = node.querySelector('.gr-chart');
    if (!host) return;
    const pts = tile && !tile.error && Array.isArray(tile.points) && tile.points.length > 1 ? tile.points : null;
    if (!pts) { host.innerHTML = `<p class="gr-nochart">${esc(NO_CHART)}</p>`; return; }
    const dir = tile.kind === 'rip' ? 'down' : dirOf(tile.changePct);
    const w = Math.floor(host.clientWidth);
    const h = Math.floor(host.clientHeight);
    host.innerHTML = w > 8 && h > 8 ? gridSparkSvg(pts, { w, h, dir, byTime: Boolean(tile.xByTime), pad: 4 }) : '';
  }
  function drawCharts() {
    board.querySelectorAll('.gr-tile[data-i]').forEach(drawTileCharts);
  }
  // One tile again, in place (a tick, a refetch): its numbers and its line, not the board.
  // A tile that had no numbers yet (LOADING, NO DATA) is drawn anew, unless its word is
  // being swapped. prev: the tile before, for the flash.
  function patchTile(i, prev) {
    const node = board.querySelector(`.gr-tile[data-i="${i}"]`);
    const item = items[i];
    if (!node || !item) return;
    const tile = data.get(item.token);
    const f = tileFace(item, tile);
    const big = node.querySelector('.gr-big');
    if (f.msg || !big) {
      if (node.querySelector('.gr-swap-in')) return;
      const had = document.activeElement === node;
      node.outerHTML = tileHtml(item, tile, { i, range });
      const fresh = board.querySelector(`.gr-tile[data-i="${i}"]`);
      if (fresh) { drawTileCharts(fresh); if (had) fresh.focus({ preventScroll: true }); }
      return;
    }
    big.textContent = f.big;
    big.classList.toggle('is-stale', Boolean(f.stale));
    big.classList.toggle('is-text', Boolean(f.text));
    const chg = node.querySelector('.gr-hero .gr-chg');
    if (chg) { chg.textContent = f.chg || ''; chg.className = `gr-chg num ${f.chgDir || 'flat'}`; }
    const hover = hoverText(tile);
    if (hover) node.title = hover; else node.removeAttribute('title');
    const fl = flashClass(prev?.last, tile?.last, { reduced: Boolean(reducedMq?.matches) });
    if (fl) {
      big.classList.remove('gr-flash-up', 'gr-flash-down');
      big.classList.add(fl);
      later(() => big.classList.remove(fl), FLASH_MS);
    }
    drawTileCharts(node);
  }
  function drawBoard() {
    const had = document.activeElement;
    const focusAt = had && board.contains(had) ? (had.closest('.gr-tile')?.dataset.i ?? (had.closest('.gr-add') ? 'add' : null)) : null;
    const withAdd = !ctx.embed && items.length < GRID_MAX;
    const { cols, rows } = layoutFor(items.length + (withAdd ? 1 : 0));
    board.className = `gr-board gr-c${cols} gr-r${rows}`;
    board.innerHTML = items.map((it, i) => tileHtml(it, data.get(it.token), { i, range })).join('') + (withAdd ? addTileHtml() : '');
    drawCharts();
    if (focusAt === 'add') board.querySelector('.gr-in')?.focus({ preventScroll: true });
    else if (focusAt !== null) (board.querySelector(`.gr-tile[data-i="${focusAt}"]`) || board.querySelector('.gr-tile'))?.focus({ preventScroll: true });
  }
  function drawAll() { drawBar(); drawBoard(); }

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
  let liveCtl = null; // startLive, below
  function commit() {
    if (ctx.embed) return; // a DESK panel only shows its board
    liveCtl?.poke(); // the viewer did something: the refetch is back to every minute
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
      d = await getJSON(`/api/grid?${new URLSearchParams({ s: list.join(','), r })}`, { signal: ctx.signal });
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
      takeQuote(t.token, { patch: false }); // the last quote seen moves it on at once
    }
    drawBoard();
    // BBRK's here now from the top bar's own source (/api/live), at once, not a minute later.
    if ((d.tiles || []).some((t) => t.kind === 'bbrk' && !t.error)) hereNow();
    // A market tile with no quote yet (the first load, an added tile): ask now, not a tick later.
    if ((d.tiles || []).some((t) => t.kind === 'market' && !t.error && !quotes.has(t.token))) tick();
    ctx.updated?.(d.updated, false);
    const failed = (d.tiles || []).filter((t) => RETRY.includes(t.error)).map((t) => t.token);
    if (again && failed.length) later(() => load(failed, { again: false }), RETRY_MS);
    ctx.status(note, note ? 'warn' : '');
  }
  const missing = () => tokens().filter((t) => !data.has(t));

  // ---- live ----
  const quotes = new Map(); // token -> the last quote seen, for any range
  const marketTokens = () => items.filter((it) => it.kind === 'market').map((it) => it.token);
  const indexOf = (token) => items.findIndex((it) => it.token === token);
  // The last quote seen, on its tile (applyQuote), patched in place.
  function takeQuote(token, { patch = true } = {}) {
    const prev = data.get(token);
    const next = applyQuote(prev, quotes.get(token), range);
    if (!next) return false;
    data.set(token, next);
    if (patch && indexOf(token) >= 0) patchTile(indexOf(token), prev);
    return true;
  }
  // Every TICK_MS: one /api/quotes call for the board's market tiles.
  const tick = guarded(async () => {
    const list = marketTokens();
    if (!list.length) return;
    const d = await getJSON(`/api/quotes?${new URLSearchParams({ s: list.join(',') })}`, { signal: ctx.signal });
    let newSession = false; // a new New York day, or the open: the refetch back to every minute
    for (const qt of d?.quotes || []) {
      if (!qt?.ticker) continue;
      if (sessionMoved(quotes.get(qt.ticker), qt)) newSession = true;
      quotes.set(qt.ticker, qt);
    }
    if (newSession) liveCtl?.poke();
    for (const t of list) takeQuote(t);
    if (d?.updated) ctx.updated?.(d.updated, Boolean(d.stale));
  });
  const sameTile = (a, b) => {
    if (!a || !b || a.error || b.error || a.last !== b.last || a.changePct !== b.changePct || Boolean(a.stale) !== Boolean(b.stale)) return false;
    const [pa, pb] = [a.points || [], b.points || []];
    if (pa.length !== pb.length || !pa.length) return pa.length === pb.length;
    const [a0, b0, a1, b1] = [pa[0], pb[0], pa[pa.length - 1], pb[pb.length - 1]];
    return a0.t === b0.t && a0.v === b0.v && a1.t === b1.t && a1.v === b1.v;
  };
  // On 1D and 5D (startLive: every REFETCH_MS, less often while nothing moves): the
  // market tiles' real bars, on the live bucket (?live=1). A tile that fails now keeps
  // what it had; only the tiles that changed are drawn again.
  let moved = true; // the last refetch brought something new
  const refetchOnce = guarded(async () => {
    moved = true;
    const list = marketTokens();
    if (!list.length || !isIntraday(range)) return;
    const my = gen;
    const r = range;
    const d = await getJSON(`/api/grid?${new URLSearchParams({ s: list.join(','), r, live: '1' })}`, { signal: ctx.signal });
    if (my !== gen) return;
    moved = false;
    for (const t of d?.tiles || []) {
      if (t.error || indexOf(t.token) < 0) continue;
      const prev = data.get(t.token);
      const next = applyQuote(t, quotes.get(t.token), r) || t;
      data.set(t.token, next);
      if (!sameTile(prev, next)) { moved = true; patchTile(indexOf(t.token), prev); }
    }
    if (d?.updated) ctx.updated?.(d.updated, false);
  });
  const refetch = async () => { const r = await refetchOnce(); return r === 'ok' ? (moved ? 'changed' : 'same') : r; };
  // Every HERE_MS with a BBRK tile: its "here now" (/api/live, cached on the server).
  const hereNow = guarded(async () => {
    const had = data.get('BBRK');
    if (!had || had.error) return;
    const d = await getJSON('/api/live', { signal: ctx.signal });
    const cur = data.get('BBRK');
    if (!Number.isInteger(d?.here) || !cur || cur.error || cur.here === d.here) return;
    data.set('BBRK', { ...cur, here: d.here });
    if (indexOf('BBRK') >= 0) patchTile(indexOf('BBRK'), cur);
  });

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
    commit();
    drawAll();
    const next = board.querySelector(`.gr-tile[data-i="${Math.min(i, items.length - 1)}"]`) || board.querySelector('.gr-in');
    next?.focus({ preventScroll: true });
  }
  function setBoard(list) {
    items = list.map(gridItem).filter(Boolean).slice(0, GRID_MAX);
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
  // Alt+Arrows: the tile trades places with its neighbour that way (the board's order is
  // its link, so the URL and the last board follow).
  function moveTile(i, key) {
    if (ctx.embed || !items[i]) return false;
    const n = board.querySelectorAll('.gr-tile[data-i]').length;
    const j = stepIndex(i, key, boardCols(), n);
    if (j === i) return false;
    [items[i], items[j]] = [items[j], items[i]];
    commit();
    drawBoard();
    board.querySelector(`.gr-tile[data-i="${j}"]`)?.focus({ preventScroll: true });
    return true;
  }
  const boardCols = () => getComputedStyle(board).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
  // + TILE: to the + tile's input (a full board says so).
  function goAdd() {
    if (!room()) return;
    const input = board.querySelector('.gr-add .gr-in');
    input?.scrollIntoView?.({ block: 'nearest' });
    input?.focus({ preventScroll: true });
  }
  function setEditing(on) {
    editing = Boolean(on);
    panelEl.classList.toggle('is-editing', editing);
    const b = shareEl.querySelector('[data-edit]');
    if (b) { b.setAttribute('aria-pressed', String(editing)); b.textContent = editing ? 'DONE' : 'EDIT'; }
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
    else if (e.target.closest('[data-add]')) { e.preventDefault(); goAdd(); }
    else if (e.target.closest('[data-edit]')) { e.preventDefault(); setEditing(!editing); }
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
    if (editing && !ctx.embed) startSwap(i);
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
    const act = boardKeyAction(e.key, { inScene, tileAt, embed: ctx.embed, phone: phone(), shift: e.shiftKey, alt: e.altKey });
    if (act === 'move') {
      const next = nodes[stepIndex(cur, e.key, boardCols(), nodes.length)];
      if (next?.classList.contains('gr-add')) next.querySelector('.gr-in')?.focus(); else next?.focus();
      return Boolean(next);
    }
    if (act === 'reorder') return moveTile(tileAt, e.key) || true;
    if (act === 'open') openTile(tileAt);
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
  const onPhone = () => drawBoard();
  phoneMq?.addEventListener?.('change', onPhone);
  ctx.onCleanup(() => { ro?.disconnect(); cancelAnimationFrame(raf); phoneMq?.removeEventListener?.('change', onPhone); });

  // ---- first draw ----
  saveLast();
  drawAll();
  if (note) ctx.status(note, 'warn');
  load(tokens());
  // Live: set up once (ctx.live: paused while the tab is hidden or a DESK panel is off
  // screen); edits and range switches only poke it.
  liveCtl = startLive(ctx, {
    tick, refetch, hereNow,
    intraday: () => isIntraday(range),
    hasBbrk: () => items.some((it) => it.kind === 'bbrk'),
  });
}

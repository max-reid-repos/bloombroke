// DESK: the maths and the saved state behind the multi-panel workspace. A desk is a
// 12-column grid of panels { id, cmd, x, y, w, h, link, card? }, in grid units. Pure
// functions, so node:test can check them; screens/desk.js does the DOM.

export const COLS = 12;
export const DESK_COUNT = 4;
export const DESK_KEY = 'bb.desks';
export const DESK_VERSION = 1;
export const MAX_PANELS = 12;
export const MIN_W = 2;
export const MIN_H = 3;
export const MAX_H = 40;
export const LINKS = [null, 'blue', 'green'];
// The screens that show one ticker, so a linked panel can switch to another one.
export const TICKER_SCREENS = [
  'QUOTE', 'TICKERNEWS', 'PROFILE', 'VALUE', 'FINANCIALS', 'DIVIDENDS', 'BEATS', 'INSIDERS',
  'OWNERS', 'FILINGS', 'SHORTS', 'OPTIONS', 'HISTORY',
];
// Screens with a chart: a new panel for one is at least this many rows tall, so the
// chart keeps its x-axis.
export const CHART_SCREENS = ['QUOTE', 'COMPARE', 'CURVE', 'RATES', 'BONDS', 'FEDPATH', 'ECONOMY', 'BREADTH', 'SECTORS', 'HISTORY', 'DIVIDENDS', 'SHORTS'];
export const CHART_MIN_H = 10;

// Desk 1 out of the box: a big chart, the watchlist, news, the heatmap and markets.
export const DEFAULT_DESK = [
  { id: 'p1', cmd: 'AAPL 1D', x: 0, y: 0, w: 8, h: 9, link: 'blue' },
  { id: 'p2', cmd: 'WATCH', x: 8, y: 0, w: 4, h: 9, link: 'blue' },
  { id: 'p3', cmd: 'NEWS', x: 0, y: 9, w: 4, h: 7, link: null },
  { id: 'p4', cmd: 'HEATMAP', x: 4, y: 9, w: 5, h: 7, link: null },
  { id: 'p5', cmd: 'MARKETS', x: 9, y: 9, w: 3, h: 7, link: null },
];

// ---- Preset desks ------------------------------------------------------------------
// One click (the bar) or DESK WEIRD / MACRO / CRYPTO loads one into the desk on show.
// Each fills the 12 columns and the 16 rows that fit the window. card: true is a WEIRD
// gauge drawn as its tile (screens/desk-cards.js), not a framed screen.
const card = (cmd, x, y, w, h) => ({ cmd, x, y, w, h, card: true });
const pane = (cmd, x, y, w, h, link = null) => ({ cmd, x, y, w, h, link });
export const PRESETS = {
  WEIRD: [
    card('CANAL', 0, 0, 4, 4), card('PIZZA', 4, 0, 4, 4), card('DEGEN', 8, 0, 4, 4),
    card('WAFFLE', 0, 4, 4, 4), card('PANIC', 4, 4, 4, 4), card('BILLIONS', 8, 4, 4, 4),
    card('CHANCES', 0, 8, 4, 4), card('BOXRATE', 4, 8, 4, 4), card('EGGPRICE', 8, 8, 4, 4),
    card('HOTDOG', 0, 12, 4, 4), card('OMENS', 4, 12, 4, 4), card('WSB', 8, 12, 4, 4),
  ],
  MACRO: [
    pane('SPX 1Y', 0, 0, 6, 9), pane('CURVE', 6, 0, 3, 9), pane('NEWS MACRO', 9, 0, 3, 7),
    card('CHANCES', 9, 7, 3, 3), card('BEIGE', 9, 10, 3, 3), card('TRUCKS', 9, 13, 3, 3),
    pane('FXMATRIX', 0, 9, 5, 7), pane('CPI', 5, 9, 4, 7),
  ],
  CRYPTO: [
    pane('BTC 1D', 0, 0, 6, 9, 'blue'), pane('ETH 1D', 6, 0, 6, 9),
    pane('CRYPTO', 0, 9, 5, 7, 'blue'), pane('NEWS', 5, 9, 4, 7),
    card('DEGEN', 9, 9, 3, 4), card('WSB', 9, 13, 3, 3),
  ],
};
export const PRESET_NAMES = Object.keys(PRESETS);

// A preset as desk panels, with ids p1, p2, ...
export function presetPanels(name) {
  return (PRESETS[name] || []).map((p, i) => ({ id: `p${i + 1}`, link: null, ...p }));
}

// The panels as { cmd, x, y, w, h, card }, in stack order, to compare two layouts.
const shape = (panels) => stackOrder(panels).map((p) => `${p.cmd}|${p.x},${p.y},${p.w},${p.h}|${p.card ? 'card' : ''}`).join(';');

// True when a desk holds panels the user put there: anything but empty, desk 1 out of
// the box or an untouched preset. Loading a preset over them asks first.
export function hasUserPanels(panels) {
  if (!panels.length) return false;
  const now = shape(panels);
  return ![DEFAULT_DESK, ...PRESET_NAMES.map(presetPanels)].some((d) => shape(d) === now);
}

// Typed on DESK: +CANAL, + CANAL, +PANEL CANAL add a panel; + or +PANEL alone opens the
// picker. -> { cmd } (cmd '' for the picker) or null for anything else.
export function parseAdd(text) {
  const m = /^\+\s*(.*)$/.exec(String(text ?? '').replace(/\s+/g, ' ').trim().toUpperCase());
  if (!m) return null;
  const rest = m[1].replace(/^PANEL\b\s*/, '').trim();
  return { cmd: rest };
}

const int = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);

// Whole grid units, inside the 12 columns, at least MIN_W x MIN_H.
export function clampPanel(p) {
  const w = Math.max(MIN_W, Math.min(COLS, int(p.w, 6)));
  const h = Math.max(MIN_H, Math.min(MAX_H, int(p.h, 6)));
  const x = Math.max(0, Math.min(COLS - w, int(p.x, 0)));
  const y = Math.max(0, int(p.y, 0));
  return { ...p, x, y, w, h };
}

export function collides(a, b) {
  return a !== b && a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Settle a layout, top to bottom, left to right: a panel that overlaps one already
// placed moves down until it does not, then every panel floats up until something
// blocks it (it never jumps over a panel into a hole above it). With fixedId, that
// panel stays where it is (the one being dragged) and the others flow around it; a
// panel it lands on hops above it, or beside it, when there is room there, so a drag
// onto a neighbour swaps the two. Keeps the input order.
export function settle(panels, fixedId = null) {
  const fixed = panels.find((p) => p.id === fixedId);
  const placed = fixed ? [fixed] : [];
  const rest = panels.filter((p) => p !== fixed).sort((a, b) => a.y - b.y || a.x - b.x);
  const free = (probe) => !placed.some((q) => collides(probe, q));
  for (const p of rest) {
    const probe = { ...p, y: Math.max(0, Math.round(p.y)) };
    if (fixed && collides(probe, fixed)) {
      const hops = [
        { ...probe, y: fixed.y - p.h },
        { ...probe, x: fixed.x + fixed.w },
        { ...probe, x: fixed.x - p.w },
      ];
      const hop = hops.find((h) => h.y >= 0 && h.x >= 0 && h.x + h.w <= COLS && free(h));
      if (hop) Object.assign(probe, hop);
    }
    while (!free(probe)) probe.y += 1;
    while (probe.y > 0 && free({ ...probe, y: probe.y - 1 })) probe.y -= 1;
    placed.push(probe);
  }
  const byId = new Map(placed.map((p) => [p.id, p]));
  return panels.map((p) => byId.get(p.id));
}

const sameLayout = (a, b) => a.every((p, i) => p.x === b[i].x && p.y === b[i].y && p.w === b[i].w && p.h === b[i].h);

// Drop a panel at a grid spot: others flow around it while dragging (preview), and
// everything settles when it lands.
export function dragPreview(panels, id, spot) {
  return settle(panels.map((p) => (p.id === id ? clampPanel({ ...p, ...spot }) : p)), id);
}
export function dropAt(panels, id, spot) {
  return settle(dragPreview(panels, id, spot));
}

// Resize to w x h (grid units), then settle.
export function resizeTo(panels, id, size) {
  return settle(settle(panels.map((p) => (p.id === id ? clampPanel({ ...p, ...size }) : p)), id));
}

// Alt+Arrows: move one step, or as many as it takes for the layout to change (moving
// down past a taller neighbour swaps with it, since panels float up).
export function nudge(panels, id, dx, dy) {
  const p = panels.find((q) => q.id === id);
  if (!p) return panels;
  const limit = dx ? COLS : panels.reduce((n, q) => n + q.h, 0) + 1;
  for (let step = 1; step <= limit; step += 1) {
    const x = p.x + dx * step;
    const y = p.y + dy * step;
    if (x < 0 || x + p.w > COLS || y < 0) break;
    const next = dropAt(panels, id, { x, y });
    if (!sameLayout(next, panels)) return next;
  }
  return panels;
}

// Alt+Shift+Arrows: one column wider or narrower, one row taller or shorter.
export function grow(panels, id, dw, dh) {
  const p = panels.find((q) => q.id === id);
  if (!p) return panels;
  return resizeTo(panels, id, { w: p.w + dw, h: p.h + dh, x: Math.min(p.x, COLS - Math.max(MIN_W, p.w + dw)) });
}

// The first free spot for a w x h panel, top to bottom, left to right.
export function findSpot(panels, w, h) {
  for (let y = 0; ; y += 1) {
    for (let x = 0; x + w <= COLS; x += 1) {
      const probe = { id: '\0', x, y, w, h };
      if (!panels.some((q) => collides(probe, q))) return { x, y };
    }
  }
}

export function nextId(panels) {
  const n = panels.reduce((m, p) => Math.max(m, Number(String(p.id).replace(/^p/, '')) || 0), 0);
  return `p${n + 1}`;
}

// The size of a new panel for a command: charts get CHART_MIN_H rows. parse is the
// app's parseCommand.
export function newPanelSize(cmd, parse) {
  const p = parse(cmd);
  return { w: 6, h: CHART_SCREENS.includes(p.name) ? CHART_MIN_H : 7 };
}

// card: a WEIRD gauge drawn as its tile (DESK cards), not a framed screen.
export function addPanel(panels, cmd, { w = 6, h = 7, card = false } = {}) {
  if (panels.length >= MAX_PANELS) return panels;
  const size = clampPanel({ w, h });
  const spot = findSpot(panels, size.w, size.h);
  return settle([...panels, { id: nextId(panels), cmd, ...size, ...spot, link: null, ...(card ? { card: true } : {}) }]);
}

export function removePanel(panels, id) {
  return settle(panels.filter((p) => p.id !== id));
}

// Phones: one column, top to bottom, left to right.
export function stackOrder(panels) {
  return [...panels].sort((a, b) => a.y - b.y || a.x - b.x);
}

// Phones in EDIT: the up and down buttons swap a panel with its neighbour in the stack.
export function swapInStack(panels, id, dir) {
  const order = stackOrder(panels);
  const i = order.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return panels;
  const a = order[i];
  const b = order[j];
  // The two trade slots (place and size), so the desk keeps its shape on a big screen.
  const slot = ({ x, y, w, h }) => ({ x, y, w, h });
  return settle(panels.map((p) => {
    if (p.id === a.id) return { ...p, ...slot(b) };
    if (p.id === b.id) return { ...p, ...slot(a) };
    return p;
  }));
}

export function cycleLink(link) {
  return LINKS[(LINKS.indexOf(link ?? null) + 1) % LINKS.length];
}

// ---- Saved state -------------------------------------------------------------------
// localStorage 'bb.desks' = { v: 1, active: 1..4, desks: [{ panels }] x 4, updatedAt }.

export function defaultDesks() {
  return { v: DESK_VERSION, active: 1, desks: [{ panels: DEFAULT_DESK.map((p) => ({ ...p })) }, { panels: [] }, { panels: [] }, { panels: [] }] };
}

function cleanCmd(c) {
  const s = String(c ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  return s && s.length <= 256 ? s : null;
}

function cleanPanels(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || out.length >= MAX_PANELS) continue;
    const cmd = cleanCmd(raw.cmd);
    const id = /^p\d{1,4}$/.test(String(raw.id)) && !seen.has(raw.id) ? String(raw.id) : null;
    if (!cmd || !id) continue;
    seen.add(id);
    const card = raw.card === true ? { card: true } : {};
    out.push(clampPanel({ id, cmd, x: raw.x, y: raw.y, w: raw.w, h: raw.h, link: LINKS.includes(raw.link) ? raw.link : null, ...card }));
  }
  return settle(out);
}

// Anything saved -> { state, writable }. A newer version (written by a later Bloombroke)
// is not understood, so it shows the default desks and is never overwritten.
export function parseDesks(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.v)) return { state: defaultDesks(), writable: true };
  if (raw.v > DESK_VERSION) return { state: defaultDesks(), writable: false };
  if (raw.v !== DESK_VERSION || !Array.isArray(raw.desks)) return { state: defaultDesks(), writable: true };
  const desks = Array.from({ length: DESK_COUNT }, (_, i) => ({ panels: cleanPanels(raw.desks[i]?.panels) }));
  const active = Number.isInteger(raw.active) && raw.active >= 1 && raw.active <= DESK_COUNT ? raw.active : 1;
  return { state: { v: DESK_VERSION, active, desks }, writable: true };
}

export function serializeDesks(state, now = new Date()) {
  return {
    v: DESK_VERSION,
    active: state.active,
    desks: state.desks.map((d) => ({ panels: d.panels.map(({ id, cmd, x, y, w, h, link, card }) => ({ id, cmd, x, y, w, h, link: link || null, ...(card ? { card: true } : {}) })) })),
    updatedAt: now.toISOString(),
  };
}

export function loadDesks(store) {
  return parseDesks(store.get(DESK_KEY, null));
}

export function saveDesks(store, state, writable = true) {
  if (writable) store.set(DESK_KEY, serializeDesks(state));
}

// DESK, DESK 2, DESK RESET, DESK 3 RESET, DESK WEIRD, DESK 2 MACRO -> { n, reset,
// preset? } or { error: 'usage' }. RESET and a preset do not go together.
export function parseDeskArgs(args) {
  let n = null;
  let reset = false;
  let preset = null;
  for (const t of args) {
    if (/^[1-4]$/.test(t) && n === null) n = Number(t);
    else if (t === 'RESET' && !reset && !preset) reset = true;
    else if (PRESETS[t] && !preset && !reset) preset = t;
    else return { error: 'usage' };
  }
  return preset ? { n, reset, preset } : { n, reset };
}

// ---- Embedded panels ---------------------------------------------------------------

// The page a panel frames: the app itself in embed mode.
export function embedSrc(cmd) {
  return `/?${new URLSearchParams({ c: cmd, embed: '1' })}`;
}

export function isEmbedSearch(search) {
  return new URLSearchParams(search || '').get('embed') === '1';
}

// Linked panels. parse is the app's parseCommand.
export function tickerOf(cmd, parse) {
  const p = parse(cmd);
  return TICKER_SCREENS.includes(p.name) && !p.error && p.args?.ticker ? p.args.ticker : null;
}

// The same screen for another ticker: "NEWS AAPL" + MSFT -> "NEWS MSFT", or null when
// the screen does not show one ticker or does not take that one (FINANCIALS GOLD).
// NEWS (every headline) narrows to NEWS MSFT, but a NEWS tab (NEWS WSB) keeps its tab;
// a ticker screen still waiting for one
// (INSIDERS) takes it; OPTIONS drops the old expiry, since dates differ by ticker.
export function retarget(cmd, ticker, parse) {
  const p = parse(cmd);
  const same = (name) => name === p.name || (p.name === 'NEWS' && name === 'TICKERNEWS');
  const check = (c) => {
    const next = parse(c);
    return same(next.name) && !next.error && next.args?.ticker === ticker ? next.input : null;
  };
  if (p.name === 'NEWS' && !p.error) return p.args?.tab && p.args.tab !== 'MARKETS' ? null : check(`NEWS ${ticker}`);
  if (!TICKER_SCREENS.includes(p.name)) return null;
  const old = p.args?.ticker;
  if (!old) return p.error === 'usage' && p.input === p.name ? check(`${p.name} ${ticker}`) : null;
  if (p.error || old === ticker) return null;
  if (p.name === 'OPTIONS') return check(`OPTIONS ${ticker}`);
  const toks = String(p.input).split(' ');
  const i = toks.indexOf(old);
  if (i < 0) return null;
  toks[i] = ticker;
  return check(toks.join(' '));
}

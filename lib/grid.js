// GRID, the server side: GET /api/grid?s=TOK1,TOK2,...&r=1Y, every tile of a board in one
// answer (the screen is public/screens/grid.js, the share card lib/og-grid.js).
//
// The tokens are read with the screen's own grammar (public/command-args.js gridItem), at
// most GRID_MAX of them. Each tile:
//   market  getChart (cache first, through the chart gate), at most GRID_PARALLEL at once
//           per request, thinned to GRID_POINTS points that always keep the high and low
//   cpi     US CPI-U, monthly, from the BLS series baked into data/bls-monthly.json
//   weird   the gauge's last good reading, from one getWeird({ wait: 0 }) per request
//   rip     a GRAVEYARD stone: a drawn cliff from its peak to its end (no price history)
//   bbrk    our own page views this week and visitors here now
// A tile that failed comes back as { token, error }: unavailable or pending (the screen
// asks again once; a busy chart gate reaches us as unavailable, data/charts.js), not_found (NO SUCH TICKER, with a suggestion when there is one), no_data.
//
// Every good tile is kept in a small memory LRU (token + range): the share card draws
// from it and never fetches anything itself.

import { readFileSync } from 'node:fs';
import { gridItem, gridSuggest, GRID_MAX, GRID_RANGE, WEIRD_PERIODS } from '../public/command-args.js';
import { PRESETS } from '../public/ranges.js';
import { instrumentById, stockSymbol } from '../public/instruments.js';
import { nameForTicker } from '../public/known-tickers.js';
import { findGrave, eventLabel } from '../public/nosuch.js';
import { gaugeByCommand } from '../public/screens/weird-gauges.js';
import { makeRateLimit } from './og.js';
import { clientIp } from '../pro/ratelimit.js';

export const GRID_POINTS = 120;
export const GRID_PARALLEL = 4;
// Loads a board, a retry, an added tile or a range switch each cost one.
export const GRID_RATE = { renders: 60, windowMs: 10 * 60_000, addresses: 5000 };
export const GRID_KEEP = { entries: 800, ms: 24 * 3600_000 };
export const BBRK_WAIT_MS = 2000;
// Errors the screen asks about again (once): the rest are the answer.
export const RETRY_ERRORS = ['unavailable', 'pending'];

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// ---- Series helpers -------------------------------------------------------------------

// At most `max` points, first and last kept, and the highest and the lowest point too, so
// the dots on the tile sit on the line that is drawn.
export function downsample(points, max = GRID_POINTS) {
  const n = points.length;
  if (n <= max) return points.slice();
  let hi = 0;
  let lo = 0;
  points.forEach((p, i) => { if (p.v > points[hi].v) hi = i; if (p.v < points[lo].v) lo = i; });
  const step = (n - 1) / (max - 1);
  const idx = new Set(Array.from({ length: max }, (_, i) => Math.round(i * step)));
  for (const k of [hi, lo]) {
    if (idx.has(k)) continue;
    // Swap the nearest sampled point (never the first or the last) for this one.
    let best = null;
    for (const j of idx) if (j !== 0 && j !== n - 1 && j !== hi && j !== lo && (best === null || Math.abs(j - k) < Math.abs(best - k))) best = j;
    if (best !== null) idx.delete(best);
    idx.add(k);
  }
  return [...idx].sort((a, b) => a - b).map((i) => points[i]);
}

// [{ t, v }] -> { last, changePct, hi: { v, t }, lo: { v, t } }.
export function seriesStats(points) {
  const first = points[0];
  const last = points[points.length - 1];
  let hi = first;
  let lo = first;
  for (const p of points) { if (p.v > hi.v) hi = p; if (p.v < lo.v) lo = p; }
  const changePct = first && first.v > 0 && last ? (last.v / first.v - 1) * 100 : null;
  return { last: last?.v ?? null, changePct: Number.isFinite(changePct) ? changePct : null, hi: { v: hi.v, t: hi.t }, lo: { v: lo.v, t: lo.t } };
}

// ---- CPI (BLS) --------------------------------------------------------------------------

const CPI_SERIES = 'CUUR0000SA0';
// data/bls-monthly.json -> [{ t, v, d: '2026-08' }], oldest first, or [] when missing.
export function loadCpiMonthly(file = new URL('../data/bls-monthly.json', import.meta.url)) {
  try {
    const values = JSON.parse(readFileSync(file, 'utf8')).series?.[CPI_SERIES]?.values || {};
    return Object.entries(values)
      .filter(([d, v]) => /^\d{4}-\d{2}$/.test(d) && Number.isFinite(v) && v > 0)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([d, v]) => ({ d, t: Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, 1), v }));
  } catch {
    return [];
  }
}

// Months of CPI a range shows: monthly data, so anything under a year shows a year.
export const CPI_MONTHS = { '2Y': 24, '5Y': 60, '10Y': 120, MAX: Infinity };
export function cpiTile(range, monthly) {
  const months = CPI_MONTHS[range] || 12;
  const pts = (Number.isFinite(months) ? monthly.slice(-(months + 1)) : monthly).map(({ t, v }) => ({ t, v }));
  if (pts.length < 2) return { token: 'CPI', kind: 'cpi', label: 'CPI', error: 'no_data' };
  const last = monthly[monthly.length - 1];
  return {
    token: 'CPI', kind: 'cpi', label: 'CPI', name: 'US consumer prices', decimals: 1, unit: '',
    points: downsample(pts), ...seriesStats(pts), asOf: last.d, range: CPI_MONTHS[range] ? range : '1Y',
  };
}

// ---- Market tiles -----------------------------------------------------------------------

// The label on a tile: the ticker without its $, a coin without USD (SOLUSD -> SOL).
export function marketLabel(token) {
  const inst = instrumentById(token);
  if (inst?.kind === 'crypto') return inst.id.replace(/USD$/, '') || inst.id;
  return stockSymbol(token);
}

export function marketTile(token, chart) {
  const inst = instrumentById(token);
  const pts = (chart?.points || []).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).map((p) => ({ t: p.t, v: p.v }));
  if (pts.length < 2) return { token, kind: 'market', label: marketLabel(token), error: 'no_data' };
  const last = pts[pts.length - 1];
  return {
    token, kind: 'market', label: marketLabel(token),
    name: inst?.name || nameForTicker(stockSymbol(token)) || '',
    decimals: Number.isInteger(inst?.decimals) ? Math.min(inst.decimals, 4) : 2,
    unit: inst?.kind === 'yield' ? '%' : '',
    points: downsample(pts), ...seriesStats(pts),
    asOf: new Date(last.t).toISOString(), ...(chart.stale ? { stale: true } : {}),
  };
}

// A failed chart -> the tile's error word. getChart turns every failed load (a busy gate
// too) into ChartError('unavailable').
export function chartError(err) {
  if (['not_found', 'no_data', 'bad_symbol'].includes(err?.code)) return err.code === 'no_data' ? 'no_data' : 'not_found';
  return 'unavailable';
}

// ---- WEIRD tiles -------------------------------------------------------------------------

export function weirdTile(item, row) {
  const g = gaugeByCommand(item.gauge);
  const base = { token: item.token, kind: 'weird', label: item.gauge, name: g?.title || '' };
  if (!row) return { ...base, error: 'unavailable' };
  if (row.pending) return { ...base, error: 'pending' };
  if (row.ok === false || !row.headline) return { ...base, error: 'no_data' };
  const spark = Array.isArray(row.spark) ? row.spark.filter(Number.isFinite) : [];
  const pts = spark.map((v, i) => ({ t: i, v }));
  const out = { ...base, headline: String(row.headline).slice(0, 40), asOf: row.asOf || row.updated || null, ...(row.stale ? { stale: true } : {}) };
  if (pts.length < 2) return out;
  const { hi, lo } = seriesStats(pts);
  return { ...out, points: downsample(pts), hi: { v: hi.v, t: null }, lo: { v: lo.v, t: null } };
}

// ---- RIP tiles -------------------------------------------------------------------------

// '2007-02-02', '1995-12', '2003-Q4', '1999', '2000-03/2000-05' -> ms at its start, or null.
export function periodStart(p) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?|-Q([1-4]))?/.exec(String(p || ''));
  if (!m) return null;
  const month = m[2] ? Number(m[2]) : m[4] ? (Number(m[4]) - 1) * 3 + 1 : 1;
  return Date.UTC(Number(m[1]), month - 1, m[3] ? Number(m[3]) : 1);
}
const monthYear = (ms) => { const d = new Date(ms); return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

// A stone -> the tile: a drawn cliff (no real prices), the peak and the end labelled.
// The line rises to the peak (100), slides, drops off the cliff on the day it died, and
// ends where the shares ended (the final price against the peak, when both are sourced).
export function ripTile(item, e) {
  if (!e) return { token: item.token, kind: 'rip', label: item.ticker, error: 'not_found', suggest: null };
  const died = periodStart(e.date);
  let peak = e.peak ? periodStart(e.peak.date) : null;
  if (!Number.isFinite(peak) || peak >= died) peak = null;
  const span = peak ? died - peak : 3 * 365 * 86_400_000;
  const top = peak || died - span * 0.5;
  const endT = e.final?.date && periodStart(e.final.date) > died ? periodStart(e.final.date) : died + span * 0.18;
  const ratio = e.peak?.price > 0 && Number.isFinite(e.final?.price) ? Math.max(0, Math.min(100, (e.final.price / e.peak.price) * 100)) : 0;
  const atDeath = Math.max(ratio, 6);
  const points = [
    { t: top - span * 0.7, v: 52 },
    { t: top - span * 0.3, v: 70 },
    { t: top, v: 100 },
    { t: top + (died - top) * 0.7, v: Math.max(atDeath, 72) },
    { t: died, v: atDeath },
    { t: endT, v: ratio },
  ].map((p) => ({ t: Math.round(p.t), v: Math.round(p.v * 100) / 100 }));
  const label = eventLabel(e.what);
  return {
    token: item.token, kind: 'rip', label: e.ticker, name: e.name, what: label, died: e.date,
    final: Number.isFinite(e.final?.price) ? e.final.price : null,
    points, xByTime: true,
    marks: [
      ...(peak ? [{ i: 2, text: `PEAK ${monthYear(peak)}`, pos: 'above' }] : []),
      { i: 4, text: `${label} ${monthYear(died)}`, pos: 'below' },
    ],
  };
}

// ---- BBRK ----------------------------------------------------------------------------------

export function bbrkTile(aud) {
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
  return { token: 'BBRK', kind: 'bbrk', label: 'BBRK', name: 'Bloombroke', views7: n(aud?.pageviews?.d7), here: n(aud?.live) };
}

// ---- The board --------------------------------------------------------------------------

// Run jobs with at most `n` at once; each job fills its own slot.
async function pool(jobs, n) {
  let next = 0;
  const worker = async () => { while (next < jobs.length) { const j = jobs[next]; next += 1; await j(); } };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
}

function memoryLru(max) {
  const m = new Map();
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) { m.delete(k); m.set(k, v); while (m.size > max) m.delete(m.keys().next().value); },
    get size() { return m.size; },
  };
}

// deps: getChart (data/charts.js), getWeird (data/weird/index.js), stones and zombies
// (lib/graveyard.js), audience (lib/datafast.js makeDataFast), cpi (loadCpiMonthly).
export function makeGrid({
  getChart, getWeird = async () => ({ gauges: [] }), stones = [], zombies = [], audience = null,
  cpi = loadCpiMonthly(), now = () => Date.now(), keep = GRID_KEEP, parallel = GRID_PARALLEL,
} = {}) {
  const kept = memoryLru(keep.entries);
  const keyOf = (token, range) => `${token}|${range}`;
  const graves = [...stones, ...zombies];
  const remember = (tile, range) => { if (!tile.error) kept.set(keyOf(tile.token, range), { tile, at: now() }); return tile; };

  const notFound = (token, word) => {
    const grave = findGrave(graves, word);
    return { token, kind: 'unknown', label: word, error: 'not_found', suggest: grave ? `RIP:${grave.ticker}` : gridSuggest(word) };
  };

  async function one(item, range, weird) {
    switch (item.kind) {
      case 'market':
        try {
          return remember(marketTile(item.token, await getChart(item.token, range)), range);
        } catch (err) {
          const error = chartError(err);
          return error === 'not_found' ? notFound(item.token, stockSymbol(item.token)) : { token: item.token, kind: 'market', label: marketLabel(item.token), error };
        }
      case 'cpi': return remember(cpiTile(range, cpi), range);
      case 'weird': return remember(weirdTile(item, weird ? weird.find((r) => r.id === gaugeByCommand(item.gauge)?.id) || null : null), range);
      case 'rip': {
        const e = graves.find((x) => x.ticker === item.ticker);
        return e ? remember(ripTile(item, e), range) : notFound(item.token, item.ticker);
      }
      case 'bbrk': {
        let aud = null;
        try { aud = audience ? await audience.get({ wait: BBRK_WAIT_MS }) : {}; } catch { aud = null; }
        return aud ? remember(bbrkTile(aud), range) : { token: 'BBRK', kind: 'bbrk', label: 'BBRK', error: 'unavailable' };
      }
      default:
        return { token: item.token, kind: 'unknown', label: item.token, error: 'not_found', suggest: item.suggest ?? gridSuggest(item.token) };
    }
  }

  // items (gridItem results) and a range -> the tiles, in order.
  async function board(items, range = GRID_RANGE) {
    let weird = null;
    if (items.some((i) => i.kind === 'weird')) {
      try {
        weird = (await getWeird({ wait: 0, period: WEIRD_PERIODS.includes(range) ? range : null }))?.gauges || null;
      } catch { weird = null; }
    }
    const out = new Array(items.length);
    await pool(items.map((it, i) => async () => { out[i] = await one(it, range, weird); }), parallel);
    return out;
  }

  // The tile as last served (the share card): kept tiles, and the ones drawn from local
  // data (CPI, a stone). Never fetches. null when there is none.
  function cached(item, range = GRID_RANGE) {
    if (!item) return null;
    if (item.kind === 'cpi') return cpiTile(range, cpi);
    if (item.kind === 'rip') { const e = graves.find((x) => x.ticker === item.ticker); return e ? ripTile(item, e) : null; }
    const hit = kept.get(keyOf(item.token, range));
    return hit && now() - hit.at < keep.ms ? hit.tile : null;
  }

  return { board, cached, kept };
}

const str = (v) => (typeof v === 'string' ? v : '');

// GET /api/grid. deps: makeGrid's, plus allow (the per-address limit, makeRateLimit).
// GRID is free for everyone: 16 tiles, whatever they are.
export function mountGrid(app, deps = {}) {
  const grid = deps.grid || makeGrid(deps);
  const allow = deps.allow || makeRateLimit(GRID_RATE);
  app.get('/api/grid', async (req, res) => {
    const s = str(req.query.s);
    const range = (str(req.query.r) || GRID_RANGE).toUpperCase();
    const raw = s.split(',').map((t) => t.trim()).filter(Boolean);
    if (!raw.length || raw.length > GRID_MAX || s.length > 600) {
      return res.status(400).json({ error: 'usage', message: `Ask for 1 to ${GRID_MAX} tiles, separated by commas.` });
    }
    if (!PRESETS.includes(range)) return res.status(400).json({ error: 'bad_range', message: `Pick a range: ${PRESETS.join(' ')}.` });
    if (!allow(clientIp(req))) {
      res.set({ 'Retry-After': '60', 'Cache-Control': 'no-store' });
      return res.status(429).json({ error: 'rate_limited', message: 'That is a lot of boards. Try again in a minute.' });
    }
    const items = [];
    const seen = new Set();
    for (const t of raw) {
      const it = gridItem(t);
      if (it && !seen.has(it.token)) { seen.add(it.token); items.push(it); }
    }
    try {
      const tiles = await grid.board(items, range);
      // A tile the screen will ask about again is not kept by the browser either.
      const again = tiles.some((t) => RETRY_ERRORS.includes(t.error));
      res.set('Cache-Control', again ? 'no-store' : 'public, max-age=60');
      res.json({ range, tiles, updated: new Date().toISOString() });
    } catch (err) {
      console.error('[grid]', err.message);
      res.status(503).json({ error: 'unavailable', message: 'Data is taking a break. Try again in a minute.' });
    }
  });
  return grid;
}

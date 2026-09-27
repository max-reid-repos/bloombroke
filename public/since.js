// SINCE on HOME: one line in the MARKETS title strip, what moved since your last visit.
// HOME keeps a snapshot in this browser (bb.since): the S&P 500, your watchlist's prices
// and a few WEIRD gauge numbers. It is saved once the data is in, every few minutes and
// when the page is hidden. A later visit (an hour or more after it) compares today's
// numbers with it: "SINCE TUE 21:40: S&P 500 +1.2% · NVDA +4.1% · CANAL −12%". An item
// with a missing number is left out; with nothing to compare, the line is not shown.

import { esc } from './screens/markets.js';
import { loadWatchlist } from './watchlist.js';

export const SINCE_KEY = 'bb.since';
export const MIN_AGE = 60 * 60_000;
export const SAVE_EVERY = 5 * 60_000;
// WEIRD gauges with a plain level (not a % already): [id, the word shown].
export const SINCE_WEIRD = [['canal', 'CANAL'], ['boxrate', 'BOXRATE'], ['rides', 'RIDES']];
export const WATCH_ITEMS = 3;
const MAX_QUOTES = 30;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// { t, spx, quotes: [{ ticker, last, kind }], gauges: [{ id, ok, value }] } -> the stored form.
// Yields are left out: a % change of a yield is not a number anyone reads.
export function makeSnapshot({ t, spx, quotes, gauges }) {
  const watch = {};
  for (const qt of quotes || []) {
    const last = num(qt?.last);
    if (qt?.ticker && qt.ticker !== 'SPX' && qt.kind !== 'yield' && last > 0) watch[qt.ticker] = last;
  }
  const weird = {};
  for (const [id] of SINCE_WEIRD) {
    const g = (gauges || []).find((x) => x?.id === id);
    if (g?.ok && num(g.value) !== null) weird[id] = g.value;
  }
  const spxLast = num(spx);
  return { v: 1, t, spx: spxLast > 0 ? spxLast : null, watch, weird };
}

export function hasData(s) {
  return Boolean(s && (s.spx || Object.keys(s.watch || {}).length || Object.keys(s.weird || {}).length));
}

// Whatever was stored -> a snapshot, or null.
export function readSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Number.isFinite(raw.t)) return null;
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  return { v: 1, t: raw.t, spx: num(raw.spx), watch: obj(raw.watch), weird: obj(raw.weird) };
}

const change = (a, b) => (num(a) > 0 && num(b) !== null ? (b / a - 1) * 100 : null);

// then: the stored snapshot; now: one made from today's numbers. -> [{ label, pct }].
// Nothing when there is no snapshot or it is under an hour old.
export function sinceItems(then, now) {
  if (!then || !now || !(now.t - then.t >= MIN_AGE)) return [];
  const out = [];
  const spx = change(then.spx, now.spx);
  if (spx !== null) out.push({ label: 'S&P 500', pct: spx });
  const watch = Object.keys(now.watch || {})
    .map((id) => ({ label: id, pct: change(then.watch?.[id], now.watch[id]) }))
    .filter((x) => x.pct !== null)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || (a.label < b.label ? -1 : 1))
    .slice(0, WATCH_ITEMS);
  out.push(...watch);
  for (const [id, word] of SINCE_WEIRD) {
    const p = change(then.weird?.[id], now.weird?.[id]);
    if (p !== null) out.push({ label: word, pct: p });
  }
  return out;
}

const MINUS = '−';
export function fmtSince(p) {
  const s = Math.abs(p).toFixed(Math.abs(p) >= 10 ? 0 : 1);
  if (Number(s) === 0) return `${s}%`;
  return `${p > 0 ? '+' : MINUS}${s}%`;
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short' });

// When the snapshot was taken, New York time like every time here: "TUE 21:40" within
// the week, "SEP 20 21:40" before that.
export function sinceWhen(t, nowMs) {
  const p = Object.fromEntries(NY.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const hm = `${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
  if (nowMs - t < 6 * 86_400_000) return `${DAYS[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)]} ${hm}`;
  return `${MONTHS[Number(p.month) - 1]} ${p.day.padStart(2, '0')} ${hm}`;
}

// The line as plain text (tests, the tooltip).
export function sinceText(then, items, nowMs) {
  if (!then || !items.length) return '';
  return `SINCE ${sinceWhen(then.t, nowMs)}: ${items.map((i) => `${i.label} ${fmtSince(i.pct)}`).join(' · ')}`;
}

export function sinceHtml(then, items, nowMs) {
  if (!then || !items.length) return '';
  const dir = (p) => (Number(fmtSince(p).replace(/[^\d.]/g, '')) === 0 ? 'flat' : p > 0 ? 'up' : 'down');
  const parts = items.map((i) => `<span class="sn-i">${esc(i.label)} <span class="${dir(i.pct)}">${esc(fmtSince(i.pct))}</span></span>`);
  return `<span class="since" title="${esc(`${sinceText(then, items, nowMs)}. Your last visit's numbers are kept in this browser only.`)}">SINCE ${esc(sinceWhen(then.t, nowMs))}: ${parts.join('<span class="sn-sep"> · </span>')}</span>`;
}

// The baseline for this page load: read once, so moving between screens does not reset it.
let baseline;

// HOME: meta is the MARKETS title strip. Call markets(instruments) with each /api/markets.
export function startSince(meta, ctx) {
  if (ctx.embed) return { markets() {} }; // HOME in a DESK panel: no line, no saves
  if (baseline === undefined) baseline = readSnapshot(ctx.store.get(SINCE_KEY, null));
  const cur = { spx: null, quotes: null, gauges: null };
  let saved = false;

  const snap = () => makeSnapshot({ t: Date.now(), ...cur });
  function paint() {
    if (!meta) return;
    meta.innerHTML = sinceHtml(baseline, sinceItems(baseline, snap()), Date.now());
  }
  function save() {
    const s = snap();
    if (hasData(s)) ctx.store.set(SINCE_KEY, s);
  }
  // The first save waits for all three sources (or their failure), so it is a full one.
  let pending = 3;
  const settled = () => {
    pending -= 1;
    paint();
    if (pending <= 0 && !saved) { saved = true; save(); }
  };

  const ids = loadWatchlist(ctx.store).slice(0, MAX_QUOTES);
  if (ids.length) {
    ctx.fetchJSON(`/api/quotes?${new URLSearchParams({ s: ids.join(',') })}`, { signal: ctx.signal })
      .then((d) => { cur.quotes = d?.quotes || []; }, () => {})
      .finally(() => { if (!ctx.signal.aborted) settled(); });
  } else {
    settled();
  }
  ctx.fetchJSON('/api/weird', { signal: ctx.signal })
    .then((d) => { cur.gauges = d?.gauges || []; }, () => {})
    .finally(() => { if (!ctx.signal.aborted) settled(); });

  let spxSeen = false;
  const onHide = () => save();
  window.addEventListener('pagehide', onHide);
  ctx.every(save, SAVE_EVERY);
  ctx.onCleanup(() => {
    window.removeEventListener('pagehide', onHide);
    save();
  });

  return {
    markets(instruments) {
      const spx = (instruments || []).find((m) => m.id === 'SPX');
      cur.spx = num(spx?.last);
      if (!spxSeen) { spxSeen = true; settled(); } else paint();
    },
  };
}

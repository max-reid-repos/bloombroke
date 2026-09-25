// Price history for charts, from the public CNBC bars service (no key).
//
// Weekly and monthly bars are stamped with the day their period starts (a Sunday for
// weeks, the 1st for months), which is not a trading day. Each such bar gets `e`, the
// real trading day its close is from: the last daily bar inside its period, from a
// second (daily) call over the same window. The bar still running (this week or
// month) is marked `p` (partial): its close is the latest price, not a period close.
// Without the daily call the bars carry no `e`, and the screen says "week of".

import { createCache } from './cache.js';
import { normalizeTicker, tickerSource, UA } from './quotes.js';
import { instrumentById } from '../public/instruments.js';
import { PRESETS, parseDate, isoDay, nyToday } from '../public/ranges.js';

const BARS_URL = 'https://ts-api.cnbc.com/harmony/app/bars';
const DAY = 86_400_000;
const MIN = 60_000;
// Bars the source serves: 1M 5M 1H 1D 1W 1MO. Intraday history only goes back about
// three months, so older custom ranges use daily bars.
const INTRADAY_DAYS = 80;
const MAX_POINTS = 800;

// Preset -> bar size, how far back, and how long a chart stays cached.
const PRESET_SPEC = {
  '1D': { bar: '5M', days: 6, sessions: 1, ttl: MIN },
  '5D': { bar: '5M', days: 10, sessions: 5, ttl: MIN },
  '1M': { bar: '1D', days: 31, ttl: 15 * MIN },
  '3M': { bar: '1D', days: 92, ttl: 15 * MIN },
  '6M': { bar: '1D', days: 183, ttl: 15 * MIN },
  YTD: { bar: '1D', ytd: true, ttl: 15 * MIN },
  '1Y': { bar: '1D', days: 366, ttl: 15 * MIN },
  '2Y': { bar: '1D', days: 731, ttl: 15 * MIN },
  '5Y': { bar: '1W', days: 5 * 366, ttl: 60 * MIN },
  '10Y': { bar: '1W', days: 10 * 366, ttl: 60 * MIN },
  MAX: { bar: '1MO', from: '1900-01-01', ttl: 6 * 60 * MIN },
};
export const RANGES = PRESET_SPEC;

// Bar size for a custom FROM/TO range: intraday for a few recent days, daily up to
// about two years, weekly up to twenty, monthly beyond.
export function barFor(fromMs, toMs, nowMs) {
  const days = (toMs - fromMs) / DAY;
  if (days <= 7 && nowMs - fromMs <= INTRADAY_DAYS * DAY) return days <= 3 ? '5M' : '1H';
  if (days <= 800) return '1D';
  if (days <= 20 * 366) return '1W';
  return '1MO';
}

// Symbols on the New York session: their intraday charts show 9:30 to 16:00 ET only.
function usSession(ticker) {
  const inst = instrumentById(ticker);
  return inst ? Boolean(inst.us) && inst.kind === 'index' && !inst.allDay : true;
}

export class ChartError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function stamp(date) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 8);
}

// CNBC priceBars -> [{ t, d, v }], oldest first. d is "YYYYMMDDHHMMSS" in New York time.
export function shapeBars(bars) {
  return (Array.isArray(bars) ? bars : [])
    .map((b) => ({ t: Number(b.tradeTimeinMills), d: String(b.tradeTime || ''), v: Number(b.close) }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0 && /^\d{14}$/.test(p.d))
    .sort((a, b) => a.t - b.t);
}

// Keep the most recent trading day(s). For US symbols keep the regular session only.
export function lastSession(points, { usSession = true, sessions = 1 } = {}) {
  const inSession = (p) => {
    if (!usSession) return true;
    const hm = Number(p.d.slice(8, 12));
    return hm >= 930 && hm <= 1600;
  };
  const kept = points.filter(inSession);
  if (!kept.length) return [];
  const days = [...new Set(kept.map((p) => p.d.slice(0, 8)))].slice(-sessions);
  return kept.filter((p) => days.includes(p.d.slice(0, 8)));
}

// Weekly/monthly points + daily points -> the same points with e (ms of the last
// daily bar inside each period) where one exists. Periods are compared as New York
// days (the d field), [this bar's day, the next bar's day).
// The daily close there must equal the bar's close (within 0.05%), or the day is not
// claimed: the bar then says only its period.
export function barEnds(points, daily) {
  const days = (daily || []).map((p) => ({ day: p.d.slice(0, 8), t: p.t, v: p.v })).sort((a, b) => a.t - b.t);
  let j = 0;
  return points.map((p, i) => {
    const start = p.d.slice(0, 8);
    const next = points[i + 1]?.d.slice(0, 8) || '99999999';
    while (j < days.length && days[j].day < start) j += 1;
    let k = j;
    let hit = null;
    while (k < days.length && days[k].day < next) { hit = days[k]; k += 1; }
    return hit && Math.abs(hit.v - p.v) <= p.v * 0.0005 ? { ...p, e: hit.t } : p;
  });
}

// Is a weekly or monthly bar starting on New York day d (YYYYMMDD) still running today?
export function isPartial(d, bar, today) {
  const start = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (bar === '1MO') return start.slice(0, 7) === today.slice(0, 7);
  if (bar === '1W') return (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / DAY < 7;
  return false;
}

// Thin a long series to at most `max` points, always keeping the first and the last.
export function thin(points, max = MAX_POINTS) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

// Resolve what to fetch: a preset, or a custom FROM (and optional TO) in YYYY-MM-DD.
export function chartWindow({ range, from, to }, now = new Date()) {
  const nowMs = now.getTime();
  if (from) {
    const f = parseDate(from);
    const t = to ? parseDate(to) : null;
    if (!f || (to && !t)) throw new ChartError('bad_date', 'Dates look like 2020-01-31.');
    const toMs = t ? t.getTime() + DAY : nowMs + DAY;
    if (f.getTime() > nowMs) throw new ChartError('bad_date', 'FROM is in the future.');
    if (t && f.getTime() >= t.getTime()) throw new ChartError('bad_date', 'FROM has to be before TO.');
    const bar = barFor(f.getTime(), Math.min(toMs, nowMs), nowMs);
    const ended = t && toMs < nowMs;
    const ttl = ended ? 6 * 60 * MIN : bar.endsWith('M') && bar !== '1MO' ? MIN : 15 * MIN;
    return { key: `${isoDay(f)}:${t ? isoDay(t) : 'now'}`, start: f, end: new Date(toMs), bar, ttl, from: isoDay(f), to: t ? isoDay(t) : null };
  }
  const r = String(range || '1Y').toUpperCase();
  const spec = PRESET_SPEC[r];
  if (!spec) throw new ChartError('bad_range', `Pick a range: ${PRESETS.join(' ')}.`);
  let start;
  if (spec.ytd) start = new Date(Date.UTC(Number(nyToday(now).slice(0, 4)), 0, 1));
  else if (spec.from) start = parseDate(spec.from);
  else start = new Date(nowMs - spec.days * DAY);
  return { key: r, range: r, start, end: new Date(nowMs + DAY), bar: spec.bar, ttl: spec.ttl, sessions: spec.sessions };
}

export function makeCharts({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 3000 }), now = () => new Date() } = {}) {
  async function bars(src, bar, win) {
    const url = `${BARS_URL}/${encodeURIComponent(src)}/${bar}/${stamp(win.start)}000000/${stamp(win.end)}000000/adjusted/EST5EDT.json`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`chart source HTTP ${res.status}`);
    return res.json();
  }

  async function load(ticker, win) {
    const src = tickerSource(ticker);
    const long = win.bar === '1W' || win.bar === '1MO';
    const [main, daily] = await Promise.allSettled([bars(src, win.bar, win), long ? bars(src, '1D', win) : Promise.resolve(null)]);
    if (main.status === 'rejected') throw main.reason;
    const body = main.value;
    if (body?.status === 'ERROR' || !body?.barData) return { points: [], notFound: true };
    let points = shapeBars(body.barData.priceBars);
    if (win.sessions) points = lastSession(points, { usSession: usSession(ticker), sessions: win.sessions });
    if (long) {
      const d = daily.status === 'fulfilled' ? shapeBars(daily.value?.barData?.priceBars) : [];
      if (d.length) points = barEnds(points, d);
      const today = nyToday(now());
      points = points.map((p) => (isPartial(p.d, win.bar, today) ? { ...p, p: true } : p));
    }
    return { points: thin(points), notFound: false };
  }

  // getChart('AAPL', '5Y') or getChart('AAPL', { from: '2020-01-01', to: '2024-12-31' }).
  async function getChart(rawTicker, rawRange = '1Y') {
    const ticker = normalizeTicker(rawTicker);
    if (!ticker) throw new ChartError('bad_symbol', 'That does not look like a ticker.');
    const spec = typeof rawRange === 'object' && rawRange ? rawRange : { range: rawRange };
    const win = chartWindow(spec, now());
    let got;
    try {
      got = await cache.cached(`chart:${ticker}:${win.key}`, win.ttl, () => load(ticker, win));
    } catch {
      throw new ChartError('unavailable', 'Chart data is taking a break. Try again in a minute.');
    }
    const { value, stale, fetchedAt } = got;
    const label = win.range || `${win.from} to ${win.to || 'today'}`;
    if (value.notFound) throw new ChartError('not_found', `No chart for ${ticker}.`);
    if (value.points.length < 2) throw new ChartError('no_data', `No ${label} chart for ${ticker} yet.`);
    return {
      ticker, range: win.range || null, from: win.from || null, to: win.to || null, bar: win.bar,
      points: value.points.map(({ t, v, e, p }) => ({ t, v, ...(e ? { e } : {}), ...(p ? { p: true } : {}) })), stale, updated: new Date(fetchedAt).toISOString(),
    };
  }

  return { getChart };
}

export const { getChart } = makeCharts();

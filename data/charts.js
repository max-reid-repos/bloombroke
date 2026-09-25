// Price history for charts, from the public CNBC bars service (no key).

import { createCache } from './cache.js';
import { normalizeTicker, tickerSource, UA, YIELDS } from './quotes.js';

const BARS_URL = 'https://ts-api.cnbc.com/harmony/app/bars';
const CHART_TTL = 15 * 60_000;

export const RANGES = {
  '1D': { bar: '5M', days: 6 },
  '1M': { bar: '1D', days: 31 },
  '6M': { bar: '1D', days: 183 },
  '1Y': { bar: '1D', days: 366 },
  '5Y': { bar: '1W', days: 5 * 366 },
};

// Treasury yields chart like tickers (the RATES screen uses them).
const YIELD_IDS = new Set(YIELDS.map((y) => y.id));

export function chartSymbol(raw) {
  const t = String(raw ?? '').trim().toUpperCase();
  return YIELD_IDS.has(t) ? t : normalizeTicker(t);
}

// Symbols that trade on the New York session. Their 1D chart shows 9:30 to 16:00 ET only.
const NON_US = new Set(['.FTSE', '.N225', '.GDAXI']);

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

// Keep the most recent trading day. For US symbols keep the regular session only.
export function lastSession(points, { usSession = true } = {}) {
  const inSession = (p) => {
    if (!usSession) return true;
    const hm = Number(p.d.slice(8, 12));
    return hm >= 930 && hm <= 1600;
  };
  const kept = points.filter(inSession);
  if (!kept.length) return [];
  const day = kept[kept.length - 1].d.slice(0, 8);
  return kept.filter((p) => p.d.startsWith(day));
}

export function makeCharts({ fetchImpl = globalThis.fetch, cache = createCache(), now = () => new Date() } = {}) {
  async function load(src, range) {
    const { bar, days } = RANGES[range];
    const end = new Date(now().getTime() + 86_400_000);
    const start = new Date(now().getTime() - days * 86_400_000);
    const url = `${BARS_URL}/${encodeURIComponent(src)}/${bar}/${stamp(start)}000000/${stamp(end)}000000/adjusted/EST5EDT.json`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`chart source HTTP ${res.status}`);
    const body = await res.json();
    if (body?.status === 'ERROR' || !body?.barData) return { points: [], notFound: true };
    let points = shapeBars(body.barData.priceBars);
    if (range === '1D') points = lastSession(points, { usSession: !NON_US.has(src) });
    return { points, notFound: false };
  }

  async function getChart(rawTicker, rawRange = '1Y') {
    const ticker = chartSymbol(rawTicker);
    const range = String(rawRange || '1Y').toUpperCase();
    if (!ticker) throw new ChartError('bad_symbol', 'That does not look like a ticker.');
    if (!RANGES[range]) throw new ChartError('bad_range', 'Pick a range: 1D, 1M, 6M, 1Y or 5Y.');
    let got;
    try {
      got = await cache.cached(`chart:${ticker}:${range}`, CHART_TTL, () => load(tickerSource(ticker), range));
    } catch {
      throw new ChartError('unavailable', 'Chart data is taking a break. Try again in a minute.');
    }
    const { value, stale, fetchedAt } = got;
    if (value.notFound) throw new ChartError('not_found', `No chart for ${ticker}.`);
    if (value.points.length < 2) throw new ChartError('no_data', `No ${range} chart for ${ticker} yet.`);
    return { ticker, range, points: value.points.map(({ t, v }) => ({ t, v })), stale, updated: new Date(fetchedAt).toISOString() };
  }

  return { getChart };
}

export const { getChart } = makeCharts();

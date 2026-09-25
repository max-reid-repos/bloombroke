// HISTORY: daily open, high, low, close and volume from the CNBC bars service (no key).
// Split-adjusted, the same series the charts use.

import { createCache } from './cache.js';
import { tickerSource, normalizeTicker, UA } from './quotes.js';
import { isIsoDay, nyDay, addDays, iso } from './lists.js';

const BARS_URL = 'https://ts-api.cnbc.com/harmony/app/bars';
const TTL = 30 * 60_000;
export const MAX_DAYS = 10 * 366;

export class HistoryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const n = (v) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

// CNBC priceBars -> [{ d, o, h, l, c, v }], newest first. d is the New York trading day.
export function parseOhlcv(bars) {
  const out = [];
  for (const b of Array.isArray(bars) ? bars : []) {
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(b?.tradeTime || ''));
    const c = n(b?.close);
    if (!m || !(c > 0)) continue;
    out.push({ d: `${m[1]}-${m[2]}-${m[3]}`, o: n(b.open), h: n(b.high), l: n(b.low), c, v: n(b.volume) });
  }
  const seen = new Set();
  return out.sort((a, b) => (a.d < b.d ? 1 : -1)).filter((r) => (seen.has(r.d) ? false : seen.add(r.d)));
}

// Close-to-close % change, computed from the rows themselves (newest first).
export function withChanges(rows) {
  return rows.map((r, i) => {
    const prev = rows[i + 1];
    return { ...r, chg: prev && prev.c > 0 ? ((r.c - prev.c) / prev.c) * 100 : null };
  });
}

export function makeHistory({ fetchImpl = globalThis.fetch, cache = createCache(), now = () => Date.now() } = {}) {
  async function getHistory({ ticker: raw, from, to }) {
    const ticker = normalizeTicker(raw);
    if (!ticker) throw new HistoryError('bad_symbol', 'That does not look like a ticker.');
    const today = nyDay(now());
    const end = to || today;
    const start = from || addDays(end, -365);
    if (!isIsoDay(start) || !isIsoDay(end)) throw new HistoryError('bad_date', 'Dates look like 2025-01-31.');
    if (start > end) throw new HistoryError('bad_date', 'The start date is after the end date.');
    const span = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    if (span > MAX_DAYS) throw new HistoryError('bad_date', 'Pick a range of 10 years or less.');

    // Ask for one extra week before the start so the first row has a change.
    const qStart = addDays(start, -7).replace(/-/g, '');
    const qEnd = addDays(end, 1).replace(/-/g, '');
    let got;
    try {
      got = await cache.cached(`history:${ticker}:${start}:${end}`, TTL, async () => {
        const url = `${BARS_URL}/${encodeURIComponent(tickerSource(ticker))}/1D/${qStart}000000/${qEnd}000000/adjusted/EST5EDT.json`;
        const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
        if (!res.ok) throw new Error(`history source HTTP ${res.status}`);
        const body = await res.json();
        if (body?.status === 'ERROR' || !body?.barData) return { notFound: true, rows: [] };
        return { notFound: false, rows: parseOhlcv(body.barData.priceBars) };
      });
    } catch {
      throw new HistoryError('unavailable', 'Price history is taking a break. Try again in a minute.');
    }
    const { value, stale, fetchedAt } = got;
    if (value.notFound) throw new HistoryError('not_found', `No price history for ${ticker}.`);
    const rows = withChanges(value.rows).filter((r) => r.d >= start && r.d <= end);
    if (!rows.length) throw new HistoryError('no_data', `No trading days for ${ticker} between ${start} and ${end}.`);
    return { ticker, from: start, to: end, rows, stale, updated: iso(fetchedAt) };
  }
  return { getHistory };
}

export const { getHistory } = makeHistory();

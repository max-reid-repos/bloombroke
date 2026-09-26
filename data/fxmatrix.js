// FXMATRIX: cross rates for nine currencies.
// - Daily: the Frankfurter API (ECB reference rates, no key), the rates on the matrix.
// - Live: the CNBC quote service (no key, real time), for HEAT mode's change today.
//   When CNBC fails, HEAT falls back to the daily change and says so.

import { createCache } from './cache.js';
import { iso } from './lists.js';
import { isoDaysAgo } from './fx.js';
import { fetchCnbcRows, parseNum, parseChange, noDayMove, filledRow, fetchDailyMove, DAILY_FILL_TTL } from './quotes.js';

export const MATRIX_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'THB'];
const BASE = 'https://api.frankfurter.dev/v1';
const TTL = 60 * 60_000;

// rates: units of each code per 1 USD ({ EUR: 0.877, ... }). matrix[a][b] = how many b for 1 a.
export function crossRates(rates, codes = MATRIX_CODES) {
  const r = { USD: 1, ...rates };
  const matrix = {};
  for (const a of codes) {
    matrix[a] = {};
    for (const b of codes) {
      matrix[a][b] = a === b ? 1 : (Number.isFinite(r[a]) && Number.isFinite(r[b]) && r[a] > 0 ? r[b] / r[a] : null);
    }
  }
  return matrix;
}

// Frankfurter time series { "YYYY-MM-DD": { EUR: .. } } -> the last two days.
export function lastTwoDays(body) {
  const days = Object.keys(body?.rates || {}).sort();
  if (!days.length) throw new Error('fx source: empty series');
  const last = days[days.length - 1];
  const prev = days.length > 1 ? days[days.length - 2] : null;
  return { date: last, rates: body.rates[last], prevDate: prev, prevRates: prev ? body.rates[prev] : null };
}

// CNBC symbol per currency. `inverse`: the quote is that currency in USD (EUR/USD), so
// units per USD is 1 / last.
export const LIVE_FX = {
  EUR: { src: 'EUR=', inverse: true },
  GBP: { src: 'GBP=', inverse: true },
  AUD: { src: 'AUD=', inverse: true },
  JPY: { src: 'JPY=' },
  CHF: { src: 'CHF=' },
  CAD: { src: 'CAD=' },
  CNY: { src: 'CNY=' },
  THB: { src: 'THB=' },
};
const LIVE_TTL = 30_000;

// CNBC rows -> units per USD now and at the previous close (last minus change), or null
// when any currency is missing, so the matrix never mixes sources. A row with no day's
// move (weekends: UNCH) takes it from its daily closes, fillFor(src) (see filledRow in
// quotes.js); with none, its previous close is unknown (null), so every cell with that
// currency shows --, never a made-up 0.00%.
export function liveRates(rows, codes = MATRIX_CODES, fillFor = () => null) {
  const bySrc = new Map((rows || []).map((r) => [r.symbol, r]));
  const now = {};
  const prev = {};
  let oldest = null;
  let realTime = true;
  for (const c of codes) {
    if (c === 'USD') continue;
    const spec = LIVE_FX[c];
    const r = spec && bySrc.get(spec.src);
    let last = parseNum(r?.last);
    if (!r || Number(r.code) !== 0 || !(last > 0)) return null;
    const chg = parseChange(r.change);
    let before = Number.isFinite(chg) ? last - chg : null;
    const filled = noDayMove(r) ? filledRow(r, fillFor(spec.src)) : null;
    if (filled && filled.last > 0 && filled.prevClose > 0) {
      last = filled.last;
      before = filled.prevClose;
    }
    now[c] = spec.inverse ? 1 / last : last;
    prev[c] = before > 0 ? (spec.inverse ? 1 / before : before) : null;
    if (r.last_time && (!oldest || Date.parse(r.last_time) < Date.parse(oldest))) oldest = r.last_time;
    if (!(r.realTime === true || r.realTime === 'true')) realTime = false;
  }
  return { rates: now, prevRates: prev, asOf: oldest, realTime };
}

export function makeFxMatrix({ fetchImpl = globalThis.fetch, cache = createCache(), now = () => new Date() } = {}) {
  async function getLive() {
    try {
      const { value, stale, fetchedAt } = await cache.cached('fxmatrix:live', LIVE_TTL, async () => {
        const rows = await fetchCnbcRows(fetchImpl, Object.values(LIVE_FX).map((x) => x.src));
        // Weekend rows (no move): their daily closes, one bars call per pair, kept 10
        // minutes. A failed call leaves that pair's move unknown.
        const fills = new Map(await Promise.all(rows.filter(noDayMove).map(async (r) => {
          try {
            const got = await cache.cached(`fxmatrix:fill:${r.symbol}`, DAILY_FILL_TTL, () => fetchDailyMove(fetchImpl, r.symbol, now().getTime()));
            return [r.symbol, got.value];
          } catch {
            return [r.symbol, null];
          }
        })));
        const l = liveRates(rows, MATRIX_CODES, (src) => fills.get(src) || null);
        if (!l) throw new Error('quotes source: missing FX rows');
        return { matrix: crossRates(l.rates), prev: crossRates(l.prevRates), asOf: l.asOf, realTime: l.realTime };
      });
      return { ...value, stale, updated: iso(fetchedAt) };
    } catch {
      return null;
    }
  }

  async function getFxMatrix() {
    const { value, stale, fetchedAt } = await cache.cached('fxmatrix', TTL, async () => {
      const symbols = MATRIX_CODES.filter((c) => c !== 'USD').join(',');
      const url = `${BASE}/${isoDaysAgo(10, now())}..?base=USD&symbols=${symbols}`;
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`fx source HTTP ${res.status}`);
      const d = lastTwoDays(await res.json());
      return {
        codes: MATRIX_CODES,
        date: d.date,
        prevDate: d.prevDate,
        matrix: crossRates(d.rates),
        prev: d.prevRates ? crossRates(d.prevRates) : null,
      };
    });
    return { ...value, live: await getLive(), stale, updated: iso(fetchedAt) };
  }
  return { getFxMatrix };
}

export const { getFxMatrix } = makeFxMatrix();

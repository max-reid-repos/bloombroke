// FXMATRIX: cross rates for nine currencies from the Frankfurter API (ECB reference rates, no key).

import { createCache } from './cache.js';
import { iso } from './lists.js';
import { isoDaysAgo } from './fx.js';

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

export function makeFxMatrix({ fetchImpl = globalThis.fetch, cache = createCache(), now = () => new Date() } = {}) {
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
    return { ...value, stale, updated: iso(fetchedAt) };
  }
  return { getFxMatrix };
}

export const { getFxMatrix } = makeFxMatrix();

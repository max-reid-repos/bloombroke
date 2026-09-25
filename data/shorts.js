// SHORTS <ticker>: short interest by settlement date, from the Nasdaq short interest API
// (no key). Nasdaq publishes it for Nasdaq-listed stocks only. Cached a day.

import { createCache } from './cache.js';
import { money, usDay } from './lists.js';
import { CompanyDataError, DAY_MS, nasdaqData, tickerOrThrow, cachedOrThrow } from './company-kit.js';

export { CompanyDataError as ShortsError };

export const SHORTS_SOURCE = 'Nasdaq short interest (FINRA settlement dates)';

export function parseShorts(d) {
  const rows = (Array.isArray(d?.shortInterestTable?.rows) ? d.shortInterestTable.rows : []).map((r) => {
    const dtc = money(r.daysToCover);
    return {
      date: usDay(r.settlementDate),
      shortInterest: money(r.interest),
      avgVolume: money(r.avgDailyShareVolume),
      daysToCover: Number.isFinite(dtc) ? Math.round(dtc * 100) / 100 : null,
    };
  }).filter((r) => r.date && Number.isFinite(r.shortInterest))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  // Change against the settlement before it (the next row down).
  rows.forEach((r, i) => {
    const prev = rows[i + 1];
    r.change = prev ? r.shortInterest - prev.shortInterest : null;
    r.changePct = prev && prev.shortInterest ? Math.round(((r.shortInterest - prev.shortInterest) / prev.shortInterest) * 1e4) / 100 : null;
  });
  return rows.length ? { rows } : null;
}

export function makeShorts({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 500, retryMs: 60_000 }) } = {}) {
  async function getShorts(raw) {
    const ticker = tickerOrThrow(raw);
    const path = `quote/${encodeURIComponent(ticker)}/short-interest?assetClass=stocks`;
    const got = await cachedOrThrow(cache, `shorts:${ticker}`, DAY_MS, async () => parseShorts(await nasdaqData(fetchImpl, path)), {
      what: 'Short interest data',
      missing: `No short interest on file for ${ticker}. Nasdaq publishes it for Nasdaq-listed stocks only.`,
    });
    return { ticker, ...got.value, stale: got.stale, updated: got.updated, source: SHORTS_SOURCE };
  }
  return { getShorts };
}

export const { getShorts } = makeShorts();

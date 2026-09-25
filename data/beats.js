// BEATS <ticker>: reported EPS against the consensus estimate for the last quarters, from
// the Nasdaq earnings surprise API (no key). Nasdaq serves the last 4 quarters. Cached a day.

import { createCache } from './cache.js';
import { money, usDay } from './lists.js';
import { CompanyDataError, DAY_MS, nasdaqData, tickerOrThrow, cachedOrThrow, text } from './company-kit.js';

export { CompanyDataError as BeatsError };

export const BEATS_SOURCE = 'Nasdaq earnings surprise';

export function parseBeats(d) {
  const rows = (Array.isArray(d?.earningsSurpriseTable?.rows) ? d.earningsSurpriseTable.rows : []).map((r) => ({
    quarter: text(r.fiscalQtrEnd, 20),
    reported: usDay(r.dateReported),
    eps: money(r.eps),
    consensus: money(r.consensusForecast),
    surprisePct: money(r.percentageSurprise),
  })).filter((r) => r.quarter && Number.isFinite(r.eps))
    .sort((a, b) => ((a.reported || '') < (b.reported || '') ? 1 : -1))
    .slice(0, 8);
  return rows.length ? { rows } : null;
}

export function makeBeats({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 500, retryMs: 60_000 }) } = {}) {
  async function getBeats(raw) {
    const ticker = tickerOrThrow(raw);
    const path = `company/${encodeURIComponent(ticker)}/earnings-surprise`;
    const got = await cachedOrThrow(cache, `beats:${ticker}`, DAY_MS, async () => parseBeats(await nasdaqData(fetchImpl, path)), {
      what: 'Earnings data', missing: `No reported earnings on file for ${ticker}.`,
    });
    return { ticker, ...got.value, stale: got.stale, updated: got.updated, source: BEATS_SOURCE };
  }
  return { getBeats };
}

export const { getBeats } = makeBeats();

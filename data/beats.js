// BEATS <ticker>: reported EPS against the consensus estimate for the last quarters, from
// the Nasdaq earnings surprise API (no key). Nasdaq serves the last 4 quarters. Cached a day.

import { createCache } from './cache.js';
import { money, usDay, nyDay } from './lists.js';
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

// The next report date from the Nasdaq earnings-date page (Zacks' date; an asterisk or
// "estimated" means it is projected from past report dates, not announced), and the
// consensus EPS for that quarter when the text gives one. Past dates are dropped.
export function parseNextReport(d, today) {
  const t = String(d?.reportText || '');
  const m = /report(?:ed|s)? earnings on\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(t);
  if (!m) return null;
  const date = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (today && date < today)) return null;
  const c = /consensus EPS forecast for the quarter is \$\s*(-?\d+(?:\.\d+)?)/i.exec(t);
  return {
    date,
    estimated: /estimated to report/i.test(t) || /\*/.test(String(d?.announcement || '')),
    consensus: c ? Number(c[1]) : null,
  };
}

export function makeBeats({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 500, retryMs: 60_000 }), now = () => Date.now() } = {}) {
  // Best effort: a missing next date never fails the screen.
  async function nextReport(ticker) {
    try {
      const got = await cache.cached(`beats-next:${ticker}`, DAY_MS, async () => {
        const d = await nasdaqData(fetchImpl, `analyst/${encodeURIComponent(ticker)}/earnings-date`);
        return parseNextReport(d, null) || { none: true };
      });
      const v = got.value;
      return v && !v.none && v.date >= nyDay(now()) ? v : null;
    } catch {
      return null;
    }
  }

  async function getBeats(raw) {
    const ticker = tickerOrThrow(raw);
    const path = `company/${encodeURIComponent(ticker)}/earnings-surprise`;
    const [got, next] = await Promise.all([
      cachedOrThrow(cache, `beats:${ticker}`, DAY_MS, async () => parseBeats(await nasdaqData(fetchImpl, path)), {
        what: 'Earnings data', missing: `No reported earnings on file for ${ticker}.`,
      }),
      nextReport(ticker),
    ]);
    return { ticker, ...got.value, next, stale: got.stale, updated: got.updated, source: BEATS_SOURCE };
  }
  return { getBeats };
}

export const { getBeats } = makeBeats();

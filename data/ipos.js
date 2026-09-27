// IPOS: the IPO calendar (upcoming, priced, filed), from the Nasdaq IPO calendar API
// (no key; data from EDGAR Online). Nasdaq serves one month per call: upcoming comes from
// this month and next, priced and filed from this month and last. Cached an hour.

import { createCache } from './cache.js';
import { money, usDay, nyDay } from './lists.js';
import { CompanyDataError, HOUR_MS, nasdaqData, cachedOrThrow, text, symbolOf } from './company-kit.js';

export { CompanyDataError as IposError };

export const IPOS_SOURCE = 'Exchange calendars';

// "2026-09" plus n months.
export function monthOf(dayStr, n = 0) {
  const d = new Date(`${dayStr.slice(0, 7)}-15T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

// "40.00-44.00" -> { low: 40, high: 44 }; "10.00" -> { low: 10, high: 10 }.
export function priceRange(s) {
  const parts = String(s ?? '').split('-').map((p) => money(p));
  if (!parts.length || !Number.isFinite(parts[0])) return { low: null, high: null };
  return { low: parts[0], high: Number.isFinite(parts[1]) ? parts[1] : parts[0] };
}

function ipoRow(r, dateKey) {
  const { low, high } = priceRange(r.proposedSharePrice);
  return {
    id: text(r.dealID, 40),
    date: usDay(r[dateKey]),
    company: text(r.companyName, 90),
    symbol: symbolOf(r.proposedTickerSymbol),
    exchange: text(r.proposedExchange, 40),
    priceLow: low,
    priceHigh: high,
    shares: money(r.sharesOffered),
    amount: money(r.dollarValueOfSharesOffered),
  };
}

const rowsOf = (t) => (Array.isArray(t?.rows) ? t.rows : []);

// One month's body -> { upcoming, priced, filed }.
export function parseIpoMonth(d) {
  return {
    upcoming: rowsOf(d?.upcoming?.upcomingTable).map((r) => ipoRow(r, 'expectedPriceDate')).filter((r) => r.company),
    priced: rowsOf(d?.priced).map((r) => ipoRow(r, 'pricedDate')).filter((r) => r.company),
    filed: rowsOf(d?.filed).map((r) => ipoRow(r, 'filedDate')).filter((r) => r.company),
  };
}

// Months (oldest first) -> the three lists, de-duplicated by deal, sorted by date.
export function mergeIpoMonths(months) {
  const pick = (key, idx, dir) => {
    const seen = new Set();
    const out = [];
    for (const i of idx) {
      for (const r of months[i]?.[key] || []) {
        const k = r.id || `${r.company}:${r.date}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
      }
    }
    return out.sort((a, b) => ((a.date || '') < (b.date || '') ? -dir : (a.date || '') > (b.date || '') ? dir : 0));
  };
  // months: [last, this, next]
  return { upcoming: pick('upcoming', [1, 2], 1), priced: pick('priced', [0, 1], -1), filed: pick('filed', [0, 1], -1) };
}

export function makeIpos({ fetchImpl = globalThis.fetch, cache = createCache({ retryMs: 60_000 }), now = () => Date.now() } = {}) {
  async function getIpos() {
    const today = nyDay(now());
    const months = [-1, 0, 1].map((n) => monthOf(today, n));
    const got = await cachedOrThrow(cache, `ipos:${months[1]}`, HOUR_MS, async () => {
      const bodies = await Promise.all(months.map((m) => nasdaqData(fetchImpl, `ipo/calendar?date=${m}`)));
      const merged = mergeIpoMonths(bodies.map(parseIpoMonth));
      return merged.upcoming.length || merged.priced.length || merged.filed.length ? merged : null;
    }, { what: 'IPO data', missing: 'No IPOs listed right now.' });
    return { ...got.value, today, stale: got.stale, updated: got.updated, source: IPOS_SOURCE };
  }
  return { getIpos };
}

export const { getIpos } = makeIpos();

// DIVIDENDS: dividend history and yield from the Nasdaq API (no key). Nasdaq only has the
// payment history for Nasdaq-listed stocks; for the rest (NYSE and others) the yearly
// dividend and yield come from the CNBC quote service instead, with no history.

import { createCache } from './cache.js';
import { normalizeTicker, fetchCnbcRows, tickerSource } from './quotes.js';
import { getNasdaq, money, usDay, iso } from './lists.js';

const TTL = 6 * 60 * 60_000;

export class DividendsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function parseDividends(body) {
  const d = body?.data;
  if (!d) return null;
  const rows = (Array.isArray(d.dividends?.rows) ? d.dividends.rows : [])
    .map((r) => ({
      exDate: usDay(r.exOrEffDate),
      type: String(r.type || '').trim() || null,
      amount: money(r.amount),
      currency: typeof r.currency === 'string' ? r.currency : null,
      declared: usDay(r.declarationDate),
      record: usDay(r.recordDate),
      paid: usDay(r.paymentDate),
    }))
    .filter((r) => r.exDate && Number.isFinite(r.amount))
    .sort((a, b) => (a.exDate < b.exDate ? 1 : -1));
  return {
    yield: money(d.yield),
    annual: money(d.annualizedDividend),
    exDate: usDay(d.exDividendDate),
    payDate: usDay(d.dividendPaymentDate),
    rows,
  };
}

// Cash paid per calendar year (by ex-date), newest first.
export function yearlyTotals(rows) {
  const by = new Map();
  for (const r of rows) {
    const y = r.exDate.slice(0, 4);
    const cur = by.get(y) || { year: y, total: 0, count: 0 };
    cur.total += r.amount;
    cur.count += 1;
    by.set(y, cur);
  }
  return [...by.values()].sort((a, b) => (a.year < b.year ? 1 : -1)).map((y) => ({ ...y, total: Math.round(y.total * 1e6) / 1e6 }));
}

// CNBC quote row -> { yield, annual } (both may be null).
export function parseCnbcDividend(r) {
  if (!r || Number(r.code) !== 0) return null;
  return { yield: money(r.dividendyield), annual: money(r.dividend) };
}

export function makeDividends({ fetchImpl = globalThis.fetch, cache = createCache() } = {}) {
  async function getDividends(raw) {
    const ticker = normalizeTicker(raw);
    if (!ticker) throw new DividendsError('bad_symbol', 'That does not look like a ticker.');
    let got;
    try {
      got = await cache.cached(`dividends:${ticker}`, TTL, async () => {
        const d = parseDividends(await getNasdaq(fetchImpl, `quote/${encodeURIComponent(ticker)}/dividends?assetclass=stocks`));
        if (d && d.rows.length) return { ...d, history: true };
        const rows = await fetchCnbcRows(fetchImpl, [tickerSource(ticker)]);
        const c = parseCnbcDividend(rows[0]);
        if (!c && !d) return null;
        return { yield: c?.yield ?? d?.yield ?? null, annual: c?.annual ?? d?.annual ?? null, exDate: d?.exDate || null, payDate: d?.payDate || null, rows: [], history: false };
      });
    } catch {
      throw new DividendsError('unavailable', 'Dividend data is taking a break. Try again in a minute.');
    }
    if (!got.value) throw new DividendsError('not_found', `No dividend data for ${ticker}.`);
    return { ticker, ...got.value, years: yearlyTotals(got.value.rows), stale: got.stale, updated: iso(got.fetchedAt) };
  }
  return { getDividends };
}

export const { getDividends } = makeDividends();

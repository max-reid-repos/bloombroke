// FEDPATH: the Fed funds rate the futures market prices in, month by month.
// - 30-day Fed funds futures (CBOT), CNBC quote service @FF.1 to @FF.12, no key, delayed.
//   Each contract settles on 100 minus the average effective Fed funds rate of its month,
//   so 100 minus the price is the average rate the market is paying for that month.
// - The target range and today's effective rate: New York Fed, via data/rates.js.
// Every contract the source lists is asked for (it lists 16 months ahead; the symbols
// past the last one answer "unknown" and are skipped). A month with no price yet, or
// missing between two listed months, stays in the list as a gap (price null), so the
// chart and the table never close up around it.

import { createCache } from './cache.js';
import { fetchCnbcRows, parseNum, parseChange } from './quotes.js';
import { getRates } from './rates.js';

export const FF_MONTHS = 18;
export const FF_SYMBOLS = Array.from({ length: FF_MONTHS }, (_, i) => `@FF.${i + 1}`);
const TTL = 5 * 60_000;

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

// The contract month, "2026-10": from the expiry date (the last business day of the
// month), else from the name "Fed Funds 30-Day Future (Oct'26)".
export function contractMonthOf(r) {
  const exp = String(r?.expiration_date ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(exp)) return exp.slice(0, 7);
  const m = /\(([A-Za-z]{3})'(\d{2})\)/.exec(String(r?.name ?? ''));
  const mm = m && MONTHS[m[1].toUpperCase()];
  return mm ? `20${m[2]}-${mm}` : null;
}

// 100 minus the futures price, in percent. Rounded to 4 places to drop float noise.
export function impliedRate(price) {
  return Number.isFinite(price) ? Math.round((100 - price) * 10_000) / 10_000 : null;
}

// Basis points between two rates in percent.
export function bpBetween(a, b) {
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) * 1000) / 10 : null;
}

// CNBC rows -> one row per contract month, in month order. Rows without a price are left out.
export function parseFedFutures(rows) {
  const out = [];
  for (const r of rows || []) {
    if (!r || Number(r.code) !== 0) continue;
    // parseNum('') is 0, and 100 minus 0 is not a rate: a blank price is no price.
    const price = /\d/.test(String(r.last ?? '')) ? parseNum(r.last) : NaN;
    const month = contractMonthOf(r);
    if (!Number.isFinite(price) || !month) continue;
    const change = parseChange(r.change);
    out.push({
      symbol: r.symbol,
      month,
      price,
      // UNCH is the source saying unchanged; a missing change is unknown (null, shown --).
      change: Number.isFinite(change) ? change : String(r.change ?? '').trim().toUpperCase() === 'UNCH' ? 0 : null,
      implied: impliedRate(price),
      asOf: r.last_time || null,
      realTime: r.realTime === true || r.realTime === 'true',
    });
  }
  const seen = new Set();
  return out.sort((a, b) => (a.month < b.month ? -1 : 1)).filter((r) => (seen.has(r.month) ? false : seen.add(r.month)));
}

const nextMonth = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

// Priced rows + the raw rows -> one row per calendar month from the first to the last
// month the source lists; months without a price are { month, price: null, gap }.
export function withGaps(priced, raw) {
  const listed = (raw || []).filter((r) => r && Number(r.code) === 0).map(contractMonthOf).filter(Boolean);
  const all = [...listed, ...priced.map((r) => r.month)].sort();
  if (!all.length) return priced;
  const by = new Map(priced.map((r) => [r.month, r]));
  const listedSet = new Set(listed);
  const out = [];
  for (let m = all[0]; m <= all[all.length - 1]; m = nextMonth(m)) {
    out.push(by.get(m) || { symbol: null, month: m, price: null, change: null, implied: null, asOf: null, realTime: false, gap: listedSet.has(m) ? 'no price yet' : 'not listed by the source' });
  }
  return out;
}

export function makeFedPath({ fetchImpl = globalThis.fetch, cache = createCache(), rates = getRates } = {}) {
  async function getFedPath() {
    const [fut, rt] = await Promise.allSettled([
      cache.cached('fedpath', TTL, async () => {
        const raw = await fetchCnbcRows(fetchImpl, FF_SYMBOLS);
        const rows = parseFedFutures(raw);
        if (rows.length < 3) throw new Error('quotes source: too few Fed funds futures');
        return withGaps(rows, raw);
      }),
      rates(),
    ]);
    if (fut.status === 'rejected') throw fut.reason;
    const fed = rt.status === 'fulfilled' ? rt.value.fed : null;
    const effective = Number.isFinite(fed?.effective) ? fed.effective : null;
    return {
      months: fut.value.value.map((r) => ({ ...r, vsEffective: bpBetween(r.implied, effective) })),
      fed,
      stale: fut.value.stale || (rt.status === 'fulfilled' && rt.value.stale),
      updated: new Date(fut.value.fetchedAt).toISOString(),
      source: 'CBOT 30-day Fed funds futures from a market data provider (delayed); target range and effective rate: public web data',
    };
  }
  return { getFedPath };
}

export const { getFedPath } = makeFedPath();

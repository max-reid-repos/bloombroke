// VALUE <ticker>: valuation and quality numbers exactly as the CNBC quote service gives
// them (no key; fund=1 fields). Nothing is computed here: a field CNBC leaves out stays
// empty (the screen shows --). CNBC has no price/book field, so there is none here.
// Also: the P/E and dividend yield for a whole list of symbols, for SCREEN.
// The last price is the live quote (the same one the quote screen shows, 15 s cache)
// with its trade time; the valuation numbers are the fund snapshot (15 min cache)
// with its own time. Both times are sent, so a gap between screens is explained.

import { createCache } from './cache.js';
import { fetchCnbcRows, fetchStockRows, tickerSource, getQuote } from './quotes.js';
import { money, capNum } from './lists.js';
import { CompanyDataError, cachedOrThrow, tickerOrThrow, text } from './company-kit.js';

export { CompanyDataError as ValueError };

const TTL = 15 * 60_000;
export const VALUE_SOURCE = 'CNBC quote service';

// "09/22/26" -> "2026-09-22"
export function cnbcDay(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(s ?? '').trim());
  return m ? `20${m[3]}-${m[1]}-${m[2]}` : null;
}

// One CNBC row -> the VALUE numbers, or null when CNBC does not know the symbol.
export function parseValue(r) {
  if (!r || Number(r.code) !== 0 || !Number.isFinite(money(r.last))) return null;
  return {
    name: text(r.name, 90),
    type: text(r.type, 20),
    exchange: text(r.exchange, 20),
    currency: text(r.currencyCode, 3),
    last: money(r.last),
    asOf: typeof r.last_time === 'string' ? r.last_time : null,
    pe: money(r.pe),
    forwardPe: money(r.fpe),
    eps: money(r.eps),
    forwardEps: money(r.feps),
    priceToSales: money(r.psales),
    dividend: money(r.dividend),
    dividendYield: money(r.dividendyield),
    roe: money(r.ROETTM),
    netMargin: money(r.NETPROFTTM),
    grossMargin: money(r.GROSMGNTTM),
    debtToEquity: money(r.DEBTEQTYQ),
    beta: money(r.beta),
    yearHigh: money(r.yrhiprice),
    yearHighDate: cnbcDay(r.yrhidate),
    yearLow: money(r.yrloprice),
    yearLowDate: cnbcDay(r.yrlodate),
    marketCap: capNum(r.mktcapView),
    sharesOut: capNum(r.sharesout),
    revenue: capNum(r.revenuettm),
  };
}

// CNBC rows -> Map(symbol -> { pe, divYield }) for the rows that carry either number.
export function parseFundMap(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r || Number(r.code) !== 0 || typeof r.symbol !== 'string') continue;
    const pe = money(r.pe);
    const divYield = money(r.dividendyield);
    if (pe === null && divYield === null) continue;
    out.set(r.symbol.toUpperCase(), { pe, divYield });
  }
  return out;
}

export function makeValue({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 500 }), quote = fetchImpl === globalThis.fetch ? getQuote : null } = {}) {
  async function getValue(raw) {
    const ticker = tickerOrThrow(raw);
    const got = await cachedOrThrow(cache, `value:${ticker}`, TTL, async () => {
      const rows = await fetchStockRows(fetchImpl, [tickerSource(ticker)]);
      return parseValue(rows[0]);
    }, { what: 'Quote data', missing: `No ticker called ${ticker}.` });
    // The live last price and its trade time; the snapshot's own when the quote fails.
    let live = null;
    if (quote) {
      try { live = await quote(ticker); } catch { live = null; }
    }
    const lastLive = live && Number.isFinite(live.last) && live.asOf;
    return {
      ticker,
      ...got.value,
      last: lastLive ? live.last : got.value.last,
      lastAsOf: lastLive ? live.asOf : got.value.asOf,
      lastRealTime: lastLive ? Boolean(live.realTime) : null,
      fundAsOf: got.value.asOf,
      stale: got.stale,
      updated: got.updated,
      source: VALUE_SOURCE,
    };
  }

  // symbols -> Map(symbol -> { pe, divYield }). Batches of 200, six at a time. A failed
  // batch leaves its symbols out; more than a quarter failing throws.
  async function getFundMap(symbols, { batch = 200, parallel = 6 } = {}) {
    const chunks = [];
    for (let i = 0; i < symbols.length; i += batch) chunks.push(symbols.slice(i, i + batch));
    const out = new Map();
    let failed = 0;
    for (let i = 0; i < chunks.length; i += parallel) {
      const done = await Promise.allSettled(chunks.slice(i, i + parallel).map((c) => fetchCnbcRows(fetchImpl, c)));
      for (const d of done) {
        if (d.status === 'rejected') { failed += 1; continue; }
        for (const [k, v] of parseFundMap(d.value)) out.set(k, v);
      }
    }
    if (chunks.length && failed > chunks.length / 4) throw new Error(`cnbc fund: ${failed} of ${chunks.length} batches failed`);
    return out;
  }

  return { getValue, getFundMap };
}

export const { getValue, getFundMap } = makeValue();

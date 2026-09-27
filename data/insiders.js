// INSIDERS <ticker>: recent insider transactions and the 3 and 12 month totals, from the
// Nasdaq insider activity API (no key; it wants browser headers). Cached a day.

import { createCache } from './cache.js';
import { money, usDay } from './lists.js';
import { CompanyDataError, DAY_MS, nasdaqData, tickerOrThrow, cachedOrThrow, text } from './company-kit.js';

export { CompanyDataError as InsidersError };

const LIMIT = 200;
export const INSIDERS_SOURCE = 'Market data provider, from SEC Forms 3, 4 and 5';

// Nasdaq's transaction words -> a short kind. The source text is kept as `transaction`.
export function insiderKind(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'buy') return 'BUY';
  if (s === 'sell') return 'SELL';
  if (s.includes('automatic') && s.includes('sell')) return 'PLAN SELL';
  if (s.includes('automatic') && s.includes('buy')) return 'PLAN BUY';
  if (s.includes('option')) return 'OPTION';
  if (s.startsWith('acquisition')) return 'AWARD';
  if (s.startsWith('disposition')) return 'DISPOSED';
  return s ? 'OTHER' : null;
}

// The summary tables: { m3: {...}, m12: {...} } with trade counts and share counts.
function periodTotals(d) {
  const trades = Array.isArray(d?.numberOfTrades?.rows) ? d.numberOfTrades.rows : [];
  const shares = Array.isArray(d?.numberOfSharesTraded?.rows) ? d.numberOfSharesTraded.rows : [];
  const pick = (rows, re, col) => money(rows.find((r) => re.test(String(r.insiderTrade || '')))?.[col]);
  const one = (col) => ({
    buys: pick(trades, /open market buys/i, col),
    sells: pick(trades, /number of sells/i, col),
    trades: pick(trades, /total insider trades/i, col),
    sharesBought: pick(shares, /shares bought/i, col),
    sharesSold: pick(shares, /shares sold/i, col),
    netShares: pick(shares, /net activity/i, col),
  });
  return { m3: one('months3'), m12: one('months12') };
}

export function parseInsiders(d) {
  if (!d) return null;
  const table = d.transactionTable?.table;
  const rows = (Array.isArray(table?.rows) ? table.rows : []).map((r) => {
    const shares = money(r.sharesTraded);
    const price = money(r.lastPrice);
    return {
      date: usDay(r.lastDate),
      insider: text(r.insider, 60),
      title: text(r.relation, 60),
      transaction: text(r.transactionType, 60),
      kind: insiderKind(r.transactionType),
      ownType: text(r.ownType, 20),
      shares,
      price: price && price > 0 ? price : null,
      // Value = shares x price, both as filed. No price (awards, option exercises) = no value.
      value: Number.isFinite(shares) && price > 0 ? Math.round(shares * price * 100) / 100 : null,
      held: money(r.sharesHeld),
    };
  }).filter((r) => r.date && r.insider);
  const totals = periodTotals(d);
  const hasTotals = Object.values(totals.m12).some((v) => v !== null);
  if (!rows.length && !hasTotals) return null;
  return { rows, totals, totalRecords: money(d.transactionTable?.totalRecords) };
}

export function makeInsiders({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 500, retryMs: 60_000 }) } = {}) {
  async function getInsiders(raw) {
    const ticker = tickerOrThrow(raw);
    const path = `company/${encodeURIComponent(ticker)}/insider-trades?limit=${LIMIT}&type=ALL&sortColumn=lastDate&sortOrder=DESC`;
    const got = await cachedOrThrow(cache, `insiders:${ticker}`, DAY_MS, async () => parseInsiders(await nasdaqData(fetchImpl, path)), {
      what: 'Insider data', missing: `No insider transactions on file for ${ticker}.`,
    });
    return { ticker, ...got.value, stale: got.stale, updated: got.updated, source: INSIDERS_SOURCE };
  }
  // A new Form 4 for this company (data/edgarwatch.js): the next view asks Nasdaq again.
  const forget = (ticker) => cache.forget(`insiders:${ticker}`);
  return { getInsiders, forget };
}

export const { getInsiders, forget: forgetInsiders } = makeInsiders();

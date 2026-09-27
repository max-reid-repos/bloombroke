// WHATIF with your own purchase: the prices behind it. Split-adjusted daily closes from
// the same CNBC daily bars the charts use (price only, like the rest of WHATIF), kept
// per ticker for the New York day; today's price is the live quote.
//
// Rules, the same as the catalogue's habits: a date means its first trading day on or
// after it (2015 is the first trading day of 2015, a Saturday is the Monday after), and
// a habit buys once a month, on the first trading day.

import { createCache } from './cache.js';
import { shapeBars, readJson } from './charts.js';
import { getQuote, tickerSource, UA, weekendPlaceholder } from './quotes.js';
import { nyToday } from '../public/ranges.js';
import { WhatifError } from './whatif.js';

const BARS_URL = 'https://ts-api.cnbc.com/harmony/app/bars';
export const MINE_SOURCE = 'CNBC daily closes, split-adjusted, price only';

const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const stampOf = (day) => day.replace(/-/g, '');

// Every daily close of a ticker: [[YYYY-MM-DD, close], ...] oldest first, weekend
// placeholder bars left out. One fetch per ticker per New York day (cached).
export function makeDaily({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 150, lru: true }), now = () => new Date() } = {}) {
  return async function daily(ticker) {
    const today = nyToday(now());
    const { value } = await cache.cached(`mine:${ticker}:${today}`, 24 * 3600_000, async () => {
      const end = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10);
      const url = `${BARS_URL}/${encodeURIComponent(tickerSource(ticker))}/1D/19700101000000/${stampOf(end)}000000/adjusted/EST5EDT.json`;
      const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`daily bars HTTP ${res.status}`);
      const body = await readJson(res);
      return shapeBars(body?.barData?.priceBars, { volume: false })
        .filter((p) => !weekendPlaceholder(p))
        .map((p) => [iso(p.d), p.v]);
    });
    return value;
  };
}
export const dailyCloses = makeDaily();

// The first close on or after a day, or null.
export function onOrAfter(closes, day) {
  let lo = 0;
  let hi = closes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (closes[mid][0] < day) lo = mid + 1; else hi = mid;
  }
  return lo < closes.length ? { date: closes[lo][0], close: closes[lo][1] } : null;
}

// { 'YYYY-MM': { date, close } }: the first trading day of each month from `from` on.
export function firstOfMonths(closes, from) {
  const out = {};
  for (const [d, v] of closes) {
    const k = d.slice(0, 7);
    if (k >= from && !(k in out)) out[k] = { date: d, close: v };
  }
  return out;
}

// items: parsed MY items (public/whatif-mine.js). Returns, per ticker, the live quote
// and the closes the maths needs:
//   { quotes: { T: { price, stale, asOf } }, company: { T: name }, buys: { id: { date, close } },
//     monthly: { 'MY:T': { 'YYYY-MM': { date, close } } } }
// Throws WhatifError with a plain message when a ticker is not a stock or ETF, or its
// history here does not reach back to the date.
export async function loadMine(items, { quoteImpl = getQuote, dailyImpl = dailyCloses } = {}) {
  const out = { quotes: {}, company: {}, buys: {}, monthly: {} };
  const tickers = [...new Set(items.map((i) => i.ticker))];
  const got = await Promise.all(tickers.map(async (t) => {
    const [q, closes] = await Promise.all([
      Promise.resolve().then(() => quoteImpl(t)).catch(() => null),
      Promise.resolve().then(() => dailyImpl(t)).catch(() => null),
    ]);
    return [t, q, closes];
  }));
  for (const [t, q, closes] of got) {
    if (!q && !closes?.length) throw new WhatifError('mine_ticker', `No stock called ${t}.`);
    if (q && !(q.kind === 'stock' && (!q.type || q.type === 'STOCK'))) throw new WhatifError('mine_ticker', `${t} is not a stock or an ETF. Your own purchase works with stocks and ETFs.`);
    if (!closes?.length) throw new WhatifError('unavailable', `No price history for ${t} right now. Try again in a minute.`);
    const live = q && Number.isFinite(q.last) && q.last > 0;
    const last = closes[closes.length - 1];
    out.quotes[t] = live ? { price: q.last, stale: Boolean(q.stale), asOf: q.asOf } : { price: last[1], stale: true, asOf: last[0] };
    out.company[t] = (q?.name || t).slice(0, 48);
  }
  const byTicker = Object.fromEntries(got.map(([t, , closes]) => [t, closes]));
  const firstDay = (t) => byTicker[t][0][0];
  for (const item of items) {
    const closes = byTicker[item.ticker];
    const want = item.kind === 'once' ? item.date.day : `${item.start}-01`;
    if (want < firstDay(item.ticker)) {
      throw new WhatifError('mine_history', `${item.ticker} price history here starts on ${firstDay(item.ticker)}. Pick that date or later.`);
    }
    const key = `MY:${item.ticker}`;
    if (item.kind === 'once') {
      const buy = onOrAfter(closes, item.date.day);
      if (!buy) throw new WhatifError('mine_history', `${item.ticker} has no close on or after ${item.date.day} yet.`);
      out.buys[item.id] = buy;
    }
    const from = item.kind === 'once' ? out.buys[item.id].date.slice(0, 7) : item.start;
    const months = firstOfMonths(closes, from);
    out.monthly[key] = { ...months, ...(out.monthly[key] || {}) };
  }
  return out;
}

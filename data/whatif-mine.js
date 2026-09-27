// WHATIF with your own purchase: the prices behind it. Split-adjusted daily closes from
// the same CNBC daily bars the charts use (price only, like the rest of WHATIF), kept
// per ticker for the New York day; today's price is the live quote.
//
// Which close a date buys at:
//   an exact day (2015-03-07)   that day's close, or the last trading day before it (a
//                               Saturday buys at Friday's close), as in the catalogue
//   a year or a month (2015)    the first trading day of that year or month
//   a habit                     once a month, on the first trading day, like the catalogue

import { createCache } from './cache.js';
import { shapeBars, readJson } from './charts.js';
import { getQuote, tickerSource, UA, weekendPlaceholder } from './quotes.js';
import { nyToday } from '../public/ranges.js';
import { MAX_TICKERS } from '../public/whatif-mine.js';
import { WhatifError } from './whatif.js';

const BARS_URL = 'https://ts-api.cnbc.com/harmony/app/bars';
export const MINE_SOURCE = 'Daily closes from a market data provider, split-adjusted, price only';
// The daily closes kept in memory, all tickers together: about 12 bytes a trading day,
// so a ticker with 45 years of history is about 140 KB.
export const DAILY_CACHE_BYTES = 16 * 1024 * 1024;

const iso = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const stampOf = (day) => day.replace(/-/g, '');
const DAY = 86_400_000;
export const dayNumber = (isoDay) => Math.round(Date.parse(`${isoDay}T00:00:00Z`) / DAY);
export const dayString = (n) => new Date(n * DAY).toISOString().slice(0, 10);

// Closes kept compactly: { days: Int32Array (days since 1970), closes: Float64Array }.
// pairs: [[YYYY-MM-DD, close], ...] oldest first (tests and fakes pass these).
export function compact(pairs) {
  if (pairs && pairs.days instanceof Int32Array) return pairs;
  const list = Array.isArray(pairs) ? pairs : [];
  const days = new Int32Array(list.length);
  const closes = new Float64Array(list.length);
  list.forEach(([d, v], i) => { days[i] = dayNumber(d); closes[i] = v; });
  return { days, closes };
}
export const compactBytes = (c) => (c?.days?.byteLength || 0) + (c?.closes?.byteLength || 0);

// Leading bars with no trades (a placeholder before real trading, such as AAPL on
// 11 Dec 1980) are dropped, so the first date offered is a real one.
export function dropLeadingEmpty(points) {
  const first = points.findIndex((p) => p.x > 0);
  return first > 0 ? points.slice(first) : points;
}

// Every daily close of a ticker, compact, weekend placeholders out. One fetch per
// ticker per New York day, the cache bounded by bytes.
export function makeDaily({
  fetchImpl = globalThis.fetch,
  cache = createCache({ lru: true, weigh: compactBytes, maxWeight: DAILY_CACHE_BYTES, maxEntries: 400 }),
  now = () => new Date(),
} = {}) {
  return async function daily(ticker) {
    const today = nyToday(now());
    const { value } = await cache.cached(`mine:${ticker}:${today}`, 24 * 3600_000, async () => {
      const end = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * DAY).toISOString().slice(0, 10);
      const url = `${BARS_URL}/${encodeURIComponent(tickerSource(ticker))}/1D/19700101000000/${stampOf(end)}000000/adjusted/EST5EDT.json`;
      const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`daily bars HTTP ${res.status}`);
      const body = await readJson(res);
      const points = dropLeadingEmpty(shapeBars(body?.barData?.priceBars).filter((p) => !weekendPlaceholder(p)));
      return compact(points.map((p) => [iso(p.d), p.v]));
    });
    return value;
  };
}
export const dailyCloses = makeDaily();

// Index of the first day >= n.
function lowerBound(days, n) {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] < n) lo = mid + 1; else hi = mid;
  }
  return lo;
}
const at = (c, i) => ({ date: dayString(c.days[i]), close: c.closes[i] });

// The first close on or after a day, or null.
export function onOrAfter(pairs, day) {
  const c = compact(pairs);
  const i = lowerBound(c.days, dayNumber(day));
  return i < c.days.length ? at(c, i) : null;
}
// The close on a day, or the last one before it, or null.
export function onOrBefore(pairs, day) {
  const c = compact(pairs);
  const n = dayNumber(day);
  const i = lowerBound(c.days, n);
  if (i < c.days.length && c.days[i] === n) return at(c, i);
  return i > 0 ? at(c, i - 1) : null;
}

// { 'YYYY-MM': { date, close } }: the first trading day of each month from `from` on.
export function firstOfMonths(pairs, from) {
  const c = compact(pairs);
  const out = {};
  for (let i = lowerBound(c.days, dayNumber(`${from}-01`)); i < c.days.length; i += 1) {
    const d = dayString(c.days[i]);
    const k = d.slice(0, 7);
    if (!(k in out)) out[k] = { date: d, close: c.closes[i] };
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
  if (tickers.length > MAX_TICKERS) throw new WhatifError('bad_mine', `Up to ${MAX_TICKERS} stocks of your own in one WHATIF.`);
  const got = await Promise.all(tickers.map(async (t) => {
    const [q, closes] = await Promise.all([
      Promise.resolve().then(() => quoteImpl(t)).catch(() => null),
      Promise.resolve().then(() => dailyImpl(t)).then(compact).catch(() => null),
    ]);
    return [t, q, closes];
  }));
  for (const [t, q, closes] of got) {
    if (!q && !closes?.days.length) throw new WhatifError('mine_ticker', `No stock called ${t}.`);
    if (q && !(q.kind === 'stock' && (!q.type || q.type === 'STOCK'))) throw new WhatifError('mine_ticker', `${t} is not a stock or an ETF. Your own purchase works with stocks and ETFs.`);
    if (!closes?.days.length) throw new WhatifError('unavailable', `No price history for ${t} right now. Try again in a minute.`);
    const live = q && Number.isFinite(q.last) && q.last > 0;
    const last = at(closes, closes.days.length - 1);
    out.quotes[t] = live ? { price: q.last, stale: Boolean(q.stale), asOf: q.asOf } : { price: last.close, stale: true, asOf: last.date };
    out.company[t] = (q?.name || t).slice(0, 48);
  }
  const byTicker = Object.fromEntries(got.map(([t, , closes]) => [t, closes]));
  const firstDay = (t) => dayString(byTicker[t].days[0]);
  for (const item of items) {
    const closes = byTicker[item.ticker];
    const want = item.kind === 'once' ? item.date.day : `${item.start}-01`;
    if (want < firstDay(item.ticker)) {
      throw new WhatifError('mine_history', `${item.ticker} price history here starts on ${firstDay(item.ticker)}. Pick that date or later.`);
    }
    const key = `MY:${item.ticker}`;
    if (item.kind === 'once') {
      // An exact day: its close or the last before; a year or month: its first trading day.
      const buy = item.date.level === 'day' ? onOrBefore(closes, item.date.day) : onOrAfter(closes, item.date.day);
      if (!buy) throw new WhatifError('mine_history', `${item.ticker} has no close for ${item.date.word} yet.`);
      out.buys[item.id] = buy;
    }
    const from = item.kind === 'once' ? out.buys[item.id].date.slice(0, 7) : item.start;
    const months = firstOfMonths(closes, from);
    out.monthly[key] = { ...months, ...(out.monthly[key] || {}) };
  }
  return out;
}

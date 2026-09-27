// Chart event flags for a stock: earnings (E), ex-dividend days (D) and other 8-K
// filings (N, the filing days of 8-Ks without item 2.02: E already covers earnings).
//   Earnings: the days the company filed an 8-K with item 2.02 (results of operations)
//   with the SEC, each linked to its filing, plus the next earnings date from the CNBC
//   quote service (marked estimated when the source says so).
//   Ex-dividend: the dividend history (data/dividends.js, split-adjusted amounts), or,
//   when there is no history, the last ex-dividend day from the CNBC quote service.
// Only stocks: registry instruments (indexes, FX, crypto, futures, yields) get none.
// Each source may fail on its own; the flags that did load are still shown.

import { createCache } from './cache.js';
import { normalizeTicker, fetchCnbcRows, tickerSource } from './quotes.js';
import { usDay, money } from './lists.js';
import { instrumentById } from '../public/instruments.js';
import { getFilings as defaultGetFilings, NEWS_MAX_AGE_MS } from './filings.js';
import { getDividends as defaultGetDividends } from './dividends.js';
import { filingText } from '../public/eightk.js';

const TTL = 15 * 60_000; // the 8-K list behind E and N flags is at most 15 minutes old
const MAX_FLAGS = 400;

export class ChartEventsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// FILINGS rows -> [{ date, url }]: 8-Ks (not amendments) with item 2.02, oldest first.
export function earningsFrom8K(rows) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (String(r?.form || '').toUpperCase() !== '8-K') continue;
    if (!Array.isArray(r.items) || !r.items.includes('2.02')) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.filed || '') || seen.has(r.filed)) continue;
    seen.add(r.filed);
    out.push({ date: r.filed, url: typeof r.url === 'string' && r.url.startsWith('https://www.sec.gov/') ? r.url : null });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-MAX_FLAGS);
}

// FILINGS rows -> [{ date, url, text }]: 8-Ks (and amendments) without item 2.02, oldest
// first, text in plain words ("8-K: executive change").
export function other8K(rows) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const form = String(r?.form || '').toUpperCase();
    if (form !== '8-K' && form !== '8-K/A') continue;
    const items = Array.isArray(r.items) ? r.items : [];
    if (items.includes('2.02')) continue;
    const url = typeof r.url === 'string' && r.url.startsWith('https://www.sec.gov/') ? r.url : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.filed || '') || seen.has(url || `${r.filed}:${items}`)) continue;
    seen.add(url || `${r.filed}:${items}`);
    out.push({ date: r.filed, url, text: filingText(items, form) });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(-MAX_FLAGS);
}

// DIVIDENDS rows -> [{ date, amount }] (amount null when unknown), oldest first.
export function exDivFromRows(rows) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r?.exDate || '') && !seen.has(r.exDate) && seen.add(r.exDate))
    .map((r) => ({ date: r.exDate, amount: Number.isFinite(r.amount) ? r.amount : null }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-MAX_FLAGS);
}

// CNBC EventData -> { next: { date, est } | null, exDiv: { date, amount } | null }.
// "10/28/2026(est)" is an estimated date.
export function parseEventData(ev) {
  if (!ev || typeof ev !== 'object') return { next: null, exDiv: null };
  const raw = String(ev.next_earnings_date || '').trim();
  const date = usDay(raw.replace(/\(.*\)$/, '').trim());
  const exDate = usDay(String(ev.div_ex_date || '').trim());
  const amount = money(ev.div_amount);
  return {
    next: date ? { date, est: /\(est\)/i.test(raw) } : null,
    exDiv: exDate ? { date: exDate, amount: Number.isFinite(amount) && amount > 0 ? amount : null } : null,
  };
}

export function makeChartEvents({
  fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 500 }),
  getFilings = defaultGetFilings, getDividends = defaultGetDividends,
} = {}) {
  async function cnbcEvents(ticker) {
    const rows = await fetchCnbcRows(fetchImpl, [tickerSource(ticker)], { events: '1' });
    return parseEventData(rows?.[0]?.EventData);
  }

  async function getChartEvents(raw) {
    const ticker = normalizeTicker(raw);
    if (!ticker) throw new ChartEventsError('bad_symbol', 'That does not look like a ticker.');
    if (instrumentById(ticker)) return { ticker, earnings: [], next: null, dividends: [], filings: [] };
    const got = await cache.cached(`chart-events:${ticker}`, TTL, async () => {
      const [fil, div, cn] = await Promise.allSettled([getFilings(ticker, '8-K', { maxAgeMs: NEWS_MAX_AGE_MS }), getDividends(ticker), cnbcEvents(ticker)]);
      const earnings = fil.status === 'fulfilled' ? earningsFrom8K(fil.value.rows) : [];
      const filings = fil.status === 'fulfilled' ? other8K(fil.value.rows) : [];
      let dividends = div.status === 'fulfilled' ? exDivFromRows(div.value.rows) : [];
      const ev = cn.status === 'fulfilled' ? cn.value : { next: null, exDiv: null };
      if (!dividends.length && ev.exDiv) dividends = [ev.exDiv];
      return { earnings, next: ev.next, dividends, filings };
    });
    return { ticker, ...got.value, updated: new Date(got.fetchedAt).toISOString() };
  }
  return { getChartEvents };
}

export const { getChartEvents } = makeChartEvents();

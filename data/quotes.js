// Market quotes. Every source lives behind a small function so it can be swapped later.
// Current source: the public CNBC quote service (no key). Keep it server side only.

import { createCache } from './cache.js';

export const INSTRUMENTS = [
  { id: 'SPX', name: 'S&P 500', group: 'Stocks', decimals: 2, src: '.SPX' },
  { id: 'NDX', name: 'Nasdaq 100', group: 'Stocks', decimals: 2, src: '.NDX' },
  { id: 'DJI', name: 'Dow', group: 'Stocks', decimals: 2, src: '.DJI' },
  { id: 'FTSE', name: 'FTSE 100', group: 'Stocks', decimals: 2, src: '.FTSE' },
  { id: 'N225', name: 'Nikkei 225', group: 'Stocks', decimals: 2, src: '.N225' },
  { id: 'DAX', name: 'DAX', group: 'Stocks', decimals: 2, src: '.GDAXI' },
  { id: 'GOLD', name: 'Gold', group: 'Commodities', decimals: 2, src: '@GC.1' },
  { id: 'WTI', name: 'Oil (WTI)', group: 'Commodities', decimals: 2, src: '@CL.1' },
  { id: 'BTC', name: 'Bitcoin', group: 'Crypto', decimals: 0, src: 'BTC.CM=' },
  { id: 'EURUSD', name: 'EUR/USD', group: 'Currencies', decimals: 4, src: 'EUR=' },
  { id: 'USDJPY', name: 'USD/JPY', group: 'Currencies', decimals: 2, src: 'JPY=' },
];

// Majors against the US dollar, quoted the way traders quote them.
export const FX_MAJORS = [
  { id: 'EURUSD', pair: 'EUR/USD', base: 'EUR', quote: 'USD', decimals: 4, src: 'EUR=' },
  { id: 'GBPUSD', pair: 'GBP/USD', base: 'GBP', quote: 'USD', decimals: 4, src: 'GBP=' },
  { id: 'USDJPY', pair: 'USD/JPY', base: 'USD', quote: 'JPY', decimals: 2, src: 'JPY=' },
  { id: 'USDCHF', pair: 'USD/CHF', base: 'USD', quote: 'CHF', decimals: 4, src: 'CHF=' },
  { id: 'USDCNY', pair: 'USD/CNY', base: 'USD', quote: 'CNY', decimals: 4, src: 'CNY=' },
  { id: 'USDTHB', pair: 'USD/THB', base: 'USD', quote: 'THB', decimals: 2, src: 'THB=' },
];

export const YIELDS = [
  { id: 'US2Y', name: 'US 2-year Treasury', term: '2Y', src: 'US2Y' },
  { id: 'US10Y', name: 'US 10-year Treasury', term: '10Y', src: 'US10Y' },
  { id: 'US30Y', name: 'US 30-year Treasury', term: '30Y', src: 'US30Y' },
];

// Friendly names for indexes, so SPX works like a ticker.
export const TICKER_ALIASES = { SPX: '.SPX', NDX: '.NDX', DJI: '.DJI', DOW: '.DJI', FTSE: '.FTSE', N225: '.N225', DAX: '.GDAXI' };
export const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

const QUOTES_TTL = 5 * 60_000;
export const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CNBC_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';

export function parseNum(s) {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string') return NaN;
  const n = Number(s.replace(/[,%+\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function numOrNull(s) {
  const n = parseNum(s);
  return Number.isFinite(n) ? n : null;
}

// "aapl" -> "AAPL"; anything that is not ticker shaped -> null.
export function normalizeTicker(raw) {
  const t = String(raw ?? '').trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

export function tickerSource(ticker) {
  return TICKER_ALIASES[ticker] || ticker;
}

export async function fetchCnbcRows(fetchImpl, symbols) {
  const qs = new URLSearchParams({
    symbols: symbols.join('|'),
    requestMethod: 'itv', noform: '1', partnerId: '2', fund: '1', exthrs: '1', output: 'json',
  });
  const res = await fetchImpl(`${CNBC_URL}?${qs}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`quotes source HTTP ${res.status}`);
  const body = await res.json();
  let rows = body?.FormattedQuoteResult?.FormattedQuote;
  if (rows && !Array.isArray(rows)) rows = [rows];
  if (!Array.isArray(rows)) throw new Error('quotes source: unexpected shape');
  return rows;
}

// Rows for a fixed list ({ id, src, ... }) -> [{ ...item, last, change, changePct, asOf }].
export function parseListRows(list, rows) {
  const bySrc = new Map(rows.map((r) => [r.symbol, r]));
  const out = [];
  for (const item of list) {
    const r = bySrc.get(item.src);
    const last = parseNum(r?.last);
    if (!r || !Number.isFinite(last)) continue;
    const change = parseNum(r.change);
    const changePct = parseNum(r.change_pct);
    const { src, ...rest } = item;
    out.push({
      ...rest,
      last,
      change: Number.isFinite(change) ? change : 0,
      changePct: Number.isFinite(changePct) ? changePct : 0,
      asOf: r.last_time || null,
    });
  }
  return out;
}

// One CNBC row -> a single quote for the ticker screen, or null if the symbol is unknown.
export function parseQuoteRow(r, ticker = r?.symbol) {
  if (!r || Number(r.code) !== 0) return null;
  const last = parseNum(r.last);
  if (!Number.isFinite(last)) return null;
  const x = r.ExtendedMktQuote;
  const extLast = parseNum(x?.last);
  return {
    ticker,
    symbol: r.symbol,
    name: r.name || r.shortName || ticker,
    type: r.type || null,
    exchange: r.exchange || null,
    currency: r.currencyCode || null,
    last,
    change: numOrNull(r.change) ?? 0,
    changePct: numOrNull(r.change_pct) ?? 0,
    asOf: r.last_time || null,
    marketCap: r.mktcapView || null,
    high52: numOrNull(r.yrhiprice),
    low52: numOrNull(r.yrloprice),
    pe: numOrNull(r.pe),
    eps: numOrNull(r.eps),
    divYield: r.dividendyield || null,
    volume: r.volume_alt || null,
    open: numOrNull(r.open) || null,
    high: numOrNull(r.high) || null,
    low: numOrNull(r.low) || null,
    prevClose: numOrNull(r.previous_day_closing),
    extended: x && Number.isFinite(extLast) ? {
      session: x.type === 'POST_MKT' ? 'AFTER HOURS' : x.type === 'PRE_MKT' ? 'PRE-MARKET' : 'EXTENDED',
      last: extLast,
      change: numOrNull(x.change) ?? 0,
      changePct: numOrNull(x.change_pct) ?? 0,
      asOf: x.last_time || null,
    } : null,
  };
}

export function makeQuotes({ fetchImpl = globalThis.fetch, cache = createCache() } = {}) {
  async function list(key, items, minRows) {
    const { value, stale, fetchedAt } = await cache.cached(key, QUOTES_TTL, async () => {
      const rows = await fetchCnbcRows(fetchImpl, items.map((i) => i.src));
      const out = parseListRows(items, rows);
      if (out.length < minRows) throw new Error(`quotes source: too few rows for ${key}`);
      return out;
    });
    return { value, stale, updated: new Date(fetchedAt).toISOString() };
  }

  return {
    async getQuotes() {
      const { value, stale, updated } = await list('quotes', INSTRUMENTS, INSTRUMENTS.length / 2);
      return { instruments: value, stale, updated };
    },
    async getFxMajors() {
      const { value, stale, updated } = await list('fxmajors', FX_MAJORS, FX_MAJORS.length / 2);
      return { pairs: value, stale, updated };
    },
    async getYields() {
      const { value, stale, updated } = await list('yields', YIELDS, 1);
      return { yields: value, stale, updated };
    },
    // Resolves to null for an unknown ticker.
    async getQuote(rawTicker) {
      const ticker = normalizeTicker(rawTicker);
      if (!ticker) return null;
      const { value, stale, fetchedAt } = await cache.cached(`quote:${ticker}`, QUOTES_TTL, async () => {
        const rows = await fetchCnbcRows(fetchImpl, [tickerSource(ticker)]);
        return { quote: parseQuoteRow(rows[0], ticker) };
      });
      if (!value.quote) return null;
      return { ...value.quote, stale, updated: new Date(fetchedAt).toISOString() };
    },
  };
}

export const { getQuotes, getFxMajors, getYields, getQuote } = makeQuotes();

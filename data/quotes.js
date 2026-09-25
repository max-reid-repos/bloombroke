// Market quotes. Every source lives behind getQuotes() so it can be swapped later.
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

const QUOTES_TTL = 5 * 60_000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CNBC_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';

export function parseNum(s) {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string') return NaN;
  const n = Number(s.replace(/[,%+\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

async function fetchCnbc(fetchImpl) {
  const qs = new URLSearchParams({
    symbols: INSTRUMENTS.map((i) => i.src).join('|'),
    requestMethod: 'itv', noform: '1', partnerId: '2', fund: '1', exthrs: '1', output: 'json',
  });
  const res = await fetchImpl(`${CNBC_URL}?${qs}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`quotes source HTTP ${res.status}`);
  const body = await res.json();
  const rows = body?.FormattedQuoteResult?.FormattedQuote;
  if (!Array.isArray(rows)) throw new Error('quotes source: unexpected shape');
  const bySrc = new Map(rows.map((r) => [r.symbol, r]));

  const out = [];
  for (const inst of INSTRUMENTS) {
    const r = bySrc.get(inst.src);
    const last = parseNum(r?.last);
    if (!r || !Number.isFinite(last)) continue;
    const change = parseNum(r.change);
    const changePct = parseNum(r.change_pct);
    out.push({
      id: inst.id, name: inst.name, group: inst.group, decimals: inst.decimals,
      last,
      change: Number.isFinite(change) ? change : 0,
      changePct: Number.isFinite(changePct) ? changePct : 0,
      asOf: r.last_time || null,
    });
  }
  if (out.length < INSTRUMENTS.length / 2) throw new Error('quotes source: too few rows');
  return out;
}

export function makeQuotes({ fetchImpl = globalThis.fetch, cache = createCache() } = {}) {
  return {
    async getQuotes() {
      const { value, stale, fetchedAt } = await cache.cached('quotes', QUOTES_TTL, () => fetchCnbc(fetchImpl));
      return { instruments: value, stale, updated: new Date(fetchedAt).toISOString() };
    },
  };
}

export const { getQuotes } = makeQuotes();

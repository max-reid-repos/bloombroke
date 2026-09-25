// Market quotes. Every source lives behind a small function so it can be swapped later.
// Current source: the public CNBC quote service (no key). Keep it server side only.

import { createCache } from './cache.js';
import { INSTRUMENTS as ALL, FX_MAJOR_IDS, YIELD_IDS, instrumentById, resolveInstrument } from '../public/instruments.js';

// The MARKETS list (with CNBC symbols), the FX majors and the Treasury yields all come
// from the shared registry in public/instruments.js.
export const INSTRUMENTS = ALL.filter((i) => i.markets);
export const FX_MAJORS = FX_MAJOR_IDS.map(instrumentById).map((i) => ({ ...i, pair: i.name }));
export const YIELDS = YIELD_IDS.map(instrumentById).map((i) => ({ ...i, name: i.longName }));

export const TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// Quotes are shared by every visitor: one upstream call per 15 seconds per key,
// however many people are watching (the cache de-duplicates calls in flight).
export const QUOTES_TTL = 15_000;
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

// "aapl" -> "AAPL"; "gold" -> "GOLD" (a registry id); anything else -> null.
export function normalizeTicker(raw) {
  const inst = resolveInstrument(raw);
  if (inst) return inst.id;
  const t = String(raw ?? '').trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

// Our id -> the CNBC symbol. Plain stock tickers are the same in both.
export function tickerSource(ticker) {
  return instrumentById(ticker)?.src || ticker;
}

// CNBC says realTime for US stocks (Nasdaq Last Sale), US indexes, FX, crypto and
// yields; futures and most non-US indexes are delayed.
export function freshness(r) {
  return {
    realTime: r?.realTime === true || r?.realTime === 'true',
    marketState: r?.curmktstatus || null,
  };
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
    const { src, aliases, markets, ...rest } = item;
    out.push({
      ...rest,
      last,
      change: Number.isFinite(change) ? change : 0,
      changePct: Number.isFinite(changePct) ? changePct : 0,
      asOf: r.last_time || null,
      ...freshness(r),
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
  const inst = instrumentById(ticker);
  return {
    ticker,
    symbol: r.symbol,
    name: r.name || r.shortName || ticker,
    label: inst?.name || null,
    kind: inst?.kind || 'stock',
    decimals: inst?.decimals ?? null,
    ...freshness(r),
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
  // Every registry instrument in one upstream call: MARKETS, HOME, the tape, the FX
  // majors, the yields and each instrument screen all read from it.
  async function batch() {
    return cache.cached('quotes:all', QUOTES_TTL, async () => {
      const rows = await fetchCnbcRows(fetchImpl, ALL.map((i) => i.src));
      const ok = rows.filter((r) => Number(r.code) === 0 && Number.isFinite(parseNum(r.last)));
      if (ok.length < ALL.length / 2) throw new Error('quotes source: too few rows');
      return rows;
    });
  }

  async function list(items) {
    const { value, stale, fetchedAt } = await batch();
    return { value: parseListRows(items, value), stale, updated: new Date(fetchedAt).toISOString() };
  }

  return {
    async getQuotes() {
      const { value, stale, updated } = await list(INSTRUMENTS);
      return { instruments: value, stale, updated };
    },
    async getFxMajors() {
      const { value, stale, updated } = await list(FX_MAJORS);
      return { pairs: value, stale, updated };
    },
    async getYields() {
      const { value, stale, updated } = await list(YIELDS);
      return { yields: value, stale, updated };
    },
    // Resolves to null for an unknown ticker.
    async getQuote(rawTicker) {
      const ticker = normalizeTicker(rawTicker);
      if (!ticker) return null;
      const inst = instrumentById(ticker);
      if (inst) {
        const { value, stale, fetchedAt } = await batch();
        const quote = parseQuoteRow(value.find((r) => r.symbol === inst.src), ticker);
        return quote ? { ...quote, stale, updated: new Date(fetchedAt).toISOString() } : null;
      }
      const { value, stale, fetchedAt } = await cache.cached(`quote:${ticker}`, QUOTES_TTL, async () => {
        const rows = await fetchCnbcRows(fetchImpl, [ticker]);
        return { quote: parseQuoteRow(rows[0], ticker) };
      });
      if (!value.quote) return null;
      return { ...value.quote, stale, updated: new Date(fetchedAt).toISOString() };
    },
  };
}

export const { getQuotes, getFxMajors, getYields, getQuote } = makeQuotes({ cache: createCache({ maxEntries: 2000 }) });

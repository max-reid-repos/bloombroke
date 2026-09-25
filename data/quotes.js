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
    us: inst ? Boolean(inst.us) : true,
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
  // The source now and then leaves a row out of a batch. The last good row for that
  // symbol fills the gap, so a table row does not blink out for 15 seconds.
  const lastGood = new Map();
  const valid = (r) => r && Number(r.code) === 0 && Number.isFinite(parseNum(r.last));
  async function batch() {
    return cache.cached('quotes:all', QUOTES_TTL, async () => {
      const rows = await fetchCnbcRows(fetchImpl, ALL.map((i) => i.src));
      const ok = rows.filter(valid);
      if (ok.length < ALL.length / 2) throw new Error('quotes source: too few rows');
      for (const r of ok) lastGood.set(r.symbol, r);
      const have = new Set(ok.map((r) => r.symbol));
      return [...ok, ...ALL.filter((i) => !have.has(i.src) && lastGood.has(i.src)).map((i) => lastGood.get(i.src))];
    });
  }

  async function list(items) {
    const { value, stale, fetchedAt } = await batch();
    return { value: parseListRows(items, value), stale, updated: new Date(fetchedAt).toISOString() };
  }

  const api = {
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
    // Many symbols at once (WATCH, PORTFOLIO, HOME): named instruments come from the
    // shared batch, stocks from the per-ticker cache. The stocks that are not cached
    // share one upstream call. Unknown or failed symbols are listed in `missing`.
    async getQuoteList(rawTickers) {
      const tickers = [...new Set(rawTickers.map(normalizeTicker).filter(Boolean))].slice(0, MAX_LIST);
      const stocks = tickers.filter((t) => !instrumentById(t));
      let shared = null;
      let failed = null;
      const fetchStocks = () => {
        shared ||= fetchCnbcRows(fetchImpl, stocks).then((rows) => {
          const bySym = new Map(rows.map((r) => [String(r.symbol || '').toUpperCase(), r]));
          // One symbol asked, one row back: the same rule as getQuote. Otherwise match by
          // symbol only, so a row can never land on the wrong ticker.
          return (t) => bySym.get(t) || (stocks.length === 1 && rows.length === 1 ? rows[0] : undefined);
        });
        return shared;
      };
      const one = async (t) => {
        try {
          if (instrumentById(t)) return await api.getQuote(t);
          const { value, stale, fetchedAt } = await cache.cached(`quote:${t}`, QUOTES_TTL, async () => {
            const pick = await fetchStocks();
            return { quote: parseQuoteRow(pick(t), t) };
          });
          return value.quote ? { ...value.quote, stale, updated: new Date(fetchedAt).toISOString() } : null;
        } catch (err) {
          failed = err;
          return null;
        }
      };
      const got = await Promise.all(tickers.map(one));
      const quotes = got.filter(Boolean);
      const missing = tickers.filter((t, i) => !got[i]);
      // Nothing came back and the source failed: an outage, not a list of bad symbols.
      if (!quotes.length && failed) throw failed;
      const updated = quotes.map((q) => q.updated).sort()[0] || new Date().toISOString();
      return { quotes, missing, stale: quotes.some((q) => q.stale), updated };
    },
  };
  return api;
}

// The most symbols one /api/quotes call takes.
export const MAX_LIST = 60;

export const { getQuotes, getFxMajors, getYields, getQuote, getQuoteList } = makeQuotes({ cache: createCache({ maxEntries: 2000 }) });

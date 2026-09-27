// OPTIONS: the option chain for one US stock, ETF or index, from Cboe's public delayed
// quotes (no key, delayed 15 minutes). One download per symbol holds every expiry; it is
// parsed once into a compact shape and shared for a few minutes.

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { UA } from './quotes.js';

const BASE = 'https://cdn.cboe.com/api/global/delayed_quotes/options';
const TTL = 5 * 60_000;
const INDEX_TTL = 15 * 60_000;

// Indexes Cboe lists under a leading underscore.
export const INDEX_ROOTS = { SPX: '_SPX', NDX: '_NDX', RUT: '_RUT', VIX: '_VIX' };
export const OPTIONS_TICKER_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

export class OptionsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// "AAPL261016C00150000" -> { root: 'AAPL', expiry: '2026-10-16', type: 'C', strike: 150 }.
export function parseContract(sym) {
  const m = /^(.+?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(sym ?? ''));
  if (!m) return null;
  return { root: m[1], expiry: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5], strike: Number(m[6]) / 1000 };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Cboe reports 0 when it has no implied vol, so 0 means missing, not 0%.
const pos = (v) => (num(v) !== null && v > 0 ? v : null);

// "2026-09-25 15:26:53" (UTC) -> ISO.
export function cboeTime(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(String(s ?? '').trim());
  return m ? `${m[1]}T${m[2]}Z` : null;
}

function side(o) {
  return {
    bid: num(o.bid),
    ask: num(o.ask),
    last: pos(o.last_trade_price),
    volume: num(o.volume),
    oi: num(o.open_interest),
    iv: pos(o.iv),
    delta: num(o.delta),
  };
}

// Cboe body -> { underlying, asOf, expiries: [{ id, date, root, rows }] }.
// Roots that end in a digit are adjusted contracts (after a split or merger) and are left out.
// A date with more than one standard root (SPX and SPXW) lists each root on its own.
export function parseChain(body) {
  const d = body?.data;
  if (!d || !Array.isArray(d.options)) throw new Error('options source: unexpected shape');
  const groups = new Map();
  for (const o of d.options) {
    const c = parseContract(o?.option);
    if (!c || /\d$/.test(c.root) || !(c.strike > 0)) continue;
    const key = `${c.expiry}|${c.root}`;
    let g = groups.get(key);
    if (!g) { g = { date: c.expiry, root: c.root, strikes: new Map() }; groups.set(key, g); }
    let row = g.strikes.get(c.strike);
    if (!row) { row = { strike: c.strike, call: null, put: null }; g.strikes.set(c.strike, row); }
    row[c.type === 'C' ? 'call' : 'put'] = side(o);
  }
  const dates = new Map();
  for (const g of groups.values()) dates.set(g.date, (dates.get(g.date) || 0) + 1);
  const expiries = [...groups.values()]
    .sort((a, b) => (a.date === b.date ? a.root.localeCompare(b.root) : a.date < b.date ? -1 : 1))
    .map((g) => ({
      id: dates.get(g.date) > 1 ? `${g.date}-${g.root}` : g.date,
      date: g.date,
      root: g.root,
      rows: [...g.strikes.values()].sort((a, b) => a.strike - b.strike),
    }));
  return {
    underlying: {
      price: num(d.current_price),
      change: num(d.price_change),
      changePct: num(d.price_change_percent),
      prevClose: num(d.prev_day_close),
      iv30: pos(d.iv30),
    },
    asOf: cboeTime(body.timestamp),
    expiries,
  };
}

// Whole days from `today` (YYYY-MM-DD) to an expiry date.
export function daysTo(date, today) {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

// The expiry to show: the one asked for, or the nearest that has not passed.
export function pickExpiry(expiries, wanted, today) {
  if (wanted) return expiries.find((e) => e.id === wanted || e.date === wanted) || null;
  return expiries.find((e) => e.date >= today) || expiries[0] || null;
}

const nyToday = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export function makeOptions({ fetchImpl = cappedFetch, cache = createCache({ maxEntries: 40 }), now = () => Date.now() } = {}) {
  async function load(symbol) {
    const src = INDEX_ROOTS[symbol] || symbol;
    return cache.cached(`options:${symbol}`, INDEX_ROOTS[symbol] ? INDEX_TTL : TTL, async () => {
      const res = await fetchImpl(`${BASE}/${encodeURIComponent(src)}.json`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      });
      // Cboe answers 403 for a symbol it has no options for.
      if (res.status === 403 || res.status === 404) return null;
      if (!res.ok) throw new Error(`options source HTTP ${res.status}`);
      return parseChain(await res.json());
    });
  }

  async function getOptions(rawSymbol, rawExpiry) {
    const symbol = String(rawSymbol ?? '').trim().toUpperCase();
    if (!OPTIONS_TICKER_RE.test(symbol)) throw new OptionsError('bad_symbol', 'That does not look like a ticker.');
    const { value, stale, fetchedAt } = await load(symbol);
    if (!value || !value.expiries.length) throw new OptionsError('not_found', `No listed options for ${symbol}.`);
    const wanted = rawExpiry ? String(rawExpiry).trim().toUpperCase() : null;
    const today = nyToday(now());
    const exp = pickExpiry(value.expiries, wanted, today);
    if (!exp) throw new OptionsError('no_expiry', `${symbol} has no options expiring ${wanted}.`);
    return {
      symbol,
      underlying: value.underlying,
      asOf: value.asOf,
      expiries: value.expiries.map((e) => ({ id: e.id, date: e.date, root: e.root, days: daysTo(e.date, today), strikes: e.rows.length })),
      expiry: { id: exp.id, date: exp.date, root: exp.root, days: daysTo(exp.date, today) },
      rows: exp.rows,
      source: 'Market data provider, delayed 15 minutes',
      delayedMinutes: 15,
      stale,
      updated: new Date(fetchedAt).toISOString(),
    };
  }

  return { getOptions };
}

export const { getOptions } = makeOptions();

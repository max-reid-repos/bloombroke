// Symbol search for the command bar: our named instruments first, then US stocks and
// ETFs from the public CNBC symbol lookup service (no key). If the lookup is down,
// the named instruments still match.

import { createCache } from './cache.js';
import { UA, TICKER_RE } from './quotes.js';
import { searchInstruments, resolveInstrument } from '../public/instruments.js';

const LOOKUP_URL = 'https://symlookup.cnbc.com/symservice/symlookup.do';
const SEARCH_TTL = 24 * 60 * 60_000;
export const QUERY_RE = /^[A-Z0-9 .&/-]{1,24}$/;

export function cleanQuery(raw) {
  const q = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return QUERY_RE.test(q) ? q : null;
}

// CNBC lookup rows -> [{ id, name, kind }], US listed stocks and ETFs our router can open.
export function parseLookup(body) {
  const rows = Array.isArray(body) ? body.slice(1) : [];
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const id = String(r?.symbolName || '').toUpperCase();
    // A stock whose symbol is one of our names (GOLD, BTC) would open the wrong screen.
    if (!TICKER_RE.test(id) || seen.has(id) || resolveInstrument(id)) continue;
    if (r.countryCode !== 'US' || !['STOCK', 'ETF'].includes(r.issueType)) continue;
    seen.add(id);
    out.push({ id, name: String(r.companyName || id).slice(0, 80), kind: r.issueType === 'ETF' ? 'etf' : 'stock' });
  }
  return out;
}

export function makeSearch({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 5000 }) } = {}) {
  async function lookup(q) {
    const qs = new URLSearchParams({ prefix: q, partnerid: '20064', pgok: '1', pgsize: '12' });
    const res = await fetchImpl(`${LOOKUP_URL}?${qs}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`lookup source HTTP ${res.status}`);
    return parseLookup(await res.json());
  }

  async function search(raw, limit = 10) {
    const q = cleanQuery(raw);
    if (!q) return { query: '', results: [] };
    const named = searchInstruments(q, 6).map((i) => ({ id: i.id, name: i.name, kind: i.kind }));
    let stocks = [];
    let degraded = false;
    try {
      stocks = (await cache.cached(`sym:${q}`, SEARCH_TTL, () => lookup(q))).value;
    } catch {
      degraded = true;
    }
    const seen = new Set(named.map((r) => r.id));
    const results = [...named, ...stocks.filter((r) => !seen.has(r.id))].slice(0, limit);
    return { query: q, results, degraded };
  }

  return { search };
}

export const { search } = makeSearch();

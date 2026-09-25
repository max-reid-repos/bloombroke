// SCREEN: every stock listed on Nasdaq, NYSE and NYSE American, from the Nasdaq
// stock screener (no key; it wants browser headers). One download of about 7,000
// rows, shared by every visitor for an hour. Filtering happens here with the pure
// functions in public/screener.js.
//
// Nasdaq's screener has no P/E or dividend yield columns, so there are no filters
// for them: we do not mix in numbers from another source.

import { createCache } from './cache.js';
import { UA } from './quotes.js';
import { parseScreenArgs, applyScreen, screenWords, sortOf, SCREEN_ERRORS } from '../public/screener.js';

const HOUR = 60 * 60_000;
const BASE = 'https://api.nasdaq.com/api/screener/stocks';
const DOWNLOAD_URL = `${BASE}?tableonly=true&download=true`;
const ASOF_URL = `${BASE}?tableonly=true&limit=1&offset=0`;
export const MAX_LIMIT = 10_000;

const HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

export class ScreenError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// "$172.84" -> 172.84, "4.549%" -> 4.549, "" / "NA" -> null.
export function num(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = String(s ?? '').replace(/[$,%\s]/g, '');
  if (!t || !/^-?\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// "Apple Inc. Common Stock" -> "Apple Inc."
export function cleanName(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().replace(/\s+(Common Stock|Common Shares|Ordinary Shares)$/i, '').slice(0, 90);
}

// Nasdaq's "BRK/A" is BRK.A everywhere else.
export function cleanSymbol(s) {
  return String(s ?? '').trim().toUpperCase().replace('/', '.');
}

export function parseScreenerRows(body) {
  const rows = body?.data?.rows;
  if (!Array.isArray(rows) || !rows.length) throw new Error('screener: unexpected shape');
  return rows.map((r) => {
    const cap = num(r.marketCap);
    return {
      symbol: cleanSymbol(r.symbol),
      name: cleanName(r.name),
      last: num(r.lastsale),
      changePct: num(r.pctchange),
      marketCap: cap && cap > 0 ? cap : null,
      volume: num(r.volume),
      sector: String(r.sector || '').trim(),
      industry: String(r.industry || '').trim(),
      country: String(r.country || '').trim(),
    };
  }).filter((r) => r.symbol);
}

// "Last price as of Sep 24, 2026" -> "2026-09-24"
export function parseAsOf(body) {
  const s = String(body?.data?.asof || '');
  const m = /([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})/.exec(s);
  if (!m) return null;
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[1]) + 1;
  return mon ? `${m[3]}-${String(mon).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

export function makeScreen({ fetchImpl = globalThis.fetch, cache = createCache({ retryMs: 60_000 }) } = {}) {
  async function get(url) {
    const res = await fetchImpl(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`screener HTTP ${res.status}`);
    return res.json();
  }

  const universe = () => cache.cached('screen:all', HOUR, async () => {
    const [rows, asOf] = await Promise.allSettled([get(DOWNLOAD_URL), get(ASOF_URL)]);
    if (rows.status === 'rejected') throw rows.reason;
    return { rows: parseScreenerRows(rows.value), asOf: asOf.status === 'fulfilled' ? parseAsOf(asOf.value) : null };
  });

  // words: what follows SCREEN. limit: how many rows to send back.
  async function getScreen(words, limit = 100) {
    const spec = parseScreenArgs(words || '');
    if (spec.error) throw new ScreenError(spec.error, SCREEN_ERRORS[spec.error](spec.bad));
    const n = Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit)) || 100));
    const u = await universe();
    const matches = applyScreen(u.value.rows, spec);
    return {
      spec: screenWords(spec),
      sort: sortOf(spec),
      count: matches.length,
      total: u.value.rows.length,
      rows: matches.slice(0, n),
      asOf: u.value.asOf,
      updated: new Date(u.fetchedAt).toISOString(),
      stale: u.stale,
      source: 'Nasdaq stock screener',
    };
  }

  return { getScreen };
}

export const { getScreen } = makeScreen();

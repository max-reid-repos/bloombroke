// Shared helpers for the extra commands: fixed CNBC quote lists and Nasdaq JSON.

import { createCache } from './cache.js';
import { fetchCnbcRows, parseListRows, UA } from './quotes.js';

export const iso = (ms) => new Date(ms).toISOString();

// A fixed list of CNBC symbols ({ id, src, ... }) behind a stale-if-error cache.
// Resolves to { rows, stale, updated }. `extra(rawRow)` adds fields from the raw CNBC row.
export function makeCnbcList({ key, items, minRows = Math.ceil(items.length / 2), ttl = 5 * 60_000, extra = null, fetchImpl = globalThis.fetch, cache = createCache() }) {
  return async function get() {
    const { value, stale, fetchedAt } = await cache.cached(key, ttl, async () => {
      const rows = await fetchCnbcRows(fetchImpl, items.map((i) => i.src));
      const bySrc = new Map(rows.map((r) => [r.symbol, r]));
      const srcOf = new Map(items.map((i) => [i.id, i.src]));
      const out = parseListRows(items, rows).map((o) => (extra ? { ...o, ...extra(bySrc.get(srcOf.get(o.id))) } : o));
      if (out.length < minRows) throw new Error(`quotes source: too few rows for ${key}`);
      return out;
    });
    return { rows: value, stale, updated: iso(fetchedAt) };
  };
}

// api.nasdaq.com answers a browser-like request only.
export const NASDAQ_HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

export async function getNasdaq(fetchImpl, path) {
  const res = await fetchImpl(`https://api.nasdaq.com/api/${path}`, { headers: NASDAQ_HEADERS, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`nasdaq source HTTP ${res.status}`);
  const body = await res.json();
  if (!body || typeof body !== 'object') throw new Error('nasdaq source: unexpected shape');
  return body;
}

// "$1,246,465,280" -> 1246465280, "($0.25)" -> -0.25, "N/A" or "" -> null.
export function money(s) {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t || !/\d/.test(t)) return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const n = Number(t.replace(/[()$,%\s+-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// "4.885T" / "465.087B" / "912.3M" -> a number.
export function capNum(s) {
  const m = /^\s*([\d,.]+)\s*([KMBT])?\s*$/i.exec(String(s ?? ''));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return n * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] || '').toUpperCase()] || 1);
}

// "09/24/2026" -> "2026-09-24"
export function usDay(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s ?? '').trim());
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

// A timestamp -> "YYYY-MM-DD" in New York.
export function nyDay(ms) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function isIsoDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

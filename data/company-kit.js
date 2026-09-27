// Shared bits for the company-data commands (INSIDERS, OWNERS, FILINGS, SHORTS, BEATS,
// VALUE, IPOS, SPLITS, EXDIV): one error type, the Nasdaq call with its status check,
// and a cached loader that turns source failures into a friendly error.

import { getNasdaq, iso } from './lists.js';
import { companyTicker } from './quotes.js';

export const DAY_MS = 24 * 60 * 60_000;
export const HOUR_MS = 60 * 60_000;

export class CompanyDataError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Nasdaq answers 200 with status.rCode 400 for an unknown symbol, and 200 with data
// null (or empty tables) when it has nothing. Returns the data object or null.
export async function nasdaqData(fetchImpl, path) {
  const body = await getNasdaq(fetchImpl, path);
  const code = Number(body?.status?.rCode);
  if (code && code !== 200) return null;
  return body.data && typeof body.data === 'object' ? body.data : null;
}

// A ticker from the words, or a bad_symbol error. "$DOW" (the stock) is DOW.
export function tickerOrThrow(raw) {
  const t = companyTicker(raw);
  if (!t) throw new CompanyDataError('bad_symbol', 'That does not look like a ticker.');
  return t;
}

// cache.cached with the source's failure turned into CompanyDataError('unavailable').
// load() returns the parsed value or null (null = the source has nothing: not_found).
export async function cachedOrThrow(cache, key, ttl, load, { what, missing }) {
  let got;
  try {
    got = await cache.cached(key, ttl, load);
  } catch {
    throw new CompanyDataError('unavailable', `${what} is taking a break. Try again in a minute.`);
  }
  if (!got.value) throw new CompanyDataError('not_found', missing);
  return { value: got.value, stale: got.stale, updated: iso(got.fetchedAt) };
}

export const text = (s, max = 120) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '') || null;

// Nasdaq symbols in calendars: "BRK/B" -> "BRK.B"; null when it is not a ticker we can open.
export function symbolOf(s) {
  const t = String(s ?? '').trim().toUpperCase().replace('/', '.');
  return /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/.test(t) ? t : null;
}

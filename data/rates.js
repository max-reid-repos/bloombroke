// The interest rates that touch your money.
// - Treasury yields: CNBC quote service (the shared batch in quotes.js), no key.
// - Fed funds target range: New York Fed Markets API (EFFR), no key.
// - Mortgage rates: Freddie Mac Primary Mortgage Market Survey CSV, no key.

import { createCache } from './cache.js';
import { makeQuotes, sharedQuotes, UA } from './quotes.js';

const DAY = 24 * 60 * 60_000;
const NYFED_URL = 'https://markets.newyorkfed.org/api/rates/unsecured/effr/last/1.json';
const PMMS_URL = 'https://www.freddiemac.com/pmms/docs/PMMS_history.csv';

export function parseEffr(body) {
  const r = body?.refRates?.[0];
  const from = Number(r?.targetRateFrom);
  const to = Number(r?.targetRateTo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('fed source: unexpected shape');
  const effective = Number(r.percentRate);
  return { from, to, effective: Number.isFinite(effective) ? effective : null, date: r.effectiveDate || null };
}

// "9/24/2026" -> "2026-09-24"
function usDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

// PMMS CSV -> the two newest weeks for the 30 and 15 year fixed rates.
export function parsePmms(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  const head = lines.shift()?.split(',').map((h) => h.trim()) || [];
  const i30 = head.indexOf('pmms30');
  const i15 = head.indexOf('pmms15');
  const iDate = head.indexOf('date');
  if (i30 < 0 || iDate < 0) throw new Error('mortgage source: unexpected header');
  const rows = [];
  for (const line of lines) {
    const c = line.split(',');
    const date = usDate(c[iDate]);
    const r30 = Number(c[i30]);
    if (!date || !c[i30]?.trim() || !Number.isFinite(r30)) continue;
    const r15 = i15 >= 0 && c[i15]?.trim() ? Number(c[i15]) : NaN;
    rows.push({ date, r30, r15: Number.isFinite(r15) ? r15 : null });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (rows.length < 2) throw new Error('mortgage source: too few rows');
  const [prev, last] = rows.slice(-2);
  return {
    date: last.date,
    rate30: last.r30, change30: last.r30 - prev.r30,
    rate15: last.r15, change15: last.r15 !== null && prev.r15 !== null ? last.r15 - prev.r15 : null,
  };
}

// Live: the shared quote batch (the same yields as MARKETS, the tape and CURVE). Tests
// pass their own fetch and get their own batch.
export function makeRates({ fetchImpl = globalThis.fetch, cache = createCache(), quotes = fetchImpl === globalThis.fetch ? sharedQuotes : makeQuotes({ fetchImpl, cache }) } = {}) {
  async function get(url, as) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`rates source HTTP ${res.status}`);
    return as === 'json' ? res.json() : res.text();
  }

  const fed = () => cache.cached('rates:fed', DAY, async () => parseEffr(await get(NYFED_URL, 'json')));
  const mortgage = () => cache.cached('rates:pmms', DAY, async () => parsePmms(await get(PMMS_URL, 'text')));

  async function getRates() {
    const [y, f, m] = await Promise.allSettled([quotes.getYields(), fed(), mortgage()]);
    if (y.status === 'rejected' && f.status === 'rejected' && m.status === 'rejected') {
      throw new Error('rates: every source failed');
    }
    const stamp = (r) => (r.status === 'fulfilled' && r.value.fetchedAt ? new Date(r.value.fetchedAt).toISOString() : null);
    return {
      yields: y.status === 'fulfilled' ? y.value.yields : [],
      yieldsUpdated: y.status === 'fulfilled' ? y.value.updated : null,
      fed: f.status === 'fulfilled' ? f.value.value : null,
      fedUpdated: stamp(f),
      mortgage: m.status === 'fulfilled' ? m.value.value : null,
      mortgageUpdated: stamp(m),
      stale: [y, f, m].some((r) => r.status === 'fulfilled' && r.value.stale),
      updated: new Date().toISOString(),
    };
  }

  return { getRates };
}

export const { getRates } = makeRates();

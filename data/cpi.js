// Inflation: what an amount from a past year is worth today.
// Annual averages live in cpi-annual.json (CPI-U, BLS series CUUR0000SA0).
// The latest monthly value comes from the public BLS API v1 (no key), with the
// static table as the fallback.

import { readFileSync } from 'node:fs';
import { createCache } from './cache.js';
import { parseAmount, amountMessage } from './fx.js';

const TABLE = JSON.parse(readFileSync(new URL('./cpi-annual.json', import.meta.url), 'utf8'));
export const ANNUAL = Object.fromEntries(Object.entries(TABLE.annual).map(([y, v]) => [Number(y), v]));
export const FIRST_YEAR = Math.min(...Object.keys(ANNUAL).map(Number));
export const LAST_YEAR = Math.max(...Object.keys(ANNUAL).map(Number));

const BLS_URL = 'https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0';
const CPI_TTL = 24 * 60 * 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const CPI_EXAMPLES = ['CPI 100 2015', 'CPI 1000 1990', 'CPI 20 1970'];
// Months BLS never published. The screen shows them as -- with the reason; nothing fills them in.
export const CPI_GAPS = [
  { month: '2025-10', label: 'Oct 2025', reason: 'Not published: the US government shutdown stopped BLS price collection, and BLS never produced an October 2025 CPI.' },
];

export class CpiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// BLS v1 body -> { year, month, value } for the newest monthly value.
export function latestFromBls(body) {
  if (body?.status !== 'REQUEST_SUCCEEDED') throw new Error('cpi source: request failed');
  const data = body?.Results?.series?.[0]?.data;
  if (!Array.isArray(data)) throw new Error('cpi source: unexpected shape');
  const rows = data
    .map((d) => ({ year: Number(d.year), month: /^M(0[1-9]|1[0-2])$/.test(d.period) ? Number(d.period.slice(1)) : 0, value: Number(d.value) }))
    .filter((d) => d.month && Number.isFinite(d.value) && d.value > 0)
    .sort((a, b) => b.year - a.year || b.month - a.month);
  if (!rows.length) throw new Error('cpi source: no monthly values');
  return rows[0];
}

export function staticLatest() {
  return { year: LAST_YEAR, month: 0, value: ANNUAL[LAST_YEAR] };
}

export function labelOf(latest) {
  return latest.month ? `${MONTHS[latest.month - 1]} ${latest.year}` : `${latest.year} average`;
}

// Pure maths, so it can be tested without the network.
export function inflate(amount, year, latest) {
  const base = ANNUAL[year];
  const result = (amount * latest.value) / base;
  const pct = (latest.value / base - 1) * 100;
  const then = year + 0.5;
  const nowY = latest.month ? latest.year + (latest.month - 0.5) / 12 : latest.year + 0.5;
  const years = Math.max(nowY - then, 0);
  const perYear = years >= 1 ? (Math.pow(latest.value / base, 1 / years) - 1) * 100 : null;
  return { base, result, pct, perYear, years };
}

// A failed BLS call is not retried for 6 hours: keyless BLS allows 25 queries a day.
export const CPI_RETRY_MS = 6 * 60 * 60_000;

export function makeCpi({ fetchImpl = globalThis.fetch, cache = createCache({ retryMs: CPI_RETRY_MS }) } = {}) {
  async function latest() {
    try {
      const { value, stale, fetchedAt } = await cache.cached('cpi:latest', CPI_TTL, async () => {
        const res = await fetchImpl(BLS_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`cpi source HTTP ${res.status}`);
        return latestFromBls(await res.json());
      });
      return { ...value, source: 'bls', stale, fetchedAt };
    } catch {
      return { ...staticLatest(), source: 'static', stale: false, fetchedAt: Date.now() };
    }
  }

  async function getCpi({ amount: rawAmount, year: rawYear }) {
    const amount = parseAmount(rawAmount === undefined || rawAmount === '' ? '100' : rawAmount);
    if (!Number.isFinite(amount)) {
      throw new CpiError('bad_amount', amountMessage(rawAmount));
    }
    const year = /^\d{4}$/.test(String(rawYear ?? '')) ? Number(rawYear) : NaN;
    if (!ANNUAL[year]) throw new CpiError('bad_year', `Pick a year from ${FIRST_YEAR} to ${LAST_YEAR}.`);

    const now = await latest();
    const calc = inflate(amount, year, now);
    const series = [];
    for (let y = year; y <= LAST_YEAR; y += 1) series.push({ d: String(y), v: ANNUAL[y] });
    if (now.month) series.push({ d: `${now.year}-${String(now.month).padStart(2, '0')}`, v: now.value });

    return {
      amount, year,
      result: calc.result,
      pct: calc.pct,
      perYear: calc.perYear,
      base: calc.base,
      latest: { value: now.value, year: now.year, month: now.month, label: labelOf(now), source: now.source },
      series,
      gaps: CPI_GAPS.filter((g) => Number(g.month.slice(0, 4)) >= year),
      stale: now.stale,
      updated: new Date(now.fetchedAt).toISOString(),
    };
  }

  return { getCpi };
}

export const { getCpi } = makeCpi();

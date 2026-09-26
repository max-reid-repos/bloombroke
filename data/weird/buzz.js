// BUZZ: how many 10-Q quarterly reports filed with the SEC use the phrases "artificial
// intelligence", "tariff" and "recession", per calendar quarter of the filing date, for
// the last 8 quarters. Source: SEC EDGAR full-text search (the hit total of each
// search). The SEC asks for a named User-Agent and at most 10 requests a second: we
// send at most 4 a second, 2 at a time, and keep the result a day.

import { NoData, pool } from './source.js';

export const id = 'buzz';
export const source = 'SEC EDGAR';
export const ttl = 24 * 60 * 60_000;
export const retryMs = 60 * 60_000;

export const PHRASES = [
  { key: 'ai', q: 'artificial intelligence', label: 'AI' },
  { key: 'tariff', q: 'tariff', label: 'Tariff' },
  { key: 'recession', q: 'recession', label: 'Recession' },
];
const QUARTERS = 8;
const DAY = 86400_000;

export function url(phrase, start, end) {
  const q = new URLSearchParams({ q: `"${phrase}"`, forms: '10-Q', dateRange: 'custom', startdt: start, enddt: end });
  return `https://efts.sec.gov/LATEST/search-index?${q}`;
}

// The last `n` calendar quarters up to the one holding `now`, oldest first.
export function quarters(now, n = QUARTERS) {
  const d = new Date(now);
  let y = d.getUTCFullYear();
  let q = Math.floor(d.getUTCMonth() / 3);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const start = new Date(Date.UTC(y, q * 3, 1));
    const end = new Date(Date.UTC(y, q * 3 + 3, 0));
    out.unshift({
      key: `${y}-Q${q + 1}`,
      label: `Q${q + 1} ${y}`,
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      partial: now < end.getTime() + DAY,
    });
    q -= 1;
    if (q < 0) { q = 3; y -= 1; }
  }
  return out;
}

// EDGAR search body -> { count, capped }. capped: the index stopped counting (10,000+).
export function parseTotal(body) {
  const t = body?.hits?.total;
  const count = Number(t?.value ?? t);
  if (!Number.isFinite(count)) throw new Error('EDGAR: no hit total');
  return { count, capped: t?.relation === 'gte' };
}

// The headline quarter: the current one in its last 7 days, else the latest full one.
export function headlineIndex(rows, now) {
  const last = rows.length - 1;
  if (!rows[last].partial) return last;
  return Date.parse(`${rows[last].end}T00:00:00Z`) - now <= 7 * DAY ? last : last - 1;
}

// rows: quarters() entries with { ai, tariff, recession } -> the gauge.
export function build(rows, now) {
  if (!rows.length || rows.some((r) => PHRASES.some((p) => !r[p.key]))) throw new NoData('EDGAR: missing counts');
  const i = headlineIndex(rows, now);
  const h = rows[i];
  const n = h.ai.count.toLocaleString('en-US');
  return {
    headline: `${h.ai.capped ? `${n}+` : n} AI FILINGS`,
    line: `10-Qs naming AI, ${h.label}${h.partial ? ' so far' : ''}`,
    spark: rows.map((r) => r.ai.count),
    asOf: new Date(Math.min(now, Date.parse(`${h.end}T00:00:00Z`))).toISOString().slice(0, 10),
    source,
    quarter: h.label,
    rows: rows.slice().reverse().map((r) => ({
      key: r.key, label: r.label, start: r.start, end: r.end, partial: r.partial,
      ...Object.fromEntries(PHRASES.map((p) => [p.key, r[p.key].count])),
      capped: PHRASES.filter((p) => r[p.key].capped).map((p) => p.key),
    })),
  };
}

export async function load(get, { now = Date.now } = {}) {
  const t = now();
  const qs = quarters(t);
  const jobs = qs.flatMap((q) => PHRASES.map((p) => ({ q, p })));
  const fetchOne = async ({ q, p }) => {
    const u = url(p.q, q.start, q.end);
    try {
      return parseTotal(await get.json(u, { timeout: 25_000 }));
    } catch {
      await new Promise((r) => { setTimeout(r, 1000); });
      return parseTotal(await get.json(u, { timeout: 25_000 }));
    }
  };
  const got = await pool(jobs, 2, fetchOne, 250);
  const rows = qs.map((q, i) => ({ ...q, ...Object.fromEntries(PHRASES.map((p, k) => [p.key, got[i * PHRASES.length + k]])) }));
  return build(rows, t);
}

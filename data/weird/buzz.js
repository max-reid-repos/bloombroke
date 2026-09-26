// BUZZ: how many 10-Q quarterly reports filed with the SEC use the phrases "artificial
// intelligence", "tariff" and "recession", per calendar quarter of the filing date, for
// the last 8 quarters. Source: SEC EDGAR full-text search (the hit total of each
// search). The SEC asks for a named User-Agent and at most 10 requests a second: we
// send at most 4 a second, 2 at a time, and keep the result a day.
//
// The search sometimes answers one request with HTTP 500 (a fast "Internal server
// error", at random): each request is tried twice, a second apart, and a cell that
// still fails shows as -- instead of blanking the whole gauge.

import { NoData, pool, isoDay } from './source.js';

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

const RETRY_WAIT = 1000;

// The search URL. Spaces as %20 (not +), the same form the EDGAR site sends, and the
// end date never past today (the current quarter ends in the future).
export function url(phrase, start, end, now = Date.now()) {
  const today = isoDay(now);
  const enddt = end > today ? today : end;
  const q = [['q', `"${phrase}"`], ['forms', '10-Q'], ['dateRange', 'custom'], ['startdt', start], ['enddt', enddt]]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
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

// rows: quarters() entries with { ai, tariff, recession } -> the gauge. A count that
// could not be fetched is null (shown as --). The headline takes the headline quarter,
// or the newest one before it with an AI count.
export function build(rows, now) {
  if (!rows.length) throw new NoData('EDGAR: missing counts');
  let i = headlineIndex(rows, now);
  while (i >= 0 && !rows[i].ai) i -= 1;
  if (i < 0) throw new NoData('EDGAR: no AI counts');
  const h = rows[i];
  const n = h.ai.count.toLocaleString('en-US');
  return {
    headline: `${h.ai.capped ? `${n}+` : n} AI FILINGS`,
    line: `10-Qs naming AI, ${h.label}${h.partial ? ' so far' : ''}`,
    spark: rows.map((r) => (r.ai ? r.ai.count : null)),
    asOf: new Date(Math.min(now, Date.parse(`${h.end}T00:00:00Z`))).toISOString().slice(0, 10),
    source,
    quarter: h.label,
    rows: rows.slice().reverse().map((r) => ({
      key: r.key, label: r.label, start: r.start, end: r.end, partial: r.partial,
      ...Object.fromEntries(PHRASES.map((p) => [p.key, r[p.key] ? r[p.key].count : null])),
      capped: PHRASES.filter((p) => r[p.key]?.capped).map((p) => p.key),
    })),
  };
}

// get: sourceClient(). retryWait: ms before the second try (tests pass 0).
export async function load(get, { now = Date.now, retryWait = RETRY_WAIT } = {}) {
  const t = now();
  const qs = quarters(t);
  const jobs = qs.flatMap((q) => PHRASES.map((p) => ({ q, p })));
  const fails = [];
  let ok = 0;
  const fetchOne = async ({ q, p }) => {
    const u = url(p.q, q.start, q.end, t);
    try {
      const got = parseTotal(await get.json(u, { timeout: 25_000 }));
      ok += 1;
      return got;
    } catch {
      await new Promise((r) => { setTimeout(r, retryWait); });
      try {
        const got = parseTotal(await get.json(u, { timeout: 25_000 }));
        ok += 1;
        return got;
      } catch (err) {
        fails.push(`${q.key} ${p.key}: ${err?.message || err}`);
        // Two searches failed and none worked yet: EDGAR is down, stop asking.
        if (fails.length >= 2 && !ok) throw new Error(`EDGAR: every search failed (${fails[0]})`);
        return null;
      }
    }
  };
  const got = await pool(jobs, 2, fetchOne, 250);
  if (fails.length === jobs.length) throw new Error(`EDGAR: every search failed (${fails[0]})`);
  if (fails.length) console.error(`[weird:buzz] ${fails.length} of ${jobs.length} searches failed, shown as --: ${fails.join('; ')}`);
  const rows = qs.map((q, i) => ({ ...q, ...Object.fromEntries(PHRASES.map((p, k) => [p.key, got[i * PHRASES.length + k]])) }));
  return build(rows, t);
}

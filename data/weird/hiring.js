// HIRING: Hacker News posts two threads on the first weekday of each month, "Who is
// hiring?" (companies post jobs) and "Who wants to be hired?" (people post themselves).
// The gauge is seekers per job post: comments on the second over comments on the first.
// Source: HN Algolia search, stories by the whoishiring account. The headline uses the
// newest month whose threads are at least 7 days old, so a fresh thread is not half
// counted.

// History: every thread since the account started (2011), about 500 stories, in one
// request a week.

import { NoData, headlineNumber } from './source.js';
import { histFrom } from './history.js';

export const id = 'hiring';
export const source = 'HN Algolia';
export const ttl = 3 * 60 * 60_000;
export const defaultPeriod = '5Y';
export const historyTtl = 7 * 24 * 60 * 60_000;

const URL_HN = 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=100';
const URL_ALL = 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=1000';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// A thread title -> { kind: 'hiring' | 'seeking', month: 'YYYY-MM' } or null.
export function classify(title) {
  const m = /^Ask HN: Who (is hiring|wants to be hired)\?\s*\((\w+)\s+(\d{4})\)/i.exec(String(title || ''));
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2].toLowerCase());
  if (mi < 0) return null;
  return { kind: /hiring$/i.test(m[1]) ? 'hiring' : 'seeking', month: `${m[3]}-${String(mi + 1).padStart(2, '0')}` };
}

// Algolia body -> [{ month, hiring, seeking, ratio }] newest first, months with both
// threads, at most `limit` of them.
export function parse(body, limit = 24) {
  const hits = body?.hits;
  if (!Array.isArray(hits)) throw new Error('HN Algolia: unexpected shape');
  const by = new Map();
  for (const h of hits) {
    const c = classify(h.title);
    if (!c || !Number.isFinite(h.num_comments)) continue;
    const row = by.get(c.month) || { month: c.month, hiring: null, seeking: null, posted: null };
    if (row[c.kind] === null) row[c.kind] = h.num_comments;
    const t = Date.parse(h.created_at);
    if (Number.isFinite(t) && (row.posted === null || t > Date.parse(row.posted))) row.posted = new Date(t).toISOString();
    by.set(c.month, row);
  }
  return [...by.values()]
    .filter((r) => r.hiring > 0 && r.seeking !== null)
    .map((r) => ({ ...r, ratio: r.seeking / r.hiring }))
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, limit);
}

// Months (newest first) -> a hist of seekers per job post. recordAt: the headline's month.
export function toHist(months, recordAt = null) {
  return histFrom(months.map((m) => ({ d: `${m.month}-01`, ratio: m.ratio })), [{ key: 'ratio', label: 'Seekers per job post' }], { step: 'month', recordAt });
}

export const SETTLE_DAYS = 7;

export function build(months, now = Date.now()) {
  const settled = months.filter((m) => !m.posted || now - Date.parse(m.posted) >= SETTLE_DAYS * 86400_000);
  if (!settled.length) throw new NoData('HN Algolia: no monthly threads');
  const last = settled[0];
  return {
    headline: `${last.ratio.toFixed(2)} PER JOB`,
    value: headlineNumber(last.ratio, 2), // ALERTS: the headline number and its unit
    unit: 'per job',
    line: 'HN job seekers per job post',
    spark: settled.slice().reverse().map((m) => m.ratio),
    asOf: `${last.month}-01`,
    source,
    month: last.month,
    hiring: last.hiring,
    seeking: last.seeking,
    ratio: last.ratio,
    months,
    hist: toHist(months, `${last.month}-01`),
  };
}

export async function load(get, { now = Date.now } = {}) {
  return build(parse(await get.json(URL_HN)), now());
}

// The deep past: every month since the threads began. The newest months come with the
// gauge's own fetch, which also says which month is settled.
export async function history(get) {
  const months = parse(await get.json(URL_ALL, { timeout: 20_000 }), Infinity);
  if (months.length < 24) throw new NoData('HN Algolia: no history');
  return toHist(months);
}

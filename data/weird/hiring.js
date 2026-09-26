// HIRING: Hacker News posts two threads on the first weekday of each month, "Who is
// hiring?" (companies post jobs) and "Who wants to be hired?" (people post themselves).
// The gauge is seekers per job post: comments on the second over comments on the first.
// Source: HN Algolia search, stories by the whoishiring account.

import { NoData } from './source.js';

export const id = 'hiring';
export const source = 'HN Algolia';
export const ttl = 3 * 60 * 60_000;

const URL_HN = 'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=100';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// A thread title -> { kind: 'hiring' | 'seeking', month: 'YYYY-MM' } or null.
export function classify(title) {
  const m = /^Ask HN: Who (is hiring|wants to be hired)\?\s*\((\w+)\s+(\d{4})\)/i.exec(String(title || ''));
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2].toLowerCase());
  if (mi < 0) return null;
  return { kind: /hiring$/i.test(m[1]) ? 'hiring' : 'seeking', month: `${m[3]}-${String(mi + 1).padStart(2, '0')}` };
}

// Algolia body -> [{ month, hiring, seeking, ratio }] newest first, months with both threads.
export function parse(body) {
  const hits = body?.hits;
  if (!Array.isArray(hits)) throw new Error('HN Algolia: unexpected shape');
  const by = new Map();
  for (const h of hits) {
    const c = classify(h.title);
    if (!c || !Number.isFinite(h.num_comments)) continue;
    const row = by.get(c.month) || { month: c.month, hiring: null, seeking: null };
    if (row[c.kind] === null) row[c.kind] = h.num_comments;
    by.set(c.month, row);
  }
  return [...by.values()]
    .filter((r) => r.hiring > 0 && r.seeking !== null)
    .map((r) => ({ ...r, ratio: r.seeking / r.hiring }))
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, 24);
}

export function build(months) {
  if (!months.length) throw new NoData('HN Algolia: no monthly threads');
  const last = months[0];
  return {
    headline: `${last.ratio.toFixed(2)} PER JOB`,
    line: 'HN job seekers per job post',
    spark: months.slice().reverse().map((m) => m.ratio),
    asOf: `${last.month}-01`,
    source,
    month: last.month,
    hiring: last.hiring,
    seeking: last.seeking,
    ratio: last.ratio,
    months,
  };
}

export async function load(get) {
  return build(parse(await get.json(URL_HN)));
}

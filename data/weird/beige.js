// BEIGE: how often the Fed's Beige Book uses a few words, edition by edition, for the
// last 8 editions. Each edition is a national summary plus one report per Fed District
// (13 pages), all counted. Source: federalreserve.gov. The edition list comes from the
// Beige Book index page. Words are whole words, any case, with their plain forms
// ("tariffs" counts as tariff); "AI" counts only in capitals, plus "artificial
// intelligence". Past editions never change, so their counts are kept in memory.

import { NoData, pool, decodeEntities } from './source.js';

export const id = 'beige';
export const source = 'Federal Reserve';
export const ttl = 24 * 60 * 60_000;
export const retryMs = 60 * 60_000;

const BASE = 'https://www.federalreserve.gov/monetarypolicy/';
const INDEX = `${BASE}publications/beige-book-default.htm`;
export const EDITIONS = 8;
export const PAGES = ['summary', 'boston', 'new-york', 'philadelphia', 'cleveland', 'richmond', 'atlanta', 'chicago', 'st-louis', 'minneapolis', 'kansas-city', 'dallas', 'san-francisco'];

export const WORDS = [
  { key: 'uncertain', label: 'Uncertain', res: [/\buncertain(?:ty|ties)?\b/gi] },
  { key: 'tariff', label: 'Tariff', res: [/\btariffs?\b/gi] },
  { key: 'slow', label: 'Slow', res: [/\bslow(?:s|ed|er|est|ing|ly|down|downs)?\b/gi] },
  { key: 'recession', label: 'Recession', res: [/\brecessions?\b/gi, /\brecessionary\b/gi] },
  { key: 'ai', label: 'AI', res: [/\bAI\b/g, /\bartificial intelligence\b/gi] },
];

// The index page -> edition ids 'YYYYMM', newest first, none after `now`.
export function parseEditions(html, now = Date.now()) {
  const d = new Date(now);
  const cap = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const ids = new Set();
  for (const m of String(html ?? '').matchAll(/beigebook(\d{6})(?:-summary)?\.htm/g)) if (m[1] <= cap) ids.add(m[1]);
  return [...ids].sort().reverse();
}

// One page -> the plain text of its article (no menus, no footer).
export function articleText(html) {
  const s = String(html ?? '');
  const at = s.indexOf('id="article"');
  if (at < 0) throw new Error('Beige Book: no article on the page');
  const start = s.indexOf('>', at) + 1;
  const end = s.indexOf('id="lastUpdate"', start);
  const body = s.slice(start, end > 0 ? s.lastIndexOf('<', end) : undefined);
  return decodeEntities(body
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text) {
  return Object.fromEntries(WORDS.map((w) => [w.key, w.res.reduce((n, re) => n + (text.match(re) || []).length, 0)]));
}

const addCounts = (a, b) => Object.fromEntries(WORDS.map((w) => [w.key, (a[w.key] || 0) + (b[w.key] || 0)]));
export const editionMonth = (ed) => `${ed.slice(0, 4)}-${ed.slice(4, 6)}`;

// editions: [{ edition, counts }] newest first -> the gauge.
export function build(editions) {
  if (!editions.length) throw new NoData('Beige Book: no editions');
  const latest = editions[0];
  const top = WORDS.slice().sort((a, b) => latest.counts[b.key] - latest.counts[a.key])[0];
  return {
    headline: `${top.label.toUpperCase()} ${latest.counts[top.key]} TIMES`,
    line: 'Top word in the latest Beige Book',
    spark: editions.slice().reverse().map((e) => e.counts[top.key]),
    asOf: `${editionMonth(latest.edition)}-01`,
    source,
    top: top.key,
    words: WORDS.map((w) => ({ key: w.key, label: w.label })),
    editions: editions.map((e) => ({ edition: e.edition, month: editionMonth(e.edition), ...e.counts })),
  };
}

const done = new Map(); // edition -> counts, for editions that are not the newest

export async function load(get, { now = Date.now } = {}) {
  const list = parseEditions(await get.text(INDEX, { timeout: 20_000 }), now()).slice(0, EDITIONS);
  if (!list.length) throw new NoData('Beige Book: no editions on the index page');
  const out = [];
  for (const [i, ed] of list.entries()) {
    if (done.has(ed)) { out.push({ edition: ed, counts: done.get(ed) }); continue; }
    const texts = await pool(PAGES, 3, (p) => get.text(`${BASE}beigebook${ed}-${p}.htm`, { timeout: 20_000 }).then(articleText), 150);
    const counts = texts.map(countWords).reduce(addCounts, {});
    if (i > 0) done.set(ed, counts);
    out.push({ edition: ed, counts });
  }
  for (const k of done.keys()) if (!list.includes(k)) done.delete(k);
  return build(out);
}

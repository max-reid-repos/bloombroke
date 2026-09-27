// BEIGE: how often the Fed's Beige Book uses a few words, edition by edition, for the
// last 8 editions. Each edition is a national summary plus one report per Fed District
// (13 pages), all counted. Source: federalreserve.gov. The edition list comes from the
// Beige Book index page. An edition's id (beigebook202608) is not its release month:
// the August 2026 edition came out September 2. The release date is read from the PDF
// name (BeigeBook_20260902.pdf), in the index row or else on the edition's summary
// page, and is the date shown. Words are whole words, any case, with their plain forms
// ("tariffs" counts as tariff); "AI" counts only in capitals, plus "artificial
// intelligence". Past editions never change, so their counts are kept in memory.

// History: only the 8 editions the gauge reads (about a year). Each older edition is 13
// more pages, so going further back is not cheap and is not done.

import { NoData, pool, decodeEntities } from './source.js';
import { histFrom } from './history.js';

export const id = 'beige';
export const source = 'Federal Reserve';
export const ttl = 24 * 60 * 60_000;
export const retryMs = 60 * 60_000;
export const defaultPeriod = 'MAX';

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

// 'BeigeBook_20260902.pdf' somewhere in `html` -> '2026-09-02', or null.
export function pdfDate(html) {
  const m = /BeigeBook_(\d{4})(\d{2})(\d{2})\.pdf/.exec(String(html ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// The index page -> [{ edition: 'YYYYMM', released: 'YYYY-MM-DD' | null }], newest
// first. The release date comes from the PDF link in the same table cell. An edition
// released after `now` is left out; one with no date on the index is kept only when its
// id month is before this month (it cannot be out yet otherwise).
export function parseEditions(html, now = Date.now()) {
  const s = String(html ?? '');
  const today = isoDay(now);
  const thisMonth = today.slice(0, 7).replace('-', '');
  const found = new Map();
  for (const m of s.matchAll(/beigebook(\d{6})(?:-summary)?\.htm/g)) {
    const cell = s.slice(m.index, m.index + 300).split(/<\/td>|<li>|<\/li>/)[0];
    const released = pdfDate(cell);
    if (!found.has(m[1]) || (released && !found.get(m[1]))) found.set(m[1], released);
  }
  return [...found.entries()]
    .map(([edition, released]) => ({ edition, released }))
    .filter((e) => (e.released ? e.released <= today : e.edition < thisMonth))
    .sort((a, b) => (a.edition < b.edition ? 1 : -1));
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

// editions: [{ edition, counts }] newest first -> the gauge.
// editions: [{ edition, released, counts }] newest first -> the gauge.
export function build(editions) {
  if (!editions.length) throw new NoData('Beige Book: no editions');
  const latest = editions[0];
  const top = WORDS.slice().sort((a, b) => latest.counts[b.key] - latest.counts[a.key])[0];
  return {
    headline: `${top.label.toUpperCase()} ${latest.counts[top.key]} TIMES`,
    line: 'Top word in the latest Beige Book',
    spark: editions.slice().reverse().map((e) => e.counts[top.key]),
    asOf: latest.released,
    source,
    top: top.key,
    words: WORDS.map((w) => ({ key: w.key, label: w.label })),
    editions: editions.map((e) => ({ edition: e.edition, released: e.released, ...e.counts })),
    hist: histFrom(editions.map((e) => ({ d: e.released, ...e.counts })), WORDS.map((w) => ({ key: w.key, label: w.label })), { step: 'edition', lead: top.key }),
  };
}

const done = new Map(); // edition -> { released, counts }, for editions that are not the newest

export async function load(get, { now = Date.now } = {}) {
  const list = parseEditions(await get.text(INDEX, { timeout: 20_000 }), now()).slice(0, EDITIONS);
  if (!list.length) throw new NoData('Beige Book: no editions on the index page');
  const out = [];
  for (const [i, { edition: ed, released: fromIndex }] of list.entries()) {
    if (done.has(ed)) { out.push({ edition: ed, ...done.get(ed) }); continue; }
    const pages = await pool(PAGES, 3, (p) => get.text(`${BASE}beigebook${ed}-${p}.htm`, { timeout: 20_000 }), 150);
    const released = fromIndex || pdfDate(pages[0]);
    if (!released) throw new NoData(`Beige Book: no release date for ${ed}`);
    const counts = pages.map(articleText).map(countWords).reduce(addCounts, {});
    if (i > 0) done.set(ed, { released, counts });
    out.push({ edition: ed, released, counts });
  }
  for (const k of done.keys()) if (!list.some((e) => e.edition === k)) done.delete(k);
  return build(out);
}

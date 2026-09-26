// BOXRATE: what it costs to ship one 40ft container, from the Drewry World Container
// Index (WCI), a composite of eight main east-west routes, out every Thursday. Only
// the headline dollar figure and its date are read, from the page's description tag.
// If either cannot be read, the tile says NO DATA; nothing is guessed.

import { NoData, decodeEntities } from './source.js';

export const id = 'boxrate';
export const source = 'Drewry WCI';
export const ttl = 6 * 60 * 60_000;
export const retryMs = 30 * 60_000;

const URL_WCI = 'https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry';
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// The composite's own clause: "World Container Index (WCI) [composite] decreased 1% to
// $4,468 per 40ft". Only a few words may sit between the name and the price, so a route
// rate elsewhere in the sentence ("Shanghai to Rotterdam rose to $3,000 per 40ft") is
// never taken for it.
export const WCI_CLAUSE = /World Container Index(?:\s*\(WCI\))?(?:\s+composite(?:\s+index)?)?\s+(?:[a-z]+\s+){0,4}?(?:by\s+)?(?:[\d.]+%\s+)?(?:to|at)\s+(?:US)?\$\s?(\d{1,3}(?:,\d{3})+|\d{3,6})(?:\.\d+)?\s+per\s+40\s?ft/i;

// The page -> { usd, date: 'YYYY-MM-DD', text }. Throws NoData when it does not parse.
export function parse(html) {
  const tags = String(html ?? '').match(/<meta[^>]+>/gi) || [];
  const tag = tags.find((t) => /name=["']description["']/i.test(t)) || tags.find((t) => /property=["']og:description["']/i.test(t));
  const text = decodeEntities((/content="([^"]*)"/i.exec(tag || '') || /content='([^']*)'/i.exec(tag || ''))?.[1] || '').replace(/\s+/g, ' ').trim();
  if (!/World Container Index/i.test(text)) throw new NoData('Drewry: no WCI headline');
  const d = /\b(\d{1,2}) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{4})\b/i.exec(text);
  const p = WCI_CLAUSE.exec(text);
  if (!d || !p) throw new NoData('Drewry: headline did not parse');
  const month = MONTHS[d[2].toLowerCase()];
  const day = Number(d[1]);
  const date = `${d[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const usd = Number(p[1].replace(/,/g, ''));
  if (!Number.isFinite(Date.parse(date)) || day > 31 || !(usd >= 100 && usd <= 100_000)) throw new NoData('Drewry: headline out of range');
  return { usd, date, text };
}

export function build(p) {
  return {
    headline: `$${p.usd.toLocaleString('en-US')}`,
    line: 'To ship one 40ft container',
    spark: null,
    asOf: p.date,
    source,
    usd: p.usd,
    date: p.date,
  };
}

export async function load(get) {
  return build(parse(await get.text(URL_WCI, { timeout: 20_000, accept: 'text/html' })));
}

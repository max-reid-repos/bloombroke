// WHATIF search pages: one catalogue item, default period (/?c=WHATIF+IPHONE6), gets a
// plain title and description built from its own result, so "Apple stock instead of the
// iPhone 6" is a page without a page type of its own. The share card (lib/og.js) keeps
// its image; only the title and description change. Lists of several items, a period
// (LATTE:3Y) and your own purchases (MY) keep the certificate's own words.
//
// Every number comes from the certificate model (lib/og.js getCert, the same engine and
// the same cache as the share image). With no model (a slow or failed quote), the
// description leaves the numbers out.

import { certVersion, normalizeWhatif } from '../data/whatif-cert.js';
import { monthKey, stepPrice } from '../data/whatif.js';
import { SITE } from './og.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const SEO_SMALL_PRINT = 'Price only, split-adjusted. Hindsight, not advice.';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);

// 649 -> "$649", 299.99 -> "$299.99", 57400 -> "$57,400".
export function priceText(n) {
  if (!Number.isFinite(n)) return '';
  const d = Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

// '2014-09-19' -> 'Sep 2014'
export function monthYear(date) {
  const [y, m] = String(date || '').split('-').map(Number);
  return y && m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : '';
}

// "iPhone 3G (on contract)" -> { base: 'iPhone 3G', first: false, qualifier: ' on contract' }
// "iPad (first)" -> { base: 'iPad', first: true }. The bracket never reaches the title.
export function productName(name) {
  const s = String(name || '');
  const paren = /\s*\(([^)]*)\)\s*$/.exec(s);
  const base = paren ? s.slice(0, paren.index).trim() : s.trim();
  const inner = paren ? paren[1].toLowerCase() : '';
  const qualifier = /contract/.test(inner) ? ' on contract' : /carrier deal/.test(inner) ? ' with a carrier deal' : '';
  return { base, first: inner === 'first', qualifier };
}

const article = (word) => (/^[aeiou]/i.test(word) || /^X/.test(word) ? 'An' : 'A');

// A habit's spend in words. A fixed price: "$5.95 a day of lattes". A price that follows a
// BLS series moves every month, so the title names the thing instead: "the money for a
// six-pack of beer a week".
export function habitSpend(item, { now = new Date() } = {}) {
  const per = item.per;
  if (!item.series) {
    const unit = item.scaleWith ? item.today : stepPrice(item.prices || [], monthKey(now));
    if (Number.isFinite(unit)) return `${priceText(unit)} a ${per} of ${item.plural || item.short}`;
  }
  const thing = String(item.name || '').split(',')[0].replace(/\s*\([^)]*\)/g, '').trim();
  return `the money for ${/^[aeiou]/i.test(thing) ? 'an' : 'a'} ${low(thing)} a ${per}`;
}

// ?c= -> { item, kind, command } for one catalogue item with no period, else null.
export function seoItem(c, catalog) {
  const norm = normalizeWhatif(c, catalog);
  if (!norm || norm.tokens.length !== 1 || norm.tokens[0].includes(':')) return null;
  const id = norm.tokens[0].toLowerCase();
  const product = catalog.products.find((p) => p.id === id);
  if (product) return { item: product, kind: 'once', command: norm.command };
  const habit = catalog.recurring.find((r) => r.id === id);
  return habit ? { item: habit, kind: 'monthly', command: norm.command } : null;
}

// The words for one item. model: the certificate model (lib/og.js getCert) or null.
export function seoWords(hit, model = null, { now = new Date() } = {}) {
  const { item, kind } = hit;
  const company = item.company;
  const numbers = model && model.big && model.multiple ? model : null;
  if (kind === 'once') {
    const n = productName(item.name);
    const thing = n.first ? `the first ${n.base}` : `the ${n.base}`;
    const subject = n.first ? `The first ${n.base}` : `${article(n.base)} ${n.base}`;
    const fact = `${subject} cost ${priceText(item.price)}${n.qualifier} in ${monthYear(item.date)}.`;
    return {
      title: `What if you bought ${company} stock instead of ${thing}?`,
      fact,
      description: numbers
        ? `${fact} The same money in ${company} stock is worth ${numbers.big} today (${numbers.multiple}). ${SEO_SMALL_PRINT}`
        : `${fact} See what the same money in ${company} stock is worth today. ${SEO_SMALL_PRINT}`,
      alt: numbers
        ? `A WHATIF certificate. ${fact} In ${company} stock the same money is worth ${numbers.big} today (${numbers.multiple}).`
        : `A WHATIF certificate: ${thing} as ${company} stock instead.`,
    };
  }
  const spend = habitSpend(item, { now });
  const paid = numbers && /^You spent (\$[\d,.]+)$/.exec(String(numbers.spent || ''))?.[1];
  const span = numbers?.ribbon || `${item.defaultYears} years of ${item.plural || item.short}`;
  const fact = paid ? `${cap(span)} cost ${paid}.` : `${cap(span)}, put into ${company} stock each month instead.`;
  return {
    title: `What if you put ${spend} into ${company} stock instead?`,
    fact,
    description: numbers && paid
      ? `${fact} The same money in ${company} stock, bought each month, is worth ${numbers.big} today (${numbers.multiple}). ${SEO_SMALL_PRINT}`
      : `${fact} See what it is worth today. ${SEO_SMALL_PRINT}`,
    alt: numbers && paid
      ? `A WHATIF certificate. ${fact} Bought as ${company} stock each month, it is worth ${numbers.big} today (${numbers.multiple}).`
      : `A WHATIF certificate: ${span} as ${company} stock instead.`,
  };
}

// Page meta (lib/og.js withMeta) for ?c=, or null when c is not one catalogue item.
export function whatifItemMeta(c, model, { catalog, now = new Date() }) {
  const hit = seoItem(c, catalog);
  if (!hit) return null;
  const own = model && model.command === hit.command ? model : null;
  const words = seoWords(hit, own, { now });
  const q = new URLSearchParams({ c: hit.command }).toString();
  return {
    title: words.title,
    description: words.description,
    // v: the numbers' version, so the card matches this description (lib/og.js certMeta).
    image: `${SITE}/og/whatif.png?${own ? new URLSearchParams({ c: hit.command, v: certVersion(own) }) : q}`,
    url: `${SITE}/?${q}`,
    alt: words.alt,
  };
}

// One sitemap URL per catalogue item, the same URL as the page's canonical.
export function whatifSitemapUrls(catalog) {
  return [...catalog.products, ...catalog.recurring]
    .map((p) => `${SITE}/?${new URLSearchParams({ c: `WHATIF ${p.id.toUpperCase()}` })}`);
}

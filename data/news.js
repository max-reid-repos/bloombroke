// Finance headlines from public RSS feeds (no key). Each feed is cached on its own,
// so one dead feed does not take the others down.

import { createCache } from './cache.js';
import { UA } from './quotes.js';

export const FEEDS = [
  { id: 'cnbc', name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { id: 'mw', name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { id: 'yahoo', name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' },
];

// MARKETS headlines: one fetch per feed every 3 minutes, however many people are reading.
export const NEWS_TTL = 3 * 60_000;
const MAX_BYTES = 2_000_000;
const MAX_ITEMS = 50;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', hellip: '...', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// Plain text from an RSS field: unwrap CDATA, decode entities, drop any tags, squash spaces.
export function cleanText(s) {
  let t = String(s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = decodeEntities(t);
  t = t.replace(/<[^>]*>/g, ' ');
  t = decodeEntities(t); // CNBC double-encodes some titles
  return t.replace(/\s+/g, ' ').trim();
}

export function safeLink(raw) {
  try {
    const u = new URL(cleanText(raw));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function tag(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : '';
}

export function parseRss(xml, source) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml))) && items.length < 100) {
    const block = m[1];
    const title = cleanText(tag(block, 'title'));
    const link = safeLink(tag(block, 'link') || tag(block, 'guid'));
    const t = Date.parse(cleanText(tag(block, 'pubDate')));
    if (!title || !link) continue;
    items.push({ title: title.slice(0, 300), link, time: Number.isFinite(t) ? new Date(t).toISOString() : null, source });
  }
  return items;
}

export function titleKey(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Newest first, one copy of each headline.
export function mergeNews(lists, limit = MAX_ITEMS) {
  const seen = new Set();
  const all = lists.flat().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  const out = [];
  for (const item of all) {
    const k = titleKey(item.title);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export function makeNews({ fetchImpl = globalThis.fetch, cache = createCache() } = {}) {
  async function feed(f) {
    return cache.cached(`news:${f.id}`, NEWS_TTL, async () => {
      const res = await fetchImpl(f.url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`news source ${f.id} HTTP ${res.status}`);
      const xml = (await res.text()).slice(0, MAX_BYTES);
      const items = parseRss(xml, f.name);
      if (!items.length) throw new Error(`news source ${f.id}: no items`);
      return items;
    });
  }

  async function getNews() {
    const results = await Promise.allSettled(FEEDS.map(feed));
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!ok.length) throw new Error('news: every feed failed');
    return {
      items: mergeNews(ok.map((r) => r.value)),
      sources: FEEDS.filter((_, i) => results[i].status === 'fulfilled').map((f) => f.name),
      stale: ok.some((r) => r.stale),
      updated: new Date(Math.min(...ok.map((r) => r.fetchedAt))).toISOString(),
    };
  }

  return { getNews };
}

export const { getNews } = makeNews();

// NEWS <ticker>: company headlines from the Nasdaq per-symbol RSS feed (no key).

import { createCache } from './cache.js';
import { normalizeTicker, UA } from './quotes.js';
import { parseRss, mergeNews, cleanText } from './news.js';
import { iso } from './lists.js';

const TTL = 10 * 60_000;
const MAX_BYTES = 2_000_000;

export class TickerNewsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Nasdaq items carry the publisher in <dc:creator>. Use it as the source when present.
export function parseTickerRss(xml) {
  const items = parseRss(xml, 'Nasdaq');
  const creators = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml))) && creators.length < 100) {
    const c = /<dc:creator(?:\s[^>]*)?>([\s\S]*?)<\/dc:creator>/i.exec(m[1]);
    const title = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i.exec(m[1]);
    creators.push([cleanText(title?.[1] || ''), c ? cleanText(c[1]).slice(0, 60) : null]);
  }
  const byTitle = new Map(creators);
  return items.map((it) => ({ ...it, source: byTitle.get(it.title) || it.source }));
}

export function makeTickerNews({ fetchImpl = globalThis.fetch, cache = createCache() } = {}) {
  async function getTickerNews(raw) {
    const ticker = normalizeTicker(raw);
    if (!ticker) throw new TickerNewsError('bad_symbol', 'That does not look like a ticker.');
    let got;
    try {
      got = await cache.cached(`tnews:${ticker}`, TTL, async () => {
        const url = `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(ticker)}`;
        const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`news source HTTP ${res.status}`);
        return parseTickerRss((await res.text()).slice(0, MAX_BYTES));
      });
    } catch {
      throw new TickerNewsError('unavailable', 'News is taking a break. Try again in a minute.');
    }
    return { ticker, items: mergeNews([got.value], 40), stale: got.stale, updated: iso(got.fetchedAt) };
  }
  return { getTickerNews };
}

export const { getTickerNews } = makeTickerNews();

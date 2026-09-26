// NEWS <ticker>: company headlines from the Nasdaq per-symbol RSS feed and Seeking Alpha,
// plus the company's own recent 8-K filings from SEC EDGAR (no keys). One source failing
// leaves the others; all three failing is an error.

import { createCache } from './cache.js';
import { normalizeTicker, UA } from './quotes.js';
import { parseRss, cleanText } from './news.js';
import { iso } from './lists.js';
import { fetchCapped, parseSeekingAlpha, filingTitle, companyName, mergeItems, FEED_TTL } from './newsfeeds.js';
import { parseTickerMap, secTicker } from './financials.js';
import { filingUrl } from './filings.js';

const TTL = 5 * 60_000;
const MAX_BYTES = 2_000_000;
const DAY_MS = 24 * 60 * 60_000;
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_SUBMISSIONS_URL = (cik) => `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;
const SEC_MAX_FILINGS = 10;
const SEC_MAX_AGE_DAYS = 365;

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

// submissions JSON -> the recent 8-Ks as headlines: "Apple Inc.: Results". SEC rows are
// always about the company, so they carry about: true.
export function parseSec8kSubmissions(body, { now = Date.now() } = {}) {
  const r = body?.filings?.recent;
  if (!r || !Array.isArray(r.form)) return [];
  const cik = Number(body.cik);
  const name = companyName(body.name || '') || 'Filing';
  const out = [];
  for (let i = 0; i < r.form.length && out.length < SEC_MAX_FILINGS; i += 1) {
    const form = String(r.form[i] || '').trim().toUpperCase();
    if (form !== '8-K' && form !== '8-K/A') continue;
    const t = Date.parse(r.acceptanceDateTime?.[i] || r.filingDate?.[i] || '');
    if (!Number.isFinite(t) || now - t > SEC_MAX_AGE_DAYS * DAY_MS) continue;
    const link = filingUrl(cik, r.accessionNumber?.[i], r.primaryDocument?.[i]);
    if (!link) continue;
    out.push({ title: filingTitle(name, r.items?.[i], form).slice(0, 300), link, time: new Date(t).toISOString(), source: 'SEC', about: true });
  }
  return out;
}

export function makeTickerNews({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 600 }) } = {}) {
  function nasdaq(ticker) {
    return cache.cached(`tnews:${ticker}`, TTL, async () => {
      const url = `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(ticker)}`;
      const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`news source HTTP ${res.status}`);
      return parseTickerRss((await res.text()).slice(0, MAX_BYTES));
    });
  }

  function seekingAlpha(ticker) {
    return cache.cached(`tnews-sa:${ticker}`, FEED_TTL, async () => {
      const xml = await fetchCapped(fetchImpl, `https://seekingalpha.com/api/sa/combined/${encodeURIComponent(ticker)}.xml`);
      return parseSeekingAlpha(xml).map((it) => ({ ...it, source: 'SA' }));
    });
  }

  async function sec(ticker) {
    const map = await cache.cached('tnews-sec:tickers', DAY_MS, async () => parseTickerMap(JSON.parse(
      await fetchCapped(fetchImpl, SEC_TICKERS_URL, { accept: 'application/json' }),
    )));
    const hit = map.value.get(secTicker(ticker));
    if (!hit) return { value: [], stale: map.stale, fetchedAt: map.fetchedAt };
    return cache.cached(`tnews-sec:${hit.cik}`, TTL, async () => parseSec8kSubmissions(JSON.parse(
      await fetchCapped(fetchImpl, SEC_SUBMISSIONS_URL(hit.cik), { accept: 'application/json' }),
    )));
  }

  async function getTickerNews(raw) {
    const ticker = normalizeTicker(raw);
    if (!ticker) throw new TickerNewsError('bad_symbol', 'That does not look like a ticker.');
    const results = await Promise.allSettled([nasdaq(ticker), seekingAlpha(ticker), sec(ticker)]);
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    if (!ok.length) throw new TickerNewsError('unavailable', 'News is taking a break. Try again in a minute.');
    // Headlines fill the first 40; the company's own filings always stay in, in time order.
    const news = mergeItems(ok.map((g) => g.value), 40);
    const filings = ok.flatMap((g) => g.value).filter((n) => n.source === 'SEC' && !news.includes(n));
    return {
      ticker,
      items: mergeItems([news, filings], 40 + SEC_MAX_FILINGS),
      stale: ok.some((g) => g.stale),
      updated: iso(Math.min(...ok.map((g) => g.fetchedAt))),
    };
  }
  return { getTickerNews };
}

export const { getTickerNews } = makeTickerNews();

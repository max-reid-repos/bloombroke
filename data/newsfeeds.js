// NEWS tabs past MARKETS: MACRO (Fed and BLS), SEC (the latest 8-K filings), WIRES
// (company press releases) and WSB (hot posts on r/wallstreetbets). Also the extra
// sources for NEWS <ticker>: Seeking Alpha and the company's own 8-Ks.
//
// Every feed is fetched here, on the server: 8 s timeout, 5 MB cap (the download stops
// past it), each feed cached on its own: 1 minute for WIRES and SEC, 3 for the rest. One
// dead feed never takes a tab down; a tab with no feed left answers with no items.

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { cleanText, safeLink, titleKey } from './news.js';
import { parseTickerMap } from './financials.js';

export const FEED_UA = 'Bloombroke/1.0 (hello@bloombroke.com)';
export const FEED_TTL = 3 * 60_000;
// WIRES and SEC move fastest: each of their feeds is fetched at most once a minute (the
// server cache is shared, so that holds however many people have the screen open).
export const FAST_FEED_TTL = 60_000;
export const FEED_TIMEOUT_MS = 8000;
export const FEED_MAX_BYTES = 5_000_000;
const MAX_ITEMS = 50;

export const NEWS_TABS = ['MARKETS', 'MACRO', 'SEC', 'WIRES', 'WSB'];

// ---- fetch -----------------------------------------------------------------------

// GET a URL as text, with a timeout and a size cap. Past the cap the download is
// aborted and the call fails.
export async function fetchCapped(fetchImpl, url, { accept = 'application/rss+xml, application/atom+xml, application/xml, text/xml', timeoutMs = FEED_TIMEOUT_MS, maxBytes = FEED_MAX_BYTES, ua = FEED_UA } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': ua, Accept: accept }, signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers?.get?.('content-length'));
    if (declared > maxBytes) { ctl.abort(); throw new Error('response too large'); }
    if (!res.body?.getReader) {
      const t = await res.text();
      if (t.length > maxBytes) throw new Error('response too large');
      return t;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { ctl.abort(); throw new Error('response too large'); }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
    const head = buf.subarray(0, 200).toString('latin1');
    return /encoding=["']iso-8859-1["']/i.test(head) ? buf.toString('latin1') : buf.toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

// ---- parsing helpers --------------------------------------------------------------

function tag(block, name) {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : '';
}

function attr(block, name, key) {
  const m = new RegExp(`<${name}\\b[^>]*\\s${key}=["']([^"']*)["']`, 'i').exec(block);
  return m ? m[1] : '';
}

const isoOf = (s) => {
  const t = Date.parse(cleanText(s));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

// Tracking words the wires and Seeking Alpha add to links. The link still opens the
// same page without them.
const TRACKING = /^(utm_\w+|feedref|source|ref|cmpid|mod)$/i;

export function cleanLink(raw) {
  const href = safeLink(raw);
  if (!href) return null;
  const u = new URL(href);
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  if (u.protocol === 'http:') u.protocol = 'https:';
  return u.href;
}

const blocks = (xml, name) => {
  const out = [];
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'gi');
  let m;
  while ((m = re.exec(String(xml))) && out.length < 100) out.push(m[1]);
  return out;
};

// RSS <item> or Atom <entry> -> [{ title, link, time, source }].
export function parseFeed(xml, source, { keep = () => true } = {}) {
  const items = [];
  for (const b of blocks(xml, 'item')) {
    const title = cleanText(tag(b, 'title'));
    const link = cleanLink(tag(b, 'link') || tag(b, 'guid'));
    if (!title || !link || !keep(b, { title, link })) continue;
    items.push({ title: title.slice(0, 300), link, time: isoOf(tag(b, 'pubDate') || tag(b, 'dc:date')), source });
  }
  if (items.length) return items;
  for (const b of blocks(xml, 'entry')) {
    const title = cleanText(tag(b, 'title'));
    const link = cleanLink(attr(b, 'link', 'href'));
    if (!title || !link || !keep(b, { title, link })) continue;
    items.push({ title: title.slice(0, 300), link, time: isoOf(tag(b, 'published') || tag(b, 'updated')), source });
  }
  return items;
}

// ---- SEC 8-K item codes -------------------------------------------------------------

// 8-K item number -> a few plain words. 9.01 (exhibits) says nothing on its own.
export const ITEM_WORDS = {
  '1.01': 'Deal', '1.02': 'Deal ended', '1.03': 'Bankruptcy', '1.04': 'Mine safety', '1.05': 'Cyber incident',
  '2.01': 'Bought or sold assets', '2.02': 'Results', '2.03': 'New debt', '2.04': 'Debt called early',
  '2.05': 'Restructuring', '2.06': 'Write-down', '3.01': 'Listing notice', '3.02': 'Share sale',
  '3.03': 'Holder rights change', '4.01': 'Auditor change', '4.02': 'Restatement', '5.01': 'Control change',
  '5.02': 'Exec change', '5.03': 'Bylaws change', '5.04': 'Benefit plan blackout', '5.05': 'Ethics code change',
  '5.06': 'Shell company change', '5.07': 'Vote results', '5.08': 'Director nominations', '6.01': 'ABS material',
  '7.01': 'Investor update', '8.01': 'Other',
};

// "2.02, 9.01" (or ["2.02", "9.01"]) -> "Results". Unknown and 9.01 codes are left out.
export function itemWords(items) {
  const codes = Array.isArray(items) ? items : String(items || '').split(/[,\s]+/);
  const words = [];
  for (const c of codes) {
    const m = /^(\d)\.(\d{1,2})$/.exec(String(c).trim());
    if (!m) continue;
    const w = ITEM_WORDS[`${m[1]}.${m[2].padStart(2, '0')}`];
    if (w && !words.includes(w)) words.push(w);
  }
  return words.join(', ');
}

const KEEP_CAPS = new Set(['LP', 'LLC', 'PLC', 'NV', 'SA', 'AG', 'SE', 'II', 'III', 'IV', 'REIT', 'ETF', 'USA', 'US', 'UK', 'AI', 'BDC']);

// "TIDEWATER INC" -> "Tidewater Inc". Names in mixed case stay as filed.
export function companyName(raw) {
  const s = cleanText(raw).replace(/\s+\/[A-Z]{2,}\/?$/, '').trim();
  if (/[a-z]/.test(s)) return s;
  return s.split(' ').map((w) => (KEEP_CAPS.has(w.replace(/[.,]/g, '')) ? w
    : w.toLowerCase().replace(/(^|[(&./-])([a-z])/g, (m, a, b) => a + b.toUpperCase()))).join(' ');
}

export function filingTitle(name, items, form = '8-K') {
  const words = itemWords(items);
  const amended = /\/A$/i.test(form) ? ' (amended)' : '';
  return `${name}: ${words || '8-K filing'}${amended}`;
}

// The SEC "latest filings" Atom feed -> one row per 8-K, named after the company.
export function parseSec8k(xml) {
  const items = [];
  const seen = new Set();
  for (const b of blocks(xml, 'entry')) {
    const t = cleanText(tag(b, 'title'));
    const m = /^(8-K(?:\/A)?)\s+-\s+(.+?)\s+\((\d{10})\)\s+\(([^)]+)\)$/.exec(t);
    if (!m || !/filer/i.test(m[4])) continue;
    const link = cleanLink(attr(b, 'link', 'href'));
    const acc = /accession-number=([\d-]+)/.exec(tag(b, 'id'))?.[1] || link;
    if (!link || seen.has(acc)) continue;
    seen.add(acc);
    const codes = [...cleanText(tag(b, 'summary')).matchAll(/Item (\d\.\d{2})/g)].map((x) => x[1]);
    items.push({ title: filingTitle(companyName(m[2]), codes, m[1]).slice(0, 300), link, time: isoOf(tag(b, 'updated')), source: 'SEC EDGAR', cik: Number(m[3]) });
  }
  return items;
}

// ---- SEC ticker map ---------------------------------------------------------------

export const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
export const SEC_MAP_TTL = 24 * 60 * 60_000;

// company_tickers.json -> { byTicker: Map("BRK-B" -> { cik, title }), byCik: Map(cik -> "BRK.B") }.
// The file lists the biggest companies first, so a CIK's first ticker is its main one.
export function parseSecTickers(body) {
  const byTicker = parseTickerMap(body);
  const byCik = new Map();
  for (const [t, v] of byTicker) if (!byCik.has(v.cik)) byCik.set(v.cik, t.replace('-', '.'));
  return { byTicker, byCik };
}

// One map per fetch function, cached a day, shared by the SEC tab and NEWS <ticker>.
const secMaps = new Map();
export function secTickersFor(fetchImpl) {
  if (!secMaps.has(fetchImpl)) {
    const cache = createCache({ retryMs: 60_000 });
    secMaps.set(fetchImpl, () => cache.cached('sec:tickers', SEC_MAP_TTL, async () => parseSecTickers(JSON.parse(
      await fetchCapped(fetchImpl, SEC_TICKERS_URL, { accept: 'application/json' }),
    ))));
  }
  return secMaps.get(fetchImpl);
}

// SEC tab rows get the filer's ticker (null: no listed ticker, a fund or trust). When the
// map is down (byCik null) the rows go out without one.
export function withTickers(items, byCik) {
  return items.map(({ cik, ...n }) => (byCik ? { ...n, ticker: byCik.get(cik) || null } : n));
}

// ---- WSB --------------------------------------------------------------------------

// Strong profanity and slurs, masked to the first letter: "f***ing".
// ANYWHERE words are masked inside any word (bullshit); WHOLE ones only as the listed
// word forms, so Wankel, retardant and niggling stay.
const ANYWHERE = ['fuck', 'shit', 'faggot'];
const WHOLE = [
  'retard(?:s|ed)?', 'nigg(?:a|er)s?', 'wank(?:s|ed|er|ers|ing)?', 'cunts?', 'whores?', 'sluts?', 'bitch(?:es|ing|y)?',
  'puss(?:y|ies)', 'twats?', 'trann(?:y|ies)', 'fags?', 'cocks?', 'kikes?',
];
const BAD_RE = new RegExp(`[a-z]*(?:${ANYWHERE.join('|')})[a-z]*|\\b(?:${WHOLE.join('|')})\\b`, 'gi');

export function maskProfanity(s) {
  return String(s ?? '').replace(BAD_RE, (w) => w[0] + '*'.repeat(w.length - 1));
}

// Pinned and daily threads, by the bots that post them and by their fixed titles.
const MOD_AUTHORS = new Set(['automoderator', 'visualmod', 'wsbapp']);
const THREAD_TITLE = /^(?:(?:daily|weekend|weekly|earnings|discussion)\s+)+thread\b|^what are your moves|\bmegathread\b/i;

export function isWsbNoise(title, author = '') {
  const a = String(author).replace(/^\/?u\//i, '').toLowerCase();
  return MOD_AUTHORS.has(a) || THREAD_TITLE.test(String(title));
}

// Emoji and other symbols the terminal font cannot draw (they show as empty boxes):
// pictographs, dingbats, arrows and stars (2B00-2BFF), technical symbols, keycaps,
// flags, joiners, variation selectors, tag characters and private use.
const EMOJI = /[\u{1F000}-\u{1FBFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{3297}\u{3299}\u{20E3}\u{200D}\u{FE00}-\u{FE0F}\u{E0000}-\u{E007F}\u{E000}-\u{F8FF}\u{F0000}-\u{10FFFF}]/gu;
export const stripEmoji = (s) => String(s ?? '').replace(EMOJI, '').replace(/\s+/g, ' ').trim();

export function parseWsb(xml) {
  return parseFeed(xml, 'r/wallstreetbets', {
    keep: (b, { title }) => !isWsbNoise(title, cleanText(tag(tag(b, 'author'), 'name'))),
  }).map((it) => ({ ...it, title: maskProfanity(stripEmoji(it.title)) })).filter((it) => it.title);
}

// ---- Seeking Alpha ------------------------------------------------------------------

// News items link to the symbol page; the guid carries the story id, so link the story.
export function parseSeekingAlpha(xml) {
  const items = [];
  for (const b of blocks(xml, 'item')) {
    const title = cleanText(tag(b, 'title'));
    const guid = cleanText(tag(b, 'guid'));
    const news = /MarketCurrent:(\d+)$/.exec(guid);
    const link = news ? `https://seekingalpha.com/news/${news[1]}` : cleanLink(tag(b, 'link'));
    if (!title || !link) continue;
    items.push({ title: title.slice(0, 300), link, time: isoOf(tag(b, 'pubDate')), source: 'Seeking Alpha' });
  }
  return items;
}

// ---- Business Wire ------------------------------------------------------------------

// Law firms fill the wires with class action notices. They are not company news.
const LAW_FIRM = /law firm|investigation initiated|investigates the (officers|directors)|securities fraud|class action|fiduciary dut|shareholder alert|investor alert|investors? (who lost|have opportunity)|lead plaintiff|deadline alert/i;
export const notLawFirm = (b, { title }) => !LAW_FIRM.test(title);
// Business Wire and GlobeNewswire post the same release in several languages: keep
// English (the link path carries the language).
const english = (b, it) => /\/en\//.test(it.link) && notLawFirm(b, it);
// Fed approvals of bank mergers and enforcement actions on single staff are not macro.
const fedMacro = (b) => !/orders on banking applications|enforcement actions/i.test(cleanText(tag(b, 'category')));

// ---- merge -------------------------------------------------------------------------

// Newest first, one copy of each story. Headlines dedupe by title (the same story on two
// feeds); filings dedupe by link, since one company files "Results" every quarter.
const isFiling = (n) => n.source === 'SEC' || n.source === 'SEC EDGAR';
export const dedupeKey = (n) => (isFiling(n) ? `link:${n.link}` : `title:${titleKey(n.title)}`);

export function mergeItems(lists, limit = MAX_ITEMS) {
  const seen = new Set();
  const out = [];
  for (const item of lists.flat().sort((a, b) => (b.time || '').localeCompare(a.time || ''))) {
    const k = dedupeKey(item);
    if (k === 'title:' || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

// ---- the tabs -----------------------------------------------------------------------

export const TAB_FEEDS = {
  MACRO: [
    { id: 'fed-press', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml', keep: fedMacro },
    { id: 'fed-speech', name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/speeches.xml' },
    { id: 'bls-jobs', name: 'BLS', url: 'https://www.bls.gov/feed/empsit.rss' },
    { id: 'bls-cpi', name: 'BLS', url: 'https://www.bls.gov/feed/cpi.rss' },
    { id: 'bls-ppi', name: 'BLS', url: 'https://www.bls.gov/feed/ppi.rss' },
    { id: 'bls-jolts', name: 'BLS', url: 'https://www.bls.gov/feed/jolts.rss' },
  ],
  SEC: [
    { id: 'sec-8k', name: 'SEC EDGAR', url: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&count=40&output=atom', parse: parseSec8k, ttl: FAST_FEED_TTL },
  ],
  WIRES: [
    // The all-releases lists are mostly law firm notices; the earnings and deals lists are not.
    { id: 'prn-earnings', name: 'PR Newswire', url: 'https://www.prnewswire.com/rss/financial-services-latest-news/earnings-list.rss', keep: notLawFirm, ttl: FAST_FEED_TTL },
    { id: 'prn-deals', name: 'PR Newswire', url: 'https://www.prnewswire.com/rss/financial-services-latest-news/acquisitions-mergers-and-takeovers-list.rss', keep: notLawFirm, ttl: FAST_FEED_TTL },
    { id: 'gnw', name: 'GlobeNewswire', url: 'https://rss.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies', keep: english, ttl: FAST_FEED_TTL },
    { id: 'bw-earnings', name: 'Business Wire', url: 'https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEF9YXA==', keep: english, ttl: FAST_FEED_TTL },
    { id: 'bw-deals', name: 'Business Wire', url: 'https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeEFtRWA==', keep: english, ttl: FAST_FEED_TTL },
  ],
  WSB: [
    { id: 'wsb', name: 'r/wallstreetbets', url: 'https://www.reddit.com/r/wallstreetbets/hot/.rss', parse: parseWsb },
  ],
};

export function makeNewsFeeds({ fetchImpl = cappedFetch, cache = createCache({ retryMs: 60_000 }), feeds = TAB_FEEDS, secTickers = secTickersFor(fetchImpl) } = {}) {
  function load(f) {
    return cache.cached(`newsfeed:${f.id}`, f.ttl || FEED_TTL, async () => {
      const xml = await fetchCapped(fetchImpl, f.url);
      const items = f.parse ? f.parse(xml) : parseFeed(xml, f.name, { keep: f.keep });
      // A feed whose rows were all filtered out is fine; one with no rows at all is broken.
      if (!items.length && !/<(item|entry)\b/i.test(xml)) throw new Error(`news feed ${f.id}: no items`);
      return items;
    });
  }

  // { tab, items, sources, failed, stale, updated }. Never throws for a bad feed.
  async function getNewsTab(rawTab) {
    const tab = String(rawTab || '').toUpperCase();
    const list = feeds[tab];
    if (!list) throw new Error(`unknown news tab ${tab}`);
    // The SEC tab needs the ticker map too: fetch it alongside the feed, not after.
    const mapP = tab === 'SEC' ? secTickers().then((g) => g.value.byCik, () => null) : null;
    const results = await Promise.allSettled(list.map(load));
    const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
    for (const [i, r] of results.entries()) if (r.status === 'rejected') console.error(`[news ${list[i].id}]`, r.reason?.message);
    const merged = mergeItems(ok.map((r) => r.value), MAX_ITEMS);
    const names = (pick) => [...new Set(list.filter((_, i) => pick(results[i])).map((f) => f.name))];
    return {
      tab,
      items: mapP ? withTickers(merged, await mapP) : merged,
      sources: names((r) => r.status === 'fulfilled'),
      failed: names((r) => r.status === 'rejected').filter((n) => !names((r) => r.status === 'fulfilled').includes(n)),
      stale: ok.some((r) => r.stale),
      updated: ok.length ? new Date(Math.min(...ok.map((r) => r.fetchedAt))).toISOString() : null,
    };
  }

  // The news hub (data/newshub.js) fetched a feed: keep its rows as this feed's fresh
  // cache entry, so /api/news serves them without fetching the same feed again.
  // ttlMs: how long the entry stays fresh (the hub's gap plus a margin), never less
  // than the feed's own TTL.
  function prime(id, items, ttlMs = 0) {
    const f = Object.values(feeds).flat().find((x) => x.id === id);
    if (!f || !items?.length) return;
    cache.refresh(`newsfeed:${id}`, Math.max(ttlMs, f.ttl || FEED_TTL), async () => items).catch(() => {});
  }

  return { getNewsTab, prime };
}

export const { getNewsTab, prime: primeNewsFeed } = makeNewsFeeds();

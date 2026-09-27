// NEWS <ticker>: company headlines from the Nasdaq per-symbol RSS feed and Seeking Alpha,
// plus the company's own recent 8-K filings from SEC EDGAR, read through FILINGS
// (data/filings.js) so every SEC request goes through its one queue (no keys). One source failing
// leaves the others; all three failing is an error. Headlines about the company also go
// in the per-ticker news log (data/newslog.js), for WHY and the chart's N flags.

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { normalizeTicker, UA } from './quotes.js';
import { parseRss, cleanText } from './news.js';
import { iso } from './lists.js';
import { fetchCapped, parseSeekingAlpha, filingTitle, companyName, mergeItems, secTickersFor, FEED_TTL, FEED_TIMEOUT_MS } from './newsfeeds.js';
import { secTicker } from './financials.js';
import { filingUrl, getFilings as defaultGetFilings, makeFilings, NEWS_MAX_AGE_MS } from './filings.js';
import { newsLog } from './newslog.js';
import { instrumentById } from '../public/instruments.js';
import { aboutTicker } from '../public/screens/tickernews.js';

const TTL = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
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

// New York's UTC offset in ms at an instant (-4 h in summer, -5 h in winter).
function nyOffset(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

// A bare filing day ("2026-07-30") as noon in New York, so it never shows as the day before.
export function nyNoon(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return NaN;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return guess - nyOffset(guess);
}

// When a filing was accepted. EDGAR's acceptanceDateTime is true UTC (checked against the
// filing index page: 20:30:28Z is "Accepted 2026-07-30 16:30:28" Eastern). Without it,
// the filing day at noon New York time.
export function filingTime(accepted, filed) {
  const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(accepted || '')) ? Date.parse(accepted) : NaN;
  return Number.isFinite(t) ? t : nyNoon(filed);
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
    const t = filingTime(r.acceptanceDateTime?.[i], r.filingDate?.[i]);
    if (!Number.isFinite(t) || now - t > SEC_MAX_AGE_DAYS * DAY_MS) continue;
    const link = filingUrl(cik, r.accessionNumber?.[i], r.primaryDocument?.[i]);
    if (!link) continue;
    out.push({ title: filingTitle(name, r.items?.[i], form).slice(0, 300), link, time: new Date(t).toISOString(), source: 'SEC', about: true });
  }
  return out;
}

// FILINGS rows (data/filings.js, 8-K family, newest first) -> the same headlines.
export function sec8kFromFilings(rows, rawName, { now = Date.now() } = {}) {
  const name = companyName(rawName || '') || 'Filing';
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (out.length >= SEC_MAX_FILINGS) break;
    const form = String(r?.form || '').trim().toUpperCase();
    if (form !== '8-K' && form !== '8-K/A') continue;
    const t = filingTime(r.accepted, r.filed);
    if (!Number.isFinite(t) || now - t > SEC_MAX_AGE_DAYS * DAY_MS || !r.url) continue;
    out.push({ title: filingTitle(name, r.items, form).slice(0, 300), link: r.url, time: new Date(t).toISOString(), source: 'SEC', about: true });
  }
  return out.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
}

// A promise that gives up after ms. The work behind it goes on and still fills the cache.
const deadline = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

const HEADLINE_DAYS = 8; // chart N flags: enough for a 5D chart over a long weekend
const MAX_HEADLINES = 100;

// log: the per-ticker news log (data/newslog.js), or null to keep none (tests).
// getFilings: data/filings.js, the one SEC queue (one request at a time, SEC's
// User-Agent, cached a day). A test's own fetchImpl gets its own queue.
export function makeTickerNews({
  fetchImpl = cappedFetch, cache = createCache({ maxEntries: 600 }), secTickers = secTickersFor(fetchImpl), secBudgetMs = FEED_TIMEOUT_MS, log = null, now = () => Date.now(),
  getFilings = fetchImpl === cappedFetch ? defaultGetFilings : makeFilings({ fetchImpl }).getFilings,
} = {}) {
  // Nasdaq resets connections from non-browser User-Agents, so this one keeps the browser UA.
  function nasdaq(ticker) {
    return cache.cached(`tnews:${ticker}`, TTL, async () => {
      const url = `https://www.nasdaq.com/feed/rssoutbound?symbol=${encodeURIComponent(ticker)}`;
      return parseTickerRss(await fetchCapped(fetchImpl, url, { ua: UA }));
    });
  }

  function seekingAlpha(ticker) {
    return cache.cached(`tnews-sa:${ticker}`, FEED_TTL, async () => {
      const xml = await fetchCapped(fetchImpl, `https://seekingalpha.com/api/sa/combined/${encodeURIComponent(ticker)}.xml`);
      return parseSeekingAlpha(xml).map((it) => ({ ...it, source: 'SA' }));
    });
  }

  // The company's 8-Ks through FILINGS (ticker map, then the submissions list, both in
  // the SEC queue). A cold start needs both in a row, so the whole lookup gets one
  // timeout's worth of time; past it the answer goes out without filings and the next
  // one has them. Not an SEC filer: no filings, not an error.
  async function secFilings(ticker) {
    try {
      const f = await getFilings(ticker, '8-K', { maxAgeMs: NEWS_MAX_AGE_MS });
      return { value: sec8kFromFilings(f.rows, f.name, { now: now() }), stale: f.stale, fetchedAt: Date.parse(f.updated) || now() };
    } catch (err) {
      if (err?.code === 'not_found') return { value: [], stale: false, fetchedAt: now() };
      throw err;
    }
  }

  const sec = (ticker) => deadline(secFilings(ticker), secBudgetMs);

  // The ticker's SEC filer entry { cik, title }: null for index, FX, coin and future
  // symbols (registry instruments), for anything the SEC map does not list, and while
  // the map is down.
  const filerOf = (ticker) => (instrumentById(ticker) ? Promise.resolve(null)
    : secTickers().then((m) => m.value.byTicker.get(secTicker(ticker)) || null, () => null));
  const nameOf = (ticker) => filerOf(ticker).then((hit) => hit?.title || null);

  // Headlines about the company go in the news log (WHY reads it), for company stocks
  // the SEC map knows only: no file for BTC or SPX. Filings are not kept: WHY reads them
  // from EDGAR itself.
  function logAbout(ticker, items) {
    const heads = items.filter((n) => n.source !== 'SEC');
    if (!log || !heads.length) return;
    filerOf(ticker).then((hit) => (hit ? log.record(ticker, aboutTicker(heads, ticker, hit.title)) : 0)).catch(() => {});
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
    logAbout(ticker, ok.flatMap((g) => g.value));
    return {
      ticker,
      items: mergeItems([news, filings], 40 + SEC_MAX_FILINGS),
      stale: ok.some((g) => g.stale),
      updated: iso(Math.min(...ok.map((g) => g.fetchedAt))),
    };
  }
  // Chart N flags: headlines about the company from the last few days, live and from
  // the log, newest first: [{ time, source, title, url }].
  async function getTickerHeadlines(raw) {
    const ticker = normalizeTicker(raw);
    if (!ticker) throw new TickerNewsError('bad_symbol', 'That does not look like a ticker.');
    // N flags are for company stocks: an index, pair, coin or future gets none.
    if (instrumentById(ticker)) return { ticker, items: [] };
    const [live, name, logged] = await Promise.all([
      getTickerNews(ticker).then((d) => d.items.filter((n) => n.source !== 'SEC'), () => []),
      nameOf(ticker),
      log ? log.read(ticker) : [],
    ]);
    const since = new Date(now() - HEADLINE_DAYS * DAY_MS).toISOString();
    const fromLog = logged.map((r) => ({ title: r.title, link: r.url, time: r.time, source: r.source }));
    const items = mergeItems([aboutTicker(live, ticker, name), fromLog], 400)
      .filter((n) => n.time && n.time >= since)
      .slice(0, MAX_HEADLINES)
      .map((n) => ({ time: n.time, source: n.source, title: n.title, url: n.link }));
    return { ticker, items };
  }

  return { getTickerNews, getTickerHeadlines };
}

export const { getTickerNews, getTickerHeadlines } = makeTickerNews({ log: newsLog });

// NEWS <ticker>: company headlines from the Nasdaq per-symbol RSS feed and Seeking Alpha,
// plus the company's own recent 8-K filings from SEC EDGAR (no keys). One source failing
// leaves the others; all three failing is an error.

import { createCache } from './cache.js';
import { normalizeTicker, UA } from './quotes.js';
import { parseRss, cleanText } from './news.js';
import { iso } from './lists.js';
import { fetchCapped, parseSeekingAlpha, filingTitle, companyName, mergeItems, secTickersFor, FEED_TTL, FEED_TIMEOUT_MS } from './newsfeeds.js';
import { secTicker } from './financials.js';
import { filingUrl } from './filings.js';

const TTL = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
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

// A promise that gives up after ms. The work behind it goes on and still fills the cache.
const deadline = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

export function makeTickerNews({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 600 }), secTickers = secTickersFor(fetchImpl), secBudgetMs = FEED_TIMEOUT_MS } = {}) {
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

  // Ticker -> CIK from the shared day-long map, then the submissions list. A cold start
  // needs both in a row, so the whole lookup gets one timeout's worth of time; past it
  // the answer goes out without filings and the next one has them.
  async function secFilings(ticker) {
    const map = await secTickers();
    const hit = map.value.byTicker.get(secTicker(ticker));
    if (!hit) return { value: [], stale: map.stale, fetchedAt: map.fetchedAt };
    return cache.cached(`tnews-sec:${hit.cik}`, TTL, async () => parseSec8kSubmissions(JSON.parse(
      await fetchCapped(fetchImpl, SEC_SUBMISSIONS_URL(hit.cik), { accept: 'application/json' }),
    )));
  }

  const sec = (ticker) => deadline(secFilings(ticker), secBudgetMs);

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

// SEC EDGAR for the MCP tools. Every request goes through the one shared SEC queue
// (data/filings.js secQueued: one at a time, 350 ms apart) with the SEC User-Agent.
//
// - secFetch: a fetch that waits its turn in that queue (low lane).
// - The ticker map (company_tickers.json, a day) for checking tickers and naming filers.
// - The live "latest filings" feed (browse-edgar getcurrent, Atom), per form, kept 60 s:
//   the same feed the SEC news tab polls, for any of CURRENT_FORMS.

import { cappedFetch } from '../../data/http.js';
import { createCache } from '../../data/cache.js';
import { SEC_UA } from '../../data/financials.js';
import { secQueued } from '../../data/filings.js';
import { fetchCapped, companyName, itemWords, secTickersFor } from '../../data/newsfeeds.js';
import { cleanText } from '../../data/news.js';

export const CURRENT_FORMS = ['8-K', '10-Q', '10-K', '4', '3', '144', 'SCHEDULE 13D', 'SCHEDULE 13G', 'S-1', 'DEF 14A', '6-K', '20-F'];
export const CURRENT_TTL = 60_000;
export const CURRENT_SOURCE = 'SEC EDGAR latest filings feed';
export const EDGAR_CURRENT_PAGE = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent';

export const currentUrl = (form) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(form)}&company=&dateb=&owner=include&count=100&output=atom`;

// fetch through the shared SEC queue, in its low lane (the site's own SEC requests go
// first, and a full low lane refuses at once with code 'busy'), always with the SEC
// User-Agent.
export function queuedFetch(fetchImpl = cappedFetch, queue = secQueued) {
  return (url, opts = {}) => queue(() => fetchImpl(url, { ...opts, headers: { ...(opts.headers || {}), 'User-Agent': SEC_UA } }), { low: true });
}
export const secFetch = queuedFetch();

const tag = (b, name) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(b)?.[1] || '';
const attr = (b, name, key) => new RegExp(`<${name}\\b[^>]*\\s${key}=["']([^"']*)["']`, 'i').exec(b)?.[1] || '';
const iso = (s) => { const t = Date.parse(cleanText(s)); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const PRIMARY = new Set(['Filer', 'Issuer', 'Subject', 'Filed for']);

// getcurrent Atom -> { updated, rows } for one form (and its /A). Form 4, 13D and 144
// list one entry per party (issuer and reporting person); rows are one per accession,
// named after the company (filer, issuer or subject), with the others in filed_by.
export function parseCurrent(xml, form, byCik = null) {
  const want = String(form).toUpperCase();
  const s = String(xml ?? '');
  const feedHead = s.split(/<entry\b/i)[0];
  const updated = iso(tag(feedHead, 'updated'));
  const byAcc = new Map();
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let m;
  let n = 0;
  while ((m = re.exec(s)) && n < 200) {
    n += 1;
    const b = m[1];
    const t = /^(.+?)\s+-\s+(.+?)\s+\((\d{10})\)\s+\(([^)]+)\)$/.exec(cleanText(tag(b, 'title')));
    if (!t) continue;
    const f = t[1].toUpperCase();
    if (f !== want && f !== `${want}/A`) continue;
    const acc = /accession-number=(\d{10}-\d{2}-\d{6})/.exec(tag(b, 'id'))?.[1];
    const link = cleanText(attr(b, 'link', 'href'));
    if (!acc || !/^https:\/\/www\.sec\.gov\//.test(link)) continue;
    const party = { name: companyName(t[2]).slice(0, 120), cik: Number(t[3]), role: t[4].trim() };
    let row = byAcc.get(acc);
    if (!row) {
      row = { form: t[1], filed_at: iso(tag(b, 'updated')), accession: acc, url: link, parties: [] };
      const codes = [...cleanText(tag(b, 'summary')).matchAll(/Item (\d\.\d{2})/g)].map((x) => x[1]);
      if (codes.length) row.items = itemWords(codes) || null;
      byAcc.set(acc, row);
    }
    row.parties.push(party);
    if (PRIMARY.has(party.role)) row.url = link;
  }
  const rows = [...byAcc.values()].map(({ parties, ...r }) => {
    const main = parties.find((p) => PRIMARY.has(p.role)) || parties[0];
    const others = parties.filter((p) => p !== main).slice(0, 5).map((p) => p.name);
    return {
      form: r.form,
      company: main.name,
      cik: main.cik,
      ticker: byCik?.get(main.cik) || null,
      filed_at: r.filed_at,
      ...(r.items ? { items: r.items } : {}),
      ...(others.length ? { filed_by: others } : {}),
      accession: r.accession,
      url: r.url,
    };
  });
  return { updated, rows };
}

export function makeSecCurrent({ fetchImpl = secFetch, tickers = secTickersFor(fetchImpl), cache = createCache({ retryMs: 30_000 }) } = {}) {
  // -> { value: { updated, rows }, stale, fetchedAt }. Throws when the feed is down and
  // nothing is cached.
  async function getCurrent(form) {
    const f = CURRENT_FORMS.find((x) => x === String(form).toUpperCase());
    if (!f) throw new Error('unknown form');
    const mapP = tickers().then((g) => g.value.byCik, () => null);
    const got = await cache.cached(`current:${f}`, CURRENT_TTL, async () => {
      const xml = await fetchCapped(fetchImpl, currentUrl(f), { accept: 'application/atom+xml, application/xml', maxBytes: 2_000_000 });
      if (!/<feed\b/i.test(xml)) throw new Error('sec current: not a feed');
      return xml;
    });
    const byCik = await mapP;
    return { value: parseCurrent(got.value, f, byCik), stale: got.stale, fetchedAt: got.fetchedAt };
  }
  // The ticker map: { byTicker: Map('BRK-B' -> { cik, title }), byCik }.
  async function tickerMap() {
    return (await tickers()).value;
  }
  return { getCurrent, tickerMap };
}

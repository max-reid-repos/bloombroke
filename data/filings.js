// FILINGS <ticker> [KEY|10-K|10-Q|8-K|4|ALL]: the latest SEC filings, from SEC EDGAR
// (no key). Ticker to CIK from company_tickers.json, the list from the submissions JSON.
// SEC asks for a descriptive User-Agent and under 10 requests a second: calls here go one
// at a time, 350 ms apart. Cached a day.

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { SEC_UA, parseTickerMap, secTicker } from './financials.js';
import { CompanyDataError, DAY_MS, cachedOrThrow, tickerOrThrow } from './company-kit.js';
import { sessionOf } from '../lib/provenance.js';

export { CompanyDataError as FilingsError };

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SUBMISSIONS_URL = (cik) => `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;
export const FILINGS_SOURCE = 'US SEC EDGAR filing index';
export const FILING_FORMS = ['KEY', 'ALL', '10-K', '10-Q', '8-K', '4'];
// Ownership paperwork (insider Forms 3, 4, 5 and 144, and 5% holder schedules) is most of
// a big company's list. KEY is everything else: reports, proxies, registrations.
const OWNERSHIP = /^(3|4|5|144|SC 13[DG]|SCHEDULE 13[DG])(\/A)?$/;
export const isKeyFiling = (form) => !OWNERSHIP.test(String(form || '').toUpperCase().trim());
const MAX_ROWS = 100;

// Plain-English names for the common forms.
const FORM_NAMES = {
  '10-K': 'Annual report', '10-Q': 'Quarterly report', '8-K': 'Current report',
  '20-F': 'Annual report (foreign company)', '40-F': 'Annual report (Canadian company)', '6-K': 'Current report (foreign company)',
  3: 'Insider: first statement of holdings', 4: 'Insider: change in holdings', 5: 'Insider: annual statement of holdings',
  144: 'Notice of planned insider sale', 'S-1': 'Registration of new shares', 'S-3': 'Registration of shares (short form)',
  'S-8': 'Registration of shares for employee plans', '424B2': 'Prospectus', 'DEF 14A': 'Proxy statement',
  DEFA14A: 'Extra proxy material', PX14A6G: 'Shareholder proxy notice', 'SC 13G': 'Ownership over 5% (passive)',
  'SCHEDULE 13G': 'Ownership over 5% (passive)', 'SC 13D': 'Ownership over 5% (active)', 'SCHEDULE 13D': 'Ownership over 5% (active)',
  SD: 'Specialized disclosure (conflict minerals)', 'ARS': 'Annual report to shareholders', 'CERT': 'Exchange listing certificate',
  'UPLOAD': 'SEC letter', 'CORRESP': 'Letter to the SEC', 'FWP': 'Free writing prospectus', '11-K': 'Employee plan annual report',
  '25-NSE': 'Exchange notice of delisting a security',
};

// 8-K item numbers -> what the report is about.
const ITEMS_8K = {
  1.01: 'Material agreement', 1.02: 'End of a material agreement', 1.05: 'Cybersecurity incident',
  2.01: 'Acquisition or sale of assets', 2.02: 'Results of operations', 2.03: 'New debt',
  2.05: 'Exit or restructuring costs', 2.06: 'Impairment', 3.01: 'Listing notice', 3.02: 'Unregistered share sale',
  3.03: 'Change to shareholder rights', 4.01: 'Change of auditor', 4.02: 'Past statements not to be relied on',
  5.01: 'Change in control', 5.02: 'Directors or officers change', 5.03: 'Bylaws or fiscal year change',
  5.07: 'Shareholder vote results', 7.01: 'Regulation FD disclosure', 8.01: 'Other events', 9.01: 'Financial statements and exhibits',
};

// "10-K/A" -> "10-K": the filter chip a form belongs to.
export function formFamily(form) {
  const f = String(form || '').toUpperCase().replace(/\/A$/, '');
  return FILING_FORMS.includes(f) ? f : null;
}

export function describeFiling(form, items, docDescription) {
  const f = String(form || '').toUpperCase();
  const amended = f.endsWith('/A');
  const base = f.replace(/\/A$/, '');
  let out = FORM_NAMES[base] || null;
  if (base === '8-K' || base === '6-K') {
    const names = String(items || '').split(',').map((s) => ITEMS_8K[Number(s.trim())]).filter((s) => s && s !== ITEMS_8K[9.01]);
    if (names.length) out = `${out}: ${names.join(', ')}`;
  }
  const doc = String(docDescription || '').trim();
  if (!out && doc && doc.toUpperCase() !== f) out = doc.slice(0, 80);
  if (!out) return amended ? 'Amendment' : null;
  return amended ? `${out} (amended)` : out;
}

export function filingUrl(cik, accession, doc) {
  const acc = String(accession || '').replace(/-/g, '');
  if (!/^\d{18}$/.test(acc)) return null;
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}/`;
  return doc && /^[\w./-]+$/.test(doc) && !doc.includes('..') ? base + doc : base;
}

// submissions JSON -> { name, cik, rows: [{ form, family, filed, period, description, items, accepted, url }] }.
export function parseSubmissions(body) {
  const r = body?.filings?.recent;
  if (!r || !Array.isArray(r.form)) return null;
  const cik = Number(body.cik);
  const rows = [];
  for (let i = 0; i < r.form.length; i += 1) {
    const form = String(r.form[i] || '').trim();
    const filed = String(r.filingDate?.[i] || '');
    if (!form || !/^\d{4}-\d{2}-\d{2}$/.test(filed)) continue;
    const period = String(r.reportDate?.[i] || '');
    rows.push({
      form,
      family: formFamily(form),
      filed,
      period: /^\d{4}-\d{2}-\d{2}$/.test(period) ? period : null,
      description: describeFiling(form, r.items?.[i], r.primaryDocDescription?.[i]),
      // 8-K item numbers ("2.02" = results of operations), for the chart's earnings flags.
      items: String(r.items?.[i] || '').split(',').map((x) => x.trim()).filter((x) => /^\d+\.\d+$/.test(x)),
      // When EDGAR accepted it (true UTC), for WHY's "after the prior close" window.
      accepted: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(r.acceptanceDateTime?.[i] || '')) ? String(r.acceptanceDateTime[i]) : null,
      // PRE, MKT, AH or WKD from that time (New York), '' without one.
      session: sessionOf(r.acceptanceDateTime?.[i]),
      url: filingUrl(cik, r.accessionNumber?.[i], r.primaryDocument?.[i]),
    });
  }
  rows.sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
  return { name: String(body.name || '').slice(0, 120) || null, cik, rows };
}

// Rows for one chip, newest first, with a count per chip.
export function filterFilings(rows, form = 'ALL', max = MAX_ROWS) {
  const counts = Object.fromEntries(FILING_FORMS.map((f) => [f, 0]));
  for (const r of rows) {
    counts.ALL += 1;
    if (isKeyFiling(r.form)) counts.KEY += 1;
    if (r.family) counts[r.family] += 1;
  }
  const picked = form === 'ALL' ? rows : form === 'KEY' ? rows.filter((r) => isKeyFiling(r.form)) : rows.filter((r) => r.family === form);
  return { rows: picked.slice(0, max), counts, matched: picked.length };
}

// The submissions list news uses (NEWS <ticker>, WHY, chart flags) is at most this old:
// they pass it as maxAgeMs so a new 8-K shows within minutes. FILINGS keeps the day.
export const NEWS_MAX_AGE_MS = 15 * 60_000;

// MCP work waits in the low lane of the SEC queue; past this many waiting there, a new
// low task is refused at once (code 'busy'), so MCP bursts never hold up the site.
export const SEC_LOW_MAX_WAITING = 50;

export class SecBusyError extends Error {
  constructor() {
    super('SEC queue busy');
    this.code = 'busy';
  }
}

export function makeFilings({ fetchImpl = cappedFetch, cache = createCache({ maxEntries: 300, retryMs: 60_000 }), gapMs = 350, now = () => Date.now(), lowMaxWaiting = SEC_LOW_MAX_WAITING } = {}) {
  let lastAt = 0;
  let running = false;
  const high = [];
  const low = [];
  // Run task() in the SEC queue: one at a time, gapMs apart. Every SEC request here (and
  // the news hub's SEC feed, through secQueued) goes through it. The site's own requests
  // go first; { low: true } (the MCP tools) waits behind them, at most lowMaxWaiting deep.
  function pump() {
    if (running) return;
    const job = high.shift() || low.shift();
    if (!job) return;
    running = true;
    const go = async () => {
      lastAt = Date.now();
      try { job.resolve(await job.task()); } catch (err) { job.reject(err); }
      running = false;
      pump();
    };
    const wait = lastAt + gapMs - Date.now();
    if (wait > 0) setTimeout(go, wait);
    else Promise.resolve().then(go);
  }
  function queued(task, { low: isLow = false } = {}) {
    if (isLow && low.length >= lowMaxWaiting) return Promise.reject(new SecBusyError());
    return new Promise((resolve, reject) => {
      (isLow ? low : high).push({ task, resolve, reject });
      pump();
    });
  }
  // How many requests wait (not counting the one running).
  const waiting = () => ({ high: high.length, low: low.length });
  function secGet(url) {
    return queued(async () => {
      const res = await fetchImpl(url, { headers: { 'User-Agent': SEC_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`sec HTTP ${res.status}`);
      return res.json();
    });
  }

  // getFilings(ticker, form, { maxAgeMs }): maxAgeMs asks for a submissions list no
  // older than that. An older cached one is fetched again through the same queue (one
  // fetch however many callers ask at once); if that fails, the old one is served stale.
  async function getFilings(raw, rawForm = 'ALL', { maxAgeMs = DAY_MS } = {}) {
    const ticker = tickerOrThrow(raw);
    const form = FILING_FORMS.includes(String(rawForm || 'ALL').toUpperCase()) ? String(rawForm || 'ALL').toUpperCase() : 'ALL';
    const map = await cachedOrThrow(cache, 'filings:tickers', DAY_MS, async () => {
      const body = await secGet(TICKERS_URL);
      if (!body) throw new Error('sec tickers: missing');
      return parseTickerMap(body);
    }, { what: 'SEC data', missing: 'SEC data is taking a break. Try again in a minute.' });
    const hit = map.value.get(secTicker(ticker));
    if (!hit) throw new CompanyDataError('not_found', `No SEC filings for ${ticker}. Only companies that file with the SEC are listed.`);
    const key = `filings:${hit.cik}`;
    const loadSubs = async () => parseSubmissions(await secGet(SUBMISSIONS_URL(hit.cik)));
    let got = await cachedOrThrow(cache, key, DAY_MS, loadSubs, {
      what: 'SEC data', missing: `No SEC filings for ${ticker}.`,
    });
    if (now() - Date.parse(got.updated) > maxAgeMs) {
      try {
        const r = await cache.refresh(key, DAY_MS, loadSubs);
        if (r.value) got = { value: r.value, stale: false, updated: new Date(r.fetchedAt).toISOString() };
      } catch {
        got = { ...got, stale: true };
      }
    }
    const f = filterFilings(got.value.rows, form);
    return {
      ticker, form, name: got.value.name || hit.title, cik: hit.cik, ...f,
      stale: got.stale, updated: got.updated, source: FILINGS_SOURCE,
    };
  }
  // A new filing for this company (data/edgarwatch.js): the next view refetches.
  const forget = (cik) => cache.forget(`filings:${Number(cik)}`);
  return { getFilings, queued, waiting, forget };
}

const shared = makeFilings();
export const { getFilings, forget: forgetFilings } = shared;
// The shared SEC queue, for other SEC requests (the news hub's current 8-K feed, and
// the MCP tools in its low lane).
export const secQueued = shared.queued;
export const secWaiting = shared.waiting;

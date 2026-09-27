// The EDGAR watcher: a new filing on EDGAR makes the next view of that company fetch
// fresh SEC data, instead of waiting for the day-long caches to run out.
//
// It reads the same "latest filings" Atom feed the NEWS SEC tab reads (browse-edgar
// getcurrent), one feed per form: 8-K, 10-Q, 10-K, 20-F, 6-K and Form 4, each every
// EVERY_MS (30 s), a few seconds apart. Every request goes through the one SEC queue
// (data/filings.js secQueued: one at a time, 350 ms apart) with the SEC User-Agent, is
// conditional (If-None-Match / If-Modified-Since), and backs off on errors like the news
// hub (doubling up to 10 minutes, Retry-After honoured). That is 12 small requests a
// minute, far under SEC's 10 a second.
//
// A form's first answer is a baseline (nothing is invalidated). After that, each
// accession not seen before drops the company's cached submissions (FILINGS, E and N
// flags, WHY), its companyfacts (FINANCIALS, on a 10-Q, 10-K, 20-F or 6-K), its insider
// list (on a Form 4) and its chart events. The drops repeat at +5 and +30 minutes,
// because EDGAR's JSON (and Nasdaq's insider list) can trail the feed.
//
// Speed: for every new filing, seen time minus EDGAR's acceptance time (the entry's
// <updated>, with its ET offset). The median of the last 200 is what DATA shows.

import { cappedFetch } from './http.js';
import { fetchFeed } from './newshub.js';
import { SEC_UA, forgetFinancials } from './financials.js';
import { secQueued, forgetFilings } from './filings.js';
import { forgetInsiders } from './insiders.js';
import { forgetChartEvents } from './chart-events.js';
import { secTickersFor } from './newsfeeds.js';

export const WATCH_FORMS = ['8-K', '10-Q', '10-K', '20-F', '6-K', '4'];
export const EVERY_MS = 30_000;
export const MAX_BACKOFF_MS = 10 * 60_000;
export const REPEAT_MS = [5 * 60_000, 30 * 60_000];
export const MAX_SAMPLES = 200;
const SEEN_MAX = 20_000;
const FACTS_FORMS = new Set(['10-Q', '10-K', '20-F', '6-K']);
const COMPANY_ROLES = new Set(['Filer', 'Issuer', 'Subject', 'Filed by']);

export const currentUrl = (form) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(form)}&company=&dateb=&owner=include&count=100&output=atom`;

const tag = (b, name) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(b)?.[1] || '';
const clean = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// getcurrent Atom -> [{ form, cik, role, accession, accepted }], company entries only
// (the filer or the issuer, not the reporting person of a Form 4). form: as filed, /A too.
// The array's `entries` is how many entries the page had (100 is a full page).
export function parseCurrentFeed(xml, want) {
  const out = [];
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  const w = String(want || '').toUpperCase();
  let m;
  let entries = 0;
  while ((m = re.exec(String(xml ?? ''))) && out.length < 400) {
    entries += 1;
    const b = m[1];
    const t = /^(.+?)\s+-\s+(.+?)\s+\((\d{10})\)\s+\(([^)]+)\)$/.exec(clean(tag(b, 'title')));
    if (!t) continue;
    const form = t[1].toUpperCase();
    if (w && form !== w && form !== `${w}/A`) continue;
    if (!COMPANY_ROLES.has(t[4].trim())) continue;
    const accession = /accession-number=(\d{10}-\d{2}-\d{6})/.exec(tag(b, 'id'))?.[1];
    const at = Date.parse(clean(tag(b, 'updated')));
    if (!accession) continue;
    out.push({ form, cik: Number(t[3]), role: t[4].trim(), accession, accepted: Number.isFinite(at) ? new Date(at).toISOString() : null });
  }
  out.entries = entries;
  return out;
}

// EDGAR accepts filings 06:00 to 22:00 New York time on weekdays; outside that the
// watcher does not ask (federal holidays are not known here: those polls find nothing).
export const OPEN_FROM_H = 6;
export const OPEN_TO_H = 22;
export const CLOSED_CHECK_MS = 5 * 60_000;
export function edgarOpen(t = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const h = Number(p.hour) % 24;
  return p.weekday !== 'Sat' && p.weekday !== 'Sun' && h >= OPEN_FROM_H && h < OPEN_TO_H;
}

export function median(xs) {
  const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

const realTimers = { setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clearTimeout: (t) => clearTimeout(t) };

// Drops a company's caches for one filing, now and again at each of `repeat` ms.
// tickerOf(cik) -> Promise<ticker | [tickers] | null>: every ticker of the company (GOOG
// and GOOGL, BRK.A and BRK.B). forget: { financials(cik), filings(cik),
// insiders(ticker), chartEvents(ticker) }.
export function makeInvalidator({
  tickerOf, forget = { financials: forgetFinancials, filings: forgetFilings, insiders: forgetInsiders, chartEvents: forgetChartEvents },
  timers = realTimers, repeat = REPEAT_MS, log = () => {},
} = {}) {
  const pending = new Map(); // `${cik}|${kind}|${slot}` -> timer, so repeats do not pile up
  async function drop({ form, cik }) {
    const base = String(form).toUpperCase().replace(/\/A$/, '');
    forget.filings?.(cik);
    if (FACTS_FORMS.has(base)) forget.financials?.(cik);
    let tickers = [];
    try { const t = await tickerOf(cik); tickers = Array.isArray(t) ? t : t ? [t] : []; } catch { tickers = []; }
    for (const ticker of tickers) {
      if (base === '4') forget.insiders?.(ticker);
      else forget.chartEvents?.(ticker);
    }
    return tickers;
  }
  return function invalidate(filing) {
    const kind = String(filing.form).toUpperCase().replace(/\/A$/, '');
    repeat.forEach((ms, slot) => {
      const key = `${filing.cik}|${kind}|${slot}`;
      if (pending.has(key)) return;
      pending.set(key, timers.setTimeout(() => { pending.delete(key); drop(filing).catch((err) => log(`[edgarwatch] ${err.message}`)); }, ms));
    });
    return drop(filing);
  };
}

// start() / stop(); stats() -> { okAt, failAt, ms, polls, filings, samples, medianDelay,
// overflow, forms: { form: { gap, okAt, failAt } } }.
export function makeEdgarWatch({
  fetchImpl = cappedFetch, secQueue = secQueued, forms = WATCH_FORMS, every = EVERY_MS,
  onFiling = () => {}, now = () => Date.now(), timers = realTimers, log = (m) => console.error(m), maxBackoff = MAX_BACKOFF_MS,
  isOpen = edgarOpen,
} = {}) {
  // SEC says slow down (403 or 429): every form waits, not only the one that was told.
  let pauseUntil = 0;
  let sharedGap = every;
  const states = forms.map((form) => ({ form, etag: null, lastModified: null, gap: every, fails: 0, baselined: false, timer: null, okAt: 0, failAt: 0 }));
  const seen = new Set();
  const samples = [];
  // newestAt: the newest acceptance time seen in any feed (how old the newest filing is).
  const s = { okAt: 0, failAt: 0, ms: null, polls: 0, filings: 0, overflow: 0, newestAt: 0 };
  let running = false;

  function remember(acc) {
    seen.add(acc);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
  }

  // false when nothing was asked (EDGAR closed, or the shared pause).
  async function poll(st) {
    const t0 = now();
    s.paused = !isOpen(t0);
    if (s.paused || t0 < pauseUntil) return false;
    try {
      // The low lane: the site's own SEC requests go first.
      const r = await secQueue(() => fetchFeed(fetchImpl, currentUrl(st.form), { etag: st.etag, lastModified: st.lastModified, ua: SEC_UA, accept: 'application/atom+xml, application/xml, text/xml' }), { low: true });
      s.polls += 1;
      if (!r.notModified) {
        st.etag = r.etag || null;
        st.lastModified = r.lastModified || null;
        const rows = parseCurrentFeed(r.text, st.form);
        for (const x of rows) { const a = Date.parse(x.accepted || ''); if (a > s.newestAt) s.newestAt = a; }
        const fresh = rows.filter((x) => !seen.has(`${x.accession}|${x.cik}`));
        // A full page of entries, none seen before: more came in than one page holds.
        if (st.baselined && rows.entries >= 100 && rows.length && fresh.length === rows.length) s.overflow += 1;
        const seenAt = now();
        for (const x of fresh) {
          remember(`${x.accession}|${x.cik}`);
          if (!st.baselined) continue;
          s.filings += 1;
          const acc = Date.parse(x.accepted || '');
          const delay = Number.isFinite(acc) ? (seenAt - acc) / 1000 : NaN;
          if (Number.isFinite(delay) && delay >= 0 && delay <= 6 * 3600) {
            samples.push(delay);
            if (samples.length > MAX_SAMPLES) samples.shift();
          }
          try { await onFiling({ ...x, seenAt: new Date(seenAt).toISOString(), delaySeconds: Number.isFinite(delay) ? Math.round(delay) : null }); } catch (err) { log(`[edgarwatch] ${err.message}`); }
        }
        st.baselined = true;
      }
      st.fails = 0;
      st.gap = every;
      sharedGap = every;
      st.okAt = now();
      s.okAt = st.okAt;
      s.ms = st.okAt - t0;
    } catch (err) {
      if (err?.code === 'busy') return false; // the low lane is full: try on the next turn
      if (err?.status === 403 || err?.status === 429) {
        sharedGap = Math.max(Math.min(maxBackoff, sharedGap * 2), Math.min(err.retryAfterMs || 0, 60 * 60_000));
        pauseUntil = now() + sharedGap;
      }
      st.fails += 1;
      st.gap = Math.max(Math.min(maxBackoff, st.gap * 2), Math.min(err.retryAfterMs || 0, 60 * 60_000));
      st.failAt = now();
      s.failAt = st.failAt;
      s.ms = st.failAt - t0;
      if (st.fails === 1 || st.gap >= maxBackoff) log(`[edgarwatch ${st.form}] ${err.message}; next try in ${Math.round(st.gap / 1000)} s`);
    }
    return true;
  }

  // The wait before a form's next poll: its own gap, the shared pause, or (EDGAR closed)
  // a look every CLOSED_CHECK_MS.
  function nextWait(st) {
    const t = now();
    if (!isOpen(t)) return CLOSED_CHECK_MS;
    return Math.max(st.gap, pauseUntil - t);
  }

  function loop(st) {
    if (!running) return;
    poll(st).finally(() => {
      if (running) st.timer = timers.setTimeout(() => loop(st), nextWait(st));
    });
  }

  return {
    start() {
      if (running) return;
      running = true;
      // Spread over the gap, so the forms do not all ask at once.
      states.forEach((st, i) => { st.timer = timers.setTimeout(() => loop(st), Math.round((every / states.length) * i)); });
    },
    stop() {
      running = false;
      for (const st of states) timers.clearTimeout(st.timer);
    },
    // Every form once, one after another (as the SEC queue runs them).
    async pollAll() { for (const st of states) await poll(st); },
    stats: () => ({
      ...s,
      samples: samples.length,
      medianDelay: samples.length ? Math.round(median(samples)) : null,
      pausedUntil: pauseUntil > now() ? pauseUntil : 0,
      forms: Object.fromEntries(states.map((st) => [st.form, { gap: st.gap, okAt: st.okAt, failAt: st.failAt }])),
    }),
  };
}

// The server's watcher: invalidates the shared caches, tickers from the SEC map.
export function startEdgarWatch({ fetchImpl = cappedFetch, log = (m) => console.error(m) } = {}) {
  const secMap = secTickersFor(fetchImpl);
  // Every ticker of a CIK (the SEC map lists each class share), built once per map.
  let built = null;
  const byCik = new Map();
  const tickerOf = async (cik) => {
    const map = (await secMap()).value;
    if (built !== map) {
      byCik.clear();
      for (const [t, v] of map.byTicker) byCik.set(v.cik, [...(byCik.get(v.cik) || []), t.replace('-', '.')]);
      built = map;
    }
    return byCik.get(cik) || [];
  };
  const invalidate = makeInvalidator({ tickerOf, log });
  const watch = makeEdgarWatch({ fetchImpl, onFiling: invalidate, log });
  watch.start();
  return watch;
}

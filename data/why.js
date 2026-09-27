// WHY <ticker>: the 10 biggest daily moves of the last year, by the absolute close to
// close change, from the same daily bars the charts draw (data/charts.js, 1Y). Beside
// each move: what came out in its window, from the prior close to that day's close:
//   - the company's 8-K filings, from the EDGAR submissions JSON (cached 12 h), with the
//     item codes in plain words ("8-K: earnings");
//   - the earnings date, from the chart's E flag source (data/chart-events.js), when no
//     results 8-K already covers it;
//   - headlines from the per-ticker news log (data/newslog.js), which grows over time.
// Nothing found is an empty list (the screen shows --). It never says what caused a move.
//
// Only company stocks: indexes, FX, crypto and futures (registry instruments) and symbols
// with no SEC filer come back with company: false and no rows.

import { createCache } from './cache.js';
import { normalizeTicker } from './quotes.js';
import { getChart as defaultGetChart } from './charts.js';
import { getChartEvents as defaultGetChartEvents } from './chart-events.js';
import { fetchCapped, secTickersFor } from './newsfeeds.js';
import { secTicker } from './financials.js';
import { filingUrl } from './filings.js';
import { newsLog } from './newslog.js';
import { nyDay } from './lists.js';
import { instrumentById } from '../public/instruments.js';

export const WHY_MOVES = 10;
export const SEC_TTL = 12 * 60 * 60_000;
const SUBMISSIONS_URL = (cik) => `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;
const MAX_NEWS = 5; // headlines per move

export class WhyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---- 8-K item codes in plain words ---------------------------------------------------

// 9.01 (exhibits) says nothing on its own and is left out.
export const WHY_ITEMS = {
  '1.01': 'major agreement', '1.02': 'agreement ended', '1.03': 'bankruptcy', '1.04': 'mine safety',
  '1.05': 'cybersecurity incident', '2.01': 'bought or sold assets', '2.02': 'earnings', '2.03': 'new debt',
  '2.04': 'debt due early', '2.05': 'restructuring costs', '2.06': 'write-down', '3.01': 'listing notice',
  '3.02': 'unregistered share sale', '3.03': 'shareholder rights change', '4.01': 'auditor change',
  '4.02': 'restatement', '5.01': 'change in control', '5.02': 'executive change', '5.03': 'bylaws change',
  '5.04': 'benefit plan blackout', '5.05': 'ethics code change', '5.06': 'shell status change',
  '5.07': 'shareholder vote', '5.08': 'director nominations', '6.01': 'asset-backed securities',
  '7.01': 'investor disclosure', '8.01': 'other events',
};

// ["2.02", "9.01"] or "2.02,9.01" -> ["earnings"]. Unknown codes and 9.01 drop out.
export function itemWords(items) {
  const codes = Array.isArray(items) ? items : String(items || '').split(/[,\s]+/);
  const out = [];
  for (const c of codes) {
    const m = /^(\d)\.(\d{1,2})$/.exec(String(c).trim());
    const w = m && WHY_ITEMS[`${m[1]}.${m[2].padStart(2, '0')}`];
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

// "8-K: earnings, executive change", "8-K filing" (no words), "(amended)" for 8-K/A.
export function filingText(items, form = '8-K') {
  const words = itemWords(items);
  const amended = /\/A$/i.test(form) ? ' (amended)' : '';
  return `${words.length ? `8-K: ${words.join(', ')}` : '8-K filing'}${amended}`;
}

// ---- Times --------------------------------------------------------------------------

// The UTC time of hh:mm New York time on a New York day ("2026-09-25").
export function nyAt(day, hh = 16, mm = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return NaN;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(guess)).map((x) => [x.type, Number(x.value)]));
  const off = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess;
  return guess - off;
}
export const closeAt = (day) => nyAt(day, 16, 0);

// ---- Moves --------------------------------------------------------------------------

// Daily bars (oldest first) -> the n biggest close to close moves, biggest first:
// [{ date, prevDate, pct, close, prevClose }]. A bar for today before the 16:00 close is
// not a close yet and is left out.
export function biggestMoves(points, { n = WHY_MOVES, now = Date.now() } = {}) {
  const bars = (points || []).filter((p) => Number.isFinite(p?.t) && Number.isFinite(p?.v) && p.v > 0 && !p.live);
  const today = nyDay(now);
  const moves = [];
  for (let i = 1; i < bars.length; i += 1) {
    const date = nyDay(bars[i].t);
    const prevDate = nyDay(bars[i - 1].t);
    if (date === prevDate) continue;
    if (date === today && now < closeAt(date)) continue;
    const pct = (bars[i].v / bars[i - 1].v - 1) * 100;
    if (!Number.isFinite(pct)) continue;
    moves.push({ date, prevDate, pct, close: bars[i].v, prevClose: bars[i - 1].v });
  }
  return moves.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || (a.date < b.date ? 1 : -1)).slice(0, n);
}

// ---- EDGAR ---------------------------------------------------------------------------

// submissions JSON -> the 8-Ks: [{ form, date, time, items, text, url }], newest first.
// time: EDGAR's acceptanceDateTime (true UTC), NaN when missing.
export function eightKs(body) {
  const r = body?.filings?.recent;
  if (!r || !Array.isArray(r.form)) return [];
  const cik = Number(body.cik);
  const out = [];
  for (let i = 0; i < r.form.length; i += 1) {
    const form = String(r.form[i] || '').trim().toUpperCase();
    if (form !== '8-K' && form !== '8-K/A') continue;
    const date = String(r.filingDate?.[i] || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const acc = String(r.acceptanceDateTime?.[i] || '');
    const time = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(acc) ? Date.parse(acc) : NaN;
    const items = String(r.items?.[i] || '').split(',').map((x) => x.trim()).filter((x) => /^\d+\.\d+$/.test(x));
    out.push({ form, date, time, items, text: filingText(items, form), url: filingUrl(cik, r.accessionNumber?.[i], r.primaryDocument?.[i]) });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// ---- Matching -----------------------------------------------------------------------

// What came out in a move's window: after the prior close, up to that day's close. A
// timed item (a filing's acceptance, a headline) counts by its time; a day with no time
// (an earnings date) counts when it falls after the prior trading day, up to the move's.
// -> [{ kind: 'FILING' | 'EARNINGS' | 'NEWS', time, date, text, url, source }], filings
// first, then the earnings date, then headlines in time order.
export function whatCameOut(move, { filings = [], earnings = [], headlines = [] } = {}) {
  const a = closeAt(move.prevDate);
  const b = closeAt(move.date);
  const inWindow = (t) => t > a && t <= b;
  const inDays = (d) => d > move.prevDate && d <= move.date;
  const out = [];
  const fil = filings.filter((f) => (Number.isFinite(f.time) ? inWindow(f.time) : inDays(f.date)))
    .sort((x, y) => (x.time || 0) - (y.time || 0));
  for (const f of fil) out.push({ kind: 'FILING', time: Number.isFinite(f.time) ? new Date(f.time).toISOString() : null, date: f.date, text: f.text, url: f.url || null, source: 'SEC EDGAR' });
  const results = fil.some((f) => f.items?.includes('2.02'));
  if (!results) {
    const e = earnings.find((x) => x?.date && inDays(x.date));
    if (e) out.push({ kind: 'EARNINGS', time: null, date: e.date, text: e.est ? 'Earnings date (estimated)' : 'Earnings date', url: e.url || null, source: e.url ? 'SEC EDGAR' : 'CNBC' });
  }
  const news = headlines.map((h) => ({ ...h, t: Date.parse(h.time) })).filter((h) => Number.isFinite(h.t) && inWindow(h.t))
    .sort((x, y) => x.t - y.t).slice(0, MAX_NEWS);
  for (const h of news) out.push({ kind: 'NEWS', time: new Date(h.t).toISOString(), date: nyDay(h.t), text: h.title, url: h.url || null, source: h.source || '' });
  return out;
}

// ---- The service ---------------------------------------------------------------------

export function makeWhy({
  fetchImpl = globalThis.fetch, getChart = defaultGetChart, getChartEvents = defaultGetChartEvents,
  log = null, secTickers = secTickersFor(fetchImpl), cache = createCache({ maxEntries: 400, retryMs: 60_000 }), now = () => Date.now(),
} = {}) {
  function filingsFor(cik) {
    return cache.cached(`why-sec:${cik}`, SEC_TTL, async () => eightKs(JSON.parse(
      await fetchCapped(fetchImpl, SUBMISSIONS_URL(cik), { accept: 'application/json' }),
    )));
  }

  async function getWhy(raw) {
    const ticker = normalizeTicker(raw);
    if (!ticker) throw new WhyError('bad_symbol', 'That does not look like a ticker.');
    const base = { ticker, range: '1Y', moves: WHY_MOVES };
    if (instrumentById(ticker)) return { ...base, company: false, name: null, rows: [] };

    let map = null;
    try { map = (await secTickers()).value.byTicker; } catch { map = null; }
    const hit = map ? map.get(secTicker(ticker)) : null;
    if (map && !hit) return { ...base, company: false, name: null, rows: [] };

    let chart;
    try {
      chart = await getChart(ticker, '1Y');
    } catch (err) {
      const code = err?.code === 'not_found' || err?.code === 'no_data' ? 'not_found' : 'unavailable';
      throw new WhyError(code, code === 'not_found' ? `No daily prices for ${ticker}.` : 'Price data is taking a break. Try again in a minute.');
    }
    const [fil, ev, logged] = await Promise.allSettled([
      hit ? filingsFor(hit.cik) : Promise.reject(new Error('no SEC map')),
      getChartEvents(ticker),
      log ? log.read(ticker) : Promise.resolve([]),
    ]);
    const filings = fil.status === 'fulfilled' ? fil.value.value : [];
    const events = ev.status === 'fulfilled' ? ev.value : null;
    const earnings = events ? [...(events.earnings || []), ...(events.next ? [{ date: events.next.date, est: events.next.est, url: null }] : [])] : [];
    const headlines = logged.status === 'fulfilled' ? logged.value : [];
    const t = now();
    const rows = biggestMoves(chart.points, { now: t }).map((m, i) => ({
      rank: i + 1, ...m, items: whatCameOut(m, { filings, earnings, headlines }),
    }));
    const oldest = headlines.length ? headlines[headlines.length - 1].time : null;
    return {
      ...base,
      company: true,
      name: hit?.title || null,
      rows,
      secOk: fil.status === 'fulfilled',
      earningsOk: Boolean(events),
      logSince: oldest,
      sources: ['CNBC daily bars', 'SEC EDGAR', ...(headlines.length ? ['Bloombroke news log'] : [])],
      stale: Boolean(chart.stale || (fil.status === 'fulfilled' && fil.value.stale)),
      updated: new Date(t).toISOString(),
    };
  }

  return { getWhy };
}

export const { getWhy } = makeWhy({ log: newsLog });

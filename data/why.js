// WHY <ticker>: the 10 biggest daily moves of the last year, by the absolute close to
// close change, from the same daily bars the charts draw (data/charts.js, 1Y). Beside
// each move: what came out in its window, from the prior close to that day's close:
//   - the company's 8-K filings, from FILINGS' own EDGAR fetch (data/filings.js: one SEC
//     request at a time, SEC's User-Agent, cached a day), matched by EDGAR's acceptance
//     time, with the item codes in plain words ("8-K: earnings");
//   - the CNBC earnings date (the chart's E flag source, data/chart-events.js), when no
//     results 8-K already covers it. Past earnings come from the 8-Ks themselves, which
//     carry the time: a report after the close counts on the next session;
//   - headlines from the per-ticker news log (data/newslog.js), which grows over time.
// Nothing found is an empty list (the screen shows --). It never says what caused a move.
//
// Only company stocks: indexes, FX, crypto and futures (registry instruments) and symbols
// with no SEC filer come back with company: false and no rows.

import { normalizeTicker } from './quotes.js';
import { getChart as defaultGetChart } from './charts.js';
import { getChartEvents as defaultGetChartEvents } from './chart-events.js';
import { getFilings as defaultGetFilings, NEWS_MAX_AGE_MS } from './filings.js';
import { newsLog } from './newslog.js';
import { nyDay } from './lists.js';
import { instrumentById } from '../public/instruments.js';
import { WHY_ITEMS, itemWords, filingText } from '../public/eightk.js';

export const WHY_MOVES = 10;
const MAX_NEWS = 5; // headlines per move

export class WhyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---- 8-K item codes in plain words (public/eightk.js, shared with the chart) -----------

export { WHY_ITEMS, itemWords, filingText };

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

// FILINGS rows (data/filings.js, 8-K family) -> the 8-Ks: [{ form, date, time, items,
// text, url }], newest first. time: EDGAR's acceptance time (true UTC), NaN when missing.
export function eightKs(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const form = String(r?.form || '').trim().toUpperCase();
    if (form !== '8-K' && form !== '8-K/A') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.filed || '')) continue;
    const time = r.accepted ? Date.parse(r.accepted) : NaN;
    const items = Array.isArray(r.items) ? r.items : [];
    out.push({ form, date: r.filed, time, items, text: filingText(items, form), url: r.url || null, ...(r.session ? { session: r.session } : {}) });
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
  // session: PRE, MKT, AH or WKD from EDGAR's acceptance time, when the row has one.
  for (const f of fil) out.push({ kind: 'FILING', time: Number.isFinite(f.time) ? new Date(f.time).toISOString() : null, date: f.date, text: f.text, url: f.url || null, source: 'SEC EDGAR', ...(f.session ? { session: f.session } : {}) });
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

// getFilings: data/filings.js (the gated SEC fetch, shared with FILINGS and the E flags).
export function makeWhy({
  getFilings = defaultGetFilings, getChart = defaultGetChart, getChartEvents = defaultGetChartEvents,
  log = null, now = () => Date.now(),
} = {}) {
  async function getWhy(raw) {
    const ticker = normalizeTicker(raw);
    if (!ticker) throw new WhyError('bad_symbol', 'That does not look like a ticker.');
    const base = { ticker, range: '1Y', moves: WHY_MOVES };
    if (instrumentById(ticker)) return { ...base, company: false, name: null, rows: [] };

    // FILINGS says whether it is an SEC filer: not_found is not a company stock.
    const fil = await getFilings(ticker, '8-K', { maxAgeMs: NEWS_MAX_AGE_MS }).then((v) => ({ ok: true, v }), (err) => ({ ok: false, err }));
    if (!fil.ok && fil.err?.code === 'not_found') return { ...base, company: false, name: null, rows: [] };

    let chart;
    try {
      chart = await getChart(ticker, '1Y');
    } catch (err) {
      const code = err?.code === 'not_found' || err?.code === 'no_data' ? 'not_found' : 'unavailable';
      throw new WhyError(code, code === 'not_found' ? `No daily prices for ${ticker}.` : 'Price data is taking a break. Try again in a minute.');
    }
    const [ev, logged] = await Promise.allSettled([
      getChartEvents(ticker),
      log ? log.read(ticker) : Promise.resolve([]),
    ]);
    const filings = fil.ok ? eightKs(fil.v.rows) : [];
    const events = ev.status === 'fulfilled' ? ev.value : null;
    // The E flags' past dates are the results 8-Ks' filing days, which do not say before
    // or after the close: the 8-Ks above carry that. Only the CNBC date is added here.
    const earnings = events?.next ? [{ date: events.next.date, est: events.next.est, url: null }] : [];
    const headlines = logged.status === 'fulfilled' ? logged.value : [];
    const t = now();
    const rows = biggestMoves(chart.points, { now: t }).map((m, i) => ({
      rank: i + 1, ...m, items: whatCameOut(m, { filings, earnings, headlines }),
    }));
    const oldest = headlines.length ? headlines[headlines.length - 1].time : null;
    return {
      ...base,
      company: true,
      name: fil.ok ? fil.v.name || null : null,
      rows,
      secOk: fil.ok,
      earningsOk: Boolean(events),
      logSince: oldest,
      // The last daily close in the series (its day, New York): how old the prices are.
      asOf: chart.points?.length ? nyDay(chart.points[chart.points.length - 1].t) : null,
      sources: ['CNBC daily bars', 'SEC EDGAR', ...(headlines.length ? ['Bloombroke news log'] : [])],
      stale: Boolean(chart.stale || (fil.ok && fil.v.stale)),
      updated: new Date(t).toISOString(),
    };
  }

  return { getWhy };
}

export const { getWhy } = makeWhy({ log: newsLog });

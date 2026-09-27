// SECTORS: the 11 SPDR sector ETFs and their S&P 100 members, over one period
// (1D 1W 1M YTD 1Y). Prices: the CNBC quote service (the ETF list, and the S&P 100
// batch HEATMAP and FISHTANK use). 1W to 1Y compare today's price with a past daily
// close from CNBC daily bars (no key). Those past closes change once a day, so they are
// kept for the New York day; the price they are compared with is live.

import { makeCnbcList, nyDay, addDays } from './lists.js';
import { makeCharts } from './charts.js';
import { createCache } from './cache.js';
import { SP100, SECTORS as SECTOR_NAMES, getHeatmap, getFishtank } from './sp100.js';

// key: the sector key the S&P 100 list uses (data/sp100.js).
export const SECTOR_ETFS = [
  { id: 'XLK', src: 'XLK', name: 'Technology', key: 'TECH' },
  { id: 'XLC', src: 'XLC', name: 'Communication Services', key: 'COMM' },
  { id: 'XLY', src: 'XLY', name: 'Consumer Discretionary', key: 'DISC' },
  { id: 'XLP', src: 'XLP', name: 'Consumer Staples', key: 'STAPLES' },
  { id: 'XLV', src: 'XLV', name: 'Health Care', key: 'HEALTH' },
  { id: 'XLF', src: 'XLF', name: 'Financials', key: 'FIN' },
  { id: 'XLI', src: 'XLI', name: 'Industrials', key: 'IND' },
  { id: 'XLE', src: 'XLE', name: 'Energy', key: 'ENERGY' },
  { id: 'XLU', src: 'XLU', name: 'Utilities', key: 'UTIL' },
  { id: 'XLRE', src: 'XLRE', name: 'Real Estate', key: 'RE' },
  { id: 'XLB', src: 'XLB', name: 'Materials', key: 'MAT' },
];

export const PERIODS = ['1D', '1W', '1M', 'YTD', '1Y'];

// Any case, anything else: 1D.
export const cleanPeriod = (p) => (PERIODS.includes(String(p ?? '').toUpperCase()) ? String(p).toUpperCase() : '1D');

// "2026-09-25" -> "2026-08-25" (clamped to the month's last day: 03-31 -> 02-28).
export function monthBefore(day) {
  const [y, m, d] = day.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// "2026-09-25" -> "2025-09-25"; 29 Feb -> 28 Feb.
export function yearBefore(day) {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const pct = (now, base) => (Number.isFinite(now) && base > 0 ? ((now - base) / base) * 100 : null);

// Daily closes [{ t, v }] (oldest first) and today's price -> % change over 1 month and year to date.
// 1M compares with the last close on or before the same day last month; YTD with the last close
// of the previous year.
export function periodChanges(points, last, today) {
  const b = periodBases(points, today);
  return { m1: pct(last, b['1M']), ytd: pct(last, b.YTD) };
}

// Daily closes [{ t, v }] (oldest first) -> the close each period starts from:
// 1W the last close on or before the same day a week ago, 1M a month ago, 1Y a year ago,
// YTD the last close of the previous year. null when the closes do not reach back that far.
export function periodBases(points, today) {
  const on = { '1W': addDays(today, -7), '1M': monthBefore(today), '1Y': yearBefore(today) };
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const out = { '1W': null, '1M': null, YTD: null, '1Y': null };
  const first = points.length ? nyDay(points[0].t) : null;
  for (const p of points) {
    if (!(p.v > 0)) continue;
    const d = nyDay(p.t);
    for (const k of ['1W', '1M', '1Y']) if (d <= on[k]) out[k] = p.v;
    if (d < yearStart) out.YTD = p.v;
  }
  // A close from before the series starts is unknown, not the first close we have.
  if (first) for (const k of ['1W', '1M', '1Y']) if (first > on[k]) out[k] = null;
  return out;
}

// % move over a period: 1D is the source's day move; the others need a base close.
export function periodMove(period, { last, changePct }, bases) {
  if (period === '1D') return Number.isFinite(changePct) ? changePct : null;
  return pct(last, bases?.[period]);
}

// items -> fn(item) with at most `n` running at once. Results in order.
export async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const MIN = 60_000;
export const BASES_TTL = 6 * 60 * MIN; // all found: until the next New York day, or 6 hours
export const BASES_RETRY = 10 * MIN; // some missing: those are tried again after this
export const BASES_CONCURRENCY = 6;
export const BASES_WAIT = 12_000; // the longest a request waits on a new day's first load
// The past closes come from their own small chart cache, so 111 one-year charts never
// push visitors' charts out of the shared one.
const ownCharts = () => makeCharts({ cache: createCache({ maxEntries: 20 }) }).getChart;

// S&P 100 members with their last price: FISHTANK's list keeps every member (a missing
// cap is null), HEATMAP's carries the price. One cached CNBC batch behind both.
async function defaultStocks() {
  const [h, f] = await Promise.all([getHeatmap(), getFishtank()]);
  const lastOf = new Map(h.stocks.map((s) => [s.ticker, s.last]));
  return { stocks: f.stocks.map((s) => ({ ...s, last: lastOf.get(s.ticker) ?? null })), stale: f.stale, asOfList: h.asOfList };
}

// warm: a 1D visit starts loading the past closes in the background (once a day), so
// switching to 1W, 1M, YTD or 1Y does not wait on 112 charts.
export function makeSectors({ getChart = null, getStocks = defaultStocks, now = () => Date.now(), warm = true, basesWait = BASES_WAIT, ...opts } = {}) {
  const list = makeCnbcList({ key: 'sectors', items: SECTOR_ETFS, minRows: 8, ...opts });
  const chart = getChart || ownCharts();
  const symbols = [...SECTOR_ETFS.map((e) => e.id), ...SP100.map((m) => m.ticker)];
  let memo = null; // { day, bases: { SYM: { '1W', '1M', YTD, '1Y' } }, until }
  let inflight = null; // { day, run, next }: a load under way, and what it has so far

  // Load the past closes for `today`: the saved ones kept (same day), the rest fetched.
  // Each close lands in `next` as it arrives, so a caller that stops waiting still gets
  // what has come in.
  function startLoad(today) {
    const keep = memo && memo.day === today ? memo.bases : {};
    const next = { day: today, bases: { ...keep }, until: 0 };
    const want = symbols.filter((s) => !keep[s]);
    const from = addDays(today, -375);
    const run = mapLimit(want, BASES_CONCURRENCY, (s) => chart(s, { from })
      .then((c) => { next.bases[s] = periodBases(c.points, today); })
      .catch(() => {}))
      .then(() => {
        const missing = symbols.filter((s) => !next.bases[s]).length;
        next.until = now() + (missing ? BASES_RETRY : BASES_TTL);
        memo = next;
        return memo;
      })
      .finally(() => { if (inflight?.next === next) inflight = null; });
    inflight = { day: today, run, next };
    return inflight;
  }

  // Past closes for every symbol, for today (New York). The same day: the saved closes at
  // once, and the missing ones tried again in the background. A new day: wait for the
  // load, at most basesWait, then answer with what has come in (the rest is --).
  function getBases() {
    const today = nyDay(now());
    const same = memo && memo.day === today;
    if (same && now() < memo.until) return Promise.resolve(memo);
    const load = inflight && inflight.day === today ? inflight : startLoad(today);
    if (same) return Promise.resolve(memo);
    let timer = null;
    const cut = new Promise((resolve) => {
      timer = setTimeout(() => resolve(load.next), basesWait);
      timer.unref?.();
    });
    return Promise.race([load.run, cut]).finally(() => clearTimeout(timer));
  }

  // { period, sectors: [{ id, key, name, last, changePct, move, ... }], members: [{ ticker,
  // name, sector, marketCap, changePct, move }], asOfList, stale, updated }. A move nobody
  // knows is null (shown as --), never 0.
  async function getSectors({ period } = {}) {
    const p = cleanPeriod(period);
    if (p === '1D' && warm) getBases().catch(() => {});
    const [etfs, sp, bases] = await Promise.all([
      list(),
      getStocks().catch(() => null),
      p === '1D' ? null : getBases(),
    ]);
    const b = bases?.bases || {};
    const keyOf = new Map(SECTOR_ETFS.map((e) => [e.id, e.key]));
    const sectors = etfs.rows.map((r) => ({ ...r, key: keyOf.get(r.id), move: periodMove(p, r, b[r.id]) }));
    const members = (sp?.stocks || []).map((s) => ({
      ticker: s.ticker, name: s.name, sector: s.sector, marketCap: s.marketCap > 0 ? s.marketCap : null,
      changePct: Number.isFinite(s.changePct) ? s.changePct : null,
      move: periodMove(p, s, b[s.ticker]),
    }));
    return {
      period: p, sectors, members, names: SECTOR_NAMES, asOfList: sp?.asOfList || null,
      stale: etfs.stale || Boolean(sp?.stale) || !sp, updated: etfs.updated,
    };
  }

  return { getSectors, getBases };
}

export const { getSectors } = makeSectors();

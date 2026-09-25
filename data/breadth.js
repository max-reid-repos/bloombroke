// BREADTH: how many stocks rose and fell.
// - By exchange (NYSE, Nasdaq, NYSE American): the Nasdaq stock screener, one download per
//   exchange (no key; it wants browser headers). The screener carries the last full
//   session's closing prices, and says which day that is.
// - S&P 100 by sector: the live S&P 100 batch that feeds MOVERS and HEATMAP.
// The screener has no 52-week high or low columns, so there are no new highs or lows here.

import { createCache } from './cache.js';
import { NASDAQ_HEADERS } from './lists.js';
import { num, parseAsOf } from './screen.js';
import { getHeatmap } from './sp100.js';

const TTL = 30 * 60_000;
const URL = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true&exchange=';
const ASOF_URL = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=1&offset=0';

export const EXCHANGES = [
  { id: 'NYSE', q: 'nyse', name: 'NYSE' },
  { id: 'NASDAQ', q: 'nasdaq', name: 'Nasdaq' },
  { id: 'AMEX', q: 'amex', name: 'NYSE American' },
];

// Screener rows -> counts. A row with no net change is left out, not counted as unchanged.
// Volume sums are shares traded in the rising and falling stocks.
export function countBreadth(rows) {
  const out = { up: 0, down: 0, unchanged: 0, noData: 0, upVolume: 0, downVolume: 0 };
  for (const r of rows || []) {
    const chg = num(r?.netchange);
    if (chg === null) { out.noData += 1; continue; }
    const vol = num(r.volume) || 0;
    if (chg > 0) { out.up += 1; out.upVolume += vol; }
    else if (chg < 0) { out.down += 1; out.downVolume += vol; }
    else out.unchanged += 1;
  }
  out.total = out.up + out.down + out.unchanged;
  out.upPct = out.total ? (out.up / out.total) * 100 : null;
  return out;
}

// S&P 100 members -> per sector { sector, up, down, unchanged, total, upPct }, most up first.
export function sectorBreadth(stocks, names = {}) {
  const by = new Map();
  for (const s of stocks || []) {
    if (!Number.isFinite(s?.changePct)) continue;
    let e = by.get(s.sector);
    if (!e) { e = { sector: s.sector, name: names[s.sector] || s.sector, up: 0, down: 0, unchanged: 0 }; by.set(s.sector, e); }
    if (s.changePct > 0) e.up += 1; else if (s.changePct < 0) e.down += 1; else e.unchanged += 1;
  }
  return [...by.values()].map((e) => {
    const total = e.up + e.down + e.unchanged;
    return { ...e, total, upPct: total ? (e.up / total) * 100 : null };
  }).sort((a, b) => b.upPct - a.upPct || b.total - a.total);
}

export function makeBreadth({ fetchImpl = globalThis.fetch, cache = createCache({ retryMs: 60_000 }), heatmap = getHeatmap } = {}) {
  async function get(url) {
    const res = await fetchImpl(url, { headers: NASDAQ_HEADERS, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`screener HTTP ${res.status}`);
    return res.json();
  }

  const exchange = (ex) => cache.cached(`breadth:${ex.id}`, TTL, async () => {
    const body = await get(URL + ex.q);
    const rows = body?.data?.rows;
    if (!Array.isArray(rows) || !rows.length) throw new Error('screener: unexpected shape');
    return countBreadth(rows);
  });

  // The screener's as-of line comes with the small table request only.
  const asOfDay = () => cache.cached('breadth:asof', TTL, async () => parseAsOf(await get(ASOF_URL)));

  async function getBreadth() {
    const [exs, sp, day] = await Promise.all([
      Promise.allSettled(EXCHANGES.map(exchange)),
      Promise.allSettled([heatmap()]).then(([r]) => r),
      Promise.allSettled([asOfDay()]).then(([r]) => r),
    ]);
    if (exs.every((r) => r.status === 'rejected') && sp.status === 'rejected') throw new Error('breadth: every source failed');
    const exchanges = EXCHANGES.map((ex, i) => (exs[i].status === 'fulfilled'
      ? { id: ex.id, name: ex.name, ...exs[i].value.value }
      : { id: ex.id, name: ex.name, missing: true }));
    const stocks = sp.status === 'fulfilled' ? sp.value.stocks : [];
    const fetched = exs.filter((r) => r.status === 'fulfilled').map((r) => r.value.fetchedAt);
    return {
      exchanges,
      sessionDate: day.status === 'fulfilled' ? day.value.value : null,
      exchangesUpdated: fetched.length ? new Date(Math.min(...fetched)).toISOString() : null,
      sectors: sp.status === 'fulfilled' ? sectorBreadth(stocks, sp.value.sectors) : [],
      sp100: sp.status === 'fulfilled' ? { ...sectorBreadth(stocks.map((s) => ({ ...s, sector: 'ALL' })))[0], asOfList: sp.value.asOfList } : null,
      sp100Updated: sp.status === 'fulfilled' ? sp.value.updated : null,
      stale: exs.some((r) => r.status === 'fulfilled' && r.value.stale) || (sp.status === 'fulfilled' && sp.value.stale) || exs.some((r) => r.status === 'rejected'),
      updated: sp.status === 'fulfilled' ? sp.value.updated : new Date(Math.min(...fetched)).toISOString(),
    };
  }

  return { getBreadth };
}

export const { getBreadth } = makeBreadth();

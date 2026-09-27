// CURVE: the US Treasury yield curve. Today from the CNBC quote service, read from the
// one shared quote batch (the same source, 15 s cache and RT or DLY flag as RATES, so a
// yield never shows two times or two tags); one month and one year ago from the US
// Treasury daily par yield curve CSV (both no key).

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { nyDay, iso } from './lists.js';
import { UA, makeQuotes, sharedQuotes } from './quotes.js';
import { monthBefore } from './sectors.js';

export const TENORS = [
  { id: '1M', src: 'US1M', col: '1 Mo' },
  { id: '3M', src: 'US3M', col: '3 Mo' },
  { id: '6M', src: 'US6M', col: '6 Mo' },
  { id: '1Y', src: 'US1Y', col: '1 Yr' },
  { id: '2Y', src: 'US2Y', col: '2 Yr' },
  { id: '3Y', src: 'US3Y', col: '3 Yr' },
  { id: '5Y', src: 'US5Y', col: '5 Yr' },
  { id: '7Y', src: 'US7Y', col: '7 Yr' },
  { id: '10Y', src: 'US10Y', col: '10 Yr' },
  { id: '20Y', src: 'US20Y', col: '20 Yr' },
  { id: '30Y', src: 'US30Y', col: '30 Yr' },
];

const TSY_TTL = 6 * 60 * 60_000;
export function treasuryCsvUrl(year) {
  return `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
}

function splitCsv(line) {
  return line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
}

// Treasury CSV -> [{ date: "YYYY-MM-DD", yields: { "1M": 4.01, ... } }], oldest first.
export function parseTreasuryCsv(csv) {
  const lines = String(csv).trim().split(/\r?\n/);
  const head = splitCsv(lines.shift() || '');
  if (head[0] !== 'Date') throw new Error('treasury source: unexpected header');
  const idx = TENORS.map((t) => [t.id, head.indexOf(t.col)]);
  const out = [];
  for (const line of lines) {
    const c = splitCsv(line);
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(c[0] || '');
    if (!m) continue;
    const yields = {};
    for (const [id, i] of idx) {
      const v = i >= 0 && c[i] !== '' ? Number(c[i]) : NaN;
      if (Number.isFinite(v)) yields[id] = v;
    }
    if (Object.keys(yields).length) out.push({ date: `${m[3]}-${m[1]}-${m[2]}`, yields });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// The last row on or before `day`.
export function rowOnOrBefore(rows, day) {
  let hit = null;
  for (const r of rows) if (r.date <= day) hit = r;
  return hit;
}

export function yearBefore(day) {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function makeCurve({ fetchImpl = cappedFetch, cache = createCache(), now = () => Date.now(), quotes = fetchImpl === cappedFetch ? sharedQuotes : makeQuotes({ fetchImpl, cache: createCache() }) } = {}) {
  const today = async () => {
    const { yields, stale, updated } = await quotes.getYields(TENORS.map((t) => t.src));
    const byId = new Map(yields.map((y) => [y.id, y]));
    return { rows: TENORS.map((t) => byId.get(t.src)).filter(Boolean).map((y) => ({ ...y, id: TENORS.find((t) => t.src === y.id).id })), stale, updated };
  };

  const year = (y) => cache.cached(`tsy:${y}`, TSY_TTL, async () => {
    const res = await fetchImpl(treasuryCsvUrl(y), { headers: { 'User-Agent': UA, Accept: 'text/csv' }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`treasury source HTTP ${res.status}`);
    const rows = parseTreasuryCsv(await res.text());
    if (!rows.length) throw new Error('treasury source: no rows');
    return rows;
  });

  async function getCurve() {
    const day = nyDay(now());
    const y = Number(day.slice(0, 4));
    const [t, cur, prev] = await Promise.allSettled([today(), year(y), year(y - 1)]);
    const hist = [cur, prev].filter((r) => r.status === 'fulfilled').flatMap((r) => r.value.value).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (t.status === 'rejected' && !hist.length) throw new Error('curve: every source failed');
    const m1 = rowOnOrBefore(hist, monthBefore(day));
    const y1 = rowOnOrBefore(hist, yearBefore(day));
    const latest = hist[hist.length - 1] || null;
    const nowRows = t.status === 'fulfilled' ? t.value.rows : [];
    const byId = new Map(nowRows.map((r) => [r.id, r]));
    // The newest trade time across the curve (bills can trade hours apart from notes).
    const asOf = nowRows.map((r) => r.asOf).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).pop() || null;
    return {
      tenors: TENORS.map(({ id, src }) => ({
        id,
        cmd: src,
        kind: 'yield',
        now: byId.get(id)?.last ?? null,
        change: byId.get(id)?.change ?? null,
        asOf: byId.get(id)?.asOf ?? null,
        realTime: typeof byId.get(id)?.realTime === 'boolean' ? byId.get(id).realTime : null,
        m1: m1?.yields[id] ?? null,
        y1: y1?.yields[id] ?? null,
      })),
      asOf,
      m1Date: m1?.date || null,
      y1Date: y1?.date || null,
      officialDate: latest?.date || null,
      stale: (t.status === 'fulfilled' && t.value.stale) || [cur, prev].some((r) => r.status === 'fulfilled' && r.value.stale),
      updated: t.status === 'fulfilled' ? t.value.updated : iso(now()),
    };
  }

  return { getCurve };
}

export const { getCurve } = makeCurve();

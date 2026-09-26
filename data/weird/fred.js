// Shared helpers for the WEIRD gauges that read monthly FRED series (LIPSTICK, BOXES,
// EGGS, TRUCKS). FRED's CSV needs no key but is slow at times, so the timeout is long
// and each gauge keeps its result about 12 hours.

import { parseFredCsv } from '../economy.js';

export const FRED_TTL = 12 * 60 * 60_000;
export const FRED_RETRY = 30 * 60_000;

export const fredUrl = (id) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`;

// FRED observations -> [{ month: 'YYYY-MM', value }] oldest first.
export function toMonths(obs) {
  return obs
    .map((o) => ({ month: o.date.slice(0, 7), value: o.value }))
    .filter((o) => Number.isFinite(o.value))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

export async function fredMonthly(get, id) {
  return toMonths(parseFredCsv(await get.text(fredUrl(id), { timeout: 90_000, accept: 'text/csv' })));
}

export function monthBack(month, n) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}

// % change of rows[i] on the month `n` months before it; null when that month is missing.
export function changeAt(rows, i, n) {
  const r = rows[i];
  if (!r) return null;
  const want = monthBack(r.month, n);
  const before = rows.find((x) => x.month === want);
  return before && before.value ? (r.value / before.value - 1) * 100 : null;
}

export const latestYoy = (rows) => changeAt(rows, rows.length - 1, 12);

// The last `count` months, newest first, each with its change on a year before.
export function recentRows(rows, count = 13) {
  const start = Math.max(0, rows.length - count);
  const out = [];
  for (let i = rows.length - 1; i >= start; i -= 1) out.push({ ...rows[i], yoy: changeAt(rows, i, 12) });
  return out;
}

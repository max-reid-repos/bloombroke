// BOXES: cardboard boxes as a read on how much stuff is being shipped. Two series via
// FRED: US output of paperboard containers (Fed industrial production index,
// IPN32221S, seasonally adjusted) and the producer price index for corrugated and
// solid fiber boxes (PCU322211322211). Each is compared with a year before and has
// its own latest month.

import { NoData, signedPct } from './source.js';
import { FRED_TTL, FRED_RETRY, fredMonthly, latestYoy, recentRows } from './fred.js';

export const id = 'boxes';
export const source = 'FRED';
export const ttl = FRED_TTL;
export const retryMs = FRED_RETRY;

export const SERIES = [
  { key: 'output', fred: 'IPN32221S', label: 'Box output', full: 'Paperboard container output (index)' },
  { key: 'price', fred: 'PCU322211322211', label: 'Box prices', full: 'Corrugated box producer prices (index)' },
];

// { output: rows | null, price: rows | null } -> the gauge.
export function build(got) {
  const parts = SERIES.map((s) => {
    const rows = got[s.key];
    if (!rows?.length) return { ...s, month: null, value: null, yoy: null, rows: [] };
    const last = rows[rows.length - 1];
    return { ...s, month: last.month, value: last.value, yoy: latestYoy(rows), rows: recentRows(rows, 13), spark: rows.slice(-36).map((r) => r.value) };
  });
  const lead = parts.find((p) => Number.isFinite(p.yoy));
  if (!lead) throw new NoData('FRED: no box values');
  const other = parts.find((p) => p !== lead && Number.isFinite(p.yoy));
  return {
    headline: `${signedPct(lead.yoy, 1)} YOY`,
    line: lead.key === 'output'
      ? `Box output vs a year ago${other ? `; prices ${signedPct(other.yoy, 1)}` : ''}`
      : 'Box prices vs a year ago',
    spark: lead.spark,
    asOf: `${lead.month}-01`,
    source,
    series: parts.map(({ spark, ...p }) => p),
  };
}

export async function load(get) {
  const got = await Promise.allSettled(SERIES.map((s) => fredMonthly(get, s.fred)));
  if (got.every((g) => g.status === 'rejected')) throw got[0].reason;
  return build(Object.fromEntries(SERIES.map((s, i) => [s.key, got[i].status === 'fulfilled' ? got[i].value : null])));
}

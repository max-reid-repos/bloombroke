// BOXES: cardboard boxes as a read on how much stuff is being shipped. Two series via
// FRED: US output of paperboard containers (Fed industrial production index,
// IPN32221S, seasonally adjusted) and the producer price index for corrugated and
// solid fiber boxes (PCU322211322211). Each is compared with a year before and has
// its own latest month.

import { NoData, signedPct, headlineNumber } from './source.js';
import { FRED_TTL, FRED_RETRY, fredMonthly, latestYoy, recentRows, monthlyHist } from './fred.js';

export const id = 'boxes';
export const source = 'FRED';
export const ttl = FRED_TTL;
export const retryMs = FRED_RETRY;
export const defaultPeriod = '5Y';

export const SERIES = [
  { key: 'output', fred: 'IPN32221S', label: 'Box output', full: 'Paperboard container output (index)' },
  { key: 'price', fred: 'PCU322211322211', label: 'Box prices', full: 'Corrugated box producer prices (index)' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mon = (month) => MONTHS[Number(month.slice(5, 7)) - 1];

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
    value: headlineNumber(lead.yoy, 1), // ALERTS: the headline number and its unit
    unit: '%',
    line: lead.key === 'output'
      ? `Box output vs a year ago (${mon(lead.month)})${other ? `; prices ${signedPct(other.yoy, 1)} (${mon(other.month)})` : ''}`
      : `Box prices vs a year ago (${mon(lead.month)})`,
    spark: lead.spark,
    asOf: `${lead.month}-01`,
    source,
    series: parts.map(({ spark, ...p }) => p),
    // History: each series' change on a year before, every month in its CSV.
    hist: monthlyHist(SERIES.filter((s) => got[s.key]?.length).map((s) => ({ key: s.key, label: s.label, rows: got[s.key], yoy: true })), lead.key),
  };
}

export async function load(get) {
  const got = await Promise.allSettled(SERIES.map((s) => fredMonthly(get, s.fred)));
  if (got.every((g) => g.status === 'rejected')) throw got[0].reason;
  return build(Object.fromEntries(SERIES.map((s, i) => [s.key, got[i].status === 'fulfilled' ? got[i].value : null])));
}

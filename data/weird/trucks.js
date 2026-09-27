// TRUCKS: how much freight is moving, against a year before. Three monthly series via
// FRED, each with its own latest month (they come out at different times):
//   Cass Freight Index, shipments (FRGSHPUSM649NCIS), not seasonally adjusted
//   ATA truck tonnage index (TRUCKD11)
//   Rail freight carloads (RAILFRTCARLOADSD11)

import { NoData, signedPct, headlineNumber } from './source.js';
import { FRED_TTL, FRED_RETRY, fredMonthly, latestYoy, monthlyHist } from './fred.js';

export const id = 'trucks';
export const source = 'FRED';
export const ttl = FRED_TTL;
export const retryMs = FRED_RETRY;
export const defaultPeriod = '5Y';
// The CSV is the whole series, from its first month: a new high or low is a record.
export const fullSeries = true;

export const SERIES = [
  { key: 'cass', fred: 'FRGSHPUSM649NCIS', label: 'Cass freight shipments', short: 'CASS', dp: 3 },
  { key: 'truck', fred: 'TRUCKD11', label: 'Truck tonnage', short: 'TRUCKS', dp: 1 },
  { key: 'rail', fred: 'RAILFRTCARLOADSD11', label: 'Rail carloads', short: 'RAIL', dp: 0 },
];

// { cass, truck, rail: rows | null } -> the gauge.
export function build(got) {
  const rows = SERIES.map((s) => {
    const r = got[s.key];
    if (!r?.length) return { ...s, month: null, value: null, yoy: null, spark: [] };
    const last = r[r.length - 1];
    return { ...s, month: last.month, value: last.value, yoy: latestYoy(r), spark: r.slice(-36).map((x) => x.value) };
  });
  const lead = rows.find((r) => Number.isFinite(r.yoy));
  if (!lead) throw new NoData('FRED: no freight values');
  return {
    headline: `${lead.short} ${signedPct(lead.yoy, 1)} YOY`,
    value: headlineNumber(lead.yoy, 1), // ALERTS: the headline number and its unit
    unit: '%',
    line: `${lead.label} vs a year ago`,
    spark: lead.spark,
    asOf: `${lead.month}-01`,
    source,
    rows,
    // History: each series' change on a year before, every month in its CSV.
    hist: monthlyHist(SERIES.filter((s) => got[s.key]?.length).map((s) => ({ key: s.key, label: s.label, rows: got[s.key], yoy: true })), lead.key),
  };
}

export async function load(get) {
  const got = await Promise.allSettled(SERIES.map((s) => fredMonthly(get, s.fred)));
  if (got.every((g) => g.status === 'rejected')) throw got[0].reason;
  return build(Object.fromEntries(SERIES.map((s, i) => [s.key, got[i].status === 'fulfilled' ? got[i].value : null])));
}

// EGGS: the average price of a dozen grade A large eggs in US cities. Source: BLS
// average price data, US city average, via FRED (series APU0000708111). Also shown:
// the highest monthly price on record and how far today's price is from it.

import { NoData, signedPct } from './source.js';
import { FRED_TTL, FRED_RETRY, fredMonthly, latestYoy, recentRows } from './fred.js';

export const id = 'eggs';
export const source = 'FRED';
export const ttl = FRED_TTL;
export const retryMs = FRED_RETRY;
export const SERIES = 'APU0000708111';

export function build(rows) {
  if (!rows.length) throw new NoData('FRED: no egg prices');
  const last = rows[rows.length - 1];
  const peak = rows.reduce((a, r) => (r.value > a.value ? r : a), rows[0]);
  const fromPeak = (last.value / peak.value - 1) * 100;
  return {
    headline: `$${last.value.toFixed(2)} A DOZEN`,
    value: Math.round(last.value * 100) / 100, // ALERTS: the headline number and its unit
    unit: '$',
    line: last.month === peak.month ? 'US city average; a record high' : `US city average; ${signedPct(fromPeak, 0)} from peak`,
    spark: rows.slice(-60).map((r) => r.value),
    asOf: `${last.month}-01`,
    source,
    month: last.month,
    price: last.value,
    yoy: latestYoy(rows),
    peak: { month: peak.month, price: peak.value },
    fromPeak,
    points: rows.filter((r) => r.month >= '2015-01').map((r) => ({ month: r.month, price: r.value })),
    rows: recentRows(rows, 13),
  };
}

export async function load(get) {
  return build(await fredMonthly(get, SERIES));
}

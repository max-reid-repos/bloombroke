// LIPSTICK: cosmetics prices against a year before. Source: BLS consumer price index
// for "Cosmetics, perfume, bath, nail preparations and implements", US city average,
// not seasonally adjusted, via FRED (series CUUR0000SEGB02).
// The "lipstick index" is folklore: Leonard Lauder of Estee Lauder said lipstick sells
// better in hard times. This is a price index, not sales.

import { NoData, signedPct, headlineNumber } from './source.js';
import { FRED_TTL, FRED_RETRY, fredMonthly, latestYoy, changeAt, recentRows } from './fred.js';

export const id = 'lipstick';
export const source = 'FRED';
export const ttl = FRED_TTL;
export const retryMs = FRED_RETRY;
export const SERIES = 'CUUR0000SEGB02';

export function build(rows) {
  if (!rows.length) throw new NoData('FRED: no cosmetics values');
  const last = rows[rows.length - 1];
  const yoy = latestYoy(rows);
  if (yoy === null) throw new NoData('FRED: no value a year before');
  return {
    headline: `${signedPct(yoy, 1)} YOY`,
    value: headlineNumber(yoy, 1), // ALERTS: the headline number and its unit
    unit: '%',
    line: 'Cosmetics prices vs a year ago',
    spark: rows.slice(-36).map((r) => r.value),
    asOf: `${last.month}-01`,
    source,
    month: last.month,
    index: last.value,
    yoy,
    mom: changeAt(rows, rows.length - 1, 1),
    rows: recentRows(rows, 13),
  };
}

export async function load(get) {
  return build(await fredMonthly(get, SERIES));
}

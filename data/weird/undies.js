// UNDIES: the price of men's underwear. Alan Greenspan is said to have watched it,
// on the idea that men put off buying new pairs when money is tight (folklore, not a
// tested rule). Source: BLS CPI series CUUR0000SEAA02, "Men's underwear, nightwear,
// swimwear, and accessories", US city average, not seasonally adjusted.
// BLS allows 25 keyless queries a day, so the result is kept 24 hours.

import { NoData, signedPct } from './source.js';

export const id = 'undies';
export const source = 'BLS';
export const ttl = 24 * 60 * 60_000;
export const retryMs = 6 * 60 * 60_000;

export const SERIES = 'CUUR0000SEAA02';
const URL_BLS = `https://api.bls.gov/publicAPI/v1/timeseries/data/${SERIES}`;

// BLS v1 body -> [{ month: 'YYYY-MM', value }] oldest first.
export function parse(body) {
  if (body?.status !== 'REQUEST_SUCCEEDED') throw new Error(`BLS: ${(body?.message || []).join(' ') || 'request failed'}`);
  const data = body?.Results?.series?.[0]?.data;
  if (!Array.isArray(data)) throw new Error('BLS: unexpected shape');
  return data
    .filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period))
    .map((d) => ({ month: `${d.year}-${d.period.slice(1)}`, value: Number(d.value) }))
    .filter((d) => Number.isFinite(d.value) && d.value > 0)
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

const monthBack = (month, n) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 - n, 1));
  return d.toISOString().slice(0, 7);
};

// % change of the latest month on `n` months before it, or null when that month is missing.
export function changeOn(rows, n) {
  const last = rows[rows.length - 1];
  const before = rows.find((r) => r.month === monthBack(last.month, n));
  return before ? (last.value / before.value - 1) * 100 : null;
}

export function build(rows) {
  if (!rows.length) throw new NoData('BLS: no monthly values');
  const last = rows[rows.length - 1];
  const yoy = changeOn(rows, 12);
  const mom = changeOn(rows, 1);
  if (yoy === null) throw new NoData('BLS: no value a year before');
  return {
    headline: `${signedPct(yoy, 1)} YOY`,
    value: Math.round(yoy * 10) / 10, // ALERTS: the headline number and its unit
    unit: '%',
    line: "Men's underwear prices vs a year ago",
    spark: rows.map((r) => r.value),
    asOf: `${last.month}-01`,
    source,
    month: last.month,
    index: last.value,
    yoy,
    mom,
    rows: rows.slice(-13).reverse().map((r) => ({ ...r, yoy: changeOn(rows.filter((x) => x.month <= r.month), 12) })),
  };
}

export async function load(get) {
  return build(parse(await get.json(URL_BLS)));
}

// HOTDOG: Costco has sold its hot dog and soda combo for $1.50 since 1985. This is
// what $1.50 of 1985 money buys today: 1.50 x (latest CPI / 1985 average CPI).
// Source: FRED CPIAUCSL (CPI for all urban consumers, seasonally adjusted, monthly).
// FRED is slow at times, so the timeout is long and the result is kept a day.

import { parseFredCsv } from '../economy.js';
import { NoData, mean } from './source.js';

export const id = 'hotdog';
export const source = 'FRED';
export const ttl = 24 * 60 * 60_000;
export const retryMs = 30 * 60_000;

// The one fixed number on the WEIRD screen: Costco's price, unchanged since 1985.
export const PRICE_1985 = 1.5;
const URL_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=CPIAUCSL';

export function adjusted(cpiNow, cpiBase, price = PRICE_1985) {
  return (price * cpiNow) / cpiBase;
}

// Monthly observations -> the average of each calendar year that has all 12 months.
export function annualAverages(obs) {
  const by = new Map();
  for (const o of obs) {
    const y = Number(o.date.slice(0, 4));
    (by.get(y) || by.set(y, []).get(y)).push(o.value);
  }
  const out = {};
  for (const [y, v] of by) if (v.length === 12) out[y] = mean(v);
  return out;
}

export function build(obs) {
  const annual = annualAverages(obs);
  const base = annual[1985];
  if (!base) throw new NoData('FRED: no 1985 average');
  const last = obs[obs.length - 1];
  const price = adjusted(last.value, base);
  const years = Object.keys(annual).map(Number).filter((y) => y >= 1985).sort((a, b) => a - b);
  const series = years.map((y) => ({ date: `${y}`, price: adjusted(annual[y], base) }));
  series.push({ date: last.date.slice(0, 7), price });
  return {
    headline: `$${price.toFixed(2)}`,
    line: "The $1.50 hot dog in today's money",
    spark: series.map((s) => s.price),
    asOf: last.date,
    source,
    price,
    price1985: PRICE_1985,
    cpiBase: base,
    cpiNow: last.value,
    cpiDate: last.date,
    series,
  };
}

export async function load(get) {
  return build(parseFredCsv(await get.text(URL_CSV, { timeout: 90_000, accept: 'text/csv' })));
}

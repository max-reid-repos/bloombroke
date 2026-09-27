// BIGMAC: The Economist's Big Mac index. A Big Mac's price in each country, turned
// into dollars at the market exchange rate, against its US price: over or under.
// Source: github.com/TheEconomist/big-mac-data, output-data/big-mac-full-index.csv,
// CC BY 4.0. Updated twice a year.

import { NoData, signedPct } from './source.js';
import { histFrom } from './history.js';

export const id = 'bigmac';
export const source = 'The Economist';
export const ttl = 24 * 60 * 60_000;
export const defaultPeriod = 'MAX';
// The CSV is the whole series, from its first month: a new high or low is a record.
export const fullSeries = true;

const URL_CSV = 'https://raw.githubusercontent.com/TheEconomist/big-mac-data/master/output-data/big-mac-full-index.csv';

// CSV -> { latest: 'YYYY-MM-DD', rows: [{ name, iso3, currency, dollarPrice, usdRaw }] at
// the latest date, usPrices: [{ date, price }] }. Plain CSV: no quoted commas in this file.
export function parse(csv) {
  const lines = String(csv ?? '').trim().split(/\r?\n/);
  const head = (lines.shift() || '').split(',');
  const col = (k) => head.indexOf(k);
  const iD = col('date'); const iIso = col('iso_a3'); const iCur = col('currency_code'); const iName = col('name');
  const iUsd = col('dollar_price'); const iRaw = col('USD_raw');
  if ([iD, iIso, iName, iUsd, iRaw].some((i) => i < 0)) throw new Error('Big Mac CSV: unexpected header');
  const all = [];
  for (const line of lines) {
    const f = line.split(',');
    if (f.length !== head.length) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f[iD] || '')) continue;
    const dollarPrice = Number(f[iUsd]);
    const raw = f[iRaw] === '' ? NaN : Number(f[iRaw]);
    all.push({ date: f[iD], name: f[iName], iso3: f[iIso], currency: f[iCur], dollarPrice, usdRaw: Number.isFinite(raw) ? raw * 100 : null });
  }
  if (!all.length) throw new NoData('Big Mac CSV: no rows');
  const latest = all.reduce((m, r) => (r.date > m ? r.date : m), '');
  const rows = all.filter((r) => r.date === latest && Number.isFinite(r.dollarPrice)).map(({ date, ...r }) => r);
  const usPrices = all.filter((r) => r.iso3 === 'USA' && Number.isFinite(r.dollarPrice)).map((r) => ({ date: r.date, price: r.dollarPrice }));
  // Every country's valuation at every date, for the history (since 2000).
  const past = all.filter((r) => Number.isFinite(r.usdRaw)).map((r) => ({ date: r.date, iso3: r.iso3, usdRaw: r.usdRaw }));
  return { latest, rows, usPrices, past };
}

// The valuation against the dollar over time, one series per country in `rows` (the
// headline country leads). The file is the whole series, so this costs no request.
export function toHist(past, rows, lead) {
  const by = new Map();
  for (const r of past || []) {
    const row = by.get(r.date) || { d: r.date };
    row[r.iso3] = r.usdRaw;
    by.set(r.date, row);
  }
  return histFrom([...by.values()], rows.map((r) => ({ key: r.iso3, label: r.name })), { step: 'half', lead });
}

export function build(p) {
  const ranked = p.rows.filter((r) => r.iso3 !== 'USA' && Number.isFinite(r.usdRaw)).sort((a, b) => b.usdRaw - a.usdRaw);
  if (!ranked.length) throw new NoData('Big Mac CSV: no valuations');
  const top = ranked[0];
  const us = p.rows.find((r) => r.iso3 === 'USA');
  return {
    headline: `${top.name.toUpperCase()} ${signedPct(top.usdRaw, 0)}`,
    line: 'Priciest Big Mac vs USD',
    spark: p.usPrices.map((x) => x.price),
    asOf: p.latest,
    source,
    credit: 'The Economist, CC BY 4.0',
    usPrice: us ? us.dollarPrice : null,
    over: ranked.slice(0, 5),
    under: ranked.slice(-5).reverse(),
    rows: ranked,
    usPrices: p.usPrices,
    hist: toHist(p.past, ranked, top.iso3),
  };
}

export async function load(get) {
  return build(parse(await get.text(URL_CSV, { accept: 'text/csv' })));
}

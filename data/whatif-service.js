// WHATIF and 420 data: the baked history (data/whatif-prices.json) plus today's price
// from the live quote source. If a live quote fails, the last baked close is used and
// the answer is marked stale.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getQuote } from './quotes.js';
import { getChart } from './charts.js';
import { computeWhatif, resolveTokens, WhatifError, maxDrawdown, holdingPath, replaySeries } from './whatif.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
export const catalog = load('whatif-products.json');
export const prices = load('whatif-prices.json');
// CPI-U (the REPLAY jar) and the BLS average prices behind the VICES items.
export const bls = load('bls-monthly.json');

export const SOURCE = 'CNBC, cross-checked with Yahoo Finance';
export const METHOD = 'Split-adjusted close on the purchase date, or the last trading day before it. Recurring items buy once a month, on the first trading day. Beer, soda and chips use the BLS US average price of each month (a month BLS skipped keeps the month before). Price return only: dividends and spin-offs are not included. Today\'s price is live and may be delayed.';

async function priceNow(ticker, quoteImpl) {
  try {
    const q = await quoteImpl(ticker);
    if (q && Number.isFinite(q.last) && q.last > 0) return { price: q.last, stale: Boolean(q.stale), asOf: q.asOf };
  } catch { /* fall back to the baked close */ }
  const b = prices.last[ticker];
  return { price: b.close, stale: true, asOf: b.date };
}

async function quotesFor(tickers, quoteImpl) {
  const got = await Promise.all(tickers.map(async (t) => [t, await priceNow(t, quoteImpl)]));
  return Object.fromEntries(got);
}

export const RISK_BASIS = 'Based on month-end closes from CNBC, from the first purchase to today.';
const RISK_WAIT_MS = 6000;

// Monthly bars for each ticker, or null when the chart source is slow or down.
async function monthlyBars(tickers, chartImpl, waitMs) {
  const got = await Promise.all(tickers.map(async (t) => {
    const timeout = new Promise((resolve) => { setTimeout(resolve, waitMs, null).unref?.(); });
    try {
      const c = await Promise.race([chartImpl(t, 'MAX'), timeout]);
      return [t, c && c.bar === '1MO' ? c.points : null];
    } catch {
      return [t, null];
    }
  }));
  return Object.fromEntries(got);
}

// Adds row.worstDrop ({ pct, month } or null) and result.risk: the worst single holding.
export function attachRisk(result, bars, { prices: p = prices } = {}) {
  for (const row of result.rows) {
    const series = bars[row.ticker];
    const first = row.kind === 'once' ? { date: row.bought, close: row.close } : p.monthly[row.ticker]?.[row.from];
    const dd = series && first ? maxDrawdown(holdingPath(first, series, row.price)) : null;
    row.worstDrop = dd ? { pct: dd.pct, peakMonth: dd.peakMonth, month: dd.month } : null;
  }
  const measured = result.rows.filter((r) => r.worstDrop);
  const worst = measured.sort((a, b) => a.worstDrop.pct - b.worstDrop.pct)[0] || null;
  result.risk = {
    worst: worst ? { ...worst.worstDrop, name: worst.name, ticker: worst.ticker } : null,
    complete: measured.length === result.rows.length,
    basis: RISK_BASIS,
  };
  return result;
}

// The picker's list: small, no prices history.
export function getCatalog() {
  const pick = ({ id, name, company, ticker, date, price, category, family, note, per, start, defaultYears, doodle, shelves }) =>
    ({ id, name, company, ticker, date, price, category, family, note, per, start, defaultYears, doodle, shelves });
  return {
    products: catalog.products.map((p) => ({ ...pick(p), kind: 'once' })),
    recurring: catalog.recurring.map((r) => ({ ...pick(r), kind: 'monthly' })),
    built: prices.built,
  };
}

// tokens: ['IPHONE6', 'LATTE:3Y'].
// risk: also work out each holding's worst drop along the way (the WHATIF screen asks
// for it; the share image does not need it and stays fast).
export async function getWhatif(tokens, { quoteImpl = getQuote, now = new Date(), risk = false, chartImpl = getChart, riskWaitMs = RISK_WAIT_MS } = {}) {
  const { picks, families, unknown } = resolveTokens(tokens, catalog);
  if (unknown.length) {
    throw new WhatifError('unknown', `Not on the list: ${unknown.join(' ')}. Type WHATIF to pick from the list.`, { unknown });
  }
  if (!picks.length) return { picker: true, families };
  const tickers = [...new Set(picks.map(({ id }) => [...catalog.products, ...catalog.recurring].find((p) => p.id === id).ticker))];
  const [live, bars] = await Promise.all([quotesFor(tickers, quoteImpl), risk ? monthlyBars(tickers, chartImpl, riskWaitMs) : null]);
  const quotes = Object.fromEntries(Object.entries(live).map(([t, q]) => [t, q.price]));
  const result = computeWhatif(picks, { catalog, prices, quotes, now, bls });
  if (risk) attachRisk(result, bars);
  const asOf = Object.values(live).map((q) => q.asOf).filter(Boolean).sort().pop() || null;
  // REPLAY: the race month by month; the screen asks for it (with risk), the share image does not.
  if (risk) result.replay = replaySeries(result, { catalog, prices, bls, now, asOf });
  return {
    ...result,
    picks,
    asOf,
    source: SOURCE,
    stale: Object.values(live).some((q) => q.stale),
    method: METHOD,
    built: prices.built,
    updated: new Date().toISOString(),
  };
}

// 420: Tesla since "funding secured".
export async function getFunding({ quoteImpl = getQuote } = {}) {
  const { date, close, weekly } = prices.funding;
  const now = await priceNow('TSLA', quoteImpl);
  const points = weekly.map(([d, v]) => ({ t: Date.parse(`${d}T20:00:00Z`), v }));
  // The chart ends on today's live price.
  const lastDay = weekly[weekly.length - 1][0];
  if (String(now.asOf || '').slice(0, 10) > lastDay || !now.stale) points.push({ t: Date.now(), v: now.price });
  const amount = 420;
  const shares = amount / close;
  return {
    date, close, price: now.price, stale: now.stale, asOf: now.asOf, source: SOURCE, amount, shares, value: shares * now.price,
    multiple: now.price / close, points, updated: new Date().toISOString(),
  };
}

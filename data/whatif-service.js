// WHATIF and 420 data: the baked history (data/whatif-prices.json) plus today's price
// from the live quote source. If a live quote fails, the last baked close is used and
// the answer is marked stale.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getQuote } from './quotes.js';
import { computeWhatif, resolveTokens, WhatifError } from './whatif.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
export const catalog = load('whatif-products.json');
export const prices = load('whatif-prices.json');

export const SOURCE = 'CNBC, cross-checked with Yahoo Finance';
export const METHOD = 'Split-adjusted close on the purchase date, or the last trading day before it. Recurring items buy once a month, on the first trading day. Price return only: dividends and spin-offs are not included. Today\'s price is live and may be delayed.';

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

// The picker's list: small, no prices history.
export function getCatalog() {
  const pick = ({ id, name, company, ticker, date, price, category, family, note, per, start, defaultYears }) =>
    ({ id, name, company, ticker, date, price, category, family, note, per, start, defaultYears });
  return {
    products: catalog.products.map((p) => ({ ...pick(p), kind: 'once' })),
    recurring: catalog.recurring.map((r) => ({ ...pick(r), kind: 'monthly' })),
    built: prices.built,
  };
}

// tokens: ['IPHONE6', 'LATTE:3Y'].
export async function getWhatif(tokens, { quoteImpl = getQuote, now = new Date() } = {}) {
  const { picks, families, unknown } = resolveTokens(tokens, catalog);
  if (unknown.length) {
    throw new WhatifError('unknown', `Not on the list: ${unknown.join(' ')}. Type WHATIF to pick from the list.`, { unknown });
  }
  if (!picks.length) return { picker: true, families };
  const tickers = [...new Set(picks.map(({ id }) => [...catalog.products, ...catalog.recurring].find((p) => p.id === id).ticker))];
  const live = await quotesFor(tickers, quoteImpl);
  const quotes = Object.fromEntries(Object.entries(live).map(([t, q]) => [t, q.price]));
  const result = computeWhatif(picks, { catalog, prices, quotes, now });
  const asOf = Object.values(live).map((q) => q.asOf).filter(Boolean).sort().pop() || null;
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

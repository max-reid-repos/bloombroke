// OWNERS <ticker>: the biggest institutional holders and the ownership summary, from the
// Nasdaq institutional holdings API (13F filings; no key). Cached a day.

import { createCache } from './cache.js';
import { money, usDay } from './lists.js';
import { CompanyDataError, DAY_MS, nasdaqData, tickerOrThrow, cachedOrThrow, text } from './company-kit.js';

export { CompanyDataError as OwnersError };

const LIMIT = 25;
export const OWNERS_SOURCE = 'Nasdaq institutional holdings (SEC Form 13F)';

function positions(rows, re) {
  const r = (Array.isArray(rows) ? rows : []).find((x) => re.test(String(x.positions || '')));
  return r ? { holders: money(r.holders), shares: money(r.shares) } : { holders: null, shares: null };
}

export function parseOwners(d) {
  if (!d) return null;
  const sum = d.ownershipSummary || {};
  const outstandingM = money(sum.ShareoutstandingTotal?.value);
  const outstanding = outstandingM ? outstandingM * 1e6 : null;
  const active = d.activePositions?.rows;
  const newSold = d.newSoldOutPositions?.rows;
  const summary = {
    institutionalPct: money(sum.SharesOutstandingPCT?.value),
    sharesOutstanding: outstanding,
    // Nasdaq gives the total value in millions of dollars.
    totalValue: Number.isFinite(money(sum.TotalHoldingsValue?.value)) ? money(sum.TotalHoldingsValue.value) * 1e6 : null,
    increased: positions(active, /^increased/i),
    decreased: positions(active, /^decreased/i),
    held: positions(active, /^held/i),
    total: positions(active, /^total/i),
    new: positions(newSold, /^new/i),
    soldOut: positions(newSold, /^sold out/i),
  };
  const table = d.holdingsTransactions?.table;
  const rows = (Array.isArray(table?.rows) ? table.rows : []).map((r) => {
    const shares = money(r.sharesHeld);
    const valueK = money(r.marketValue);
    return {
      holder: text(r.ownerName, 80),
      asOf: usDay(r.date),
      shares,
      // Shares held / shares outstanding, both from the source.
      pctOfShares: Number.isFinite(shares) && outstanding ? Math.round((shares / outstanding) * 1e6) / 1e4 : null,
      change: money(r.sharesChange),
      changePct: money(r.sharesChangePCT),
      // Nasdaq gives the value in thousands of dollars.
      value: Number.isFinite(valueK) ? valueK * 1000 : null,
    };
  }).filter((r) => r.holder);
  const hasSummary = Number.isFinite(summary.institutionalPct) || Number.isFinite(summary.total.holders);
  if (!rows.length && !hasSummary) return null;
  return { summary, rows, totalRecords: money(d.holdingsTransactions?.totalRecords) };
}

export function makeOwners({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 500, retryMs: 60_000 }) } = {}) {
  async function getOwners(raw) {
    const ticker = tickerOrThrow(raw);
    const path = `company/${encodeURIComponent(ticker)}/institutional-holdings?limit=${LIMIT}&type=TOTAL&sortColumn=marketValue&sortOrder=DESC`;
    const got = await cachedOrThrow(cache, `owners:${ticker}`, DAY_MS, async () => parseOwners(await nasdaqData(fetchImpl, path)), {
      what: 'Holdings data', missing: `No institutional holdings on file for ${ticker}.`,
    });
    return { ticker, ...got.value, stale: got.stale, updated: got.updated, source: OWNERS_SOURCE };
  }
  return { getOwners };
}

export const { getOwners } = makeOwners();

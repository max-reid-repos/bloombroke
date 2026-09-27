// OWNERS <ticker>: the biggest institutional holders and the ownership summary, from the
// Nasdaq institutional holdings API (13F filings; no key). Cached a day.

import { cappedFetch } from './http.js';
import { createCache } from './cache.js';
import { money, usDay } from './lists.js';
import { CompanyDataError, DAY_MS, nasdaqData, tickerOrThrow, cachedOrThrow, text } from './company-kit.js';

export { CompanyDataError as OwnersError };

const LIMIT = 25;
// The whole holder list in one call (AAPL, among the biggest, has about 6,500), so the
// totals can be summed from the rows themselves.
const FETCH_LIMIT = 10_000;
export const OWNERS_SOURCE = 'Market data provider, from SEC Form 13F';

function positions(rows, re) {
  const r = (Array.isArray(rows) ? rows : []).find((x) => re.test(String(x.positions || '')));
  return r ? { holders: money(r.holders), shares: money(r.shares) } : { holders: null, shares: null };
}

const sum = (rows, key) => rows.reduce((a, r) => a + (Number.isFinite(r[key]) ? r[key] : 0), 0);

// Position counts from the holder rows, with the source's own meaning for each line:
// increased and decreased shares are the shares added or cut; held shares are the
// total less both; a new position is one whose change is all of it.
export function positionsFrom(rows) {
  const inc = rows.filter((r) => r.change > 0);
  const dec = rows.filter((r) => r.change < 0);
  const same = rows.filter((r) => r.change === 0);
  const neu = rows.filter((r) => r.change > 0 && r.change === r.shares);
  const total = sum(rows, 'shares');
  const added = sum(inc, 'change');
  const cut = -sum(dec, 'change');
  return {
    increased: { holders: inc.length, shares: added },
    decreased: { holders: dec.length, shares: cut },
    held: { holders: same.length, shares: total - added - cut },
    total: { holders: rows.length, shares: total },
    new: { holders: neu.length, shares: sum(neu, 'shares') },
  };
}

// A holder whose latest 13F is older than the newest quarter in the list has not
// refiled. Its old stake is often counted again under a successor (Vanguard Group Inc,
// last filed for Dec 2025, now files as Vanguard Capital Management and others), so the
// totals and the top list use only the newest quarter's filings. Those holders are
// listed apart ("not refiled this quarter") and left out of every total.
//
// When the source sends every holder (rows = totalRecords), the totals are summed from
// the rows. When it does not, the source's own totals stay and quarterOnly is false.
export function parseOwners(d) {
  if (!d) return null;
  const sumry = d.ownershipSummary || {};
  const outstandingM = money(sumry.ShareoutstandingTotal?.value);
  const outstanding = outstandingM ? outstandingM * 1e6 : null;
  const active = d.activePositions?.rows;
  const newSold = d.newSoldOutPositions?.rows;
  const reported = {
    institutionalPct: money(sumry.SharesOutstandingPCT?.value),
    // Nasdaq gives the total value in millions of dollars.
    totalValue: Number.isFinite(money(sumry.TotalHoldingsValue?.value)) ? money(sumry.TotalHoldingsValue.value) * 1e6 : null,
    increased: positions(active, /^increased/i),
    decreased: positions(active, /^decreased/i),
    held: positions(active, /^held/i),
    total: positions(active, /^total/i),
    new: positions(newSold, /^new/i),
    soldOut: positions(newSold, /^sold out/i),
  };
  const table = d.holdingsTransactions?.table;
  const all = (Array.isArray(table?.rows) ? table.rows : []).map((r) => {
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
  const hasSummary = Number.isFinite(reported.institutionalPct) || Number.isFinite(reported.total.holders);
  if (!all.length && !hasSummary) return null;

  const byValue = (a, b) => (b.value ?? -1) - (a.value ?? -1);
  const quarter = all.reduce((q, r) => (r.asOf && (!q || r.asOf > q) ? r.asOf : q), null);
  const current = all.filter((r) => !quarter || r.asOf === quarter).sort(byValue);
  const older = all.filter((r) => quarter && r.asOf !== quarter).sort(byValue);
  const rows = current.slice(0, LIMIT);
  // The old filings that would have made the top list.
  const floor = rows.length ? rows[rows.length - 1].value ?? 0 : 0;
  const notRefiled = rows.length < LIMIT ? older.slice(0, LIMIT) : older.filter((r) => (r.value ?? -1) >= floor);

  const totalRecords = money(d.holdingsTransactions?.totalRecords);
  const complete = all.length > 0 && Number.isFinite(totalRecords) && all.length >= totalRecords;
  let summary;
  if (complete) {
    const pos = positionsFrom(current);
    summary = {
      institutionalPct: outstanding ? Math.round((pos.total.shares / outstanding) * 1e4) / 100 : null,
      sharesOutstanding: outstanding,
      totalValue: sum(current, 'value'),
      ...pos,
      // Sold-out filings are not in the holder list: this one is the source's count,
      // across each holder's latest filing.
      soldOut: reported.soldOut,
      quarter,
      quarterOnly: true,
      notRefiled: { holders: older.length, shares: sum(older, 'shares'), value: sum(older, 'value') },
      reported,
    };
  } else {
    summary = { ...reported, sharesOutstanding: outstanding, quarter, quarterOnly: false, notRefiled: null, reported };
  }
  return {
    summary,
    rows,
    notRefiled,
    // Holders behind "N OF M": the newest quarter's filers when the list is complete.
    totalRecords: complete ? current.length : totalRecords,
  };
}

export function makeOwners({ fetchImpl = cappedFetch, cache = createCache({ maxEntries: 500, retryMs: 60_000 }) } = {}) {
  async function getOwners(raw) {
    const ticker = tickerOrThrow(raw);
    const path = `company/${encodeURIComponent(ticker)}/institutional-holdings?limit=${FETCH_LIMIT}&type=TOTAL&sortColumn=marketValue&sortOrder=DESC`;
    const got = await cachedOrThrow(cache, `owners:${ticker}`, DAY_MS, async () => parseOwners(await nasdaqData(fetchImpl, path)), {
      what: 'Holdings data', missing: `No institutional holdings on file for ${ticker}.`,
    });
    return { ticker, ...got.value, stale: got.stale, updated: got.updated, source: OWNERS_SOURCE };
  }
  return { getOwners };
}

export const { getOwners } = makeOwners();

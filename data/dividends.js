// DIVIDENDS: dividend history and yield from the Nasdaq API (no key). Nasdaq only has the
// payment history for Nasdaq-listed stocks; for the rest (NYSE and others) the yearly
// dividend and yield come from the CNBC quote service instead, with no history.
//
// Nasdaq gives each payment as paid, on the share basis of its day. Per-share amounts
// before a later split are put on today's basis with the split history
// (data/split-history.js): amount / the splits dated after the ex-date. With no split
// history the amounts stay as paid and `split` is null; a payment older than the
// history reaches gets a null amount ("--") and its year no total.
// Each full year's total is cross-checked against Yahoo Finance's dividend list (same
// call as the split history). A year where the two disagree (a payment missing from
// one of them, or a different amount) gets no total, with a note, never a guess.

import { createCache } from './cache.js';
import { normalizeTicker, fetchStockRows, tickerSource } from './quotes.js';
import { getNasdaq, money, usDay, iso } from './lists.js';
import { getSplitHistory, factorAfter } from './split-history.js';

const TTL = 6 * 60 * 60_000;

export class DividendsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function parseDividends(body) {
  const d = body?.data;
  if (!d) return null;
  const rows = (Array.isArray(d.dividends?.rows) ? d.dividends.rows : [])
    .map((r) => ({
      exDate: usDay(r.exOrEffDate),
      type: String(r.type || '').trim() || null,
      amount: money(r.amount),
      currency: typeof r.currency === 'string' ? r.currency : null,
      declared: usDay(r.declarationDate),
      record: usDay(r.recordDate),
      paid: usDay(r.paymentDate),
    }))
    .filter((r) => r.exDate && Number.isFinite(r.amount))
    .sort((a, b) => (a.exDate < b.exDate ? 1 : -1));
  return {
    yield: money(d.yield),
    annual: money(d.annualizedDividend),
    exDate: usDay(d.exDividendDate),
    payDate: usDay(d.dividendPaymentDate),
    rows,
  };
}

// Cash paid per calendar year (by ex-date), newest first. A year with a payment of
// unknown amount has no total (null).
export function yearlyTotals(rows) {
  const by = new Map();
  for (const r of rows) {
    const y = r.exDate.slice(0, 4);
    const cur = by.get(y) || { year: y, total: 0, count: 0 };
    cur.total = Number.isFinite(r.amount) && cur.total !== null ? cur.total + r.amount : null;
    cur.count += 1;
    by.set(y, cur);
  }
  return [...by.values()].sort((a, b) => (a.year < b.year ? 1 : -1)).map((y) => ({ ...y, total: y.total === null ? null : Math.round(y.total * 1e6) / 1e6 }));
}

// Rows on today's share basis. Each adjusted row keeps the paid amount in asPaid.
export function splitAdjustRows(rows, hist) {
  if (!hist) return rows;
  return rows.map((r) => {
    const f = factorAfter(hist, r.exDate);
    if (!f) return { ...r, amount: null, asPaid: r.amount };
    if (f === 1) return r;
    return { ...r, amount: Math.round((r.amount / f) * 1e8) / 1e8, asPaid: r.amount, splitFactor: f };
  });
}

// years (newest first) -> the same with `check`: 'ok', 'mismatch' (total set to null,
// Yahoo's figures kept for the note) or null (not checked: no Yahoo list, or the
// current year, which may still be filling in on either side).
export function checkYears(years, yahoo, currentYear) {
  if (!Array.isArray(yahoo)) return years.map((y) => ({ ...y, check: null }));
  const by = new Map();
  for (const d of yahoo) {
    const k = d.date.slice(0, 4);
    const cur = by.get(k) || { total: 0, count: 0 };
    cur.total += d.amount;
    cur.count += 1;
    by.set(k, cur);
  }
  return years.map((y) => {
    if (y.year >= currentYear || !Number.isFinite(y.total)) return { ...y, check: null };
    const o = by.get(y.year);
    const same = o && o.count === y.count && Math.abs(o.total - y.total) <= Math.max(0.0005, y.total * 0.005);
    if (same) return { ...y, check: 'ok' };
    return { ...y, total: null, check: 'mismatch', nasdaq: { total: y.total, count: y.count }, other: o ? { total: Math.round(o.total * 1e6) / 1e6, count: o.count } : { total: 0, count: 0 } };
  });
}

// The splits that change any payment shown: dated after the oldest ex-date.
export function splitsInRange(rows, hist) {
  const oldest = rows.length ? rows[rows.length - 1].exDate : '9999';
  return (hist?.splits || []).filter((s) => s.date > oldest).map(({ date, ratio }) => ({ date, ratio }));
}

// CNBC quote row -> { yield, annual } (both may be null).
export function parseCnbcDividend(r) {
  if (!r || Number(r.code) !== 0) return null;
  return { yield: money(r.dividendyield), annual: money(r.dividend) };
}

export function makeDividends({ fetchImpl = globalThis.fetch, cache = createCache(), now = () => Date.now(), splitHistory = fetchImpl === globalThis.fetch ? getSplitHistory : async () => null } = {}) {
  async function getDividends(raw) {
    const ticker = normalizeTicker(raw);
    if (!ticker) throw new DividendsError('bad_symbol', 'That does not look like a ticker.');
    let got;
    try {
      got = await cache.cached(`dividends:${ticker}`, TTL, async () => {
        const d = parseDividends(await getNasdaq(fetchImpl, `quote/${encodeURIComponent(ticker)}/dividends?assetclass=stocks`));
        if (d && d.rows.length) return { ...d, history: true };
        const rows = await fetchStockRows(fetchImpl, [tickerSource(ticker)]);
        const c = parseCnbcDividend(rows[0]);
        if (!c && !d) return null;
        return { yield: c?.yield ?? d?.yield ?? null, annual: c?.annual ?? d?.annual ?? null, exDate: d?.exDate || null, payDate: d?.payDate || null, rows: [], history: false };
      });
    } catch {
      throw new DividendsError('unavailable', 'Dividend data is taking a break. Try again in a minute.');
    }
    if (!got.value) throw new DividendsError('not_found', `No dividend data for ${ticker}.`);
    let hist = null;
    if (got.value.rows.length) {
      try { hist = await splitHistory(ticker); } catch { hist = null; }
    }
    const rows = splitAdjustRows(got.value.rows, hist);
    const split = hist ? { source: hist.source, splits: splitsInRange(got.value.rows, hist) } : null;
    // Yahoo's amounts are on today's basis, so the check needs ours adjusted too.
    const yahoo = hist && split ? hist.dividends : null;
    const years = checkYears(yearlyTotals(rows), yahoo, String(new Date(now()).getUTCFullYear()));
    return { ticker, ...got.value, rows, split, years, checkSource: Array.isArray(yahoo) ? 'a second market data provider' : null, stale: got.stale, updated: iso(got.fetchedAt) };
  }
  return { getDividends };
}

export const { getDividends } = makeDividends();

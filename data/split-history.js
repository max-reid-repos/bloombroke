// Stock split history for one ticker, for split-adjusting per-share figures
// (FINANCIALS EPS and share counts, DIVIDENDS amounts).
// - Primary: Yahoo Finance chart events (events=split), cached 24 hours.
// - Fallback: the split list baked into data/whatif-prices.json by the WHATIF build
//   (same Yahoo source, checked against CNBC split-adjusted closes), for its tickers.
// A split's date is its first split-adjusted trading day (the ex-date).
// The same Yahoo call also brings Yahoo's own dividend list (split-adjusted), which
// DIVIDENDS uses only to cross-check Nasdaq's yearly totals.
//
// Rule for a figure dated D (a filing date or a dividend ex-date): every split dated
// after D has not been applied to it yet. The factor is the product of those ratios.
// A per-share figure is divided by it, a share count multiplied.

import { readFileSync } from 'node:fs';
import { createCache } from './cache.js';

const DAY = 24 * 60 * 60_000;
const YAHOO_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
export const SPLIT_SOURCE = 'Yahoo Finance split history';

// The WHATIF copy covers 2007-01-01 to its build day. Used only while it is under 60
// days old: a split after the build would be missing from it.
const BAKED_FROM = '2007-01-01';
const BAKED_MAX_AGE = 60 * DAY;
let baked = null;
function bakedFile() {
  if (!baked) {
    try {
      const j = JSON.parse(readFileSync(new URL('./whatif-prices.json', import.meta.url), 'utf8'));
      baked = { built: String(j.built || ''), splits: j.splits || {} };
    } catch {
      baked = { built: '', splits: {} };
    }
  }
  return baked;
}

// "4:1" / { numerator: 4, denominator: 1 } -> 4. Reverse splits give < 1. null when unreadable.
export function ratioFactor(ratio, numerator, denominator) {
  let a = Number(numerator);
  let b = Number(denominator);
  if (!(a > 0 && b > 0)) {
    const m = /^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(ratio ?? ''));
    if (!m) return null;
    a = Number(m[1]);
    b = Number(m[2]);
  }
  if (!(a > 0 && b > 0) || a === b) return null;
  return a / b;
}

// [{ date, ratio }] (baked shape) -> [{ date, ratio, factor }], oldest first.
export function normalizeSplits(list) {
  return (Array.isArray(list) ? list : [])
    .map((s) => ({ date: String(s?.date || ''), ratio: String(s?.ratio || ''), factor: ratioFactor(s?.ratio) }))
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.factor)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Yahoo chart body -> [{ date, ratio, factor }] oldest first, or null on an unexpected shape.
// The event time is the market open of the ex-date; the New York day is taken from
// the exchange offset.
export function parseYahooSplits(body) {
  const r = body?.chart?.result?.[0];
  if (!r || !r.meta) return null;
  const off = Number.isFinite(r.meta.gmtoffset) ? r.meta.gmtoffset : -14400;
  const out = Object.values(r.events?.splits || {}).map((s) => {
    const factor = ratioFactor(s?.splitRatio, s?.numerator, s?.denominator);
    const t = Number(s?.date);
    if (!factor || !Number.isFinite(t)) return null;
    const date = new Date((t + off) * 1000).toISOString().slice(0, 10);
    const ratio = Number(s.numerator) > 0 && Number(s.denominator) > 0 ? `${Number(s.numerator)}:${Number(s.denominator)}` : String(s.splitRatio);
    return { date, ratio, factor };
  }).filter(Boolean);
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Yahoo chart body -> [{ date, amount }] oldest first (amounts split-adjusted by Yahoo).
export function parseYahooDividends(body) {
  const r = body?.chart?.result?.[0];
  if (!r || !r.meta) return null;
  const off = Number.isFinite(r.meta.gmtoffset) ? r.meta.gmtoffset : -14400;
  return Object.values(r.events?.dividends || {}).map((v) => {
    const t = Number(v?.date);
    const amount = Number(v?.amount);
    if (!Number.isFinite(t) || !(amount > 0)) return null;
    return { date: new Date((t + off) * 1000).toISOString().slice(0, 10), amount };
  }).filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Product of the splits dated after `day` (YYYY-MM-DD). 1 when none. null when the
// history does not reach back to that day (hist.from), so the factor is unknown.
export function factorAfter(hist, day) {
  const d = String(day || '');
  if (!hist || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (hist.from && d < hist.from) return null;
  let f = 1;
  for (const s of hist.splits || []) if (s.date > d) f *= s.factor;
  return f;
}

export function yahooSymbol(t) {
  return String(t || '').toUpperCase().replace('.', '-');
}

export function makeSplitHistory({ fetchImpl = globalThis.fetch, cache = createCache({ maxEntries: 500, retryMs: 5 * 60_000 }), bakedFor = (t) => {
  const b = bakedFile();
  const fresh = b.built && Date.now() - Date.parse(`${b.built}T00:00:00Z`) < BAKED_MAX_AGE;
  return fresh && Array.isArray(b.splits[t]) ? b.splits[t] : null;
} } = {}) {
  // { splits, from, source, fetchedAt } or null when no source answered. `from`: the
  // first day the list is known to be complete for (null: the whole history).
  async function getSplitHistory(ticker) {
    const t = String(ticker || '').toUpperCase();
    if (!/^[A-Z]{1,5}([.-][A-Z]{1,2})?$/.test(t)) return null;
    try {
      const got = await cache.cached(`splits:${t}`, DAY, async () => {
        const url = `${YAHOO_URL}/${encodeURIComponent(yahooSymbol(t))}?range=max&interval=3mo&events=div%2Csplit`;
        const res = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`yahoo splits HTTP ${res.status}`);
        const body = await res.json();
        const splits = parseYahooSplits(body);
        if (!splits) throw new Error('yahoo splits: unexpected shape');
        return { splits, dividends: parseYahooDividends(body) || [] };
      });
      return { splits: got.value.splits, dividends: got.value.dividends, from: null, source: SPLIT_SOURCE, fetchedAt: got.fetchedAt };
    } catch (err) {
      const b = bakedFor(t);
      if (Array.isArray(b)) return { splits: normalizeSplits(b), dividends: null, from: BAKED_FROM, source: `${SPLIT_SOURCE} (WHATIF copy)`, fetchedAt: null };
      console.error('[split-history]', t, err.message);
      return null;
    }
  }
  return { getSplitHistory };
}

export const { getSplitHistory } = makeSplitHistory();

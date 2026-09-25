// 52-week range at the instrument's own precision. CNBC rounds the 52-week high and
// low for some instruments (EUR/USD comes as 1.21 and 1.13 for a pair quoted to four
// decimals). When the source gives fewer decimals than the instrument shows, the
// quote screen gets the range of the daily closes over the last 52 weeks instead,
// from the same daily bars as the 1Y chart, and says so (range52Basis). If that
// fails, the source's values stay, marked as rounded, and the screen shows them with
// the source's own decimals.

import { getChart } from './charts.js';
import { decimalsIn } from './quotes.js';

export { decimalsIn };

const YEAR_MS = 365 * 24 * 60 * 60_000;

// Is the source's range rounded below what the instrument shows?
export function roundedRange(q) {
  return Number.isInteger(q?.decimals) && Number.isInteger(q?.range52Dp) && q.range52Dp < q.decimals;
}

// Daily points (oldest first) -> { high, low, from, to } over the last 52 weeks before `nowMs`.
export function closesRange(points, nowMs) {
  const since = nowMs - YEAR_MS;
  const pts = (points || []).filter((p) => p.t >= since && Number.isFinite(p.v));
  if (pts.length < 20) return null;
  let hi = pts[0];
  let lo = pts[0];
  for (const p of pts) {
    if (p.v > hi.v) hi = p;
    if (p.v < lo.v) lo = p;
  }
  return { high: hi.v, low: lo.v, highT: hi.t, lowT: lo.t };
}

// The source's 52-week range cannot be used at all: a named instrument missing a side
// (spot gold's low comes as a 0.00 placeholder, see parseQuoteRow), and every spot
// metal, whose high and low CNBC tracks over a short window only (on 2026-09-25 spot
// silver's "52-week high" was 64.39 while COMEX silver's was 121.79). Those get the
// range of the daily closes, or -- when the closes cannot be had.
export function unusableRange(q) {
  if (!q?.label || q.kind === 'stock') return false;
  return q.kind === 'spot' || !Number.isFinite(q.high52) || !Number.isFinite(q.low52);
}

export async function precise52(q, { chart = getChart, now = () => Date.now() } = {}) {
  const unusable = unusableRange(q);
  if (!q || !(roundedRange(q) || unusable)) return q;
  try {
    const c = await chart(q.ticker, '1Y');
    const r = c?.bar === '1D' ? closesRange(c.points, now()) : null;
    if (!r) throw new Error('no daily closes');
    return { ...q, high52: r.high, low52: r.low, range52Basis: 'daily closes', source52: { high: q.high52, low: q.low52, decimals: q.range52Dp } };
  } catch {
    // An unusable range shows as -- (never the placeholder); a rounded one is kept, marked.
    if (unusable) return { ...q, high52: null, low52: null };
    return { ...q, range52Basis: 'source, rounded' };
  }
}

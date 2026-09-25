// COMPARE: % performance of 2 to 5 tickers over one range, from CNBC price history (no key).

import { getChart as defaultGetChart, ChartError, chartSymbol } from './charts.js';
import { getQuote as defaultGetQuote } from './quotes.js';

export const COMPARE_RANGES = ['1M', '6M', '1Y', '5Y'];

export class CompareError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// [{ t, v }] -> [{ t, p }] where p is the % change from the first point.
export function normalise(points) {
  const base = points[0]?.v;
  if (!(base > 0)) return [];
  return points.map(({ t, v }) => ({ t, p: Math.round(((v - base) / base) * 1e6) / 1e4 }));
}

export function parseCompareSymbols(raw) {
  const list = String(raw ?? '').toUpperCase().split(/[\s,]+/).filter(Boolean);
  const uniq = [...new Set(list)];
  if (uniq.length < 2 || uniq.length > 5) return null;
  return uniq.every((s) => chartSymbol(s)) ? uniq : null;
}

export function makeCompare({ getChart = defaultGetChart, getQuote = defaultGetQuote } = {}) {
  async function getCompare({ symbols, range = '1Y' }) {
    const list = parseCompareSymbols(symbols);
    if (!list) throw new CompareError('usage', 'Compare 2 to 5 tickers, like COMPARE AAPL MSFT NVDA.');
    const r = String(range).toUpperCase();
    if (!COMPARE_RANGES.includes(r)) throw new CompareError('bad_range', 'Pick a range: 1M, 6M, 1Y or 5Y.');
    const [charts, quotes] = await Promise.all([
      Promise.allSettled(list.map((s) => getChart(s, r))),
      Promise.allSettled(list.map((s) => getQuote(s))),
    ]);
    const missing = list.filter((_, i) => charts[i].status === 'rejected' && charts[i].reason instanceof ChartError && charts[i].reason.code !== 'unavailable');
    if (missing.length) throw new CompareError('not_found', `No ${r} history for ${missing.join(', ')}.`);
    if (charts.some((c) => c.status === 'rejected')) throw new CompareError('unavailable', 'Chart data is taking a break. Try again in a minute.');
    const series = list.map((ticker, i) => {
      const c = charts[i].value;
      const q = quotes[i].status === 'fulfilled' ? quotes[i].value : null;
      const pts = normalise(c.points);
      return {
        ticker,
        name: q?.name || ticker,
        first: c.points[0].t,
        last: c.points[c.points.length - 1].v,
        changePct: pts.length ? pts[pts.length - 1].p : null,
        points: pts,
      };
    });
    const stale = charts.some((c) => c.value.stale);
    const updated = charts.map((c) => c.value.updated).sort()[0];
    return { range: r, series, stale, updated };
  }
  return { getCompare };
}

export const { getCompare } = makeCompare();

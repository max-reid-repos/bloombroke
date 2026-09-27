// ECONOMY: the US macro dashboard, from FRED (Federal Reserve Bank of St. Louis) graph
// CSVs. No key. fredgraph.csv refuses browser user agents, so this sends a plain one.
// Each series is cached 12 hours and served stale if FRED is down.
//
// `calc` turns the raw series into what the dashboard shows:
//   level: the value as published.   mom: % change on the month before.
//   yoy: % change on the same month a year before.   diff: change on the month before.

import { createCache } from './cache.js';

const TTL = 12 * 60 * 60_000;
const FRED_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv';
export const FRED_UA = 'Bloombroke/1.0';

export class EconomyError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const SERIES = [
  { id: 'GDP', fred: 'A191RL1Q225SBEA', name: 'GDP growth', calc: 'level', unit: 'pct', freq: 'Q', note: 'Real GDP, % change at an annual rate, quarterly' },
  { id: 'UNRATE', fred: 'UNRATE', name: 'Unemployment rate', calc: 'level', unit: 'pct', freq: 'M', note: 'Share of the labour force out of work, monthly' },
  { id: 'PAYROLLS', fred: 'PAYEMS', name: 'Nonfarm payrolls', calc: 'diff', unit: 'k', freq: 'M', note: 'Jobs added in the month, thousands' },
  { id: 'CPI', fred: 'CPIAUCNS', name: 'CPI inflation', calc: 'yoy', unit: 'pct', freq: 'M', note: 'Consumer prices (not seasonally adjusted, as in the headline), % change on a year before' },
  { id: 'COREPCE', fred: 'PCEPILFE', name: 'Core PCE inflation', calc: 'yoy', unit: 'pct', freq: 'M', note: 'PCE prices less food and energy, % change on a year before' },
  { id: 'CLAIMS', fred: 'ICSA', name: 'Initial jobless claims', calc: 'level', unit: 'count', freq: 'W', note: 'New claims for unemployment benefits, weekly' },
  { id: 'RETAIL', fred: 'RSAFS', name: 'Retail sales', calc: 'mom', unit: 'pct', freq: 'M', note: 'Retail and food services sales, % change on the month before' },
  { id: 'SENTIMENT', fred: 'UMCSENT', name: 'Consumer sentiment', calc: 'level', unit: 'index', freq: 'M', note: 'University of Michigan index, 1966 Q1 = 100' },
  { id: 'INDPRO', fred: 'INDPRO', name: 'Industrial production', calc: 'mom', unit: 'pct', freq: 'M', note: 'Factories, mines and utilities output, % change on the month before' },
  { id: 'T10Y2Y', fred: 'T10Y2Y', name: '10Y minus 2Y yield', calc: 'level', unit: 'bp', freq: 'D', note: '10-year minus 2-year Treasury yield, daily' },
];

// A series by our id or its FRED id: "UNRATE", "PAYEMS" and "PAYROLLS" all work.
export function seriesById(id) {
  const k = String(id ?? '').trim().toUpperCase();
  return SERIES.find((s) => s.id === k || s.fred === k) || null;
}

// FRED graph CSV -> [{ date, value }] oldest first. "." marks a missing value.
export function parseFredCsv(csv) {
  const lines = String(csv ?? '').trim().split(/\r?\n/);
  const head = lines.shift()?.split(',') || [];
  if (head.length < 2 || !/date/i.test(head[0])) throw new Error('FRED source: unexpected header');
  const out = [];
  for (const line of lines) {
    const [date, raw] = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || raw === undefined) continue;
    const t = raw.trim();
    if (!t || t === '.') continue;
    const value = Number(t);
    if (Number.isFinite(value)) out.push({ date, value });
  }
  if (!out.length) throw new Error('FRED source: no observations');
  return out;
}

const monthKey = (date, back = 0) => {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 - back;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
};

// Raw observations -> the shown values. yoy matches the same calendar month a year
// before; mom and diff match the calendar month before. A gap gives no value, not a guess.
export function transform(obs, calc) {
  if (calc === 'level') return obs.map((o) => ({ date: o.date, value: o.value }));
  const byMonth = new Map(obs.map((o) => [o.date.slice(0, 7), o.value]));
  const out = [];
  for (const o of obs) {
    const before = byMonth.get(monthKey(o.date, calc === 'yoy' ? 12 : 1));
    if (!Number.isFinite(before)) continue;
    if (calc === 'diff') out.push({ date: o.date, value: o.value - before });
    else if (before !== 0) out.push({ date: o.date, value: (o.value / before - 1) * 100 });
  }
  return out;
}

// The dashboard row: latest, previous and a two-year sparkline.
export function summarize(points, today = new Date().toISOString().slice(0, 10)) {
  if (!points.length) return { date: null, value: null, prevDate: null, prev: null, spark: [] };
  const last = points[points.length - 1];
  const prev = points.length > 1 ? points[points.length - 2] : null;
  const cutoff = `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`;
  const spark = points.filter((p) => p.date >= cutoff).map((p) => p.value);
  return { date: last.date, value: last.value, prevDate: prev?.date || null, prev: prev ? prev.value : null, spark };
}

export const CHART_RANGES = { '5Y': 5, '10Y': 10, MAX: null };

export function sliceRange(points, range, today = new Date().toISOString().slice(0, 10)) {
  const years = CHART_RANGES[range];
  if (!years) return points;
  const cutoff = `${Number(today.slice(0, 4)) - years}${today.slice(4)}`;
  return points.filter((p) => p.date >= cutoff);
}

export function makeEconomy({ fetchImpl = globalThis.fetch, cache = createCache({ retryMs: 5 * 60_000 }), today = () => new Date().toISOString().slice(0, 10) } = {}) {
  async function fetchCsv(fredId) {
    let lastErr;
    // FRED now and then drops a connection; one retry covers it.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetchImpl(`${FRED_URL}?id=${encodeURIComponent(fredId)}`, {
          headers: { 'User-Agent': FRED_UA, Accept: 'text/csv' },
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`FRED source HTTP ${res.status}`);
        return await res.text();
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  const series = (s) => cache.cached(`fred:${s.fred}`, TTL, async () => transform(parseFredCsv(await fetchCsv(s.fred)), s.calc));

  const meta = ({ id, fred, name, unit, freq, note, calc }) => ({ id, fred, name, unit, freq, note, calc });

  // Every series, three at a time so FRED is not hit with ten requests at once.
  async function getEconomy() {
    const results = new Array(SERIES.length);
    for (let i = 0; i < SERIES.length; i += 3) {
      const batch = SERIES.slice(i, i + 3);
      const got = await Promise.allSettled(batch.map(series));
      got.forEach((r, k) => { results[i + k] = r; });
    }
    if (results.every((r) => r.status === 'rejected')) throw new Error('FRED source: every series failed');
    const t = today();
    const rows = SERIES.map((s, i) => {
      const r = results[i];
      if (r.status === 'rejected') return { ...meta(s), date: null, value: null, prevDate: null, prev: null, spark: [], missing: true };
      return { ...meta(s), ...summarize(r.value.value, t), stale: r.value.stale };
    });
    const fetched = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.fetchedAt);
    return {
      series: rows,
      stale: rows.some((r) => r.stale || r.missing),
      updated: new Date(Math.min(...fetched)).toISOString(),
      source: 'Public web data (US statistics)',
    };
  }

  async function getEconomySeries(id, range = '10Y') {
    const s = seriesById(id);
    if (!s) throw new EconomyError('not_found', 'No such ECONOMY series. Type ECONOMY for the list.');
    const r = Object.hasOwn(CHART_RANGES, range) ? range : '10Y';
    const { value, stale, fetchedAt } = await series(s);
    const t = today();
    const { spark, ...latest } = summarize(value, t);
    return {
      ...meta(s),
      range: r,
      points: sliceRange(value, r, t),
      ...latest,
      first: value[0]?.date || null,
      stale,
      updated: new Date(fetchedAt).toISOString(),
      source: 'Public web data (US statistics)',
    };
  }

  return { getEconomy, getEconomySeries };
}

export const { getEconomy, getEconomySeries } = makeEconomy();

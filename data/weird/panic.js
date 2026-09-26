// PANIC: how many people read the English Wikipedia pages on recessions, crashes,
// stagflation and bank runs. Source: Wikimedia pageviews REST API (people only, bots
// excluded). The headline is the latest full day against the 30 days before it.

import { NoData, mean, signedPct } from './source.js';

export const id = 'panic';
export const source = 'Wikimedia';
export const ttl = 3 * 60 * 60_000;

export const ARTICLES = [
  { page: 'Recession', label: 'Recession' },
  { page: 'Stock_market_crash', label: 'Stock market crash' },
  { page: 'Stagflation', label: 'Stagflation' },
  { page: 'Bank_run', label: 'Bank run' },
];
const DAYS = 120;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

export function url(page, now) {
  const end = now - 86400_000;
  const start = end - (DAYS - 1) * 86400_000;
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(page)}/daily/${ymd(start)}/${ymd(end)}`;
}

// Wikimedia body -> [{ date: 'YYYY-MM-DD', views }] oldest first.
export function parse(body) {
  const items = body?.items;
  if (!Array.isArray(items)) throw new Error('Wikimedia: unexpected shape');
  return items
    .map((it) => ({ date: /^(\d{4})(\d{2})(\d{2})/.exec(String(it.timestamp)), views: Number(it.views) }))
    .filter((it) => it.date && Number.isFinite(it.views))
    .map((it) => ({ date: `${it.date[1]}-${it.date[2]}-${it.date[3]}`, views: it.views }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Latest value against the mean of the `n` values before it, as a % change.
export function vsAverage(values, n = 30) {
  if (values.length < n + 1) return null;
  const last = values[values.length - 1];
  const avg = mean(values.slice(-n - 1, -1));
  return { last, avg, pct: avg ? (last / avg - 1) * 100 : null };
}

// Per-article series -> the gauge. Only days every article has are counted.
export function build(seriesByPage) {
  const maps = ARTICLES.map((a) => new Map((seriesByPage[a.page] || []).map((p) => [p.date, p.views])));
  const dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).sort();
  if (dates.length < 31) throw new NoData('Wikimedia: not enough days');
  const totals = dates.map((d) => maps.reduce((s, m) => s + m.get(d), 0));
  const head = vsAverage(totals);
  const last90 = dates.slice(-90);
  const pct = head.pct;
  return {
    headline: signedPct(pct, 0),
    line: 'Crash-page views vs 30-day average',
    spark: totals.slice(-90),
    asOf: dates[dates.length - 1],
    source,
    total: head.last,
    avg30: head.avg,
    pct,
    articles: ARTICLES.map((a, i) => {
      const vals = dates.map((d) => maps[i].get(d));
      const v = vsAverage(vals);
      return { page: a.page, label: a.label, last: v.last, avg30: v.avg, pct: v.pct, points: last90.map((d) => ({ date: d, views: maps[i].get(d) })) };
    }),
  };
}

export async function load(get, { now = Date.now } = {}) {
  const t = now();
  const got = await Promise.all(ARTICLES.map((a) => get.json(url(a.page, t)).then(parse)));
  return build(Object.fromEntries(ARTICLES.map((a, i) => [a.page, got[i]])));
}

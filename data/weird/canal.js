// CANAL: ships through the world's chokepoints, one day at a time.
// Source: IMF PortWatch daily chokepoint transits (ArcGIS feature service, no key).
// The data runs about 6 days behind. Three queries: the latest Hormuz day on file, the
// last 90 days for six chokepoints, and each one's average over the year to that day.
// The headline is Hormuz's 7-day average; "vs avg" compares 7-day and 1-year averages.

import { NoData } from './source.js';

export const id = 'canal';
export const source = 'IMF PortWatch';
export const ttl = 6 * 60 * 60_000;

const URL_BASE = 'https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Chokepoints_Data/FeatureServer/0/query';

// Shown in this order; the first is the headline.
export const CHOKEPOINTS = [
  { portid: 'chokepoint6', name: 'Hormuz', full: 'Strait of Hormuz' },
  { portid: 'chokepoint1', name: 'Suez', full: 'Suez Canal' },
  { portid: 'chokepoint2', name: 'Panama', full: 'Panama Canal' },
  { portid: 'chokepoint5', name: 'Malacca', full: 'Malacca Strait' },
  { portid: 'chokepoint4', name: 'Bab el-Mandeb', full: 'Bab el-Mandeb Strait' },
  { portid: 'chokepoint3', name: 'Bosporus', full: 'Bosporus Strait' },
];
const IDS = CHOKEPOINTS.map((c) => `'${c.portid}'`).join(',');

function query(params) {
  return `${URL_BASE}?${new URLSearchParams({ ...params, f: 'json' })}`;
}

function features(body) {
  if (body?.error) throw new Error(`PortWatch: ${body.error.message || 'query error'}`);
  if (!Array.isArray(body?.features)) throw new Error('PortWatch: unexpected shape');
  return body.features.map((f) => f.attributes || {});
}

// Daily rows -> { portid: [{ date, total, tanker }] } oldest first, one row per date
// (a repeated date keeps its last row, so the 7-day window never holds 8 rows).
export function parseDaily(body) {
  const byPort = {};
  for (const a of features(body)) {
    if (!a.portid || !/^\d{4}-\d{2}-\d{2}$/.test(String(a.date))) continue;
    if (!Number.isFinite(a.n_total)) continue;
    (byPort[a.portid] ||= new Map()).set(a.date, { date: a.date, total: a.n_total, tanker: Number.isFinite(a.n_tanker) ? a.n_tanker : null });
  }
  const out = {};
  for (const [k, m] of Object.entries(byPort)) out[k] = [...m.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  return out;
}

// Grouped statistics -> { portid: { total, tanker, days } }.
export function parseAverages(body) {
  const out = {};
  for (const a of features(body)) {
    if (!a.portid || !Number.isFinite(a.avg_total)) continue;
    out[a.portid] = { total: a.avg_total, tanker: Number.isFinite(a.avg_tanker) ? a.avg_tanker : null, days: a.days ?? null };
  }
  return out;
}

export function latestDate(body) {
  const d = features(body)[0]?.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) throw new NoData('PortWatch: no latest date');
  return d;
}

const shipWord = (n) => (n === 1 ? 'SHIP' : 'SHIPS');

// Mean daily ships over the 7 days ending `asOf`; null unless all 7 days are there.
export function week7(series, asOf) {
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const from = new Date(end - 6 * 86400_000).toISOString().slice(0, 10);
  const days = series.filter((p) => p.date >= from && p.date <= asOf);
  return days.length === 7 ? days.reduce((a, p) => a + p.total, 0) / 7 : null;
}

// The parsed parts -> what the tile and the screen show.
export function build(daily, avgs, asOf) {
  const rows = CHOKEPOINTS.map((c) => {
    const series = daily[c.portid] || [];
    const last = series[series.length - 1];
    const avg = avgs[c.portid];
    const week = week7(series, asOf);
    const base = { ...c, avgTotal: avg?.total ?? null, avgTanker: avg?.tanker ?? null, week, spark: series.map((p) => p.total) };
    const vsAvg = Number.isFinite(week) && avg?.total ? (week / avg.total - 1) * 100 : null;
    if (!last || last.date !== asOf) return { ...base, date: last?.date || null, total: null, tanker: null, vsAvg };
    return { ...base, date: last.date, total: last.total, tanker: last.tanker, vsAvg };
  });
  const lead = rows[0];
  if (!Number.isFinite(lead.week)) throw new NoData('PortWatch: no Hormuz values for the last 7 days');
  const perDay = Math.round(lead.week);
  return {
    headline: `${lead.name.toUpperCase()} ${perDay} ${shipWord(perDay)}/DAY`,
    value: perDay, // ALERTS: the headline number and its unit
    unit: 'ships/day',
    line: Number.isFinite(lead.avgTotal) ? `7-day average; 1-year average ${Math.round(lead.avgTotal)}` : '7-day average',
    spark: lead.spark,
    asOf,
    source,
    rows,
  };
}

export async function load(get) {
  const top = await get.json(query({ where: `portid = '${CHOKEPOINTS[0].portid}'`, outFields: 'date', orderByFields: 'date DESC', resultRecordCount: '1' }));
  const asOf = latestDate(top);
  const t = Date.parse(`${asOf}T00:00:00Z`);
  const from90 = new Date(t - 89 * 86400_000).toISOString().slice(0, 10);
  const from365 = new Date(t - 364 * 86400_000).toISOString().slice(0, 10);
  const [daily, avgs] = await Promise.all([
    get.json(query({
      where: `portid IN (${IDS}) AND date >= DATE '${from90}'`,
      outFields: 'date,portid,n_total,n_tanker',
      orderByFields: 'date ASC',
      resultRecordCount: '1000',
    })),
    get.json(query({
      where: `portid IN (${IDS}) AND date >= DATE '${from365}' AND date <= DATE '${asOf}'`,
      groupByFieldsForStatistics: 'portid',
      outStatistics: JSON.stringify([
        { statisticType: 'avg', onStatisticField: 'n_total', outStatisticFieldName: 'avg_total' },
        { statisticType: 'avg', onStatisticField: 'n_tanker', outStatisticFieldName: 'avg_tanker' },
        { statisticType: 'count', onStatisticField: 'n_total', outStatisticFieldName: 'days' },
      ]),
    })),
  ]);
  return build(parseDaily(daily), parseAverages(avgs), asOf);
}

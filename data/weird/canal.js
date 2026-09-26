// CANAL: ships through the world's chokepoints, one day at a time.
// Source: IMF PortWatch daily chokepoint transits (ArcGIS feature service, no key).
// The data runs about 6 days behind. Three queries: the latest day on file, the last
// 90 days for six chokepoints, and each one's average over the year to that day.

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

// Daily rows -> { portid: [{ date, total, tanker }] } oldest first.
export function parseDaily(body) {
  const out = {};
  for (const a of features(body)) {
    if (!a.portid || !/^\d{4}-\d{2}-\d{2}$/.test(String(a.date))) continue;
    if (!Number.isFinite(a.n_total)) continue;
    (out[a.portid] ||= []).push({ date: a.date, total: a.n_total, tanker: Number.isFinite(a.n_tanker) ? a.n_tanker : null });
  }
  for (const k of Object.keys(out)) out[k].sort((x, y) => (x.date < y.date ? -1 : 1));
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

// The parsed parts -> what the tile and the screen show.
export function build(daily, avgs, asOf) {
  const rows = CHOKEPOINTS.map((c) => {
    const series = daily[c.portid] || [];
    const last = series[series.length - 1];
    const avg = avgs[c.portid];
    if (!last || last.date !== asOf) return { ...c, date: last?.date || null, total: null, tanker: null, avgTotal: avg?.total ?? null, avgTanker: avg?.tanker ?? null, vsAvg: null, spark: series.map((p) => p.total) };
    return {
      ...c,
      date: last.date,
      total: last.total,
      tanker: last.tanker,
      avgTotal: avg?.total ?? null,
      avgTanker: avg?.tanker ?? null,
      vsAvg: avg?.total ? (last.total / avg.total - 1) * 100 : null,
      spark: series.map((p) => p.total),
    };
  });
  const lead = rows[0];
  if (!Number.isFinite(lead.total)) throw new NoData('PortWatch: no Hormuz value for the latest day');
  return {
    headline: `${lead.name.toUpperCase()} ${lead.total} ${shipWord(lead.total)}`,
    line: 'Ships through Hormuz in one day',
    spark: lead.spark,
    asOf,
    source,
    rows,
  };
}

export async function load(get) {
  const top = await get.json(query({ where: '1=1', outFields: 'date', orderByFields: 'date DESC', resultRecordCount: '1' }));
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

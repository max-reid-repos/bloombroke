// SICK: how much virus is in US wastewater, week by week, for COVID (SARS-CoV-2),
// flu A and RSV. Source: CDC National Wastewater Surveillance System, "Wastewater Viral
// Activity Level" (WVAL) dataset atcp-73re on data.cdc.gov (Socrata). WVAL compares
// each site with its own baseline. The data is per site, so the national figure here
// is the median of all reporting sites each week, worked out by the CDC's own query
// engine. It is our summary, not a CDC national number. The newest weeks are thin (sites
// report late), so the gauge uses the newest week with at least 90% of a full week's sites.

// History: every week in the dataset (it starts in January 2022), one query a week.

import { NoData, headlineNumber } from './source.js';
import { histFrom } from './history.js';

export const id = 'sick';
export const source = 'CDC NWSS';
export const ttl = 6 * 60 * 60_000;
export const retryMs = 30 * 60_000;
export const defaultPeriod = '1Y';
export const historyTtl = 7 * 24 * 60 * 60_000;
export const HISTORY_FROM = '2022-01-01';

export const PATHOGENS = [
  { key: 'SARS-CoV-2', label: 'COVID' },
  { key: 'Influenza A virus', label: 'Flu A' },
  { key: 'RSV', label: 'RSV' },
];
const WEEKS = 26;

export function url(now, since = null) {
  const from = since || new Date(now - (WEEKS + 2) * 7 * 86400_000).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    $select: 'week_end,pathogen_target,median(site_wval) as median_wval,count(site_wval) as sites',
    $where: `week_end >= '${from}' AND site_wval IS NOT NULL`,
    $group: 'week_end,pathogen_target',
    $order: 'week_end',
    $limit: since ? '5000' : '1000',
  });
  return `https://data.cdc.gov/resource/atcp-73re.json?${q}`;
}

// Socrata rows -> { [pathogen]: [{ week, level, sites }] } oldest first.
export function parse(body) {
  if (!Array.isArray(body)) throw new Error(`CDC: ${body?.message || 'unexpected shape'}`);
  const out = Object.fromEntries(PATHOGENS.map((p) => [p.key, []]));
  for (const r of body) {
    const week = String(r.week_end || '').slice(0, 10);
    const level = Number(r.median_wval);
    const sites = Number(r.sites);
    if (!out[r.pathogen_target] || !/^\d{4}-\d{2}-\d{2}$/.test(week) || !Number.isFinite(level)) continue;
    out[r.pathogen_target].push({ week, level, sites: Number.isFinite(sites) ? sites : null });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.week < b.week ? -1 : 1));
  return out;
}

const weeksBack = (week, n) => new Date(Date.parse(`${week}T00:00:00Z`) - n * 7 * 86400_000).toISOString().slice(0, 10);

// The newest week with at least 90% of a full week's sites. Sites keep reporting for
// a while after a week ends, so the last week or two are thin and move a lot. A full
// week is the most sites any of the last 8 weeks had.
export const FULL_SHARE = 0.9;
export function settledIndex(s) {
  const counts = s.slice(-8).map((x) => x.sites).filter(Number.isFinite);
  if (!counts.length) return s.length - 1;
  const need = Math.max(...counts) * FULL_SHARE;
  for (let i = s.length - 1; i >= 0; i -= 1) if (Number.isFinite(s[i].sites) && s[i].sites >= need) return i;
  return s.length - 1;
}

// A series key per virus: 'covid', 'flu-a', 'rsv'.
const keyOf = (p) => p.label.toLowerCase().replace(/[^a-z]+/g, '-');

// { [pathogen]: [{ week, level }] } -> a hist, one series per virus, the settled weeks only.
export function toHist(series) {
  const rows = new Map();
  for (const p of PATHOGENS) {
    const all = series[p.key] || [];
    for (const x of all.slice(0, settledIndex(all) + 1)) {
      const r = rows.get(x.week) || { d: x.week };
      r[keyOf(p)] = x.level;
      rows.set(x.week, r);
    }
  }
  return histFrom([...rows.values()], PATHOGENS.map((p) => ({ key: keyOf(p), label: p.label })), { step: 'week', lead: 'covid' });
}

export async function history(get, { now = Date.now } = {}) {
  const hist = toHist(parse(await get.json(url(now(), HISTORY_FROM), { timeout: 60_000 })));
  if (hist.d.length < 30) throw new NoData('CDC: no history');
  return hist;
}

export function build(series) {
  const rows = PATHOGENS.map((p) => {
    const all = series[p.key] || [];
    const s = all.slice(0, settledIndex(all) + 1).slice(-WEEKS);
    const last = s[s.length - 1];
    if (!last) return { key: p.key, label: p.label, level: null, points: [] };
    const before = s.find((x) => x.week === weeksBack(last.week, 4));
    return {
      key: p.key,
      label: p.label,
      week: last.week,
      level: last.level,
      sites: last.sites,
      level4w: before ? before.level : null,
      change4w: before ? last.level - before.level : null,
      points: s.map((x) => ({ week: x.week, level: x.level })),
    };
  });
  const covid = rows[0];
  if (!Number.isFinite(covid.level)) throw new NoData('CDC: no COVID wastewater values');
  return {
    headline: `COVID ${covid.level.toFixed(1)}`,
    value: headlineNumber(covid.level, 1), // ALERTS: the headline number and its unit
    unit: 'level',
    line: 'Wastewater virus level, national',
    spark: covid.points.map((p) => p.level),
    asOf: covid.week,
    source,
    rows,
    hist: toHist(series),
  };
}

export async function load(get, { now = Date.now } = {}) {
  return build(parse(await get.json(url(now()), { timeout: 30_000 })));
}

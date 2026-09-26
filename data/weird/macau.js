// MACAU: Macau's monthly casino gross gaming revenue, against the same month a year
// before. Source: DICJ, the Macau gaming regulator (Gaming Inspection and Coordination
// Bureau), whose yearly XML report lists each month for this year and the year before,
// in millions of patacas (MOP).

import { NoData, signedPct } from './source.js';

export const id = 'macau';
export const source = 'DICJ Macau';
export const ttl = 12 * 60 * 60_000;
export const retryMs = 60 * 60_000;

const url = (year) => `https://www.dicj.gov.mo/web/en/information/DadosEstat_mensal/${year}/report_en.xml`;
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const num = (s) => {
  const t = String(s ?? '').replace(/,/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

// The XML report -> { year, prevYear, months: [{ month: 'YYYY-MM', value, prev, ytd, ytdPrev }] }.
export function parse(xml) {
  const s = String(xml ?? '');
  const years = /Games of Fortune in (\d{4}) and (\d{4})/i.exec(s);
  if (!years) throw new Error('DICJ: unexpected shape');
  const year = Number(years[1]);
  const prevYear = Number(years[2]);
  const months = [];
  for (const rec of s.match(/<RECORD>[\s\S]*?<\/RECORD>/gi) || []) {
    const cells = [...rec.matchAll(/<DATA[^>]*>([^<]*)<\/DATA>/gi)].map((m) => m[1].trim());
    const m = MON[String(cells[0] || '').slice(0, 3).toLowerCase()];
    if (!m) continue;
    months.push({
      month: `${year}-${String(m).padStart(2, '0')}`,
      value: num(cells[1]),
      prev: num(cells[2]),
      ytd: num(cells[4]),
      ytdPrev: num(cells[5]),
    });
  }
  if (!months.length) throw new Error('DICJ: no months');
  return { year, prevYear, months };
}

// One or two parsed reports (this year first) -> the gauge.
export function build(reports) {
  const series = new Map();
  let latest = null;
  for (const r of reports.slice().reverse()) {
    for (const m of r.months) {
      const [y, mm] = m.month.split('-');
      if (Number.isFinite(m.prev)) series.set(`${Number(y) - 1}-${mm}`, m.prev);
      if (Number.isFinite(m.value)) series.set(m.month, m.value);
    }
  }
  for (const r of reports) {
    const got = r.months.filter((m) => Number.isFinite(m.value) && Number.isFinite(m.prev));
    if (got.length) { latest = { ...got[got.length - 1], year: r.year }; break; }
  }
  if (!latest) throw new NoData('DICJ: no month with values');
  const yoy = (latest.value / latest.prev - 1) * 100;
  const ytdYoy = Number.isFinite(latest.ytd) && latest.ytdPrev ? (latest.ytd / latest.ytdPrev - 1) * 100 : null;
  const points = [...series.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, value]) => ({ month, value }));
  const rows = points.slice(-13).reverse().map((p) => {
    const [y, mm] = p.month.split('-');
    const before = series.get(`${Number(y) - 1}-${mm}`);
    return { ...p, prev: before ?? null, yoy: before ? (p.value / before - 1) * 100 : null };
  });
  return {
    headline: `${signedPct(yoy, 1)} YOY`,
    line: 'Macau casino revenue vs a year ago',
    spark: points.slice(-24).map((p) => p.value),
    asOf: `${latest.month}-01`,
    source,
    month: latest.month,
    value: latest.value,
    prev: latest.prev,
    yoy,
    ytd: latest.ytd,
    ytdPrev: latest.ytdPrev,
    ytdYoy,
    rows,
  };
}

export async function load(get, { now = Date.now } = {}) {
  const year = new Date(now()).getUTCFullYear();
  const [cur, prev] = await Promise.allSettled([get.text(url(year), { timeout: 20_000 }), get.text(url(year - 1), { timeout: 20_000 })]);
  const reports = [];
  for (const r of [cur, prev]) {
    if (r.status !== 'fulfilled') continue;
    try { reports.push(parse(r.value)); } catch { /* a missing or odd year is skipped */ }
  }
  if (!reports.length) throw new Error(cur.reason?.message || 'DICJ: no report');
  return build(reports);
}

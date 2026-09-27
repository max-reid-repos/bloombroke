// WEIRD history: every gauge's past readings as one shape, and what the screens make of
// it (the period row, the chart, the grid sparks, the record line).
//
// A history ("hist") is one shared date axis plus one or more series on it:
//   { step: 'day' | 'week' | 'month' | 'quarter' | 'half' | 'edition',
//     d: ['YYYY-MM-DD', ...] ascending, one entry per reading date,
//     series: [{ key, label, v: [number | null, ...], hidden? }]  (v lines up with d),
//     lead: 'key'          the series the headline reads (grid spark, period cover),
//     recordAt?: 'YYYY-MM-DD'  the headline's own date when newer points are not settled }
// hidden: kept for the record line or the table, not drawn by default.
//
// Where it comes from (data/weird/index.js puts them together):
//   value.hist          built by the gauge's load() from what it fetched anyway
//                       (a FRED CSV is the full series; PortWatch only 90 days)
//   g.history(get, ..)  the deep past, fetched rarely (days to a month), cached on disk
//   snapshots           gauges whose source keeps no past: one reading per UTC day,
//                       recorded by us (snapshotStore below)
//
// Pure, apart from snapshotStore and historyStore (disk).

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { WEIRD_PERIODS, PERIOD_DAYS, monthLabel, dayLabel } from '../../public/screens/weird-gauges.js';

export const DAY_MS = 86_400_000;
// The record line needs at least this gap: "LOWEST SINCE" last month is not news.
export const MIN_GAP_DAYS = 182;
// A period is only offered when the readings go back at least this share of it.
export const COVER_SHARE = 0.9;
// ...and it holds at least this many readings.
export const MIN_POINTS = 3;
// Grid sparks are drawn from at most this many points; a gauge screen chart from this many.
export const SPARK_POINTS = 120;
export const CHART_POINTS = 3000;
// Snapshot gauges say "RECORDING SINCE ..." until their readings cover this period.
export const RECORDING_UNTIL = '1Y';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// rows: [{ d: 'YYYY-MM-DD', <key>: number }] in any order -> a hist. A repeated date keeps
// its last row. keys: [{ key, label, hidden? }].
export function histFrom(rows, keys, { step = 'day', lead = keys[0]?.key, recordAt = null } = {}) {
  const byDay = new Map();
  for (const r of rows || []) if (r && DATE_RE.test(String(r.d))) byDay.set(r.d, r);
  const days = [...byDay.keys()].sort();
  const out = {
    step,
    d: days,
    series: keys.map((k) => ({ key: k.key, label: k.label, ...(k.hidden ? { hidden: true } : {}), v: days.map((day) => num(byDay.get(day)[k.key])) })),
    lead,
  };
  if (recordAt) out.recordAt = recordAt;
  return out;
}

export const hasHist = (h) => Boolean(h && Array.isArray(h.d) && h.d.length && Array.isArray(h.series));

// One series as [{ d, v }], readings only.
export function points(hist, key = hist?.lead) {
  if (!hasHist(hist)) return [];
  const s = hist.series.find((x) => x.key === key);
  if (!s) return [];
  const out = [];
  for (let i = 0; i < hist.d.length; i += 1) if (num(s.v[i]) !== null) out.push({ d: hist.d[i], v: s.v[i] });
  return out;
}

// The deep past under the recent readings. A date both have takes the recent reading
// (a source may revise), unless the recent one is empty there (a year-on-year change
// needs a year before it, which a short recent fetch does not have). Labels, the lead
// and recordAt come from the recent one.
export function mergeHist(old, recent) {
  if (!hasHist(old)) return hasHist(recent) ? recent : null;
  if (!hasHist(recent)) return old;
  const days = [...new Set([...old.d, ...recent.d])].sort();
  const asMap = (h, key) => {
    const s = h.series.find((x) => x.key === key);
    const m = new Map();
    if (s) h.d.forEach((day, i) => { if (num(s.v[i]) !== null) m.set(day, s.v[i]); });
    return m;
  };
  const keys = [...recent.series.map((s) => s.key), ...old.series.map((s) => s.key).filter((k) => !recent.series.some((s) => s.key === k))];
  const series = keys.map((key) => {
    const base = recent.series.find((s) => s.key === key) || old.series.find((s) => s.key === key);
    const a = asMap(old, key);
    const b = asMap(recent, key);
    return { key, label: base.label, ...(base.hidden ? { hidden: true } : {}), v: days.map((day) => (b.has(day) ? b.get(day) : a.has(day) ? a.get(day) : null)) };
  });
  const out = { step: recent.step || old.step, d: days, series, lead: recent.lead || old.lead };
  if (recent.recordAt) out.recordAt = recent.recordAt;
  return out;
}

// Which periods the readings really cover: { '3M': { ok, title }, ... }. A period is on
// when the lead series goes back COVER_SHARE of it and holds MIN_POINTS readings in it;
// MAX when there are two readings at all. title says why one is off.
// recordingSince: the first day of a snapshot gauge (its own recording, not the source).
export function periodInfo(hist, { recordingSince = null } = {}) {
  const pts = points(hist);
  const out = {};
  const since = recordingSince ? `Recording since ${dayLabel(recordingSince)}` : '';
  if (pts.length < 2) {
    for (const p of WEIRD_PERIODS) out[p] = { ok: false, title: since || 'Too few readings yet' };
    return out;
  }
  const first = ms(pts[0].d);
  const last = ms(pts[pts.length - 1].d);
  const span = (last - first) / DAY_MS;
  for (const p of WEIRD_PERIODS) {
    if (p === 'MAX') { out[p] = { ok: true, title: '' }; continue; }
    const days = PERIOD_DAYS[p];
    const inWindow = pts.filter((x) => ms(x.d) >= last - days * DAY_MS).length;
    if (span < days * COVER_SHARE) out[p] = { ok: false, title: since || `Data starts ${monthLabel(pts[0].d)}` };
    else if (inWindow < MIN_POINTS) out[p] = { ok: false, title: `Too few readings in ${p}` };
    else out[p] = { ok: true, title: '' };
  }
  return out;
}

// The period to show: the asked one when it is on; one longer than the data covers shows
// all there is (MAX); anything else the gauge's default, or the longest on below it, or MAX.
export function pickPeriod(info, asked, fallback = '1Y') {
  const on = (p) => Boolean(info?.[p]?.ok);
  if (asked && on(asked)) return asked;
  if (asked && WEIRD_PERIODS.includes(asked) && asked !== 'MAX' && !/^Too few/.test(info?.[asked]?.title || '')) return 'MAX';
  if (on(fallback)) return fallback;
  const below = WEIRD_PERIODS.slice(0, Math.max(0, WEIRD_PERIODS.indexOf(fallback))).reverse().find(on);
  return below || 'MAX';
}

// Mean of each run of `size` readings, runs counted from the newest (so the latest point
// stays as it is). Empty readings are left out of a run's mean.
function bucket(d, cols, size) {
  if (size <= 1) return { d, cols };
  const outD = [];
  const outCols = cols.map(() => []);
  for (let end = d.length; end > 0; end -= size) {
    const start = Math.max(0, end - size);
    outD.unshift(d[end - 1]);
    cols.forEach((v, k) => {
      const vals = v.slice(start, end).filter((x) => num(x) !== null);
      outCols[k].unshift(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
    });
  }
  return { d: outD, cols: outCols };
}

// The readings inside one period, ending at the newest date, at most maxPoints per series
// (runs averaged past that; `bucket` says how many readings each point is).
export function sliceHist(hist, period = 'MAX', maxPoints = CHART_POINTS) {
  if (!hasHist(hist)) return null;
  const last = ms(hist.d[hist.d.length - 1]);
  const days = PERIOD_DAYS[period] ?? Infinity;
  const from = Number.isFinite(days) ? last - days * DAY_MS : -Infinity;
  let i0 = hist.d.findIndex((day) => ms(day) >= from);
  if (i0 < 0) i0 = hist.d.length;
  const d = hist.d.slice(i0);
  const size = Math.max(1, Math.ceil(d.length / maxPoints));
  const b = bucket(d, hist.series.map((s) => s.v.slice(i0)), size);
  const out = {
    step: hist.step,
    d: b.d,
    series: hist.series.map((s, k) => ({ key: s.key, label: s.label, ...(s.hidden ? { hidden: true } : {}), v: b.cols[k] })),
    lead: hist.lead,
    period,
    bucket: size,
  };
  if (hist.recordAt) out.recordAt = hist.recordAt;
  return out;
}

// The grid tile's spark for one period: the lead series, at most SPARK_POINTS numbers.
export function sparkFor(hist, period) {
  const s = sliceHist(hist, period, SPARK_POINTS);
  if (!s) return [];
  return (s.series.find((x) => x.key === s.lead)?.v || []).filter((v) => num(v) !== null);
}

// The lead series up to the headline's own date: what the record line reads.
export function leadPoints(hist) {
  const pts = points(hist);
  return hist?.recordAt ? pts.filter((p) => p.d <= hist.recordAt) : pts;
}

// A plain fact about the latest reading of `pts` ([{ d, v }] oldest first), or null:
//   LOWEST SINCE MAR 2021   the last reading as low or lower was in MAR 2021
//   HIGHEST SINCE MAR 2021  the same, upwards
//   RECORD LOW SINCE JAN 1985  lower than every reading since the series starts
// Only when the gap to that reading (or the whole series, for a record) is at least
// minGapDays. A tie counts as "as low": a flat series says nothing.
// -> { kind: 'low' | 'high', record, since, text, short }
export function recordLine(pts, { minGapDays = MIN_GAP_DAYS } = {}) {
  const p = (pts || []).filter((x) => x && DATE_RE.test(String(x.d)) && num(x.v) !== null);
  if (p.length < 3) return null;
  const last = p[p.length - 1];
  const lastMs = ms(last.d);
  if ((lastMs - ms(p[0].d)) / DAY_MS < minGapDays) return null;
  let lowAt = -1;
  let highAt = -1;
  for (let i = p.length - 2; i >= 0 && (lowAt < 0 || highAt < 0); i -= 1) {
    if (lowAt < 0 && p[i].v <= last.v) lowAt = i;
    if (highAt < 0 && p[i].v >= last.v) highAt = i;
  }
  const fact = (kind, at) => {
    const word = kind === 'low' ? 'LOW' : 'HIGH';
    if (at < 0) {
      return { kind, record: true, since: p[0].d, text: `RECORD ${word} SINCE ${monthLabel(p[0].d)}`, short: `RECORD ${word}` };
    }
    if ((lastMs - ms(p[at].d)) / DAY_MS < minGapDays) return null;
    const since = monthLabel(p[at].d);
    return { kind, record: false, since: p[at].d, text: `${word}EST SINCE ${since}`, short: `${word} SINCE ${since}` };
  };
  return fact('low', lowAt) || fact('high', highAt);
}

// ---- Disk ------------------------------------------------------------------------------

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value));
  renameSync(`${file}.tmp`, file);
}

// dir -> { read(id), write(id, hist, fetchedAt) }: each gauge's deep past in
// <dir>/<id>.history.json. No dir: keeps nothing.
export function historyStore(dir) {
  if (!dir) return { read: () => null, write: () => {} };
  const file = (id) => path.join(dir, `${id}.history.json`);
  return {
    read(id) {
      try {
        const j = JSON.parse(readFileSync(file(id), 'utf8'));
        return hasHist(j?.hist) && Number.isFinite(j.fetchedAt) ? j : null;
      } catch {
        return null;
      }
    },
    write(id, hist, fetchedAt) {
      try { writeJson(file(id), { fetchedAt, hist }); } catch (err) { console.error(`[weird:${id}] history not saved:`, err.message); }
    },
  };
}

// Daily readings for the gauges whose source keeps no past, one file per gauge:
// <dir>/<id>.json = { days: [['YYYY-MM-DD', { key: number }], ...] } oldest first.
// record() keeps the first reading of each UTC day and never overwrites one, so a restart
// (or many refreshes) in the same day changes nothing. The folder sits under data/.cache/,
// which git ignores, so a deploy's git pull leaves it alone. No dir: in memory only.
export function snapshotStore(dir) {
  const mem = new Map();
  const file = (id) => path.join(dir, `${id}.json`);
  function read(id) {
    if (mem.has(id)) return mem.get(id);
    let days = [];
    if (dir) {
      try {
        const j = JSON.parse(readFileSync(file(id), 'utf8'));
        days = (Array.isArray(j?.days) ? j.days : []).filter((x) => Array.isArray(x) && DATE_RE.test(String(x[0])) && x[1] && typeof x[1] === 'object');
        days.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      } catch {
        days = [];
      }
    }
    mem.set(id, days);
    return days;
  }
  return {
    read,
    has: (id, day) => read(id).some((x) => x[0] === day),
    // reading: { key: number | null }. Returns true when a new day was written.
    record(id, day, reading) {
      if (!DATE_RE.test(String(day)) || !reading) return false;
      const clean = Object.fromEntries(Object.entries(reading).filter(([, v]) => num(v) !== null));
      if (!Object.keys(clean).length) return false;
      const days = read(id);
      if (days.some((x) => x[0] === day)) return false;
      days.push([day, clean]);
      days.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      if (dir) {
        try { writeJson(file(id), { days }); } catch (err) { console.error(`[weird:${id}] reading not saved:`, err.message); }
      }
      return true;
    },
  };
}

// Recorded days -> a hist. keys: the gauge's snapshotSeries.
export function snapshotHist(days, keys) {
  if (!days?.length || !keys?.length) return null;
  return histFrom(days.map(([d, r]) => ({ d, ...r })), keys, { step: 'day', lead: keys[0].key });
}

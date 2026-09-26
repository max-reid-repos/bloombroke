// Chart math, no DOM: downsampling that keeps extremes, candle buckets, zoom windows,
// the measure label, compare rebasing, event placement, axis labels, header numbers and
// the MM/DD/YYYY date boxes. Pure functions, so node:test can check them.

import { etParts } from './intraday.js';
import { fmtSigned, fmtPct } from './markets.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NY = 'America/New_York';

// ---- Downsampling ------------------------------------------------------------------

// Indexes of the closes to draw for bars i0..i1 in at most `buckets` pixel buckets: all of
// them when they fit (two per bucket), else each bucket's lowest and highest close in the
// order they happened, plus the first and the last bar. No high or low is ever dropped.
export function lineIndexes(vals, i0, i1, buckets) {
  const n = i1 - i0 + 1;
  if (n <= 0) return [];
  if (n <= buckets * 2) return Array.from({ length: n }, (_, k) => i0 + k);
  const out = [i0];
  const size = n / buckets;
  for (let b = 0; b < buckets; b += 1) {
    const a = i0 + Math.floor(b * size);
    const z = Math.min(i1, i0 + Math.floor((b + 1) * size) - 1);
    if (z < a) continue;
    let lo = a;
    let hi = a;
    for (let i = a + 1; i <= z; i += 1) {
      if (vals[i] < vals[lo]) lo = i;
      if (vals[i] > vals[hi]) hi = i;
    }
    const pair = lo < hi ? [lo, hi] : lo > hi ? [hi, lo] : [lo];
    for (const i of pair) if (i !== out[out.length - 1]) out.push(i);
  }
  if (out[out.length - 1] !== i1) out.push(i1);
  return out;
}

// Bars i0..i1 merged k at a time so each candle has room: [{ a, b, o, h, l, c, x }].
// A merged candle opens at its first bar, closes at its last, and keeps the highest high,
// the lowest low and the summed volume.
export function candleBuckets(points, i0, i1, k = 1) {
  const out = [];
  const step = Math.max(1, Math.floor(k));
  for (let a = i0; a <= i1; a += step) {
    const b = Math.min(i1, a + step - 1);
    let h = -Infinity;
    let l = Infinity;
    let x = 0;
    for (let i = a; i <= b; i += 1) {
      const p = points[i];
      h = Math.max(h, p.h ?? p.v);
      l = Math.min(l, p.l ?? p.v);
      x += p.x || 0;
    }
    out.push({ a, b, o: points[a].o ?? points[a].v, h, l, c: points[b].v, x });
  }
  return out;
}

// ---- Zoom ----------------------------------------------------------------------------

// The window [a, b] (in bar units) zoomed by `factor` (<1 in, >1 out) around `anchor`,
// kept within [lo, hi] and at least minSpan wide.
export function zoomWindow([a, b], anchor, factor, { lo = -Infinity, hi = Infinity, minSpan = 5, maxSpan = Infinity } = {}) {
  const span = Math.min(maxSpan, Math.max(minSpan, (b - a) * factor));
  const f = b > a ? (anchor - a) / (b - a) : 0.5;
  let na = anchor - span * f;
  let nb = na + span;
  if (nb > hi) { na -= nb - hi; nb = hi; }
  if (na < lo) { nb += lo - na; na = lo; }
  return [na, Math.min(nb, hi)];
}

// The time at a bar unit u (fractional): between two bars by their times, before the first
// or after the last bar by the average bar spacing.
export function timeAt(times, u) {
  const n = times.length;
  if (!n) return NaN;
  if (n === 1) return times[0];
  const step = (times[n - 1] - times[0]) / (n - 1);
  if (u <= 0) return times[0] + u * step;
  if (u >= n - 1) return times[n - 1] + (u - (n - 1)) * step;
  const i = Math.floor(u);
  return times[i] + (u - i) * (times[i + 1] - times[i]);
}

// The bar unit of time t (inverse of timeAt).
export function unitAt(times, t) {
  const n = times.length;
  if (n < 2) return 0;
  const step = (times[n - 1] - times[0]) / (n - 1) || 1;
  if (t <= times[0]) return (t - times[0]) / step;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / step;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  const d = times[hi] - times[lo];
  return lo + (d ? (t - times[lo]) / d : 0);
}

// ---- Measure -------------------------------------------------------------------------

// "43 days" for daily bars and longer; "2h 15m", "45m" or "2d 4h" for intraday bars.
export function durationText(ms, intraday) {
  const abs = Math.abs(ms);
  if (!intraday) {
    const d = Math.max(0, Math.round(abs / DAY));
    return `${d} ${d === 1 ? 'day' : 'days'}`;
  }
  const mins = Math.round(abs / MIN);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

// From bar A to bar B (A earlier): { pct, abs, dir, text: '+12.34%  +38.12  43 days' }.
// Yields (bp): the change in basis points instead of a percent.
export function measure(a, b, { decimals = 2, intraday = false, bp = false } = {}) {
  const [p, q] = a.t <= b.t ? [a, b] : [b, a];
  const abs = q.v - p.v;
  const pct = p.v ? (abs / p.v) * 100 : 0;
  const dir = abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat';
  const when = durationText(q.t - p.t, intraday);
  const text = bp ? `${fmtSigned(abs * 100, 1)} bp  ${when}` : `${fmtPct(pct)}  ${fmtSigned(abs, decimals)}  ${when}`;
  return { pct, abs, dir, text };
}

// ---- Compare -------------------------------------------------------------------------

// Another series' closes at the main series' times: the last close at or before each
// time (null before its first bar).
export function alignAsOf(times, other) {
  const out = new Array(times.length).fill(null);
  let j = -1;
  for (let i = 0; i < times.length; i += 1) {
    while (j + 1 < other.length && other[j + 1].t <= times[i]) j += 1;
    out[i] = j >= 0 ? other[j].v : null;
  }
  return out;
}

// Where compare lines start: the first bar in i0..i1 where every series has a value (a
// stock from 04:00 against an index from 09:30 starts at 09:30), else i0.
export function commonStart(series, i0, i1) {
  for (let i = i0; i <= i1; i += 1) if (series.every((s) => Number.isFinite(s[i]))) return i;
  return i0;
}

// Values -> percent change from the value at index `base` (the window's first bar).
// A series with no value at the base starts at its first value after it.
export function rebase(vals, base) {
  let b = base;
  while (b < vals.length && !(Number.isFinite(vals[b]) && vals[b] !== 0)) b += 1;
  if (b >= vals.length) return vals.map(() => null);
  const ref = vals[b];
  return vals.map((v, i) => (i < b || !Number.isFinite(v) ? null : ((v - ref) / ref) * 100));
}

// ---- Events --------------------------------------------------------------------------

// Event days -> the bar each belongs to, inside bars i0..i1. days: the New York day
// ("2026-09-25") of each bar.
//   Daily bars: the bar of that day, or the next trading day's (a dividend dated on a
//   weekend or holiday), within a week.
//   Intraday bars: the first bar of that day, only if the day has bars.
//   Weekly and monthly bars: the bar whose period holds the day.
// Returns the events that land, each with its bar index i.
export function placeEvents(events, days, i0, i1, { bar = '1D' } = {}) {
  const out = [];
  if (!days.length || i1 < i0) return out;
  const period = bar === '1W' || bar === '1MO';
  const intraday = /^\d+[MH]$/.test(bar);
  const span = bar === '1MO' ? 31 : 7;
  const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);
  // First bar in i0..i1 with day >= d (i1 + 1 when there is none).
  const firstOnOrAfter = (d) => {
    let lo = i0;
    let hi = i1 + 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (days[mid] < d) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  for (const ev of events) {
    const d = ev.date;
    if (!d || d < days[i0]) continue;
    const j = firstOnOrAfter(d);
    let i;
    if (period) {
      i = j <= i1 && days[j] === d ? j : j - 1;
      if (i < i0 || (dayMs(d) - dayMs(days[i])) / DAY >= span) continue;
    } else {
      if (j > i1) continue;
      if (intraday && days[j] !== d) continue;
      if ((dayMs(days[j]) - dayMs(d)) / DAY > 6) continue;
      i = j;
    }
    out.push({ ...ev, i });
  }
  return out;
}

// ---- Axis labels ---------------------------------------------------------------------

// Where the time axis gets a label: the first bar of each year, quarter, month, week, day
// or clock step, at the finest level that keeps about minGap pixels between labels.
// info: per-bar New York parts [{ day: '2026-09-25', mins }]. pxPerBar: pixels per bar.
// Returns [{ i, text, strong }] (strong: a new day on intraday bars, a new year otherwise).
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const LEVELS = [
  { key: (p) => p.day.slice(0, 4), text: (p) => p.day.slice(0, 4) },
  { key: (p) => `${p.day.slice(0, 4)}Q${Math.floor((Number(p.day.slice(5, 7)) - 1) / 3)}`, text: (p) => MON[Number(p.day.slice(5, 7)) - 1] },
  { key: (p) => p.day.slice(0, 7), text: (p) => MON[Number(p.day.slice(5, 7)) - 1] },
  { key: (p) => weekKey(p.day), text: (p) => `${MON[Number(p.day.slice(5, 7)) - 1]} ${Number(p.day.slice(8, 10))}` },
  { key: (p) => p.day, text: (p) => `${MON[Number(p.day.slice(5, 7)) - 1]} ${Number(p.day.slice(8, 10))}` },
  // Clock steps: the label says the round time the bar starts the step at (06:00, not 06:01).
  ...[240, 120, 60, 30, 15, 5].map((step) => ({ step, key: (p) => `${p.day}:${Math.floor(p.mins / step)}`, text: (p) => clock(Math.floor(p.mins / step) * step) })),
];
function weekKey(day) {
  const t = Date.parse(`${day}T12:00:00Z`);
  return Math.floor((t / DAY + 3) / 7); // weeks start on Monday
}
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function axisLabels(info, i0, i1, pxPerBar, { minGap = 72, intraday = false } = {}) {
  const a = Math.max(0, Math.ceil(i0));
  const b = Math.min(info.length - 1, Math.floor(i1));
  if (b < a) return [];
  let best = null;
  for (const lv of LEVELS) {
    if (!intraday && lv.step) break;
    const marks = [];
    let prev = a > 0 ? lv.key(info[a - 1]) : null;
    for (let i = a; i <= b; i += 1) {
      const k = lv.key(info[i]);
      if (k !== prev) marks.push(i);
      prev = k;
    }
    // The window's own first bar may start a period a few bars before the next one: that
    // label gives way, the level does not fail on it.
    if (marks.length >= 2 && (marks[1] - marks[0]) * pxPerBar < minGap) marks.shift();
    let tight = false;
    for (let m = 1; m < marks.length; m += 1) if ((marks[m] - marks[m - 1]) * pxPerBar < minGap) { tight = true; break; }
    if (tight) break;
    best = { lv, marks };
  }
  if (!best) return [];
  const out = [];
  let lastX = -Infinity;
  for (const i of best.marks) {
    if ((i - i0) * pxPerBar - lastX < minGap) continue;
    lastX = (i - i0) * pxPerBar;
    const p = info[i];
    const prev = i > 0 ? info[i - 1] : null;
    const newDay = Boolean(prev) && prev.day !== p.day;
    const newYear = Boolean(prev) && prev.day.slice(0, 4) !== p.day.slice(0, 4);
    let text = best.lv.text(p);
    let strong = false;
    if (best.lv.step && newDay) { text = `${MON[Number(p.day.slice(5, 7)) - 1]} ${Number(p.day.slice(8, 10))}`; strong = true; }
    else if (!best.lv.step && newYear && best.lv !== LEVELS[0]) { text = p.day.slice(0, 4); strong = true; }
    else if (best.lv === LEVELS[0]) strong = true;
    out.push({ i, text, strong });
  }
  return out;
}

// Per-bar New York parts, computed once per load: [{ day, mins, session }]. A bar is
// pre-market when it ends by 09:30 (a 1h bar from 09:00 holds the open, so it is in the
// session) and after hours from 16:00 on (the 16:00 bar holds only prints after the bell).
export function barInfo(points, barMins = 1) {
  return points.map((p) => {
    const e = etParts(p.t);
    const session = e.mins + barMins <= 570 ? 'pre' : e.mins >= 960 ? 'post' : 'regular';
    return { day: e.day, mins: e.mins, session, weekday: e.weekday };
  });
}

// ---- Header numbers ------------------------------------------------------------------

// The strip over the chart for bars i0..i1: last, change from base, the high and low (bar
// highs and lows when the source sent them, else closes) with their bars, the average close
// and the total volume (null when the source sends none).
export function headerStats(points, i0, i1, base = null) {
  const a = Math.max(0, i0);
  const b = Math.min(points.length - 1, i1);
  if (b < a) return null;
  let hi = a;
  let lo = a;
  let hiV = -Infinity;
  let loV = Infinity;
  let sum = 0;
  let bars = 0;
  let vol = 0;
  let hasVol = false;
  for (let i = a; i <= b; i += 1) {
    const p = points[i];
    const h = p.live ? p.v : (p.h ?? p.v);
    const l = p.live ? p.v : (p.l ?? p.v);
    if (h > hiV) { hiV = h; hi = i; }
    if (l < loV) { loV = l; lo = i; }
    if (!p.live) { sum += p.v; bars += 1; }
    if (p.x) { vol += p.x; hasVol = true; }
  }
  const last = points[b].v;
  const from = Number.isFinite(base) && base ? base : points[a].v;
  const chg = last - from;
  return {
    last, base: from, chg, pct: from ? (chg / from) * 100 : 0,
    high: hiV, highI: hi, low: loV, lowI: lo,
    avg: bars ? sum / bars : last, vol: hasVol ? vol : null,
  };
}

// 12300000000 -> "12.3B".
export function fmtVol(n) {
  if (!Number.isFinite(n)) return '--';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e11 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e8 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  return String(Math.round(n));
}

// When a bar happened, as the strip says it: "SEP 25" this year, "OCT 10 '25" before,
// "10:42" on a one-day intraday chart, "THU 10:42" over a few days, "SEP 12 10:42" longer.
export function whenText(t, { intraday = false, spanMs = 0, nowYear = new Date().getFullYear() } = {}) {
  const e = etParts(t);
  const md = `${MON[Number(e.day.slice(5, 7)) - 1]} ${Number(e.day.slice(8, 10))}`;
  if (intraday) {
    if (spanMs <= 1.2 * DAY) return e.hm;
    if (spanMs <= 8 * DAY) return `${e.weekday} ${e.hm}`;
    return `${md} ${e.hm}`;
  }
  const y = Number(e.day.slice(0, 4));
  return y === nowYear ? md : `${md} '${e.day.slice(2, 4)}`;
}

// ---- Date boxes ----------------------------------------------------------------------

// ms -> "09/25/2026" in New York, or "09/25/26" when short (a narrow chart bar).
export function fmtDateBox(t, short = false) {
  const d = new Intl.DateTimeFormat('en-US', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  return short ? `${d.slice(0, 6)}${d.slice(8)}` : d;
}

// "9/25/2026", "09/25/2026", "09/25/26" (also "-" or "." between) -> "2026-09-25", or
// null. A two-digit year is this century unless that lands after this year: 80 is 1980.
export function parseDateBox(s, nowYear = new Date().getUTCFullYear()) {
  const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\s*$/.exec(String(s ?? ''));
  if (!m) return null;
  let y = Number(m[3]);
  if (m[3].length === 2) y = 2000 + y > nowYear ? 1900 + y : 2000 + y;
  const [mo, d] = [Number(m[1]), Number(m[2])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || y < 1900) return null;
  return date.toISOString().slice(0, 10);
}

// The FROM and TO the command gets for a zoomed window [t0, t1]: New York days, TO left
// out when the window runs to today, and never the same day as FROM.
export function windowDays(t0, t1, today) {
  const day = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  const from = day(Math.min(t0, Date.parse(`${today}T12:00:00Z`)));
  let to = day(t1);
  if (to >= today) to = null;
  else if (to <= from) {
    const next = new Date(Date.parse(`${from}T12:00:00Z`) + DAY).toISOString().slice(0, 10);
    to = next >= today ? null : next;
  }
  return { from, to };
}

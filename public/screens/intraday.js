// Intraday charts (1D and 5D): when things happened. New York time for every bar,
// the regular session and its shading, the day high and low, the biggest 5-minute
// move, and a label placer that drops the least important label first.
// Pure functions, so node:test can check them.

const NY = 'America/New_York';
const MIN = 60_000;
export const OPEN_MIN = 9 * 60 + 30;
export const CLOSE_MIN = 16 * 60;

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: NY, hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

// ms -> { day: '2026-09-25', weekday: 'FRI', date: 25, mins: 570, hm: '09:30' } in New York.
export function etParts(t) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(t))) p[type] = value;
  const hour = Number(p.hour) % 24;
  const minute = Number(p.minute);
  return {
    day: `${p.year}-${p.month}-${p.day}`,
    weekday: String(p.weekday).toUpperCase(),
    date: Number(p.day),
    mins: hour * 60 + minute,
    hm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

// 'pre' before 09:30, 'post' after 16:00, else 'regular'. The 16:00 bar is the close.
export function sessionOf(mins) {
  if (mins < OPEN_MIN) return 'pre';
  if (mins > CLOSE_MIN) return 'post';
  return 'regular';
}

// "10:42" on 1D, "THU 10:42" on 5D.
export function whenLabel(t, multiDay) {
  const p = etParts(t);
  return multiDay ? `${p.weekday} ${p.hm}` : p.hm;
}

const FIVE_MIN_GAP = 5.5 * MIN;

// Day high and low (first time reached) and the biggest move between two neighbouring
// 5-minute bars of the same New York day. A live point counts for the high and low,
// never for the move (it is not a 5-minute bar).
export function intradayStats(points, { bar = '5M' } = {}) {
  if (!Array.isArray(points) || points.length < 2) return { high: null, low: null, move: null };
  let hi = 0;
  let lo = 0;
  points.forEach((p, i) => {
    if (p.v > points[hi].v) hi = i;
    if (p.v < points[lo].v) lo = i;
  });
  let move = null;
  if (bar === '5M') {
    let dayPrev = etParts(points[0].t).day;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const day = etParts(b.t).day;
      const sameDay = day === dayPrev;
      dayPrev = day;
      if (a.live || b.live || !sameDay || b.t - a.t > FIVE_MIN_GAP || !(a.v > 0)) continue;
      const pct = ((b.v - a.v) / a.v) * 100;
      if (!move || Math.abs(pct) > Math.abs(move.pct)) move = { i, pct, t: b.t, from: a.v, to: b.v };
    }
    if (move && move.pct === 0) move = null;
  }
  const pick = (i) => ({ i, v: points[i].v, t: points[i].t });
  return { high: pick(hi), low: pick(lo), move };
}

// The x domain of a 1D chart. A US session day that sits inside 09:30 to 16:00 gets
// the whole session, so the empty space to the right says how much of the day is left.
// Anything else (futures, overnight bars, several days) runs first bar to last bar.
export function sessionDomain(points) {
  const first = points[0].t;
  const last = points[points.length - 1].t;
  const p0 = etParts(first);
  const regular = points.every((p) => {
    const e = etParts(p.t);
    return e.day === p0.day && sessionOf(e.mins) === 'regular';
  });
  if (!regular) return [first, last];
  const base = first - (first % MIN);
  const start = base - (p0.mins - OPEN_MIN) * MIN;
  const end = start + (CLOSE_MIN - OPEN_MIN) * MIN;
  return [Math.min(first, start), Math.max(last, end)];
}

// Clock ticks between t0 and t1 on round New York times (09:30, 10:00 ...), as sparse
// as needed to keep `minGap` pixels between labels.
export function timeTicks(t0, t1, width, { minGap = 64 } = {}) {
  if (!(t1 > t0) || !(width > 0)) return [];
  const steps = [15, 30, 60, 120, 180, 240, 360, 720];
  const span = t1 - t0;
  const step = steps.find((s) => (width * s * MIN) / span >= minGap) || 1440;
  const base = t0 - (t0 % MIN);
  const mins = etParts(base).mins;
  const firstMin = Math.ceil(mins / step) * step;
  const out = [];
  for (let m = firstMin; ; m += step) {
    const t = base + (m - mins) * MIN;
    if (t > t1) break;
    if (t >= t0) out.push({ t, label: etParts(t).hm });
  }
  return out;
}

// The first bar of each New York day: [{ i, label: 'MON 21' }].
export function dayStarts(points) {
  const out = [];
  let prev = '';
  points.forEach((p, i) => {
    const e = etParts(p.t);
    if (e.day !== prev) out.push({ i, label: `${e.weekday} ${e.date}`, day: e.day });
    prev = e.day;
  });
  return out;
}

// Runs of bars outside the regular session: [{ i0, i1, kind: 'pre' | 'post' }].
export function sessionRuns(points) {
  const out = [];
  points.forEach((p, i) => {
    const kind = sessionOf(etParts(p.t).mins);
    if (kind === 'regular') return;
    const last = out[out.length - 1];
    if (last && last.i1 === i - 1 && last.kind === kind) last.i1 = i;
    else out.push({ i0: i, i1: i, kind });
  });
  return out;
}

// Previous close and today's open from a quote, only when the quote is about the same
// New York day as the last bar (so a 1D chart of Friday never gets Monday's numbers).
// A 5D chart without a matching quote still gets the previous close from its bars.
export function sessionRefs(points, quote, { multiDay = false } = {}) {
  const lastDay = points.length ? etParts(points[points.length - 1].t).day : '';
  const qt = Date.parse(quote?.asOf || '');
  if (quote && Number.isFinite(qt) && etParts(qt).day === lastDay) {
    const ok = (v) => (Number.isFinite(v) && v > 0 ? v : null);
    return { prevClose: ok(quote.prevClose), open: ok(quote.open) };
  }
  if (multiDay) {
    const days = dayStarts(points);
    if (days.length >= 2) {
      const lastStart = days[days.length - 1].i;
      return { prevClose: points[lastStart - 1].v, open: null };
    }
  }
  return { prevClose: null, open: null };
}

// Grow the value range to take in reference lines, but never more than double it:
// a stock that gapped 10% keeps a readable chart, and the header still says the number.
export function withRefs(lo, hi, refs) {
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  let a = lo;
  let b = hi;
  const shown = [];
  for (const v of refs) {
    if (!Number.isFinite(v)) { shown.push(false); continue; }
    const na = Math.min(a, v);
    const nb = Math.max(b, v);
    if (nb - na <= span * 2) { a = na; b = nb; shown.push(true); } else shown.push(false);
  }
  return { lo: a, hi: b, shown };
}

// ---- Label placement ------------------------------------------------------------
// items: [{ key, text, x, y, prio, sides, xs?, w?, h? }] where (x, y) is the point the
// label belongs to. Sides are tried in order: 'above', 'below', 'left', 'right', and for a
// line label at the right edge 'above-end' and 'below-end'. Lower prio places first;
// a label that fits nowhere is dropped, so the least important goes first.
// Returns [{ key, text, tx, ty, box }] with tx the centre and ty the text baseline.
export const CHAR_W = 6.1;
export const LABEL_H = 14;
const GAP = 6;
const PAD = 4;

export function labelWidth(text) {
  return Math.ceil(String(text).length * CHAR_W + PAD * 2);
}

export function boxFor(item, side) {
  const w = item.w ?? labelWidth(item.text);
  const h = item.h ?? LABEL_H;
  let x0;
  let y0;
  if (side === 'above' || side === 'below') {
    x0 = item.x - w / 2;
    y0 = side === 'above' ? item.y - GAP - h : item.y + GAP;
  } else if (side === 'above-end' || side === 'below-end') {
    x0 = item.x - w;
    y0 = side === 'above-end' ? item.y - 2 - h : item.y + 2;
  } else {
    x0 = side === 'left' ? item.x - GAP - w : item.x + GAP;
    y0 = item.y - h / 2;
  }
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

export function overlaps(a, b) {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export function placeLabels(items, { width, top = 0, bottom, obstacles = [] }) {
  const taken = [...obstacles];
  const out = [];
  const order = [...items].sort((a, b) => a.prio - b.prio);
  for (const item of order) {
    // xs: other x positions to try, in order, after the item's own (a line label can slide left).
    const tries = [item.x, ...(item.xs || [])].flatMap((x) => (item.sides || ['above', 'below']).map((side) => ({ x, side })));
    for (const { x, side } of tries) {
      const b = boxFor({ ...item, x }, side);
      // Slide sideways into the chart, never off it.
      if (b.x0 < 0) { b.x1 -= b.x0; b.x0 = 0; }
      if (b.x1 > width) { b.x0 -= b.x1 - width; b.x1 = width; }
      if (b.x0 < 0 || b.y0 < top || (bottom !== undefined && b.y1 > bottom)) continue;
      if (taken.some((t) => overlaps(t, b))) continue;
      taken.push(b);
      out.push({ key: item.key, text: item.text, tx: (b.x0 + b.x1) / 2, ty: b.y1 - 4, box: b, side });
      break;
    }
  }
  return out;
}

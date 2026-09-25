// Charts: the SVG line chart (used by every screen) and the range chart component
// (presets, FROM/TO dates, crosshair with change vs the range start) used by the
// instrument screen, HOME, RATES and 420. 1D and 5D charts also show when things
// happened: a New York clock axis, session shading, the previous close and today's
// open, and the high, low and biggest 5-minute move with their times.

import { esc, q, fmtNum, fmtSigned, fmtPct, dirOf, LOADING } from './markets.js';
import { PRESETS, chartQuery, rangeWords, rangeLabel, nyToday, FIRST_DAY } from '../ranges.js';
import { instrumentById } from '../instruments.js';
import {
  intradayStats, sessionDomain, timeTicks, dayStarts, sessionRuns, sessionRefs, withRefs,
  placeLabels, labelWidth, whenLabel,
} from './intraday.js';

// ---- Line chart --------------------------------------------------------------

// Round steps (1, 2, 2.5, 5 x 10^n) that land on readable numbers.
export function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { const pad = Math.abs(min) * 0.01 || 1; min -= pad; max += pad; }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

let chartSeq = 0;

const PAD_R = 64;
const PAD_T = 8;
const PAD_B = 20;

// Scales shared by the SVG and the crosshair. timeDomain [t0, t1] places points by
// time (a 1D session), otherwise by index (nights and weekends close up).
// refs: extra values (previous close, open) the value range may grow to take in.
export function chartGeom(points, { width = 640, height = 240, timeDomain = null, refs = [] } = {}) {
  const W = Math.max(40, width - PAD_R);
  const H = Math.max(40, height - PAD_T - PAD_B);
  const vals = points.map((p) => p.v);
  const r = withRefs(Math.min(...vals), Math.max(...vals), refs);
  const span = r.hi - r.lo || Math.abs(r.hi) * 0.01 || 1;
  const min = r.lo - span * 0.06;
  const max = r.hi + span * 0.06;
  const n = points.length;
  const byTime = Array.isArray(timeDomain) && timeDomain[1] > timeDomain[0];
  const xs = byTime
    ? points.map((p) => ((p.t - timeDomain[0]) / (timeDomain[1] - timeDomain[0])) * W)
    : points.map((_, i) => (i / (n - 1)) * W);
  const y = (v) => PAD_T + (1 - (v - min) / (max - min)) * H;
  return { W, H, min, max, xs, y, n, timeDomain: byTime ? timeDomain : null, refShown: r.shown };
}

// The index of the point nearest to pixel x (xs ascending).
export function nearestIndex(xs, px) {
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= px) lo = mid; else hi = mid;
  }
  return Math.abs(xs[hi] - px) < Math.abs(px - xs[lo]) ? hi : lo;
}

const refValues = (intraday) => (intraday ? [intraday.refs?.prevClose, intraday.refs?.open] : []);
const f1 = (n) => n.toFixed(1);

// points: [{ t, v }] oldest first. Returns an SVG string sized in pixels.
// intraday (1D and 5D): { refs: { prevClose, open }, timeDomain, multiDay, bar, shade, bp }
// adds the clock axis, session shading, reference lines and the high, low and move markers.
export function chartSvg(points, { width = 640, height = 240, fmtY = (v) => fmtNum(v, 2), fmtX = String, label = 'Price chart', intraday = null } = {}) {
  if (!points || points.length < 2) return '';
  const g = chartGeom(points, { width, height, timeDomain: intraday?.timeDomain, refs: refValues(intraday) });
  const { W, H, xs, y, n } = g;
  const padT = PAD_T;
  const padR = PAD_R;
  const vals = points.map((p) => p.v);
  const id = `ch${++chartSeq}`;

  const lastY = y(vals[n - 1]);
  const ticks = niceTicks(g.min, g.max, Math.max(2, Math.round(H / 48)));
  const grid = ticks.map((t) => {
    const ty = y(t).toFixed(1);
    // The last-value tag covers any label right next to it.
    const lab = Math.abs(Number(ty) - lastY) < 14 ? '' : `<text class="ch-ylab" x="${W + 6}" y="${(Number(ty) + 4).toFixed(1)}">${esc(fmtY(t))}</text>`;
    return `<line class="ch-grid" x1="0" x2="${W}" y1="${ty}" y2="${ty}"/>${lab}`;
  }).join('');

  let xlabs;
  let under = '';
  let over = '';
  if (intraday) {
    ({ xlabs, under, over } = intradayLayers(points, g, { ...intraday, fmtY, height }));
  } else {
    const xCount = Math.max(2, Math.min(6, Math.floor(W / 110)));
    const xIdx = [...new Set(Array.from({ length: xCount }, (_, k) => Math.round((k * (n - 1)) / (xCount - 1))))];
    xlabs = xIdx.map((i, k) => {
      const anchor = k === 0 ? 'start' : k === xIdx.length - 1 ? 'end' : 'middle';
      const gx = xs[i].toFixed(1);
      return `<line class="ch-vgrid" x1="${gx}" x2="${gx}" y1="${padT}" y2="${padT + H}"/><text class="ch-xlab" x="${gx}" y="${height - 5}" text-anchor="${anchor}">${esc(fmtX(points[i].t))}</text>`;
    }).join('');
  }

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${xs[n - 1].toFixed(1)},${padT + H}L${xs[0].toFixed(1)},${padT + H}Z`;
  const last = vals[n - 1];
  const ly = lastY;
  const tags = intraday
    ? `<line class="ch-cross ch-hcross" x1="0" x2="${W}" y1="0" y2="0" visibility="hidden"/>
    <g class="ch-ytag" visibility="hidden"><rect class="ch-tag-bg" x="${W}" y="0" width="${padR}" height="16"/><text class="ch-tag" x="${W + 6}" y="0"></text></g>
    <g class="ch-xtag" visibility="hidden"><rect class="ch-tag-bg" x="0" y="${padT + H + 1}" width="0" height="16"/><text class="ch-tag" x="0" y="${padT + H + 13}" text-anchor="middle"></text></g>`
    : '';

  return `<svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" data-w="${W}" data-n="${n}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop class="ch-stop" offset="0" stop-opacity=".18"/><stop class="ch-stop" offset="1" stop-opacity="0"/></linearGradient></defs>
    ${under}${grid}${xlabs}
    <line class="ch-axis" x1="${W}" x2="${W}" y1="${padT}" y2="${padT + H}"/>
    <line class="ch-axis" x1="0" x2="${W}" y1="${padT + H}" y2="${padT + H}"/>
    <path d="${area}" fill="url(#${id})"/>
    <path class="ch-line" d="${line}"/>
    <line class="ch-last-line" x1="0" x2="${W}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}"/>
    ${over}
    <rect class="ch-last-bg" x="${W}" y="${(ly - 8).toFixed(1)}" width="${padR}" height="16"/>
    <text class="ch-last" x="${W + 6}" y="${(ly + 4).toFixed(1)}">${esc(fmtY(last))}</text>
    <line class="ch-cross" x1="0" x2="0" y1="${padT}" y2="${padT + H}" visibility="hidden"/>
    ${tags}
    <circle class="ch-dot" r="3" cx="0" cy="0" visibility="hidden"/>
  </svg>`;
}

// The intraday layers: clock or day axis, shading, reference lines, markers, labels.
function intradayLayers(points, g, { refs = {}, multiDay = false, bar = '5M', shade = true, bp = false, fmtY, height }) {
  const { W, H, xs, y, n } = g;
  const top = PAD_T;
  const bottom = PAD_T + H;
  const obstacles = [];
  let xlabs = '';
  let under = '';

  // Axis: New York clock times on one day, day names on several.
  if (g.timeDomain) {
    const [d0, d1] = g.timeDomain;
    xlabs = timeTicks(d0, d1, W).map(({ t, label }) => {
      const x = ((t - d0) / (d1 - d0)) * W;
      const anchor = x < 18 ? 'start' : x > W - 18 ? 'end' : 'middle';
      return `<line class="ch-vgrid" x1="${f1(x)}" x2="${f1(x)}" y1="${top}" y2="${bottom}"/><text class="ch-xlab" x="${f1(x)}" y="${height - 5}" text-anchor="${anchor}">${label}</text>`;
    }).join('');
  } else {
    let lastX = -Infinity;
    xlabs = dayStarts(points).map(({ i, label }) => {
      const x = i > 0 ? (xs[i - 1] + xs[i]) / 2 : 0;
      const sep = i > 0 ? `<line class="ch-day" x1="${f1(x)}" x2="${f1(x)}" y1="${top}" y2="${bottom}"/>` : '';
      if (x - lastX < 52 || x > W - 44) return sep;
      lastX = x;
      return `${sep}<text class="ch-xlab" x="${f1(x + 4)}" y="${height - 5}">${label}</text>`;
    }).join('');
  }

  // Pre-market and after-hours bars, when there are any.
  if (shade) {
    for (const r of sessionRuns(points)) {
      const x0 = r.i0 > 0 ? (xs[r.i0 - 1] + xs[r.i0]) / 2 : xs[r.i0];
      const x1 = r.i1 < n - 1 ? (xs[r.i1] + xs[r.i1 + 1]) / 2 : xs[r.i1];
      under += `<rect class="ch-ext" x="${f1(x0)}" y="${top}" width="${f1(Math.max(1, x1 - x0))}" height="${H}"/>`;
      const text = r.kind === 'pre' ? 'PRE-MARKET' : 'AFTER HOURS';
      if (x1 - x0 >= labelWidth(text)) {
        under += `<text class="ch-ext-lab" x="${f1(x0 + 4)}" y="${top + 11}">${text}</text>`;
        obstacles.push({ x0, y0: top, x1: x0 + labelWidth(text), y1: top + 14 });
      }
    }
  }

  // Reference lines: previous close (dashed) and today's open (dotted).
  let over = '';
  const items = [];
  const refDefs = [
    { key: 'prev', v: refs.prevClose, cls: 'ch-ref-prev', name: 'PREV CLOSE', prio: 3 },
    { key: 'open', v: refs.open, cls: 'ch-ref-open', name: 'OPEN', prio: 4 },
  ];
  refDefs.forEach((r, k) => {
    if (!Number.isFinite(r.v) || !g.refShown[k]) return;
    const ry = y(r.v);
    over += `<line class="ch-ref ${r.cls}" x1="0" x2="${W}" y1="${f1(ry)}" y2="${f1(ry)}"/>`;
    // Right edge first; when the other line's label is there, one label width further left.
    const text = `${r.name} ${fmtY(r.v)}`;
    const other = refDefs[1 - k];
    const slide = labelWidth(`${other.name} ${Number.isFinite(other.v) ? fmtY(other.v) : ''}`) + 8;
    items.push({ key: r.key, text, x: W - 2, xs: [W - 2 - slide], y: ry, prio: r.prio, sides: ['above-end', 'below-end'], cls: r.cls });
  });

  // Markers: high, low and the biggest 5-minute move, each with its time.
  const st = intradayStats(points, { bar });
  const when = (t) => whenLabel(t, multiDay);
  const dots = [];
  if (st.high) {
    dots.push({ x: xs[st.high.i], y: y(st.high.v), cls: 'ch-mk-high' });
    items.push({ key: 'high', text: `HIGH ${fmtY(st.high.v)} · ${when(st.high.t)}`, x: xs[st.high.i], y: y(st.high.v), prio: 1, sides: ['above', 'right', 'left', 'below'] });
  }
  if (st.low && st.low.i !== st.high?.i) {
    dots.push({ x: xs[st.low.i], y: y(st.low.v), cls: 'ch-mk-low' });
    items.push({ key: 'low', text: `LOW ${fmtY(st.low.v)} · ${when(st.low.t)}`, x: xs[st.low.i], y: y(st.low.v), prio: 2, sides: ['below', 'right', 'left', 'above'] });
  }
  if (st.move) {
    const { i, pct, from, to } = st.move;
    const dir = pct > 0 ? 'up' : 'down';
    const mx = xs[i];
    const my = y(to);
    over += `<path class="ch-move ${dir}" d="M${f1(xs[i - 1])},${f1(y(from))}L${f1(mx)},${f1(my)}"><title>Biggest 5-minute move</title></path>`;
    dots.push({ x: mx, y: my, cls: `ch-mk-move ${dir}` });
    const size = bp ? `${fmtSigned((to - from) * 100, 1)} bp` : fmtPct(pct);
    items.push({ key: 'move', text: `${size} · ${when(st.move.t)}`, x: mx, y: my, prio: 5, sides: pct > 0 ? ['above', 'below', 'right', 'left'] : ['below', 'above', 'right', 'left'], dir });
  }
  for (const d of dots) obstacles.push({ x0: d.x - 3, y0: d.y - 3, x1: d.x + 3, y1: d.y + 3 });
  const placed = placeLabels(items, { width: W, top, bottom, obstacles });
  const byKey = Object.fromEntries(items.map((it) => [it.key, it]));
  for (const p of placed) {
    const it = byKey[p.key];
    const b = p.box;
    const cls = it.cls ? `${it.cls}-lab` : it.dir ? `ch-mk-lab ${it.dir}` : 'ch-mk-lab';
    over += `<rect class="ch-lab-bg" x="${f1(b.x0)}" y="${f1(b.y0)}" width="${f1(b.x1 - b.x0)}" height="${f1(b.y1 - b.y0)}"/><text class="ch-lab ${cls}" x="${f1(p.tx)}" y="${f1(p.ty)}" text-anchor="middle">${esc(p.text)}</text>`;
  }
  over += dots.map((d) => `<circle class="ch-mk ${d.cls}" r="3" cx="${f1(d.x)}" cy="${f1(d.y)}"/>`).join('');
  return { xlabs, under, over };
}

// Draw a chart that fills `host`, redraw on resize, report the hovered point.
export function mountChart(host, points, opts = {}) {
  let lastKey = '';
  function draw() {
    const w = Math.floor(host.clientWidth);
    const h = Math.floor(host.clientHeight) || opts.height || 240;
    if (!w || `${w}x${h}` === lastKey) return;
    lastKey = `${w}x${h}`;
    host.innerHTML = chartSvg(points, { ...opts, width: w, height: h });
    const svg = host.querySelector('svg');
    if (!svg) return;
    const g = chartGeom(points, { width: w, height: h, timeDomain: opts.intraday?.timeDomain, refs: refValues(opts.intraday) });
    const { W, xs } = g;
    const cross = svg.querySelector('.ch-cross:not(.ch-hcross)');
    const hcross = svg.querySelector('.ch-hcross');
    const ytag = svg.querySelector('.ch-ytag');
    const xtag = svg.querySelector('.ch-xtag');
    const dot = svg.querySelector('.ch-dot');
    const fmtY = opts.fmtY || ((v) => fmtNum(v, 2));
    const set = (el, attrs) => { for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); };
    const onMove = (e) => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      if (px < 0 || px > W) return;
      const i = nearestIndex(xs, px);
      const cx = xs[i];
      const cy = g.y(points[i].v);
      set(cross, { x1: cx, x2: cx, visibility: 'visible' });
      set(dot, { cx, cy, visibility: 'visible' });
      if (hcross) {
        // The crosshair's price on the right axis and its New York time on the time axis.
        set(hcross, { y1: cy, y2: cy, visibility: 'visible' });
        ytag.querySelector('rect').setAttribute('y', (cy - 8).toFixed(1));
        const yt = ytag.querySelector('text');
        yt.setAttribute('y', (cy + 4).toFixed(1));
        yt.textContent = fmtY(points[i].v);
        ytag.setAttribute('visibility', 'visible');
        const text = points[i].live ? 'NOW' : whenLabel(points[i].t, opts.intraday.multiDay);
        const tw = labelWidth(text) + 4;
        const tx = Math.max(tw / 2, Math.min(W - tw / 2, cx));
        set(xtag.querySelector('rect'), { x: (tx - tw / 2).toFixed(1), width: tw });
        const xt = xtag.querySelector('text');
        xt.setAttribute('x', tx.toFixed(1));
        xt.textContent = text;
        xtag.setAttribute('visibility', 'visible');
      }
      opts.onHover?.(points[i], i);
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerdown', onMove);
    svg.addEventListener('pointerleave', () => {
      for (const el of [cross, dot, hcross, ytag, xtag]) el?.setAttribute('visibility', 'hidden');
      opts.onHover?.(null);
    });
  }
  draw();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
  ro?.observe(host);
  return () => ro?.disconnect();
}

// X axis formats per range.
const NY = 'America/New_York';
export function fmtXFor(range) {
  const opts = {
    '1D': { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
    '1M': { month: 'short', day: 'numeric' },
    '6M': { month: 'short', day: 'numeric' },
    '1Y': { month: 'short', year: '2-digit' },
    '5Y': { year: 'numeric' },
  }[range] || { month: 'short', day: 'numeric' };
  return (t) => new Date(t).toLocaleString('en-US', { timeZone: NY, ...opts }).toUpperCase();
}
export function fmtHoverFor(range) {
  const opts = range === '1D'
    ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return (t) => new Date(t).toLocaleString('en-US', { timeZone: NY, ...opts }).toUpperCase();
}

// X axis and hover formats from the time span the chart covers.
export function fmtXForSpan(spanMs) {
  const day = 86_400_000;
  const fmt = (t, opts) => new Date(t).toLocaleString('en-US', { timeZone: NY, ...opts }).toUpperCase();
  if (spanMs <= 1.5 * day) return (t) => fmt(t, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (spanMs <= 120 * day) return (t) => fmt(t, { month: 'short', day: 'numeric' });
  // "SEP '25": month and year, never mistaken for a day of the month.
  if (spanMs <= 6 * 366 * day) return (t) => `${fmt(t, { month: 'short' })} '${fmt(t, { year: '2-digit' })}`;
  return (t) => fmt(t, { year: 'numeric' });
}
export function fmtHoverForBar(bar) {
  const intraday = /^\d+[MH]$/.test(bar || '');
  const opts = intraday
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return (t) => new Date(t).toLocaleString('en-US', { timeZone: NY, ...opts }).toUpperCase();
}

// The date a bar's close is from. Weekly and monthly bars carry e, the trading day of
// their close (from the server); without it the bar only knows its period, which is
// said as such ("WEEK OF SEP 20, 2026"), never passed off as a trading day. A bar still
// running says so.
const PERIOD = { '1W': 'week', '1MO': 'month' };
export function barDay(p, bar) {
  const day = fmtHoverForBar(bar);
  const per = PERIOD[bar];
  if (!per) return day(p.t);
  // A running bar's close may be newer than its last daily bar: no day is claimed.
  if (p.p) return `THIS ${per.toUpperCase()} SO FAR`;
  if (p.e) return day(p.e);
  if (bar === '1MO') return new Date(p.t).toLocaleString('en-US', { timeZone: NY, month: 'short', year: 'numeric' }).toUpperCase();
  return `WEEK OF ${day(p.t)}`;
}

// "weekly closes" / "monthly closes" / "closes": what one point of the chart is.
export const closesWord = (bar) => (bar === '1W' ? 'weekly close' : bar === '1MO' ? 'monthly close' : 'close');

// Change from the first point: "+12.40 +3.21%", or basis points for yields.
export function changeFrom(first, v, { bp = false, decimals = 2 } = {}) {
  const abs = v - first;
  if (bp) {
    const b = abs * 100;
    return { dir: dirOf(Math.round(b * 10)), text: `${fmtSigned(b, 1)} bp` };
  }
  const pct = first ? (abs / first) * 100 : 0;
  return { dir: dirOf(Math.round(pct * 100)), text: `${fmtSigned(abs, decimals)} ${fmtPct(pct)}`, pct };
}

// Append a live price after the last bar when the range runs to today.
export function withLive(points, live, range) {
  if (!live || !Number.isFinite(live.t) || !Number.isFinite(live.v) || range?.to) return points;
  const last = points[points.length - 1];
  return last && live.t > last.t ? [...points, { t: live.t, v: live.v, live: true }] : points;
}

// What an intraday chart needs besides its points: previous close and open (from the
// quote when it is about the same day), the x domain, and whether it spans several days.
export function intradaySpec(points, { bar, quote = null, shade = true, bp = false } = {}) {
  if (bar !== '5M' || points.length < 2) return null;
  const multiDay = dayStarts(points).length > 1;
  return {
    bar, shade, bp, multiDay,
    refs: sessionRefs(points, quote, { multiDay }),
    timeDomain: multiDay ? null : sessionDomain(points),
  };
}

// The header strip. Intraday: "Since open +0.31% · Since prev close +0.18% · Range 7,690 - 7,731";
// under the crosshair: "10:42 ET · 7,731.20 · vs prev close +0.18% · vs open +0.31%".
// Longer ranges: last, high and low close with their dates, and the average close.
// Returns [{ k, v, dir?, when? }] items; the caller joins them.
export function stripItems(points, spec, { fmtY, bp = false, hover = null, bar = '1D', rangeName = '' } = {}) {
  if (!points || points.length < 2) return [];
  const chg = (from, to) => {
    if (!Number.isFinite(from) || !from) return null;
    if (bp) { const c = changeFrom(from, to, { bp: true }); return { v: c.text, dir: c.dir }; }
    const pct = ((to - from) / from) * 100;
    return { v: fmtPct(pct), dir: dirOf(Math.round(pct * 100)) };
  };
  const vals = points.map((p) => p.v);
  if (spec) {
    const { prevClose, open } = spec.refs;
    if (hover) {
      const out = [{ k: '', v: `${hover.live ? 'NOW' : whenLabel(hover.t, spec.multiDay)} ET` }, { k: '', v: fmtY(hover.v), strong: true }];
      const a = chg(prevClose, hover.v);
      const b = chg(open, hover.v);
      if (a) out.push({ k: 'vs prev close', ...a });
      if (b) out.push({ k: 'vs open', ...b });
      return out;
    }
    const last = vals[vals.length - 1];
    const out = [];
    const a = chg(open, last);
    const b = chg(prevClose, last);
    if (a) out.push({ k: 'Since open', ...a });
    if (b) out.push({ k: 'Since prev close', ...b });
    out.push({ k: spec.multiDay ? `${rangeName} range` : 'Range', v: `${fmtY(Math.min(...vals))} - ${fmtY(Math.max(...vals))}` });
    return out;
  }
  // High, low and average from the chart's own bars only: the live price appended
  // after the last bar is not a close.
  const barsOnly = points.filter((p) => !p.live);
  const src = barsOnly.length >= 2 ? barsOnly : points;
  const st = intradayStats(src, { bar: 'none' });
  const bv = src.map((p) => p.v);
  const avg = bv.reduce((s, v) => s + v, 0) / bv.length;
  const w = closesWord(bar);
  const items = [
    { k: 'Last', v: fmtY(vals[vals.length - 1]), strong: true },
    { k: `High ${w}`, v: fmtY(st.high.v), when: barDay(src[st.high.i], bar) },
    { k: `Low ${w}`, v: fmtY(st.low.v), when: barDay(src[st.low.i], bar) },
    { k: `Average ${w}`, v: fmtY(avg) },
  ];
  if (PERIOD[bar]) items.push({ k: '', v: `${w.toUpperCase()}S`, when: 'one point per ' + PERIOD[bar] });
  return items;
}

function stripHtml(items) {
  return items.map((it) => `<span class="ch-si">${it.k ? `<span class="ch-sk">${esc(it.k)}</span> ` : ''}<span class="num${it.dir ? ` ${it.dir}` : ''}${it.strong ? ' ch-hv' : ''}">${esc(it.v)}</span>${it.when ? ` <span class="dim">${esc(it.when)}</span>` : ''}</span>`).join('<span class="ch-sep" aria-hidden="true">·</span>');
}

// The range chart component. `root` gets a control bar and a chart. Options:
//   symbol, range ({ range } or { from, to }), meta (element for the summary),
//   navigate(cmd) to change range through the command bar (the instrument screen),
//   otherwise ranges change in place; fmtY, bp (yields), decimals, label.
//   quote: 'external' when the screen passes its quote with setQuote(); otherwise a
//   1D or 5D chart fetches the quote itself for the previous close and open.
export function rangeChart(root, ctx, opts) {
  const { symbol, meta, navigate, label = symbol, bp = false } = opts;
  let range = opts.range || { range: '1Y' };
  let data = null;
  let live = null;
  let quote = null;
  let cleanup = null;
  let seq = 0;
  const cmdFor = (r) => [symbol, rangeWords(r)].filter(Boolean).join(' ');
  const today = nyToday();
  const shade = instrumentById(symbol)?.kind !== 'crypto';

  function controls() {
    const tabs = PRESETS.map((p) => {
      const on = !range.from && range.range === p;
      return navigate
        ? `<a class="tab${on ? ' is-active' : ''}" href="${esc(q(cmdFor({ range: p })))}" data-cmd="${esc(cmdFor({ range: p }))}"${on ? ' aria-current="true"' : ''}>${p}</a>`
        : `<button type="button" class="tab${on ? ' is-active' : ''}" data-range="${p}"${on ? ' aria-pressed="true"' : ''}>${p}</button>`;
    }).join('');
    const from = range.from || (data?.points?.length ? isoFromMs(data.points[0].t) : '');
    const to = range.to || '';
    return `<div class="ch-bar">
      <nav class="tabs ch-tabs" aria-label="Chart range">${tabs}</nav>
      <div class="ch-dates${range.from ? ' is-active' : ''}">
        <label><span>FROM</span><input type="date" name="from" min="${FIRST_DAY}" max="${today}" value="${esc(from)}"></label>
        <label><span>TO</span><input type="date" name="to" min="${FIRST_DAY}" max="${today}" value="${esc(to)}" placeholder="TODAY"></label>
      </div>
    </div>`;
  }

  root.innerHTML = `${controls()}<p class="ch-strip" hidden></p><div class="chart-host ${opts.hostCls || ''}">${LOADING}</div>`;
  const host = root.querySelector('.chart-host');
  const strip = root.querySelector('.ch-strip');
  const bar = () => root.querySelector('.ch-bar');

  const shown = () => withLive(data?.points || [], live, range);
  const decimalsFor = (pts) => opts.decimals ?? priceDecimals(pts[0].v);
  const fmtYFor = (pts) => opts.fmtY || ((v) => fmtNum(v, decimalsFor(pts)));
  const specFor = (pts) => intradaySpec(pts, { bar: data?.bar, quote, shade, bp });

  function summary(hoverIdx) {
    const pts = shown();
    if (!pts.length) {
      if (meta) meta.innerHTML = `<span class="dim">${esc(rangeLabel(range))}</span>`;
      strip.hidden = true;
      return;
    }
    const spec = specFor(pts);
    const fmtY = fmtYFor(pts);
    const hover = hoverIdx === undefined || hoverIdx === null ? null : pts[hoverIdx];
    // The strip: intraday numbers live here, crosshair included.
    if (!spec || !hover) {
      const items = stripItems(pts, spec, { fmtY, bp, hover: null, bar: data?.bar, rangeName: rangeLabel(range) });
      strip.innerHTML = stripHtml(items);
      strip.hidden = !items.length;
    } else {
      strip.innerHTML = stripHtml(stripItems(pts, spec, { fmtY, bp, hover }));
    }
    if (!meta) return;
    const first = pts[0].v;
    const dec = decimalsFor(pts);
    if (spec) {
      meta.innerHTML = `<span class="dim">${esc(rangeLabel(range))} · NEW YORK TIME</span>`;
      return;
    }
    if (!hover) {
      const c = changeFrom(first, pts[pts.length - 1].v, { bp, decimals: dec });
      meta.innerHTML = `<span class="num ${c.dir}">${esc(bp ? c.text : fmtPct(c.pct))}</span> <span class="dim">${esc(rangeLabel(range))}</span>`;
      return;
    }
    const c = changeFrom(first, hover.v, { bp, decimals: dec });
    const when = hover.live ? 'NOW' : barDay(hover, data.bar);
    meta.innerHTML = `<span class="num">${esc(when)}</span> <span class="num ch-hv">${esc(fmtY(hover.v))}</span> <span class="num ${c.dir}">${esc(c.text)}</span>`;
  }

  function draw() {
    const pts = shown();
    if (pts.length < 2) return;
    const fmtY = fmtYFor(pts);
    cleanup?.();
    host.textContent = '';
    cleanup = mountChart(host, pts, {
      fmtY,
      fmtX: fmtXForSpan(pts[pts.length - 1].t - pts[0].t),
      label: `${label}, ${rangeLabel(range)}`,
      intraday: specFor(pts),
      onHover: (p, i) => summary(p ? i : null),
    });
    summary();
  }

  const refKey = (d) => (d ? `${d.asOf}|${d.prevClose}|${d.open}` : '');
  async function loadQuote() {
    try {
      const d = await ctx.fetchJSON(`/api/quote?s=${encodeURIComponent(symbol)}`, { signal: ctx.signal });
      const changed = refKey(d) !== refKey(quote);
      quote = d;
      if (changed && data) draw();
    } catch { /* the chart stands without reference lines */ }
  }

  async function load() {
    const my = ++seq;
    try {
      const d = await ctx.fetchJSON(chartQuery(symbol, range), { signal: ctx.signal });
      if (my !== seq) return;
      data = d;
      bar().outerHTML = controls();
      draw();
      if (d.bar === '5M' && opts.quote !== 'external') loadQuote();
      opts.onLoad?.(d);
    } catch (err) {
      if (err.name === 'AbortError' || my !== seq) return;
      data = null;
      cleanup?.();
      cleanup = null;
      host.innerHTML = `<p class="panel-msg">${esc(err.status === 404 ? `No ${rangeLabel(range)} chart for ${symbol}. Try another range.` : err.message)}</p>`;
      summary();
    }
  }

  function setRange(r) {
    if (navigate) { navigate(cmdFor(r)); return; }
    range = r;
    bar().outerHTML = controls();
    host.innerHTML = LOADING;
    load();
  }

  // Dates apply on Enter or when the field loses focus, so typing a year digit by
  // digit does not reload the chart four times.
  function applyDates() {
    const fi = root.querySelector('input[name="from"]');
    const ti = root.querySelector('input[name="to"]');
    const f = fi.value;
    const t = ti.value;
    if (!f) return;
    if (f === fi.defaultValue && t === ti.defaultValue) return;
    if (t && f >= t) { ctx.status('FROM HAS TO BE BEFORE TO', 'warn'); return; }
    if (f > today) { ctx.status('FROM IS IN THE FUTURE', 'warn'); return; }
    setRange({ from: f, to: t && t < today ? t : null });
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (b) setRange({ range: b.dataset.range });
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input[type="date"]')) { e.preventDefault(); applyDates(); }
  });
  root.addEventListener('focusout', (e) => {
    if (!e.target.matches('input[type="date"]')) return;
    // Moving from FROM to TO is not "done" yet.
    if (e.relatedTarget && root.querySelector('.ch-dates')?.contains(e.relatedTarget)) return;
    applyDates();
  });

  load();
  ctx.onCleanup(() => cleanup?.());
  const intraday = () => /^\d+[MH]$/.test(data?.bar || '');
  ctx.live(() => { if (intraday()) load(); }, 60_000);
  ctx.live(() => { if (!intraday()) load(); }, 15 * 60_000);

  return {
    setLive(point) { live = point; if (data) draw(); },
    // The screen's own quote (the instrument screen refreshes it every 15 seconds).
    setQuote(d) {
      const changed = refKey(d) !== refKey(quote);
      quote = d;
      if (changed && data?.bar === '5M') draw();
    },
    get range() { return range; },
  };
}

function isoFromMs(t) {
  return nyToday(new Date(t));
}

export function priceDecimals(v) {
  return Math.abs(v) < 1 ? 4 : 2;
}

// Charts: the SVG line chart (FX and CPI screens) and the range chart component used by
// the instrument screen, HOME, RATES and 420: presets and bar sizes down to 1-minute
// bars, line or candles, volume, compare lines, event flags, wheel zoom, a click-drag
// measure and a big header strip (drawn by chart-view.js, math in chart-math.js).

import { esc, q, fmtNum, fmtSigned, fmtPct, dirOf, LOADING } from './markets.js';
import { PRESETS, chartQuery, rangeWords, rangeLabel, nyToday, MAX_COMPARE } from '../ranges.js';
import { BARS, BAR_LABEL, BAR_MS, AUTO_BAR, barValid, presetSpanDays, zoomBar, isIntradayBar } from '../bars.js';
import { instrumentById } from '../instruments.js';
import {
  intradayStats, sessionDomain, timeTicks, dayStarts, sessionRuns, sessionRefs, withRefs,
  placeLabels, labelWidth, whenLabel,
} from './intraday.js';
import { createChartView, COMPARE_CLASSES } from './chart-view.js';
import {
  barInfo, alignAsOf, rebase, commonStart, placeEvents, headerStats, fmtVol, whenText, fmtDateBox, parseDateBox,
  timeAt, unitAt, windowDays,
} from './chart-math.js';
import { sizeGuard } from './size-guard.js';

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
    items.push({ key: 'move', text: `5-MIN MOVE ${size} · ${when(st.move.t)}`, x: mx, y: my, prio: 5, sides: pct > 0 ? ['above', 'below', 'right', 'left'] : ['below', 'above', 'right', 'left'], dir });
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

// One size guard per chart box, kept across redraws of new data (see size-guard.js).
const guards = new WeakMap();
const now = () => (typeof performance === 'object' ? performance.now() : Date.now());

// Draw a chart that fills `host`, redraw on resize, report the hovered point.
export function mountChart(host, points, opts = {}) {
  if (!guards.has(host)) guards.set(host, sizeGuard());
  const guard = guards.get(host);
  const boxSize = () => ({ w: Math.floor(host.clientWidth), h: Math.floor(host.clientHeight) || opts.height || 240 });
  function draw(resized = false) {
    let { w, h } = boxSize();
    if (!w) return;
    if (resized) {
      const s = guard.next(w, h, now());
      if (!s) return;
      ({ w, h } = s);
    } else {
      guard.drawn(w, h, now());
    }
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
  // The chart follows its box (a panel that stretches to the window): redraw once the
  // size settles, not on every frame of a resize.
  let timer = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(() => draw(true), 80); }) : null;
  ro?.observe(host);
  return () => { clearTimeout(timer); ro?.disconnect(); };
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

// The range chart component: range presets, bar sizes, line or candles, compare, the
// FROM/TO boxes, a big header strip and the chart (chart-view.js). Options:
//   symbol, range ({ range } or { from, to }), compare (symbols), meta (element for the
//   panel meta), navigate(cmd) to change range or compares through the command bar (the
//   instrument screen), otherwise they change in place; fmtY, bp (yields), decimals,
//   label, hostCls, compact (HOME: one header line and the range row only).
//   quote: 'external' when the screen passes its quote with setQuote(); otherwise a 1D
//   chart fetches the quote itself for the previous close.
// Header, line 1: LAST 341.07  +84.12  +32.78% for the visible window (a 1D chart from
// the previous close). Line 2: the window's high, low, average close and volume, or under
// the crosshair the bar's time, O H L C, volume and change from the window start.
const DAY_MS = 86_400_000;
const STYLE_KEY = 'bb.chart.style';

export function rangeChart(root, ctx, opts) {
  const { symbol, meta, navigate, label = symbol, bp = false } = opts;
  const inst = instrumentById(symbol);
  const isStock = !inst;
  const compactOpt = Boolean(opts.compact);
  const baseRange = opts.range || { range: '1Y' };
  let range = baseRange;
  let fetchWin = null;        // { from, to } after a zoom; null = the chosen range
  let viewWin = null;         // { t0, t1 } to show once the data is in
  let zoomed = false;
  let userBar = null;
  let style = ctx.store?.get?.(STYLE_KEY, 'line') === 'candle' ? 'candle' : 'line';
  let compare = [...new Set((opts.compare || []).filter((s) => s && s !== symbol))].slice(0, MAX_COMPARE);
  let data = null;            // the main series: { points, bar, ext, ... }
  const cmpData = new Map();  // symbol -> { points } | { error }
  let quote = null;
  let live = null;
  let events = null;
  let seq = 0;
  let ctrl = null;
  let hoverI = null;
  let flagHover = null;
  let model = null;
  const today = nyToday();

  const cmdFor = (r, cmp = compare) => [symbol, rangeWords({ ...r, compare: cmp })].filter(Boolean).join(' ');
  // Decimals from the latest price (a MAX chart from 1980 starts under a dollar).
  const decimalsFor = (pts) => opts.decimals ?? priceDecimals(pts[pts.length - 1].v);
  const fmtYFor = (pts) => opts.fmtY || ((v) => fmtNum(v, decimalsFor(pts)));
  const compact = () => compactOpt || root.classList.contains('is-tight');

  // ---- Windows and bar sizes ---------------------------------------------------------

  // What the data covers: a preset, or FROM/TO days (typed, or from a zoom).
  const win = () => fetchWin || (range.from ? { from: range.from, to: range.to || null } : { range: range.range || '1Y' });
  function spanOf(w) {
    if (w.range) { const d = presetSpanDays(w.range); return { spanDays: d, ageDays: d + (w.range === '5D' ? 3 : 0) }; }
    const f = Date.parse(`${w.from}T00:00:00Z`);
    const t = w.to ? Date.parse(`${w.to}T00:00:00Z`) + DAY_MS : Date.now();
    return { spanDays: Math.max(1, (t - f) / DAY_MS), ageDays: (Date.now() - f) / DAY_MS };
  }
  const barOk = (bar, w = win()) => barValid(bar, spanOf(w));
  function barFor(w = win()) {
    if (userBar && barOk(userBar, w)) return userBar;
    if (w.range) return AUTO_BAR[w.range] ?? null;
    const s = spanOf(w);
    return zoomBar(s.spanDays * DAY_MS, s.ageDays * DAY_MS);
  }

  // ---- Markup ------------------------------------------------------------------------

  function controls() {
    const w = win();
    const tabs = PRESETS.map((p) => {
      const on = !range.from && range.range === p;
      return navigate
        ? `<a class="tab${on ? ' is-active' : ''}${on && zoomed ? ' is-zoomed' : ''}" href="${esc(q(cmdFor({ range: p })))}" data-cmd="${esc(cmdFor({ range: p }))}"${on ? ' aria-current="true"' : ''}>${p}</a>`
        : `<button type="button" class="tab${on ? ' is-active' : ''}${on && zoomed ? ' is-zoomed' : ''}" data-range="${p}"${on ? ' aria-pressed="true"' : ''}>${p}</button>`;
    }).join('');
    if (compact()) return `<div class="ch-bar"><nav class="tabs ch-tabs" aria-label="Chart range">${tabs}</nav></div>`;
    const cur = data?.bar || barFor(w);
    const bars = BARS.map((b) => {
      const ok = barOk(b, w);
      const on = cur === b;
      const text = on && data?.merged > 1 ? `${data.merged}${BAR_LABEL[b]}` : BAR_LABEL[b];
      return `<button type="button" class="tab ch-bsz${on ? ' is-active' : ''}" data-bar="${b}"${ok ? '' : ' disabled'}${on ? ' aria-pressed="true"' : ''} title="${esc(BAR_TITLE[b])}">${text}</button>`;
    }).join('');
    const chips = compare.map((s, k) => {
      const c = cmpData.get(s);
      return `<span class="ch-chip ${COMPARE_CLASSES[k]}"><span class="ch-chip-sw" aria-hidden="true"></span>${esc(s)} <span class="num ch-chip-pct" data-sym="${esc(s)}">${c?.error ? 'NO DATA' : ''}</span><button type="button" class="ch-chip-x" data-uncompare="${esc(s)}" aria-label="Remove ${esc(s)}">&times;</button></span>`;
    }).join('');
    const canCompare = compare.length < MAX_COMPARE;
    return `<div class="ch-bar">
      <nav class="tabs ch-tabs" aria-label="Chart range">${tabs}</nav>
      <nav class="tabs ch-tabs ch-bars" aria-label="Bar size">${bars}</nav>
      <div class="ch-tools">
        <span class="ch-seg" role="group" aria-label="Chart style">${['line', 'candle'].map((k) => `<button type="button" class="tab${style === k ? ' is-active' : ''}" data-style="${k}"${style === k ? ' aria-pressed="true"' : ''}>${k === 'line' ? 'LINE' : 'CANDLES'}</button>`).join('')}</span>
        ${canCompare ? '<button type="button" class="tab ch-add" data-compare-add>+ COMPARE</button>' : ''}
        ${chips}
      </div>
      <div class="ch-dates${range.from || zoomed ? ' is-active' : ''}">
        <label><span>FROM</span><input class="ch-date" name="from" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="10" placeholder="MM/DD/YYYY" aria-label="From date, MM/DD/YYYY"></label>
        <label><span>TO</span><input class="ch-date" name="to" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="10" placeholder="MM/DD/YYYY" aria-label="To date, MM/DD/YYYY"></label>
      </div>
    </div>`;
  }

  root.innerHTML = `<div class="ch-bar"></div><div class="ch-head"><p class="ch-l1 num"></p><p class="ch-l2 num"></p></div><div class="chart-host ${opts.hostCls || ''}">${LOADING}</div>`;
  root.classList.toggle('is-compact', compactOpt);
  const host = root.querySelector('.chart-host');
  const l1 = root.querySelector('.ch-l1');
  const l2 = root.querySelector('.ch-l2');
  const repaintBar = () => {
    const had = root.querySelector('.ch-bar');
    const focused = had?.contains(document.activeElement) && document.activeElement.matches?.('input') ? document.activeElement.name : null;
    const typed = focused ? document.activeElement.value : null;
    had.outerHTML = controls();
    fillDates();
    paintChips();
    if (focused) {
      const el = root.querySelector(`input[name="${focused}"]`);
      if (el) { el.value = typed; el.focus(); }
    }
  };
  repaintBar();

  let view = null;
  function ensureView() {
    if (view) return view;
    host.textContent = '';
    view = createChartView(host, {
      onHover: (i) => { hoverI = i; header(); },
      onFlag: (f) => { flagHover = f; header(); },
      onSettle: settle,
      onReset: reset,
    });
    return view;
  }

  // ---- The model the view draws --------------------------------------------------------

  function shown() {
    const pts = data?.points || [];
    if (fetchWin?.to || range.to) return pts;
    return withLive(pts, live, null);
  }

  function build() {
    const pts = shown();
    if (pts.length < 2) return null;
    const bar = data.bar;
    const info = barInfo(pts, isIntradayBar(bar) ? BAR_MS[bar] / 60_000 : 1);
    // Pre-market and after hours only mean something on a stock's 1D (ext): everything else
    // (an index settling at 16:05, FX, futures, crypto) is one session.
    if (!data.ext) for (const x of info) x.session = 'regular';
    const intraday = isIntradayBar(bar);
    const times = pts.map((p) => p.t);
    const oneDay = intraday && !fetchWin && !range.from && range.range === '1D';
    // A 1D chart of today leaves room for the rest of the session (or after hours).
    let pad = 0;
    const sessionSym = isStock || (inst?.us && inst.kind === 'index' && !inst.allDay);
    const last = info[info.length - 1];
    if (oneDay && sessionSym && last.day === today) {
      const end = data.ext ? 20 * 60 : 16 * 60;
      pad = Math.max(0, (end - last.mins) / (BAR_MS[bar] / 60_000));
    }
    // A quote dated by day only ("2026-09-25") is about that New York day.
    const q = quote && /^\d{4}-\d{2}-\d{2}$/.test(quote.asOf || '') ? { ...quote, asOf: `${quote.asOf}T12:00:00Z` } : quote;
    const refs = oneDay ? sessionRefs(pts.filter((p) => !p.live), q, { multiDay: false }) : { prevClose: null };
    // 1D: the day's volume from the quote (the source's intraday volume is partial).
    const qDay = q && Date.parse(q.asOf || '');
    // Stocks and futures only: the source's FX and index "volume" is not shares.
    const volumeKind = isStock || inst?.kind === 'future';
    const dayVolume = oneDay && volumeKind && q?.volume && /[1-9]/.test(String(q.volume)) && Number.isFinite(qDay) && barInfo([{ t: qDay }])[0].day === last.day ? String(q.volume) : null;
    const fmtY = fmtYFor(pts);
    const decimals = decimalsFor(pts);
    const span = times[times.length - 1] - times[0];
    const cmp = compare.map((s, k) => {
      const c = cmpData.get(s);
      return c?.points ? { sym: s, cls: COMPARE_CLASSES[k], vals: alignAsOf(times, c.points) } : null;
    }).filter(Boolean);
    const flags = events && !compact() ? eventFlags(events, info, bar) : [];
    const periodBar = bar === '1W' || bar === '1MO';
    // Merged bars (a long daily range over the size cap) say the span they cover.
    const span2 = (p, o) => (p.te ? `${whenText(p.t, o)} - ${whenText(p.te, o)}` : null);
    return {
      points: pts, info, times, bar, intraday, oneDay, dayVolume, merged: data.merged || 1,
      full: [0, pts.length - 1 + pad],
      style, pct: cmp.length > 0, compare: cmp, refs, flags,
      volume: !compact(), fmtY, bp, decimals, label: `${label}, ${rangeLabel(range)}`,
      // The crosshair's time: with the year on daily bars and longer.
      whenAt: (i) => {
        const p = pts[i];
        if (!p) return '';
        if (p.live) return 'NOW';
        if (p.te) return span2(p, { nowYear: 0 });
        if (periodBar) return barDay(p, bar);
        if (intraday) return whenText(p.t, { intraday, spanMs: span });
        return whenText(p.t, { nowYear: 0 });
      },
      // The strip's high and low: the year only when it is not this one.
      whenShort: (i) => {
        const p = pts[i];
        if (!p) return '';
        if (p.live) return 'NOW';
        if (p.te) return span2(p, { intraday, spanMs: span });
        return whenText(p.t, { intraday, spanMs: span });
      },
    };
  }

  function eventFlags(ev, info, bar) {
    const days = info.map((x) => x.day);
    const n = days.length - 1;
    const list = [
      ...ev.earnings.map((e) => ({ date: e.date, kind: 'E', url: e.url, text: 'EARNINGS' })),
      ...(ev.next ? [{ date: ev.next.date, kind: 'E', url: null, text: ev.next.est ? 'EARNINGS (EST)' : 'EARNINGS' }] : []),
      ...ev.dividends.map((d) => ({ date: d.date, kind: 'D', url: null, text: Number.isFinite(d.amount) ? `EX-DIV $${fmtDiv(d.amount)}` : 'EX-DIV' })),
    ].sort((a, b) => (a.date < b.date ? -1 : 1));
    return placeEvents(list, days, 0, n, { bar }).map((f) => ({ ...f, title: `${f.text} ${isoToWhen(f.date)}` }));
  }

  function draw({ keepWindow = true } = {}) {
    model = build();
    if (!model) return;
    const v = ensureView();
    let w = null;
    if (viewWin) {
      const a = unitAt(model.times, viewWin.t0);
      const b = Math.min(model.full[1], unitAt(model.times, viewWin.t1));
      if (b - a >= 1) w = [a, b];
      viewWin = null;
    } else if (zoomed && keepWindow) {
      w = v.window();
    }
    const mt = v.measureTimes();
    v.set({ ...model, window: w || null, measureTimes: mt }, { keepWindow: false });
    if (!w) zoomed = false;
    header();
    fillDates();
    paintChips();
    paintMeta();
  }

  // ---- Header strip ------------------------------------------------------------------

  // The bar compare lines are rebased at (see commonStart).
  function pctBase(i0, i1) {
    return commonStart([model.points.map((p) => p.v), ...model.compare.map((c) => c.vals)], i0, i1);
  }

  function visibleRange() {
    const w = view?.window() || model.full;
    const n = model.points.length;
    return [Math.max(0, Math.ceil(w[0] - 1e-9)), Math.min(n - 1, Math.floor(w[1] + 1e-9))];
  }

  function baseFor(i0) {
    // A whole 1D chart: change from the previous close. Otherwise from the first bar shown.
    if (model.oneDay && !zoomed && Number.isFinite(model.refs.prevClose)) return model.refs.prevClose;
    return model.points[i0].v;
  }

  function chgText(from, to) {
    if (bp) { const c = changeFrom(from, to, { bp: true }); return { dir: c.dir, parts: [c.text] }; }
    const d = to - from;
    const pct = from ? (d / from) * 100 : 0;
    return { dir: dirOf(Math.round(pct * 100)), parts: [fmtSigned(d, model.decimals), fmtPct(pct)] };
  }

  function header() {
    if (!model) { l1.innerHTML = ''; l2.innerHTML = ''; return; }
    const [i0, i1] = visibleRange();
    if (i1 <= i0) return;
    const fmtY = model.fmtY;
    const base = baseFor(i0);
    const st = headerStats(model.points, i0, i1, base);
    const tight = compact();
    const hi = hoverI !== null && hoverI >= i0 && hoverI <= i1 ? hoverI : null;
    const lastP = model.points[i1];
    const sess = model.intraday && model.info[i1]?.session !== 'regular' && !lastP.live
      ? (model.info[i1].session === 'pre' ? 'PRE-MARKET' : 'AFTER HOURS') : '';
    if (tight && hi !== null) {
      const p = model.points[hi];
      const c = chgText(base, p.v);
      l1.innerHTML = `<span class="ch-k">${esc(model.whenAt(hi))}</span> <span class="ch-v">${esc(fmtY(p.v))}</span> <span class="${c.dir}">${esc(c.parts[c.parts.length - 1])}</span>`;
    } else {
      const c = chgText(st.base, st.last);
      l1.innerHTML = `<span class="ch-k">LAST</span> <span class="ch-v">${esc(fmtY(st.last))}</span>${c.parts.map((t) => ` <span class="ch-c ${c.dir}">${esc(t)}</span>`).join('')}${sess ? ` <span class="ch-k">${sess}</span>` : ''}`;
    }
    if (tight) { l2.innerHTML = ''; return; }
    const sep = '<span class="ch-sep" aria-hidden="true">·</span>';
    if (flagHover) {
      l2.innerHTML = `<span class="ch-k">${esc(flagHover.title)}</span>${flagHover.url ? ` ${sep} <span class="dim">CLICK E FOR THE SEC FILING</span>` : ''}`;
      return;
    }
    if (hi !== null) {
      const p = model.points[hi];
      const parts = [`<span class="ch-when">${esc(model.whenAt(hi))}</span>`];
      if (!p.live && Number.isFinite(p.o)) {
        parts.push(`<span class="ch-k">O</span> ${esc(fmtY(p.o))} <span class="ch-k">H</span> ${esc(fmtY(p.h))} <span class="ch-k">L</span> ${esc(fmtY(p.l))} <span class="ch-k">C</span> <span class="ch-hv">${esc(fmtY(p.v))}</span>`);
      } else {
        parts.push(`<span class="ch-k">${p.live ? 'LAST' : 'C'}</span> <span class="ch-hv">${esc(fmtY(p.v))}</span>`);
      }
      // Intraday volume is drawn as relative bars only: the source's intraday counts are partial.
      if (p.x && !model.intraday) parts.push(`<span class="ch-k">V</span> ${esc(fmtVol(p.x))}`);
      const c = chgText(base, p.v);
      parts.push(`<span class="${c.dir}">${esc(c.parts[c.parts.length - 1])}</span>`);
      for (const cm of model.compare) {
        const pv = rebase(cm.vals, pctBase(i0, i1))[hi];
        if (Number.isFinite(pv)) parts.push(`<span class="ch-cmpk ${cm.cls}">${esc(cm.sym)}</span> <span class="${dirOf(Math.round(pv * 100))}">${esc(fmtPct(pv))}</span>`);
      }
      l2.innerHTML = parts.join(` ${sep} `);
      return;
    }
    const w = (i) => model.whenShort(i);
    const items = [
      `<span class="ch-k">HIGH</span> ${esc(fmtY(st.high))} <span class="dim">${esc(w(st.highI))}</span>`,
      `<span class="ch-k">LOW</span> ${esc(fmtY(st.low))} <span class="dim">${esc(w(st.lowI))}</span>`,
      `<span class="ch-k">AVG</span> ${esc(fmtY(st.avg))}`,
    ];
    if (st.vol && !model.intraday) items.push(`<span class="ch-k">VOL</span> ${esc(fmtVol(st.vol))}`);
    if (model.dayVolume) items.push(`<span class="ch-k">DAY VOLUME</span> ${esc(model.dayVolume)}`);
    l2.innerHTML = items.join(` ${sep} `);
  }

  // The compare chips: each symbol's change over the visible window.
  function paintChips() {
    if (!model || compact()) return;
    const [i0, i1] = visibleRange();
    for (const cm of model.compare) {
      const el = root.querySelector(`.ch-chip-pct[data-sym="${cssEsc(cm.sym)}"]`);
      if (!el) continue;
      const pv = rebase(cm.vals, pctBase(i0, i1));
      let j = i1;
      while (j >= i0 && !Number.isFinite(pv[j])) j -= 1;
      const v = j >= i0 ? pv[j] : null;
      el.textContent = Number.isFinite(v) ? fmtPct(v) : '--';
      el.className = `num ch-chip-pct ${Number.isFinite(v) ? dirOf(Math.round(v * 100)) : ''}`;
    }
  }

  function paintMeta() {
    if (!meta) return;
    const bits = [rangeLabel(fetchWin ? { from: fetchWin.from, to: fetchWin.to } : range)];
    if (data?.bar) bits.push(data.merged > 1 ? `${data.merged}-${MERGED_UNIT[data.bar] || 'BAR'} BARS` : (BAR_TITLE[data.bar] || 'Monthly bars').toUpperCase());
    if (model?.intraday) bits.push('NEW YORK TIME');
    meta.innerHTML = `<span class="dim">${esc(bits.join(' · '))}</span>`;
  }

  // The date boxes always show the window on screen.
  function fillDates() {
    const fi = root.querySelector('input[name="from"]');
    const ti = root.querySelector('input[name="to"]');
    if (!fi || !ti || !model) return;
    const [i0, i1] = visibleRange();
    const f = fmtDateBox(model.points[i0].t);
    const t = fmtDateBox(model.points[i1].t);
    for (const [el, v] of [[fi, f], [ti, t]]) {
      if (document.activeElement === el) continue;
      el.value = v;
      el.defaultValue = v;
      el.classList.remove('is-bad');
    }
  }

  // ---- Loading -----------------------------------------------------------------------

  async function load({ silent = false } = {}) {
    const my = ++seq;
    ctrl?.abort();
    ctrl = new AbortController();
    const signal = ctx.signal ? anySignal([ctx.signal, ctrl.signal]) : ctrl.signal;
    const w = win();
    const bar = barFor(w);
    if (!silent && !data) host.innerHTML = LOADING;
    root.classList.add('is-loading');
    try {
      // Compare lines use the same window and bar size, fetched alongside.
      const cmps = compare.map(async (s) => {
        try {
          const c = await ctx.fetchJSON(chartQuery(s, w, bar), { signal });
          return [s, { points: c.points }];
        } catch (err) {
          // A cancelled load resolves quietly (never an unhandled rejection).
          if (err.name === 'AbortError') return [s, null];
          if (err.status === 404 || err.status === 400) ctx.status?.(`NO CHART FOR ${s}`, 'warn');
          return [s, { error: err.status === 404 ? 'none' : 'down' }];
        }
      });
      const d = await ctx.fetchJSON(chartQuery(symbol, w, bar), { signal });
      const got = await Promise.all(cmps);
      if (my !== seq) return;
      data = d;
      for (const [s, c] of got) if (c) cmpData.set(s, c);
      root.classList.remove('is-loading');
      repaintBar();
      draw();
      if (isIntradayBar(d.bar) && range.range === '1D' && opts.quote !== 'external') loadQuote();
      if (isStock && !events && !compact()) loadEvents();
      opts.onLoad?.(d);
    } catch (err) {
      if (err.name === 'AbortError' || my !== seq) return;
      root.classList.remove('is-loading');
      if (silent && data) return;
      data = null;
      model = null;
      view?.destroy();
      view = null;
      host.innerHTML = `<p class="panel-msg">${esc(err.status === 404 ? `No ${rangeLabel(fetchWin || range)} chart for ${symbol}. Try another range.` : err.message)}</p>`;
      header();
    }
  }

  const refKey = (d) => (d ? `${d.asOf}|${d.prevClose}|${d.open}` : '');
  async function loadQuote() {
    try {
      const d = await ctx.fetchJSON(`/api/quote?s=${encodeURIComponent(symbol)}`, { signal: ctx.signal });
      const changed = refKey(d) !== refKey(quote);
      quote = d;
      if (changed && data) draw();
    } catch { /* the chart stands without the previous close */ }
  }

  async function loadEvents() {
    events = { earnings: [], next: null, dividends: [] };
    try {
      const d = await ctx.fetchJSON(`/api/chart-events?s=${encodeURIComponent(symbol)}`, { signal: ctx.signal });
      events = { earnings: d.earnings || [], next: d.next || null, dividends: d.dividends || [] };
      if (data) draw();
    } catch { /* no flags */ }
  }

  // ---- Zoom --------------------------------------------------------------------------

  // After a zoom or pan settles: show the window's dates, and fetch again when the window
  // needs another bar size or reaches past the data.
  function settle({ a, b }) {
    if (!model) return;
    zoomed = true;
    const times = model.times;
    const t0 = timeAt(times, a);
    const t1 = Math.min(timeAt(times, b), Date.now());
    fillDates();
    header();
    paintChips();
    root.querySelector('.ch-dates')?.classList.add('is-active');
    const n = times.length;
    const barMs = BAR_MS[data.bar] || DAY_MS;
    const covered = t0 >= times[0] - barMs && t1 <= times[n - 1] + barMs * 2;
    const count = Math.floor(Math.min(b, n - 1)) - Math.ceil(Math.max(a, 0)) + 1;
    const span = t1 - t0;
    const age = Date.now() - t0;
    const fits = (bar) => barValid(bar, { spanDays: Math.max(span / DAY_MS, 1 / 24), ageDays: age / DAY_MS });
    const want = userBar && fits(userBar) ? userBar : zoomBar(span, age);
    // The bars in hand still draw this window well: no request.
    if (covered && count >= 20 && count <= 3000 && (data.bar === want || (fits(data.bar) && !userBar))) return;
    if (covered && data.bar === want) return;
    const { from, to } = windowDays(t0, t1, today);
    fetchWin = { from, to };
    viewWin = { t0, t1 };
    if (userBar && !fits(userBar)) userBar = null;
    load({ silent: true });
  }

  function reset() {
    viewWin = null;
    zoomed = false;
    if (fetchWin) { fetchWin = null; load({ silent: true }); return; }
    if (model) { view?.setWindow(model.full); header(); fillDates(); paintChips(); repaintBar(); }
  }

  // ---- Controls ----------------------------------------------------------------------

  function setRange(r) {
    if (navigate) { navigate(cmdFor(r)); return; }
    range = r;
    fetchWin = null;
    viewWin = null;
    zoomed = false;
    if (userBar && !barOk(userBar)) userBar = null;
    repaintBar();
    load();
  }

  function setCompare(list) {
    const next = [...new Set(list.filter((s) => s && s !== symbol))].slice(0, MAX_COMPARE);
    if (navigate) { navigate(cmdFor(range, next)); return; }
    compare = next;
    for (const s of [...cmpData.keys()]) if (!compare.includes(s)) cmpData.delete(s);
    repaintBar();
    load({ silent: true });
  }

  // Dates apply on Enter. A box that does not hold a real day turns red and nothing loads.
  function applyDates() {
    const fi = root.querySelector('input[name="from"]');
    const ti = root.querySelector('input[name="to"]');
    const f = parseDateBox(fi.value);
    const t = parseDateBox(ti.value);
    fi.classList.toggle('is-bad', !f || f > today);
    ti.classList.toggle('is-bad', !t || (f && t <= f));
    if (!f || !t) { ctx.status?.('DATES LOOK LIKE 09/25/2026', 'warn'); return; }
    if (f > today) { ctx.status?.('FROM IS IN THE FUTURE', 'warn'); return; }
    if (t <= f) { ctx.status?.('FROM HAS TO BE BEFORE TO', 'warn'); return; }
    setRange({ from: f, to: t >= today ? null : t });
  }

  root.addEventListener('click', (e) => {
    const r = e.target.closest('button[data-range]');
    if (r) { setRange({ range: r.dataset.range }); return; }
    const b = e.target.closest('button[data-bar]');
    if (b && !b.disabled) {
      userBar = b.dataset.bar;
      if (model && zoomed) { const w = view.window(); viewWin = { t0: timeAt(model.times, w[0]), t1: timeAt(model.times, w[1]) }; }
      repaintBar();
      load({ silent: true });
      return;
    }
    const s = e.target.closest('button[data-style]');
    if (s) {
      style = s.dataset.style === 'candle' ? 'candle' : 'line';
      ctx.store?.set?.(STYLE_KEY, style);
      repaintBar();
      draw();
      return;
    }
    if (e.target.closest('button[data-compare-add]')) {
      // The command bar takes the symbol: "+" is typed for you.
      if (ctx.typeCommand) ctx.typeCommand('+');
      return;
    }
    const x = e.target.closest('button[data-uncompare]');
    if (x) setCompare(compare.filter((c) => c !== x.dataset.uncompare));
  });
  root.addEventListener('keydown', (e) => {
    if (!e.target.matches?.('input.ch-date')) return;
    if (e.key === 'Enter') { e.preventDefault(); applyDates(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.target.value = e.target.defaultValue; e.target.classList.remove('is-bad'); }
  });
  root.addEventListener('input', (e) => {
    if (e.target.matches?.('input.ch-date')) e.target.classList.remove('is-bad');
  });

  // Typing +QQQ (or +QQQ +SPY) in the command bar adds compare lines.
  if (!compactOpt && ctx.setCommandHook) {
    ctx.setCommandHook((clean) => {
      const toks = String(clean).split(/\s+/);
      if (!toks.length || !toks.every((t) => /^\+[A-Z0-9][A-Z0-9.\/=&-]{0,11}$/.test(t))) return false;
      const add = toks.map((t) => t.slice(1));
      const next = [...compare, ...add.filter((s) => !compare.includes(s))];
      if (next.length > MAX_COMPARE) { ctx.status?.(`UP TO ${MAX_COMPARE} COMPARE LINES`, 'warn'); return true; }
      setCompare(next);
      return true;
    });
  }

  // A panel too short for the full controls drops them (and the volume) before the plot.
  let tightTimer = 0;
  let chromeFull = 150;
  const ro = typeof ResizeObserver === 'function' && !compactOpt ? new ResizeObserver(() => {
    clearTimeout(tightTimer);
    tightTimer = setTimeout(() => {
      // By the plot the full controls would leave: tight under 180px of plot, roomy again
      // over 220px (hysteresis, so the switch cannot flip on its own change). The full
      // controls' height is measured while they are shown (they wrap on narrow boxes).
      const h = root.clientHeight;
      const was = root.classList.contains('is-tight');
      if (!was && host.clientHeight > 0) chromeFull = Math.max(0, h - host.clientHeight);
      const plot = h - chromeFull;
      const tight = h > 0 && (was ? plot < 220 : plot < 180);
      if (tight === was) return;
      root.classList.toggle('is-tight', tight);
      repaintBar();
      if (data) draw();
    }, 120);
  }) : null;
  ro?.observe(root);

  load();
  ctx.onCleanup(() => { ctrl?.abort(); view?.destroy(); ro?.disconnect(); clearTimeout(tightTimer); });
  const intradayNow = () => isIntradayBar(data?.bar || '') && !(fetchWin?.to || range.to);
  const refresh = () => {
    if (model && zoomed && view) { const w = view.window(); viewWin = { t0: timeAt(model.times, w[0]), t1: timeAt(model.times, w[1]) }; }
    load({ silent: true });
  };
  ctx.live(() => { if (intradayNow()) refresh(); }, 60_000);
  ctx.live(() => { if (data && !intradayNow() && !(fetchWin?.to || range.to)) refresh(); }, 15 * 60_000);

  return {
    setLive(point) {
      const same = live && point && live.t === point.t && live.v === point.v;
      live = point;
      if (data && !same) draw();
    },
    // The screen's own quote (the instrument screen refreshes it every 15 seconds).
    setQuote(d) {
      const changed = refKey(d) !== refKey(quote);
      quote = d;
      if (changed && data && range.range === '1D') draw();
    },
    get range() { return range; },
  };
}

const MERGED_UNIT = { '1D': 'DAY', '1W': 'WEEK', '1MO': 'MONTH' };
const BAR_TITLE = { '1M': '1-minute bars', '5M': '5-minute bars', '30M': '30-minute bars', '1H': '1-hour bars', '1D': 'Daily bars', '1W': 'Weekly bars' };

function fmtDiv(n) {
  return n >= 0.1 ? n.toFixed(2) : n.toFixed(4).replace(/0+$/, '');
}

function isoToWhen(iso) {
  return whenText(Date.parse(`${iso}T16:00:00Z`), { nowYear: 0 });
}

const cssEsc = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'));

// One signal that aborts when any of these does.
function anySignal(signals) {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const c = new AbortController();
  for (const s of signals) {
    if (s.aborted) { c.abort(); break; }
    s.addEventListener('abort', () => c.abort(), { once: true });
  }
  return c.signal;
}

export function priceDecimals(v) {
  return Math.abs(v) < 1 ? 4 : 2;
}

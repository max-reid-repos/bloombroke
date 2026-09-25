// Charts: the SVG line chart (used by every screen) and the range chart component
// (presets, FROM/TO dates, crosshair with change vs the range start) used by the
// instrument screen, HOME, RATES and 420.

import { esc, q, fmtNum, fmtSigned, fmtPct, dirOf, LOADING } from './markets.js';
import { PRESETS, chartQuery, rangeWords, rangeLabel, nyToday, FIRST_DAY } from '../ranges.js';

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

// points: [{ t, v }] oldest first. Returns an SVG string sized in pixels.
export function chartSvg(points, { width = 640, height = 240, fmtY = (v) => fmtNum(v, 2), fmtX = String, label = 'Price chart' } = {}) {
  if (!points || points.length < 2) return '';
  const padR = 64;
  const padT = 8;
  const padB = 20;
  const W = Math.max(40, width - padR);
  const H = Math.max(40, height - padT - padB);
  const vals = points.map((p) => p.v);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  const span = max - min || Math.abs(max) * 0.01 || 1;
  min -= span * 0.06;
  max += span * 0.06;
  const n = points.length;
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => padT + (1 - (v - min) / (max - min)) * H;
  const id = `ch${++chartSeq}`;

  const lastY = y(vals[n - 1]);
  const ticks = niceTicks(min, max, Math.max(2, Math.round(H / 48)));
  const grid = ticks.map((t) => {
    const ty = y(t).toFixed(1);
    // The last-value tag covers any label right next to it.
    const lab = Math.abs(Number(ty) - lastY) < 14 ? '' : `<text class="ch-ylab" x="${W + 6}" y="${(Number(ty) + 4).toFixed(1)}">${esc(fmtY(t))}</text>`;
    return `<line class="ch-grid" x1="0" x2="${W}" y1="${ty}" y2="${ty}"/>${lab}`;
  }).join('');

  const xCount = Math.max(2, Math.min(6, Math.floor(W / 110)));
  const xIdx = [...new Set(Array.from({ length: xCount }, (_, k) => Math.round((k * (n - 1)) / (xCount - 1))))];
  const xlabs = xIdx.map((i, k) => {
    const anchor = k === 0 ? 'start' : k === xIdx.length - 1 ? 'end' : 'middle';
    const gx = x(i).toFixed(1);
    return `<line class="ch-vgrid" x1="${gx}" x2="${gx}" y1="${padT}" y2="${padT + H}"/><text class="ch-xlab" x="${gx}" y="${height - 5}" text-anchor="${anchor}">${esc(fmtX(points[i].t))}</text>`;
  }).join('');

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${W},${padT + H}L0,${padT + H}Z`;
  const last = vals[n - 1];
  const ly = lastY;

  return `<svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" data-w="${W}" data-n="${n}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop class="ch-stop" offset="0" stop-opacity=".18"/><stop class="ch-stop" offset="1" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xlabs}
    <line class="ch-axis" x1="${W}" x2="${W}" y1="${padT}" y2="${padT + H}"/>
    <line class="ch-axis" x1="0" x2="${W}" y1="${padT + H}" y2="${padT + H}"/>
    <path d="${area}" fill="url(#${id})"/>
    <path class="ch-line" d="${line}"/>
    <line class="ch-last-line" x1="0" x2="${W}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}"/>
    <rect class="ch-last-bg" x="${W}" y="${(ly - 8).toFixed(1)}" width="${padR}" height="16"/>
    <text class="ch-last" x="${W + 6}" y="${(ly + 4).toFixed(1)}">${esc(fmtY(last))}</text>
    <line class="ch-cross" x1="0" x2="0" y1="${padT}" y2="${padT + H}" visibility="hidden"/>
    <circle class="ch-dot" r="3" cx="0" cy="0" visibility="hidden"/>
  </svg>`;
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
    const W = Number(svg.dataset.w);
    const n = points.length;
    const cross = svg.querySelector('.ch-cross');
    const dot = svg.querySelector('.ch-dot');
    const vals = points.map((p) => p.v);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || Math.abs(hi) * 0.01 || 1;
    const min = lo - span * 0.06;
    const max = hi + span * 0.06;
    const H = h - 8 - 20;
    const onMove = (e) => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      if (px < 0 || px > W) return;
      const i = Math.max(0, Math.min(n - 1, Math.round((px / W) * (n - 1))));
      const cx = (i / (n - 1)) * W;
      const cy = 8 + (1 - (points[i].v - min) / (max - min)) * H;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
      opts.onHover?.(points[i], i);
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerdown', onMove);
    svg.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
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

// The range chart component. `root` gets a control bar and a chart. Options:
//   symbol, range ({ range } or { from, to }), meta (element for the summary),
//   navigate(cmd) to change range through the command bar (the instrument screen),
//   otherwise ranges change in place; fmtY, bp (yields), decimals, label.
export function rangeChart(root, ctx, opts) {
  const { symbol, meta, navigate, label = symbol, bp = false } = opts;
  let range = opts.range || { range: '1Y' };
  let data = null;
  let live = null;
  let cleanup = null;
  let seq = 0;
  const cmdFor = (r) => [symbol, rangeWords(r)].filter(Boolean).join(' ');
  const today = nyToday();

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

  root.innerHTML = `${controls()}<div class="chart-host ${opts.hostCls || ''}">${LOADING}</div>`;
  const host = root.querySelector('.chart-host');
  const bar = () => root.querySelector('.ch-bar');

  function summary(hoverIdx) {
    if (!meta) return;
    const pts = shown();
    if (!pts.length) { meta.innerHTML = `<span class="dim">${esc(rangeLabel(range))}</span>`; return; }
    const first = pts[0].v;
    const dec = opts.decimals ?? priceDecimals(first);
    const fmtY = opts.fmtY || ((v) => fmtNum(v, dec));
    if (hoverIdx === undefined || hoverIdx === null) {
      const c = changeFrom(first, pts[pts.length - 1].v, { bp, decimals: dec });
      meta.innerHTML = `<span class="num ${c.dir}">${esc(bp ? c.text : fmtPct(c.pct))}</span> <span class="dim">${esc(rangeLabel(range))}</span>`;
      return;
    }
    const p = pts[hoverIdx];
    const c = changeFrom(first, p.v, { bp, decimals: dec });
    const when = p.live ? 'NOW' : fmtHoverForBar(data.bar)(p.t);
    meta.innerHTML = `<span class="num">${esc(when)}</span> <span class="num ch-hv">${esc(fmtY(p.v))}</span> <span class="num ${c.dir}">${esc(c.text)}</span>`;
  }

  const shown = () => withLive(data?.points || [], live, range);

  function draw() {
    const pts = shown();
    if (pts.length < 2) return;
    const dec = opts.decimals ?? priceDecimals(pts[0].v);
    cleanup?.();
    host.textContent = '';
    cleanup = mountChart(host, pts, {
      fmtY: opts.fmtY || ((v) => fmtNum(v, dec)),
      fmtX: fmtXForSpan(pts[pts.length - 1].t - pts[0].t),
      label: `${label}, ${rangeLabel(range)}`,
      onHover: (p, i) => summary(p ? i : null),
    });
    summary();
  }

  async function load() {
    const my = ++seq;
    try {
      const d = await ctx.fetchJSON(chartQuery(symbol, range), { signal: ctx.signal });
      if (my !== seq) return;
      data = d;
      bar().outerHTML = controls();
      draw();
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
    get range() { return range; },
  };
}

function isoFromMs(t) {
  return nyToday(new Date(t));
}

export function priceDecimals(v) {
  return Math.abs(v) < 1 ? 4 : 2;
}

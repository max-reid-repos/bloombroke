// The chart itself: an SVG that fills its box, drawn from a model the range chart
// (chart.js) hands it. Line or candles, a volume pane, compare lines in percent, pre- and
// after-hours shading, the previous close, event flags, a crosshair, wheel zoom and a
// click-drag measure. Bars are placed by index (nights and weekends close up); the window
// [a, b] is in bar units, so zoom is the same for every bar size.
//
// Only the view's own state lives here (window, hover, measure). Loading, bar sizes and
// the header strip belong to chart.js, which it tells through callbacks:
//   onHover(i | null)  the bar under the crosshair, for the header readout
//   onFlag(ev | null)  an event flag under the pointer
//   onSettle({ a, b }) the window after a zoom or pan has been still for 300 ms
//   onReset()          double-click: back to the chosen range

import { esc } from './markets.js';
import { niceTicks, nearestIndex } from './chart.js';
import { lineIndexes, candleBuckets, zoomWindow, axisLabels, measure as measureMath, rebase, commonStart } from './chart-math.js';
import { labelWidth } from './intraday.js';

const PAD_R = 64;
const PAD_T = 8;
const XLAB_H = 18;
const FLAG_H = 17;
const VOL_MIN_PLOT = 220;
const SETTLE_MS = 300;
const LONG_PRESS_MS = 450;
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '0');

// Compare line colours, in order: white, a deeper ice blue, steel grey.
export const COMPARE_CLASSES = ['cmp-1', 'cmp-2', 'cmp-3'];

export function createChartView(host, cb = {}) {
  let model = null;
  let win = null;           // [a, b] in bar units
  let geo = null;           // the last drawn geometry
  let hoverI = null;
  let keyHover = false;
  let meas = null;          // { ia, ib } bar indexes
  let drag = null;          // { ia, x0, moved, pointerId, touch }
  let settleTimer = 0;
  let frame = 0;
  let pressTimer = 0;
  let lastSize = '';
  let lastClick = null;

  host.tabIndex = 0;
  host.dataset.ownFocus = '';
  host.setAttribute('role', 'group');

  function set(m, { keepWindow = false } = {}) {
    model = m;
    const full = m.full;
    if (!keepWindow || !win) win = m.window ? [...m.window] : [...full];
    if (meas && (meas.ia >= m.points.length || meas.ib >= m.points.length)) meas = null;
    if (m.measureTimes && m.points.length) {
      // Keep a measure across a reload: find its bars again by time.
      const t = m.points.map((p) => p.t);
      const at = (tt) => nearestIndex(t, tt);
      meas = { ia: at(m.measureTimes[0]), ib: at(m.measureTimes[1]) };
    }
    hoverI = null;
    draw(true);
  }

  function windowNow() { return win ? [...win] : null; }
  function measureTimes() {
    if (!meas || !model) return null;
    return [model.points[meas.ia]?.t, model.points[meas.ib]?.t];
  }

  // ---- Drawing ----------------------------------------------------------------------

  function draw(force = false) {
    if (!model) return;
    const w = Math.round(host.clientWidth);
    const h = Math.round(host.clientHeight);
    if (!w || !h) return;
    const key = `${w}x${h}`;
    if (!force && key === lastSize) return;
    lastSize = key;
    const out = svgFor(model, win, w, h);
    geo = out.geo;
    host.innerHTML = out.svg;
    paintOverlay();
  }

  function requestDraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; draw(true); });
  }

  // The overlay (crosshair and measure) on the drawn chart, without a redraw.
  function paintOverlay() {
    const svg = host.querySelector('svg');
    if (!svg || !geo) return;
    paintCross(svg);
    paintMeasure(svg);
  }

  function paintCross(svg) {
    const els = ['.ch-cross', '.ch-hcross', '.ch-ytag', '.ch-xtag', '.ch-dot'].map((s) => svg.querySelector(s));
    const [vl, hl, ytag, xtag, dot] = els;
    if (hoverI === null || !geo || hoverI < geo.i0 || hoverI > geo.i1) {
      for (const el of els) el?.setAttribute('visibility', 'hidden');
      return;
    }
    const x = geo.x(hoverI);
    const v = geo.series(hoverI);
    if (!Number.isFinite(v)) { for (const el of els) el?.setAttribute('visibility', 'hidden'); return; }
    const y = geo.y(v);
    attrs(vl, { x1: f1(x), x2: f1(x), visibility: 'visible' });
    attrs(hl, { y1: f1(y), y2: f1(y), visibility: 'visible' });
    attrs(dot, { cx: f1(x), cy: f1(y), visibility: 'visible' });
    ytag.querySelector('rect').setAttribute('y', f1(y - 8));
    const yt = ytag.querySelector('text');
    yt.setAttribute('y', f1(y + 4));
    yt.textContent = geo.fmtAxis(v);
    ytag.setAttribute('visibility', 'visible');
    const text = model.whenAt(hoverI);
    const tw = labelWidth(text) + 10;
    const tx = Math.max(tw / 2, Math.min(geo.W - tw / 2, x));
    attrs(xtag.querySelector('rect'), { x: f1(tx - tw / 2), width: tw });
    const xt = xtag.querySelector('text');
    xt.setAttribute('x', f1(tx));
    xt.textContent = text;
    xtag.setAttribute('visibility', 'visible');
  }

  function paintMeasure(svg) {
    const g = svg.querySelector('.ch-meas');
    if (!g) return;
    if (!meas || meas.ia === meas.ib || !geo) { g.setAttribute('visibility', 'hidden'); return; }
    const [ia, ib] = meas.ia <= meas.ib ? [meas.ia, meas.ib] : [meas.ib, meas.ia];
    const pa = model.points[ia];
    const pb = model.points[ib];
    const m = measureMath(pa, pb, { decimals: model.decimals, intraday: model.intraday, bp: model.bp });
    const xa = geo.x(ia);
    const xb = geo.x(ib);
    const ya = geo.y(geo.series(ia));
    const yb = geo.y(geo.series(ib));
    const band = g.querySelector('.ch-meas-band');
    attrs(band, { x: f1(Math.min(xa, xb)), width: f1(Math.max(1, Math.abs(xb - xa))), y: PAD_T, height: f1(geo.priceH) });
    band.setAttribute('class', `ch-meas-band ${m.dir}`);
    const line = g.querySelector('.ch-meas-line');
    attrs(line, { x1: f1(xa), y1: f1(ya), x2: f1(xb), y2: f1(yb), class: `ch-meas-line ${m.dir}` });
    const [da, db] = g.querySelectorAll('.ch-meas-dot');
    attrs(da, { cx: f1(xa), cy: f1(ya) });
    attrs(db, { cx: f1(xb), cy: f1(yb) });
    const text = g.querySelector('.ch-meas-text');
    text.textContent = m.text;
    text.setAttribute('class', `ch-meas-text ${m.dir}`);
    // The label sits at the top of the band, centred on it, inside the chart.
    const tw = Math.ceil(m.text.length * 10.2 + 20);
    const cx = Math.max(tw / 2, Math.min(geo.W - tw / 2, (xa + xb) / 2));
    const top = Math.min(ya, yb) - 38 > PAD_T ? Math.min(ya, yb) - 38 : Math.max(ya, yb) + 12 + 26 < PAD_T + geo.priceH ? Math.max(ya, yb) + 12 : PAD_T + 4;
    attrs(g.querySelector('.ch-meas-bg'), { x: f1(cx - tw / 2), y: f1(top), width: tw, height: 26 });
    attrs(text, { x: f1(cx), y: f1(top + 19) });
    g.setAttribute('visibility', 'visible');
  }

  // ---- Interaction ------------------------------------------------------------------

  const plotX = (e) => {
    const svg = host.querySelector('svg');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const indexAtX = (x) => {
    if (!geo) return null;
    const u = geo.a + (x / geo.W) * (geo.b - geo.a);
    const i = Math.round(u);
    return Math.max(geo.i0, Math.min(geo.i1, i));
  };
  const inPlot = (p) => p && p.x >= 0 && p.x <= (geo?.W ?? 0) && p.y >= 0 && p.y <= (geo?.plotBottom ?? 0);

  function hover(i) {
    if (i === hoverI) return;
    hoverI = i;
    const svg = host.querySelector('svg');
    if (svg) paintCross(svg);
    cb.onHover?.(i);
  }

  function onPointerMove(e) {
    if (!geo) return;
    const p = plotX(e);
    if (drag && e.pointerId === drag.pointerId) {
      if (drag.touch && !drag.active) {
        if (Math.hypot(p.x - drag.x0, p.y - drag.y0) > 8) cancelPress();
        return;
      }
      const i = indexAtX(Math.max(0, Math.min(geo.W, p.x)));
      if (Math.abs(p.x - drag.x0) > 4) drag.moved = true;
      if (drag.moved) {
        meas = { ia: drag.ia, ib: i };
        const svg = host.querySelector('svg');
        if (svg) paintMeasure(svg);
      }
      keyHover = false;
      hover(i);
      return;
    }
    if (e.pointerType === 'touch') return;
    if (!inPlot(p)) { if (!keyHover) hover(null); return; }
    keyHover = false;
    hover(indexAtX(p.x));
  }

  function cancelPress() {
    clearTimeout(pressTimer);
    pressTimer = 0;
    drag = null;
  }

  function onPointerDown(e) {
    if (!geo || !model || e.button > 0) return;
    if (e.target.closest?.('.ch-flag')) return;
    const p = plotX(e);
    if (!inPlot(p)) return;
    const i = indexAtX(p.x);
    if (e.pointerType === 'touch') {
      // Touch: a long press starts a measure; a drag before that scrolls the page.
      drag = { ia: i, x0: p.x, y0: p.y, moved: false, pointerId: e.pointerId, touch: true, active: false, t: Date.now() };
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        if (!drag) return;
        drag.active = true;
        host.classList.add('is-measuring');
        meas = null;
        hover(drag.ia);
        navigator.vibrate?.(10);
      }, LONG_PRESS_MS);
      return;
    }
    // No preventDefault here: it would also swallow the double-click (reset). The chart's
    // CSS keeps a drag from selecting text.
    host.focus({ preventScroll: true });
    drag = { ia: i, x0: p.x, y0: p.y, moved: false, pointerId: e.pointerId, touch: false, active: true };
    try { host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    cancelPress();
    host.classList.remove('is-measuring');
    if (d.touch && !d.active) {
      // A tap: clear a measure, or read the bar under the finger.
      if (meas) { clearMeasure(); return; }
      const p = plotX(e);
      if (inPlot(p)) hover(indexAtX(p.x));
      return;
    }
    if (!d.moved) {
      // A click clears the measure; a second click soon after on the same spot resets
      // (counted here: pointer capture keeps the browser's own dblclick from firing).
      const now = Date.now();
      if (lastClick && now - lastClick.t < 400 && Math.abs(d.x0 - lastClick.x) < 6) {
        lastClick = null;
        onDblClick(e);
        return;
      }
      lastClick = { t: now, x: d.x0 };
      if (meas) clearMeasure();
      return;
    }
  }

  function clearMeasure() {
    meas = null;
    const svg = host.querySelector('svg');
    if (svg) paintMeasure(svg);
  }

  // A long-press measure on touch: stop the page from scrolling while it runs.
  function onTouchMove(e) {
    if (drag?.touch && drag.active) e.preventDefault();
  }

  function onLeave(e) {
    if (e.pointerType === 'touch') return;
    if (drag) return;
    if (!keyHover) hover(null);
    cb.onFlag?.(null);
  }

  function onWheel(e) {
    if (!geo || !model) return;
    const p = plotX(e);
    if (!inPlot(p)) return;
    e.preventDefault();
    const [a, b] = win;
    const n = model.points.length;
    const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const hi = model.full[1];
    const lo = -(n - 1) * 8;
    if (Math.abs(dx) > Math.abs(dy)) {
      // A sideways scroll pans.
      const shift = (dx / geo.W) * (b - a);
      let na = a + shift;
      let nb = b + shift;
      if (nb > hi) { na -= nb - hi; nb = hi; }
      win = [Math.max(lo, na), nb];
    } else {
      const factor = Math.min(2, Math.max(0.5, Math.exp(dy * 0.002)));
      const anchor = a + (p.x / geo.W) * (b - a);
      win = zoomWindow([a, b], anchor, factor, { lo, hi, minSpan: Math.min(10, Math.max(2, n - 1)), maxSpan: (n - 1) * 8 + (hi - (n - 1)) });
    }
    requestDraw();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => cb.onSettle?.({ a: win[0], b: win[1] }), SETTLE_MS);
  }

  function onDblClick(e) {
    if (e.target.closest?.('.ch-flag')) return;
    meas = null;
    clearTimeout(settleTimer);
    cb.onReset?.();
  }

  function onKey(e) {
    if (!geo || !model) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const start = hoverI ?? geo.i1;
      const i = Math.max(geo.i0, Math.min(geo.i1, start + (e.key === 'ArrowLeft' ? -1 : 1)));
      keyHover = true;
      hoverI = null;
      hover(i);
    } else if (e.key === 'Escape') {
      if (meas) { e.preventDefault(); clearMeasure(); return; }
      if (keyHover) { e.preventDefault(); keyHover = false; hover(null); }
    }
  }

  function onFlagOver(e) {
    const f = e.target.closest?.('.ch-flag');
    if (!f || !model) return;
    cb.onFlag?.(model.flags?.[Number(f.dataset.k)] || null);
  }
  function onFlagOut(e) {
    if (e.target.closest?.('.ch-flag') && !e.relatedTarget?.closest?.('.ch-flag')) cb.onFlag?.(null);
  }

  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerdown', onPointerDown);
  host.addEventListener('pointerup', onPointerUp);
  host.addEventListener('pointercancel', () => { cancelPress(); host.classList.remove('is-measuring'); });
  host.addEventListener('pointerleave', onLeave);
  host.addEventListener('wheel', onWheel, { passive: false });
  host.addEventListener('keydown', onKey);
  host.addEventListener('touchmove', onTouchMove, { passive: false });
  host.addEventListener('contextmenu', (e) => { if (drag?.touch) e.preventDefault(); });
  host.addEventListener('pointerover', onFlagOver);
  host.addEventListener('pointerout', onFlagOut);

  // Redraw once the box has settled after a resize, not on every frame of it. The box
  // gets its size from the layout only (the SVG is absolutely placed inside it), so a
  // redraw never resizes it. Still, a size that flips back and forth (A, B, A, B: a
  // scrollbar that comes and goes) is not followed: the second flip is ignored.
  let roTimer = 0;
  const seen = [];
  const onResize = () => {
    const key = `${Math.round(host.clientWidth)}x${Math.round(host.clientHeight)}`;
    if (key === lastSize) return;
    const now = Date.now();
    const [prev, prev2] = [seen[seen.length - 1], seen[seen.length - 2]];
    seen.push({ key, t: now });
    if (seen.length > 4) seen.shift();
    if (prev2 && prev2.key === key && prev && prev.key === lastSize && now - prev2.t < 2000) return;
    draw(false);
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { clearTimeout(roTimer); roTimer = setTimeout(onResize, 80); }) : null;
  ro?.observe(host);

  return {
    set,
    window: windowNow,
    measureTimes,
    setWindow(w) { win = [...w]; draw(true); },
    clearMeasure,
    redraw: () => draw(true),
    destroy() {
      clearTimeout(settleTimer);
      clearTimeout(roTimer);
      clearTimeout(pressTimer);
      cancelAnimationFrame(frame);
      ro?.disconnect();
    },
  };
}

function attrs(el, a) {
  if (!el) return;
  for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
}

// ---- The SVG --------------------------------------------------------------------------

// model: {
//   points [{ t, v, o?, h?, l?, x?, live? }], info [{ day, mins, session }] per point,
//   full [a, b] (b past the last bar leaves room for the rest of a session),
//   style 'line' | 'candle', pct (compare mode), compare [{ vals (aligned), cls }],
//   refs { prevClose }, flags [{ i, kind: 'E' | 'D', url?, title }], volume (bool),
//   intraday, fmtY, bp, decimals, label, whenAt(i)
// }
export function svgFor(model, win, width, height) {
  const { points, info } = model;
  const n = points.length;
  const W = Math.max(40, width - PAD_R);
  const [a, b] = win && win[1] > win[0] ? win : model.full;
  const span = b - a || 1;
  const x = (u) => ((u - a) / span) * W;
  const i0 = Math.max(0, Math.ceil(a - 1e-9));
  const i1 = Math.min(n - 1, Math.floor(b + 1e-9));
  const pxPerBar = W / span;

  const flags = (model.flags || []).filter((f) => f.i >= i0 && f.i <= i1);
  const flagH = model.flags?.length ? FLAG_H : 0;
  const plotBottom = height - XLAB_H - flagH;
  const plotH = Math.max(40, plotBottom - PAD_T);
  const hasVol = model.volume && plotH >= VOL_MIN_PLOT && points.some((p, i) => i >= i0 && i <= i1 && p.x > 0);
  const volH = hasVol ? Math.round(plotH * 0.2) : 0;
  const priceH = plotH - (hasVol ? volH + 6 : 0);

  // Series: closes, or percent from the window's first bar with compares.
  const vals = points.map((p) => p.v);
  const pct = model.pct && i1 >= i0;
  // Percent mode: every line starts at 0% on the first bar where all of them have a value.
  const base = pct ? commonStart([vals, ...(model.compare || []).map((c) => c.vals)], i0, i1) : i0;
  const main = pct ? rebase(vals, base) : vals;
  const cmps = pct ? (model.compare || []).map((c) => ({ ...c, pv: rebase(c.vals, base) })) : [];
  const series = (i) => main[i];

  // Value range over the window.
  let lo = Infinity;
  let hi = -Infinity;
  const take = (v) => { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  const candles = model.style === 'candle' && !pct;
  for (let i = i0; i <= i1; i += 1) {
    if (candles && !points[i].live) { take(points[i].h ?? points[i].v); take(points[i].l ?? points[i].v); } else take(main[i]);
    for (const c of cmps) take(c.pv[i]);
  }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  // The previous close joins the range when it is near (never more than doubling it).
  const prev = !pct ? model.refs?.prevClose : null;
  let showPrev = false;
  if (Number.isFinite(prev) && prev > 0) {
    const s0 = hi - lo || Math.abs(hi) * 0.01 || 1;
    const nlo = Math.min(lo, prev);
    const nhi = Math.max(hi, prev);
    if (nhi - nlo <= s0 * 2) { lo = nlo; hi = nhi; showPrev = true; }
  }
  const vs = hi - lo || Math.abs(hi) * 0.01 || 1;
  const min = lo - vs * 0.06;
  const max = hi + vs * 0.06;
  const y = (v) => PAD_T + (1 - (v - min) / (max - min)) * priceH;
  const fmtAxis = pct ? (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(max - min) < 4 ? 2 : 1)}%` : model.fmtY;

  let s = '';
  // Pre-market and after-hours shading.
  if (model.intraday && info.length) {
    let run = null;
    const flush = () => {
      if (!run) return;
      const x0 = Math.max(0, x(run.i0 - 0.5));
      const x1 = Math.min(W, x(run.i1 + 0.5));
      if (x1 > x0) {
        s += `<rect class="ch-ext" x="${f1(x0)}" y="${PAD_T}" width="${f1(x1 - x0)}" height="${f1(plotH)}"/>`;
        const text = run.kind === 'pre' ? 'PRE-MARKET' : 'AFTER HOURS';
        if (x1 - x0 >= labelWidth(text) + 4) s += `<text class="ch-ext-lab" x="${f1(x0 + 4)}" y="${PAD_T + 11}">${text}</text>`;
      }
      run = null;
    };
    for (let i = i0; i <= i1; i += 1) {
      const k = info[i]?.session;
      if (k === 'regular' || !k || points[i].live) { flush(); continue; }
      if (run && run.kind === k && run.i1 === i - 1) run.i1 = i;
      else { flush(); run = { kind: k, i0: i, i1: i }; }
    }
    flush();
  }

  // Grid and price labels.
  const ticks = niceTicks(min, max, Math.max(2, Math.round(priceH / 48)));
  const lastI = i1;
  const lastY = Number.isFinite(main[lastI]) ? y(main[lastI]) : -99;
  for (const t of ticks) {
    const ty = y(t);
    if (ty < PAD_T - 1 || ty > PAD_T + priceH + 1) continue;
    s += `<line class="ch-grid" x1="0" x2="${f1(W)}" y1="${f1(ty)}" y2="${f1(ty)}"/>`;
    if (Math.abs(ty - lastY) >= 14) s += `<text class="ch-ylab" x="${f1(W + 6)}" y="${f1(ty + 4)}">${esc(fmtAxis(t))}</text>`;
  }
  if (pct) s += `<line class="ch-zero" x1="0" x2="${f1(W)}" y1="${f1(y(0))}" y2="${f1(y(0))}"/>`;

  // Time labels.
  for (const lab of axisLabels(info, a, b, pxPerBar, { intraday: model.intraday })) {
    const lx = x(lab.i);
    if (lx < -1 || lx > W + 1) continue;
    const anchor = lx < 24 ? 'start' : lx > W - 24 ? 'end' : 'middle';
    s += `<line class="${lab.strong ? 'ch-day' : 'ch-vgrid'}" x1="${f1(lx)}" x2="${f1(lx)}" y1="${PAD_T}" y2="${f1(PAD_T + plotH)}"/>`;
    s += `<text class="ch-xlab${lab.strong ? ' is-strong' : ''}" x="${f1(lx)}" y="${f1(height - 5)}" text-anchor="${anchor}">${esc(lab.text)}</text>`;
  }
  s += `<line class="ch-axis" x1="${f1(W)}" x2="${f1(W)}" y1="${PAD_T}" y2="${f1(PAD_T + plotH)}"/>`;
  s += `<line class="ch-axis" x1="0" x2="${f1(W)}" y1="${f1(PAD_T + plotH)}" y2="${f1(PAD_T + plotH)}"/>`;

  // The previous close, dashed.
  if (showPrev) {
    const py = y(prev);
    s += `<line class="ch-ref ch-ref-prev" x1="0" x2="${f1(W)}" y1="${f1(py)}" y2="${f1(py)}"/>`;
    const text = `PREV CLOSE ${model.fmtY(prev)}`;
    s += `<rect class="ch-lab-bg" x="2" y="${f1(py - 15)}" width="${labelWidth(text)}" height="13"/><text class="ch-lab ch-ref-prev-lab" x="6" y="${f1(py - 5)}">${esc(text)}</text>`;
  }

  // Volume pane.
  if (hasVol) {
    const k = Math.max(1, Math.ceil(2 / pxPerBar));
    const bs = candleBuckets(points, i0, i1, k).filter((q) => !points[q.b].live);
    // Scaled to the 97th percentile, so one closing auction print does not flatten the rest;
    // taller bars are cut at the top of the pane.
    const sorted = bs.map((q) => q.x).filter((v) => v > 0).sort((p, q) => p - q);
    const vmax = (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.97))] * 1.15 : 1) || 1;
    const vTop = PAD_T + priceH + 6;
    const bw = Math.max(1, Math.min(12, pxPerBar * k * 0.7));
    let up = '';
    let down = '';
    bs.forEach((q, j) => {
      if (!q.x) return;
      const prevC = j > 0 ? bs[j - 1].c : q.a > 0 ? points[q.a - 1].v : q.o;
      const hgt = Math.min(1, q.x / vmax) * (volH - 2);
      const cx = x((q.a + q.b) / 2);
      const r = `M${f1(cx - bw / 2)},${f1(vTop + volH - hgt)}h${f1(bw)}v${f1(hgt)}h${f1(-bw)}Z`;
      if (q.c >= prevC) up += r; else down += r;
    });
    s += `<path class="ch-vol up" d="${up}"/><path class="ch-vol down" d="${down}"/>`;
    s += `<text class="ch-vlab" x="${f1(W + 6)}" y="${f1(vTop + 10)}">VOL</text>`;
  }

  // Price: candles, or a line (dimmer outside the regular session).
  s += `<g class="ch-clip">`;
  if (candles) {
    const k = pxPerBar >= 4 ? 1 : Math.ceil(4 / pxPerBar);
    const bw = Math.max(1, Math.min(14, pxPerBar * k * 0.7));
    let up = '';
    let down = '';
    let wu = '';
    let wd = '';
    for (const q of candleBuckets(points, i0, i1, k)) {
      if (points[q.b].live && q.a === q.b) continue;
      const cx = x((q.a + q.b) / 2);
      const top = y(Math.max(q.o, q.c));
      const bot = y(Math.min(q.o, q.c));
      const body = `M${f1(cx - bw / 2)},${f1(top)}h${f1(bw)}v${f1(Math.max(1, bot - top))}h${f1(-bw)}Z`;
      const wick = `M${f1(cx)},${f1(y(q.h))}V${f1(y(q.l))}`;
      if (q.c >= q.o) { up += body; wu += wick; } else { down += body; wd += wick; }
    }
    s += `<path class="ch-wick up" d="${wu}"/><path class="ch-wick down" d="${wd}"/><path class="ch-candle up" d="${up}"/><path class="ch-candle down" d="${down}"/>`;
  } else {
    const idx = lineIndexes(main, i0, i1, Math.max(8, Math.floor(W)));
    const pts = idx.filter((i) => Number.isFinite(main[i]));
    if (pts.length > 1) {
      if (!pct) {
        const d = pts.map((i, k) => `${k ? 'L' : 'M'}${f1(x(i))},${f1(y(main[i]))}`).join('');
        s += `<path class="ch-area" d="${d}L${f1(x(pts[pts.length - 1]))},${f1(PAD_T + priceH)}L${f1(x(pts[0]))},${f1(PAD_T + priceH)}Z"/>`;
      }
      // Split into runs: in the session, and outside it (pre-market, after hours).
      let reg = '';
      let ext = '';
      for (let k = 1; k < pts.length; k += 1) {
        const i = pts[k];
        const seg = `M${f1(x(pts[k - 1]))},${f1(y(main[pts[k - 1]]))}L${f1(x(i))},${f1(y(main[i]))}`;
        if (model.intraday && info[i]?.session && info[i].session !== 'regular' && !points[i].live) ext += seg; else reg += seg;
      }
      s += `<path class="ch-line" d="${reg}"/>`;
      if (ext) s += `<path class="ch-line is-ext" d="${ext}"/>`;
    }
    for (const c of cmps) {
      const ci = lineIndexes(c.pv.map((v) => (v === null ? NaN : v)), i0, i1, Math.max(8, Math.floor(W))).filter((i) => Number.isFinite(c.pv[i]));
      if (ci.length < 2) continue;
      s += `<path class="ch-cmp ${c.cls}" d="${ci.map((i, k) => `${k ? 'L' : 'M'}${f1(x(i))},${f1(y(c.pv[i]))}`).join('')}"/>`;
    }
  }
  s += '</g>';

  // Last value tags on the right edge: the main series, then each compare in percent mode.
  const tags = [];
  if (Number.isFinite(main[lastI])) tags.push({ v: main[lastI], cls: 'ch-last' });
  for (const c of cmps) {
    let j = lastI;
    while (j >= i0 && !Number.isFinite(c.pv[j])) j -= 1;
    if (j >= i0) tags.push({ v: c.pv[j], cls: `ch-last ${c.cls}` });
  }
  let usedY = [];
  for (const t of tags) {
    let ty = y(t.v);
    for (const u of usedY) if (Math.abs(ty - u) < 16) ty = u + (ty >= u ? 16 : -16);
    usedY.push(ty);
    if (t.cls === 'ch-last') s += `<line class="ch-last-line" x1="0" x2="${f1(W)}" y1="${f1(y(t.v))}" y2="${f1(y(t.v))}"/>`;
    s += `<g class="${t.cls}"><rect class="ch-last-bg" x="${f1(W)}" y="${f1(ty - 8)}" width="${PAD_R}" height="16"/><text class="ch-last-t" x="${f1(W + 6)}" y="${f1(ty + 4)}">${esc(fmtAxis(t.v))}</text></g>`;
  }
  usedY = null;

  // Event flags under the time axis.
  if (flagH) {
    const fy = PAD_T + plotH + 2;
    let lastX = -Infinity;
    flags.forEach((f) => {
      let fx = x(f.i);
      if (fx - lastX < 14) fx = lastX + 14;
      lastX = fx;
      if (fx > W - 6) return;
      const k = model.flags.indexOf(f);
      const box = `<rect class="ch-flag-box" x="${f1(fx - 6)}" y="${f1(fy)}" width="12" height="13"/><text class="ch-flag-t" x="${f1(fx)}" y="${f1(fy + 10)}" text-anchor="middle">${f.kind}</text><title>${esc(f.title)}</title>`;
      s += f.url
        ? `<a class="ch-flag is-${f.kind}" data-k="${k}" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${box}</a>`
        : `<g class="ch-flag is-${f.kind}" data-k="${k}">${box}</g>`;
    });
  }

  // Crosshair, measure (both hidden until used).
  s += `<g class="ch-meas" visibility="hidden"><rect class="ch-meas-band" x="0" y="0" width="0" height="0"/><line class="ch-meas-line" x1="0" y1="0" x2="0" y2="0"/><circle class="ch-meas-dot" r="3.5"/><circle class="ch-meas-dot" r="3.5"/><rect class="ch-meas-bg" x="0" y="0" width="0" height="0"/><text class="ch-meas-text" x="0" y="0" text-anchor="middle"></text></g>`;
  s += `<line class="ch-cross" x1="0" x2="0" y1="${PAD_T}" y2="${f1(PAD_T + plotH)}" visibility="hidden"/>`;
  s += `<line class="ch-cross ch-hcross" x1="0" x2="${f1(W)}" y1="0" y2="0" visibility="hidden"/>`;
  s += `<g class="ch-ytag" visibility="hidden"><rect class="ch-tag-bg" x="${f1(W)}" y="0" width="${PAD_R}" height="16"/><text class="ch-tag" x="${f1(W + 6)}" y="0"></text></g>`;
  // The crosshair's time sits on the time labels (under the event flags).
  s += `<g class="ch-xtag" visibility="hidden"><rect class="ch-tag-bg" x="0" y="${f1(height - 17)}" width="0" height="16"/><text class="ch-tag" x="0" y="${f1(height - 5)}" text-anchor="middle"></text></g>`;
  s += `<circle class="ch-dot" r="3" cx="0" cy="0" visibility="hidden"/>`;

  const clipId = `cv${Math.random().toString(36).slice(2, 8)}`;
  const svg = `<svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(model.label || 'Price chart')}">
    <defs><clipPath id="${clipId}"><rect x="0" y="0" width="${f1(W)}" height="${f1(PAD_T + plotH)}"/></clipPath></defs>
    ${s.replace('<g class="ch-clip">', `<g class="ch-clip" clip-path="url(#${clipId})">`)}
  </svg>`;
  return {
    svg,
    geo: { W, a, b, i0, i1, x, y, series, priceH, plotBottom: PAD_T + plotH, fmtAxis, pct },
  };
}


// A multi-line SVG chart for COMPARE, CURVE, LOAN and COMPOUND.
// series: [{ id, label, points: [{ x, y }] }] with x ascending. Colours come from CSS
// classes ln-0 .. ln-4 (the CSP blocks inline styles).

import { esc, fmtNum } from './markets.js';
import { niceTicks } from './quote.js';

const PAD_R = 72;
const PAD_T = 8;
const PAD_B = 20;

export function bounds(series, { zero = false } = {}) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (zero) { minY = Math.min(minY, 0); maxY = Math.max(maxY, 0); }
  const span = maxY - minY || Math.abs(maxY) * 0.01 || 1;
  return { minX, maxX: maxX === minX ? minX + 1 : maxX, minY: minY - span * 0.06, maxY: maxY + span * 0.06 };
}

// Spread end labels so they do not overlap: ys sorted, each at least `gap` apart, within [lo, hi].
export function spreadLabels(ys, gap, lo, hi) {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  }
  const over = order.length ? order[order.length - 1].y - hi : 0;
  if (over > 0) for (const o of order) o.y -= over;
  for (let k = 0; k < order.length; k++) {
    const min = k ? order[k - 1].y + gap : lo;
    if (order[k].y < min) order[k].y = min;
  }
  const out = new Array(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

// Nearest point index to x in an ascending points array.
export function nearestIndex(points, x) {
  let lo = 0;
  let hi = points.length - 1;
  if (hi < 0) return -1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) lo = mid; else hi = mid;
  }
  return Math.abs(points[lo].x - x) <= Math.abs(points[hi].x - x) ? lo : hi;
}

export function linesSvg(series, { width = 640, height = 260, fmtY = (v) => fmtNum(v, 2), fmtTick = null, fmtX = String, xTicks = null, zero = false, label = 'Chart' } = {}) {
  const drawn = series.filter((s) => s.points.length >= 2);
  if (!drawn.length) return '';
  const W = Math.max(40, width - PAD_R);
  const H = Math.max(40, height - PAD_T - PAD_B);
  const b = bounds(drawn, { zero });
  const x = (v) => ((v - b.minX) / (b.maxX - b.minX)) * W;
  const y = (v) => PAD_T + (1 - (v - b.minY) / (b.maxY - b.minY)) * H;

  const lastYs = drawn.map((s) => y(s.points[s.points.length - 1].y));
  const tagYs = spreadLabels(lastYs, 16, PAD_T + 8, PAD_T + H - 8);
  const tickFmt = fmtTick || fmtY;
  const grid = niceTicks(b.minY, b.maxY, Math.max(2, Math.round(H / 48))).map((t) => {
    const ty = y(t);
    // An end tag covers any axis label right next to it.
    const lab = tagYs.some((g) => Math.abs(g - ty) < 14) ? '' : `<text class="ch-ylab" x="${W + 6}" y="${(ty + 4).toFixed(1)}">${esc(tickFmt(t))}</text>`;
    return `<line class="ch-grid" x1="0" x2="${W}" y1="${ty.toFixed(1)}" y2="${ty.toFixed(1)}"/>${lab}`;
  }).join('');
  const zeroLine = zero && b.minY < 0 && b.maxY > 0 ? `<line class="ln-zero" x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>` : '';

  let ticks = xTicks;
  if (!ticks) {
    const ref = drawn.reduce((a, s) => (s.points.length > a.points.length ? s : a), drawn[0]).points;
    const count = Math.max(2, Math.min(6, Math.floor(W / 110)));
    ticks = [...new Set(Array.from({ length: count }, (_, k) => ref[Math.round((k * (ref.length - 1)) / (count - 1))].x))];
  }
  const xlabs = ticks.map((tx, k) => {
    const gx = x(tx);
    const anchor = ticks.length > 1 && k === 0 && gx < 30 ? 'start' : k === ticks.length - 1 && gx > W - 30 ? 'end' : 'middle';
    return `<line class="ch-vgrid" x1="${gx.toFixed(1)}" x2="${gx.toFixed(1)}" y1="${PAD_T}" y2="${PAD_T + H}"/><text class="ch-xlab" x="${gx.toFixed(1)}" y="${height - 5}" text-anchor="${anchor}">${esc(fmtX(tx))}</text>`;
  }).join('');

  const paths = drawn.map((s) => {
    const d = s.points.filter((p) => Number.isFinite(p.y)).map((p, i) => `${i ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
    return `<path class="ln ${esc(s.cls)}" d="${d}"/>`;
  }).join('');

  const tags = drawn.map((s, i) => {
    const v = s.points[s.points.length - 1].y;
    return `<rect class="ln-tag-bg ${esc(s.cls)}" x="${W}" y="${(tagYs[i] - 8).toFixed(1)}" width="${PAD_R}" height="16"/><text class="ln-tag" x="${W + 6}" y="${(tagYs[i] + 4).toFixed(1)}">${esc(fmtY(v))}</text>`;
  }).join('');

  const dots = drawn.map((s) => `<circle class="ln-dot ${esc(s.cls)}" r="3" cx="0" cy="0" visibility="hidden"/>`).join('');

  return `<svg class="chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}" data-w="${W}">
    ${grid}${xlabs}${zeroLine}
    <line class="ch-axis" x1="${W}" x2="${W}" y1="${PAD_T}" y2="${PAD_T + H}"/>
    <line class="ch-axis" x1="0" x2="${W}" y1="${PAD_T + H}" y2="${PAD_T + H}"/>
    ${paths}${tags}
    <line class="ch-cross" x1="0" x2="0" y1="${PAD_T}" y2="${PAD_T + H}" visibility="hidden"/>
    ${dots}
  </svg>`;
}

// Draw into `host`, redraw on resize, report hover as { x, values: [{ id, y }] } or null.
export function mountLines(host, series, opts = {}) {
  let lastKey = '';
  const drawn = series.filter((s) => s.points.length >= 2);
  function draw() {
    const w = Math.floor(host.clientWidth);
    const h = Math.floor(host.clientHeight) || opts.height || 260;
    if (!w || `${w}x${h}` === lastKey) return;
    lastKey = `${w}x${h}`;
    host.innerHTML = linesSvg(series, { ...opts, width: w, height: h });
    const svg = host.querySelector('svg');
    if (!svg || !opts.onHover) return;
    const W = Number(svg.dataset.w);
    const H = h - PAD_T - PAD_B;
    const b = bounds(drawn, opts);
    const cross = svg.querySelector('.ch-cross');
    const dots = [...svg.querySelectorAll('.ln-dot')];
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      if (px < 0 || px > W) return;
      const xv = b.minX + (px / W) * (b.maxX - b.minX);
      const ref = drawn[0].points;
      const snapX = ref[nearestIndex(ref, xv)].x;
      const cx = ((snapX - b.minX) / (b.maxX - b.minX)) * W;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      const values = drawn.map((s, i) => {
        const p = s.points[nearestIndex(s.points, snapX)];
        const cy = PAD_T + (1 - (p.y - b.minY) / (b.maxY - b.minY)) * H;
        const dx = ((p.x - b.minX) / (b.maxX - b.minX)) * W;
        dots[i].setAttribute('cx', dx); dots[i].setAttribute('cy', cy); dots[i].setAttribute('visibility', 'visible');
        return { id: s.id, y: p.y };
      });
      opts.onHover({ x: snapX, values });
    });
    svg.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
      opts.onHover(null);
    });
  }
  draw();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
  ro?.observe(host);
  return () => ro?.disconnect();
}

export function legend(series) {
  return `<ul class="legend">${series.map((s) => `<li><span class="sw ${esc(s.cls)}" aria-hidden="true"></span>${s.labelHtml || esc(s.label)}</li>`).join('')}</ul>`;
}

// Small bar charts for the side panels (BEATS, INSIDERS): a few groups, one or two series,
// a zero line, a label under each group. Colours come from CSS classes (company-ui.css).
//
//   groups: [{ label, values: { key: number | null }, open?: { key: true } }]
//   series: [{ key, cls, label }]
//   stack:  true draws every series in the same slot (a positive one up, a negative one
//           down, as for buys and sells); false puts them side by side.

import { esc, fmtNum } from './markets.js';
import { niceTicks } from './chart.js';

const PAD_R = 48;
const PAD_T = 8;
const PAD_B = 18;

export function barsDomain(groups, series) {
  let lo = 0;
  let hi = 0;
  for (const g of groups) {
    for (const s of series) {
      const v = g.values?.[s.key];
      if (!Number.isFinite(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (lo === hi) hi = lo + 1;
  // Round the ends out to whole steps, so the tallest bar sits under a labelled line.
  const t0 = niceTicks(lo, hi, 3);
  const step = t0.length > 1 ? t0[1] - t0[0] : hi - lo;
  const from = Math.floor(lo / step + 1e-9) * step;
  const to = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = from; v <= to + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return { lo: from, hi: to, ticks };
}

export function barsSvg(groups, series, { width = 320, height = 160, fmtY = (v) => fmtNum(v, 2), stack = false, label = 'Bar chart', labelEvery = 1 } = {}) {
  if (!groups.length || !series.length) return '';
  const W = Math.max(40, width - PAD_R);
  const H = Math.max(40, height - PAD_T - PAD_B);
  const { lo, hi, ticks } = barsDomain(groups, series);
  const y = (v) => PAD_T + (1 - (v - lo) / (hi - lo)) * H;
  const slot = W / groups.length;
  const lanes = stack ? 1 : series.length;
  const bw = Math.max(2, Math.min(28, (slot * 0.7) / lanes));
  const grid = ticks.map((t) => `<line class="mb-grid" x1="0" x2="${W}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="mb-ylab" x="${W + 6}" y="${(y(t) + 3).toFixed(1)}">${esc(fmtY(t))}</text>`).join('');
  const bars = groups.map((g, i) => {
    const cx = slot * i + slot / 2;
    const rects = series.map((s, k) => {
      const v = g.values?.[s.key];
      if (!Number.isFinite(v) || v === 0) return '';
      const x = stack ? cx - bw / 2 : cx - (bw * lanes) / 2 + bw * k;
      const top = Math.min(y(v), y(0));
      const h = Math.max(1, Math.abs(y(v) - y(0)));
      const cls = g.open?.[s.key] ? 'mb-open' : s.cls;
      return `<rect class="${esc(cls)}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${(bw - (stack ? 0 : 1)).toFixed(1)}" height="${h.toFixed(1)}"><title>${esc(`${g.label} ${s.label}: ${fmtY(v)}`)}</title></rect>`;
    }).join('');
    const lab = i % labelEvery === 0 || i === groups.length - 1
      ? `<text class="mb-lab" x="${cx.toFixed(1)}" y="${height - 4}" text-anchor="middle">${esc(g.label)}</text>` : '';
    return rects + lab;
  }).join('');
  return `<svg class="mb" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">
    ${grid}<line class="mb-zero" x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>${bars}
  </svg>`;
}

export function barsLegend(series) {
  return `<ul class="mb-legend">${series.map((s) => `<li><span class="mb-sw ${esc(s.cls)}" aria-hidden="true"></span>${esc(s.label)}</li>`).join('')}</ul>`;
}

// Draw into host at its width, and again when it resizes. Returns a cleanup.
export function mountBars(host, groups, series, opts = {}) {
  let last = 0;
  const draw = () => {
    const w = Math.floor(host.clientWidth);
    if (!w || w === last) return;
    last = w;
    const every = Math.max(1, Math.ceil((groups.length * 36) / Math.max(1, w - PAD_R)));
    host.innerHTML = barsSvg(groups, series, { ...opts, width: w, height: opts.height || host.clientHeight || 160, labelEvery: opts.labelEvery || every });
  };
  draw();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null;
  ro?.observe(host);
  return () => ro?.disconnect();
}

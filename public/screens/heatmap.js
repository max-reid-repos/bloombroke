// HEATMAP: the S&P 100 as a treemap. Grouped by sector, sized by market cap,
// coloured by today's % change. Tap a box to open the ticker.

import { esc, q, fmtNum, fmtPct, panel, LOADING } from './markets.js';

// ---- Squarified treemap (Bruls, Huizing, van Wijk) ---------------------------

function worst(row, side) {
  let s = 0; let mx = 0; let mn = Infinity;
  for (const n of row) { s += n.a; if (n.a > mx) mx = n.a; if (n.a < mn) mn = n.a; }
  const s2 = s * s;
  const w2 = side * side;
  return Math.max((w2 * mx) / s2, s2 / (w2 * mn));
}

function layoutRow(row, r, out) {
  const s = row.reduce((t, n) => t + n.a, 0);
  if (r.w >= r.h) {
    const cw = s / r.h;
    let y = r.y;
    for (const n of row) { const h = n.a / cw; out[n.i] = { x: r.x, y, w: cw, h }; y += h; }
    return { x: r.x + cw, y: r.y, w: Math.max(0, r.w - cw), h: r.h };
  }
  const rh = s / r.w;
  let x = r.x;
  for (const n of row) { const w = n.a / rh; out[n.i] = { x, y: r.y, w, h: rh }; x += w; }
  return { x: r.x, y: r.y + rh, w: r.w, h: Math.max(0, r.h - rh) };
}

// values: numbers (any order). Returns one { x, y, w, h } per value (null for values <= 0),
// filling rect exactly, with boxes kept as close to square as the algorithm allows.
export function squarify(values, rect) {
  const out = values.map(() => null);
  const total = values.reduce((t, v) => t + (v > 0 ? v : 0), 0);
  if (!(total > 0) || !(rect.w > 0) || !(rect.h > 0)) return out;
  const scale = (rect.w * rect.h) / total;
  const nodes = values.map((v, i) => ({ i, a: v > 0 ? v * scale : 0 })).filter((n) => n.a > 0).sort((a, b) => b.a - a.a);
  let r = { ...rect };
  let row = [];
  let k = 0;
  while (k < nodes.length) {
    const side = Math.min(r.w, r.h);
    const n = nodes[k];
    if (!row.length || worst([...row, n], side) <= worst(row, side)) {
      row.push(n);
      k += 1;
    } else {
      r = layoutRow(row, r, out);
      row = [];
    }
  }
  if (row.length) layoutRow(row, r, out);
  return out;
}

// ---- Colour and labels -------------------------------------------------------

// % change -> fill. Grey at 0, deeper green or red up to +-3%.
export function heatFill(pct) {
  if (!Number.isFinite(pct) || Math.abs(pct) < 0.005) return 'hsl(212, 18%, 20%)';
  const t = Math.min(1, Math.abs(pct) / 3);
  return pct > 0
    ? `hsl(147, ${Math.round(28 + 34 * t)}%, ${Math.round(20 + 12 * t)}%)`
    : `hsl(0, ${Math.round(34 + 40 * t)}%, ${Math.round(24 + 14 * t)}%)`;
}

// Font size for a ticker label in a w x h box, or 0 when it does not fit.
export function labelSize(w, h, chars) {
  const fs = Math.min(24, (w - 6) / (chars * 0.62), (h - 4) / 1.25);
  return fs >= 9 ? Math.floor(fs) : 0;
}

// Ticker and % change sizes for a w x h box. The % shows whenever the two lines fit,
// shrinking the ticker a little if that is what it takes. { fs: 0 } when nothing fits.
export function tileLabels(w, h, chars, pctChars = 6) {
  const top = labelSize(w, h, chars);
  if (!top) return { fs: 0, ps: 0 };
  for (let fs = top; fs >= 9; fs -= 1) {
    const ps = Math.max(9, Math.round(fs * 0.62));
    if (h >= fs * 1.1 + ps * 1.15 + 4 && w >= ps * 0.62 * pctChars + 6) return { fs, ps };
  }
  return { fs: top, ps: 0 };
}

const SHORT = {
  TECH: 'Tech', COMM: 'Communication', DISC: 'Consumer disc.', STAPLES: 'Staples', HEALTH: 'Health care',
  FIN: 'Financials', IND: 'Industrials', ENERGY: 'Energy', UTIL: 'Utilities', RE: 'Real estate', MAT: 'Materials',
};

// A sector's head label for a box w px wide: name and %, the name alone, the name cut
// short with a dot, or '' when not even 4 letters fit. 11px caps with letter spacing
// take about 7.4px each, so a label never runs into the next sector.
export const SEC_CHAR_W = 7.4;
export function sectorLabel(name, pctText, w) {
  const fit = Math.floor((w - 8) / SEC_CHAR_W);
  const up = String(name).toUpperCase();
  if (up.length + 1 + pctText.length <= fit) return `${up} ${pctText}`;
  if (up.length <= fit) return up;
  if (fit < 4) return '';
  return `${up.slice(0, fit - 1).trimEnd()}.`;
}

// Cap-weighted % change of a group.
export function weightedPct(stocks) {
  const cap = stocks.reduce((t, s) => t + s.marketCap, 0);
  return cap > 0 ? stocks.reduce((t, s) => t + s.changePct * s.marketCap, 0) / cap : 0;
}

export function heatmapSvg(stocks, width, height) {
  const groups = new Map();
  for (const s of stocks) {
    if (!(s.marketCap > 0)) continue;
    if (!groups.has(s.sector)) groups.set(s.sector, []);
    groups.get(s.sector).push(s);
  }
  const secs = [...groups.entries()].map(([id, list]) => ({ id, list, cap: list.reduce((t, s) => t + s.marketCap, 0) }));
  const secRects = squarify(secs.map((s) => s.cap), { x: 0, y: 0, w: width, h: height });
  const parts = [];
  secs.forEach((sec, i) => {
    const r = secRects[i];
    if (!r) return;
    const head = r.h > 44 && r.w > 70 ? 16 : 0;
    parts.push(`<rect class="hm-sec" x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}"/>`);
    if (head) {
      const label = sectorLabel(SHORT[sec.id] || sec.id, fmtPct(weightedPct(sec.list)), r.w);
      if (label) parts.push(`<text class="hm-sec-t" x="${(r.x + 4).toFixed(1)}" y="${(r.y + 12).toFixed(1)}">${esc(label)}</text>`);
    }
    const inner = { x: r.x + 1, y: r.y + head + 1, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - head - 2) };
    const cells = squarify(sec.list.map((s) => s.marketCap), inner);
    sec.list.forEach((s, j) => {
      const c = cells[j];
      if (!c) return;
      const pctText = fmtPct(s.changePct);
      const { fs, ps } = tileLabels(c.w, c.h, s.ticker.length, pctText.length);
      const cx = c.x + c.w / 2;
      // Two lines: centre the pair (ticker cap height about 0.72 fs, % about 0.72 ps).
      const block = ps ? fs * 0.72 + ps * 0.35 + ps * 0.72 : 0;
      const ty = ps ? c.y + (c.h - block) / 2 + fs * 0.72 : c.y + c.h / 2 + fs * 0.35;
      const text = fs
        ? `<text class="hm-t" x="${cx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${fs}" text-anchor="middle">${esc(s.ticker)}</text>`
          + (ps ? `<text class="hm-p" x="${cx.toFixed(1)}" y="${(ty + ps * 0.35 + ps * 0.72).toFixed(1)}" font-size="${ps}" text-anchor="middle">${esc(pctText)}</text>` : '')
        : '';
      parts.push(`<a class="hm-a" href="${esc(q(s.ticker))}" data-cmd="${esc(s.ticker)}" data-t="${esc(s.ticker)}" aria-label="${esc(`${s.ticker} ${s.name} ${fmtPct(s.changePct)}`)}">`
        + `<rect class="hm-cell" x="${(c.x + 0.5).toFixed(1)}" y="${(c.y + 0.5).toFixed(1)}" width="${Math.max(0, c.w - 1).toFixed(1)}" height="${Math.max(0, c.h - 1).toFixed(1)}" fill="${heatFill(s.changePct)}"/>`
        + `${text}<title>${esc(`${s.name} (${s.ticker}) ${fmtPct(s.changePct)}`)}</title></a>`);
    });
  });
  return `<svg class="heatmap" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="S&amp;P 100 heatmap by sector">${parts.join('')}</svg>`;
}

// Phones: tall. Wider screens: fit the window above the dock, 420 to 760 px.
export function heatHeight(width, viewport = 900) {
  if (width < 640) return Math.round(width * 1.9);
  return Math.round(Math.max(420, Math.min(760, width * 0.5, viewport - 230)));
}

// In a DESK panel the map takes the height left under its head, and never less than 120.
export function fitHeight(viewport, top) {
  return Math.max(120, Math.floor(viewport - Math.max(0, top) - 1));
}

function scaleHtml() {
  const steps = [-3, -2, -1, 0, 1, 2, 3];
  return `<div class="hm-scale" aria-hidden="true">${steps.map((p) => `<svg class="hm-sw" viewBox="0 0 10 10" preserveAspectRatio="none"><rect width="10" height="10" fill="${heatFill(p)}"/></svg><span>${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%</span>`).join('')}</div>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'S&P 100 heatmap', `<div class="hm-host" id="hm-host">${LOADING}</div>`, { cls: 'panel-solo', metaId: 'hm-meta', bodyCls: 'flush' })
    + `<div class="hm-foot">${scaleHtml()}<p class="footnote">Box size = market cap. Colour = today's % change.</p></div>`;
  const host = el.querySelector('#hm-host');
  const meta = el.querySelector('#hm-meta');
  let stocks = null;
  let baseMeta = '';
  let lastKey = '';

  function draw(force = false) {
    if (!stocks) return;
    const w = Math.floor(host.clientWidth);
    if (!w) return;
    // A DESK panel: scale the whole map into the panel instead of cropping it.
    const h = ctx.embed ? fitHeight(window.innerHeight, host.getBoundingClientRect().top) : heatHeight(w, window.innerHeight);
    if (!force && `${w}x${h}` === lastKey) return;
    lastKey = `${w}x${h}`;
    host.innerHTML = heatmapSvg(stocks, w, h);
  }

  host.addEventListener('pointerover', (e) => {
    const a = e.target.closest?.('[data-t]');
    const s = a && stocks?.find((x) => x.ticker === a.dataset.t);
    meta.innerHTML = s ? `<span class="num">${esc(s.ticker)} ${esc(fmtNum(s.last, 2))} <span class="${s.changePct > 0 ? 'up' : s.changePct < 0 ? 'down' : 'flat'}">${esc(fmtPct(s.changePct))}</span></span>` : baseMeta;
  });
  host.addEventListener('pointerleave', () => { meta.innerHTML = baseMeta; });

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => draw()) : null;
  ro?.observe(host);
  const onResize = () => draw();
  if (ctx.embed) window.addEventListener('resize', onResize);
  ctx.onCleanup(() => { ro?.disconnect(); window.removeEventListener('resize', onResize); });

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/heatmap', { signal: ctx.signal });
      stocks = d.stocks;
      const up = stocks.filter((s) => s.changePct > 0).length;
      const down = stocks.filter((s) => s.changePct < 0).length;
      baseMeta = `<span class="up">${up} UP</span> <span class="down">${down} DOWN</span>`;
      meta.innerHTML = baseMeta;
      draw(true);
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!host.querySelector('svg')) host.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH HEATMAP', 'warn');
    }
  }

  load();
  ctx.every(load, 60_000);
}

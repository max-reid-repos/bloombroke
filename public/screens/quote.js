// QUOTE: any ticker. Name, last price, change, key numbers and a price chart.
// Also exports the line chart used by HOME, FX and CPI.

import { esc, q, fmtNum, fmtSigned, fmtPct, dirOf, fmtAsOf, panel, LOADING, tick, settleTicks } from './markets.js';

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
    svg.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      if (px < 0 || px > W) return;
      const i = Math.max(0, Math.min(n - 1, Math.round((px / W) * (n - 1))));
      const cx = (i / (n - 1)) * W;
      const cy = 8 + (1 - (points[i].v - min) / (max - min)) * H;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
      opts.onHover?.(points[i]);
    });
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

export function priceDecimals(v) {
  return Math.abs(v) < 1 ? 4 : 2;
}

// ---- Screen --------------------------------------------------------------------

const RANGES = ['1D', '1M', '6M', '1Y', '5Y'];

function rangeTabs(ticker, active) {
  return `<nav class="tabs" aria-label="Chart range">${RANGES.map((r) => {
    const c = `${ticker} ${r}`;
    return `<a class="tab${r === active ? ' is-active' : ''}" href="${esc(q(c))}" data-cmd="${esc(c)}"${r === active ? ' aria-current="true"' : ''}>${r}</a>`;
  }).join('')}</nav>`;
}

function rangeBar(lo, hi, last) {
  if (![lo, hi, last].every(Number.isFinite) || hi <= lo) return '';
  const pos = Math.max(0, Math.min(1, (last - lo) / (hi - lo))) * 100;
  return `<svg class="rangebar" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="rb-track" x="0" y="2" width="100" height="2"/><rect class="rb-mark" x="${Math.max(0, pos - 1).toFixed(1)}" y="0" width="2" height="6"/></svg>`;
}

function statsHtml(d) {
  const dec = priceDecimals(d.last);
  const rows = [
    ['Mkt cap', d.marketCap || '--'],
    ['52W range', Number.isFinite(d.low52) && Number.isFinite(d.high52) ? `${fmtNum(d.low52, dec)} - ${fmtNum(d.high52, dec)}` : '--', rangeBar(d.low52, d.high52, d.last)],
    ['P/E', Number.isFinite(d.pe) ? fmtNum(d.pe, 2) : '--'],
  ];
  if (Number.isFinite(d.eps)) rows.push(['EPS', fmtNum(d.eps, 2)]);
  if (d.divYield) rows.push(['Div yield', d.divYield]);
  if (d.volume) rows.push(['Volume', d.volume]);
  if (Number.isFinite(d.prevClose)) rows.push(['Prev close', fmtNum(d.prevClose, dec)]);
  return `<dl class="stats">${rows.map(([k, v, extra]) => `<div class="stat"><dt>${esc(k)}</dt><dd class="num">${esc(v)}${extra || ''}</dd></div>`).join('')}</dl>`;
}

function quoteHtml(d) {
  const dec = priceDecimals(d.last);
  const dir = dirOf(d.change);
  const ext = d.extended && d.extended.last !== d.last
    ? `<p class="q-ext"><span class="dim">${esc(d.extended.session)}</span> <span class="num">${fmtNum(d.extended.last, dec)}</span> <span class="num ${dirOf(d.extended.change)}">${fmtSigned(d.extended.change, dec)} ${fmtPct(d.extended.changePct)}</span> <span class="dim">${esc(fmtAsOf(d.extended.asOf))}</span></p>`
    : '';
  return `<div class="q-top">
    <div class="q-main">
      <p class="q-name">${esc(d.name)}</p>
      <p class="q-hero num"><span class="q-last${tick(`q:${d.ticker}:last`, d.last)}">${fmtNum(d.last, dec)}</span><span class="q-ccy">${esc(d.currency || '')}</span></p>
      <p class="q-chg num ${dir}">${fmtSigned(d.change, dec)} <span>${fmtPct(d.changePct)}</span></p>
      ${ext}
      <p class="q-asof dim">LAST ${esc(fmtAsOf(d.asOf))}${d.stale ? ' (LAST KNOWN)' : ''}</p>
    </div>
    ${statsHtml(d)}
  </div>`;
}

export function render(el, cmd, ctx) {
  const { ticker, range } = cmd.args;
  el.innerHTML = `<div class="stack">
    ${panel('1', ticker, LOADING, { metaId: 'q-meta' })}
    ${panel('2', `Chart ${range}`, `<div class="chart-host chart-host-lg" id="q-chart">${LOADING}</div>`, { meta: rangeTabs(ticker, range), bodyCls: 'flush' })}
  </div>
  <p class="footnote">Prices may be delayed. Not financial advice.</p>`;
  const [qBody, cBody] = el.querySelectorAll('.panel-body');
  const qMeta = el.querySelector('#q-meta');
  const host = el.querySelector('#q-chart');
  const chartMeta = el.querySelectorAll('.panel-meta')[1];
  let found = true;
  let chartCleanup = null;
  ctx.onCleanup(() => chartCleanup?.());

  async function loadQuote() {
    try {
      const d = await ctx.fetchJSON(`/api/quote?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal });
      qBody.innerHTML = quoteHtml(d);
      settleTicks(qBody);
      qMeta.textContent = [d.exchange, d.currency, d.type].filter(Boolean).join('  ');
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err.status === 404 || err.status === 400) {
        found = false;
        qBody.innerHTML = `<p class="notice">No ticker called ${esc(ticker)}.</p>
          <p class="muted">Check the spelling, or try <a class="code" href="${esc(q('AAPL'))}" data-cmd="AAPL">AAPL</a> <a class="code" href="${esc(q('TSLA'))}" data-cmd="TSLA">TSLA</a> <a class="code" href="${esc(q('NVDA'))}" data-cmd="NVDA">NVDA</a>. Type <a class="code" href="${esc(q('HELP'))}" data-cmd="HELP">HELP</a> for every command.</p>`;
        cBody.closest('.panel').hidden = true;
        ctx.status(`UNKNOWN TICKER ${ticker}`, 'warn');
        return;
      }
      if (!qBody.querySelector('.q-top')) qBody.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH QUOTE', 'warn');
    }
  }

  async function loadChart() {
    try {
      const d = await ctx.fetchJSON(`/api/chart?s=${encodeURIComponent(ticker)}&r=${range}`, { signal: ctx.signal });
      const pts = d.points;
      const first = pts[0].v;
      const last = pts[pts.length - 1].v;
      const chg = ((last - first) / first) * 100;
      const dec = priceDecimals(last);
      const fmtY = (v) => fmtNum(v, dec);
      const hover = fmtHoverFor(range);
      const tabs = rangeTabs(ticker, range);
      const base = `<span class="num ${dirOf(chg)}">${fmtPct(chg)}</span>`;
      chartMeta.innerHTML = `${base}${tabs}`;
      chartCleanup?.();
      host.textContent = '';
      chartCleanup = mountChart(host, pts, {
        fmtY, fmtX: fmtXFor(range), label: `${ticker} price, ${range}`,
        onHover(p) {
          chartMeta.innerHTML = p ? `<span class="num">${esc(hover(p.t))} ${esc(fmtY(p.v))}</span>${tabs}` : `${base}${tabs}`;
        },
      });
    } catch (err) {
      if (err.name === 'AbortError' || !found) return;
      host.innerHTML = `<p class="panel-msg">${esc(err.status === 404 ? `No ${range} chart for ${ticker}. Try another range.` : err.message)}</p>`;
    }
  }

  loadQuote();
  loadChart();
  ctx.every(() => { if (found) loadQuote(); }, 60_000);
  ctx.every(() => { if (found) loadChart(); }, 5 * 60_000);
}


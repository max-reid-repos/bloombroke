// FX: convert an amount between two currencies, with a 30 day chart of the rate.

import { fmtPct, dirOf, digitsHtml } from './markets.js';

const MINUS = '−';

export function decimalsFor(code) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

export function fmtMoney(n, code) {
  const d = decimalsFor(code);
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (n < 0 ? MINUS : '') + s;
}

// Rates: show enough significant digits to be useful at any magnitude.
export function fmtRate(r) {
  if (!Number.isFinite(r)) return '--';
  const digits = r >= 100 ? 2 : r >= 1 ? 4 : Math.min(8, 3 - Math.floor(Math.log10(r)));
  return r.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function sparkline(points, { width = 640, height = 120, pad = 6 } = {}) {
  if (!points || points.length < 2) return '';
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => (i / (points.length - 1)) * width;
  const y = (v) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${width},${height}L0,${height}Z`;
  const lx = x(points.length - 1);
  const ly = y(vals[vals.length - 1]);
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="30 day chart of the rate">
    <defs><linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#spark-fill)" stroke="none"/>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx}" cy="${ly}" r="3.5" fill="var(--accent)" vector-effect="non-scaling-stroke" class="spark-dot"/>
  </svg>`;
}

function fmtDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function examplesHtml(examples, esc) {
  const q = (c) => '?' + new URLSearchParams({ c }).toString();
  return examples.map((e) => `<a class="code" href="${q(e)}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ');
}

const DEFAULT_EXAMPLES = ['FX 500 USD THB', 'FX 100 EUR USD', 'FX 20000 JPY GBP', 'FX USD CAD'];

function errorView(el, title, detail, examples, esc) {
  el.innerHTML = `
    <div class="screen-head"><h1 class="eyebrow">FX</h1></div>
    <p class="notice">${esc(title)}</p>
    ${detail ? `<p class="muted">${detail}</p>` : ''}
    <p class="muted examples">Try ${examplesHtml(examples || DEFAULT_EXAMPLES, esc)}</p>`;
}

export function render(el, cmd, ctx) {
  const esc = ctx.escapeHtml;
  const a = cmd.args || {};
  if (cmd.error) {
    const title = cmd.error === 'code'
      ? 'Currencies are three letter codes, like USD or EUR.'
      : cmd.error === 'amount'
        ? 'That amount does not look like a number.'
        : 'FX needs an amount and two currencies.';
    errorView(el, title, 'Format: <span class="code">FX &lt;amount&gt; &lt;from&gt; &lt;to&gt;</span>. The amount is optional.', null, esc);
    return;
  }

  el.innerHTML = `
    <div class="screen-head"><h1 class="eyebrow">FX</h1><p class="meta" id="fx-meta">Loading</p></div>
    <div class="fx is-loading" aria-busy="true">
      <p class="fx-from num">${esc(fmtMoney(a.amount, a.from))} ${esc(a.from)} =</p>
      <p class="hero num"><span class="hero-value skel-bar"></span><span class="hero-unit">${esc(a.to)}</span></p>
      <p class="fx-to"><span class="skel-bar skel-short"></span></p>
      <p class="fx-rate"><span class="skel-bar skel-long"></span></p>
    </div>`;

  const params = new URLSearchParams({ amount: String(a.amount), from: a.from, to: a.to });
  ctx.fetchJSON(`/api/fx?${params}`, { signal: ctx.signal }).then((d) => {
    const first = d.series[0]?.v;
    const last = d.series[d.series.length - 1]?.v;
    const chg = first ? ((last - first) / first) * 100 : 0;
    const vals = d.series.map((p) => p.v);
    const dir = dirOf(Math.round(chg * 100));
    const heroText = fmtMoney(d.result, d.to);
    const size = heroText.length > 14 ? ' is-xlong' : heroText.length > 10 ? ' is-long' : '';
    el.innerHTML = `
      <div class="screen-head">
        <h1 class="eyebrow">FX</h1>
        <p class="meta${d.stale ? ' is-stale' : ''}">${d.stale ? 'Last known rate' : 'ECB reference rate'}, ${esc(fmtDate(d.date))}</p>
      </div>
      <div class="fx is-revealed">
        <p class="fx-from"><span class="num">${esc(fmtMoney(d.amount, d.from))}</span> ${esc(d.from)} <span class="dim">${esc(d.fromName)}</span> =</p>
        <p class="hero num${size}"><span class="hero-value">${digitsHtml(esc(heroText), 1)}</span><span class="hero-unit">${esc(d.to)}</span></p>
        <p class="fx-to dim">${esc(d.toName)}</p>
        <p class="fx-rate num">1 ${esc(d.from)} = ${esc(fmtRate(d.rate))} ${esc(d.to)}<span class="sep" aria-hidden="true"></span><span class="dim">1 ${esc(d.to)} = ${esc(fmtRate(1 / d.rate))} ${esc(d.from)}</span></p>
      </div>
      <figure class="chart">
        <figcaption class="chart-head">
          <span class="eyebrow">30 days</span>
          <span class="chart-stats num">
            <span><span class="dim">Low</span> ${esc(fmtRate(Math.min(...vals)))}</span>
            <span><span class="dim">High</span> ${esc(fmtRate(Math.max(...vals)))}</span>
            <span class="${dir}">${esc(fmtPct(chg))}</span>
          </span>
        </figcaption>
        ${sparkline(d.series)}
        <div class="chart-axis dim num"><span>${esc(fmtDate(d.series[0].d))}</span><span>${esc(fmtDate(d.date))}</span></div>
      </figure>
      <p class="muted swap">Flip it: <a class="code" href="?${new URLSearchParams({ c: `FX ${Math.round(d.result * 100) / 100} ${d.to} ${d.from}` })}" data-cmd="FX ${Math.round(d.result * 100) / 100} ${esc(d.to)} ${esc(d.from)}">FX ${esc(d.to)} ${esc(d.from)}</a></p>`;
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    if (err.code === 'unknown_currency') {
      const codes = (err.body?.unknown || []).join(', ');
      const supported = (err.body?.supported || []).join(' ');
      errorView(el, `We do not know the currency ${codes}.`,
        supported ? `Supported: <span class="codes">${esc(supported)}</span>` : '', err.body?.examples, esc);
    } else {
      errorView(el, err.message, '', null, esc);
    }
  });
}

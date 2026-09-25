// FX: convert an amount between two currencies, with a 30 day chart of the rate.

import { esc, q, fmtPct, dirOf, panel, LOADING } from './markets.js';
import { mountChart } from './quote.js';

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

// The amount for the "flip it" link: full precision, plain digits, never exponent notation.
export function flipAmount(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  return n.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 15 });
}

function fmtDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
}

function examplesHtml(examples) {
  return examples.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ');
}

const DEFAULT_EXAMPLES = ['FX 500 USD THB', 'FX 100 EUR USD', 'FX 20000 JPY GBP', 'FX USD CAD'];

function errorView(el, title, detail, examples) {
  el.innerHTML = panel('1', 'FX', `
    <p class="notice">${esc(title)}</p>
    ${detail ? `<p class="muted">${detail}</p>` : ''}
    <p class="muted examples">Try ${examplesHtml(examples || DEFAULT_EXAMPLES)}</p>`, { cls: 'panel-solo' });
}

export function render(el, cmd, ctx) {
  const a = cmd.args || {};
  if (cmd.error) {
    const title = cmd.error === 'code'
      ? 'Currencies are three letter codes, like USD or EUR.'
      : cmd.error === 'amount'
        ? 'That amount does not look right. Use digits, up to 1,000,000,000,000.'
        : 'FX needs an amount and two currencies.';
    errorView(el, title, 'Format: <span class="code">FX &lt;amount&gt; &lt;from&gt; &lt;to&gt;</span>. The amount is optional.', null);
    ctx.status('FX: CHECK THE FORMAT', 'warn');
    return;
  }

  el.innerHTML = `<div class="stack">
    ${panel('1', `FX ${a.from}/${a.to}`, LOADING, { metaId: 'fx-meta' })}
    ${panel('2', `${a.from}/${a.to} 30 days`, `<div class="chart-host" id="fx-chart">${LOADING}</div>`, { metaId: 'fx-ch-meta', bodyCls: 'flush' })}
  </div>`;
  const [body] = el.querySelectorAll('.panel-body');
  const meta = el.querySelector('#fx-meta');
  const chMeta = el.querySelector('#fx-ch-meta');
  const host = el.querySelector('#fx-chart');
  let chartCleanup = null;
  ctx.onCleanup(() => chartCleanup?.());

  const params = new URLSearchParams({ amount: String(a.amount), from: a.from, to: a.to });
  ctx.fetchJSON(`/api/fx?${params}`, { signal: ctx.signal }).then((d) => {
    const first = d.series[0]?.v;
    const last = d.series[d.series.length - 1]?.v;
    const chg = first ? ((last - first) / first) * 100 : 0;
    const vals = d.series.map((p) => p.v);
    const heroText = fmtMoney(d.result, d.to);
    const size = heroText.length > 18 ? ' is-xlong' : heroText.length > 13 ? ' is-long' : '';
    const flip = `FX ${flipAmount(d.result)} ${d.to} ${d.from}`;
    meta.textContent = `${d.stale ? 'LAST KNOWN RATE' : 'ECB REFERENCE RATE'} ${fmtDate(d.date)}`;
    body.innerHTML = `
      <div class="fx">
        <p class="fx-from"><span class="num">${esc(fmtMoney(d.amount, d.from))}</span> ${esc(d.from)} <span class="dim">${esc(d.fromName)}</span> =</p>
        <p class="hero num${size}"><span class="hero-value">${esc(heroText)}</span><span class="hero-unit">${esc(d.to)}</span></p>
        <p class="fx-to dim">${esc(d.toName)}</p>
        <dl class="stats stats-row">
          <div class="stat"><dt>Rate</dt><dd class="num">1 ${esc(d.from)} = ${esc(fmtRate(d.rate))} ${esc(d.to)}</dd></div>
          <div class="stat"><dt>Inverse</dt><dd class="num">1 ${esc(d.to)} = ${esc(fmtRate(1 / d.rate))} ${esc(d.from)}</dd></div>
          <div class="stat"><dt>30D low</dt><dd class="num">${esc(fmtRate(Math.min(...vals)))}</dd></div>
          <div class="stat"><dt>30D high</dt><dd class="num">${esc(fmtRate(Math.max(...vals)))}</dd></div>
        </dl>
        <p class="muted swap">Flip it: <a class="code" href="${esc(q(flip))}" data-cmd="${esc(flip)}">FX ${esc(d.to)} ${esc(d.from)}</a></p>
      </div>`;
    const base = `<span class="num ${dirOf(Math.round(chg * 100))}">${esc(fmtPct(chg))}</span>`;
    chMeta.innerHTML = base;
    host.textContent = '';
    const pts = d.series.map((p) => ({ t: Date.parse(p.d + 'T12:00:00Z'), v: p.v }));
    const dayFmt = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toUpperCase();
    chartCleanup = mountChart(host, pts, {
      fmtY: fmtRate, fmtX: dayFmt, label: `${d.from} to ${d.to}, 30 days`,
      onHover: (p) => { chMeta.innerHTML = p ? `<span class="num">${esc(dayFmt(p.t))} ${esc(fmtRate(p.v))}</span>` : base; },
    });
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    if (err.code === 'unknown_currency') {
      const codes = (err.body?.unknown || []).join(', ');
      const supported = (err.body?.supported || []).join(' ');
      errorView(el, `We do not know the currency ${codes}.`,
        supported ? `Supported: <span class="codes">${esc(supported)}</span>` : '', err.body?.examples);
      ctx.status(`UNKNOWN CURRENCY ${codes}`, 'warn');
    } else {
      errorView(el, err.message, '', null);
      ctx.status('FX: NO DATA', 'warn');
    }
  });
}

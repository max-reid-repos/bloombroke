// FX: convert an amount between two currencies, with a 30 day chart of the rate.

import { esc, q, fmtPct, dirOf, panel, LOADING } from './markets.js';
import { mountChart } from './quote.js';
import { toolbar } from '../kit.js';

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

// The converter row under the title: amount, from, a swap button, to. Changing any of
// them runs the FX command again, so the result, the chart and the link stay in step.
export function fxForm({ amount, from, to }) {
  const amt = flipAmount(amount);
  const code = (name, v, label) => `<input class="field-input fx-code" name="${name}" value="${esc(v)}" maxlength="3" size="3" spellcheck="false" autocapitalize="characters" autocorrect="off" aria-label="${label}">`;
  return `<form class="fx-form" autocomplete="off">
    <input class="field-input fx-amt num" name="amount" value="${esc(amt)}" inputmode="decimal" maxlength="16" spellcheck="false" aria-label="Amount">
    ${code('from', from, 'From currency')}
    <button type="button" class="chip fx-swap" data-swap aria-label="Swap ${esc(from)} and ${esc(to)}">SWAP</button>
    ${code('to', to, 'To currency')}
    <button type="submit" class="chip">CONVERT</button>
  </form>`;
}

// The FX command for the form, or null when a field is not right. Amounts may use
// commas; codes are three letters.
export function fxFormCommand(amount, from, to) {
  const n = Number(String(amount ?? '').replace(/[,\s]/g, ''));
  const f = String(from || '').trim().toUpperCase();
  const t = String(to || '').trim().toUpperCase();
  if (!(n > 0) || n > 1e12 || !/^[A-Z]{3}$/.test(f) || !/^[A-Z]{3}$/.test(t)) return null;
  return `FX ${flipAmount(n)} ${f} ${t}`;
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

export const FX_SOURCE = 'Source: ECB statistics via Frankfurter. Reference rates, published once a working day (DAILY), not live prices. A rate between two currencies other than the euro is calculated from their euro rates. Not financial advice.';

// ECB reference rates are all against the euro: any other pair is worked out from two of them.
export function isCalculated(from, to) {
  return from !== 'EUR' && to !== 'EUR';
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
    ${panel('1', `FX ${a.from}/${a.to}`, `${toolbar({ left: fxForm(a), label: 'Convert' })}<div class="fx-out">${LOADING}</div>`, { metaId: 'fx-meta', bodyCls: 'flush' })}
    ${panel('2', `${a.from}/${a.to} 30 days`, `<div class="chart-host" id="fx-chart">${LOADING}</div>`, { metaId: 'fx-ch-meta', bodyCls: 'flush' })}
  </div>
  <p class="footnote">${esc(FX_SOURCE)}</p>`;
  const body = el.querySelector('.fx-out');
  const form = el.querySelector('.fx-form');
  const go = (swap) => {
    const f = form.elements;
    const next = swap ? fxFormCommand(f.amount.value, f.to.value, f.from.value) : fxFormCommand(f.amount.value, f.from.value, f.to.value);
    if (next) ctx.run(next);
    else ctx.status('FX: AN AMOUNT AND TWO THREE LETTER CODES, LIKE 100 USD EUR', 'warn');
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); go(false); });
  form.querySelector('[data-swap]').addEventListener('click', () => go(true));
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
    meta.textContent = `${d.stale ? 'LAST KNOWN RATE' : 'ECB REFERENCE RATE'} ${fmtDate(d.date)}`;
    body.innerHTML = `
      <div class="fx">
        <p class="fx-from"><span class="num">${esc(fmtMoney(d.amount, d.from))}</span> ${esc(d.from)} <span class="dim">${esc(d.fromName)}</span> =</p>
        <p class="hero num${size}"><span class="hero-value">${esc(heroText)}</span><span class="hero-unit">${esc(d.to)}</span></p>
        <p class="fx-to dim">${esc(d.toName)}</p>
        <dl class="stats stats-row">
          <div class="stat"><dt>Rate${isCalculated(d.from, d.to) ? ' <span class="dim">(calculated)</span>' : ''}</dt><dd class="num">1 ${esc(d.from)} = ${esc(fmtRate(d.rate))} ${esc(d.to)}</dd></div>
          <div class="stat"><dt>Inverse</dt><dd class="num">1 ${esc(d.to)} = ${esc(fmtRate(1 / d.rate))} ${esc(d.from)}</dd></div>
          <div class="stat"><dt>30D low</dt><dd class="num">${esc(fmtRate(Math.min(...vals)))}</dd></div>
          <div class="stat"><dt>30D high</dt><dd class="num">${esc(fmtRate(Math.max(...vals)))}</dd></div>
        </dl>
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

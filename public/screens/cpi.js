// CPI: what money from a past year is worth today, from the US consumer price index.

import { esc, q, fmtNum, panel, LOADING } from './markets.js';
import { mountChart } from './quote.js';
import { toolbar } from '../kit.js';
import { flipAmount } from './fx.js';

const EXAMPLES = ['CPI 100 2015', 'CPI 1000 1990', 'CPI 20 1970'];

export function fmtUsd(n) {
  if (!Number.isFinite(n)) return '--';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// The row under the title: an amount and a year, so a new question needs no retyping.
export function cpiForm({ amount, year }) {
  return `<form class="fx-form cpi-form" autocomplete="off">
    <span class="dim">$</span><input class="field-input fx-amt num" name="amount" value="${esc(flipAmount(amount))}" inputmode="decimal" maxlength="16" spellcheck="false" aria-label="Amount in dollars">
    <span class="dim">IN</span><input class="field-input fx-year num" name="year" value="${esc(year)}" inputmode="numeric" maxlength="4" size="4" spellcheck="false" aria-label="Year">
    <button type="submit" class="chip">GO</button>
  </form>`;
}

// The CPI command for the form, or null when a field is not right.
export function cpiFormCommand(amount, year, thisYear = new Date().getUTCFullYear()) {
  const n = Number(String(amount ?? '').replace(/[$,\s]/g, ''));
  const y = Number(String(year ?? '').trim());
  if (!(n > 0) || n > 1e12 || !Number.isInteger(y) || y < 1913 || y > thisYear) return null;
  return `CPI ${flipAmount(n)} ${y}`;
}

function examplesHtml() {
  return EXAMPLES.map((e) => `<a class="code" href="${esc(q(e))}" data-cmd="${esc(e)}">${esc(e)}</a>`).join(' ');
}

function errorView(el, message) {
  el.innerHTML = panel('1', 'CPI', `
    <p class="notice">${esc(message)}</p>
    <p class="muted">Format: <span class="code">CPI &lt;amount&gt; &lt;year&gt;</span>. The amount is optional and starts at $100.</p>
    <p class="muted examples">Try ${examplesHtml()}</p>`, { cls: 'panel-solo' });
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    errorView(el, cmd.error === 'amount' ? 'That amount does not look right. Use digits, up to 1,000,000,000,000.' : 'CPI needs a year, and maybe an amount.');
    ctx.status('CPI: CHECK THE FORMAT', 'warn');
    return;
  }
  const { amount, year } = cmd.args;
  el.innerHTML = `<div class="stack">
    ${panel('1', `CPI ${year}`, `${toolbar({ left: cpiForm({ amount, year }), label: 'Amount and year' })}<div class="fx-out">${LOADING}</div>`, { metaId: 'cpi-meta', bodyCls: 'flush' })}
    ${panel('2', `Prices since ${year}`, `<div class="chart-host" id="cpi-chart">${LOADING}</div>`, { metaId: 'cpi-ch-meta', bodyCls: 'flush' })}
  </div>
  <p class="footnote">CPI-U, all items, US city average, from the US Bureau of Labor Statistics. Annual averages, plus the latest month (MONTHLY). Not financial advice.</p>`;
  const body = el.querySelector('.fx-out');
  el.querySelector('.cpi-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    const next = cpiFormCommand(f.amount.value, f.year.value);
    if (next) ctx.run(next);
    else ctx.status('CPI: AN AMOUNT AND A YEAR FROM 1913, LIKE 100 IN 2015', 'warn');
  });
  const meta = el.querySelector('#cpi-meta');
  const chMeta = el.querySelector('#cpi-ch-meta');
  const host = el.querySelector('#cpi-chart');
  let chartCleanup = null;
  ctx.onCleanup(() => chartCleanup?.());

  const params = new URLSearchParams({ amount: String(amount), year: String(year) });
  ctx.fetchJSON(`/api/cpi?${params}`, { signal: ctx.signal }).then((d) => {
    const hero = fmtUsd(d.result);
    const size = hero.length > 18 ? ' is-xlong' : hero.length > 13 ? ' is-long' : '';
    meta.textContent = `CPI-U ${d.latest.label.toUpperCase()}${d.latest.source === 'static' ? ' (TABLE)' : ''}`;
    const perYear = Number.isFinite(d.perYear) ? ` That is ${fmtNum(d.perYear, 1)}% a year on average.` : '';
    const dirWord = d.pct >= 0 ? 'up' : 'down';
    body.innerHTML = `
      <div class="fx">
        <p class="fx-from"><span class="num">${esc(fmtUsd(d.amount))}</span> in ${esc(d.year)} is worth</p>
        <p class="hero num${size}"><span class="hero-value">${esc(hero)}</span><span class="hero-unit">TODAY</span></p>
        <p class="fx-to">Prices are ${dirWord} ${esc(fmtNum(Math.abs(d.pct), 1))}% since ${esc(d.year)}.${esc(perYear)}</p>
        <dl class="stats stats-row">
          <div class="stat"><dt>CPI ${esc(d.year)}</dt><dd class="num">${esc(fmtNum(d.base, 3))}</dd></div>
          <div class="stat"><dt>CPI ${esc(d.latest.label)}</dt><dd class="num">${esc(fmtNum(d.latest.value, 3))}</dd></div>
          <div class="stat"><dt>$1 then</dt><dd class="num">${esc(fmtUsd(d.latest.value / d.base))} now</dd></div>
          <div class="stat"><dt>A year, average</dt><dd class="num">${Number.isFinite(d.perYear) ? `${esc(fmtNum(d.perYear, 1))}%` : '--'}</dd></div>
        </dl>
      </div>`;
    const pts = d.series.map((p) => {
      const [y, m] = p.d.split('-').map(Number);
      return { t: Date.UTC(y, m ? m - 1 : 6, 15), v: p.v, label: m ? d.latest.label : String(y) };
    });
    const base = `<span class="dim">1982-84 = 100</span>`;
    chMeta.innerHTML = base;
    host.textContent = '';
    chartCleanup = mountChart(host, pts, {
      fmtY: (v) => fmtNum(v, 0),
      fmtX: (t) => String(new Date(t).getUTCFullYear()),
      label: `Consumer prices since ${d.year}`,
      onHover: (p) => { chMeta.innerHTML = p ? `<span class="num">${esc(p.label.toUpperCase())} ${esc(fmtNum(p.v, 3))}</span>` : base; },
    });
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    errorView(el, err.message);
    ctx.status(err.code === 'bad_year' ? 'CPI: PICK ANOTHER YEAR' : 'CPI: NO DATA', 'warn');
  });
}

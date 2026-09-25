// CPI: what money from a past year is worth today, from the US consumer price index.

import { esc, q, fmtNum, panel, LOADING } from './markets.js';
import { mountChart } from './quote.js';

const EXAMPLES = ['CPI 100 2015', 'CPI 1000 1990', 'CPI 20 1970'];

export function fmtUsd(n) {
  if (!Number.isFinite(n)) return '--';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    ${panel('1', `CPI ${year}`, LOADING, { metaId: 'cpi-meta' })}
    ${panel('2', `Prices since ${year}`, `<div class="chart-host" id="cpi-chart">${LOADING}</div>`, { metaId: 'cpi-ch-meta', bodyCls: 'flush' })}
  </div>
  <p class="footnote">CPI-U, all items, US city average, from the US Bureau of Labor Statistics. Annual averages, plus the latest month (MONTHLY). Not financial advice.</p>`;
  const [body] = el.querySelectorAll('.panel-body');
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

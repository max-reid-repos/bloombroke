// DIVIDENDS: yield, the annual dividend, the next dates, and every payment on record.

import { esc, fmtNum, panel, LOADING } from './markets.js';
import { companyLinks, errorHtml, tickerUsage } from './profile.js';

export { parseTicker as parse } from './profile.js';

const fmtDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase() : '--');
const cash = (n) => (Number.isFinite(n) ? `$${fmtNum(n, n < 1 ? 4 : 2).replace(/(\.\d\d\d*?)0+$/, '$1')}` : '--');

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Dividends', tickerUsage('DIVIDENDS', ['DIVIDENDS AAPL', 'DIVIDENDS KO', 'DIVIDENDS JNJ']), { cls: 'panel-solo' });
    ctx.status('DIVIDENDS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = `<div class="stack">
    ${panel('1', `${ticker} dividends`, LOADING, { meta: companyLinks(ticker, 'DIVIDENDS') })}
    ${panel('2', 'Every payment', LOADING, { metaId: 'dv-meta', bodyCls: 'flush' })}
  </div>
  <p class="footnote">Dividend data from Nasdaq. Yield = the yearly dividend divided by today's price. Per share, before tax. Not financial advice.</p>`;
  const [top, list] = el.querySelectorAll('.panel-body');

  ctx.fetchJSON(`/api/dividends?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    if (!d.rows.length && (d.annual > 0 || d.yield > 0)) {
      top.innerHTML = `<div>
        <p class="q-name">Dividend yield</p>
        <p class="q-hero num">${Number.isFinite(d.yield) ? `${fmtNum(d.yield, 2)}<span class="q-ccy">%</span>` : '--'}</p>
        <dl class="stats dv-stats"><div class="stat"><dt>Per year</dt><dd class="num">${esc(cash(d.annual))}</dd></div></dl>
        <p class="muted dv-note">Payment history is only available here for Nasdaq-listed stocks. Yield and yearly dividend from CNBC.</p>
      </div>`;
      list.closest('.panel').hidden = true;
      ctx.updated(d.updated, d.stale);
      return;
    }
    if (!d.rows.length) {
      top.innerHTML = `<p class="notice">${esc(ticker)} has no dividends on record.</p><p class="muted">Some companies return cash by buying back shares instead.</p>`;
      list.closest('.panel').hidden = true;
      ctx.updated(d.updated, d.stale);
      return;
    }
    const yearsRows = d.years.slice(0, 12);
    top.innerHTML = `<div class="dv-top">
      <div>
        <p class="q-name">Dividend yield</p>
        <p class="q-hero num">${Number.isFinite(d.yield) ? `${fmtNum(d.yield, 2)}<span class="q-ccy">%</span>` : '--'}</p>
        <dl class="stats dv-stats">
          <div class="stat"><dt>Per year</dt><dd class="num">${esc(cash(d.annual))}</dd></div>
          <div class="stat"><dt>Last ex-date</dt><dd class="num">${esc(fmtDay(d.exDate))}</dd></div>
          <div class="stat"><dt>Last paid</dt><dd class="num">${esc(fmtDay(d.payDate))}</dd></div>
        </dl>
      </div>
      <table class="grid-table dv-years">
        <thead><tr><th scope="col">Year</th><th scope="col" class="num">Paid</th><th scope="col" class="num">Payments</th></tr></thead>
        <tbody>${yearsRows.map((y) => `<tr><th scope="row" class="name">${esc(y.year)}</th><td class="num last">${esc(cash(y.total))}</td><td class="num dim">${y.count}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
    el.querySelector('#dv-meta').textContent = `${d.rows.length} PAYMENTS`;
    list.innerHTML = `<table class="grid-table dv-table">
      <thead><tr><th scope="col">Ex-date</th><th scope="col" class="num">Amount</th><th scope="col" class="chg">Type</th><th scope="col" class="num time">Declared</th><th scope="col" class="num">Paid</th></tr></thead>
      <tbody>${d.rows.map((r) => `<tr>
        <th scope="row" class="name">${esc(r.exDate)}</th>
        <td class="num last">${esc(cash(r.amount))}</td>
        <td class="chg dim">${esc(r.type || '--')}</td>
        <td class="num time dim">${esc(r.declared || '--')}</td>
        <td class="num">${esc(r.paid || '--')}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    top.innerHTML = errorHtml(err, ticker);
    list.closest('.panel').hidden = true;
    ctx.status(err.status === 404 ? `NO DIVIDEND DATA FOR ${ticker}` : 'DIVIDENDS: NO DATA', 'warn');
  });
}

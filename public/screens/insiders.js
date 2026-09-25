// INSIDERS <ticker>: what the company's officers and directors bought and sold, newest
// first, plus open-market buys against sells over 3 and 12 months.

import { esc, panel, LOADING } from './markets.js';
import { mountFnBar, sourceLine, errorHtml, tickerUsage, fmtInt, fmtMoney, fmtBigMoney, dash } from './company-kit.js';

export { parseTicker as parse } from './company-kit.js';

const KIND_CLS = { BUY: 'up', 'PLAN BUY': 'up', SELL: 'down', 'PLAN SELL': 'down' };

export function totalsTable(t) {
  const row = (label, k, cls = '') => `<tr><th scope="row" class="name">${esc(label)}</th><td class="num ${cls}">${fmtInt(t.m3[k])}</td><td class="num ${cls}">${fmtInt(t.m12[k])}</td></tr>`;
  return `<table class="grid-table co-totals">
    <thead><tr><th scope="col">Insider trades</th><th scope="col" class="num">3 months</th><th scope="col" class="num">12 months</th></tr></thead>
    <tbody>
      ${row('Open-market buys', 'buys', 'up')}
      ${row('Sells', 'sells', 'down')}
      ${row('Shares bought', 'sharesBought')}
      ${row('Shares sold', 'sharesSold')}
      ${row('Net shares', 'netShares', 'last')}
    </tbody>
  </table>`;
}

export function insidersTable(rows) {
  if (!rows.length) return '<p class="panel-msg">No transactions listed.</p>';
  return `<table class="grid-table co-table ins-table">
    <thead><tr><th scope="col" class="num co-n">#</th><th scope="col" class="co-date">Date</th><th scope="col">Insider</th><th scope="col" class="chg">Title</th><th scope="col">Type</th><th scope="col" class="num">Shares</th><th scope="col" class="num time">Price</th><th scope="col" class="num chg">Value</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <td class="num co-n dim">${i + 1}</td>
      <td class="co-date num">${esc(r.date || dash)}</td>
      <th scope="row" class="name">${esc(r.insider)}</th>
      <td class="chg dim co-title">${esc(r.title || dash)}</td>
      <td class="co-kind ${KIND_CLS[r.kind] || 'dim'}" title="${esc(r.transaction || '')}">${esc(r.kind || dash)}</td>
      <td class="num last">${fmtInt(r.shares)}</td>
      <td class="num time">${fmtMoney(r.price)}</td>
      <td class="num chg">${fmtBigMoney(r.value)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

const NOTE = 'Types: BUY and SELL are open-market trades; PLAN SELL is a sale under a pre-set trading plan (10b5-1); AWARD and DISPOSED are shares acquired or given up outside the open market; OPTION is an option exercise. Value = shares x price, as filed.';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Insiders', tickerUsage('INSIDERS', ['INSIDERS AAPL', 'INSIDERS NVDA', 'INSIDERS JPM']), { cls: 'panel-solo' });
    ctx.status('INSIDERS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = `<div class="stack">
    ${panel('1', `${ticker} insider trades`, LOADING, { bodyCls: 'flush' })}
    ${panel('2', 'Recent transactions', LOADING, { metaId: 'ins-meta', bodyCls: 'flush' })}
  </div>
  <div id="ins-foot">${sourceLine('Nasdaq insider activity (SEC Forms 3, 4 and 5)')}</div>`;
  mountFnBar(el, ctx, ticker, 'INSIDERS');
  const [top, list] = el.querySelectorAll('.panel-body');

  ctx.fetchJSON(`/api/insiders?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    top.innerHTML = totalsTable(d.totals);
    list.innerHTML = insidersTable(d.rows);
    el.querySelector('#ins-meta').textContent = Number.isFinite(d.totalRecords) ? `${d.rows.length} OF ${fmtInt(d.totalRecords)}` : `${d.rows.length} ROWS`;
    el.querySelector('#ins-foot').innerHTML = sourceLine(d.source, NOTE);
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    top.innerHTML = `<div class="co-pad">${errorHtml(err, ticker)}</div>`;
    list.closest('.panel').hidden = true;
    ctx.status(err.status === 404 ? `NO INSIDER DATA FOR ${ticker}` : 'INSIDERS: NO DATA', 'warn');
  });
}

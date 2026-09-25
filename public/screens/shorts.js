// SHORTS <ticker>: short interest by settlement date (twice a month), average daily
// volume and days to cover, newest first.

import { esc, fmtNum, fmtSigned, dirOf, panel, LOADING } from './markets.js';
import { mountFnBar, sourceLine, errorHtml, tickerUsage, fmtInt, fmtBig, dash } from './company-kit.js';

export { parseTicker as parse } from './company-kit.js';

const signedPct = (n) => (Number.isFinite(n) ? `${fmtSigned(n, 2)}%` : dash);

export function shortsTable(rows) {
  return `<table class="grid-table co-table si-table">
    <thead><tr><th scope="col" class="num co-n">#</th><th scope="col" class="co-date">Settlement</th><th scope="col" class="num">Short interest</th><th scope="col" class="num chg">Change</th><th scope="col" class="num time">Avg daily volume</th><th scope="col" class="num">Days to cover</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <td class="num co-n dim">${i + 1}</td>
      <th scope="row" class="co-date num">${esc(r.date)}</th>
      <td class="num last">${fmtInt(r.shortInterest)}</td>
      <td class="num chg ${dirOf(r.changePct)}">${signedPct(r.changePct)}</td>
      <td class="num time">${fmtBig(r.avgVolume)}</td>
      <td class="num">${Number.isFinite(r.daysToCover) ? fmtNum(r.daysToCover, 2) : dash}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

const NOTE = 'Short interest = shares sold short and not yet bought back, on the settlement date. Days to cover = short interest / average daily volume, as published. Change is against the settlement before it. Nasdaq-listed stocks only.';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Shorts', tickerUsage('SHORTS', ['SHORTS AAPL', 'SHORTS TSLA', 'SHORTS NVDA']), { cls: 'panel-solo' });
    ctx.status('SHORTS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = `${panel('1', `${ticker} short interest`, LOADING, { cls: 'panel-solo', metaId: 'si-meta', bodyCls: 'flush' })}
  <div id="si-foot">${sourceLine('Nasdaq short interest')}</div>`;
  mountFnBar(el, ctx, ticker, 'SHORTS');
  const body = el.querySelector('.panel-body');

  ctx.fetchJSON(`/api/shorts?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    body.innerHTML = shortsTable(d.rows);
    el.querySelector('#si-meta').textContent = `${d.rows.length} SETTLEMENTS`;
    el.querySelector('#si-foot').innerHTML = sourceLine(d.source, NOTE);
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<div class="co-pad">${errorHtml(err, ticker)}</div>`;
    ctx.status(err.status === 404 ? `NO SHORT INTEREST FOR ${ticker}` : 'SHORTS: NO DATA', 'warn');
  });
}

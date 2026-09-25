// BEATS <ticker>: reported earnings per share against the consensus estimate, and the
// surprise, for the last quarters.

import { esc, fmtNum, fmtSigned, dirOf, panel, LOADING } from './markets.js';
import { mountFnBar, sourceLine, errorHtml, tickerUsage, fmtDay, dash } from './company-kit.js';

export { parseTicker as parse } from './company-kit.js';

const eps = (n) => (Number.isFinite(n) ? fmtNum(n, 2) : dash);
const signedPct = (n) => (Number.isFinite(n) ? `${fmtSigned(n, 2)}%` : dash);

export function beatsTable(rows) {
  return `<table class="grid-table co-table bt-table">
    <thead><tr><th scope="col">Quarter</th><th scope="col" class="num time">Reported</th><th scope="col" class="num">EPS</th><th scope="col" class="num">Consensus</th><th scope="col" class="num">Surprise</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <th scope="row" class="name">${esc(r.quarter)}</th>
      <td class="num time dim">${esc(fmtDay(r.reported))}</td>
      <td class="num last">${eps(r.eps)}</td>
      <td class="num">${eps(r.consensus)}</td>
      <td class="num ${dirOf(r.surprisePct)}">${signedPct(r.surprisePct)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

const NOTE = 'EPS = earnings per share, in USD, as reported. Consensus = the consensus estimate as published by the source. Surprise = how far reported EPS was from it, as published.';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Beats', tickerUsage('BEATS', ['BEATS AAPL', 'BEATS MSFT', 'BEATS KO']), { cls: 'panel-solo' });
    ctx.status('BEATS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = `${panel('1', `${ticker} earnings vs estimates`, LOADING, { cls: 'panel-solo', metaId: 'bt-meta', bodyCls: 'flush' })}
  <div id="bt-foot">${sourceLine('Nasdaq earnings surprise')}</div>`;
  mountFnBar(el, ctx, ticker, 'BEATS');
  const body = el.querySelector('.panel-body');

  ctx.fetchJSON(`/api/beats?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    body.innerHTML = beatsTable(d.rows);
    el.querySelector('#bt-meta').textContent = `LAST ${d.rows.length} QUARTERS`;
    el.querySelector('#bt-foot').innerHTML = sourceLine(d.source, NOTE);
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<div class="co-pad">${errorHtml(err, ticker)}</div>`;
    ctx.status(err.status === 404 ? `NO EARNINGS DATA FOR ${ticker}` : 'BEATS: NO DATA', 'warn');
  });
}

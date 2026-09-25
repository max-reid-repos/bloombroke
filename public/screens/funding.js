// 420: Tesla since 7 Aug 2018, the "funding secured" day. Not listed anywhere.

import { esc, fmtNum, panel, LOADING, nyTime } from './markets.js';
import { rangeChart } from './chart.js';
import { fmtUsd, fmtX, fmtDay } from './whatif.js';

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="stack">
    ${panel('1', '420', LOADING, { meta: 'TSLA' })}
    ${panel('2', 'TSLA since 7 Aug 2018', '<div class="rc" id="f-rc"></div>', { cmd: 'TSLA FROM 2018-08-07', metaId: 'f-meta', bodyCls: 'flush' })}
  </div>
  <p class="footnote">Not financial advice. Definitely not funding advice.</p>`;
  const [body] = el.querySelectorAll('.panel-body');
  const chart = rangeChart(el.querySelector('#f-rc'), ctx, {
    symbol: 'TSLA', range: { from: '2018-08-07', to: null }, meta: el.querySelector('#f-meta'),
    label: 'Tesla share price', decimals: 2,
  });

  ctx.fetchJSON('/api/funding', { signal: ctx.signal }).then((d) => {
    const dir = d.multiple >= 1 ? 'up' : 'down';
    const asOf = d.asOf ? (/^\d{4}-\d{2}-\d{2}$/.test(d.asOf) ? `the ${fmtDay(d.asOf)} close` : `${nyTime(d.asOf)} ET`) : 'now';
    body.innerHTML = `
      <p class="fx-from">Funding secured. Eventually.</p>
      <p class="hero num"><span class="hero-value ${dir}">${esc(fmtUsd(d.value))}</span><span class="hero-unit">TODAY</span></p>
      <p class="fx-to">If you had bought $420 of Tesla that day, you would have ${esc(fmtUsd(d.value))} today.</p>
      <dl class="stats stats-row">
        <div class="stat"><dt>Close ${esc(fmtDay(d.date))}</dt><dd class="num">$${esc(fmtNum(d.close, 2))}</dd></div>
        <div class="stat"><dt>Today</dt><dd class="num">$${esc(fmtNum(d.price, 2))}</dd></div>
        <div class="stat"><dt>Shares for $420</dt><dd class="num">${esc(fmtNum(d.shares, 2))}</dd></div>
        <div class="stat"><dt>Multiple</dt><dd class="num ${dir}">${esc(fmtX(d.multiple))}</dd></div>
      </dl>
      <p class="wi-source">Prices: split-adjusted close on 7 Aug 2018, price return only. Live price as of ${esc(asOf)}${d.stale ? ' (last known)' : ''}. Source: ${esc(d.source)}.</p>`;
    if (d.asOf && /T/.test(d.asOf)) chart.setLive({ t: Date.parse(d.asOf), v: d.price });
    ctx.status('420: FUNDING SECURED');
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    ctx.status('420: FUNDING NOT SECURED', 'warn');
  });
}

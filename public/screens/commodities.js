// COMMODITIES: energy, metals and farm futures (front month). Delayed.

import { esc, q, fmtNum, fmtSigned, fmtPct, dirOf, fmtAsOf, panel, LOADING, tick, settleTicks } from './markets.js';

export function commoditiesTable(rows) {
  let group = '';
  return `<table class="grid-table commodities-table">
    <thead><tr><th scope="col">Name</th><th scope="col" class="num">Last</th><th scope="col" class="num chg">Chg</th><th scope="col" class="num">%Chg</th><th scope="col" class="unit">Unit</th><th scope="col" class="num time">Time</th></tr></thead>
    <tbody>${rows.map((c) => {
      const head = c.group !== group ? `<tr class="group-row"><th colspan="6" scope="rowgroup">${esc((group = c.group))}</th></tr>` : '';
      const d = dirOf(c.change);
      return `${head}<tr>
        <th scope="row" class="name">${c.cmd ? `<a href="${esc(q(c.cmd))}" data-cmd="${esc(c.cmd)}">${esc(c.name)}</a>` : esc(c.name)}${c.contract ? ` <span class="dim contract">${esc(c.contract)}</span>` : ''}</th>
        <td class="num last${tick(`cm:${c.id}`, c.last)}">${fmtNum(c.last, c.decimals)}</td>
        <td class="num chg ${d}">${fmtSigned(c.change, c.decimals)}</td>
        <td class="num pct ${d}">${fmtPct(c.changePct)}</td>
        <td class="unit dim">${esc(c.unit)}</td>
        <td class="num time dim">${esc(fmtAsOf(c.asOf))}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Commodities', LOADING, { cls: 'panel-solo', metaId: 'cm-meta', meta: '<span class="delayed">DELAYED</span> FRONT-MONTH FUTURES' })
    + '<p class="footnote">Futures prices from CNBC, delayed. Month shown is the contract. Grains, coffee and sugar trade in US cents. Not financial advice.</p>';
  const body = el.querySelector('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/commodities', { signal: ctx.signal });
      body.innerHTML = commoditiesTable(d.commodities);
      settleTicks(body);
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH COMMODITIES', 'warn');
    }
  }

  load();
  ctx.every(load, 60_000);
}

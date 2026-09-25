// SPLITS: upcoming stock splits and reverse splits, soonest first. Rows open the quote.

import { esc, panel, LOADING } from './markets.js';
import { sourceLine, symbolCell, symbolRow, fmtWeekday, dash } from './company-kit.js';

export function splitsTable(rows) {
  if (!rows.length) return '<p class="panel-msg">No splits listed.</p>';
  return `<table class="grid-table co-table sp-table">
    <thead><tr><th scope="col" class="co-date">Effective</th><th scope="col">Company</th><th scope="col" class="num">Ratio</th><th scope="col" class="chg">Kind</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${symbolRow(r.symbol)}>
      <td class="co-date num">${esc(r.date ? fmtWeekday(r.date) : dash)}</td>
      ${symbolCell(r.symbol, r.company)}
      <td class="num last">${esc(r.ratio || dash)}</td>
      <td class="chg dim">${r.reverse === null ? dash : r.reverse ? 'REVERSE' : 'FORWARD'}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = `${panel('1', 'Stock splits', LOADING, { cls: 'panel-solo', metaId: 'sp-meta', bodyCls: 'flush' })}
  <div id="sp-foot">${sourceLine('Nasdaq stock splits calendar')}</div>`;
  const body = el.querySelector('.panel-body');

  ctx.fetchJSON('/api/splits', { signal: ctx.signal }).then((d) => {
    body.innerHTML = splitsTable(d.rows);
    el.querySelector('#sp-meta').textContent = `${d.rows.length} SPLITS`;
    el.querySelector('#sp-foot').innerHTML = sourceLine(d.source, 'Ratio = new shares : old shares. 3:1 means each share becomes three; 1:10 (a reverse split) means ten shares become one.');
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    ctx.status('SPLITS: NO DATA', 'warn');
  });
}

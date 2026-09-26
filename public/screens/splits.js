// SPLITS: upcoming stock splits and reverse splits, soonest first. Rows open the quote.

import { esc, panel, LOADING } from './markets.js';
import { metaNote, symbolCell, symbolRow, fmtWeekday, dash } from './company-kit.js';

export function splitsTable(rows) {
  if (!rows.length) return '<p class="panel-msg">No splits listed.</p>';
  return `<table class="grid-table co-table sp-table">
    <thead><tr><th scope="col" class="co-date">Effective</th><th scope="col">Company</th><th scope="col" class="num">Ratio</th><th scope="col" class="co-kind">Kind</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${symbolRow(r.symbol)}>
      <td class="co-date">${esc(r.date ? fmtWeekday(r.date) : dash)}</td>
      ${symbolCell(r.symbol, r.company)}
      <td class="num last">${esc(r.ratio || dash)}</td>
      <td class="co-kind dim">${r.reverse === null ? dash : r.reverse ? '<span class="m-hide">REVERSE</span><span class="m-only">REV</span>' : '<span class="m-hide">FORWARD</span><span class="m-only">FWD</span>'}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = `${panel('1', 'Stock splits', LOADING, { cls: 'panel-solo', metaId: 'sp-meta', bodyCls: 'flush' })}`;
  const body = el.querySelector('.panel-body');

  ctx.fetchJSON('/api/splits', { signal: ctx.signal }).then((d) => {
    body.innerHTML = splitsTable(d.rows);
    el.querySelector('#sp-meta').innerHTML = `${d.rows.length} SPLITS · ${metaNote('RATIO = NEW SHARES : OLD', '3:1 means each share becomes three; 1:10 (a reverse split) means ten shares become one.')}`;
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    ctx.status('SPLITS: NO DATA', 'warn');
  });
}

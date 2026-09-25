// IPOS: the IPO calendar. Upcoming (expected date and price range), priced (the offer
// price) and filed (paperwork in, no date yet). Rows with a symbol open its quote.

import { esc, fmtNum, panel, LOADING } from './markets.js';
import { sourceLine, symbolCell, symbolRow, fmtBig, fmtBigMoney, dash } from './company-kit.js';

export function priceText(low, high) {
  if (!Number.isFinite(low)) return dash;
  return Number.isFinite(high) && high !== low ? `$${fmtNum(low, 2)}-${fmtNum(high, 2)}` : `$${fmtNum(low, 2)}`;
}

export function ipoTable(rows, { kind }) {
  if (!rows.length) return '<p class="panel-msg">None listed.</p>';
  const filed = kind === 'filed';
  return `<table class="grid-table co-table ipo-table">
    <thead><tr><th scope="col" class="co-date">${kind === 'upcoming' ? 'Expected' : kind === 'priced' ? 'Priced' : 'Filed'}</th><th scope="col">Company</th>${filed ? '' : `<th scope="col" class="time">Exchange</th><th scope="col" class="num">${kind === 'upcoming' ? 'Price range' : 'Price'}</th><th scope="col" class="num chg">Shares</th>`}<th scope="col" class="num${filed ? '' : ' time'}">Offer</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${symbolRow(r.symbol)}>
      <td class="co-date num">${esc(r.date || dash)}</td>
      ${symbolCell(r.symbol, r.company)}
      ${filed ? '' : `<td class="time dim">${esc(r.exchange || dash)}</td>
      <td class="num last">${esc(priceText(r.priceLow, r.priceHigh))}</td>
      <td class="num chg">${esc(fmtBig(r.shares))}</td>`}
      <td class="num${filed ? '' : ' time'}">${esc(fmtBigMoney(r.amount))}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="stack">
    ${panel('1', 'IPOs: upcoming', LOADING, { metaId: 'ipo-m1', bodyCls: 'flush' })}
    ${panel('2', 'IPOs: priced', LOADING, { metaId: 'ipo-m2', bodyCls: 'flush' })}
    ${panel('3', 'IPOs: filed', LOADING, { metaId: 'ipo-m3', bodyCls: 'flush' })}
  </div>
  <div id="ipo-foot">${sourceLine('Nasdaq IPO calendar')}</div>`;
  const bodies = el.querySelectorAll('.panel-body');

  ctx.fetchJSON('/api/ipos', { signal: ctx.signal }).then((d) => {
    ['upcoming', 'priced', 'filed'].forEach((kind, i) => {
      bodies[i].innerHTML = ipoTable(d[kind], { kind });
      el.querySelector(`#ipo-m${i + 1}`).textContent = `${d[kind].length} DEALS`;
    });
    el.querySelector('#ipo-foot').innerHTML = sourceLine(d.source, 'Upcoming covers this month and next; priced and filed cover this month and last. Offer = the dollar amount of the offering, as published. Dates are what the source lists and can move.');
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    bodies[0].innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    bodies[1].closest('.panel').hidden = true;
    bodies[2].closest('.panel').hidden = true;
    ctx.status('IPOS: NO DATA', 'warn');
  });
}

// IPOS: the IPO calendar. Upcoming (expected date and price range), priced (the offer
// price) and filed (paperwork in, no date yet). Rows with a symbol open its quote.

import { esc, fmtNum, panel, LOADING } from './markets.js';
import { metaNote, symbolCell, symbolRow, fmtBig, fmtBigMoney, dash } from './company-kit.js';
import { moreButton, fmtDate } from '../kit.js';

export function priceText(low, high) {
  if (!Number.isFinite(low)) return dash;
  return Number.isFinite(high) && high !== low ? `$${fmtNum(low, 2)}-${fmtNum(high, 2)}` : `$${fmtNum(low, 2)}`;
}

// FILED is long (70 or more deals): the newest FILED_SHOWN, then a button for the rest.
export const FILED_SHOWN = 10;

export function ipoTable(rows, { kind }) {
  if (!rows.length) return '<p class="panel-msg">None listed.</p>';
  const filed = kind === 'filed';
  return `<table class="grid-table co-table ipo-table">
    <thead><tr><th scope="col" class="co-date">${kind === 'upcoming' ? 'Expected' : kind === 'priced' ? 'Priced' : 'Filed'}</th><th scope="col">Company</th>${filed ? '' : `<th scope="col" class="time">Exchange</th><th scope="col" class="num">${kind === 'upcoming' ? 'Price range' : 'Price'}</th><th scope="col" class="num chg">Shares</th>`}<th scope="col" class="num${filed ? '' : ' time'}">Offer</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${symbolRow(r.symbol)}>
      <td class="co-date">${esc(r.date ? fmtDate(r.date, 'table') : dash)}</td>
      ${symbolCell(r.symbol, r.company)}
      ${filed ? '' : `<td class="time dim">${esc(r.exchange || dash)}</td>
      <td class="num last">${esc(priceText(r.priceLow, r.priceHigh))}</td>
      <td class="num chg">${esc(fmtBig(r.shares))}</td>`}
      <td class="num${filed ? '' : ' time'}">${esc(fmtBigMoney(r.amount))}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// Which months each list covers. Upcoming dates are the source's and can move.
const SPAN = { upcoming: 'THIS MONTH AND NEXT, DATES CAN MOVE', priced: 'THIS MONTH AND LAST', filed: 'THIS MONTH AND LAST' };

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="stack">
    ${panel('1', 'IPOs: upcoming', LOADING, { metaId: 'ipo-m1', bodyCls: 'flush' })}
    ${panel('2', 'IPOs: priced', LOADING, { metaId: 'ipo-m2', bodyCls: 'flush' })}
    ${panel('3', 'IPOs: filed', LOADING, { metaId: 'ipo-m3', bodyCls: 'flush' })}
  </div>`;
  const bodies = el.querySelectorAll('.panel-body');

  ctx.fetchJSON('/api/ipos', { signal: ctx.signal }).then((d) => {
    ['upcoming', 'priced', 'filed'].forEach((kind, i) => {
      const cut = kind === 'filed' && d[kind].length > FILED_SHOWN;
      bodies[i].innerHTML = ipoTable(cut ? d[kind].slice(0, FILED_SHOWN) : d[kind], { kind })
        + (cut ? moreButton(`SHOW ALL ${d[kind].length}`, 'data-ipo-more') : '');
      const meta = el.querySelector(`#ipo-m${i + 1}`);
      const note = ` · ${metaNote(SPAN[kind])}`;
      meta.innerHTML = `${cut ? `${FILED_SHOWN} OF ${d[kind].length} DEALS` : `${d[kind].length} DEALS`}${note}`;
      bodies[i].querySelector('[data-ipo-more]')?.addEventListener('click', () => { bodies[i].innerHTML = ipoTable(d[kind], { kind }); meta.innerHTML = `${d[kind].length} DEALS${note}`; });
    });
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    bodies[0].innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    bodies[1].closest('.panel').hidden = true;
    bodies[2].closest('.panel').hidden = true;
    ctx.status('IPOS: NO DATA', 'warn');
  });
}

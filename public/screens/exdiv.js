// EXDIV [YYYY-MM-DD]: stocks going ex-dividend over the next five weekdays, or on one
// day. Shares bought on or after the ex-date do not get that dividend. Rows open the quote.

import { esc, q, fmtNum, panel, LOADING } from './markets.js';
import { metaNote, symbolCell, symbolRow, fmtWeekday, dash } from './company-kit.js';
import { fmtDate, usageCard } from '../kit.js';
import { parseExdiv as parse } from '../command-args.js'; // the words it takes: read at startup (command-args.js)
export { parse };

const PER_DAY = 15;

const cash = (n) => (Number.isFinite(n) ? `$${fmtNum(n, n < 0.1 ? 4 : n < 1 ? 3 : 2)}` : dash);

const day = (d) => (d ? fmtDate(d, 'table') : dash);

export function exdivTable(rows) {
  return `<table class="grid-table co-table xd-table">
    <thead><tr><th scope="col">Company</th><th scope="col" class="num">Dividend</th><th scope="col" class="num chg">Per year</th><th scope="col" class="co-date time">Record</th><th scope="col" class="co-date time">Paid</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${symbolRow(r.symbol)}>
      ${symbolCell(r.symbol, r.company)}
      <td class="num last">${esc(cash(r.dividend))}</td>
      <td class="num chg">${esc(cash(r.annual))}</td>
      <td class="co-date time dim">${esc(day(r.record))}</td>
      <td class="co-date time dim">${esc(day(r.paid))}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// Typed wrong: the kit's usage card.
export function usage() {
  return usageCard({ problem: 'EXDIV takes nothing, or one day like 2026-10-01.', format: 'EXDIV [day]', example: 'EXDIV', more: ['EXDIV 2026-10-01'] });
}

// Ex-date: the first day a buyer does not get the next dividend.
const EX_NOTE = 'BUY BEFORE THIS DAY TO GET IT';
const EX_LONG = 'Ex-date = the first day a buyer does not get the next dividend. Dividend = this payment per share; per year = the historical annual dividend the source lists, -- where it lists none. A to Z by symbol.';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Ex-dividend dates', usage(), { cls: 'panel-solo' });
    ctx.status('EXDIV: CHECK THE FORMAT', 'warn');
    return;
  }
  const one = cmd.args.day;
  el.innerHTML = `<div id="xd-host">${panel('1', one ? `Ex-dividend ${one}` : 'Ex-dividend dates: next 5 weekdays', LOADING, { cls: 'panel-solo' })}</div>`;
  const host = el.querySelector('#xd-host');

  ctx.fetchJSON(`/api/exdiv${one ? `?d=${encodeURIComponent(one)}` : ''}`, { signal: ctx.signal }).then((d) => {
    const panels = d.days.map((x, i) => {
      const label = `Ex-dividend ${fmtWeekday(x.date)}`;
      if (x.rows === null) return panel(String(i + 1), label, '<p class="panel-msg">This day did not load. Try again in a minute.</p>');
      if (!x.rows.length) return panel(String(i + 1), label, `<p class="panel-msg">No ex-dividend dates listed for this day.</p>${x.dropped?.length ? `<p class="more dim">Left out: ${esc(x.dropped.map((r) => `${r.symbol || r.company} (${r.why})`).join(', '))}.</p>` : ''}`, { meta: '0 STOCKS' });
      const shown = d.single ? x.rows : x.rows.slice(0, PER_DAY);
      const c = `EXDIV ${x.date}`;
      const drop = x.dropped?.length ? `<p class="more dim">Left out: ${esc(x.dropped.map((r) => `${r.symbol || r.company} (${r.why})`).join(', '))}. The source's dates for ${x.dropped.length > 1 ? 'these rows' : 'this row'} cannot all be right.</p>` : '';
      const more = shown.length < x.rows.length ? `<p class="more"><a class="code" href="${esc(q(c))}" data-cmd="${esc(c)}">+${x.rows.length - shown.length} more on ${esc(x.date)}</a></p>` : '';
      return panel(String(i + 1), label, exdivTable(shown) + more + drop, { meta: `${x.rows.length} STOCKS${i ? '' : ` · ${metaNote(EX_NOTE, EX_LONG)}`}`, cmd: d.single ? '' : c, bodyCls: 'flush' });
    });
    host.innerHTML = d.single ? panels[0].replace('class="panel ', 'class="panel panel-solo ') : `<div class="stack">${panels.join('')}</div>`;
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    host.innerHTML = panel('1', 'Ex-dividend dates', `<p class="panel-msg">${esc(err.message)}</p>`, { cls: 'panel-solo' });
    ctx.status('EXDIV: NO DATA', 'warn');
  });
}

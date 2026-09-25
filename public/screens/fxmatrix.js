// FXMATRIX: cross rates for nine currencies. Row currency = 1 unit, column = what it buys.

import { esc, q, dirOf, panel, LOADING } from './markets.js';
import { fmtRate } from './fx.js';

// Day-on-day % change of one cell, or null.
export function cellChange(matrix, prev, a, b) {
  const now = matrix?.[a]?.[b];
  const before = prev?.[a]?.[b];
  return Number.isFinite(now) && before > 0 && a !== b ? ((now - before) / before) * 100 : null;
}

export function matrixTable(d) {
  const codes = d.codes;
  const head = `<tr><th scope="col" class="fxm-corner">1 unit of</th>${codes.map((c) => `<th scope="col" class="num">${esc(c)}</th>`).join('')}</tr>`;
  const rows = codes.map((a) => `<tr><th scope="row" class="fxm-row">${esc(a)}</th>${codes.map((b) => {
    if (a === b) return '<td class="num fxm-self">--</td>';
    const v = d.matrix[a][b];
    const chg = cellChange(d.matrix, d.prev, a, b);
    const cls = chg === null ? '' : dirOf(Math.round(chg * 100));
    const cmd = `FX 1 ${a} ${b}`;
    return `<td class="num"><a class="fxm-cell ${cls}" href="${esc(q(cmd))}" data-cmd="${esc(cmd)}" title="${esc(`1 ${a} = ${fmtRate(v)} ${b}`)}">${esc(fmtRate(v))}</a></td>`;
  }).join('')}</tr>`).join('');
  return `<div class="fxm-wrap"><table class="grid-table fxm"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

const fmtDay = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase() : '--');

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'FX matrix', LOADING, { cls: 'panel-solo', metaId: 'fxm-meta' })
    + '<p class="footnote">Read across: 1 unit of the row currency buys this much of the column currency. Green or red = up or down on the day before. ECB reference rates via Frankfurter, once a day. Tap a rate to convert.</p>';
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#fxm-meta');

  ctx.fetchJSON('/api/fxmatrix', { signal: ctx.signal }).then((d) => {
    body.innerHTML = matrixTable(d);
    meta.textContent = `${d.stale ? 'LAST KNOWN RATES' : 'ECB REFERENCE RATES'} ${fmtDay(d.date)}`;
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    ctx.status('FX MATRIX: NO DATA', 'warn');
  });
}

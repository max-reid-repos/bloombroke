// RATES: the interest rates that touch your money.

import { esc, fmtNum, fmtSigned, dirOf, fmtAsOf, panel, LOADING, tick, settleTicks, nameCell, rowAttrs, rerender } from './markets.js';
import { rangeChart } from './chart.js';
import { freshTag } from '../freshness.js';

const MOVES = {
  US2Y: 'Savings, CDs, car loans',
  US10Y: 'Mortgages, stock prices',
  US30Y: 'Long loans, pensions',
};

function isoDay(s) {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? fmtAsOf(s) : '--';
}

// Change in basis points (0.01 of a percent).
export function fmtBp(change) {
  if (!Number.isFinite(change)) return '--';
  return `${fmtSigned(change * 100, 1)} bp`;
}

// Every row opens something: a yield its chart, the Fed funds rows FEDPATH (where the
// rate is expected to go), the mortgage rows LOAN (a payment at that rate).
export function ratesRows(d) {
  const rows = [];
  if (d.fed) {
    rows.push({ id: 'FEDT', cmd: 'FEDPATH', name: 'Fed funds target', value: `${fmtNum(d.fed.from, 2)}-${fmtNum(d.fed.to, 2)}%`, chg: null, asOf: isoDay(d.fed.date), moves: 'Credit cards, savings' });
    if (Number.isFinite(d.fed.effective)) {
      rows.push({ id: 'EFFR', cmd: 'FEDPATH', name: 'Fed funds effective', value: `${fmtNum(d.fed.effective, 2)}%`, num: d.fed.effective, chg: null, asOf: isoDay(d.fed.date), moves: 'Overnight bank loans' });
    }
  }
  for (const y of d.yields || []) {
    rows.push({ id: y.id, cmd: y.id, name: y.name, value: `${fmtNum(y.last, 3)}%`, num: y.last, chg: y.change, asOf: fmtAsOf(y.asOf), moves: MOVES[y.id] || '', item: y });
  }
  if (d.mortgage) {
    rows.push({ id: 'MORT30', cmd: 'LOAN 400000 30Y', name: '30-year fixed mortgage', value: `${fmtNum(d.mortgage.rate30, 2)}%`, num: d.mortgage.rate30, chg: d.mortgage.change30, asOf: isoDay(d.mortgage.date), moves: 'Home loans, weekly' });
    if (Number.isFinite(d.mortgage.rate15)) {
      rows.push({ id: 'MORT15', cmd: 'LOAN 400000 15Y', name: '15-year fixed mortgage', value: `${fmtNum(d.mortgage.rate15, 2)}%`, num: d.mortgage.rate15, chg: d.mortgage.change15, asOf: isoDay(d.mortgage.date), moves: 'Home loans, weekly' });
    }
  }
  return rows;
}

function table(rows) {
  return `<table class="grid-table rates">
    <thead><tr><th scope="col">Rate</th><th scope="col" class="tag"><span class="offscreen">Real time or delayed</span></th><th scope="col" class="num">Last</th><th scope="col" class="num bp">Chg</th><th scope="col" class="num time">As of</th><th scope="col" class="moves">What it moves</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${rowAttrs(r.cmd)}>
      ${nameCell(r.name, r.cmd)}
      <td class="tag">${freshTag(r.item)}</td>
      <td class="num last${Number.isFinite(r.num) ? tick(`rt:${r.id}`, r.num) : ''}">${esc(r.value)}</td>
      <td class="num bp ${Number.isFinite(r.chg) ? dirOf(Math.round(r.chg * 1000)) : 'flat'}">${esc(Number.isFinite(r.chg) ? fmtBp(r.chg) : '--')}</td>
      <td class="num time dim">${esc(r.asOf)}</td>
      <td class="moves dim">${esc(r.moves)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="stack">
    ${panel('1', 'Rates', LOADING, { metaId: 'rt-meta', meta: 'US, PERCENT A YEAR' })}
    ${panel('2', 'US 10-year yield', '<div class="rc" id="rt-rc"></div>', { cmd: 'US10Y', metaId: 'rt-ch-meta', bodyCls: 'flush' })}
  </div>`
    + `<p class="footnote">Treasury yields: CNBC, real time (RT). Fed funds: Federal Reserve Bank of New York, daily. Mortgages: Freddie Mac weekly survey (WEEKLY). 1 bp = 0.01%. Not financial advice.</p>`;
  const body = el.querySelector('.panel-body');

  const chart = rangeChart(el.querySelector('#rt-rc'), ctx, {
    symbol: 'US10Y', range: { range: '1Y' }, meta: el.querySelector('#rt-ch-meta'),
    label: 'US 10-year Treasury yield', bp: true, decimals: 3, fmtY: (v) => `${fmtNum(v, 2)}%`,
  });

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/rates', { signal: ctx.signal });
      const rows = ratesRows(d);
      rerender(body, rows.length ? table(rows) : '<p class="panel-msg">Rate data is taking a break.</p>');
      settleTicks(body);
      ctx.updated(d.yieldsUpdated || d.updated, d.stale, d.yields);
      const ten = (d.yields || []).find((y) => y.id === 'US10Y');
      if (ten) chart.setLive({ t: Date.parse(ten.asOf), v: ten.last });
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH RATES', 'warn');
    }
  }

  load();
  ctx.live(load, 15_000);
}

// RATES: the interest rates that touch your money.

import { esc, fmtNum, fmtSigned, dirOf, fmtAsOf, panel, LOADING, tick, settleTicks } from './markets.js';
import { mountChart, fmtXFor, fmtHoverFor } from './quote.js';

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

export function ratesRows(d) {
  const rows = [];
  if (d.fed) {
    rows.push({ id: 'FEDT', name: 'Fed funds target', value: `${fmtNum(d.fed.from, 2)}-${fmtNum(d.fed.to, 2)}%`, chg: null, asOf: isoDay(d.fed.date), moves: 'Credit cards, savings' });
    if (Number.isFinite(d.fed.effective)) {
      rows.push({ id: 'EFFR', name: 'Fed funds effective', value: `${fmtNum(d.fed.effective, 2)}%`, num: d.fed.effective, chg: null, asOf: isoDay(d.fed.date), moves: 'Overnight bank loans' });
    }
  }
  for (const y of d.yields || []) {
    rows.push({ id: y.id, name: y.name, value: `${fmtNum(y.last, 3)}%`, num: y.last, chg: y.change, asOf: fmtAsOf(y.asOf), moves: MOVES[y.id] || '' });
  }
  if (d.mortgage) {
    rows.push({ id: 'MORT30', name: '30-year fixed mortgage', value: `${fmtNum(d.mortgage.rate30, 2)}%`, num: d.mortgage.rate30, chg: d.mortgage.change30, asOf: isoDay(d.mortgage.date), moves: 'Home loans, weekly' });
    if (Number.isFinite(d.mortgage.rate15)) {
      rows.push({ id: 'MORT15', name: '15-year fixed mortgage', value: `${fmtNum(d.mortgage.rate15, 2)}%`, num: d.mortgage.rate15, chg: d.mortgage.change15, asOf: isoDay(d.mortgage.date), moves: 'Home loans, weekly' });
    }
  }
  return rows;
}

function table(rows) {
  return `<table class="grid-table rates">
    <thead><tr><th scope="col">Rate</th><th scope="col" class="num">Last</th><th scope="col" class="num bp">Chg</th><th scope="col" class="num time">As of</th><th scope="col" class="moves">What it moves</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <th scope="row" class="name">${esc(r.name)}</th>
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
    ${panel('2', 'US 10-year yield 1Y', `<div class="chart-host" id="rt-chart">${LOADING}</div>`, { metaId: 'rt-ch-meta', bodyCls: 'flush' })}
  </div>`
    + `<p class="footnote">Treasury yields: CNBC. Fed funds: New York Fed. Mortgages: Freddie Mac weekly survey. 1 bp = 0.01%. Not financial advice.</p>`;
  const body = el.querySelector('.panel-body');
  const host = el.querySelector('#rt-chart');
  const chMeta = el.querySelector('#rt-ch-meta');
  let chartCleanup = null;
  ctx.onCleanup(() => chartCleanup?.());

  async function loadChart() {
    try {
      const d = await ctx.fetchJSON('/api/chart?s=US10Y&r=1Y', { signal: ctx.signal });
      const pts = d.points;
      const chg = pts[pts.length - 1].v - pts[0].v;
      const base = `<span class="num ${dirOf(Math.round(chg * 1000))}">${esc(fmtBp(chg))}</span> <span class="dim">1Y</span>`;
      const hover = fmtHoverFor('1Y');
      chMeta.innerHTML = base;
      chartCleanup?.();
      host.textContent = '';
      chartCleanup = mountChart(host, pts, {
        fmtY: (v) => `${fmtNum(v, 2)}%`, fmtX: fmtXFor('1Y'), label: 'US 10-year Treasury yield, 1 year',
        onHover: (p) => { chMeta.innerHTML = p ? `<span class="num">${esc(hover(p.t))} ${esc(fmtNum(p.v, 3))}%</span>` : base; },
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!host.querySelector('svg')) host.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    }
  }

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/rates', { signal: ctx.signal });
      const rows = ratesRows(d);
      body.innerHTML = rows.length ? table(rows) : '<p class="panel-msg">Rate data is taking a break.</p>';
      settleTicks(body);
      ctx.updated(d.yieldsUpdated || d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH RATES', 'warn');
    }
  }

  load();
  loadChart();
  ctx.every(load, 60_000);
  ctx.every(loadChart, 15 * 60_000);
}

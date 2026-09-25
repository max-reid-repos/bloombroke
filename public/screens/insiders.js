// INSIDERS <ticker>: what the company's officers and directors bought and sold, newest
// first, plus open-market buys against sells over 3 and 12 months, and a chart of the
// dollar value bought and sold each month.

import { esc, panel, LOADING } from './markets.js';
import { mountFnBar, sourceLine, errorHtml, tickerUsage, fmtInt, fmtMoney, fmtBigMoney, fmtDay, dash } from './company-kit.js';
import { panelTools, moreButton, dataTable, sortRows, nextSort } from '../kit.js';
import { mountBars, barsLegend } from './minibars.js';

export { parseTicker as parse } from './company-kit.js';

const KIND_CLS = { BUY: 'up', 'PLAN BUY': 'up', SELL: 'down', 'PLAN SELL': 'down' };
export const PAGE = 40;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function totalsTable(t) {
  const row = (label, k, cls = '') => `<tr><th scope="row" class="name">${esc(label)}</th><td class="num ${cls}">${fmtInt(t.m3[k])}</td><td class="num ${cls}">${fmtInt(t.m12[k])}</td></tr>`;
  return `<table class="grid-table co-totals">
    <thead><tr><th scope="col">Insider trades</th><th scope="col" class="num">3 months</th><th scope="col" class="num">12 months</th></tr></thead>
    <tbody>
      ${row('Open-market buys', 'buys', 'up')}
      ${row('Sells', 'sells', 'down')}
      ${row('Shares bought', 'sharesBought')}
      ${row('Shares sold', 'sharesSold')}
      ${row('Net shares', 'netShares', 'last')}
    </tbody>
  </table>`;
}

// The last 12 calendar months up to the newest trade's month: dollars bought (BUY, PLAN
// BUY) and sold (SELL, PLAN SELL), as filed. Sells are negative so they draw down.
// complete: false when the source has older rows than we fetched, so months before the
// oldest fetched row are left out rather than shown as zero.
export function monthlyTotals(rows, months = 12, { complete = true } = {}) {
  const dated = rows.filter((r) => /^\d{4}-\d{2}/.test(r.date || ''));
  if (!dated.length) return [];
  const newest = dated.map((r) => r.date).sort().pop();
  let y = Number(newest.slice(0, 4));
  let m = Number(newest.slice(5, 7));
  const out = [];
  for (let i = 0; i < months; i += 1) {
    out.unshift({ key: `${y}-${String(m).padStart(2, '0')}`, label: MONTHS[m - 1], buys: 0, sells: 0 });
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  if (!complete) {
    const oldest = dated.map((r) => r.date.slice(0, 7)).sort()[0];
    while (out.length && out[0].key < oldest) out.shift();
  }
  const byKey = new Map(out.map((o) => [o.key, o]));
  for (const r of dated) {
    const o = byKey.get(r.date.slice(0, 7));
    if (!o || !Number.isFinite(r.value)) continue;
    if (r.kind === 'BUY' || r.kind === 'PLAN BUY') o.buys += r.value;
    else if (r.kind === 'SELL' || r.kind === 'PLAN SELL') o.sells -= r.value;
  }
  return out;
}

const COLUMNS = [
  { key: 'date', label: 'Date', cls: 'date', fmt: (v) => esc(fmtDay(v)) },
  { key: 'insider', label: 'Insider', name: true },
  { key: 'title', label: 'Title', cls: 'dim hide-m', fmt: (v) => esc(v || dash) },
  { key: 'kind', label: 'Type', cls: 'co-kind', fmt: (v, r) => `<span class="${KIND_CLS[v] || 'dim'}" title="${esc(r.transaction || '')}">${esc(v || dash)}</span>` },
  { key: 'shares', label: 'Shares', num: true, cls: 'hide-m', fmt: (v) => fmtInt(v) },
  { key: 'price', label: 'Price', num: true, cls: 'hide-m', fmt: (v) => fmtMoney(v) },
  { key: 'value', label: 'Value', num: true, fmt: (v) => fmtBigMoney(v) },
];

export function insidersTable(rows, sort = { key: 'date', dir: 'desc' }) {
  if (!rows.length) return '<p class="panel-msg">No transactions listed.</p>';
  return dataTable({ columns: COLUMNS, rows, sort, caption: 'Insider transactions' });
}

const NOTE = 'Types: BUY and SELL are open-market trades; PLAN SELL is a sale under a pre-set trading plan (10b5-1); AWARD and DISPOSED are shares acquired or given up outside the open market; OPTION is an option exercise. Value = shares x price, as filed. The monthly chart adds up the value of BUY and PLAN BUY, and of SELL and PLAN SELL.';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Insiders', tickerUsage('INSIDERS', ['INSIDERS AAPL', 'INSIDERS NVDA', 'INSIDERS JPM']), { cls: 'panel-solo' });
    ctx.status('INSIDERS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = `<div class="stack">
    ${panel('1', `${ticker} insider trades`, LOADING, { bodyCls: 'flush' })}
    ${panel('2', 'Recent transactions', LOADING, { metaId: 'ins-meta', bodyCls: 'flush' })}
  </div>
  <div id="ins-foot">${sourceLine('Nasdaq insider activity (SEC Forms 3, 4 and 5)')}</div>`;
  mountFnBar(el, ctx, ticker, 'INSIDERS');
  const [top, list] = el.querySelectorAll('.panel-body');
  let stopChart = null;
  ctx.onCleanup(() => stopChart?.());

  ctx.fetchJSON(`/api/insiders?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    const months = monthlyTotals(d.rows, 12, { complete: !(d.totalRecords > d.rows.length) });
    const traded = months.some((o) => o.buys || o.sells);
    const series = [{ key: 'buys', cls: 'mb-up', label: 'Bought, $' }, { key: 'sells', cls: 'mb-down', label: 'Sold, $' }];
    top.innerHTML = `<div class="with-side side-hug co-wide">
        <div>${totalsTable(d.totals)}</div>
        <aside class="side-panel" aria-label="Insider buys and sells by month">
          <p class="side-title tag">Bought and sold by month, $ value</p>
          ${traded ? `<div class="side-chart" id="ins-chart"></div>${barsLegend(series)}` : '<p class="side-empty">No open-market buys or sells in these months.</p>'}
        </aside>
      </div>`;
    if (traded) {
      stopChart = mountBars(top.querySelector('#ins-chart'), months.map((o) => ({ label: o.label, values: { buys: o.buys, sells: o.sells } })), series, {
        stack: true, label: 'Insider dollars bought and sold by month', fmtY: (v) => (v ? `${v < 0 ? '-' : ''}${fmtBigMoney(Math.abs(v))}` : '0'),
      });
    }

    let sort = { key: 'date', dir: 'desc' };
    let shown = PAGE;
    const meta = el.querySelector('#ins-meta');
    function draw() {
      const all = sortRows(d.rows, sort.key, sort.dir);
      list.innerHTML = `<div class="co-wide">${insidersTable(all.slice(0, shown), sort)}</div>${shown < all.length ? moreButton(`MORE (${all.length - shown} LEFT)`, 'data-more') : ''}`;
      const total = Number.isFinite(d.totalRecords) ? Math.max(d.totalRecords, all.length) : all.length;
      meta.innerHTML = panelTools({ shown: Math.min(shown, all.length), total });
    }
    list.addEventListener('click', (e) => {
      const th = e.target.closest('.th-sort');
      if (th) {
        const col = COLUMNS.find((c) => c.key === th.dataset.sort);
        sort = nextSort(sort, col.key, Boolean(col.num));
        draw();
        list.querySelector(`.th-sort[data-sort="${col.key}"]`)?.focus();
        return;
      }
      if (e.target.closest('[data-more]')) { shown += PAGE; draw(); }
    });
    draw();
    el.querySelector('#ins-foot').innerHTML = sourceLine(d.source, NOTE);
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    top.innerHTML = `<div class="co-pad">${errorHtml(err, ticker)}</div>`;
    list.closest('.panel').hidden = true;
    ctx.status(err.status === 404 ? `NO INSIDER DATA FOR ${ticker}` : 'INSIDERS: NO DATA', 'warn');
  });
}

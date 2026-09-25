// OWNERS <ticker>: the biggest institutional holders (from their 13F filings) and how
// many funds added, trimmed, opened or closed a position last quarter.

import { esc, fmtSigned, dirOf, panel, LOADING } from './markets.js';
import { sourceLine, errorHtml, tickerUsage, fmtInt, fmtBig, fmtBigMoney, fmtPlainPct, fmtDay, dash } from './company-kit.js';
import { panelTools, dataTable, sortRows, nextSort } from '../kit.js';

export { parseTicker as parse } from './company-kit.js';

const signedInt = (n) => (Number.isFinite(n) ? fmtSigned(n, 0) : dash);
const signedPct = (n) => (Number.isFinite(n) ? `${fmtSigned(n, 2)}%` : dash);

export function summaryHtml(s) {
  const pos = (label, p, cls = '') => `<tr><th scope="row" class="name">${esc(label)}</th><td class="num ${cls}">${fmtInt(p.holders)}</td><td class="num">${fmtBig(p.shares)}</td></tr>`;
  return `<div class="co-split">
    <dl class="stats">
      <div class="stat"><dt>Held by institutions</dt><dd class="num">${fmtPlainPct(s.institutionalPct)}</dd></div>
      <div class="stat"><dt>Institutional holders</dt><dd class="num">${fmtInt(s.total.holders)}</dd></div>
      <div class="stat"><dt>Shares outstanding</dt><dd class="num">${fmtBig(s.sharesOutstanding)}</dd></div>
      <div class="stat"><dt>Value held</dt><dd class="num">${fmtBigMoney(s.totalValue)}</dd></div>
    </dl>
    <table class="grid-table co-pos">
      <thead><tr><th scope="col">Positions</th><th scope="col" class="num">Holders</th><th scope="col" class="num">Shares</th></tr></thead>
      <tbody>
        ${pos('Increased', s.increased, 'up')}
        ${pos('Decreased', s.decreased, 'down')}
        ${pos('New', s.new, 'up')}
        ${pos('Sold out', s.soldOut, 'down')}
        ${pos('Unchanged', s.held)}
      </tbody>
    </table>
  </div>`;
}

const COLUMNS = [
  { key: 'holder', label: 'Holder', name: true },
  { key: 'shares', label: 'Shares', num: true, cls: 'last', fmt: (v) => fmtBig(v) },
  { key: 'pctOfShares', label: '% of shares', num: true, fmt: (v) => fmtPlainPct(v) },
  { key: 'change', label: 'Change', num: true, cls: 'hide-m', fmt: (v) => `<span class="${dirOf(v)}">${signedInt(v)}</span>` },
  { key: 'changePct', label: 'Chg %', num: true, fmt: (v) => `<span class="${dirOf(v)}">${signedPct(v)}</span>` },
  { key: 'value', label: 'Value', num: true, cls: 'hide-m', fmt: (v) => fmtBigMoney(v) },
  { key: 'asOf', label: 'As of', cls: 'date hide-m', fmt: (v) => esc(v ? fmtDay(v) : dash) },
];

export function holdersTable(rows, sort = { key: 'shares', dir: 'desc' }) {
  if (!rows.length) return '<p class="panel-msg">No holders listed.</p>';
  return dataTable({ columns: COLUMNS, rows: sortRows(rows, sort.key, sort.dir), sort, caption: 'Top institutional holders' });
}

const NOTE = 'Holdings as of each holder\'s latest 13F filing (the As of date). % of shares = shares held / shares outstanding, both from the source.';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Owners', tickerUsage('OWNERS', ['OWNERS AAPL', 'OWNERS MSFT', 'OWNERS KO']), { cls: 'panel-solo' });
    ctx.status('OWNERS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = `<div class="stack">
    ${panel('1', `${ticker} institutional owners`, LOADING)}
    ${panel('2', 'Top holders', LOADING, { metaId: 'own-meta', bodyCls: 'flush' })}
  </div>
  <div id="own-foot">${sourceLine('Nasdaq institutional holdings (SEC Form 13F)')}</div>`;
  const [top, list] = el.querySelectorAll('.panel-body');

  ctx.fetchJSON(`/api/owners?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    top.innerHTML = summaryHtml(d.summary);
    let sort = { key: 'shares', dir: 'desc' };
    const draw = () => { list.innerHTML = `<div class="co-wide">${holdersTable(d.rows, sort)}</div>`; };
    list.addEventListener('click', (e) => {
      const th = e.target.closest('.th-sort');
      if (!th) return;
      const col = COLUMNS.find((c) => c.key === th.dataset.sort);
      sort = nextSort(sort, col.key, Boolean(col.num));
      draw();
      list.querySelector(`.th-sort[data-sort="${col.key}"]`)?.focus();
    });
    draw();
    el.querySelector('#own-meta').innerHTML = panelTools(Number.isFinite(d.totalRecords) ? { shown: d.rows.length, total: d.totalRecords } : { total: d.rows.length });
    el.querySelector('#own-foot').innerHTML = sourceLine(d.source, NOTE);
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    top.innerHTML = errorHtml(err, ticker);
    list.closest('.panel').hidden = true;
    ctx.status(err.status === 404 ? `NO HOLDINGS DATA FOR ${ticker}` : 'OWNERS: NO DATA', 'warn');
  });
}

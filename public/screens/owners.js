// OWNERS <ticker>: the biggest institutional holders (from their 13F filings) and how
// many funds added, trimmed, opened or closed a position last quarter.

import { esc, fmtSigned, dirOf, panel, LOADING } from './markets.js';
import { metaNote, errorHtml, tickerUsage, fmtInt, fmtBig, fmtBigMoney, fmtPlainPct, fmtDay, dash } from './company-kit.js';
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

// Holders whose latest 13F is older than the newest quarter: greyed, apart from the top
// list, never in a total. Plain cells (no up or down colour) and no sorting.
const OLD_COLUMNS = COLUMNS.map((c) => ({ ...c, cls: c.cls === 'last' ? '' : c.cls, fmt: c.key === 'change' ? (v) => signedInt(v) : c.key === 'changePct' ? (v) => signedPct(v) : c.fmt }));

export function notRefiledHtml(rows, quarter) {
  if (!rows?.length) return '';
  return `<div class="co-wide dim own-old">
    <p class="panel-msg">Not refiled this quarter: latest 13F older than ${esc(quarter ? fmtDay(quarter) : 'the newest quarter')}. Left out of every total above, as the stake may now be filed by a successor.</p>
    ${dataTable({ columns: OLD_COLUMNS, rows, caption: 'Holders that have not refiled this quarter' })}
  </div>`;
}

// The short note in the title strip: what date the holdings are from, and what the
// totals count. A 13F gives holdings at a quarter end and is filed up to 45 days later.
export const OWNERS_13F = '13F: HOLDINGS AT QUARTER END, FILED UP TO 45 DAYS LATER';
export function ownersMeta(s) {
  return s?.quarterOnly ? `${OWNERS_13F} · TOTALS: ${fmtDay(s.quarter)} FILINGS ONLY` : OWNERS_13F;
}

// The long form of that note (its tooltip): what the totals count, and the source's own
// total when it differs.
export function ownersNote(s) {
  const base = 'Holdings as of each holder\'s latest 13F filing (the As of date). % of shares = shares held / shares outstanding, both from the source.';
  if (!s?.quarterOnly) return `${base} The source's totals count every holder's latest filing, old ones too.`;
  const n = s.notRefiled;
  const their = Number.isFinite(s.reported?.institutionalPct) ? ` The source's own total, with them, is ${fmtPlainPct(s.reported.institutionalPct)}.` : '';
  return `${base} Totals and the top list count only filings for ${fmtDay(s.quarter)}, summed from the source's full holder list: ${fmtInt(n.holders)} holders whose latest filing is older (${fmtBig(n.shares)} shares) are left out, so a stake that moved to a successor is not counted twice.${their} Sold out is the source's count.`;
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Owners', tickerUsage('OWNERS', ['OWNERS AAPL', 'OWNERS MSFT', 'OWNERS KO']), { cls: 'panel-solo' });
    ctx.status('OWNERS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = `<div class="stack">
    ${panel('1', `${ticker} institutional owners`, LOADING, { metaId: 'own-note' })}
    ${panel('2', 'Top holders', LOADING, { metaId: 'own-meta', bodyCls: 'flush' })}
  </div>`;
  const [top, list] = el.querySelectorAll('.panel-body');

  ctx.fetchJSON(`/api/owners?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    top.innerHTML = summaryHtml(d.summary);
    let sort = { key: 'shares', dir: 'desc' };
    const draw = () => { list.innerHTML = `<div class="co-wide">${holdersTable(d.rows, sort)}</div>${notRefiledHtml(d.notRefiled, d.summary?.quarter)}`; };
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
    el.querySelector('#own-note').innerHTML = metaNote(ownersMeta(d.summary), ownersNote(d.summary));
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    top.innerHTML = errorHtml(err, ticker);
    list.closest('.panel').hidden = true;
    ctx.status(err.status === 404 ? `NO HOLDINGS DATA FOR ${ticker}` : 'OWNERS: NO DATA', 'warn');
  });
}

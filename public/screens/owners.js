// OWNERS <ticker>: the biggest institutional holders (from their 13F filings) and how
// many funds added, trimmed, opened or closed a position last quarter.

import { esc, fmtSigned, dirOf, panel, LOADING } from './markets.js';
import { mountFnBar, sourceLine, errorHtml, tickerUsage, fmtInt, fmtBig, fmtBigMoney, fmtPlainPct, dash } from './company-kit.js';

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

export function holdersTable(rows) {
  if (!rows.length) return '<p class="panel-msg">No holders listed.</p>';
  return `<table class="grid-table co-table own-table">
    <thead><tr><th scope="col" class="num co-n">#</th><th scope="col">Holder</th><th scope="col" class="num">Shares</th><th scope="col" class="num">% of shares</th><th scope="col" class="num chg">Change</th><th scope="col" class="num time">Chg %</th><th scope="col" class="num chg">Value</th><th scope="col" class="num time">As of</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr>
      <td class="num co-n dim">${i + 1}</td>
      <th scope="row" class="name">${esc(r.holder)}</th>
      <td class="num last">${fmtBig(r.shares)}</td>
      <td class="num">${fmtPlainPct(r.pctOfShares)}</td>
      <td class="num chg ${dirOf(r.change)}">${signedInt(r.change)}</td>
      <td class="num time ${dirOf(r.changePct)}">${signedPct(r.changePct)}</td>
      <td class="num chg">${fmtBigMoney(r.value)}</td>
      <td class="num time dim">${esc(r.asOf || dash)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
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
  mountFnBar(el, ctx, ticker, 'OWNERS');
  const [top, list] = el.querySelectorAll('.panel-body');

  ctx.fetchJSON(`/api/owners?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    top.innerHTML = summaryHtml(d.summary);
    list.innerHTML = holdersTable(d.rows);
    el.querySelector('#own-meta').textContent = Number.isFinite(d.totalRecords) ? `TOP ${d.rows.length} OF ${fmtInt(d.totalRecords)}` : `${d.rows.length} HOLDERS`;
    el.querySelector('#own-foot').innerHTML = sourceLine(d.source, NOTE);
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    top.innerHTML = errorHtml(err, ticker);
    list.closest('.panel').hidden = true;
    ctx.status(err.status === 404 ? `NO HOLDINGS DATA FOR ${ticker}` : 'OWNERS: NO DATA', 'warn');
  });
}

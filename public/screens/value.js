// VALUE <ticker>: valuation and quality numbers straight from the source: P/E, forward
// P/E, price/sales, dividend yield, return on equity, margins, debt/equity, beta, the
// 52 week range and market cap. A number the source leaves out shows --.

import { esc, fmtNum, panel, LOADING } from './markets.js';
import { mountFnBar, sourceLine, errorHtml, tickerUsage, fmtBigMoney, fmtBig, fmtPlainPct, fmtDay, dash } from './company-kit.js';

export { parseTicker as parse } from './company-kit.js';

const x = (n) => (Number.isFinite(n) ? fmtNum(n, 2) : dash);
const money = (n) => (Number.isFinite(n) ? `$${fmtNum(n, 2)}` : dash);

export function valueGroups(d) {
  return [
    ['Valuation', [
      ['Market cap', fmtBigMoney(d.marketCap)],
      ['P/E (trailing)', x(d.pe)],
      ['P/E (forward)', x(d.forwardPe)],
      ['Price / sales', x(d.priceToSales)],
      ['EPS (trailing)', money(d.eps)],
      ['EPS (forward)', money(d.forwardEps)],
    ]],
    ['Quality', [
      ['Return on equity', fmtPlainPct(d.roe)],
      ['Net margin', fmtPlainPct(d.netMargin)],
      ['Gross margin', fmtPlainPct(d.grossMargin)],
      ['Debt / equity', fmtPlainPct(d.debtToEquity)],
      ['Revenue (12 months)', fmtBigMoney(d.revenue)],
      ['Shares out', fmtBig(d.sharesOut)],
    ]],
    ['Dividend and risk', [
      ['Dividend yield', fmtPlainPct(d.dividendYield)],
      ['Dividend per year', money(d.dividend)],
      ['Beta', x(d.beta)],
      ['52 week low', `${money(d.yearLow)}${d.yearLowDate ? ` <span class="dim co-when">${esc(fmtDay(d.yearLowDate))}</span>` : ''}`],
      ['52 week high', `${money(d.yearHigh)}${d.yearHighDate ? ` <span class="dim co-when">${esc(fmtDay(d.yearHighDate))}</span>` : ''}`],
      ['Last price', money(d.last)],
    ]],
  ];
}

function groupsHtml(d) {
  return `<div class="grid-3 co-groups">${valueGroups(d).map(([title, items]) => `<div>
    <p class="co-group">${esc(title)}</p>
    <dl class="stats">${items.map(([k, v]) => `<div class="stat"><dt>${esc(k)}</dt><dd class="num">${v}</dd></div>`).join('')}</dl>
  </div>`).join('')}</div>`;
}

const NOTE = 'Every number is as the source publishes it; none are computed here. Trailing = the last 12 months. Forward = the source\'s forward figure. Debt / equity is from the latest quarter. The source has no price/book figure.';

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'Value', tickerUsage('VALUE', ['VALUE AAPL', 'VALUE KO', 'VALUE JPM']), { cls: 'panel-solo' });
    ctx.status('VALUE: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = `${panel('1', `${ticker} valuation`, LOADING, { cls: 'panel-solo', metaId: 'val-meta' })}
  <div id="val-foot">${sourceLine('CNBC quote service')}</div>`;
  mountFnBar(el, ctx, ticker, 'VALUE');
  const body = el.querySelector('.panel-body');

  ctx.fetchJSON(`/api/value?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((d) => {
    body.innerHTML = `<p class="q-name co-title-line">${esc(d.name || ticker)}${d.exchange ? ` <span class="dim">${esc(d.exchange)}</span>` : ''}</p>${groupsHtml(d)}`;
    el.querySelector('#val-meta').textContent = d.currency && d.currency !== 'USD' ? `IN ${d.currency}` : '';
    el.querySelector('#val-foot').innerHTML = sourceLine(d.source, NOTE);
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = errorHtml(err, ticker);
    ctx.status(err.status === 404 ? `NO DATA FOR ${ticker}` : 'VALUE: NO DATA', 'warn');
  });
}

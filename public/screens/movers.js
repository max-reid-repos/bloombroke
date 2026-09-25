// MOVERS: top 10 gainers, losers and most traded in the S&P 100 today.

import { esc, q, fmtNum, fmtPct, dirOf, panel, LOADING } from './markets.js';

// 123456789 -> "123.5M"
export function fmtCompact(n) {
  if (!Number.isFinite(n)) return '--';
  const a = Math.abs(n);
  for (const [v, s] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (a >= v) return `${(n / v).toFixed(a / v >= 100 ? 0 : 1)}${s}`;
  }
  return String(Math.round(n));
}

// A row header that opens the ticker: bold symbol, dim name.
export function tickerCell(ticker, name) {
  return `<th scope="row" class="name"><a href="${esc(q(ticker))}" data-cmd="${esc(ticker)}"><span class="tk">${esc(ticker)}</span> <span class="tk-name">${esc(name || '')}</span></a></th>`;
}

function table(rows, { volume = false } = {}) {
  if (!rows.length) return '<p class="panel-msg">None right now.</p>';
  return `<table class="grid-table">
    <thead><tr><th scope="col">Ticker</th><th scope="col" class="num">Last</th><th scope="col" class="num">%Chg</th>${volume ? '<th scope="col" class="num">Volume</th>' : ''}</tr></thead>
    <tbody>${rows.map((s) => `<tr>
      ${tickerCell(s.ticker, s.name)}
      <td class="num last">${fmtNum(s.last, 2)}</td>
      <td class="num pct ${dirOf(s.changePct)}">${fmtPct(s.changePct)}</td>
      ${volume ? `<td class="num dim">${esc(fmtCompact(s.volume))}</td>` : ''}
    </tr>`).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="grid grid-3">
    ${panel('1', 'Top gainers', LOADING, { meta: 'S&P 100' })}
    ${panel('2', 'Top losers', LOADING, { meta: 'S&P 100' })}
    ${panel('3', 'Most active', LOADING, { meta: 'BY SHARES TRADED' })}
  </div>
  <p class="footnote">S&P 100 members, prices from CNBC, may be delayed. Tap a ticker for its chart. Not financial advice.</p>`;
  const [g, l, a] = el.querySelectorAll('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/movers', { signal: ctx.signal });
      g.innerHTML = table(d.gainers);
      l.innerHTML = table(d.losers);
      a.innerHTML = table(d.active, { volume: true });
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      [g, l, a].forEach((b) => { if (!b.querySelector('table')) b.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`; });
      ctx.status('COULD NOT REFRESH MOVERS', 'warn');
    }
  }

  load();
  ctx.every(load, 60_000);
}

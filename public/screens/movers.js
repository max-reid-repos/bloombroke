// MOVERS: top 10 gainers, losers and most traded in the S&P 100 today.

import { esc, q, fmtNum, fmtPct, dirOf, panel, LOADING, rowAttrs } from './markets.js';

// 123456789 -> "123.5M"
export function fmtCompact(n) {
  if (!Number.isFinite(n)) return '--';
  const a = Math.abs(n);
  for (const [v, s] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (a >= v) return `${(n / v).toFixed(a / v >= 100 ? 0 : 1)}${s}`;
  }
  return String(Math.round(n));
}

// A row header that opens the ticker: bold symbol (a link colour), dim name. In a row
// that opens the ticker itself (rowLink), the row takes the focus instead of the link.
export function tickerCell(ticker, name, { rowLink = false } = {}) {
  return `<th scope="row" class="name"><a href="${esc(q(ticker))}" data-cmd="${esc(ticker)}"${rowLink ? ' tabindex="-1"' : ''}><span class="tk">${esc(ticker)}</span> <span class="tk-name">${esc(name || '')}</span></a></th>`;
}

// Gainers and losers: LAST then %CHG. Most active leads with VOLUME, the number it is
// ranked by. Every row opens its ticker.
export function moversTable(rows, { volume = false } = {}) {
  if (!rows.length) return '<p class="panel-msg">None right now.</p>';
  const vol = (s) => `<td class="num vol">${esc(fmtCompact(s.volume))}</td>`;
  return `<table class="grid-table movers-table">
    <thead><tr><th scope="col">Ticker</th>${volume ? '<th scope="col" class="num">Volume</th>' : ''}<th scope="col" class="num">Last</th><th scope="col" class="num">%Chg</th></tr></thead>
    <tbody>${rows.map((s) => `<tr${rowAttrs(s.ticker)}>
      ${tickerCell(s.ticker, s.name, { rowLink: true })}
      ${volume ? vol(s) : ''}
      <td class="num last">${fmtNum(s.last, 2)}</td>
      <td class="num pct ${dirOf(s.changePct)}">${fmtPct(s.changePct)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// HOME's small movers panel: the top few gainers, then the top few losers.
export function moversCompact(d, n = 5) {
  const part = (label, rows) => (rows?.length ? `<tr class="group-row"><th colspan="3" scope="rowgroup">${esc(label)}</th></tr>${rows.slice(0, n).map((s) => `<tr${rowAttrs(s.ticker)}>
      ${tickerCell(s.ticker, s.name, { rowLink: true })}
      <td class="num last">${fmtNum(s.last, 2)}</td>
      <td class="num pct ${dirOf(s.changePct)}">${fmtPct(s.changePct)}</td>
    </tr>`).join('')}` : '');
  const body = part('Top gainers', d?.gainers) + part('Top losers', d?.losers);
  if (!body) return '<p class="panel-msg">None right now.</p>';
  return `<table class="grid-table movers-table">
    <thead><tr><th scope="col">S&amp;P 100</th><th scope="col" class="num">Last</th><th scope="col" class="num">%Chg</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="grid grid-3">
    ${panel('1', 'Top gainers', LOADING, { meta: 'S&P 100' })}
    ${panel('2', 'Top losers', LOADING, { meta: 'S&P 100' })}
    ${panel('3', 'Most active', LOADING, { meta: 'BY SHARES TRADED' })}
  </div>`;
  const [g, l, a] = el.querySelectorAll('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/movers', { signal: ctx.signal });
      g.innerHTML = moversTable(d.gainers);
      l.innerHTML = moversTable(d.losers);
      a.innerHTML = moversTable(d.active, { volume: true });
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

// CRYPTO: the top 20 coins by market cap, with 24 hour and 7 day change.

import { esc, q, fmtNum, fmtPct, dirOf, panel, LOADING, tick, settleTicks } from './markets.js';
import { fmtCompact } from './movers.js';

// Coins cost anything from $0.0000x to $100,000: keep 4 significant digits for small ones.
export function fmtPrice(n) {
  if (!Number.isFinite(n)) return '--';
  if (n >= 1) return fmtNum(n, 2);
  if (n <= 0) return '0';
  const digits = Math.min(10, 3 - Math.floor(Math.log10(n)));
  return fmtNum(n, digits);
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Crypto', LOADING, { cls: 'panel-solo', metaId: 'cr-meta', meta: 'TOP 20 BY MARKET CAP, USD' })
    + '<p class="footnote">Prices from CoinGecko. Crypto trades all day, every day. Not financial advice.</p>';
  const body = el.querySelector('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/crypto', { signal: ctx.signal });
      body.innerHTML = `<table class="grid-table crypto-table">
        <thead><tr><th scope="col" class="num rank">#</th><th scope="col">Coin</th><th scope="col" class="num">Price</th><th scope="col" class="num">24H</th><th scope="col" class="num">7D</th><th scope="col" class="num chg">Mkt cap</th><th scope="col" class="num time">Volume 24H</th></tr></thead>
        <tbody>${d.coins.map((c) => `<tr>
          <td class="num rank dim">${esc(c.rank ?? '--')}</td>
          <th scope="row" class="name">${c.cmd ? `<a href="${esc(q(c.cmd))}" data-cmd="${esc(c.cmd)}">` : ''}<span class="tk">${esc(c.symbol)}</span> <span class="tk-name">${esc(c.name)}</span>${c.cmd ? '</a>' : ''}</th>
          <td class="num last${tick(`cr:${c.id}`, c.price)}">${fmtPrice(c.price)}</td>
          <td class="num ${dirOf(c.change24h)}">${fmtPct(c.change24h)}</td>
          <td class="num ${dirOf(c.change7d)}">${fmtPct(c.change7d)}</td>
          <td class="num chg">${esc(fmtCompact(c.marketCap))}</td>
          <td class="num time dim">${esc(fmtCompact(c.volume))}</td>
        </tr>`).join('')}</tbody>
      </table>`;
      settleTicks(body);
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH CRYPTO', 'warn');
    }
  }

  load();
  ctx.every(load, 60_000);
}

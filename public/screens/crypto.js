// CRYPTO: the top 20 coins by market cap, excluding stablecoins and tokenised
// assets, with 24 hour and 7 day change. # is CoinGecko's own market cap rank.

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

// CoinGecko's terms ask for a credit with a link wherever its data shows.
const CRYPTO_META = 'TOP 20, NO STABLECOINS OR TOKENISED ASSETS, USD · Powered by <a href="https://www.coingecko.com/" target="_blank" rel="noopener noreferrer" title="Data provided by CoinGecko">CoinGecko</a>';

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Crypto', LOADING, { cls: 'panel-solo', metaId: 'cr-meta', meta: CRYPTO_META });
  const body = el.querySelector('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/crypto', { signal: ctx.signal });
      body.innerHTML = `<table class="grid-table crypto-table">
        <thead><tr><th scope="col" class="num rank" title="Market cap rank, stablecoins included">#</th><th scope="col">Coin</th><th scope="col" class="num">Price</th><th scope="col" class="num">24H</th><th scope="col" class="num">7D</th><th scope="col" class="num chg">Mkt cap</th><th scope="col" class="num time">Volume 24H</th></tr></thead>
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
      // Which coins were left out: a tooltip on the title strip, not a line under the table.
      const meta = el.querySelector('#cr-meta');
      if (d.excluded?.length) meta.title = `Left out: ${d.excluded.map((c) => `${c.symbol} (${c.why})`).join(', ')}`;
      else meta.removeAttribute('title');
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

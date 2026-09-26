// TRENDING: the tickers opened most on Bloombroke. Each browser tab counts once per
// ticker per hour, so the numbers are opens, not people. The last hour, or the last 24
// hours when the hour is too quiet. A count only.

import { esc, fmtNum, fmtPct, dirOf, panel, LOADING, rowAttrs } from './markets.js';
import { tickerCell } from './movers.js';

export const QUIET = 'Quiet right now.';

export function opensText(n) {
  return `${Number(n).toLocaleString('en-US')} ${n === 1 ? 'open' : 'opens'}`;
}

// A price with the instrument's decimals; small prices (a coin under $1) keep 4 digits.
export function fmtLast(n, decimals) {
  if (!Number.isFinite(n)) return '--';
  if (Number.isInteger(decimals)) return fmtNum(n, decimals);
  if (Math.abs(n) > 0 && Math.abs(n) < 1) return fmtNum(n, Math.min(8, 3 - Math.floor(Math.log10(Math.abs(n)))));
  return fmtNum(n, 2);
}

export function windowLabel(w) {
  return w === 'hour' ? 'Last hour' : 'Last 24 hours';
}

// The title strip note (right side): which window, and what the number is.
export function metaText(d) {
  return d?.rows?.length ? `${windowLabel(d.window)} · opens on Bloombroke` : '';
}

export function trendingTable(d) {
  const rows = Array.isArray(d?.rows) ? d.rows : [];
  if (!rows.length) return `<p class="panel-msg">${esc(QUIET)}</p>`;
  return `<table class="grid-table movers-table trending-table">
    <thead><tr><th scope="col" class="num tr-rank">#</th><th scope="col">Ticker</th><th scope="col" class="num">Opens</th><th scope="col" class="num">Last</th><th scope="col" class="num">%Chg</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr${rowAttrs(r.s)}>
      <td class="num tr-rank">${i + 1}</td>
      ${tickerCell(r.s, r.name, { rowLink: true })}
      <td class="num tr-opens">${esc(opensText(r.n))}</td>
      <td class="num last">${esc(fmtLast(r.last, r.decimals))}</td>
      <td class="num pct ${dirOf(r.changePct)}">${esc(fmtPct(r.changePct))}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Trending', LOADING, { meta: '', metaId: 'tr-meta', cls: 'panel-solo trending' });
  const body = el.querySelector('.panel-body');
  const meta = el.querySelector('#tr-meta');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/trending', { signal: ctx.signal });
      meta.textContent = metaText(d);
      body.innerHTML = trendingTable(d);
      ctx.updated(d.updated, false);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH TRENDING', 'warn');
    }
  }

  load();
  ctx.live(load, 60_000);
}

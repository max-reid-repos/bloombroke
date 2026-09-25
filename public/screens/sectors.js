// SECTORS: the 11 SPDR sector ETFs, today, 1 month and year to date.

import { esc, fmtNum, fmtPct, dirOf, panel, LOADING, tick, settleTicks } from './markets.js';
import { tickerCell } from './movers.js';

// A centred bar for a % value, scaled to `max`.
export function pctBar(p, max) {
  if (!Number.isFinite(p) || !(max > 0)) return '';
  const w = Math.min(50, (Math.abs(p) / max) * 50);
  const x = p >= 0 ? 50 : 50 - w;
  return `<svg class="pbar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="pbar-mid" x="49.75" y="0" width="0.5" height="8"/><rect class="pbar-v ${p >= 0 ? 'up' : 'down'}" x="${x.toFixed(2)}" y="1" width="${Math.max(0.5, w).toFixed(2)}" height="6"/></svg>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Sectors', LOADING, { cls: 'panel-solo', metaId: 'sc-meta', meta: 'SPDR SECTOR ETFS' })
    + '<p class="footnote">Today from live quotes. 1M and YTD from daily closes. Prices from CNBC, may be delayed. Not financial advice.</p>';
  const body = el.querySelector('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/sectors', { signal: ctx.signal });
      const rows = [...d.sectors].sort((a, b) => b.changePct - a.changePct);
      const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.changePct)));
      body.innerHTML = `<table class="grid-table sectors-table">
        <thead><tr><th scope="col">Sector</th><th scope="col" class="num">Last</th><th scope="col" class="num">Today</th><th scope="col" class="bar-cell"><span class="offscreen">Today bar</span></th><th scope="col" class="num">1M</th><th scope="col" class="num">YTD</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          ${tickerCell(r.id, r.name)}
          <td class="num last${tick(`sc:${r.id}`, r.last)}">${fmtNum(r.last, 2)}</td>
          <td class="num ${dirOf(r.changePct)}">${fmtPct(r.changePct)}</td>
          <td class="bar-cell">${pctBar(r.changePct, max)}</td>
          <td class="num ${dirOf(r.m1)}">${fmtPct(r.m1)}</td>
          <td class="num ${dirOf(r.ytd)}">${fmtPct(r.ytd)}</td>
        </tr>`).join('')}</tbody>
      </table>`;
      settleTicks(body);
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH SECTORS', 'warn');
    }
  }

  load();
  ctx.every(load, 60_000);
}

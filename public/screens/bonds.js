// BONDS: 10-year government bond yields by country, with today's change in basis points.

import { esc, fmtNum, dirOf, fmtAsOf, panel, LOADING, nameCell, tick, settleTicks } from './markets.js';
import { fmtBp } from './rates.js';

// A bar from 0 to the highest yield on screen.
export function levelBar(v, max) {
  if (!Number.isFinite(v) || !(max > 0)) return '';
  const w = Math.max(0.5, Math.min(100, (v / max) * 100));
  return `<svg class="pbar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="pbar-level" x="0" y="1" width="${w.toFixed(2)}" height="6"/></svg>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = panel('1', 'Government bonds 10Y', LOADING, { cls: 'panel-solo', metaId: 'bd-meta', meta: 'YIELD, PERCENT A YEAR' })
    + '<p class="footnote">10-year government bond yields from CNBC, may be delayed. 1 bp = 0.01%. Higher yield = the market charges that government more to borrow. Not financial advice.</p>';
  const body = el.querySelector('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/bonds', { signal: ctx.signal });
      const rows = [...d.bonds].sort((a, b) => b.last - a.last);
      const max = Math.max(...rows.map((r) => r.last));
      body.innerHTML = `<table class="grid-table bonds-table">
        <thead><tr><th scope="col">Country</th><th scope="col" class="num">Yield</th><th scope="col" class="num">Chg</th><th scope="col" class="bar-cell">Level</th><th scope="col" class="num time">As of</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          ${nameCell(r.name, r.cmd || null)}
          <td class="num last${tick(`bd:${r.id}`, r.last)}">${fmtNum(r.last, 3)}%</td>
          <td class="num bp ${dirOf(Math.round(r.change * 1000))}">${esc(fmtBp(r.change))}</td>
          <td class="bar-cell">${levelBar(r.last, max)}</td>
          <td class="num time dim">${esc(fmtAsOf(r.asOf))}</td>
        </tr>`).join('')}</tbody>
      </table>`;
      settleTicks(body);
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('table')) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
      ctx.status('COULD NOT REFRESH BONDS', 'warn');
    }
  }

  load();
  ctx.every(load, 60_000);
}

// SECTORS: the 11 SPDR sector ETFs, today, 1 month and year to date.

import { esc, fmtNum, fmtPct, dirOf, panel, LOADING, tick, settleTicks, rowAttrs } from './markets.js';
import { tickerCell } from './movers.js';

// A centred bar for a % value, scaled to `max`.
export function pctBar(p, max) {
  if (!Number.isFinite(p) || !(max > 0)) return '';
  const w = Math.min(50, (Math.abs(p) / max) * 50);
  const x = p >= 0 ? 50 : 50 - w;
  return `<svg class="pbar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="pbar-mid" x="49.75" y="0" width="0.5" height="8"/><rect class="pbar-v ${p >= 0 ? 'up' : 'down'}" x="${x.toFixed(2)}" y="1" width="${Math.max(0.5, w).toFixed(2)}" height="6"/></svg>`;
}

// The bar sits in the TODAY cell, left of the number, so it has a header.
export function sectorsTable(sectors) {
  const rows = [...sectors].sort((a, b) => b.changePct - a.changePct);
  const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.changePct)));
  return `<table class="grid-table sectors-table">
    <thead><tr><th scope="col">Sector</th><th scope="col" class="num">Last</th><th scope="col" class="num">Today</th><th scope="col" class="num">1M</th><th scope="col" class="num">YTD</th></tr></thead>
    <tbody>${rows.map((r) => `<tr${rowAttrs(r.id)}>
      ${tickerCell(r.id, r.name, { rowLink: true })}
      <td class="num last${tick(`sc:${r.id}`, r.last)}">${fmtNum(r.last, 2)}</td>
      <td class="num today-cell ${dirOf(r.changePct)}"><span class="tbar">${pctBar(r.changePct, max)}</span>${fmtPct(r.changePct)}</td>
      <td class="num ${dirOf(r.m1)}">${fmtPct(r.m1)}</td>
      <td class="num ${dirOf(r.ytd)}">${fmtPct(r.ytd)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

// The side summary: best and worst sector today, over 1 month and this year.
export function sectorLeaders(sectors) {
  const pick = (key) => {
    const ok = sectors.filter((r) => Number.isFinite(r[key]));
    if (!ok.length) return null;
    const sorted = [...ok].sort((a, b) => b[key] - a[key]);
    return { best: sorted[0], worst: sorted[sorted.length - 1] };
  };
  return [['Today', 'changePct'], ['1 month', 'm1'], ['This year', 'ytd']].map(([label, key]) => ({ label, key, ...pick(key) })).filter((x) => x.best);
}

function leadersHtml(sectors) {
  const one = (r, key) => `<a href="?c=${esc(r.id)}" data-cmd="${esc(r.id)}">${esc(r.name)}</a> <span class="num ${dirOf(r[key])}">${fmtPct(r[key])}</span>`;
  return `<dl class="nb">${sectorLeaders(sectors).map((x) => `<dt>${esc(x.label)}</dt><dd>BEST ${one(x.best, x.key)}<br>WORST ${one(x.worst, x.key)}</dd>`).join('')}</dl>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="with-side">${panel('1', 'Sectors', LOADING, { cls: 'panel-solo', metaId: 'sc-meta', meta: 'SPDR SECTOR ETFS' })}${panel('2', 'Leaders', LOADING, { cls: 'panel-solo' })}</div>`
    + '<p class="footnote">Today from live quotes. 1M and YTD from daily closes. Prices from CNBC, may be delayed. Not financial advice.</p>';
  const [body, side] = el.querySelectorAll('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/sectors', { signal: ctx.signal });
      body.innerHTML = sectorsTable(d.sectors);
      side.innerHTML = leadersHtml(d.sectors);
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

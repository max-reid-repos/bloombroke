// WORLD: world stock indexes by region, with each exchange's local time and OPEN or CLOSED.

import { esc, q, fmtNum, fmtPct, dirOf, panel, LOADING, tick, settleTicks } from './markets.js';
import { EXCHANGES, sessionState, statusOf } from './clock.js';

export const REGIONS = ['Americas', 'Europe', 'Asia-Pacific'];

// Index name with its country code. Rows with a ticker alias open the chart.
function indexCell(r) {
  const inner = `${esc(r.name)} <span class="cc">${esc(r.cc || '')}</span>`;
  return r.cmd
    ? `<th scope="row" class="name"><a href="${esc(q(r.cmd))}" data-cmd="${esc(r.cmd)}">${inner}</a></th>`
    : `<th scope="row" class="name">${inner}</th>`;
}

function table(rows, date) {
  return `<table class="grid-table world-table">
    <thead><tr><th scope="col">Index</th><th scope="col" class="num">Last</th><th scope="col" class="num">%Chg</th><th scope="col" class="num time">Local</th><th scope="col" class="st"><span class="st-text">Status</span></th></tr></thead>
    <tbody>${rows.map((r) => {
      const ex = EXCHANGES[r.ex];
      const st = ex ? sessionState(ex, date) : null;
      const s = st ? statusOf(ex, st, r.asOf) : { text: '--', cls: '' };
      const d = dirOf(r.change);
      return `<tr>
        ${indexCell(r)}
        <td class="num last${tick(`wd:${r.id}`, r.last)}">${fmtNum(r.last, 2)}</td>
        <td class="num pct ${d}">${fmtPct(r.changePct)}</td>
        <td class="num time dim">${esc(st ? st.local.slice(0, 5) : '--')}</td>
        <td class="st ${s.cls}" title="${esc(s.text)}"><span class="st-dot" aria-hidden="true"></span><span class="st-text">${esc(s.text)}</span></td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="grid grid-3">
    ${REGIONS.map((r, i) => panel(String(i + 1), r, LOADING, { metaId: `wd-meta-${i}` })).join('')}
  </div>
  <p class="footnote st-legend" aria-hidden="true"><span class="st-open"><span class="st-dot"></span>OPEN</span><span class="st-lunch"><span class="st-dot"></span>LUNCH</span><span class="st-closed"><span class="st-dot"></span>CLOSED</span></p>`;
  const bodies = el.querySelectorAll('.panel-body');
  let data = null;

  function paint() {
    if (!data) return;
    REGIONS.forEach((region, i) => {
      const rows = data.indexes.filter((x) => x.region === region);
      bodies[i].innerHTML = rows.length ? table(rows, new Date()) : '<p class="panel-msg">No data for this region right now.</p>';
      const open = rows.filter((x) => {
        const ex = EXCHANGES[x.ex];
        return ex && statusOf(ex, sessionState(ex), x.asOf).text === 'OPEN';
      }).length;
      el.querySelector(`#wd-meta-${i}`).textContent = `${open} OF ${rows.length} OPEN`;
      settleTicks(bodies[i]);
    });
  }

  async function load() {
    try {
      data = await ctx.fetchJSON('/api/world', { signal: ctx.signal });
      paint();
      ctx.updated(data.updated, data.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      bodies.forEach((b) => { if (!b.querySelector('table')) b.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`; });
      ctx.status('COULD NOT REFRESH WORLD', 'warn');
    }
  }

  load();
  ctx.every(load, 60_000);
  ctx.every(paint, 30_000);
}

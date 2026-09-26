// WEIRD: odd live gauges on one screen, and one screen per gauge.
//   WEIRD      a grid of numbered tiles. Click a tile, or type its number and Enter.
//   CANAL ...  one gauge: its headline, a table or chart, and how it is measured.
// Gauges are listed in weird-gauges.js; the data comes from /api/weird.

import { esc, panel, LOADING } from './markets.js';
import { sparkSvg } from './economy.js';
import { mountLines } from './lines.js';
import { WEIRD_GAUGES, gaugeByCommand, sourceHtml } from './weird-gauges.js';

export { WEIRD_GAUGES };

// The command for a typed tile number ("3" -> DEGEN), or null.
export function commandForNumber(text) {
  const m = /^\s*(\d{1,2})\s*$/.exec(String(text ?? ''));
  const g = m ? WEIRD_GAUGES[Number(m[1]) - 1] : null;
  return g ? g.command : null;
}

// One tile's inside, from a summary row (or a full gauge response).
export function tileBody(g, d) {
  if (!d) return `<p class="loading">LOADING...</p><p class="wd-src">${esc(g.command)}</p>`;
  const bad = d.ok === false;
  const big = bad ? (d.pending ? 'LOADING' : 'NO DATA') : d.headline;
  // A stale value is a real past reading: shown dimmed, with its time in the source line.
  const cls = bad ? ' is-none' : d.stale ? ' is-stale' : '';
  return `<p class="wd-big${cls}">${esc(big)}</p>
    <p class="wd-line">${esc(bad ? '' : d.line || '')}</p>
    <div class="wd-spark">${!bad && Array.isArray(d.spark) && d.spark.length > 1 ? sparkSvg(d.spark, 120, 18) : ''}</div>
    <p class="wd-src">${sourceHtml(g, d)}</p>`;
}

// data-num: a number and Enter in the command bar opens this tile's own screen (not the
// tile maximised). A bare digit stays typing, so 12 can be typed.
export function tile(g, i) {
  return `<div class="wd-tile" data-cmd="${esc(g.command)}" data-num="${i + 1}" tabindex="0" id="wd-t-${esc(g.id)}">${panel(String(i + 1), g.command, tileBody(g, null))}</div>`;
}

function grid(el, ctx) {
  el.innerHTML = `<div class="wd-grid">${WEIRD_GAUGES.map(tile).join('')}</div>`;
  // A credit link inside a tile opens its site; it does not open the tile.
  el.querySelector('.wd-grid').addEventListener('click', (e) => {
    if (e.target.closest('a[href^="https://"]')) e.stopPropagation();
  });
  const fill = (d) => {
    const g = WEIRD_GAUGES.find((x) => x.id === d.id);
    const body = g && el.querySelector(`#wd-t-${g.id} .panel-body`);
    if (body) body.innerHTML = tileBody(g, d);
  };
  // Type a tile's number and press Enter to open it. The command bar finds the tile by
  // data-num; this hook covers a DESK panel, where that lookup is off.
  ctx.setCommandHook((c) => {
    const cmd = commandForNumber(c);
    if (!cmd) return false;
    setTimeout(() => ctx.run(cmd), 0);
    return true;
  });

  async function load() {
    try {
      const d = await ctx.fetchJSON('/api/weird', { signal: ctx.signal });
      d.gauges.forEach(fill);
      // A slow source came back pending: ask for it on its own.
      for (const p of d.gauges.filter((x) => x.pending)) {
        ctx.fetchJSON(`/api/weird/${encodeURIComponent(p.id)}`, { signal: ctx.signal }).then(fill).catch(() => {});
      }
      // The dot by the clock says when; the status line only carries a warning.
      ctx.updated(d.updated, d.stale);
      const bad = d.gauges.filter((x) => x.ok === false && !x.pending).length;
      ctx.status(bad ? `${bad} NO DATA` : '', bad ? 'warn' : '');
    } catch (err) {
      if (err.name === 'AbortError') return;
      ctx.status('WEIRD: NO DATA', 'warn');
    }
  }
  load();
  ctx.live(load, 10 * 60_000);
}

function detail(el, g, ctx) {
  const n = WEIRD_GAUGES.indexOf(g) + 1;
  el.innerHTML = `<div class="stack">${panel(String(n), g.title, LOADING, { metaId: 'wd-meta' })}</div>`;
  const body = el.querySelector('.panel-body');
  let cleanup = null;
  ctx.onCleanup(() => cleanup?.());
  const how = `<details class="how wd-how"><summary>How is this measured?</summary><div class="how-list">${g.method.map((p) => `<p>${esc(p)}</p>`).join('')}</div></details>`;

  ctx.fetchJSON(`/api/weird/${g.id}`, { signal: ctx.signal }).then((d) => {
    if (d.ok === false) {
      body.innerHTML = `<p class="wd-big is-none">NO DATA</p><p class="wd-src">${esc(d.source)}</p>${how}`;
      ctx.status(`${g.command}: NO DATA · ${String(d.source).toUpperCase()}`, 'warn');
      return;
    }
    const part = g.detail(d);
    body.innerHTML = `<div class="wd-head"><p class="wd-big${d.stale ? ' is-stale' : ''}">${esc(d.headline)}</p><p class="wd-line">${esc(d.line || '')}</p></div>
      <div class="wd-body">${part.html}</div>
      ${how}
      <p class="wd-src">${sourceHtml(g, d)}</p>`;
    const host = body.querySelector('#wd-chart');
    if (host && part.chart) {
      const c = part.chart;
      cleanup = mountLines(host, c.series, { fmtY: c.fmtY, fmtTick: c.fmtY, fmtX: c.fmtX, label: c.label });
    }
    ctx.updated(d.updated, d.stale);
  }).catch((err) => {
    if (err.name === 'AbortError') return;
    body.innerHTML = `<p class="wd-big is-none">NO DATA</p><p class="panel-msg">${esc(err.message)}</p>${how}`;
    ctx.status(`${g.command}: NO DATA`, 'warn');
  });
}

export function render(el, cmd, ctx) {
  const g = gaugeByCommand(cmd.name);
  if (g) detail(el, g, ctx);
  else grid(el, ctx);
}

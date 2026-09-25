// HOME: the default screen. Four panels: markets, S&P 500 chart, currencies, news.

import { esc, fmtNum, fmtSigned, fmtPct, dirOf, panel, LOADING, marketsTable, nameCell, tick, settleTicks } from './markets.js';
import { mountChart, fmtXFor, fmtHoverFor } from './quote.js';
import { newsList } from './news.js';

function fxTable(pairs) {
  const rows = pairs.map((p) => {
    const d = dirOf(p.change);
    const c = `FX 100 ${p.base} ${p.quote}`;
    return `<tr>
      ${nameCell(p.pair, c)}
      <td class="num last${tick(`fx:${p.id}:last`, p.last)}">${fmtNum(p.last, p.decimals)}</td>
      <td class="num chg ${d}">${fmtSigned(p.change, p.decimals)}</td>
      <td class="num pct ${d}">${fmtPct(p.changePct)}</td>
    </tr>`;
  }).join('');
  return `<table class="grid-table">
    <thead><tr><th scope="col">Pair</th><th scope="col" class="num">Last</th><th scope="col" class="num chg">Chg</th><th scope="col" class="num">%Chg</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="grid">
    ${panel('1', 'Markets', LOADING, { cmd: 'MARKETS', metaId: 'h-mk-meta' })}
    ${panel('2', 'S&P 500', `<div class="chart-host chart-host-home" id="h-chart">${LOADING}</div>`, { cmd: 'SPX 1D', metaId: 'h-ch-meta', bodyCls: 'flush' })}
    ${panel('3', 'FX vs USD', LOADING, { cmd: 'FX 100 USD EUR', metaId: 'h-fx-meta' })}
    ${panel('4', 'News', LOADING, { cmd: 'NEWS', metaId: 'h-news-meta', bodyCls: 'flush' })}
  </div>
  <p class="footnote">Prices may be delayed. Not financial advice.</p>`;

  const bodies = el.querySelectorAll('.panel-body');
  const [mkBody, , fxBody, newsBody] = bodies;
  const host = el.querySelector('#h-chart');
  const chMeta = el.querySelector('#h-ch-meta');
  let spx = null;
  let chartRange = '1D';
  let chartCleanup = null;
  let lastUpdated = null;
  ctx.onCleanup(() => chartCleanup?.());

  const fail = (body, err, marker) => {
    if (err.name === 'AbortError') return true;
    if (!body.querySelector(marker)) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    return false;
  };
  const noteUpdated = (d) => {
    if (!lastUpdated || d.updated > lastUpdated.updated || d.stale) lastUpdated = d;
    ctx.updated(lastUpdated.updated, lastUpdated.stale);
  };

  function spxMeta(hover) {
    if (hover) return `<span class="num">${esc(hover)}</span> <span class="dim">${chartRange}</span>`;
    if (!spx) return `<span class="dim">${chartRange}</span>`;
    const d = dirOf(spx.change);
    return `<span class="num">${fmtNum(spx.last, 2)}</span> <span class="num ${d}">${fmtPct(spx.changePct)}</span> <span class="dim">${chartRange}</span>`;
  }

  async function loadMarkets() {
    try {
      const d = await ctx.fetchJSON('/api/markets', { signal: ctx.signal });
      mkBody.innerHTML = marketsTable(d.instruments, { compact: true });
      settleTicks(mkBody);
      spx = d.instruments.find((m) => m.id === 'SPX') || null;
      chMeta.innerHTML = spxMeta();
      noteUpdated(d);
    } catch (err) {
      if (!fail(mkBody, err, 'table')) ctx.status('COULD NOT REFRESH MARKETS', 'warn');
    }
  }

  async function loadFx() {
    try {
      const d = await ctx.fetchJSON('/api/fxmajors', { signal: ctx.signal });
      fxBody.innerHTML = fxTable(d.pairs);
      settleTicks(fxBody);
      noteUpdated(d);
    } catch (err) {
      fail(fxBody, err, 'table');
    }
  }

  async function loadNews() {
    try {
      const d = await ctx.fetchJSON('/api/news', { signal: ctx.signal });
      newsBody.innerHTML = newsList(d.items.slice(0, 8));
    } catch (err) {
      fail(newsBody, err, '.news');
    }
  }

  // Intraday if there is a session to show, else one year.
  async function loadChart() {
    let d = null;
    for (const r of ['1D', '1Y']) {
      try {
        d = await ctx.fetchJSON(`/api/chart?s=SPX&r=${r}`, { signal: ctx.signal });
        chartRange = r;
        break;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    if (!d) {
      if (!host.querySelector('svg')) host.innerHTML = '<p class="panel-msg">Chart data is taking a break.</p>';
      return;
    }
    const hover = fmtHoverFor(chartRange);
    chMeta.innerHTML = spxMeta();
    chartCleanup?.();
    host.textContent = '';
    chartCleanup = mountChart(host, d.points, {
      fmtY: (v) => fmtNum(v, 0), fmtX: fmtXFor(chartRange), label: `S&P 500, ${chartRange}`,
      onHover: (p) => { chMeta.innerHTML = spxMeta(p ? `${hover(p.t)} ${fmtNum(p.v, 2)}` : null); },
    });
  }

  loadMarkets();
  loadChart();
  loadFx();
  loadNews();
  ctx.every(() => { loadMarkets(); loadFx(); }, 60_000);
  ctx.every(loadChart, 5 * 60_000);
  ctx.every(loadNews, 5 * 60_000);
}


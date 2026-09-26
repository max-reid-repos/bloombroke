// HOME: the default screen. A short MARKETS list, the S&P 500 chart and the news.

import { esc, fmtNum, fmtSigned, fmtPct, dirOf, panel, LOADING, marketsColumns, nameCell, rowAttrs, rerender, tick, settleTicks } from './markets.js';
import { rangeChart } from './chart.js';
import { freshTag } from '../freshness.js';
import { newsList } from './news.js';

export function fxTable(pairs) {
  const rows = pairs.map((p) => {
    const d = dirOf(p.change);
    return `<tr${rowAttrs(p.id)}>
      ${nameCell(p.pair || p.name, p.id)}
      <td class="tag">${freshTag(p)}</td>
      <td class="num last${tick(`fx:${p.id}:last`, p.last)}">${fmtNum(p.last, p.decimals)}</td>
      <td class="num chg ${d}">${fmtSigned(p.change, p.decimals)}</td>
      <td class="num pct ${d}">${fmtPct(p.changePct)}</td>
    </tr>`;
  }).join('');
  return `<table class="grid-table">
    <thead><tr><th scope="col">Pair</th><th scope="col" class="tag"><span class="offscreen">Real time or delayed</span></th><th scope="col" class="num">Last</th><th scope="col" class="num chg">Chg</th><th scope="col" class="num">%Chg</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// HOME's short MARKETS list: four columns, each a group of the MARKETS screen's own
// instruments (the full list stays on MARKETS).
export const HOME_MARKETS = [
  { name: 'US', ids: ['SPX', 'NDX', 'DJI', 'RUT', 'VIX'] },
  { name: 'World', ids: ['FTSE', 'DAX', 'N225', 'HSI', 'SHANGHAI'] },
  { name: 'Commodities + crypto', ids: ['GOLD', 'WTI', 'COPPER', 'BALTICDRY', 'BTC', 'ETH'] },
  { name: 'FX + rates', ids: ['EURUSD', 'USDJPY', 'GBPUSD', 'DXY', 'US10Y'] },
];

// The HOME rows from /api/markets, regrouped, in the order above. Missing ids drop out.
export function homeMarkets(instruments) {
  const byId = new Map((instruments || []).map((m) => [m.id, m]));
  return HOME_MARKETS.flatMap((g) => g.ids.filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id), group: g.name })));
}

const HOME_NEWS_ROWS = 30;

export function render(el, cmd, ctx) {
  el.innerHTML = `<div class="grid grid-home">
    ${panel('1', 'Markets', LOADING, { cmd: 'MARKETS', metaId: 'h-mk-meta', cls: 'panel-wide' })}
    ${panel('2', 'S&P 500', '<div class="rc rc-home" id="h-rc"></div>', { cmd: 'SPX', metaId: 'h-ch-meta', bodyCls: 'flush', cls: 'h-chart' })}
    ${panel('3', 'News', LOADING, { cmd: 'NEWS', metaId: 'h-news-meta', bodyCls: 'flush', cls: 'h-news' })}
  </div>`;

  const bodies = el.querySelectorAll('.panel-body');
  const [mkBody, , newsBody] = bodies;
  const fail = (body, err, marker) => {
    if (err.name === 'AbortError') return true;
    if (!body.querySelector(marker)) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    return false;
  };

  const chart = rangeChart(el.querySelector('#h-rc'), ctx, {
    symbol: 'SPX', range: { range: '1D' }, meta: el.querySelector('#h-ch-meta'), hostCls: 'chart-host-home',
    label: 'S&P 500', decimals: 2, fmtY: (v) => fmtNum(v, 0),
  });

  async function loadMarkets() {
    try {
      const d = await ctx.fetchJSON('/api/markets', { signal: ctx.signal });
      const rows = homeMarkets(d.instruments);
      rerender(mkBody, marketsColumns(rows, { chg: false, cls: 'mk-cols h-mk' }));
      settleTicks(mkBody);
      const spx = d.instruments.find((m) => m.id === 'SPX');
      if (spx) chart.setLive({ t: Date.parse(spx.asOf), v: spx.last });
      ctx.updated(d.updated, d.stale, rows);
    } catch (err) {
      if (!fail(mkBody, err, 'table')) ctx.status('COULD NOT REFRESH MARKETS', 'warn');
    }
  }

  async function loadNews() {
    try {
      const d = await ctx.fetchJSON('/api/news', { signal: ctx.signal });
      newsBody.innerHTML = newsList(d.items.slice(0, HOME_NEWS_ROWS));
    } catch (err) {
      fail(newsBody, err, '.news');
    }
  }

  loadMarkets();
  loadNews();
  ctx.live(loadMarkets, 15_000);
  ctx.live(loadNews, 5 * 60_000);
}

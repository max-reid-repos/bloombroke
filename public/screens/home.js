// HOME: the default screen. A dense MARKETS list, the S&P 500 chart and the news.

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

// HOME's MARKETS list: four columns of ten, each a group of the MARKETS screen's own
// instruments under short names (the full list and full names stay on MARKETS). A plain
// string starts a sub-heading bar inside the column (Europe, Asia, Energy...).
export const HOME_MARKETS = [
  { name: 'US', rows: [
    ['SPX', 'S&P 500'], ['NDX', 'Nasdaq 100'], ['DJI', 'Dow'], ['RUT', 'Russell 2000'], ['SPXEW', 'Equal weight'],
    ['SOX', 'Semis'], ['DJTRANS', 'Transports'], ['SPFUT', 'S&P 500 fut'], ['NDFUT', 'Nasdaq 100 fut'], ['VIX', 'VIX'],
  ] },
  { name: 'World', rows: [
    'Europe', ['STOXX50', 'Euro Stoxx 50'], ['FTSE', 'FTSE 100'], ['DAX', 'DAX'], ['CAC40', 'CAC 40'],
    'Asia', ['N225', 'Nikkei 225'], ['HSI', 'Hang Seng'], ['SHANGHAI', 'Shanghai'], ['KOSPI', 'KOSPI'], ['NIFTY50', 'Nifty 50'], ['ASX200', 'ASX 200'],
  ] },
  { name: 'Commodities + crypto', rows: [
    'Energy', ['WTI', 'WTI oil'], ['BRENT', 'Brent oil'], ['NATGAS', 'Natural gas'],
    'Metals', ['GOLD', 'Gold (spot)'], ['SILVER', 'Silver (spot)'], ['COPPER', 'Copper'],
    'Other', ['WHEAT', 'Wheat'], ['BALTICDRY', 'Baltic Dry'],
    'Crypto', ['BTC', 'Bitcoin'], ['ETH', 'Ether'],
  ] },
  { name: 'FX + rates', rows: [
    'FX', ['DXY', 'Dollar index'], ['EURUSD', 'EUR/USD'], ['USDJPY', 'USD/JPY'], ['GBPUSD', 'GBP/USD'], ['USDCNH', 'USD/CNH'],
    'Rates', ['US3M', 'US 3M'], ['US2Y', 'US 2Y'], ['US10Y', 'US 10Y'], ['US30Y', 'US 30Y'], ['US2S10S', '2s10s'],
  ] },
];

// The HOME rows from /api/markets, regrouped in the order above, each with its group,
// sub-heading and short name. A missing id drops out; a sub-heading with no rows left
// drops with it (it only shows above a row).
export function homeMarkets(instruments) {
  const byId = new Map((instruments || []).map((m) => [m.id, m]));
  return HOME_MARKETS.flatMap((g) => {
    let sub = null;
    const out = [];
    for (const r of g.rows) {
      if (typeof r === 'string') { sub = r; continue; }
      const [id, name] = r;
      if (byId.has(id)) out.push({ ...byId.get(id), name, group: g.name, sub });
    }
    return out;
  });
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

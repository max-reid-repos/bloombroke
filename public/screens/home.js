// HOME: the default screen. Markets by region, the S&P 500 chart, currencies, news.

import { esc, fmtNum, fmtSigned, fmtPct, dirOf, panel, LOADING, marketsColumns, nameCell, rowAttrs, rerender, tick, settleTicks, FOOTNOTE } from './markets.js';
import { rangeChart } from './chart.js';
import { freshTag } from '../freshness.js';
import { newsList } from './news.js';
import { loadWatchlist, isDefaultList } from '../watchlist.js';
import { fetchQuotes, watchCompact } from './watch.js';

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

const HOME_WATCH_ROWS = 10;

export function render(el, cmd, ctx) {
  // The user's own watchlist replaces the FX panel once it is theirs (not the starter list).
  const watch = loadWatchlist(ctx.store);
  const mine = watch.length > 0 && !isDefaultList(watch);
  const shown = watch.slice(0, HOME_WATCH_ROWS);
  el.innerHTML = `<div class="grid grid-home">
    ${panel('1', 'Markets', LOADING, { cmd: 'MARKETS', metaId: 'h-mk-meta', cls: 'panel-wide' })}
    ${panel('2', 'S&P 500', '<div class="rc rc-home" id="h-rc"></div>', { cmd: 'SPX', metaId: 'h-ch-meta', bodyCls: 'flush' })}
    ${mine
    ? panel('3', 'Watchlist', LOADING, { cmd: 'WATCH', metaId: 'h-fx-meta', meta: `${watch.length} SYMBOLS` })
    : panel('3', 'FX vs USD', LOADING, { cmd: 'FX 100 USD EUR', metaId: 'h-fx-meta' })}
    ${panel('4', 'News', LOADING, { cmd: 'NEWS', metaId: 'h-news-meta', bodyCls: 'flush', cls: 'panel-wide' })}
  </div>
  <p class="footnote h-desk">Build your own screen: <a class="code" href="?c=DESK" data-cmd="DESK">DESK</a></p>
  ${FOOTNOTE}`;

  const bodies = el.querySelectorAll('.panel-body');
  const [mkBody, , fxBody, newsBody] = bodies;
  const seen = { markets: null, fx: null };
  const fail = (body, err, marker) => {
    if (err.name === 'AbortError') return true;
    if (!body.querySelector(marker)) body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`;
    return false;
  };
  // The status line covers both tables: the older of the two times, every tag shown.
  const noteUpdated = () => {
    const got = [seen.markets, seen.fx].filter(Boolean);
    if (!got.length) return;
    const oldest = got.map((d) => d.updated).sort()[0];
    ctx.updated(oldest, got.some((d) => d.stale), [...(seen.markets?.instruments || []), ...(seen.fx?.pairs || [])]);
  };

  const chart = rangeChart(el.querySelector('#h-rc'), ctx, {
    symbol: 'SPX', range: { range: '1D' }, meta: el.querySelector('#h-ch-meta'), hostCls: 'chart-host-home',
    label: 'S&P 500', decimals: 2, fmtY: (v) => fmtNum(v, 0),
  });

  async function loadMarkets() {
    try {
      const d = await ctx.fetchJSON('/api/markets', { signal: ctx.signal });
      rerender(mkBody, marketsColumns(d.instruments));
      settleTicks(mkBody);
      seen.markets = d;
      const spx = d.instruments.find((m) => m.id === 'SPX');
      if (spx) chart.setLive({ t: Date.parse(spx.asOf), v: spx.last });
      noteUpdated();
    } catch (err) {
      if (!fail(mkBody, err, 'table')) ctx.status('COULD NOT REFRESH MARKETS', 'warn');
    }
  }

  async function loadWatch() {
    try {
      const { byId, data } = await fetchQuotes(ctx, shown);
      const more = watch.length - shown.length;
      rerender(fxBody, watchCompact(shown, byId) + (more > 0 ? `<p class="h-more"><a href="?c=WATCH" data-cmd="WATCH">${more} more on your watchlist</a></p>` : ''));
      settleTicks(fxBody);
      seen.fx = { updated: data.updated, stale: data.stale, pairs: data.quotes };
      noteUpdated();
    } catch (err) {
      fail(fxBody, err, 'table');
    }
  }

  async function loadFx() {
    if (mine) { loadWatch(); return; }
    try {
      const d = await ctx.fetchJSON('/api/fxmajors', { signal: ctx.signal });
      rerender(fxBody, fxTable(d.pairs));
      settleTicks(fxBody);
      seen.fx = d;
      noteUpdated();
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

  loadMarkets();
  loadFx();
  loadNews();
  ctx.live(() => { loadMarkets(); loadFx(); }, 15_000);
  ctx.live(loadNews, 5 * 60_000);
}

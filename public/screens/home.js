// HOME: the default screen. A dense MARKETS list, the S&P 500 chart and the news.

import { esc, fmtNum, panel, LOADING, marketsColumns, rerender, settleTicks, HOME_MARKETS, homeMarkets, MARKETS_FULL } from './markets.js';
import { rangeChart } from './chart.js';
import { freshLegend } from '../freshness.js';
import { newsList, liveNews, dedupeNews, mergePushed, newsStream, NEWS_POLL_MS } from './news.js';
import { startSince } from '../since.js'; // SINCE line
import { lazyScreen, loadScreen, stylesOf, prefetch } from '../lazy.js';

// GRAVEYARD: ON THIS DAY comes from screens/graveyard.js, loaded (with its stylesheet)
// once HOME has drawn, so the page does not wait for the whole graveyard.
const GRAVEYARD = lazyScreen('screens/graveyard.js');

// HOME's list lives in markets.js (MARKETS uses its groups too).
export { HOME_MARKETS, homeMarkets };

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
    label: 'S&P 500', decimals: 2, fmtY: (v) => fmtNum(v, 0), panel: true,
  });
  const since = startSince(el.querySelector('#h-mk-meta'), ctx); // SINCE: in the MARKETS title strip
  // GRAVEYARD: ON THIS DAY, one quiet line in the MARKETS title strip
  loadScreen(GRAVEYARD, stylesOf(GRAVEYARD.js))
    .then((g) => { if (!ctx.signal.aborted) g.mountOnThisDay(el.querySelector('#h-mk-meta')?.parentElement, { signal: ctx.signal }); }, () => {});

  // RT · DLY once in the strip, its own span (SINCE repaints the meta).
  const mkHead = el.querySelector('#h-mk-meta')?.parentElement;
  function paintLegend(rows) {
    if (!mkHead) return;
    const html = freshLegend(rows);
    const had = mkHead.querySelector(':scope > .fresh-legend');
    if (!html) had?.remove();
    else if (had) had.outerHTML = html;
    else mkHead.insertAdjacentHTML('beforeend', html);
  }

  async function loadMarkets() {
    try {
      const d = await ctx.fetchJSON('/api/markets', { signal: ctx.signal });
      const rows = homeMarkets(d.instruments);
      rerender(mkBody, marketsColumns(rows, { chg: false, cls: 'mk-cols h-mk' }));
      settleTicks(mkBody);
      paintLegend(rows);
      if (!ctx.embed) prefetch(MARKETS_FULL); // F4 draws at once (once only: lazy.js)
      const spx = d.instruments.find((m) => m.id === 'SPX');
      if (spx) chart.setLive({ t: Date.parse(spx.asOf), v: spx.last });
      since.markets(d.instruments);
      ctx.updated(d.updated, d.stale, rows);
    } catch (err) {
      if (!fail(mkBody, err, 'table')) ctx.status('COULD NOT REFRESH MARKETS', 'warn');
    }
  }

  // The news box: new stories are pushed and glow in at the top (news.js); while the
  // stream is down it is asked again every minute.
  const liveBox = liveNews({ body: newsBody, meta: el.querySelector('#h-news-meta'), ctx, marker: true });
  let newsItems = null;
  let pendingNews = [];
  const showNews = () => liveBox.show(newsItems, newsItems, newsList(newsItems));
  const newsFeed = newsStream({
    tabs: ['MARKETS'], ctx,
    onState: (on) => liveBox.setLive(on),
    onItems: (t, items) => {
      if (t !== 'MARKETS') return;
      if (!newsItems) { pendingNews = mergePushed(pendingNews, items); return; }
      newsItems = mergePushed(newsItems, items, HOME_NEWS_ROWS);
      showNews();
    },
  });
  async function loadNews() {
    try {
      const d = await ctx.fetchJSON('/api/news', { signal: ctx.signal });
      newsItems = mergePushed(dedupeNews(d.items), pendingNews, HOME_NEWS_ROWS);
      pendingNews = [];
      showNews();
    } catch (err) {
      fail(newsBody, err, '.news');
    }
  }

  loadMarkets();
  loadNews();
  ctx.live(loadMarkets, 15_000);
  ctx.live(() => { if (!newsFeed.live) loadNews(); }, NEWS_POLL_MS);
}

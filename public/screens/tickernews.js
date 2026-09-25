// NEWS <ticker>: headlines about one company. Plain NEWS stays the market-wide screen.

import { esc, panel, LOADING } from './markets.js';
import { safeHref, fmtNewsTime } from './news.js';
import { errorHtml } from './profile.js';

const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// NEWS <ticker>. Returns null for plain NEWS so the market-wide screen handles it.
export function parse(args) {
  if (!args.length) return null;
  return args.length === 1 && TICKER.test(args[0]) ? { ticker: args[0] } : { error: 'usage' };
}

export function tickerNewsList(items) {
  return `<ol class="news">${items.map((n) => {
    const href = safeHref(n.link);
    if (!href) return '';
    return `<li class="news-row tnews-row">
      <span class="news-time num">${esc(fmtNewsTime(n.time))}</span>
      <a class="news-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
      <span class="tnews-src dim">${esc(n.source || '')}</span>
    </li>`;
  }).join('')}</ol>`;
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'News', `<p class="notice">NEWS takes one ticker, or none for market news.</p>`, { cls: 'panel-solo' });
    ctx.status('NEWS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = panel('1', `${ticker} news`, LOADING, { cls: 'panel-solo', bodyCls: 'flush' })
    + '<p class="footnote">Headlines tagged with this ticker, from the Nasdaq news feed: the headline, the publisher and a link only. Each one opens on the original publisher\'s site, in a new tab.</p>';
  const body = el.querySelector('.panel-body');

  async function load() {
    try {
      const d = await ctx.fetchJSON(`/api/tickernews?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal });
      body.innerHTML = d.items.length ? tickerNewsList(d.items) : `<p class="panel-msg">No recent headlines for ${esc(ticker)}.</p>`;
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('.news')) body.innerHTML = `<div class="pad">${errorHtml(err, ticker)}</div>`;
      ctx.status('COULD NOT REFRESH NEWS', 'warn');
    }
  }

  load();
  ctx.every(load, 5 * 60_000);
}

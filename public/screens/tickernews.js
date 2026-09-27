// NEWS <ticker>: headlines about one company. Plain NEWS stays the market-wide screen.

import { esc, panel, LOADING } from './markets.js';
import { safeHref, newsTimeHtml, NEWS_POLL_MS } from './news.js';
import { toolbar, segmented } from '../kit.js';
import { errorHtml } from './profile.js';

const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// The sources, in the panel's title strip.
export const TICKER_SOURCES = 'NEWS PUBLISHERS · SEC';

// NEWS <ticker>. Returns null for plain NEWS so the market-wide screen handles it.
export function parse(args) {
  if (!args.length) return null;
  return args.length === 1 && TICKER.test(args[0]) ? { ticker: args[0] } : { error: 'usage' };
}

// Time, source, headline: the source sits in the same slot as on NEWS.
export function tickerNewsList(items) {
  return `<ol class="news">${items.map((n) => {
    const href = safeHref(n.link);
    if (!href) return '';
    return `<li class="news-row tnews-row">
      ${newsTimeHtml(n.time)}
      <span class="news-src tnews-src" title="${esc(n.source || '')}">${esc(n.source || '')}</span>
      <a class="news-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>
    </li>`;
  }).join('')}</ol>`;
}

const SKIP = new Set(['the', 'inc', 'corp', 'co', 'ltd', 'plc']);

// The first real word of a company name: "Apple Inc." -> "Apple".
export function nameWord(name) {
  const w = String(name || '').replace(/[.,]/g, ' ').split(/\s+/).find((x) => x.length >= 3 && !SKIP.has(x.toLowerCase()));
  return w || null;
}

const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (t, flags = '') => new RegExp(`(^|[^A-Za-z0-9])${escRe(t)}([^A-Za-z0-9]|$)`, flags);

// The feed tags many market-wide stories with a ticker. A story is about the company
// when its headline names the ticker or the first word of the company name. The
// company's own SEC filings (about: true) always are.
export function aboutTicker(items, ticker, name) {
  const tests = [wordRe(ticker)];
  const word = nameWord(name);
  if (word) tests.push(wordRe(word, 'i'));
  return items.filter((n) => n.about === true || tests.some((t) => t.test(n.title || '')));
}

export function render(el, cmd, ctx) {
  if (cmd.error) {
    el.innerHTML = panel('1', 'News', `<p class="notice">NEWS takes one ticker, or none for market news.</p>`, { cls: 'panel-solo' });
    ctx.status('NEWS: CHECK THE FORMAT', 'warn');
    return;
  }
  const { ticker } = cmd.args;
  el.innerHTML = panel('1', `${ticker} news`, `<div class="news-bar"></div><div class="news-body">${LOADING}</div>`, { cls: 'panel-solo', bodyCls: 'flush', meta: TICKER_SOURCES });
  const bar = el.querySelector('.news-bar');
  const body = el.querySelector('.news-body');
  let items = [];
  let name = null;
  let view = null; // 'ABOUT' or 'ALL'; the first paint picks ABOUT when any story is about it.

  function paint() {
    const about = aboutTicker(items, ticker, name);
    if (!view) view = about.length ? 'ABOUT' : 'ALL';
    const shown = view === 'ABOUT' ? about : items;
    bar.innerHTML = items.length ? toolbar({ left: segmented([
      { label: `ABOUT ${ticker} ${about.length}`, value: 'ABOUT' },
      { label: `ALL TAGGED ${items.length}`, value: 'ALL' },
    ], view, { label: 'Stories' }), label: 'Stories' }) : '';
    body.innerHTML = shown.length ? tickerNewsList(shown) : `<p class="panel-msg">No recent headlines for ${esc(ticker)}.</p>`;
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-value]');
    if (!b) return;
    view = b.dataset.value;
    paint();
  });
  // The company name lets ABOUT catch "Apple" as well as "AAPL".
  ctx.fetchJSON(`/api/quote?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal }).then((qd) => {
    name = qd?.name || null;
    if (items.length && view !== 'ALL') { view = null; paint(); }
  }).catch(() => {});

  async function load() {
    try {
      const d = await ctx.fetchJSON(`/api/tickernews?s=${encodeURIComponent(ticker)}`, { signal: ctx.signal });
      items = d.items;
      paint();
      ctx.updated(d.updated, d.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('.news')) body.innerHTML = `<div class="pad">${errorHtml(err, ticker)}</div>`;
      ctx.status('COULD NOT REFRESH NEWS', 'warn');
    }
  }

  load();
  ctx.live(load, NEWS_POLL_MS); // every minute while on show, like the NEWS tabs
}

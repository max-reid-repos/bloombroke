// NEWS: finance headlines from a few public feeds, newest first.

import { esc, panel, LOADING } from './markets.js';
import { toolbar, segmented } from '../kit.js';

const SHORT = {
  CNBC: 'CNBC', MarketWatch: 'MKTW', 'Yahoo Finance': 'YHOO', 'Federal Reserve': 'FED', BLS: 'BLS', 'SEC EDGAR': 'SEC',
  'PR Newswire': 'PRN', GlobeNewswire: 'GNW', 'Business Wire': 'BW', 'r/wallstreetbets': 'WSB',
};

// NEWS tabs: NEWS alone is MARKETS; NEWS SEC opens that tab.
export const NEWS_TABS = ['MARKETS', 'MACRO', 'SEC', 'WIRES', 'WSB'];
export const tabCommand = (tab) => (tab === 'MARKETS' ? 'NEWS' : `NEWS ${tab}`);

// NEWS <tab> -> { tab }. Anything else is not this screen (null): NEWS <ticker> is.
export function parse(args) {
  return args.length === 1 && NEWS_TABS.includes(args[0]) ? { tab: args[0] } : null;
}

// Each tab's sources, in the panel's title strip.
export const TAB_SOURCES = {
  MARKETS: 'CNBC · MKTW · YHOO', MACRO: 'FED · BLS', SEC: 'SEC EDGAR', WIRES: 'GNW · PRN · BW', WSB: 'REDDIT',
};

export const newsApi = (tab) => (tab === 'MARKETS' ? '/api/news' : `/api/news?tab=${encodeURIComponent(tab)}`);
export const shortSource = (name) => SHORT[name] || String(name || '').slice(0, 4).toUpperCase();

export function safeHref(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// Today in New York -> "13:02". Older -> "SEP 24".
export function fmtNewsTime(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '--';
  const day = (x) => x.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  if (day(d) === day(now)) {
    return d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: '2-digit' }).toUpperCase();
}

// The same day on a phone: "9/24" (fits the narrow time column without wrapping).
export function fmtNewsTimeShort(iso, now = new Date()) {
  const long = fmtNewsTime(iso, now);
  if (!/^[A-Z]{3} \d{2}$/.test(long)) return long;
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'numeric', day: 'numeric' });
}

// The time cell: SEP 24 on wide screens, 9/24 on phones (CSS picks one).
export function newsTimeHtml(iso, now = new Date()) {
  const long = fmtNewsTime(iso, now);
  const short = fmtNewsTimeShort(iso, now);
  return long === short
    ? `<span class="news-time num">${esc(long)}</span>`
    : `<span class="news-time num"><span class="nt-l">${esc(long)}</span><span class="nt-s">${esc(short)}</span></span>`;
}

// NEWS source filter: ALL or one feed's short name.
export function filterNews(items, src) {
  return !src || src === 'ALL' ? items : items.filter((n) => shortSource(n.source) === src);
}

const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

// SEC tab rows (they carry a ticker field): the filer's ticker opens its screen, then
// "Company: item words" opens the filing. Filers with no listed ticker are dimmed.
function filingCell(n, href) {
  const t = TICKER.test(n.ticker || '') ? n.ticker : null;
  const tk = t ? `<a class="news-tkr" href="?${esc(new URLSearchParams({ c: t }).toString())}" data-cmd="${esc(t)}">${esc(t)}</a>` : '<span class="news-tkr"></span>';
  return `<span class="news-title news-filing">${tk}<a class="news-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a></span>`;
}

export function newsList(items) {
  const rows = items.map((n) => {
    const href = safeHref(n.link);
    if (!href) return '';
    const src = shortSource(n.source);
    const filing = 'ticker' in n;
    return `<li class="news-row${filing && !n.ticker ? ' is-dim' : ''}">
      ${newsTimeHtml(n.time)}
      <span class="news-src" title="${esc(n.source || '')}">${esc(src)}</span>
      ${filing ? filingCell(n, href) : `<a class="news-title" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>`}
    </li>`;
  }).join('');
  return `<ol class="news">${rows}</ol>`;
}

export function render(el, cmd, ctx) {
  const tab = NEWS_TABS.includes(cmd.args?.tab) ? cmd.args.tab : 'MARKETS';
  el.innerHTML = panel('1', 'News', `<div class="news-bar">${LOADING}</div><div class="news-body"></div>`, { cls: 'panel-solo', metaId: 'news-meta', bodyCls: 'flush', meta: esc(TAB_SOURCES[tab]) });
  const bar = el.querySelector('.news-bar');
  const body = el.querySelector('.news-body');
  let data = null;
  let src = 'ALL';
  const tabs = segmented(NEWS_TABS.map((t) => ({ label: t, cmd: tabCommand(t) })), tab, { label: 'News tab' });

  function paint() {
    if (!data) return;
    const sources = [...new Set(data.sources.map(shortSource))];
    if (!sources.includes(src)) src = 'ALL';
    const items = filterNews(data.items, src);
    const pick = sources.length > 1 ? segmented([{ label: 'ALL', value: 'ALL' }, ...sources.map((x) => ({ label: x, value: x }))], src, { label: 'Source' }) : '';
    bar.innerHTML = toolbar({ left: tabs, right: pick, label: 'News' });
    body.innerHTML = items.length ? newsList(items) : '<p class="panel-msg">NO DATA</p>';
  }

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-value]');
    if (!b) return;
    src = b.dataset.value;
    paint();
  });

  async function load() {
    try {
      data = await ctx.fetchJSON(newsApi(tab), { signal: ctx.signal });
      paint();
      if (data.updated) ctx.updated(data.updated, data.stale);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!body.querySelector('.news')) { bar.innerHTML = toolbar({ left: tabs, label: 'News' }); body.innerHTML = `<p class="panel-msg">${esc(err.message)}</p>`; }
      ctx.status('COULD NOT REFRESH NEWS', 'warn');
    }
  }

  load();
  ctx.every(load, 5 * 60_000);
}
